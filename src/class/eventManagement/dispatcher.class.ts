// Import Node.js Dependencies
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import * as Redis from "@myunisoft/redis";
import * as logger from "pino";
import Ajv, { ValidateFunction } from "ajv";
import { match, P } from "ts-pattern";

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

type DispatcherChannelEvents = | { event: "register" }
| { event: "ack" };

function isDispatcherChannelMessage(
  value: DispatcherChannelMessages["IncomerMessages"] |
  IncomerChannelMessages["IncomerMessage"] | TransactionAck
): value is DispatcherChannelMessages["IncomerMessages"] | TransactionAck {
  return value.event !== "pong";
}

function isIncomerChannelMessage(
  value: DispatcherChannelMessages["IncomerMessages"] |
  IncomerChannelMessages["IncomerMessage"] | TransactionAck
): value is IncomerChannelMessages["IncomerMessage"] | TransactionAck {
  return value.event !== "register";
}

function isIncomerRegistrationMessage(
  value: DispatcherChannelMessages["IncomerMessages"] | TransactionAck
): value is IncomerRegistrationMessage {
  return typeof value.event === "string" &&
    typeof value.data.name === "string" &&
    typeof value.data.subscribeTo !== "undefined";
}

export class Dispatcher {
  readonly type = "dispatcher";
  readonly prefix: string;
  readonly dispatcherChannelName: string;
  readonly dispatcherChannel: Redis.Channel<DispatcherChannelMessages["DispatcherMessages"] | TransactionAck>;
  readonly privateUuid = randomUUID();

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

    this.subscriber.on("message", this.handleMessages.bind(this));
  }

  private async handleMessages(channel: string, message: string) {
    if (!message) {
      return;
    }

    const formattedMessage: DispatcherChannelMessages["IncomerMessages"] |
      IncomerChannelMessages["IncomerMessage"] | TransactionAck = JSON.parse(message);

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

      if (channel === this.dispatcherChannelName) {
        if (isDispatcherChannelMessage(formattedMessage)) {
          await this.handleDispatcherMessages(formattedMessage);
        }
      }
      else if (isIncomerChannelMessage(formattedMessage)) {
        await this.handleIncomerMessages(channel, formattedMessage);
      }
    }
    catch (error) {
      this.logger.error({ channel, message: formattedMessage, error: error.message });
    }
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

      if (!tree) {
        continue;
      }

      const now = Date.now();

      for (const [uuid, incomer] of Object.entries(tree)) {
        if (now <= incomer.lastActivity + this.idleTime) {
          continue;
        }

        // Remove the incomer from the tree & update it.
        await this.handleInactiveIncomer(tree, treeName, uuid);

        this.logger.info({
          uuid,
          incomer,
          uptime: process.uptime()
        }, "Removed inactive incomer");
      }
    }
  }

  private async handleInactiveIncomer(
    tree: IncomerStore,
    treeName: string,
    uuid: string
  ) {
    delete tree[uuid];

    if (Object.entries(tree).length > 0) {
      await this.incomerStore.setValue({
        key: treeName,
        value: tree
      });
    }
    else {
      await this.incomerStore.deleteValue(treeName);
    }

    for await (const [transactionId, transaction] of Object.entries(this.transactionStore.getTransactions())) {
      if (transaction.metadata.to === uuid) {
        // Delete ping interaction since the incomer is off
        if (transaction.event === "ping") {
          this.transactionStore.deleteTransaction(transactionId);
        }

        // redistribute events & so transactions to according incomers

        // delete the previous transactions
      }
    }
  }

  public async close() {
    if (!this.subscriber) {
      return;
    }

    clearInterval(this.pingInterval);
    this.pingInterval = undefined;

    clearInterval(this.checkInterval);
    this.checkInterval = undefined;

    await this.subscriber.quit();
    this.subscriber = undefined;
  }

  public async getTree(treeName: string): Promise<IncomerStore> {
    const tree = await this.incomerStore.getValue(treeName);

    return tree ?? {};
  }

  private async handleAck(transactionId: string) {
    const transaction = await this.transactionStore.getTransactionById(transactionId);
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

  private async handleDispatcherMessages(
    message: DispatcherChannelMessages["IncomerMessages"] | TransactionAck
  ) {
    const { event } = message;

    const logData = {
      ...message,
      uptime: process.uptime()
    };

    match<DispatcherChannelEvents>({ event })
      .with({ event: "register" }, async() => {
        this.logger.info(logData, "New Registration on Dispatcher Channel");

        if (isIncomerRegistrationMessage(message)) {
          await this.approveService(message);
        }
      })
      .with({ event: "ack" }, async() => {
        this.logger.info(logData, "New Ack on Dispatcher Channel");

        await this.handleAck(message.metadata.transactionId);
      })
      .with(P._, () => {
        throw new Error("Unknown event on Dispatcher Channel");
      })
      .exhaustive()
      .catch((error) => {
        this.logger.error({ channel: "dispatcher", error: error.message, message });
      });
  }

  private async handleIncomerMessages(
    channel: string,
    message: IncomerChannelMessages["IncomerMessage"] | TransactionAck
  ) {
    const { event, metadata } = message;
    const { prefix } = metadata;

    const logData = {
      ...message,
      uptime: process.uptime()
    };

    const relatedIncomerTreeName = `${prefix ? `${prefix}-` : ""}${incomerStoreName}`;

    if (event === predefinedEvents.incomer.check.pong) {
      const { transactionId, origin } = metadata;

      const transaction = await this.transactionStore.getTransactionById(transactionId);
      if (!transaction) {
        throw new Error("Couldn't find the related transaction for the pong operation");
      }

      // Do I want this to break ?
      const incomerTree = await this.getTree(relatedIncomerTreeName);
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

      this.logger.info(logData, "Deleted with pong event");
    }
    else {
      this.logger.info(logData, "injected event");
    }
  }

  private async approveService(message: IncomerRegistrationMessage) {
    const { data, metadata } = message;

    const providedUuid = randomUUID();

    // Get Incomers Tree
    const incomerTreeName = `${metadata.prefix ? `${metadata.prefix}-` : ""}${incomerStoreName}`;
    const relatedIncomerTree = await this.getTree(incomerTreeName);

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
