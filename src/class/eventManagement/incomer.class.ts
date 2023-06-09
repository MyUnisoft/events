// Import Node.js Dependencies
import { once, EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import * as Redis from "@myunisoft/redis";
import * as logger from "pino";
import { P, match } from "ts-pattern";

// Import Internal Dependencies
import {
  REDIS_HOST,
  REDIS_PORT,
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
  IncomerChannelMessages
} from "../../types/eventManagement/index";
import { DispatcherRegistrationMessage } from "../../types/eventManagement/dispatcherChannel";
import {
  DispatcherPingMessage,
  DistributedEventMessage,
  EventMessage
} from "../../types/eventManagement/incomerChannel";

type DispatcherChannelEvents = { name: "approvement" };
type IncomerChannelEvents<T extends Record<string, any>> = { name: "ping"; message: DispatcherPingMessage } |
  { name: string; message: DistributedEventMessage<T> };

function isDispatcherChannelMessage<T extends Record<string, any>>(value:
  DispatcherChannelMessages["DispatcherMessages"] |
  IncomerChannelMessages<T>["DispatcherMessages"]
): value is DispatcherChannelMessages["DispatcherMessages"] {
  return value.name === "approvement";
}

function isIncomerChannelMessage<T extends Record<string, any>>(value:
  DispatcherChannelMessages["DispatcherMessages"] |
  IncomerChannelMessages<T>["DispatcherMessages"]
): value is IncomerChannelMessages<T>["DispatcherMessages"] {
  return value.name !== "approvement";
}

export type IncomerOptions<T extends Record<string, any>> = {
  /* Service name */
  name: string;
  eventsCast: EventCast[];
  eventsSubscribe: EventSubscribe[];
  eventCallback: (message: Omit<DistributedEventMessage<T>, "redisMetadata">) => Promise<void>;
  prefix?: Prefix;
};

export class Incomer <T extends Record<string, any> = Record<string, any>> extends EventEmitter {
  readonly eventCallback: (message: Omit<DistributedEventMessage<T>, "redisMetadata">) => Promise<void>;

  protected subscriber: Redis.Redis;

  private name: string;
  private prefix: Prefix | undefined;
  private prefixedName: string;
  private registerTransactionId: string | null;
  private eventsCast: EventCast[];
  private eventsSubscribe: EventSubscribe[];
  private dispatcherChannel: Redis.Channel<DispatcherChannelMessages["IncomerMessages"]>;
  private dispatcherChannelName: string;
  private baseUUID = randomUUID();
  private providedUUID: string;
  private logger: logger.Logger;
  private incomerChannelName: string;
  private incomerTransactionStore: TransactionStore<"incomer">;
  private incomerChannel: Redis.Channel<IncomerChannelMessages<T>["IncomerMessages"]>;

  constructor(options: IncomerOptions<T>, subscriber?: Redis.Redis) {
    super();

    Object.assign(this, {}, options);

    this.prefixedName = `${this.prefix ? `${this.prefix}-` : ""}`;
    this.dispatcherChannelName = this.prefixedName + channels.dispatcher;

    this.logger = logger.pino({
      level: "debug",
      transport: {
        target: "pino-pretty"
      }
    }).child({ incomer: this.prefixedName + this.name });

    if (subscriber) {
      this.subscriber = subscriber;
    }

    this.dispatcherChannel = new Redis.Channel({
      name: channels.dispatcher,
      prefix: this.prefix
    });

    this.incomerTransactionStore = new TransactionStore({
      prefix: this.prefixedName + this.baseUUID,
      instance: "incomer"
    });
  }

  public async initialize() {
    if (this.providedUUID) {
      throw new Error("Cannot init multiple times.");
    }

    if (!this.subscriber) {
      this.subscriber = await Redis.initRedis({
        port: REDIS_PORT,
        host: REDIS_HOST
      } as any, true);
    }

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

    this.logger.info({
      uptime: process.uptime()
    }, "Registering as a new incomer on dispatcher");

    await once(this, "registered");

    this.logger.info({
      uptime: process.uptime()
    }, "Incomer registered");
  }

  public async publish<
    K extends Record<string, any> | null = null
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
      mainTransaction: true,
      relatedTransaction: null,
      resolved: false
    } as (K extends null ? Transaction<"incomer", T> : Transaction<"incomer", K>));

    await this.incomerChannel.publish({
      ...formattedEvent,
      redisMetadata: {
        ...formattedEvent.redisMetadata,
        transactionId
      }
    });

    const logData = {
      ...formattedEvent,
      uptime: process.uptime()
    };

    this.logger.info(logData, "Published event");
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
      ...message,
      uptime: process.uptime()
    };

    const { name } = message;

    match<DispatcherChannelEvents>({ name })
      .with({ name: "approvement" }, async() => {
        this.logger.info(
          logData,
          "New approvement message on Dispatcher Channel"
        );

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

    const logData = {
      channel,
      ...message,
      uptime: process.uptime()
    };

    match<IncomerChannelEvents<T>>({ name, message } as IncomerChannelEvents<T>)
      .with({ name: "ping" }, async(res: { name: "ping", message: DispatcherPingMessage }) => {
        const { message } = res;

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

        this.logger.info({
          ...logData
        }, "Resolved Ping event");
      })
      .with(P._, async(res: { name: string, message: DistributedEventMessage<T> }) => {
        const { message } = res;
        const { redisMetadata, ...event } = message;

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
          this.eventCallback(event),
          this.incomerTransactionStore.updateTransaction(transactionId, formattedTransaction as Transaction<"incomer">)
        ]);

        this.logger.info({
          ...logData
        }, "Resolved Custom event");
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

    this.incomerChannel = new Redis.Channel({
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
