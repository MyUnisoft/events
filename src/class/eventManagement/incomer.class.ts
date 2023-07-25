// Import Node.js Dependencies
import { once, EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

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
} from "./transaction.class";
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
import { StandardLog, defaultStandardLog } from "../../utils/index";
import { Externals } from "./externals.class";
import { PING_INTERVAL } from "./dispatcher.class";

// CONSTANTS
const kCancelTimeout = new AbortController();
const kCancelTask = new AbortController();

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
  logger?: Partial<Logger> & Pick<Logger, "info" | "warn">;
  standardLog?: StandardLog<T>;
  eventsCast: EventCast[];
  eventsSubscribe: EventSubscribe[];
  eventCallback: (message: CallBackEventMessage<T>) => void;
  prefix?: Prefix;
  abortPublishTime?: number;
  externalsInitialized?: boolean;
};

export class Incomer <
  T extends GenericEvent = GenericEvent
> extends EventEmitter {
  readonly name: string;
  readonly prefix: Prefix | undefined;
  readonly eventCallback: (message: CallBackEventMessage<T>) => void;

  private prefixedName: string;
  private registerTransactionId: string | null;
  private eventsCast: EventCast[];
  private eventsSubscribe: EventSubscribe[];
  private dispatcherChannel: Channel<DispatcherChannelMessages["IncomerMessages"]>;
  private dispatcherChannelName: string;
  private baseUUID = randomUUID();
  private providedUUID: string;
  private logger: Partial<Logger> & Pick<Logger, "info" | "warn">;
  private incomerChannelName: string;
  private incomerTransactionStore: TransactionStore<"incomer">;
  private incomerChannel: Channel<IncomerChannelMessages<T>["IncomerMessages"]>;
  private abortPublishTime = 60_000;
  private standardLogFn: StandardLog<T>;
  private checkRegistrationInterval: NodeJS.Timer;
  private checkTransactionsStateInterval: NodeJS.Timer;
  private dispatcherIsAlive = false;
  private lastPingDate: number;

  public externals: Externals<T> | undefined;

  constructor(options: IncomerOptions<T>) {
    super();

    Object.assign(this, {}, options);

    this.prefixedName = `${this.prefix ? `${this.prefix}-` : ""}`;
    this.dispatcherChannelName = this.prefixedName + channels.dispatcher;
    this.standardLogFn = options.standardLog ?? defaultStandardLog;

    this.logger = options.logger ?? pino({
      level: "info",
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
      (this.prefix === "test" || this.prefix === "development") && options.externalsInitialized === false
    ) {
      this.externals = new Externals(options);
    }

    this.checkTransactionsStateInterval = setInterval(async() => {
      if (!this.dispatcherIsAlive) {
        return;
      }
      else if (this.lastPingDate + (PING_INTERVAL + this.abortPublishTime) < Date.now()) {
        this.dispatcherIsAlive = false;

        return;
      }

      this.dispatcherIsAlive = true;

      try {
        await Promise.race([this.updateTransactionsStateTimeout(), this.updateTransactionsState()]);
      }
      catch (error) {
        this.logger.error(error);
      }
    }, this.abortPublishTime).unref();
  }

  get subscriber() {
    return getRedis("subscriber");
  }

  public async initialize() {
    if (this.providedUUID) {
      throw new Error("Cannot init multiple times.");
    }

    await this.externals?.initialize();

    await this.subscriber.subscribe(this.dispatcherChannelName);

    this.subscriber.on("message", (channel: string, message: string) => this.handleMessages(channel, message));

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

    this.registerTransactionId = await this.incomerTransactionStore.setTransaction({
      ...event,
      mainTransaction: true,
      relatedTransaction: null,
      resolved: false
    });

    await this.dispatcherChannel.publish({
      ...event,
      redisMetadata: {
        ...event.redisMetadata,
        transactionId: this.registerTransactionId
      }
    });

    this.logger.info("Registering as a new incomer on dispatcher");

    try {
      await once(this, "registered", { signal: AbortSignal.timeout(this.abortPublishTime) });
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

          await once(this, "registered", { signal: AbortSignal.timeout(this.abortPublishTime) });
        }
        catch (error) {
          this.logger.error(error);

          this.dispatcherIsAlive = false;

          return;
        }

        this.dispatcherIsAlive = true;

        clearInterval(this.checkRegistrationInterval);
        this.checkRegistrationInterval = undefined;
      }, this.abortPublishTime * 2).unref();

      return;
    }

    this.dispatcherIsAlive = true;
    this.logger.info("Incomer registered");
  }

  public async close() {
    await this.externals?.close();

    clearInterval(this.checkTransactionsStateInterval);
    this.checkTransactionsStateInterval = undefined;

    if (this.checkRegistrationInterval) {
      clearInterval(this.checkRegistrationInterval);
      this.checkRegistrationInterval = undefined;
    }
  }

  public async publish<
    K extends GenericEvent | null = null
  >(
    event: K extends null ? Omit<EventMessage<T>, "redisMetadata"> :
    Omit<EventMessage<K>, "redisMetadata">
  ) {
    const formattedEvent = {
      ...event,
      redisMetadata: {
        origin: this.providedUUID,
        prefix: this.prefix
      }
    } as (K extends null ? EventMessage<T> : EventMessage<K>);

    const transactionId = await this.incomerTransactionStore.setTransaction({
      ...formattedEvent,
      published: this.dispatcherIsAlive,
      mainTransaction: true,
      relatedTransaction: null,
      resolved: false
    });

    const finalEvent = {
      ...formattedEvent,
      redisMetadata: {
        ...formattedEvent.redisMetadata,
        transactionId
      }
    } as IncomerChannelMessages<T>["IncomerMessages"];

    if (!this.dispatcherIsAlive) {
      this.logger.info(this.standardLogFn(finalEvent)("Event Stored but not published"));

      return;
    }

    await this.incomerChannel.publish(finalEvent);

    this.logger.info(this.standardLogFn(finalEvent)("Published event"));
  }

  private async updateTransactionsStateTimeout() {
    try {
      await setTimeout(this.abortPublishTime, undefined, { signal: kCancelTimeout.signal });
      kCancelTask.abort();
    }
    catch {
      // Ignore
    }
  }

  private async updateTransactionsState() {
    try {
      const transactions = await this.incomerTransactionStore.getTransactions();

      const toResolve: Promise<any>[] = [];
      for (const [transactionId, transaction] of Object.entries(transactions)) {
        if (!transaction.published) {
          toResolve.push(
            Promise.all([
              this.incomerChannel.publish({
                ...transaction,
                redisMetadata: {
                  ...transaction.redisMetadata,
                  transactionId
                }
              }),
              this.incomerTransactionStore.updateTransaction(transactionId, { ...transaction, published: true })
            ])
          );
        }
      }

      await Promise.all(toResolve);
    }
    finally {
      kCancelTimeout.abort();
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
        const { message } = res;

        const logData = {
          channel,
          ...message
        };

        await this.incomerTransactionStore.setTransaction({
          ...message,
          redisMetadata: {
            ...message.redisMetadata,
            origin: message.redisMetadata.to
          },
          mainTransaction: false,
          relatedTransaction: message.redisMetadata.transactionId,
          resolved: true
        });

        this.lastPingDate = Date.now();
        this.dispatcherIsAlive = true;

        this.logger.info(logData, "Resolved Ping event");
      })
      .with(P._, async(res: { name: string, message: DistributedEventMessage<T> }) => {
        const { message } = res;
        const { redisMetadata, ...event } = message;

        const logData = {
          channel,
          ...message
        };

        const transaction: PartialTransaction<"incomer"> = {
          ...message,
          redisMetadata: {
            ...redisMetadata,
            origin: redisMetadata.to
          },
          mainTransaction: false,
          relatedTransaction: redisMetadata.transactionId,
          resolved: false
        };

        const transactionId = await this.incomerTransactionStore.setTransaction(transaction);
        const formattedTransaction = await this.incomerTransactionStore.getTransactionById(transactionId);

        formattedTransaction.resolved = true;
        await Promise.all([
          this.eventCallback(event as unknown as CallBackEventMessage<T>),
          this.incomerTransactionStore.updateTransaction(transactionId, formattedTransaction as Transaction<"incomer">)
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
      resolved: true
    } as Transaction<"incomer">);

    this.incomerTransactionStore = new TransactionStore({
      prefix: this.prefixedName + this.providedUUID,
      instance: "incomer"
    });

    this.emit("registered");
  }
}
