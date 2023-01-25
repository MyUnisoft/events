// Import Node.js Dependencies
import { EventEmitter } from "events";
import { randomUUID } from "crypto";

// Import Third-party Dependencies
import * as Redis from "@myunisoft/redis";
import * as logger from "pino";

// Import Internal Dependencies
import {
  channels,
  predefinedEvents,
  redisPort
} from "../../utils/config";
import {
  Prefix,
  SubscribeTo,
  DispatcherChannelMessages,
  IncomerChannelMessages,
  TransactionAck
} from "../../types/eventManagement/index";
import { TransactionStore } from "./transaction.class";
import { Channel } from "@myunisoft/redis";
import { DispatcherRegistrationMessage } from "types/eventManagement/dispatcherChannel";


export type ServiceOptions = {
  /* Service name */
  name: string;
  /* Commonly used to distinguish envs */
  subscribeTo: SubscribeTo[];
  prefix?: Prefix;
};

export class Incomer extends EventEmitter {
  readonly name: string;
  readonly prefix: Prefix | undefined;
  readonly subscribeTo: SubscribeTo[];
  readonly dispatcherChannel: Redis.Channel<DispatcherChannelMessages["IncomerMessages"] | TransactionAck>;
  readonly dispatcherChannelName: string;

  readonly transactionStore: TransactionStore;

  protected subscriber: Redis.Redis;

  private privateUuid: string = randomUUID();
  private logger: logger.Logger;
  private incomerChannelName: string;
  private incomerChannel: Redis.Channel<IncomerChannelMessages["IncomerMessage"]>;

  constructor(options: ServiceOptions) {
    super();

    Object.assign(this, {}, options);

    this.dispatcherChannelName = `${this.prefix ? `${this.prefix}-` : ""}${channels.dispatcher}`;

    this.logger = logger.pino().child({ service: `${this.prefix ? `${this.prefix}-` : ""}${this.name}` });

    this.transactionStore = new TransactionStore({
      prefix: this.prefix,
      instance: "incomer"
    });

    this.dispatcherChannel = new Redis.Channel({
      name: channels.dispatcher,
      prefix: this.prefix
    });
  }

  public async initialize() {
    // Every x ms, check transaction are dealed
    // If not, emit the event so he can dealed locally ?

    this.subscriber = await Redis.initRedis({ port: redisPort } as any, true);
    await this.subscriber.subscribe(this.dispatcherChannelName);

    this.subscriber.on("message", async(channel: string, message: string) => {
      try {
        await this.handleMessages(channel, message);
      }
      catch (error) {
        this.logger.error(error);
      }
    });

    await this.dispatcherChannel.publish({
      event: predefinedEvents.incomer.registration.register,
      data: {
        name: this.name,
        subscribeTo: this.subscribeTo
      },
      metadata: {
        origin: this.privateUuid,
        prefix: this.prefix
      }
    });

    this.logger.info({ uptime: process.uptime() }, "Registering as a new incomer on dispatcher");

    await new Promise((resolve) => this.once("registered", resolve));
  }

  private async handleMessages(channel: string, message: string) {
    if (!message) {
      return;
    }

    const formattedMessage = JSON.parse(message) as DispatcherChannelMessages["DispatcherMessages"] |
      IncomerChannelMessages["DispatcherMessages"];

    // Avoid reacting to his own message
    if (formattedMessage.metadata && formattedMessage.metadata.origin === this.privateUuid) {
      return;
    }

    try {
      switch (channel) {
        case this.dispatcherChannelName:
          await this.handleDispatcherMessages(formattedMessage);

          break;
        default:
          if (channel !== this.incomerChannelName) {
            return;
          }

          await this.handleIncomerMessages(formattedMessage);

          break;
      }
    }
    catch (error) {
      this.logger.error(error);
    }
  }

  private async handleDispatcherMessages(message: DispatcherChannelMessages["DispatcherMessages"] | TransactionAck):
    Promise<void> {
    if (message.metadata.to !== this.privateUuid) {
      return;
    }

    const { event } = message;

    switch (event) {
      case predefinedEvents.dispatcher.registration.approvement:
        this.logger.info({
          ...message,
          uptime: process.uptime()
        }, "New approvement message on Dispatcher Channel");

        // eslint-disable-next-line dot-notation
        await this.registerPrivateChannel(message as DispatcherRegistrationMessage);

        break;
      case predefinedEvents.ack:
        this.logger.info({
          ...message,
          uptime: process.uptime()
        }, "New ack on Dispatcher Channel");

        await this.handleAck(message.metadata.transactionId);

        break;
      default:
        this.logger.info({
          ...message,
          uptime: process.uptime()
        }, "Unknown message on Dispatcher Channel");

        break;
    }
  }

  private async handleIncomerMessages(message: Record<string, any>): Promise<void> {
    const { event } = message;

    if (event === predefinedEvents.dispatcher.check.ping) {
      const { metadata } = message as IncomerChannelMessages["DispatcherMessages"];

      const event = {
        event: predefinedEvents.incomer.check.pong,
        metadata: {
          origin: this.privateUuid,
          to: metadata.origin,
          prefix: this.prefix,
          transactionId: metadata.transactionId
        }
      };

      await this.incomerChannel.publish(event);

      this.logger.info({
        event,
        metadata,
        uptime: process.uptime()
      }, "PUBLISHED PONG");
    }
    else {
      const { data, metadata } = message;

      console.log("not happening", event, data, metadata);
    }
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

    await this.publishAck(this.dispatcherChannel, {
      event: "ack",
      metadata: {
        origin: this.privateUuid,
        transactionId: message.metadata.transactionId
      }
    });

    this.emit("registered");
  }

  private async handleAck(transactionId: string) {
    const transaction = await this.transactionStore.getTransaction(transactionId);
    if (!transaction) {
      throw new Error("Unknown transaction to ack");
    }

    await this.transactionStore.deleteTransaction(transactionId);
  }

  private async publishAck(
    channel: Channel,
    message: TransactionAck
  ) {
    await channel.publish(message);
  }
}


