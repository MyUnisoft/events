// Import Node.js Dependencies
import { EventEmitter } from "events";

// Import Third-party Dependencies
import * as Redis from "@myunisoft/redis-utils";
import { v4 as uuidv4 } from "uuid";
import * as logger from "pino";

// Import Internal Dependencies
import {
  EventOptions,
  Events
} from "../types/index";
import {
  channels,
  predefinedEvents,
  redisPort
} from "../utils/config";
import {
  IncomerRegistrationDataIn,
  IncomerRegistrationMetadataIn,
  IncomerTransactionMetadata,
  DispatcherTransactionMetadata,
  PongData,
  Prefix,
  SubscribeTo
} from "types/utils";


export type ServiceOptions = IncomerRegistrationDataIn & { prefix?: Prefix };

export class Incomer<T extends keyof Events = keyof Events> extends EventEmitter {
  readonly name: string;
  readonly prefix: Prefix | undefined;
  readonly subscribeTo: SubscribeTo[];
  readonly dispatcherChannel: Redis.Channel<
    { event: string; data: IncomerRegistrationDataIn; },
    IncomerRegistrationMetadataIn
  >;
  readonly dispatcherChannelName: string;

  protected subscriber: Redis.Redis;

  private privateUuid: string = uuidv4();
  private logger: logger.Logger;
  private incomerChannelName: string;
  private incomerChannel: Redis.Channel<
    PongData | EventOptions<T>,
    IncomerTransactionMetadata
  >;

  constructor(options: ServiceOptions) {
    super();

    Object.assign(this, {}, options);

    this.dispatcherChannelName = `${this.prefix ? `${this.prefix}-` : ""}${channels.dispatcher}`;

    this.logger = logger.pino().child({ service: `${this.prefix ? `${this.prefix}-` : ""}${this.name}` });

    this.dispatcherChannel = new Redis.Channel({
      name: channels.dispatcher,
      prefix: this.prefix
    });
  }

  public async initialize() {
    this.subscriber = await Redis.initRedis({ port: redisPort } as any, true);
    await this.subscriber.subscribe(this.dispatcherChannelName);

    this.subscriber.on("message", async(channel: string, message: string) => {
      const formatedMessage = JSON.parse(message);

      // Avoid reacting to his own message
      if (formatedMessage.metadata && formatedMessage.metadata.origin === this.privateUuid) {
        return;
      }

      try {
        switch (channel) {
          case this.dispatcherChannelName:
            if (formatedMessage.metadata.to !== this.privateUuid) {
              return;
            }

            await this.handleDispatcherMessages(formatedMessage);
            break;
          default:
            if (channel !== this.incomerChannelName) {
              return;
            }

            await this.handleIncomerMessages(formatedMessage);
            break;
        }
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

    this.logger.info({ uptime: process.uptime() }, "Registring as a new incomer on dispatcher");

    await new Promise((resolve) => this.once("registred", resolve));
  }

  private async registerPrivateChannel(data: Record<string, any>) {
    this.incomerChannelName = `${this.prefix ? `${this.prefix}-` : ""}${data.uuid}`;
    this.privateUuid = data.uuid;

    await this.subscriber.subscribe(this.incomerChannelName);

    this.incomerChannel = new Redis.Channel({
      name: this.privateUuid,
      prefix: this.prefix
    });

    this.emit("registred");
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
      const { metadata } = message as { data: Record<string, any>, metadata: DispatcherTransactionMetadata };

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


