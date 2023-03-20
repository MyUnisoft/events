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
  kIncomerStoreName
} from "../../utils/config";
import {
  Transaction,
  Transactions,
  TransactionStore
} from "./transaction.class";
import {
  Prefix,
  SubscribeTo,
  DispatcherChannelMessages,
  IncomerChannelMessages,
  DispatcherTransactionMetadata
} from "../../types/eventManagement/index";
import * as ChannelsMessages from "../../schema/eventManagement/index";
import { DispatcherRegistrationMessage, IncomerRegistrationMessage } from "../../types/eventManagement/dispatcherChannel";
import { DispatcherPingMessage } from "../../types/eventManagement/incomerChannel";

// CONSTANTS
const ajv = new Ajv();
const kPingInterval = 7_200;
const kCheckLastActivityInterval = 14_400;
const kCheckRelatedTransactionInterval = 7_200;
const kIdleTime = 10_800;
const treeNames = [
  kIncomerStoreName,
  `local-${kIncomerStoreName}`,
  `dev-${kIncomerStoreName}`,
  `preprod-${kIncomerStoreName}`,
  `prod-${kIncomerStoreName}`
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
  pingInterval?: number;
  checkLastActivityInterval?: number;
  checkTransactionInterval?: number;
  idleTime?: number;
}

type DispatcherChannelEvents = { event: "register" };

function isDispatcherChannelMessage(
  value: DispatcherChannelMessages["IncomerMessages"] |
  IncomerChannelMessages["IncomerMessage"]
): value is DispatcherChannelMessages["IncomerMessages"] {
  return value.event === "register";
}

function isIncomerChannelMessage(
  value: DispatcherChannelMessages["IncomerMessages"] |
  IncomerChannelMessages["IncomerMessage"]
): value is IncomerChannelMessages["IncomerMessage"] {
  return value.event !== "register";
}

function isIncomerRegistrationMessage(
  value: DispatcherChannelMessages["IncomerMessages"]
): value is IncomerRegistrationMessage {
  return value.event === "register";
}

export class Dispatcher {
  readonly type = "dispatcher";
  readonly prefix: string;
  readonly dispatcherChannelName: string;
  readonly dispatcherChannel: Redis.Channel<DispatcherChannelMessages["DispatcherMessages"]>;
  readonly privateUuid = randomUUID();

  readonly incomerStore: Redis.KVPeer<IncomerStore>;
  readonly incomerTransactionStore: TransactionStore<"incomer">;
  readonly dispatcherTransactionStore: TransactionStore<"dispatcher">;

  protected subscriber: Redis.Redis;

  private logger: logger.Logger;
  private incomerChannels: Map<string,
    Redis.Channel<IncomerChannelMessages["DispatcherMessages"] | {
      event: string; data: Record<string, any>, metadata: DispatcherTransactionMetadata
    }>> = new Map();

  private pingInterval: NodeJS.Timer;
  private checkLastActivityInterval: NodeJS.Timer;
  private checkRelatedTransactionInterval: NodeJS.Timer;
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

    this.incomerTransactionStore = new TransactionStore({
      prefix: options.prefix,
      instance: "incomer"
    });

    this.dispatcherTransactionStore = new TransactionStore({
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

    this.checkLastActivityInterval = setInterval(async() => {
      try {
        await this.checkLastActivity();
      }
      catch (error) {
        console.error(error);
      }
    }, options.checkLastActivityInterval ?? kCheckLastActivityInterval).unref();

    this.checkRelatedTransactionInterval = setInterval(async() => {
      try {
        const [dispatcherTransactions, incomerTransactions] = await Promise.all([
          await this.dispatcherTransactionStore.getTransactions(),
          await this.incomerTransactionStore.getTransactions()
        ]);

        // Resolve Dispatcher transactions
        await this.resolveDispatcherTransactions(dispatcherTransactions, incomerTransactions);

        // Resolve main transactions
        await this.resolveIncomerMainTransactions(dispatcherTransactions, incomerTransactions);
      }
      catch (error) {
        console.error(error);
      }
    }, options.checkTransactionInterval ?? kCheckRelatedTransactionInterval).unref();
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

  public async close() {
    if (!this.subscriber) {
      return;
    }

    clearInterval(this.pingInterval);
    this.pingInterval = undefined;

    clearInterval(this.checkRelatedTransactionInterval);
    this.checkRelatedTransactionInterval = undefined;

    clearInterval(this.checkLastActivityInterval);
    this.checkLastActivityInterval = undefined;

    await this.subscriber.quit();
    this.subscriber = undefined;
  }

  private async ping() {
    for (const treeName of treeNames) {
      const tree = await this.getTree(treeName);

      if (!tree) {
        continue;
      }

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

          const transactionId = await this.dispatcherTransactionStore.setTransaction({
            ...event,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: null
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

    for await (const [transactionId, transaction] of Object.entries(this.dispatcherTransactionStore.getTransactions())) {
      if (transaction.metadata.to === uuid) {
        // Delete ping interaction since the incomer is off
        if (transaction.event === "ping") {
          this.dispatcherTransactionStore.deleteTransaction(transactionId);
        }

        // redistribute events & so transactions to according incomers

        // delete the previous transactions
      }
    }
  }

  private async resolveDispatcherTransactions(
    dispatcherTransactions: Transactions<"dispatcher">,
    incomerTransactions: Transactions<"incomer">
  ) {
    for (const [dispatcherTransactionId, dispatcherTransaction] of Object.entries(dispatcherTransactions)) {
      // If Transaction is already resolved, skip
      if (dispatcherTransaction.resolved) {
        continue;
      }

      const relatedTransactionId = Object.keys(incomerTransactions).find(
        (incomerTransactionId) => incomerTransactions[incomerTransactionId].relatedTransaction === dispatcherTransactionId
      );

      // Event not resolved yet
      if (!relatedTransactionId) {
        continue;
      }

      // Only in case of ping event
      if (dispatcherTransaction.mainTransaction) {
        await Promise.all([
          this.updateIncomerState(incomerTransactions[relatedTransactionId]),
          this.incomerTransactionStore.deleteTransaction(relatedTransactionId),
          this.dispatcherTransactionStore.deleteTransaction(dispatcherTransactionId)
        ]);

        continue;
      }

      dispatcherTransaction.resolved = true;
      await Promise.all([
        this.incomerTransactionStore.deleteTransaction(relatedTransactionId),
        this.dispatcherTransactionStore.updateTransaction(dispatcherTransactionId, dispatcherTransaction)
      ]);
    }
  }

  private async resolveIncomerMainTransactions(
    dispatcherTransactions: Transactions<"dispatcher">,
    incomerTransactions: Transactions<"incomer">
  ) {
    for (const [incomerTransactionId, incomerTransaction] of Object.entries(incomerTransactions)) {
      if (!incomerTransaction.mainTransaction) {
        continue;
      }

      const relatedDispatcherTransactionsId = Object.keys(dispatcherTransactions).filter(
        (dispatcherTransactionId) => dispatcherTransactions[dispatcherTransactionId].relatedTransaction === incomerTransactionId
      );

      // Event not resolved yet by the dispatcher
      if (relatedDispatcherTransactionsId.length === 0) {
        continue;
      }

      const unResolvedRelatedTransactions = [];
      for (const relatedTransaction of unResolvedRelatedTransactions) {
        if (!dispatcherTransactions[relatedTransaction].resolved) {
          unResolvedRelatedTransactions.push(relatedTransaction);
        }
      }

      // Event not resolved yet by the different incomers
      if (unResolvedRelatedTransactions.length > 0) {
        continue;
      }

      const transactionsToResolve = [];
      const incomerStateToUpdate = [];

      for (const relatedDispatcherTransactionId of relatedDispatcherTransactionsId) {
        incomerStateToUpdate.push(this.updateIncomerState(
          incomerTransactions[dispatcherTransactions[relatedDispatcherTransactionId].relatedTransaction]
        ));
        transactionsToResolve.push(this.dispatcherTransactionStore.deleteTransaction(relatedDispatcherTransactionId));
      }

      await Promise.all([
        ...transactionsToResolve,
        ...incomerStateToUpdate,
        this.incomerTransactionStore.deleteTransaction(incomerTransactionId)
      ]);
    }
  }

  private async updateIncomerState(transaction: Transaction<"incomer">) {
    const { aliveSince, metadata } = transaction;
    const { prefix, origin } = metadata;
    const treeName = `${prefix ? `${prefix}-` : ""}${kIncomerStoreName}`;
    const tree = await this.getTree(treeName);


    if (!tree[origin]) {
      throw new Error("Couldn't find the related incomer");
    }

    tree[origin].lastActivity = aliveSince;

    await this.incomerStore.setValue({
      key: treeName,
      value: tree
    });
  }

  private async getTree(treeName: string): Promise<IncomerStore> {
    const tree = await this.incomerStore.getValue(treeName);

    return tree ?? {};
  }

  private async handleMessages(channel: string, message: string) {
    if (!message) {
      return;
    }

    const formattedMessage: DispatcherChannelMessages["IncomerMessages"] |
      IncomerChannelMessages["IncomerMessage"] = JSON.parse(message);

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
        else {
          throw new Error("Unknown event on Dispatcher Channel");
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

  private async handleDispatcherMessages(
    message: DispatcherChannelMessages["IncomerMessages"]
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
    message: IncomerChannelMessages["IncomerMessage"]
  ) {
    const { event, metadata } = message;
    const { prefix, origin } = metadata;

    const logData = {
      ...message,
      uptime: process.uptime()
    };

    const relatedIncomerTreeName = `${prefix ? `${prefix}-` : ""}${kIncomerStoreName}`;

    const incomerTree = await this.getTree(relatedIncomerTreeName);
    if (!incomerTree[origin]) {
      throw new Error("Couldn't find the related incomer");
    }

    const concernedIncomers = Object.values(incomerTree)
      .filter((incomer) => incomer.subscribeTo.find((subscribedEvent) => subscribedEvent.name === event));

    const filteredConcernedIncomers: RegisteredIncomer[] = [];
    for (const incomer of concernedIncomers) {
      const relatedEvent: SubscribeTo = incomer.subscribeTo.find((value) => value.name === event);

      // Prevent publishing an event to multiple instance of a same service if no horizontalScale of the event
      if (!relatedEvent.horizontalScale && filteredConcernedIncomers.find((value) => value.name === incomer.name)) {
        continue;
      }

      filteredConcernedIncomers.push(incomer);
    }

    // All or nothing ?
    for (const incomer of filteredConcernedIncomers) {
      const relatedChannel = this.incomerChannels.get(incomer.providedUuid);

      if (!relatedChannel) {
        throw new Error("Channel not found");
      }

      const formattedEvent = {
        ...message,
        metadata: {
          origin: this.privateUuid,
          to: incomer.providedUuid
        }
      };

      // Create dispatcher transaction for the concerned incomer
      const dispatcherTransactionId = await this.dispatcherTransactionStore.setTransaction({
        ...formattedEvent,
        mainTransaction: null,
        relatedTransaction: metadata.transactionId,
        resolved: false
      });

      // Send the event to the concerned incomer.
      await relatedChannel.publish({
        ...formattedEvent,
        metadata: {
          ...formattedEvent.metadata,
          transactionId: dispatcherTransactionId
        }
      });

      this.logger.info(channel, logData, "injected event");
    }
  }

  private async approveService(message: IncomerRegistrationMessage) {
    const { data, metadata } = message;
    const { prefix, origin, transactionId } = metadata;

    const providedUuid = randomUUID();

    const relatedTransaction = await this.incomerTransactionStore.getTransactionById(transactionId);
    if (!relatedTransaction) {
      throw new Error("No related transaction found next to register event");
    }

    // Get Incomers Tree
    const incomerTreeName = `${prefix ? `${prefix}-` : ""}${kIncomerStoreName}`;
    const relatedIncomerTree = await this.getTree(incomerTreeName);

    // Avoid multiple init from a same instance of a service
    for (const service of Object.values(relatedIncomerTree)) {
      if (service.baseUuid === origin) {
        throw new Error("Forbidden multiple registration for a same instance");
      }
    }

    // Update the tree
    const now = Date.now();

    const service = Object.assign({}, {
      providedUuid,
      baseUuid: origin,
      ...data,
      lastActivity: now,
      aliveSince: now,
      prefix
    });

    relatedIncomerTree[providedUuid] = service;

    await this.incomerStore.setValue({
      key: incomerTreeName,
      value: relatedIncomerTree
    });

    // Subscribe to the exclusive service channel
    this.incomerChannels.set(providedUuid, new Redis.Channel({
      name: providedUuid,
      prefix
    }));

    await this.subscriber.subscribe(`${prefix ? `${prefix}-` : ""}${providedUuid}`);

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

    // Approve the service & send him info so he can use the dedicated channel
    await this.dispatcherChannel.publish(event);
    await this.incomerTransactionStore.deleteTransaction(transactionId);

    this.logger.info({
      ...event,
      uptime: process.uptime()
    }, "New approvement event");
  }
}
