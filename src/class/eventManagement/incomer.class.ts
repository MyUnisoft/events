// Import Node.js Dependencies
import { EventEmitter } from "events";
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
  SubscribeTo,
  DispatcherChannelMessages,
  IncomerChannelMessages
} from "../../types/eventManagement/index";
import { DispatcherRegistrationMessage } from "../../types/eventManagement/dispatcherChannel";
import { DispatcherPingMessage, DistributedEventMessage } from "types/eventManagement/incomerChannel";

type DispatcherChannelEvents = { event: "approvement" };
type IncomerChannelEvents = { event: "ping"; message: DispatcherPingMessage } |
  { event: string; message: DistributedEventMessage };

function isDispatcherChannelMessage(value:
  DispatcherChannelMessages["DispatcherMessages"] |
  IncomerChannelMessages["DispatcherMessages"]
): value is DispatcherChannelMessages["DispatcherMessages"] {
  return value.event === "approvement";
}

function isIncomerChannelMessage(value:
  DispatcherChannelMessages["DispatcherMessages"] |
  IncomerChannelMessages["DispatcherMessages"]
): value is IncomerChannelMessages["DispatcherMessages"] {
  return value.event !== "approvement";
}

export type IncomerOptions = {
  /* Service name */
  name: string;
  /* Commonly used to distinguish envs */
  subscribeTo: SubscribeTo[];
  eventCallback: (message: Omit<DistributedEventMessage, "metadata">) => Promise<void>;
  prefix?: Prefix;
};

export class Incomer extends EventEmitter {
  readonly name: string;
  readonly prefix: Prefix | undefined;
  readonly subscribeTo: SubscribeTo[];
  readonly dispatcherChannel: Redis.Channel<DispatcherChannelMessages["IncomerMessages"]>;
  readonly dispatcherTransactionStore: TransactionStore<"dispatcher">;
  readonly dispatcherChannelName: string;
  readonly eventCallback: (message: Omit<DistributedEventMessage, "metadata">) => Promise<void>;


  protected subscriber: Redis.Redis;

  private privateUuid = randomUUID();
  private logger: logger.Logger;
  private incomerChannelName: string;
  private incomerTransactionStore: TransactionStore<"incomer">;
  private incomerChannel: Redis.Channel<IncomerChannelMessages["IncomerMessages"]>;

  constructor(options: IncomerOptions, subscriber?: Redis.Redis) {
    super();

    Object.assign(this, {}, options);

    this.dispatcherChannelName = `${this.prefix ? `${this.prefix}-` : ""}${channels.dispatcher}`;

    this.logger = logger.pino().child({ service: `${this.prefix ? `${this.prefix}-` : ""}${this.name}` });

    this.subscriber = subscriber;

    this.dispatcherTransactionStore = new TransactionStore({
      prefix: this.prefix,
      instance: "dispatcher"
    });

    this.dispatcherChannel = new Redis.Channel({
      name: channels.dispatcher,
      prefix: this.prefix
    });
  }

  public async initialize() {
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

    await this.dispatcherChannel.publish({
      event: "register",
      data: {
        name: this.name,
        subscribeTo: this.subscribeTo
      },
      metadata: {
        origin: this.privateUuid,
        prefix: this.prefix
      }
    });

    this.logger.info({
      uptime: process.uptime()
    }, "Registering as a new incomer on dispatcher");

    await new Promise((resolve) => this.once("registered", resolve));
  }

  private async handleMessages(channel: string, message: string) {
    if (!message) {
      return;
    }

    const formattedMessage: DispatcherChannelMessages["DispatcherMessages"] |
      IncomerChannelMessages["DispatcherMessages"] = JSON.parse(message);

    if (formattedMessage.metadata && formattedMessage.metadata.origin === this.privateUuid) {
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
    if (message.metadata.to !== this.privateUuid) {
      return;
    }

    const logData = {
      channel,
      ...message,
      uptime: process.uptime()
    };

    const { event } = message;

    match<DispatcherChannelEvents>({ event })
      .with({ event: "approvement" }, async() => {
        this.logger.info(logData, "New approvement message on Dispatcher Channel");

        await this.registerPrivateChannel(message);
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
    const { event } = message;

    const logData = {
      channel,
      ...message,
      uptime: process.uptime()
    };

    match<IncomerChannelEvents>({ event, message })
      .with({ event: "ping" }, async(res: { event: "ping", message: DispatcherPingMessage }) => {
        const { message } = res;

        await this.incomerTransactionStore.setTransaction({
          ...message,
          metadata: {
            ...message.metadata,
            origin: message.metadata.to
          },
          mainTransaction: false,
          relatedTransaction: message.metadata.transactionId,
          resolved: false
        });

        this.logger.info({
          ...logData
        }, "Published new pong event");
      })
      .with(P._, async(res: { event: string, message: DistributedEventMessage}) => {
        const { message } = res;

        await this.eventCallback({ ...message });

        await this.incomerTransactionStore.setTransaction({
          ...message,
          metadata: {
            ...message.metadata,
            origin: message.metadata.to
          },
          mainTransaction: false,
          relatedTransaction: message.metadata.transactionId,
          resolved: false
        });
      })
      .exhaustive()
      .catch((error) => {
        this.logger.error({ channel: "incomer", error: error.message, message });
      });
  }

  private async registerPrivateChannel(message: DispatcherRegistrationMessage) {
    const { data } = message;

    this.incomerChannelName = `${this.prefix ? `${this.prefix}-` : ""}${data.uuid}`;
    this.privateUuid = data.uuid;

    await this.subscriber.subscribe(this.incomerChannelName);

    this.incomerChannel = new Redis.Channel({
      name: this.privateUuid,
      prefix: this.prefix
    });

    this.incomerTransactionStore = new TransactionStore({
      prefix: `${this.prefix ? `${this.prefix}-` : ""}${this.privateUuid}`,
      instance: "incomer"
    });

    this.emit("registered");
  }
}


