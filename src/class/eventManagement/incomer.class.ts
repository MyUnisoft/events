// Import Node.js Dependencies
import { once, EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import timers from "node:timers/promises";

// Import Third-party Dependencies
import {
  getRedis,
  Channel
} from "@myunisoft/redis";
import { Logger, pino } from "pino";
import { P, match } from "ts-pattern";
import { ValidateFunction } from "ajv";

// Import Internal Dependencies
import {
  channels
} from "../../utils/config";
import {
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
  DispatcherRegistrationMessage,
  CallBackEventMessage,
  DispatcherPingMessage,
  DistributedEventMessage,
  EventMessage,
  GenericEvent
} from "../../types/eventManagement/index";
import {
  CustomEventsValidationFunctions,
  StandardLog,
  defaultStandardLog
} from "../../utils/index";
import { Externals } from "./externals.class";

// CONSTANTS
// Arbitrary value according to fastify default pluginTimeout
// Max timeout is 8_000, but u may init both an Dispatcher & an Incomer
const kDefaultStartTime = Number(process.env.MYUNISOFT_INCOMER_INIT_TIMEOUT ?? 3_500);
const kExternalInit = (process.env.MYUNISOFT_EVENTS_INIT_EXTERNAL ?? "false") === "true";
const kSilentLogger = (process.env.MYUNISOFT_EVENTS_SILENT_LOGGER ?? "false") === "true";
const kMaxPingInterval = Number(process.env.MYUNISOFT_INCOMER_MAX_PING_INTERVAL ?? 60_000);
const kPublishInterval = Number(process.env.MYUNISOFT_INCOMER_PUBLISH_INTERVAL ?? 60_000);
const kIsDispatcherInstance = (process.env.MYUNISOFT_INCOMER_IS_DISPATCHER ?? "false") === "true";

type DispatcherChannelEvents = { name: "approvement" };
type IncomerChannelEvents<
  T extends GenericEvent = GenericEvent
> = { name: "ping"; message: DispatcherPingMessage } | { name: string; message: DistributedEventMessage<T> };

function isDispatcherChannelMessage<T extends GenericEvent = GenericEvent>(value:
  DispatcherChannelMessages["DispatcherMessages"] |
  IncomerChannelMessages<T>["DispatcherMessages"]
): value is DispatcherChannelMessages["DispatcherMessages"] {
  return value.name === "approvement";
}

function isIncomerChannelMessage<T extends GenericEvent = GenericEvent>(value:
  DispatcherChannelMessages["DispatcherMessages"] |
  IncomerChannelMessages<T>["DispatcherMessages"]
): value is IncomerChannelMessages<T>["DispatcherMessages"] {
  return value.name !== "approvement";
}

export type IncomerOptions<T extends GenericEvent = GenericEvent> = {
  /* Service name */
  name: string;
  prefix?: Prefix;
  logger?: Partial<Logger> & Pick<Logger, "info" | "warn">;
  standardLog?: StandardLog<T>;
  eventsCast: EventCast[];
  eventsSubscribe: EventSubscribe[];
  eventsValidation?: {
    eventsValidationFn: Map<string, ValidateFunction<Record<string, any>> | CustomEventsValidationFunctions>
    validationCbFn: (event: T) => void;
  };
  eventCallback: (message: CallBackEventMessage<T>) => void;
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
  readonly eventCallback: (message: CallBackEventMessage<T>) => void;

  public dispatcherIsAlive = false;
  public baseUUID = randomUUID();

  private prefixedName: string;
  private isDispatcherInstance: boolean;
  private registerTransactionId: string | null;
  private eventsCast: EventCast[];
  private eventsSubscribe: EventSubscribe[];
  private dispatcherChannel: Channel<DispatcherChannelMessages["IncomerMessages"]>;
  private dispatcherChannelName: string;
  private providedUUID: string;
  private logger: Partial<Logger> & Pick<Logger, "info" | "warn">;
  private incomerChannelName: string;
  private incomerTransactionStore: TransactionStore<"incomer">;
  private incomerChannel: Channel<IncomerChannelMessages<T>["IncomerMessages"]>;
  private publishInterval: number;
  private maxPingInterval: number;
  private standardLogFn: StandardLog<T>;
  private checkRegistrationInterval: NodeJS.Timer;
  private checkTransactionsStateInterval: NodeJS.Timer;
  private checkDispatcherStateTimeout: NodeJS.Timeout;
  private lastPingDate: number;
  private eventsValidationFn: Map<string, ValidateFunction<Record<string, any>> | CustomEventsValidationFunctions>;
  private validationCbFn: (event: T) => void;

  public externals: Externals<T> | undefined;

  constructor(options: IncomerOptions<T>) {
    super();

    Object.assign(this, {}, options);

    this.prefixedName = `${this.prefix ? `${this.prefix}-` : ""}`;
    this.dispatcherChannelName = this.prefixedName + channels.dispatcher;
    this.standardLogFn = options.standardLog ?? defaultStandardLog;
    this.publishInterval = options.dispatcherInactivityOptions?.publishInterval ?? kPublishInterval;
    this.maxPingInterval = options.dispatcherInactivityOptions?.maxPingInterval ?? kMaxPingInterval;
    if (this.isDispatcherInstance === undefined) {
      this.isDispatcherInstance = kIsDispatcherInstance;
    }

    if (options.eventsValidation) {
      this.eventsValidationFn = options.eventsValidation.eventsValidationFn;
      this.validationCbFn = options.eventsValidation.validationCbFn;
    }

    this.logger = options.logger ?? pino({
      level: kSilentLogger ? "silent" : "info",
      transport: {
        target: "pino-pretty"
      }
    }).child({ incomer: this.prefixedName + this.name });

    this.dispatcherChannel = new Channel({
      name: channels.dispatcher,
      prefix: this.prefix
    });

    this.incomerTransactionStore = new TransactionStore({
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
    if (this.lastPingDate + this.maxPingInterval < Date.now()) {
      this.dispatcherIsAlive = false;

      return;
    }

    this.dispatcherIsAlive = true;

    try {
      for await (const transactionKeys of this.incomerTransactionStore.transactionLazyFetch()) {
        const transactions = await Promise.all(transactionKeys.map(
          (transactionKey) => this.incomerTransactionStore.getValue(transactionKey)
        ));

        await Promise.race([
          transactions.map((transaction) => {
            if (transaction.redisMetadata.mainTransaction && !transaction.redisMetadata.published) {
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
          }),
          new Promise((_, reject) => timers.setTimeout(this.maxPingInterval).then(() => reject(new Error())))
        ]);
      }
    }
    catch {
      this.logger.warn("Failed while trying to publish events a new time");
    }
  }

  get subscriber() {
    return getRedis("subscriber");
  }

  private async registrationAttempt() {
    this.logger.info("Registering as a new incomer on dispatcher");

    const event = {
      name: "register" as const,
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

    const transaction = await this.incomerTransactionStore.setTransaction({
      ...event,
      redisMetadata: {
        ...event.redisMetadata,
        mainTransaction: true,
        relatedTransaction: null,
        resolved: false
      }
    });

    this.registerTransactionId = transaction.redisMetadata.transactionId;

    await this.dispatcherChannel.publish({
      ...event,
      redisMetadata: {
        ...event.redisMetadata,
        transactionId: this.registerTransactionId
      }
    });

    try {
      await Promise.race([
        once(this, "registered"),
        new Promise((_, reject) => timers.setTimeout(kDefaultStartTime).then(() => reject(new Error())))
      ]);

      this.checkTransactionsStateInterval = setInterval(async() => {
        if (!this.lastPingDate || this.isDispatcherInstance) {
          return;
        }

        await this.checkDispatcherState();
      }, this.maxPingInterval).unref();

      this.dispatcherIsAlive = true;
      this.logger.info(`Incomer registered with uuid ${this.providedUUID}`);
    }
    catch {
      this.logger.error("Failed to register in time.");
      this.dispatcherIsAlive = false;

      this.checkRegistrationInterval = setInterval(async() => {
        if (this.dispatcherIsAlive) {
          return;
        }

        await this.dispatcherChannel.publish({
          ...event,
          redisMetadata: {
            ...event.redisMetadata,
            transactionId: this.registerTransactionId
          }
        });

        try {
          await Promise.race([
            once(this, "registered"),
            new Promise((_, reject) => timers.setTimeout(kDefaultStartTime).then(() => reject(new Error())))
          ]);

          clearInterval(this.checkRegistrationInterval);

          this.checkTransactionsStateInterval = setInterval(async() => {
            if (!this.lastPingDate || this.isDispatcherInstance) {
              return;
            }

            await this.checkDispatcherState();
          }, this.maxPingInterval).unref();

          this.dispatcherIsAlive = true;
          this.checkRegistrationInterval = undefined;
          this.logger.info(`Incomer registered with uuid ${this.providedUUID}`);
        }
        catch {
          this.logger.error("Failed to register in time.");

          this.dispatcherIsAlive = false;

          return;
        }
      }, this.publishInterval * 2).unref();

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
        name: "close",
        redisMetadata: {
          origin: this.providedUUID,
          incomerName: this.name,
          prefix: this.prefix
        }
      });
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

      this.validationCbFn(event);
    }

    const transaction = await this.incomerTransactionStore.setTransaction({
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
        transactionId: transaction.redisMetadata.transactionId
      }
    } as unknown as EventMessage<T>;

    if (!this.dispatcherIsAlive) {
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
      this.logger.error({ channel, message: formattedMessage, error: error.message });
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

    match<DispatcherChannelEvents>({ name })
      .with({ name: "approvement" }, async() => {
        this.logger.info(logData, "New approvement message on Dispatcher Channel");

        await this.handleApprovement(message);
      })
      .exhaustive()
      .catch((error) => {
        this.logger.error({
          channel: "dispatcher",
          error: error.message,
          message
        });
      });
  }

  private async handleIncomerMessages(
    channel: string,
    message: IncomerChannelMessages<T>["DispatcherMessages"]
  ): Promise<void> {
    const { name } = message;

    match<IncomerChannelEvents<T>>({ name, message } as IncomerChannelEvents<T>)
      .with({ name: "ping" }, async(res: { name: "ping", message: DispatcherPingMessage }) => {
        this.lastPingDate = Date.now();
        this.dispatcherIsAlive = true;

        const { message } = res;

        const logData = {
          channel,
          ...message
        };

        await this.incomerTransactionStore.setTransaction({
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
      })
      .with(P._, async(res: { name: string, message: DistributedEventMessage<T> }) => this.customEvent({
        ...res, channel
      }))
      .exhaustive()
      .catch((error) => {
        this.logger.error({
          channel: "incomer",
          error: error.message,
          message
        });
      });
  }

  private async customEvent(opts: { name: string, channel: string, message: DistributedEventMessage<T> }) {
    const { message, channel } = opts;
    const { redisMetadata, ...event } = message;
    const { eventTransactionId } = redisMetadata;

    const logData = {
      channel,
      ...message
    };

    if (this.eventsValidationFn) {
      const eventValidationFn = this.eventsValidationFn.get(event.name);

      if (!eventValidationFn) {
        throw new Error(`Unknown Event ${event.name}`);
      }

      this.validationCbFn(event as unknown as T);
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

    const formattedTransaction = await this.incomerTransactionStore.setTransaction(transaction);

    await Promise.all([
      this.eventCallback({ ...event, eventTransactionId } as unknown as CallBackEventMessage<T>),
      this.incomerTransactionStore.updateTransaction(formattedTransaction.redisMetadata.transactionId, {
        ...formattedTransaction,
        redisMetadata: {
          ...formattedTransaction.redisMetadata,
          resolved: true
        }
      } as Transaction<"incomer">)
    ]);

    this.logger.info(this.standardLogFn(logData)("Resolved Custom event"));
  }

  private async handleApprovement(message: DispatcherRegistrationMessage) {
    const { data } = message;

    this.incomerChannelName = this.prefixedName + data.uuid;
    this.providedUUID = data.uuid;

    await this.subscriber.subscribe(this.incomerChannelName);

    this.incomerChannel = new Channel({
      name: this.providedUUID,
      prefix: this.prefix
    });

    const oldTransactions = await this.incomerTransactionStore.getTransactions();

    const newTransactionStore = new TransactionStore({
      prefix: this.prefixedName + this.providedUUID,
      instance: "incomer"
    });

    const transactionToUpdate = [];
    for (const [transactionId, transaction] of oldTransactions.entries()) {
      if (transaction.name === "register") {
        transactionToUpdate.push([
          Promise.all([
            this.incomerTransactionStore.deleteTransaction(transactionId),
            newTransactionStore.setTransaction({
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
        this.incomerTransactionStore.deleteTransaction(transactionId),
        newTransactionStore.setTransaction({
          ...transaction,
          redisMetadata: {
            ...transaction.redisMetadata,
            origin: this.providedUUID
          }
        })
      ]));
    }

    await Promise.all(transactionToUpdate);

    this.incomerTransactionStore = newTransactionStore;

    this.lastPingDate = Date.now();
    this.emit("registered");
  }
}
