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
import { ValidateFunction } from "ajv";

// CONSTANTS
const kCancelTimeout = new AbortController();
const kCancelTask = new AbortController();
// Arbitrary value according to fastify default pluginTimeout
const kDefaultStartTime = 8_000;
const kExternalInit = process.env.MYUNISOFT_EVENTS_INIT_EXTERNAL || false;
const kSilentLogger = process.env.MYUNISOFT_EVENTS_SILENT_LOGGER || false;

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
  readonly isDispatcherInstance?: boolean;
  readonly eventCallback: (message: CallBackEventMessage<T>) => void;

  public dispatcherIsAlive = false;
  public baseUUID = randomUUID();

  private prefixedName: string;
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
    this.publishInterval = options.dispatcherInactivityOptions?.publishInterval ?? 60_000;
    this.maxPingInterval = options.dispatcherInactivityOptions?.maxPingInterval ?? 60_000;

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

  private logAbortError() {
    // eslint-disable-next-line no-invalid-this
    this.logger.warn({ error: kCancelTask.signal.reason });
    kCancelTask.signal.removeEventListener("abort", () => this.logAbortError());
  }

  private async checkDispatcherState() {
    if (this.lastPingDate + this.maxPingInterval < Date.now()) {
      this.dispatcherIsAlive = false;

      return;
    }

    this.dispatcherIsAlive = true;

    kCancelTask.signal.addEventListener("abort", () => this.logAbortError(), { once: true });

    await Promise.race([this.updateTransactionsStateTimeout(), this.updateTransactionsState()]);
  }

  get subscriber() {
    return getRedis("subscriber");
  }

  private async registrationAttempt() {
    const event = {
      name: "register" as const,
      data: {
        name: this.name,
        eventsCast: this.eventsCast,
        eventsSubscribe: this.eventsSubscribe
      },
      redisMetadata: {
        origin: this.baseUUID,
        prefix: this.prefix
      }
    };

    this.logger.info("Registering as a new incomer on dispatcher");

    try {
      this.registerTransactionId = await this.incomerTransactionStore.setTransaction({
        ...event,
        redisMetadata: {
          ...event.redisMetadata,
          mainTransaction: true,
          relatedTransaction: null,
          resolved: false
        }
      });

      await this.dispatcherChannel.publish({
        ...event,
        redisMetadata: {
          ...event.redisMetadata,
          transactionId: this.registerTransactionId
        }
      });

      await once(this, "registered", { signal: AbortSignal.timeout(kDefaultStartTime) });
    }
    catch {
      this.checkRegistrationInterval = setInterval(async() => {
        if (this.dispatcherIsAlive) {
          return;
        }

        try {
          await this.dispatcherChannel.publish({
            ...event,
            redisMetadata: {
              ...event.redisMetadata,
              transactionId: this.registerTransactionId
            }
          });

          await once(this, "registered", { signal: AbortSignal.timeout(this.publishInterval) });
        }
        catch (error) {
          this.logger.error("Failed to register in time.");

          this.dispatcherIsAlive = false;

          return;
        }

        clearInterval(this.checkRegistrationInterval);

        this.checkTransactionsStateInterval = setInterval(async() => {
          if (!this.lastPingDate || this.isDispatcherInstance) {
            return;
          }

          await this.checkDispatcherState();
        }, this.maxPingInterval).unref();

        this.dispatcherIsAlive = true;
        this.checkRegistrationInterval = undefined;
        this.logger.info("Incomer registered");
      }, this.publishInterval * 2).unref();

      return;
    }

    this.checkTransactionsStateInterval = setInterval(async() => {
      if (!this.lastPingDate || this.isDispatcherInstance) {
        return;
      }

      await this.checkDispatcherState();
    }, this.maxPingInterval).unref();

    this.dispatcherIsAlive = true;
    this.logger.info("Incomer registered");
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
  }

  public async publish(
    event: T
  ) {
    const formattedEvent: EventMessage<T> = {
      ...event,
      redisMetadata: {
        origin: this.providedUUID,
        prefix: this.prefix
      }
    };

    if (this.eventsValidationFn) {
      const eventValidationFn = this.eventsValidationFn.get(event.name);

      if (!eventValidationFn) {
        throw new Error(`Unknown Event ${event.name}`);
      }

      this.validationCbFn(event);
    }

    const transactionId = await this.incomerTransactionStore.setTransaction({
      ...formattedEvent,
      redisMetadata: {
        ...formattedEvent.redisMetadata,
        published: false,
        mainTransaction: true,
        relatedTransaction: null,
        resolved: false
      }
    });

    const finalEvent = {
      ...formattedEvent,
      redisMetadata: {
        ...formattedEvent.redisMetadata,
        transactionId
      }
    } as IncomerChannelMessages<T>["IncomerMessages"];

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

  private async updateTransactionsStateTimeout() {
    try {
      await timers.setTimeout(this.maxPingInterval, undefined, { signal: kCancelTimeout.signal });
      kCancelTask.abort("Dispatcher state check before publishing more..");
      kCancelTask.signal.removeEventListener("abort", () => this.logAbortError());
    }
    catch {
      // Ignore
    }
  }

  private async updateTransactionsState() {
    try {
      const transactions = await this.incomerTransactionStore.getTransactions();

      for (const [transactionId, transaction] of Object.entries(transactions)) {
        if (!transaction.published) {
          await this.incomerChannel.publish({
            ...transaction,
            redisMetadata: {
              ...transaction.redisMetadata,
              transactionId
            }
          });
        }
      }
    }
    finally {
      kCancelTimeout.abort();
      kCancelTask.signal.removeEventListener("abort", () => this.logAbortError());
    }
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

        if (this.checkDispatcherStateTimeout) {
          clearTimeout(this.checkDispatcherStateTimeout);
          this.checkDispatcherStateTimeout = undefined;
        }
        this.checkDispatcherStateTimeout = setTimeout(async() => {
          await this.checkDispatcherState();
        }, this.maxPingInterval);

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
            mainTransaction: false,
            relatedTransaction: message.redisMetadata.transactionId,
            resolved: true
          }
        });

        this.logger.info(logData, "Resolved Ping event");
      })
      .with(P._, async(res: { name: string, message: DistributedEventMessage<T> }) => {
        const { message } = res;
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


          this.validationCbFn(event as any);
        }

        const transaction: PartialTransaction<"incomer"> = {
          ...message,
          redisMetadata: {
            ...redisMetadata,
            origin: redisMetadata.to,
            mainTransaction: false,
            relatedTransaction: redisMetadata.transactionId,
            resolved: false
          }
        };

        const transactionId = await this.incomerTransactionStore.setTransaction(transaction);
        const formattedTransaction = await this.incomerTransactionStore.getTransactionById(transactionId);

        await Promise.all([
          this.eventCallback({ ...event, eventTransactionId } as unknown as CallBackEventMessage<T>),
          this.incomerTransactionStore.updateTransaction(transactionId, {
            ...formattedTransaction,
            redisMetadata: {
              ...formattedTransaction.redisMetadata,
              resolved: true
            }
          } as Transaction<"incomer">)
        ]);

        this.logger.info(this.standardLogFn(logData)("Resolved Custom event"));
      })
      .exhaustive()
      .catch((error) => {
        this.logger.error({
          channel: "incomer",
          error: error.message,
          message
        });
      });
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

    const registerTransaction = await this.incomerTransactionStore.getTransactionById(this.registerTransactionId);

    await this.incomerTransactionStore.updateTransaction(this.registerTransactionId, {
      ...registerTransaction,
      redisMetadata: {
        ...registerTransaction.redisMetadata,
        relatedTransaction: message.redisMetadata.transactionId,
        resolved: true
      }
    } as Transaction<"incomer">);

    this.incomerTransactionStore = new TransactionStore({
      prefix: this.prefixedName + this.providedUUID,
      instance: "incomer"
    });

    this.lastPingDate = Date.now();
    this.emit("registered");
  }
}
