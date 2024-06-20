// Import Node.js Dependencies
import { once, EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import timers from "node:timers/promises";

// Import Third-party Dependencies
import {
  getRedis,
  Channel
} from "@myunisoft/redis";
import { pino } from "pino";
import { P, match } from "ts-pattern";
import { ValidateFunction } from "ajv";
import { Result } from "@openally/result";

// Import Internal Dependencies
import {
  IncomerMainTransaction,
  PartialTransaction,
  Transaction,
  TransactionStore
} from "../store/transaction.class";
import {
  Prefix,
  EventCast,
  EventSubscribe,
  DispatcherChannelMessages,
  IncomerChannelMessages,
  DispatcherApprovementMessage,
  CallBackEventMessage,
  DispatcherPingMessage,
  DistributedEventMessage,
  EventMessage,
  GenericEvent,
  IncomerRegistrationMessage,
  RetryMessage
} from "../../types/eventManagement/index";
import {
  NestedValidationFunctions,
  StandardLog,
  defaultStandardLog,
  handleLoggerMode
} from "../../utils/index";
import { Externals } from "./externals.class";
import { DISPATCHER_CHANNEL_NAME, DispatcherChannelEvents, PartialLogger } from "./dispatcher.class";
import { customValidationCbFn, eventsValidationFn } from "./dispatcher/events.class";

// CONSTANTS
// Arbitrary value according to fastify default pluginTimeout
// Max timeout is 8_000, but u may init both an Dispatcher & an Incomer
const kDefaultStartTime = Number.isNaN(Number(process.env.MYUNISOFT_INCOMER_INIT_TIMEOUT)) ? 3_500 :
  Number(process.env.MYUNISOFT_INCOMER_INIT_TIMEOUT);
const kExternalInit = (process.env.MYUNISOFT_EVENTS_INIT_EXTERNAL ?? "false") === "true";
const kLoggerMode = (handleLoggerMode(process.env.MYUNISOFT_EVENTS_LOGGER_MODE));
const kMaxPingInterval = Number.isNaN(Number(process.env.MYUNISOFT_INCOMER_MAX_PING_INTERVAL)) ? 60_000 :
  Number(process.env.MYUNISOFT_INCOMER_MAX_PING_INTERVAL);
const kPublishInterval = Number.isNaN(Number(process.env.MYUNISOFT_INCOMER_PUBLISH_INTERVAL)) ? 60_000 :
  Number(process.env.MYUNISOFT_INCOMER_PUBLISH_INTERVAL);
const kIsDispatcherInstance = (process.env.MYUNISOFT_INCOMER_IS_DISPATCHER ?? "false") === "true";

export const RESOLVED: unique symbol = Symbol.for("RESOLVED");
export const UNRESOLVED: unique symbol = Symbol.for("UNRESOLVED");

type IncomerChannelEvents<
  T extends GenericEvent = GenericEvent
> = { name: "PING"; message: DispatcherPingMessage } | { name: string; message: DistributedEventMessage<T> };

function isDispatcherChannelMessage<T extends GenericEvent = GenericEvent>(value:
  DispatcherChannelMessages["DispatcherMessages"] |
  IncomerChannelMessages<T>["DispatcherMessages"]
): value is DispatcherChannelMessages["DispatcherMessages"] {
  return value.name === "APPROVEMENT";
}

function isIncomerChannelMessage<T extends GenericEvent = GenericEvent>(value:
  DispatcherChannelMessages["DispatcherMessages"] |
  IncomerChannelMessages<T>["DispatcherMessages"]
): value is IncomerChannelMessages<T>["DispatcherMessages"] {
  return value.name !== "APPROVEMENT";
}

type Resolved = "RESOLVED";
type Unresolved = "UNRESOLVED";

export type EventCallbackResponse<T extends Resolved | Unresolved = Resolved | Unresolved> = Result<
  T extends Resolved ? {
    status: T;
  } : {
  status: T;
  retryStrategy?: {
    maxIteration: number;
  };
  reason: string;
}, string>;

function isUnresolvedEvent(value: EventCallbackResponse): value is EventCallbackResponse<"UNRESOLVED"> {
  return value.ok && Symbol.for(value.val.status) === UNRESOLVED;
}

export type IncomerOptions<T extends GenericEvent = GenericEvent> = {
  /* Service name */
  name: string;
  prefix?: Prefix;
  logger?: PartialLogger;
  standardLog?: StandardLog<T>;
  eventsCast: EventCast[];
  eventsSubscribe: EventSubscribe[];
  eventsValidation?: {
    eventsValidationFn?: eventsValidationFn<T>;
    customValidationCbFn?: customValidationCbFn<T>;
  };
  eventCallback: (message: CallBackEventMessage<T>) => Promise<EventCallbackResponse>;
  dispatcherInactivityOptions?: {
    /* max interval between received ping before considering dispatcher off */
    maxPingInterval?: number;
    /* max interval between a new event (based on ping interval) */
    publishInterval?: number;
  };
  isDispatcherInstance?: boolean;
  externalsInitialized?: boolean;
};

export class Incomer <
  T extends GenericEvent = GenericEvent
> extends EventEmitter {
  readonly name: string;
  readonly prefix: Prefix | undefined;
  readonly eventCallback: (message: CallBackEventMessage<T>) => Promise<EventCallbackResponse>;

  public dispatcherConnectionState = false;
  public baseUUID = randomUUID();

  private prefixedName: string;
  private isDispatcherInstance: boolean;
  private eventsCast: EventCast[];
  private eventsSubscribe: EventSubscribe[];
  private dispatcherChannel: Channel<DispatcherChannelMessages["IncomerMessages"]>;
  private dispatcherChannelName: string;
  private providedUUID: string;
  private logger: PartialLogger;
  private incomerChannelName: string;
  private defaultIncomerTransactionStore: TransactionStore<"incomer">;
  private newTransactionStore: TransactionStore<"incomer">;
  private incomerChannel: Channel<IncomerChannelMessages<T>["IncomerMessages"] | RetryMessage>;
  private publishInterval: number;
  private maxPingInterval: number;
  private standardLogFn: StandardLog<T>;
  private checkRegistrationInterval: NodeJS.Timer;
  private checkTransactionsStateInterval: NodeJS.Timer;
  private checkDispatcherStateTimeout: NodeJS.Timeout;
  private lastPingDate: number;
  private eventsValidationFn: Map<string, ValidateFunction<Record<string, any>> | NestedValidationFunctions>;
  private customValidationCbFn: (event: T) => void;

  public externals: Externals<T> | undefined;

  constructor(options: IncomerOptions<T>) {
    super();

    Object.assign(this, {}, options);

    this.prefixedName = `${this.prefix ? `${this.prefix}-` : ""}`;
    this.dispatcherChannelName = this.prefixedName + DISPATCHER_CHANNEL_NAME;
    this.standardLogFn = options.standardLog ?? defaultStandardLog;
    this.publishInterval = options.dispatcherInactivityOptions?.publishInterval ?? kPublishInterval;
    this.maxPingInterval = options.dispatcherInactivityOptions?.maxPingInterval ?? kMaxPingInterval;
    if (this.isDispatcherInstance === undefined) {
      this.isDispatcherInstance = kIsDispatcherInstance;
    }

    if (options.eventsValidation) {
      this.eventsValidationFn = options.eventsValidation.eventsValidationFn;
      this.customValidationCbFn = options.eventsValidation.customValidationCbFn;
    }

    this.logger = options.logger ?? pino({
      level: kLoggerMode,
      transport: {
        target: "pino-pretty"
      }
    }).child({ incomer: this.prefixedName + this.name });

    this.dispatcherChannel = new Channel({
      name: DISPATCHER_CHANNEL_NAME,
      prefix: this.prefix
    });

    this.defaultIncomerTransactionStore = new TransactionStore({
      prefix: this.prefixedName + this.baseUUID,
      instance: "incomer"
    });

    if (
      (this.prefix === "test") && (kExternalInit === false && (
        options.externalsInitialized === false || options.externalsInitialized === undefined
      ))
    ) {
      this.externals = new Externals(options);
    }
  }

  private async checkDispatcherState() {
    const date = Date.now();

    if ((Number(this.lastPingDate) + Number(this.maxPingInterval)) < date && !this.isDispatcherInstance) {
      this.dispatcherConnectionState = false;

      return;
    }

    this.dispatcherConnectionState = true;

    const store = this.newTransactionStore ?? this.defaultIncomerTransactionStore;

    for await (const transactionKeys of store.transactionLazyFetch()) {
      const transactions = await Promise.all(transactionKeys.map(
        (transactionKey) => store.getValue(transactionKey)
      ));

      await Promise.race([
        Promise.all(transactions.map((transaction) => {
          if (
            transaction.redisMetadata.mainTransaction &&
            !transaction.redisMetadata.published &&
            transaction.aliveSince + this.maxPingInterval < Date.now()
          ) {
            return this.incomerChannel.publish({
              ...transaction,
              redisMetadata: {
                transactionId: transaction.redisMetadata.transactionId,
                origin: transaction.redisMetadata.origin,
                prefix: transaction.redisMetadata.prefix
              }
            } as unknown as IncomerChannelMessages<T>["IncomerMessages"]);
          }

          return void 0;
        })),
        new Promise((_, reject) => timers.setTimeout(this.maxPingInterval).then(() => reject(new Error())))
      ]);
    }
  }

  get redis() {
    return getRedis();
  }

  get subscriber() {
    return getRedis("subscriber");
  }

  private async registrationAttempt() {
    this.logger.info("Registering as a new incomer on dispatcher");

    const event = {
      name: "REGISTER" as const,
      data: {
        name: this.name,
        eventsCast: this.eventsCast,
        eventsSubscribe: this.eventsSubscribe
      },
      redisMetadata: {
        origin: this.baseUUID,
        incomerName: this.name,
        prefix: this.prefix
      }
    };

    const transaction = await this.defaultIncomerTransactionStore.setTransaction({
      ...event,
      redisMetadata: {
        ...event.redisMetadata,
        mainTransaction: true,
        relatedTransaction: null,
        resolved: false
      }
    }) as IncomerMainTransaction["incomerApprovementTransaction"];

    const fullyFormattedEvent: IncomerRegistrationMessage = {
      ...event,
      redisMetadata: {
        ...event.redisMetadata,
        transactionId: transaction.redisMetadata.transactionId,
        eventTransactionId: transaction.redisMetadata.eventTransactionId
      }
    };

    await this.dispatcherChannel.publish(fullyFormattedEvent);

    try {
      await once(this, "registered", {
        signal: AbortSignal.timeout(kDefaultStartTime)
      });

      this.checkTransactionsStateInterval = setInterval(() => {
        if (!this.lastPingDate || this.isDispatcherInstance) {
          return;
        }

        this.checkDispatcherState()
          .catch((error) => this.logger.error({ error: error.stack }, "failed while checking dispatcher state"));
      }, this.maxPingInterval).unref();

      this.dispatcherConnectionState = true;
      this.checkRegistrationInterval = setInterval(() => this.registrationIntervalCb()
        .catch((error) => this.logger.error({ error: error.stack }, "failed while registering")),
      this.publishInterval * 2).unref();
      this.logger.info(`Incomer registered with uuid ${this.providedUUID}`);
    }
    catch {
      this.logger.error("Failed to register in time.");
      this.dispatcherConnectionState = false;

      this.checkRegistrationInterval = setInterval(() => this.registrationIntervalCb()
        .catch((error) => this.logger.error({ error: error.stack }, "failed while registering")),
      this.publishInterval * 2).unref();

      return;
    }
  }

  private async registrationIntervalCb() {
    if (this.dispatcherConnectionState) {
      return;
    }

    if (this.providedUUID) {
      this.subscriber.unsubscribe(`${this.prefix ? `${this.prefix}-` : ""}${this.providedUUID}`);
    }

    const event = {
      name: "REGISTER" as const,
      data: {
        name: this.name,
        providedUUID: this.providedUUID,
        eventsCast: this.eventsCast,
        eventsSubscribe: this.eventsSubscribe
      },
      redisMetadata: {
        origin: this.baseUUID,
        incomerName: this.name,
        prefix: this.prefix
      }
    };

    const transaction = await this.defaultIncomerTransactionStore.setTransaction({
      ...event,
      redisMetadata: {
        ...event.redisMetadata,
        mainTransaction: true,
        relatedTransaction: null,
        resolved: false
      }
    }) as IncomerMainTransaction["incomerApprovementTransaction"];

    const fullyFormattedEvent: IncomerRegistrationMessage = {
      ...event,
      redisMetadata: {
        ...event.redisMetadata,
        transactionId: transaction.redisMetadata.transactionId,
        eventTransactionId: transaction.redisMetadata.eventTransactionId
      }
    };

    await this.dispatcherChannel.publish(fullyFormattedEvent);

    try {
      await once(this, "registered", {
        signal: AbortSignal.timeout(kDefaultStartTime)
      });

      this.checkTransactionsStateInterval = setInterval(() => {
        if (!this.lastPingDate || this.isDispatcherInstance) {
          return;
        }

        this.checkDispatcherState()
          .catch((error) => this.logger.error({ error: error.stack }, "failed while checking dispatcher state"));
      }, this.maxPingInterval).unref();

      this.dispatcherConnectionState = true;
      this.logger.info(`Incomer registered with uuid ${this.providedUUID}`);
    }
    catch {
      this.logger.error("Failed to register in time.");

      this.dispatcherConnectionState = false;

      return;
    }
  }

  public async initialize() {
    if (this.providedUUID) {
      throw new Error("Cannot init multiple times.");
    }

    await this.externals?.initialize();

    await this.subscriber.subscribe(this.dispatcherChannelName);

    this.subscriber.on("message", (channel: string, message: string) => this.handleMessages(channel, message));

    await this.registrationAttempt();
  }

  public async close() {
    await this.externals?.close();

    clearInterval(this.checkTransactionsStateInterval);
    this.checkTransactionsStateInterval = undefined;

    if (this.checkRegistrationInterval) {
      clearInterval(this.checkRegistrationInterval);
      this.checkRegistrationInterval = undefined;
    }

    if (this.checkDispatcherStateTimeout) {
      clearTimeout(this.checkDispatcherStateTimeout);
      this.checkDispatcherStateTimeout = undefined;
    }

    if (this.incomerChannel) {
      await this.incomerChannel.publish({
        name: "CLOSE",
        redisMetadata: {
          origin: this.providedUUID,
          incomerName: this.name,
          prefix: this.prefix
        }
      });
    }
    else {
      const oldTransactions = await this.defaultIncomerTransactionStore.getTransactions();

      await Promise.all(
        [...oldTransactions.entries()]
          .map(([id, transaction]) => {
            if (transaction.name === "REGISTER") {
              return this.defaultIncomerTransactionStore.deleteTransaction(id);
            }

            return void 0;
          })
      );
    }

    await this.subscriber.unsubscribe(this.dispatcherChannelName, this.incomerChannelName);
    this.subscriber.removeAllListeners("message");
  }

  public async publish(
    event: T
  ) {
    const formattedEvent = {
      ...event,
      redisMetadata: {
        origin: this.providedUUID,
        incomerName: this.name,
        prefix: this.prefix
      }
    } as unknown as Omit<EventMessage<T>, "redisMetadata"> & {
      redisMetadata: Omit<EventMessage<T>["redisMetadata"], "transactionId">
    };

    if (this.eventsValidationFn) {
      const eventValidationFn = this.eventsValidationFn.get(event.name);

      if (!eventValidationFn) {
        throw new Error(`Unknown Event ${event.name}`);
      }

      this.customValidationCbFn(event);
    }

    const store = this.newTransactionStore ?? this.defaultIncomerTransactionStore;

    const transaction = await store.setTransaction({
      ...formattedEvent,
      redisMetadata: {
        ...formattedEvent.redisMetadata,
        published: false,
        mainTransaction: true,
        relatedTransaction: null,
        resolved: false
      }
    } as unknown as PartialTransaction<"incomer">);

    const finalEvent = {
      ...formattedEvent,
      redisMetadata: {
        ...formattedEvent.redisMetadata,
        transactionId: (transaction.redisMetadata as any).transactionId
      }
    } as unknown as EventMessage<T>;

    if (!this.dispatcherConnectionState) {
      this.logger.info(this.standardLogFn({
        ...finalEvent, redisMetadata: {
          ...finalEvent.redisMetadata,
          eventTransactionId: finalEvent.redisMetadata.transactionId
        }
      })("Event Stored but not published"));

      return;
    }

    await this.incomerChannel.publish(finalEvent);

    this.logger.info(this.standardLogFn({
      ...finalEvent, redisMetadata: {
        ...finalEvent.redisMetadata,
        eventTransactionId: finalEvent.redisMetadata.transactionId
      }
    })("Published event"));
  }

  private async handleMessages(channel: string, message: string) {
    if (!message) {
      return;
    }

    const formattedMessage: DispatcherChannelMessages["DispatcherMessages"] |
      IncomerChannelMessages<T>["DispatcherMessages"] = JSON.parse(message);

    if (
      (formattedMessage.redisMetadata && formattedMessage.redisMetadata.origin === this.providedUUID) ||
      (formattedMessage.redisMetadata && formattedMessage.redisMetadata.origin === this.baseUUID)
    ) {
      return;
    }

    try {
      if (channel === this.dispatcherChannelName && isDispatcherChannelMessage(formattedMessage)) {
        await this.handleDispatcherMessages(channel, formattedMessage);
      }
      else if (channel === this.incomerChannelName && isIncomerChannelMessage(formattedMessage)) {
        await this.handleIncomerMessages(channel, formattedMessage);
      }
    }
    catch (error) {
      this.logger.error({ channel, message: formattedMessage, error: error.stack });
    }
  }

  private async handleDispatcherMessages(
    channel: string,
    message: DispatcherChannelMessages["DispatcherMessages"]
  ): Promise<void> {
    if (message.redisMetadata.to !== this.providedUUID && message.redisMetadata.to !== this.baseUUID) {
      return;
    }

    const logData = {
      channel,
      ...message
    };

    const { name } = message;

    try {
      match<DispatcherChannelEvents>({ name })
        .with({ name: "APPROVEMENT" }, async() => {
          this.logger.info(logData, "New approvement message on Dispatcher Channel");

          await this.handleApprovement(message as DispatcherApprovementMessage);
        })
        .otherwise(() => {
          throw new Error("Unknown event");
        });
    }
    catch (error) {
      this.logger.error({
        channel: "dispatcher",
        error: error.stack,
        message
      });
    }
  }

  private async handleIncomerMessages(
    channel: string,
    message: IncomerChannelMessages<T>["DispatcherMessages"]
  ): Promise<void> {
    const { name } = message;

    match<IncomerChannelEvents<T>>({ name, message } as IncomerChannelEvents<T>)
      .with({
        name: "PING"
      },
      async(res: { name: "PING", message: DispatcherPingMessage }) => this.handlePing(channel, res.message))
      .with(P._,
        async(res: { name: string, message: DistributedEventMessage<T> }) => this.customEvent({
          ...res, channel
        })
      )
      .exhaustive()
      .catch((error) => {
        this.logger.error({
          channel: "incomer",
          error: error.stack,
          message
        });
      });
  }

  private async handlePing(channel: string, message: DispatcherPingMessage) {
    this.lastPingDate = Date.now();
    this.dispatcherConnectionState = true;

    const logData = {
      channel,
      ...message
    };

    const store = this.newTransactionStore ?? this.defaultIncomerTransactionStore;

    await store.setTransaction({
      ...message,
      redisMetadata: {
        ...message.redisMetadata,
        origin: message.redisMetadata.to,
        incomerName: this.name,
        mainTransaction: false,
        relatedTransaction: message.redisMetadata.transactionId,
        resolved: true
      }
    });

    this.logger.debug(this.standardLogFn(logData as any)("Resolved Ping event"));
  }

  private async customEvent(opts: { name: string, channel: string, message: DistributedEventMessage<T> }) {
    const { message, channel } = opts;
    const { redisMetadata, ...event } = message;
    const { eventTransactionId, iteration } = redisMetadata;

    const logData = {
      channel,
      ...message
    };

    if (this.eventsValidationFn) {
      const eventValidationFn = this.eventsValidationFn.get(event.name);

      if (!eventValidationFn) {
        throw new Error(`Unknown Event ${event.name}`);
      }

      this.customValidationCbFn(event as unknown as T);
    }

    const transaction: PartialTransaction<"incomer"> = {
      ...message,
      redisMetadata: {
        ...redisMetadata,
        incomerName: this.name,
        mainTransaction: false,
        relatedTransaction: redisMetadata.transactionId,
        resolved: false
      }
    };

    const store = this.newTransactionStore ?? this.defaultIncomerTransactionStore;

    const formattedTransaction = await store.setTransaction(transaction);

    const callbackResult = await this.eventCallback({ ...event, eventTransactionId } as unknown as CallBackEventMessage<T>);

    if (callbackResult.ok) {
      if (Symbol.for(callbackResult.val.status) === RESOLVED) {
        await store.updateTransaction(formattedTransaction.redisMetadata.transactionId, {
          ...formattedTransaction,
          redisMetadata: {
            ...formattedTransaction.redisMetadata,
            resolved: true
          }
        } as Transaction<"incomer">);

        this.logger.info(this.standardLogFn(logData)("Resolved Custom event"));

        return;
      }

      if (isUnresolvedEvent(callbackResult)) {
        if (callbackResult.val.retryStrategy) {
          const { maxIteration } = callbackResult.val.retryStrategy;

          if (iteration < maxIteration) {
            await this.incomerChannel.publish({
              name: "RETRY",
              data: {
                dispatcherTransactionId: redisMetadata.transactionId
              },
              redisMetadata: {
                origin: this.providedUUID,
                incomerName: this.name,
                prefix: this.prefix
              }
            });
            // Pubsub to send information to Dispatcher so he can delete artifacts of the old transaction
            // and send back the given event to a different instance of the incomer (if possible)
            // while keeping track on iteration on the event
          }

          await store.updateTransaction(formattedTransaction.redisMetadata.transactionId, {
            ...formattedTransaction,
            redisMetadata: {
              ...formattedTransaction.redisMetadata,
              resolved: true
            }
          } as Transaction<"incomer">);

          this.logger.info(
            this.standardLogFn(logData)(`Callback Resolved but failed for the given reason: ${callbackResult.val.reason}`)
          );

          return;
        }
      }
    }

    this.logger.info(this.standardLogFn(logData)(`Callback error reason: ${String(callbackResult.val)}`));
  }

  private async handleApprovement(message: DispatcherApprovementMessage) {
    const { data } = message;

    this.incomerChannelName = this.prefixedName + data.uuid;

    if (!this.providedUUID) {
      await this.subscriber.subscribe(this.incomerChannelName);
    }

    this.providedUUID = data.uuid;

    this.incomerChannel = new Channel({
      name: this.providedUUID,
      prefix: this.prefix
    });

    const oldTransactions = await this.defaultIncomerTransactionStore.getTransactions();

    this.newTransactionStore = new TransactionStore({
      prefix: this.prefixedName + this.providedUUID,
      instance: "incomer"
    });

    const transactionToUpdate = [];
    for (const [transactionId, transaction] of oldTransactions.entries()) {
      if (transaction.name === "REGISTER") {
        transactionToUpdate.push([
          Promise.all([
            this.defaultIncomerTransactionStore.deleteTransaction(transactionId),
            this.newTransactionStore.setTransaction({
              ...transaction,
              redisMetadata: {
                ...transaction.redisMetadata,
                origin: this.providedUUID,
                relatedTransaction: message.redisMetadata.transactionId,
                published: true,
                resolved: true
              }
            } as Transaction<"incomer">)
          ])
        ]);

        continue;
      }

      transactionToUpdate.push(Promise.all([
        this.defaultIncomerTransactionStore.deleteTransaction(transactionId),
        this.newTransactionStore.setTransaction({
          ...transaction,
          redisMetadata: {
            ...transaction.redisMetadata,
            origin: this.providedUUID
          }
        })
      ]));
    }

    await Promise.all(transactionToUpdate);

    this.lastPingDate = Date.now();
    this.emit("registered");
  }
}
