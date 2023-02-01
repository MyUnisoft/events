/* eslint-disable max-depth */
// Import Node.js Dependencies
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import * as Redis from "@myunisoft/redis";
import * as logger from "pino";
import Ajv, { ValidateFunction } from "ajv";


// Import Internal Dependencies
import {
  channels,
  incomerStoreName,
  predefinedEvents
} from "../../utils/config";
import {
  TransactionStore
} from "./transaction.class";
import {
  Prefix,
  SubscribeTo,
  DispatcherChannelMessages,
  IncomerChannelMessages,
  TransactionAck,
  DispatcherTransactionMetadata
} from "../../types/eventManagement/index";
import * as ChannelsMessages from "../../schema/eventManagement/index";
import { DispatcherRegistrationMessage, IncomerRegistrationMessage } from "../../types/eventManagement/dispatcherChannel";
import { DispatcherPingMessage } from "../../types/eventManagement/incomerChannel";

// CONSTANTS
const ajv = new Ajv();
const kPingInterval = 3_600;
const kCheckInterval = 14_400;
const kIdleTime = 7_200;
const treeNames = [
  incomerStoreName,
  `local-${incomerStoreName}`,
  `dev-${incomerStoreName}`,
  `preprod-${incomerStoreName}`,
  `prod-${incomerStoreName}`
];

interface RegisteredIncomer {
  providedUuid: string;
  baseUuid: string;
  name: string;
  lastActivity: number;
  aliveSince: number;
  prefix?: string;
  subscribeTo: SubscribeTo[];
}

type IncomerStore = Record<string, RegisteredIncomer>;

export interface DispatcherOptions {
  /* Prefix for the channel name, commonly used to distinguish envs */
  prefix?: Prefix;
  eventsValidationFunction?: Map<string, ValidateFunction>;
  subscribeTo?: SubscribeTo[];
  pingInterval?: number;
  checkInterval?: number;
  idleTime?: number;
}

export class Dispatcher {
  readonly type = "dispatcher";
  readonly prefix: string;
  readonly dispatcherChannelName: string;
  readonly dispatcherChannel: Redis.Channel<DispatcherChannelMessages["DispatcherMessages"] | TransactionAck>;
  readonly privateUuid: string = randomUUID();

  readonly incomerStore: Redis.KVPeer<IncomerStore>;
  readonly transactionStore: TransactionStore<"dispatcher">;

  protected subscriber: Redis.Redis;

  private logger: logger.Logger;
  private incomerChannels: Map<string,
    Redis.Channel<IncomerChannelMessages["DispatcherMessages"] | {
      event: string; data: Record<string, any>, metadata: DispatcherTransactionMetadata
    }>> = new Map();

  private pingInterval: NodeJS.Timer;
  private checkInterval: NodeJS.Timer;
  private idleTime: number;

  public eventsValidationFunction: Map<string, ValidateFunction>;

  constructor(options: DispatcherOptions = {}, subscriber?: Redis.Redis) {
    this.prefix = options.prefix ? `${options.prefix}-` : "";
    this.dispatcherChannelName = this.prefix + channels.dispatcher;
    this.idleTime = options.idleTime ?? kIdleTime;

    this.eventsValidationFunction = options.eventsValidationFunction ?? new Map();

    for (const [name, validationSchema] of Object.entries(ChannelsMessages)) {
      this.eventsValidationFunction.set(name, ajv.compile(validationSchema));
    }

    this.incomerStore = new Redis.KVPeer({
      prefix: options.prefix,
      type: "object"
    });

    this.transactionStore = new TransactionStore({
      prefix: options.prefix,
      instance: "dispatcher"
    });

    this.logger = logger.pino().child({ incomer: this.prefix + this.type });

    this.dispatcherChannel = new Redis.Channel({
      name: channels.dispatcher,
      prefix: options.prefix
    });

    this.subscriber = subscriber;

    this.pingInterval = setInterval(async() => {
      try {
        await this.ping();
      }
      catch (error) {
        console.error(error);
      }
    }, options.pingInterval ?? kPingInterval).unref();

    this.checkInterval = setInterval(async() => {
      try {
        await this.checkLastActivity();
      }
      catch (error) {
        console.error(error);
      }
    }, options.checkInterval ?? kCheckInterval).unref();
  }

  public async initialize() {
    if (!this.subscriber) {
      this.subscriber = await Redis.initRedis({
        port: process.env.REDIS_PORT,
        host: process.env.REDIS_HOST
      } as any, true);
    }

    await this.subscriber.subscribe(this.dispatcherChannelName);

    this.subscriber.on("message", async(channel, message) => {
      if (!message) {
        return;
      }

      const formattedMessage = JSON.parse(message) as DispatcherChannelMessages["IncomerMessages"] |
      IncomerChannelMessages["IncomerMessage"];

      try {
        if (!formattedMessage.event || !formattedMessage.metadata) {
          throw new Error("Malformed message");
        }

        // Avoid reacting to his own message
        if (formattedMessage.metadata.origin === this.privateUuid) {
          return;
        }

        const eventValidationSchema = this.eventsValidationFunction.get(formattedMessage.event);
        if (!eventValidationSchema) {
          throw new Error("Unknown Event");
        }

        if (!eventValidationSchema(formattedMessage)) {
          throw new Error("Malformed message");
        }

        await this.handleMessages(channel, formattedMessage);
      }
      catch (error) {
        this.logger.error({ channel, message: formattedMessage, error: error.message });
      }
    });
  }

  private async ping() {
    for (const treeName of treeNames) {
      const tree = await this.getTree(treeName);

      for (const uuid of Object.keys(tree)) {
        const incomerChannel = this.incomerChannels.get(uuid);

        if (incomerChannel) {
          const event: DispatcherPingMessage = {
            event: "ping",
            data: null,
            metadata: {
              origin: this.privateUuid,
              to: uuid
            }
          };

          const transactionId = await this.transactionStore.setTransaction(event);

          await incomerChannel.publish({
            event: "",
            data: null,
            metadata: {
              ...event.metadata,
              transactionId
            }
          });

          await incomerChannel.publish({
            ...event,
            metadata: {
              ...event.metadata,
              transactionId
            }
          });

          this.logger.info({
            ...event,
            uptime: process.uptime()
          }, "New Ping event");
        }
      }
    }
  }

  private async checkLastActivity() {
    for (const treeName of treeNames) {
      const tree = await this.getTree(treeName);

      if (tree) {
        const now = Date.now();

        for (const [uuid, service] of Object.entries(tree)) {
          if (now > service.lastActivity + this.idleTime) {
            // Remove the service from the tree & update it.
            delete tree[uuid];

            await this.incomerStore.setValue({
              key: treeName,
              value: tree
            });

            for await (const [transactionId, transaction] of Object.entries(this.transactionStore.getTransactions())) {
              if (transaction.metadata.to === uuid) {
                // Delete ping interaction since the service is off
                if (transaction.event === "ping") {
                  this.transactionStore.deleteTransaction(transactionId);
                }

                // redistribute events & so transactions to according services

                // delete the previous transactions
              }
            }

            this.logger.info({
              uuid,
              service,
              uptime: process.uptime()
            }, "Removed inactive service");
          }
        }
      }
    }
  }

  private async handleMessages(channel: string, message: DispatcherChannelMessages["IncomerMessages"] |
  IncomerChannelMessages["IncomerMessage"] | TransactionAck) {
    switch (channel) {
      case this.dispatcherChannelName:
        await this.handleDispatcherMessages(message as DispatcherChannelMessages["IncomerMessages"] | TransactionAck);
        break;
      default:
        await this.handleIncomerMessages(channel, message as IncomerChannelMessages["IncomerMessage"]);
        break;
    }
  }

  public async close() {
    if (!this.subscriber) {
      return;
    }

    clearInterval(this.pingInterval);
    this.pingInterval = undefined;

    await this.subscriber.quit();
    this.subscriber = undefined;
  }

  public async getTree(treeName: string): Promise<IncomerStore> {
    const tree = await this.incomerStore.getValue(treeName);

    return tree ?? {};
  }

  private async handleAck(transactionId) {
    const transaction = await this.transactionStore.getTransaction(transactionId);
    if (!transaction) {
      throw new Error("Unknown transaction to ack");
    }

    await this.transactionStore.deleteTransaction(transactionId);
  }

  private async publishAck(
    channel: Redis.Channel,
    message: TransactionAck
  ) {
    await channel.publish(message);
  }

  private async handleDispatcherMessages(message: DispatcherChannelMessages["IncomerMessages"] | TransactionAck) {
    const { event } = message;

    switch (event) {
      case predefinedEvents.incomer.registration.register:
        this.logger.info({
          ...message,
          uptime: process.uptime()
        }, "New Registration on Dispatcher Channel");

        await this.approveService(message as IncomerRegistrationMessage);

        break;
      case predefinedEvents.ack:
        this.logger.info({
          ...message,
          uptime: process.uptime()
        }, "New Ack on Dispatcher Channel");

        await this.handleAck(message.metadata.transactionId);

        break;
      default:
        throw new Error("Unknown event on dispatcher channel");
    }
  }

  private async handleIncomerMessages(channel: string, message: IncomerChannelMessages["IncomerMessage"] | TransactionAck) {
    const { event, metadata } = message;
    const { prefix } = metadata;

    const relatedIncomerTreeName = `${prefix ? `${prefix}-` : ""}${incomerStoreName}`;

    if (event === predefinedEvents.incomer.check.pong) {
      const { transactionId, origin } = metadata;

      const transaction = await this.transactionStore.getTransaction(transactionId);
      if (!transaction) {
        throw new Error("Couldn't find the related transaction for the pong operation");
      }

      // Do I want this to break ?
      const incomerTree = await this.getTree(relatedIncomerTreeName) as IncomerStore;
      if (!incomerTree[origin]) {
        throw new Error("Couldn't find the related incomer");
      }

      // Update the incomer last Activity
      incomerTree[origin].lastActivity = Date.now();
      await this.incomerStore.setValue({
        key: relatedIncomerTreeName,
        value: incomerTree
      });

      await this.transactionStore.deleteTransaction(transactionId);
    }
    else {
      this.logger.info({
        ...message,
        uptime: process.uptime()
      }, "injected event");
    }
  }

  private async approveService(message: IncomerRegistrationMessage) {
    const { data, metadata } = message;

    const providedUuid: string = randomUUID();

    // Get Incomers Tree
    const incomerTreeName = `${metadata.prefix ? `${metadata.prefix}-` : ""}${incomerStoreName}`;
    const relatedIncomerTree = await this.getTree(incomerTreeName) as IncomerStore;

    // Avoid multiple init from a same instance of a service
    for (const service of Object.values(relatedIncomerTree)) {
      if (service.baseUuid === metadata.origin) {
        throw new Error("Forbidden multiple registration for a same instance");
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

    const event: DispatcherRegistrationMessage = {
      event: "approvement",
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
    await this.dispatcherChannel.publish({
      ...event,
      metadata: {
        origin: this.privateUuid,
        to: metadata.origin,
        transactionId
      }
    });

    this.logger.info({
      ...event,
      uptime: process.uptime()
    }, "New approvement event");
  }
}
