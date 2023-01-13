// Import Node.js Dependencies
import { EventEmitter } from "events";

// Import Third-party Dependencies
import * as Redis from "@myunisoft/redis-utils";
import { v4 as uuidv4 } from "uuid";
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
  IncomerChannelMessages
} from "../../types/eventManagement/index";
import { PartialTransaction, TransactionStore } from "./transaction.class";


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
  readonly dispatcherChannel: Redis.Channel<DispatcherChannelMessages["IncomerMessages"]>;
  readonly dispatcherChannelName: string;

  readonly transactionStore: TransactionStore;

  protected subscriber: Redis.Redis;

  private privateUuid: string = uuidv4();
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
      const formattedMessage = JSON.parse(message);

      // Avoid reacting to his own message
      if (formattedMessage.metadata && formattedMessage.metadata.origin === this.privateUuid) {
        return;
      }

      try {
        switch (channel) {
          case this.dispatcherChannelName:
            if (formattedMessage.metadata.to !== this.privateUuid) {
              return;
            }

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
    });

    const event: PartialTransaction<"incomer"> = {
      event: predefinedEvents.incomer.registration.register,
      data: {
        name: this.name,
        subscribeTo: this.subscribeTo
      },
      metadata: {
        origin: this.privateUuid,
        prefix: this.prefix
      }
    };

    const transactionId = await this.transactionStore.setTransaction(event);

    await this.dispatcherChannel.publish({
      event: predefinedEvents.incomer.registration.register,
      data: {
        name: this.name,
        subscribeTo: this.subscribeTo
      },
      metadata: {
        origin: this.privateUuid,
        prefix: this.prefix,
        transactionId
      }
    });

    this.logger.info({ uptime: process.uptime() }, "Registering as a new incomer on dispatcher");

    await new Promise((resolve) => this.once("registered", resolve));
  }

  private async registerPrivateChannel(data: Record<string, any>) {
    this.incomerChannelName = `${this.prefix ? `${this.prefix}-` : ""}${data.uuid}`;
    this.privateUuid = data.uuid;

    await this.subscriber.subscribe(this.incomerChannelName);

    this.incomerChannel = new Redis.Channel({
      name: this.privateUuid,
      prefix: this.prefix
    });

    this.emit("registered");
  }

  private async handleDispatcherMessages(message: Record<string, any>): Promise<void> {
    const { event, data, metadata } = message;

    switch (event) {
      case predefinedEvents.dispatcher.registration.approvement:
        this.logger.info({
          event,
          data,
          metadata,
          uptime: process.uptime()
        }, "New approvement message from dispatcher");

        await this.registerPrivateChannel(data);

        break;
      default:
        this.logger.info({
          event,
          data,
          metadata,
          uptime: process.uptime()
        }, "New unknown message from dispatcher");

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
}


