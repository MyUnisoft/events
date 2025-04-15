/* eslint-disable max-lines */
// Import Node.js Dependencies
import { once, EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import timers from "node:timers/promises";

// Import Third-party Dependencies
import {
  Channel,
  RedisAdapter
} from "@myunisoft/redis";
import { pino, type Logger } from "pino";
import { match } from "ts-pattern";
import type { ValidateFunction } from "ajv";
import type { Result } from "@openally/result";
import { Mutex } from "@openally/mutex";

// Import Internal Dependencies
import {
  type IncomerMainTransaction,
  type PartialTransaction,
  type Transaction,
  TransactionStore
} from "./store/transaction.class.js";
import type {
  EventSubscribe,
  IncomerChannelMessages,
  DispatcherApprovementMessage,
  CallBackEventMessage,
  DispatcherPingMessage,
  DistributedEventMessage,
  EventMessage,
  GenericEvent,
  IncomerRegistrationMessage,
  RetryMessage,
  RegisteredIncomer
} from "../types/index.js";
import {
  type NestedValidationFunctions,
  type StandardLog,
  defaultStandardLog,
  handleLoggerMode
} from "../utils/index.js";
import { Externals } from "./externals.class.js";
import { DISPATCHER_CHANNEL_NAME } from "./dispatcher.class.js";
import { customValidationCbFn, eventsValidationFn } from "./events.class.js";
import { IncomerStore } from "./store/incomer.class.js";

// CONSTANTS
// Arbitrary value according to fastify default pluginTimeout
// Max timeout is 8_000, but u may init both an Dispatcher & an Incomer
const kIdleTime = Number.isNaN(Number(process.env.MYUNISOFT_DISPATCHER_IDLE_TIME)) ? 60_000 * 10 :
  Number(process.env.MYUNISOFT_DISPATCHER_IDLE_TIME);
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

function isDispatcherChannelMessage<T extends GenericEvent = GenericEvent>(value:
  DispatcherApprovementMessage |
  IncomerChannelMessages<T>["DispatcherMessages"]
): value is DispatcherApprovementMessage {
  return value.name === "APPROVEMENT";
}

function isIncomerChannelMessage<T extends GenericEvent = GenericEvent>(value:
  DispatcherApprovementMessage |
  IncomerChannelMessages<T>["DispatcherMessages"]
): value is IncomerChannelMessages<T>["DispatcherMessages"] {
  return value.name !== "APPROVEMENT";
}

export type Resolved = "RESOLVED";
export type Unresolved = "UNRESOLVED";

type DispatcherChannelEvents = { name: "REGISTER" | "APPROVEMENT" | "ABORT_TAKING_LEAD" | "ABORT_TAKING_LEAD_BACK" };

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
  name: string;
  redis: RedisAdapter;
  subscriber: RedisAdapter;
  logger?: Logger;
  standardLog?: StandardLog<T>;
  eventsCast: string[];
  eventsSubscribe: EventSubscribe[];
  eventsValidation?: {
    eventsValidationFn?: eventsValidationFn<T>;
    customValidationCbFn?: customValidationCbFn<T>;
  };
  eventCallback: (message: CallBackEventMessage<T>) => Promise<EventCallbackResponse>;
  dispatcherInactivityOptions?: {
    /* interval between two pings */
    maxPingInterval?: number;
    /* max interval between a new event */
    publishInterval?: number;
    /* Allowed max time of idle time */
    idleTime?: number;
  };
  isDispatcherInstance?: boolean;
  externalsInitialized?: boolean;
};

export class Incomer <
  T extends GenericEvent = GenericEvent
> extends EventEmitter {
  readonly name: string;
  readonly eventCallback: (message: CallBackEventMessage<T>) => Promise<EventCallbackResponse>;

  public dispatcherConnectionState = false;
  public baseUUID = randomUUID();

  private providedUUID: string;
  private incomerChannel: Channel<IncomerChannelMessages<T>["IncomerMessages"] | RetryMessage>;
  private incomerChannelName: string;
  private subscriber: RedisAdapter;
  private defaultIncomerTransactionStore: TransactionStore<"incomer">;
  private incomerStore: IncomerStore;
  private newTransactionStore: TransactionStore<"incomer">;
  private logger: Logger;
  private dispatcherChannelName: string;

  #redis: RedisAdapter;

  #isDispatcherInstance: boolean;
  #eventsCast: string[];
  #eventsSubscribe: EventSubscribe[];
  #publishInterval: number;
  #maxPingInterval: number;

  #standardLogFn: StandardLog<T>;
  #dispatcherChannel: Channel<IncomerRegistrationMessage>;
  #dispatcherTransactionStore: TransactionStore<"dispatcher">;

  #checkRegistrationInterval: NodeJS.Timeout;
  #checkDispatcherStateInterval: NodeJS.Timeout;
  #checkTransactionsStateInterval: NodeJS.Timeout;

  #checkDispatcherStateLock = new Mutex({ concurrency: 1 });

  #lastActivity: number;
  #idleTime: number;
  #eventsValidationFn: Map<string, ValidateFunction<Record<string, any>> | NestedValidationFunctions> | undefined;
  #customValidationCbFn: ((event: T) => void) | undefined;

  public externals: Externals<T> | undefined;

  constructor(options: IncomerOptions<T>) {
    super();

    Object.assign(this, {}, options);


    this.#redis = options.redis;
    this.subscriber = options.subscriber;
    this.#eventsCast = options.eventsCast;
    this.#eventsSubscribe = options.eventsSubscribe;
    this.logger = options.logger;
    this.dispatcherChannelName = DISPATCHER_CHANNEL_NAME;
    this.#standardLogFn = options.standardLog ?? defaultStandardLog;
    this.#idleTime = options.dispatcherInactivityOptions?.idleTime ?? kIdleTime;
    this.#publishInterval = options.dispatcherInactivityOptions?.publishInterval ?? kPublishInterval;
    this.#maxPingInterval = options.dispatcherInactivityOptions?.maxPingInterval ?? kMaxPingInterval;
    if (this.#isDispatcherInstance === undefined) {
      this.#isDispatcherInstance = kIsDispatcherInstance;
    }

    if (options.eventsValidation) {
      this.#eventsValidationFn = options.eventsValidation.eventsValidationFn;
      this.#customValidationCbFn = options.eventsValidation.customValidationCbFn;
    }

    this.logger = options.logger ?? pino({
      level: kLoggerMode,
      transport: {
        target: "pino-pretty"
      }
    }).child({ incomer: this.name });

    this.#dispatcherChannel = new Channel({
      redis: this.#redis,
      name: this.dispatcherChannelName
    });

    this.defaultIncomerTransactionStore = new TransactionStore({
      adapter: this.#redis as RedisAdapter<Transaction<"incomer">>,
      prefix: this.baseUUID,
      instance: "incomer"
    });

    this.incomerStore = new IncomerStore({
      adapter: this.#redis as RedisAdapter<RegisteredIncomer>,
      idleTime: 60_000
    });

    this.#dispatcherTransactionStore = new TransactionStore({
      adapter: this.#redis as RedisAdapter<Transaction<"incomer">>,
      instance: "dispatcher"
    });

    if (
      kExternalInit === false && (
        options.externalsInitialized === false || options.externalsInitialized === undefined
      )
    ) {
      this.externals = new Externals(options);
    }
  }

  private async checkDispatcherState() {
    const date = Date.now();

    if ((Number(this.#lastActivity) + Number(this.#maxPingInterval)) < date && !this.#isDispatcherInstance) {
      this.dispatcherConnectionState = false;

      return;
    }

    this.dispatcherConnectionState = true;
  }

  private async lazyRetryPublish() {
    if (!this.dispatcherConnectionState) {
      return;
    }

    const free = await this.#checkDispatcherStateLock.acquire();

    const store = this.newTransactionStore ?? this.defaultIncomerTransactionStore;

    try {
      for await (const transactionKeys of store.transactionLazyFetch()) {
        const transactions = await Promise.all(transactionKeys.map(
          (transactionKey) => store.getValue(transactionKey)
        ));

        const eventToPublish = transactions.map((transaction) => {
          if (
            transaction.redisMetadata.mainTransaction &&
            !transaction.redisMetadata.published &&
            Number(transaction.aliveSince) + Number(this.#maxPingInterval) < Date.now()
          ) {
            return this.retryPublish(transaction);
          }

          return void 0;
        });

        await Promise.race([
          Promise.all(eventToPublish),
          timers.setTimeout(this.#maxPingInterval)
        ]);
      }
    }
    finally {
      free();
    }
  }

  private async retryPublish(transaction: any) {
    await this.incomerChannel.pub({
      ...transaction,
      redisMetadata: {
        transactionId: transaction.redisMetadata.transactionId,
        origin: transaction.redisMetadata.origin
      }
    } as unknown as IncomerChannelMessages<T>["IncomerMessages"]);

    this.logger.info(
      this.#standardLogFn({
        ...transaction,
        dispatcherConnectionState: this.dispatcherConnectionState
      })("Retried event publish")
    );
  }

  private async registrationAttempt() {
    this.logger.info("Registering as a new incomer on dispatcher");

    const event = {
      name: "REGISTER" as const,
      data: {
        name: this.name,
        eventsCast: this.#eventsCast,
        eventsSubscribe: this.#eventsSubscribe
      },
      redisMetadata: {
        origin: this.baseUUID,
        incomerName: this.name
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

    await this.#dispatcherChannel.pub(fullyFormattedEvent);

    try {
      await once(this, "registered", {
        signal: AbortSignal.timeout(kDefaultStartTime)
      });

      this.#checkDispatcherStateInterval = setInterval(() => {
        if (!this.#lastActivity) {
          return;
        }

        this.checkDispatcherState()
          .catch((error) => this.logger.error({ error: error.stack }, "failed while checking dispatcher state"));
      }, this.#maxPingInterval).unref();

      this.#checkTransactionsStateInterval = setInterval(() => {
        if (!this.#lastActivity) {
          return;
        }

        this.lazyRetryPublish()
          .catch((error) => this.logger.error({ error: error.stack }, "failed while retry publishing"));
      }, this.#publishInterval).unref();

      this.dispatcherConnectionState = true;
      this.logger.info(`Incomer registered with uuid ${this.providedUUID}`);
    }
    catch (error) {
      this.logger.error({ error }, "Failed to register in time");
      this.dispatcherConnectionState = false;
    }
    finally {
      this.#checkRegistrationInterval = setInterval(() => this.registrationIntervalCb()
        .catch((error) => this.logger.error({ error: error.stack }, "failed while registering")),
      this.#idleTime).unref();
    }
  }

  private async registrationIntervalCb() {
    if (this.dispatcherConnectionState) {
      return;
    }

    const event = {
      name: "REGISTER" as const,
      data: {
        name: this.name,
        providedUUID: this.providedUUID,
        eventsCast: this.#eventsCast,
        eventsSubscribe: this.#eventsSubscribe
      },
      redisMetadata: {
        origin: this.baseUUID,
        incomerName: this.name
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

    await this.#dispatcherChannel.pub(fullyFormattedEvent);

    try {
      await once(this, "registered", {
        signal: AbortSignal.timeout(kDefaultStartTime)
      });

      this.#checkDispatcherStateInterval = setInterval(() => {
        if (!this.#lastActivity) {
          return;
        }

        this.checkDispatcherState()
          .catch((error) => this.logger.error({ error: error.stack }, "failed while checking dispatcher state"));
      }, this.#maxPingInterval).unref();

      this.#checkTransactionsStateInterval = setInterval(() => {
        if (!this.#lastActivity) {
          return;
        }

        this.lazyRetryPublish()
          .catch((error) => this.logger.error({ error: error.stack }, "failed while retry publishing"));
      }, this.#publishInterval).unref();

      this.dispatcherConnectionState = true;

      this.logger.info(`Incomer registered with uuid ${this.providedUUID}`);
    }
    catch (error) {
      this.logger.error({ error }, "Failed to register in time");

      this.dispatcherConnectionState = false;

      return;
    }
  }

  public async initialize() {
    try {
      if (this.providedUUID) {
        throw new Error("Cannot init multiple times");
      }

      if (!this.subscriber) {
        throw new Error(`redis subscriber not available`);
      }

      await this.externals?.initialize();
      await this.subscriber.subscribe(this.dispatcherChannelName);

      this.subscriber.on(
        "message",
        (channel: string, message: string) => this.handleMessages(channel, message)
          .catch((error) => this.logger.error({ error }, "Failed at resolving message"))
      );

      await this.incomerStore.setIncomer({
        baseUUID: this.baseUUID,
        name: this.name,
        isDispatcherActiveInstance: this.#isDispatcherInstance,
        lastActivity: Date.now(),
        aliveSince: Date.now(),
        eventsCast: this.#eventsCast,
        eventsSubscribe: this.#eventsSubscribe
      }, this.baseUUID);

      await this.registrationAttempt();
    }
    catch (error) {
      this.logger.error({ error }, "Failed to initialize Incomer");

      throw error;
    }
  }

  public async close() {
    try {
      if (this.#checkDispatcherStateInterval) {
        clearInterval(this.#checkDispatcherStateInterval);
        this.#checkDispatcherStateInterval = undefined;
      }

      if (this.#checkRegistrationInterval) {
        clearInterval(this.#checkRegistrationInterval);
        this.#checkRegistrationInterval = undefined;
      }

      if (this.#checkTransactionsStateInterval) {
        clearInterval(this.#checkTransactionsStateInterval);
        this.#checkTransactionsStateInterval = undefined;
      }

      this.#checkDispatcherStateLock.reset();

      await this.externals?.close();

      await this.subscriber.unsubscribe(this.dispatcherChannelName, this.incomerChannelName);
      this.subscriber.removeAllListeners("message");

      await this.cleanupTransactions();

      this.logger.info("Incomer closed successfully");
    }
    catch (error) {
      this.logger.error({ error }, "Failed to close Incomer");

      throw error;
    }
  }

  private async cleanupTransactions() {
    if (this.incomerChannel) {
      await this.incomerChannel.pub({
        name: "CLOSE",
        redisMetadata: {
          origin: this.providedUUID,
          incomerName: this.name
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
  }

  public async publish(
    event: T
  ) {
    const formattedEvent = {
      ...event,
      redisMetadata: {
        origin: this.providedUUID,
        incomerName: this.name
      }
    } as unknown as Omit<EventMessage<T>, "redisMetadata"> & {
      redisMetadata: Omit<EventMessage<T>["redisMetadata"], "transactionId">
    };

    if (this.#eventsValidationFn) {
      const eventValidationFn = this.#eventsValidationFn.get(event.name);

      if (!eventValidationFn) {
        throw new Error(`Unknown Event ${event.name}`);
      }

      this.#customValidationCbFn(event);
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
      this.logger.info(this.#standardLogFn({
        ...finalEvent, redisMetadata: {
          ...finalEvent.redisMetadata,
          eventTransactionId: finalEvent.redisMetadata.transactionId
        },
        dispatcherConnectionState: this.dispatcherConnectionState
      })("Event Stored but not published"));

      return;
    }

    await this.incomerChannel.pub(finalEvent);

    this.logger.info(this.#standardLogFn({
      ...finalEvent, redisMetadata: {
        ...finalEvent.redisMetadata,
        eventTransactionId: finalEvent.redisMetadata.transactionId
      },
      dispatcherConnectionState: this.dispatcherConnectionState
    })("Published event"));
  }

  private async handleMessages(
    channel: string,
    message: string
  ) {
    if (!message) {
      return;
    }

    const formattedMessage: DispatcherApprovementMessage |
      IncomerChannelMessages<T>["DispatcherMessages"] = JSON.parse(message);

    if (
      (formattedMessage.redisMetadata && formattedMessage.redisMetadata.origin === this.providedUUID) ||
      (formattedMessage.redisMetadata && formattedMessage.redisMetadata.origin === this.baseUUID)
    ) {
      return;
    }

    this.#lastActivity = Date.now();
    this.dispatcherConnectionState = true;

    try {
      if (channel === this.dispatcherChannelName && isDispatcherChannelMessage(formattedMessage)) {
        await this.handleDispatcherMessages(channel, formattedMessage);
      }
      else if (channel === this.incomerChannelName && isIncomerChannelMessage(formattedMessage)) {
        await this.handleIncomerMessages(channel, formattedMessage);
      }
    }
    catch (error: any) {
      this.logger.error({ channel, message: formattedMessage, error: error.stack });
    }
  }

  private async handleDispatcherMessages(
    channel: string,
    message: DispatcherApprovementMessage
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
          this.logger.info(
            this.#standardLogFn({
              ...logData,
              dispatcherConnectionState: this.dispatcherConnectionState
            } as any)("New approvement message on Dispatcher Channel")
          );

          await this.handleApprovement(message as DispatcherApprovementMessage);
        })
        .otherwise(() => {
          throw new Error("Unknown event");
        });
    }
    catch (error: any) {
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

    if (name === "PING") {
      await this.handlePing(channel, message as DispatcherPingMessage);

      return;
    }

    await this.customEvent({ name, channel, message: message as DistributedEventMessage<T> });
  }

  private async handlePing(channel: string, message: DispatcherPingMessage) {
    const { redisMetadata } = message;
    const { transactionId } = redisMetadata;

    const logData = {
      channel,
      ...message
    };

    const pingTransaction = await this.#dispatcherTransactionStore.getTransactionById(transactionId);

    if (pingTransaction === null) {
      throw new Error("Unable to find the ping transaction");
    }

    await this.#dispatcherTransactionStore.updateTransaction(transactionId, {
      ...message,
      redisMetadata: {
        ...message.redisMetadata,
        resolved: true
      }
    } as Transaction<"dispatcher">);

    this.logger.debug(
      this.#standardLogFn({ ...logData, dispatcherConnectionState: this.dispatcherConnectionState } as any)("Resolved Ping event")
    );
  }

  private async customEvent(
    options: { name: string, channel: string, message: DistributedEventMessage<T> }
  ) {
    const { message, channel } = options;
    const { redisMetadata, ...event } = message;
    const { eventTransactionId, iteration, transactionId } = redisMetadata;

    const logData = {
      channel,
      ...message,
      dispatcherConnectionState: this.dispatcherConnectionState
    };

    if (this.#eventsValidationFn) {
      const eventValidationFn = this.#eventsValidationFn.get(event.name);

      if (!eventValidationFn) {
        throw new Error(`Unknown Event ${event.name}`);
      }

      this.#customValidationCbFn(event as unknown as T);
    }

    const spreadTransaction = await this.#dispatcherTransactionStore.getTransactionById(transactionId);

    if (spreadTransaction === null) {
      throw new Error(`Unable to find the given spread transaction ${transactionId}`);
    }

    const callbackResult = await this.eventCallback({ ...event, eventTransactionId } as unknown as CallBackEventMessage<T>);

    if (callbackResult && callbackResult.ok) {
      const resolvedCallbackResult = callbackResult.unwrap();
      if (Symbol.for(resolvedCallbackResult.status) === RESOLVED) {
        await this.#dispatcherTransactionStore.updateTransaction(spreadTransaction.redisMetadata.transactionId, {
          ...spreadTransaction,
          redisMetadata: {
            ...spreadTransaction.redisMetadata,
            resolved: true
          }
        } as Transaction<"dispatcher">);

        this.logger.info(this.#standardLogFn({
          ...logData,
          dispatcherConnectionState: this.dispatcherConnectionState
        })("Resolved Custom event"));

        return;
      }

      if (isUnresolvedEvent(callbackResult)) {
        const unresolvedCallbackResult = callbackResult.unwrap();
        if (unresolvedCallbackResult.retryStrategy) {
          const { maxIteration } = unresolvedCallbackResult.retryStrategy;

          if (iteration < maxIteration) {
            await this.incomerChannel.pub({
              name: "RETRY",
              data: {
                dispatcherTransactionId: redisMetadata.transactionId
              },
              redisMetadata: {
                origin: this.providedUUID,
                incomerName: this.name
              }
            });

            this.logger.info(
              this.#standardLogFn({
                ...logData,
                dispatcherConnectionState: this.dispatcherConnectionState
              } as any)(`Callback Resolved but retry for the given reason: ${unresolvedCallbackResult.reason}`)
            );

            return;
          }

          await this.#dispatcherTransactionStore.updateTransaction(spreadTransaction.redisMetadata.transactionId, {
            ...spreadTransaction,
            redisMetadata: {
              ...spreadTransaction.redisMetadata,
              resolved: true
            }
          } as Transaction<"dispatcher">);

          this.logger.info(
            this.#standardLogFn({
              ...logData,
              dispatcherConnectionState: this.dispatcherConnectionState
            })(`Callback Resolved but failed for the given reason: ${unresolvedCallbackResult.reason}`)
          );

          return;
        }
      }
    }

    await this.#dispatcherTransactionStore.updateTransaction(spreadTransaction.redisMetadata.transactionId, {
      ...spreadTransaction,
      redisMetadata: {
        ...spreadTransaction.redisMetadata,
        resolved: true
      }
    } as Transaction<"dispatcher">);

    this.logger.info(this.#standardLogFn({
      ...logData,
      dispatcherConnectionState: this.dispatcherConnectionState
    })(`Callback error reason: ${String(callbackResult.val)}`));
  }

  private async handleApprovement(
    message: DispatcherApprovementMessage
  ) {
    const { data } = message;

    this.incomerChannelName = data.uuid;

    if (!this.providedUUID) {
      await this.subscriber.subscribe(this.incomerChannelName);
    }

    this.providedUUID = data.uuid;

    this.incomerChannel = new Channel({
      redis: this.#redis,
      name: this.providedUUID
    });

    const oldTransactions = await this.defaultIncomerTransactionStore.getTransactions();

    this.newTransactionStore = new TransactionStore({
      adapter: this.#redis as RedisAdapter<Transaction<"incomer">>,
      prefix: this.providedUUID,
      instance: "incomer"
    });

    const transactionToUpdate: Promise<any>[] = [];
    for (const [transactionId, transaction] of oldTransactions.entries()) {
      if (transaction.name === "REGISTER") {
        transactionToUpdate.push(
          this.defaultIncomerTransactionStore.deleteTransaction(transactionId),
          this.#dispatcherTransactionStore.deleteTransaction(message.redisMetadata.transactionId)
        );

        continue;
      }

      transactionToUpdate.push(...[
        this.defaultIncomerTransactionStore.deleteTransaction(transactionId),
        this.newTransactionStore.setTransaction({
          ...transaction,
          redisMetadata: {
            ...transaction.redisMetadata,
            origin: this.providedUUID
          }
        })
      ]);
    }

    await Promise.all(transactionToUpdate);

    this.emit("registered");
  }
}
