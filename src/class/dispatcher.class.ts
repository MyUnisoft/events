// Import Third-party Dependencies
import * as Redis from "@myunisoft/redis-utils";
import { v4 as uuidv4 } from "uuid";
import * as logger from "pino";

// Import Internal Dependencies
import {
  channels,
  incomerStoreName,
  predefinedEvents,
  redisPort
} from "../utils/config";
import {
  Prefix,
  SubscribeTo,
  IncomerMessages,
  IncomerRegistrationDataIn,
  IncomerRegistrationMetadataIn,
  DispatcherTransactionMetadata,
  DispatcherRegistrationData,
  DispatcherRegistrationMetadata,
  IncomerTransactionMetadata,
  IncomerRegistrationMessage
} from "../types/utils";
import {
  PartialTransaction,
  TransactionStore
} from "./transaction.class";

// CONSTANTS
// const kPrefixs = ["local", "dev", "preprod", "prod"];

interface RegistredIncomer {
  providedUuid: string;
  baseUuid: string;
  name: string;
  lastActivity: number;
  aliveSince: number;
  prefix?: string;
  subscribeTo: SubscribeTo[];
}

type IncomerStore = Record<string, RegistredIncomer>;

export interface DispachterOptions {
  /* Prefix for the channel name, commonly used to distinguish environnements */
  prefix?: Prefix;
  subscribeTo?: SubscribeTo[];
}

export class Dispatcher {
  readonly type = "dispatcher";
  readonly prefix: string;
  readonly dispatcherChannelName: string;
  readonly dispatcherChannel: Redis.Channel<
    { event: string; data: DispatcherRegistrationData; },
    DispatcherRegistrationMetadata
  >;
  readonly privateUuid: string = uuidv4();

  readonly incomerStore: Redis.KVPeer<IncomerStore>;
  readonly transactionStore: TransactionStore<"dispatcher">;

  protected subscriber: Redis.Redis;

  private logger: logger.Logger;
  private incomerChannels = new Map<string,
    Redis.Channel<{ event: string; } & Record<string, any>,
      DispatcherTransactionMetadata>
  >();

  constructor(options: DispachterOptions = {}, subscriber?: Redis.Redis) {
    this.prefix = `${options.prefix ? `${options.prefix}-` : ""}`;
    this.dispatcherChannelName = this.prefix + channels.dispatcher;

    this.incomerStore = new Redis.KVPeer({
      prefix: this.prefix,
      type: "object"
    });

    this.transactionStore = new TransactionStore({
      prefix: this.prefix,
      instance: "dispatcher"
    });

    this.logger = logger.pino().child({ incomer: this.prefix + this.type });

    this.dispatcherChannel = new Redis.Channel({
      name: channels.dispatcher,
      prefix: this.prefix
    });

    this.subscriber = subscriber;
  }

  public async initialize() {
    if (!this.subscriber) {
      this.subscriber = await Redis.initRedis({
        port: process.env.MYUNISOFT_REDIS_PORT,
        host: process.env.MYUNISOFT_REDIS_HOST
      } as any, true);
    }

    await this.subscriber.subscribe(this.dispatcherChannelName);

    this.subscriber.on("message", async(channel: string, message: string) => {
      const formatedMessage = JSON.parse(message) as {
        event: string;
        data: IncomerMessages;
        metadata: IncomerTransactionMetadata;
      };

      if (formatedMessage.metadata && formatedMessage.metadata.origin === this.privateUuid) {
        return;
      }

      try {
        switch (channel) {
          case this.dispatcherChannelName:
            await this.handleDispatcherMessages(formatedMessage);
            break;
          default:
            await this.handleIncomerMessages(channel, formatedMessage);
            break;
        }
      }
      catch (error) {
        this.logger.error(error);
      }
    });
  }

  public async close() {
    if (!this.subscriber) {
      return;
    }

    await this.subscriber.quit();
    this.subscriber = undefined;
  }

  public async getTree(treeName: string): Promise<IncomerStore> {
    const tree = await this.incomerStore.getValue(treeName);

    return tree ? tree : {};
  }

  private async handleDispatcherMessages(message: { event: string } & IncomerRegistrationMessage) {
    const { event, data, metadata } = message;

    switch (event) {
      case predefinedEvents.incomer.registration.register:
        this.logger.info({
          event,
          data,
          metadata,
          uptime: process.uptime()
        }, "A new service want to be registred");

        await this.approveService(data, metadata);

        break;
      default:
        this.logger.error({
          event,
          data,
          metadata
        }, "Unknown event on dispatcher channel");

        break;
    }
  }

  private async handleIncomerMessages(channel: string, message: Record<string, any>) {
    const { event, metadata } = message;
    const { prefix } = metadata;

    const relatedIncomerTreeName = `${prefix ? `${prefix}-` : ""}${incomerStoreName}`;

    if (event === predefinedEvents.incomer.check.pong) {
      const { transactionId, origin } = metadata;

      const transaction = await this.transactionStore.getTransaction(transactionId);
      if (!transaction) {
        this.logger.error({
          channel,
          event,
          metadata
        }, "Couldn't find the related transaction for the pong operation");

        return;
      }

      // Do I want this to break ?
      const incomerTree = await this.getTree(relatedIncomerTreeName) as IncomerStore;
      if (!incomerTree[origin]) {
        this.logger.error({
          channel,
          event,
          metadata
        }, "Couldn't find the related incomer");

        return;
      }

      // Update the incomer last Activity
      incomerTree[origin].lastActivity = Date.now();
      await this.incomerStore.setValue({
        key: relatedIncomerTreeName,
        value: incomerTree
      });

      // Remove the transaction about the ping event
      // Do I want this to break ?
      await this.transactionStore.deleteTransaction(transactionId);
    }
    else {
      const { data } = message;

      console.log("not happening", event, data, metadata);
    }
  }

  private async approveService(data: IncomerRegistrationDataIn, metadata: IncomerRegistrationMetadataIn) {
    const providedUuid: string = uuidv4();

    // Get Incomers Tree
    const incomerTreeName = `${metadata.prefix ? `${metadata.prefix}-` : ""}${incomerStoreName}`;
    const relatedIncomerTree = await this.getTree(incomerTreeName) as IncomerStore;

    // Avoid multiple init from a same instance of a service
    for (const service of Object.values(relatedIncomerTree)) {
      if (service.baseUuid === metadata.origin) {
        return;
      }
    }

    // Update the tree
    const now = Date.now();

    const service = Object.assign({}, {
      providedUuid,
      baseUuid: metadata.origin,
      ...data,
      lastActivity: now,
      aliveSince: now,
      prefix: metadata.prefix
    });

    relatedIncomerTree[providedUuid] = service;

    await this.incomerStore.setValue({
      key: incomerTreeName,
      value: relatedIncomerTree
    });

    // Subscribe to the exclusive service channel
    this.incomerChannels.set(providedUuid, new Redis.Channel({
      name: providedUuid,
      prefix: metadata.prefix
    }));
    await this.subscriber.subscribe(`${metadata.prefix ? `${metadata.prefix}-` : ""}${providedUuid}`);

    const event: PartialTransaction<"dispatcher"> = {
      event: predefinedEvents.dispatcher.registration.approvement,
      data: {
        uuid: providedUuid
      },
      metadata: {
        origin: this.privateUuid,
        to: metadata.origin
      }
    };

    const transactionId = await this.transactionStore.setTransaction(event);

    // Approve the service & send him info so he can use the dedicated channel
    await this.dispatcherChannel.publish({ ...event, metadata: { ...event.metadata, transactionId } });

    this.logger.info({
      event,
      uptime: process.uptime()
    }, "PUBLISHED APPROVEMENT");
  }
}
