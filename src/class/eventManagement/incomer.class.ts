// Import Node.js Dependencies
import { once, EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import * as Redis from "@myunisoft/redis";
import * as logger from "pino";
import { P, match } from "ts-pattern";

// Import Internal Dependencies
import {
  channels
} from "../../utils/config";
import { TransactionStore } from "./transaction.class";
import {
  Prefix,
  EventsCast,
  EventsSubscribe,
  DispatcherChannelMessages,
  IncomerChannelMessages
} from "../../types/eventManagement/index";
import { DispatcherRegistrationMessage } from "../../types/eventManagement/dispatcherChannel";
import { DispatcherPingMessage, DistributedEventMessage, EventMessage } from "types/eventManagement/incomerChannel";

type DispatcherChannelEvents = { name: "approvement" };
type IncomerChannelEvents = { name: "ping"; message: DispatcherPingMessage } |
  { name: string; message: DistributedEventMessage };

function isDispatcherChannelMessage(value:
  DispatcherChannelMessages["DispatcherMessages"] |
  IncomerChannelMessages["DispatcherMessages"]
): value is DispatcherChannelMessages["DispatcherMessages"] {
  return value.name === "approvement";
}

function isIncomerChannelMessage(value:
  DispatcherChannelMessages["DispatcherMessages"] |
  IncomerChannelMessages["DispatcherMessages"]
): value is IncomerChannelMessages["DispatcherMessages"] {
  return value.name !== "approvement";
}

export type IncomerOptions = {
  /* Service name */
  name: string;
  eventsCast: EventsCast;
  eventsSubscribe: EventsSubscribe;
  eventCallback: (message: Omit<DistributedEventMessage, "redisMetadata">) => Promise<void>;
  prefix?: Prefix;
};

export class Incomer extends EventEmitter {
  readonly eventCallback: (message: Omit<DistributedEventMessage, "redisMetadata">) => Promise<void>;

  protected subscriber: Redis.Redis;

  private name: string;
  private prefix: Prefix | undefined;
  private eventsCast: EventsCast;
  private eventsSubscribe: EventsSubscribe;
  private dispatcherChannel: Redis.Channel<DispatcherChannelMessages["IncomerMessages"]>;
  private dispatcherChannelName: string;
  private baseUUID = randomUUID();
  private providedUUID: string;
  private logger: logger.Logger;
  private incomerChannelName: string;
  private incomerTransactionStore: TransactionStore<"incomer">;
  private incomerChannel: Redis.Channel<IncomerChannelMessages["IncomerMessages"]>;

  constructor(options: IncomerOptions, subscriber?: Redis.Redis) {
    super();

    Object.assign(this, {}, options);

    this.dispatcherChannelName = `${this.prefix ? `${this.prefix}-` : ""}${channels.dispatcher}`;

    this.logger = logger.pino().child({ incomer: `${this.prefix ? `${this.prefix}-` : ""}${this.name}` });

    this.subscriber = subscriber;

    this.dispatcherChannel = new Redis.Channel({
      name: channels.dispatcher,
      prefix: this.prefix
    });

    this.incomerTransactionStore = new TransactionStore({
      prefix: `${this.prefix ? `${this.prefix}-` : ""}${this.baseUUID}`,
      instance: "incomer"
    });
  }

  public async initialize() {
    if (this.providedUUID) {
      throw new Error("Cannot init multiple times.");
    }

    // Every x ms, check transaction are dealed
    // If not, emit the event so he can dealed locally ?
    if (!this.subscriber) {
      this.subscriber = await Redis.initRedis({
        port: process.env.REDIS_PORT,
        host: process.env.REDIS_HOST
      } as any, true);
    }

    await this.subscriber.subscribe(this.dispatcherChannelName);

    this.subscriber.on("message", async(channel: string, message: string) => await this.handleMessages(channel, message));

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

    const transactionId = await this.incomerTransactionStore.setTransaction({
      ...event,
      mainTransaction: true,
      relatedTransaction: null,
      resolved: false
    });

    await this.dispatcherChannel.publish({
      ...event,
      redisMetadata: {
        ...event.redisMetadata,
        transactionId
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

  public async publish(event: Omit<EventMessage, "redisMetadata">) {
    const formattedEvent = {
      ...event,
      redisMetadata: {
        origin: this.providedUUID,
        prefix: this.prefix
      }
    } as EventMessage;

    const transactionId = await this.incomerTransactionStore.setTransaction({
      ...formattedEvent,
      mainTransaction: true,
      relatedTransaction: null,
      resolved: false
    });

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
      IncomerChannelMessages["DispatcherMessages"] = JSON.parse(message);

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
        this.logger.info(logData, "New approvement message on Dispatcher Channel");

        await this.handleApprovement(message);
      })
      .exhaustive()
      .catch((error) => {
        this.logger.error({ channel: "dispatcher", error: error.message, message });
      });
  }

  private async handleIncomerMessages(
    channel: string,
    message: IncomerChannelMessages["DispatcherMessages"]
  ): Promise<void> {
    const { name } = message;

    const logData = {
      channel,
      ...message,
      uptime: process.uptime()
    };

    match<IncomerChannelEvents>({ name, message })
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
          resolved: false
        });

        this.logger.info({
          ...logData
        }, "Resolved Ping event");
      })
      .with(P._, async(res: { name: string, message: DistributedEventMessage}) => {
        const { message } = res;
        const { redisMetadata, ...event } = message;

        await this.eventCallback(event);

        await this.incomerTransactionStore.setTransaction({
          ...message,
          redisMetadata: {
            ...redisMetadata,
            origin: redisMetadata.to
          },
          mainTransaction: false,
          relatedTransaction: redisMetadata.transactionId,
          resolved: false
        });

        this.logger.info({
          ...logData
        }, "Resolved Custom event");
      })
      .exhaustive()
      .catch((error) => {
        this.logger.error({ channel: "incomer", error: error.message, message });
      });
  }

  private async handleApprovement(message: DispatcherRegistrationMessage) {
    const { data } = message;

    this.incomerChannelName = `${this.prefix ? `${this.prefix}-` : ""}${data.uuid}`;
    this.providedUUID = data.uuid;

    await this.subscriber.subscribe(this.incomerChannelName);

    this.incomerChannel = new Redis.Channel({
      name: this.providedUUID,
      prefix: this.prefix
    });

    this.incomerTransactionStore = new TransactionStore({
      prefix: `${this.prefix ? `${this.prefix}-` : ""}${this.providedUUID}`,
      instance: "incomer"
    });

    this.emit("registered");
  }
}
