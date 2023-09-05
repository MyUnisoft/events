/* eslint-disable max-lines */
// Import Node.js Dependencies
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import {
  Channel,
  getRedis,
  KVPeer
} from "@myunisoft/redis";
import { Logger, pino } from "pino";
import Ajv, { ValidateFunction } from "ajv";
import { match } from "ts-pattern";

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
  EventCast,
  EventSubscribe,
  DispatcherChannelMessages,
  IncomerChannelMessages,
  DispatcherRegistrationMessage,
  IncomerRegistrationMessage,
  DispatcherPingMessage,
  DistributedEventMessage,
  EventMessage,
  GenericEvent
} from "../../types/eventManagement/index";
import * as eventsSchema from "../../schema/eventManagement/index";
import { CustomEventsValidationFunctions, defaultStandardLog, StandardLog } from "../../utils/index";

// CONSTANTS
const ajv = new Ajv();
const kIdleTime = 60_000 * 10;
const kCheckLastActivityInterval = 60_000 * 2;
const kCheckRelatedTransactionInterval = 60_000 * 3;
const kBackupTransactionStoreName = "backup";
export const PING_INTERVAL = 60_000 * 5;

interface RegisteredIncomer {
  providedUUID: string;
  baseUUID: string;
  name: string;
  lastActivity: number;
  aliveSince: number;
  eventsCast: EventCast[];
  eventsSubscribe: EventSubscribe[];
  prefix?: string;
}

type IncomerStore = Record<string, RegisteredIncomer>;

export type DispatcherOptions<T extends GenericEvent = GenericEvent> = {
  /* Prefix for the channel name, commonly used to distinguish envs */
  name: string;
  prefix?: Prefix;
  logger?: Partial<Logger> & Pick<Logger, "info" | "warn">;
  standardLog?: StandardLog<T>;
  eventsValidation?: {
    eventsValidationFn?: Map<string, ValidateFunction<Record<string, any>> | CustomEventsValidationFunctions>;
    validationCbFn?: (event: T) => void;
  },
  pingInterval?: number;
  checkLastActivityInterval?: number;
  checkTransactionInterval?: number;
  idleTime?: number;
};

type DispatcherChannelEvents = { name: "register" };

function isDispatcherChannelMessage<T extends GenericEvent = GenericEvent>(
  value: DispatcherChannelMessages["IncomerMessages"] |
  IncomerChannelMessages<T>["IncomerMessages"]
): value is DispatcherChannelMessages["IncomerMessages"] {
  return value.name === "register";
}

function isIncomerChannelMessage<T extends GenericEvent = GenericEvent>(
  value: DispatcherChannelMessages["IncomerMessages"] |
  IncomerChannelMessages<T>["IncomerMessages"]
): value is IncomerChannelMessages<T>["IncomerMessages"] {
  return value.name !== "register";
}

function isIncomerRegistrationMessage(
  value: DispatcherChannelMessages["IncomerMessages"]
): value is IncomerRegistrationMessage {
  return value.name === "register";
}

export class Dispatcher<T extends GenericEvent = GenericEvent> {
  readonly type = "dispatcher";
  readonly formattedPrefix: string;
  readonly prefix: string;
  readonly treeName: string;
  readonly dispatcherChannelName: string;
  readonly privateUUID = randomUUID();

  private dispatcherName: string;
  private dispatcherChannel: Channel<DispatcherChannelMessages["DispatcherMessages"]>;
  private incomerStore: KVPeer<IncomerStore>;
  private dispatcherTransactionStore: TransactionStore<"dispatcher">;
  private backupIncomerTransactionStore: TransactionStore<"incomer">;
  private backupDispatcherTransactionStore: TransactionStore<"dispatcher">;

  private logger: Partial<Logger> & Pick<Logger, "info" | "warn">;
  private incomerChannels: Map<string,
    Channel<IncomerChannelMessages<T>["DispatcherMessages"] | DistributedEventMessage<T>>> = new Map();

  private pingInterval: NodeJS.Timer;
  private checkLastActivityInterval: NodeJS.Timer;
  private checkRelatedTransactionInterval: NodeJS.Timer;
  private idleTime: number;

  private eventsValidationFn: Map<string, ValidateFunction<Record<string, any>> | CustomEventsValidationFunctions>;
  private validationCbFn: (event: T) => void = null;
  private standardLogFn: StandardLog<T>;

  constructor(options: DispatcherOptions<T>) {
    this.dispatcherName = options.name;
    this.prefix = options.prefix ?? "";
    this.formattedPrefix = options.prefix ? `${options.prefix}-` : "";
    this.treeName = kIncomerStoreName;
    this.dispatcherChannelName = this.formattedPrefix + channels.dispatcher;
    this.idleTime = options.idleTime ?? kIdleTime;
    this.standardLogFn = options.standardLog ?? defaultStandardLog;

    this.eventsValidationFn = options?.eventsValidation?.eventsValidationFn ?? new Map();
    this.validationCbFn = options?.eventsValidation?.validationCbFn;

    for (const [name, validationSchema] of Object.entries(eventsSchema)) {
      this.eventsValidationFn.set(name, ajv.compile(validationSchema));
    }

    this.logger = options.logger ?? pino({
      name: this.formattedPrefix + this.type,
      level: "info",
      transport: {
        target: "pino-pretty"
      }
    });

    this.incomerStore = new KVPeer({
      prefix: this.prefix,
      type: "object"
    });

    this.backupIncomerTransactionStore = new TransactionStore({
      prefix: this.formattedPrefix + kBackupTransactionStoreName,
      instance: "incomer"
    });

    this.backupDispatcherTransactionStore = new TransactionStore({
      prefix: this.formattedPrefix + kBackupTransactionStoreName,
      instance: "dispatcher"
    });

    this.dispatcherTransactionStore = new TransactionStore({
      prefix: this.prefix,
      instance: "dispatcher"
    });

    this.dispatcherChannel = new Channel({
      prefix: this.prefix,
      name: channels.dispatcher
    });

    this.pingInterval = setInterval(async() => {
      try {
        await this.ping();
      }
      catch (error) {
        this.logger.error(error.message);
      }
    }, options.pingInterval ?? PING_INTERVAL).unref();

    this.checkLastActivityInterval = setInterval(async() => {
      try {
        await this.checkLastActivity();
      }
      catch (error) {
        this.logger.error(error.message);
      }
    }, options.checkLastActivityInterval ?? kCheckLastActivityInterval).unref();

    this.checkRelatedTransactionInterval = setInterval(async() => {
      try {
        const dispatcherTransactions = await this.dispatcherTransactionStore.getTransactions();

        // Resolve Dispatcher transactions
        await this.resolveDispatcherTransactions(dispatcherTransactions);

        // Resolve main transactions
        await this.resolveIncomerMainTransactions(dispatcherTransactions);
      }
      catch (error) {
        this.logger.error(error.message);
      }
    }, options.checkTransactionInterval ?? kCheckRelatedTransactionInterval).unref();
  }

  get subscriber() {
    return getRedis("subscriber");
  }

  public async initialize() {
    await this.subscriber.subscribe(this.dispatcherChannelName);

    this.subscriber.on("message", (channel, message) => this.handleMessages(channel, message));
  }

  public close() {
    clearInterval(this.pingInterval);
    this.pingInterval = undefined;

    clearInterval(this.checkRelatedTransactionInterval);
    this.checkRelatedTransactionInterval = undefined;

    clearInterval(this.checkLastActivityInterval);
    this.checkLastActivityInterval = undefined;
  }

  private async ping() {
    const tree = await this.getTree();

    for (const [uuid, incomer] of Object.entries(tree)) {
      if (incomer.name === this.dispatcherName) {
        continue;
      }

      const incomerChannel = this.incomerChannels.get(uuid) ??
        new Channel({
          name: uuid,
          prefix: incomer.prefix
        });

      const event: DispatcherPingMessage = {
        name: "ping",
        data: null,
        redisMetadata: {
          origin: this.privateUUID,
          to: uuid
        }
      };

      await this.publishEvent({
        concernedChannel: incomerChannel,
        transactionMeta: {
          mainTransaction: true,
          relatedTransaction: null,
          resolved: false
        },
        formattedEvent: event
      });

      this.logger.info(event, "New Ping event");
    }
  }

  private async checkLastActivity() {
    const tree = await this.getTree();

    const now = Date.now();

    const nonactives = Object.values(tree).filter((incomer) => now > incomer.lastActivity + this.idleTime);

    if (nonactives.length === 0) {
      return;
    }

    for (const inactive of nonactives) {
      delete tree[inactive.providedUUID];
    }

    try {
      if (Object.keys(tree).length > 0) {
        await this.incomerStore.deleteValue(this.treeName);
        await this.incomerStore.setValue({
          key: this.treeName,
          value: tree
        });
      }
      else {
        await this.incomerStore.deleteValue(this.treeName);
      }

      const toHandle = [];

      for (const inactive of nonactives) {
        const transactionStore = new TransactionStore({
          prefix: `${inactive.prefix ? `${inactive.prefix}-` : ""}${inactive.providedUUID}`,
          instance: "incomer"
        });

        const [incomerTransactions, dispatcherTransactions] = await Promise.all([
          transactionStore.getTransactions(),
          this.dispatcherTransactionStore.getTransactions()
        ]);

        toHandle.push(this.InactiveIncomerTransactionsResolution({
          incomers: tree,
          incomerUUID: inactive.providedUUID,
          incomerTransactionStore: transactionStore,
          incomerTransactions,
          dispatcherTransactions
        }));
      }

      await Promise.all(toHandle);
    }
    catch (error) {
      this.logger.error(
        { uuids: [...nonactives.map((incomer) => incomer.providedUUID)].join(",") },
        "Failed to remove nonactives incomers"
      );
    }

    this.logger.info({ uuids: [...nonactives.map((incomer) => incomer.providedUUID)].join(",") }, "Removed nonactives incomers");
  }

  private async publishEvent(options: {
    concernedStore?: TransactionStore<"incomer">;
    concernedChannel: Channel<
      DispatcherChannelMessages["DispatcherMessages"] |
      (IncomerChannelMessages<T>["DispatcherMessages"] | DistributedEventMessage<T>)
    >;
    transactionMeta: {
      mainTransaction: boolean;
      relatedTransaction: null | string;
      resolved: boolean;
    };
    formattedEvent: any;
  }) {
    const {
      concernedChannel,
      transactionMeta,
      formattedEvent
    } = options;
    const {
      mainTransaction,
      relatedTransaction,
      resolved
    } = transactionMeta;

    const concernedStore = options.concernedStore ?? this.dispatcherTransactionStore;

    const transactionId = await concernedStore.setTransaction({
      ...formattedEvent,
      mainTransaction,
      relatedTransaction,
      resolved
    });

    await concernedChannel.publish({
      ...formattedEvent,
      redisMetadata: {
        ...formattedEvent.redisMetadata,
        transactionId
      }
    });
  }

  private async InactiveIncomerTransactionsResolution(options: {
    incomers: IncomerStore,
    incomerUUID: string,
    incomerTransactionStore: TransactionStore<"incomer">,
    incomerTransactions: Transactions<"incomer">,
    dispatcherTransactions: Transactions<"dispatcher">
  }
  ) {
    const {
      incomers,
      incomerUUID,
      incomerTransactionStore,
      incomerTransactions,
      dispatcherTransactions
    } = options;

    for (const [incomerTransactionId, incomerTransaction] of incomerTransactions.entries()) {
      // Remove possible ping response
      if (incomerTransaction.name === "ping") {
        await Promise.all([
          incomerTransactionStore.deleteTransaction(incomerTransactionId),
          this.dispatcherTransactionStore.deleteTransaction(incomerTransaction.relatedTransaction)
        ]);

        continue;
      }

      if (incomerTransaction.mainTransaction) {
        if (incomerTransaction.name === "register") {
          const relatedDispatcherTransactionId = Object.keys(dispatcherTransactions)
            .find(
              (dispatcherTransactionId) => dispatcherTransactions[dispatcherTransactionId].relatedTransaction ===
                incomerTransactionId
            );

          if (relatedDispatcherTransactionId) {
            await this.dispatcherTransactionStore.deleteTransaction(relatedDispatcherTransactionId);
          }

          await incomerTransactionStore.deleteTransaction(incomerTransactionId);

          continue;
        }

        const concernedMainTransactionIncomer = Object.values(incomers).find(
          (incomer) => incomer.eventsCast.find(
            (eventCast) => eventCast === incomerTransaction.name
          )
        );

        if (!concernedMainTransactionIncomer) {
          await Promise.all([
            incomerTransactionStore.deleteTransaction(incomerTransactionId),
            this.backupIncomerTransactionStore.setTransaction({
              ...incomerTransaction
            })
          ]);

          continue;
        }

        const { prefix, providedUUID } = concernedMainTransactionIncomer;

        const concernedIncomerStore = new TransactionStore({
          prefix: `${prefix ? `${prefix}-` : ""}${providedUUID}`,
          instance: "incomer"
        });

        await Promise.all([
          concernedIncomerStore.setTransaction({
            ...incomerTransaction,
            redisMetadata: {
              ...incomerTransaction.redisMetadata,
              origin: providedUUID
            }
          }),
          incomerTransactionStore.deleteTransaction(incomerTransactionId)
        ]);

        continue;
      }

      if (incomerTransaction.relatedTransaction) {
        const concernedRelatedTransactionIncomer = Object.values(incomers).find(
          (incomer) => incomer.eventsSubscribe.find(
            (subscribedEvent) => subscribedEvent.name === incomerTransaction.name
          )
        );

        if (!concernedRelatedTransactionIncomer || incomerTransaction.resolved) {
          await Promise.all([
            incomerTransactionStore.deleteTransaction(incomerTransactionId),
            this.backupIncomerTransactionStore.setTransaction({
              ...incomerTransaction
            })
          ]);

          continue;
        }

        const { providedUUID, prefix } = concernedRelatedTransactionIncomer;

        let concernedIncomerChannel = this.incomerChannels.get(providedUUID);

        if (!concernedIncomerChannel) {
          concernedIncomerChannel = new Channel({
            name: providedUUID,
            prefix
          });

          this.incomerChannels.set(providedUUID, concernedIncomerChannel);
        }

        await Promise.all([
          this.publishEvent({
            concernedChannel: concernedIncomerChannel,
            transactionMeta: {
              mainTransaction: incomerTransaction.mainTransaction,
              relatedTransaction: incomerTransaction.relatedTransaction,
              resolved: incomerTransaction.resolved
            },
            formattedEvent: {
              ...incomerTransaction,
              redisMetadata: {
                origin: this.privateUUID,
                to: providedUUID
              }
            }
          }),
          incomerTransactionStore.deleteTransaction(incomerTransactionId)
        ]);

        continue;
      }

      this.logger.warn(this.standardLogFn(incomerTransaction as T)("Redistributed injected event to an Incomer"));
    }

    for (const [dispatcherTransactionId, dispatcherTransaction] of dispatcherTransactions.entries()) {
      if (dispatcherTransaction.redisMetadata.to === incomerUUID) {
        if (dispatcherTransaction.name === "ping") {
          await this.dispatcherTransactionStore.deleteTransaction(dispatcherTransactionId);

          continue;
        }

        if (dispatcherTransaction.relatedTransaction) {
          const concernedIncomer = Object.values(incomers).find(
            (incomer) => incomer.eventsSubscribe.find(
              (eventSubscribe) => eventSubscribe.name === dispatcherTransaction.name
            )
          );

          if (!concernedIncomer) {
            delete dispatcherTransaction.redisMetadata;
            delete dispatcherTransaction.aliveSince;

            await Promise.all([
              this.dispatcherTransactionStore.deleteTransaction(dispatcherTransactionId),
              this.backupDispatcherTransactionStore.setTransaction({ ...dispatcherTransaction })
            ]);

            continue;
          }

          const { providedUUID, prefix } = concernedIncomer;

          let concernedIncomerChannel = this.incomerChannels.get(providedUUID);

          if (!concernedIncomerChannel) {
            concernedIncomerChannel = new Channel({
              name: providedUUID,
              prefix
            });

            this.incomerChannels.set(providedUUID, concernedIncomerChannel);
          }

          await Promise.all([
            this.publishEvent({
              concernedChannel: concernedIncomerChannel,
              transactionMeta: {
                mainTransaction: dispatcherTransaction.mainTransaction,
                relatedTransaction: dispatcherTransaction.relatedTransaction,
                resolved: dispatcherTransaction.resolved
              },
              formattedEvent: {
                ...dispatcherTransaction,
                redisMetadata: {
                  origin: this.privateUUID,
                  to: concernedIncomer.providedUUID
                }
              }
            }),
            this.dispatcherTransactionStore.deleteTransaction(dispatcherTransactionId)
          ]);
        }

        this.logger.warn(this.standardLogFn(dispatcherTransaction as T)("Redistributed unresolved injected event to an Incomer"));
      }
    }
  }

  private async checkForDistributableIncomerTransactions(backedUpIncomerTransactions: Transactions<"incomer">) {
    const toResolve = [];

    const incomers = await this.getTree();

    for (const [backedUpTransactionId, backedUpTransaction] of backedUpIncomerTransactions.entries()) {
      if (backedUpTransaction.mainTransaction) {
        const concernedIncomer = Object.values(incomers).find(
          (incomer) => incomer.eventsCast.find(
            (castedEvent) => castedEvent === backedUpTransaction.name
          )
        );

        if (!concernedIncomer) {
          continue;
        }

        const concernedIncomerStore = new TransactionStore({
          prefix: `${concernedIncomer.prefix ? `${concernedIncomer.prefix}-` : ""}${concernedIncomer.providedUUID}`,
          instance: "incomer"
        });

        toResolve.push(
          concernedIncomerStore.setTransaction({
            ...backedUpTransaction,
            redisMetadata: {
              ...backedUpTransaction.redisMetadata,
              origin: concernedIncomer.providedUUID
            }
          }),
          this.backupIncomerTransactionStore.deleteTransaction(backedUpTransactionId)
        );
      }

      if (backedUpTransaction.relatedTransaction && !backedUpTransaction.resolved) {
        const concernedIncomer = Object.values(incomers).find(
          (incomer) => incomer.eventsSubscribe.find(
            (subscribedEvent) => subscribedEvent.name === backedUpTransaction.name
          )
        );

        if (!concernedIncomer) {
          continue;
        }

        const { providedUUID, prefix } = concernedIncomer;

        let concernedIncomerChannel = this.incomerChannels.get(providedUUID);

        if (!concernedIncomerChannel) {
          concernedIncomerChannel = new Channel({
            name: providedUUID,
            prefix
          });

          this.incomerChannels.set(providedUUID, concernedIncomerChannel);
        }

        toResolve.push([
          this.publishEvent({
            concernedChannel: concernedIncomerChannel,
            transactionMeta: {
              mainTransaction: backedUpTransaction.mainTransaction,
              relatedTransaction: backedUpTransaction.relatedTransaction,
              resolved: backedUpTransaction.resolved
            },
            formattedEvent: {
              ...backedUpTransaction,
              redisMetadata: {
                origin: this.privateUUID,
                to: concernedIncomer.providedUUID
              }
            }
          }),
          this.backupIncomerTransactionStore.deleteTransaction(backedUpTransactionId)
        ]);
      }
    }

    await Promise.all(toResolve);
  }

  private async checkForDistributableDispatcherTransactions(
    backedUpDispatcherTransactions: Transactions<"dispatcher">,
    incomers: IncomerStore
  ) {
    for (const [backedUpDispatcherTransactionId, backedUpDispatcherTransaction] of backedUpDispatcherTransactions.entries()) {
      const concernedIncomer = Object.values(incomers).find(
        (incomer) => incomer.eventsSubscribe.find(
          (eventSubscribe) => eventSubscribe.name === backedUpDispatcherTransaction.name
        )
      );

      if (!concernedIncomer) {
        continue;
      }

      const { providedUUID, prefix } = concernedIncomer;

      let concernedIncomerChannel = this.incomerChannels.get(concernedIncomer.providedUUID);

      if (!concernedIncomerChannel) {
        concernedIncomerChannel = new Channel({
          name: providedUUID,
          prefix
        });

        this.incomerChannels.set(providedUUID, concernedIncomerChannel);
      }

      await Promise.all([
        this.publishEvent({
          concernedChannel: concernedIncomerChannel,
          transactionMeta: {
            mainTransaction: backedUpDispatcherTransaction.mainTransaction,
            relatedTransaction: backedUpDispatcherTransaction.relatedTransaction,
            resolved: backedUpDispatcherTransaction.resolved
          },
          formattedEvent: {
            ...backedUpDispatcherTransaction,
            redisMetadata: {
              origin: this.privateUUID,
              to: concernedIncomer.providedUUID
            }
          }
        }),
        this.backupDispatcherTransactionStore.deleteTransaction(backedUpDispatcherTransactionId)
      ]);
    }
  }

  private async resolveDispatcherTransactions(
    dispatcherTransactions: Transactions<"dispatcher">
  ) {
    const backedUpIncomerTransactions = await this.backupIncomerTransactionStore.getTransactions();
    const backedUpDispatcherTransactions = await this.backupDispatcherTransactionStore.getTransactions();

    const incomers = await this.getTree();

    await this.checkForDistributableIncomerTransactions(backedUpIncomerTransactions);
    await this.checkForDistributableDispatcherTransactions(backedUpDispatcherTransactions, incomers);

    for (const [dispatcherTransactionId, dispatcherTransaction] of dispatcherTransactions.entries()) {
      // If Transaction is already resolved, skip
      if (dispatcherTransaction.resolved) {
        continue;
      }

      const relatedIncomer = incomers[dispatcherTransaction.redisMetadata.to];

      if (!relatedIncomer) {
        continue;
      }

      const prefix = incomers[dispatcherTransaction.redisMetadata.to].prefix ?? "";
      const relatedIncomerTransactionStore = new TransactionStore({
        prefix: `${prefix ? `${prefix}-` : ""}${dispatcherTransaction.redisMetadata.to}`,
        instance: "incomer"
      });

      const relatedIncomerTransactions = await relatedIncomerTransactionStore.getTransactions();

      const relatedIncomerTransactionId = [...relatedIncomerTransactions.keys()].find(((relatedIncomerTransactionId) => {
        const incomerTransaction = relatedIncomerTransactions.get(relatedIncomerTransactionId);
        const { relatedTransaction, resolved } = incomerTransaction;

        return relatedTransaction === dispatcherTransactionId && resolved;
      }));

      // Event not resolved yet
      if (!relatedIncomerTransactionId) {
        continue;
      }

      if (dispatcherTransaction.mainTransaction) {
        // Only in case of ping event
        await Promise.all([
          this.updateIncomerState(relatedIncomerTransactions.get(relatedIncomerTransactionId).redisMetadata.origin),
          relatedIncomerTransactionStore.deleteTransaction(relatedIncomerTransactionId),
          this.dispatcherTransactionStore.deleteTransaction(dispatcherTransactionId)
        ]);

        continue;
      }

      dispatcherTransaction.resolved = true;
      await Promise.all([
        this.updateIncomerState(relatedIncomerTransactions.get(relatedIncomerTransactionId).redisMetadata.origin),
        relatedIncomerTransactionStore.deleteTransaction(relatedIncomerTransactionId),
        this.dispatcherTransactionStore.updateTransaction(
          dispatcherTransactionId,
          dispatcherTransaction
        )
      ]);
    }
  }

  private async resolveIncomerMainTransactions(
    dispatcherTransactions: Transactions<"dispatcher">
  ) {
    const incomers = await this.getTree();

    for (const incomer of Object.values(incomers)) {
      const incomerStore = new TransactionStore({
        prefix: `${incomer.prefix ? `${incomer.prefix}-` : ""}${incomer.providedUUID}`,
        instance: "incomer"
      });

      const incomerTransactions = await incomerStore.getTransactions();

      for (const [incomerTransactionId, incomerTransaction] of incomerTransactions.entries()) {
        if (!incomerTransaction.mainTransaction) {
          continue;
        }

        const relatedDispatcherTransactionsId = [...dispatcherTransactions.keys()].filter(
          (dispatcherTransactionId) => dispatcherTransactions.get(dispatcherTransactionId).relatedTransaction ===
            incomerTransactionId
        );

        // Event not resolved yet by the dispatcher
        if (relatedDispatcherTransactionsId.length === 0) {
          continue;
        }

        const unResolvedRelatedTransactions = relatedDispatcherTransactionsId.filter(
          (transactionId) => !dispatcherTransactions.get(transactionId).resolved
        );

        // Event not resolved yet by the different incomers
        if (unResolvedRelatedTransactions.length > 0) {
          continue;
        }

        const transactionToResolve: Promise<void>[] = [];

        for (const relatedDispatcherTransactionId of relatedDispatcherTransactionsId) {
          transactionToResolve.push(this.updateIncomerState(
            incomerTransactions.get(
              dispatcherTransactions.get(relatedDispatcherTransactionId).relatedTransaction
            ).redisMetadata.origin
          ));
          transactionToResolve.push(this.dispatcherTransactionStore.deleteTransaction(relatedDispatcherTransactionId));
        }

        await Promise.all([
          ...transactionToResolve,
          incomerStore.deleteTransaction(incomerTransactionId)
        ]);
      }
    }
  }

  private async updateIncomerState(origin: string) {
    const tree = await this.getTree();

    if (!tree[origin]) {
      throw new Error("Couldn't find the related incomer");
    }

    tree[origin].lastActivity = Date.now();

    await this.incomerStore.setValue({
      key: this.treeName,
      value: tree
    });
  }

  private async getTree(): Promise<IncomerStore> {
    const tree = await this.incomerStore.getValue(this.treeName);

    return tree ?? {};
  }

  private schemaValidation(message: IncomerRegistrationMessage | EventMessage<T>) {
    const { redisMetadata, ...event } = message;

    const eventValidations = this.eventsValidationFn.get(event.name) as ValidateFunction<Record<string, any>>;
    const redisMetadataValidationFn = this.eventsValidationFn.get("redisMetadata") as ValidateFunction<Record<string, any>>;

    if (!eventValidations) {
      throw new Error("Unknown Event");
    }

    if (!redisMetadataValidationFn(redisMetadata)) {
      throw new Error("Malformed message");
    }

    if (this.validationCbFn && isIncomerChannelMessage(message) && event.name !== "ping") {
      this.validationCbFn({ ...message });

      return;
    }

    if (!eventValidations(event)) {
      throw new Error("Malformed message");
    }
  }

  private async handleMessages(channel: string, message: string) {
    if (!message) {
      return;
    }

    const formattedMessage: DispatcherChannelMessages["IncomerMessages"] |
      IncomerChannelMessages<T>["IncomerMessages"] = JSON.parse(message);

    try {
      if (!formattedMessage.name || !formattedMessage.redisMetadata) {
        throw new Error("Malformed message");
      }

      // Avoid reacting to his own message
      // Edge case when dispatcher is also an incomer and approve himself
      if (formattedMessage.redisMetadata.origin === this.privateUUID || formattedMessage.name === "approvement") {
        return;
      }

      this.schemaValidation(formattedMessage);

      if (channel === this.dispatcherChannelName) {
        if (isDispatcherChannelMessage(formattedMessage)) {
          await this.handleDispatcherMessages(channel, formattedMessage);
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
    channel: string,
    message: DispatcherChannelMessages["IncomerMessages"]
  ) {
    const { name } = message;

    const logData = {
      channel,
      ...message
    };

    match<DispatcherChannelEvents>({ name })
      .with({ name: "register" }, async() => {
        this.logger.info(logData, "Registration asked");

        if (isIncomerRegistrationMessage(message)) {
          await this.approveIncomer(message);
        }
      })
      .exhaustive()
      .catch((error) => {
        this.logger.error({ channel: "dispatcher", error: error.message, message });
      });
  }

  private async handleIncomerMessages(
    channel: string,
    message: IncomerChannelMessages<T>["IncomerMessages"]
  ) {
    const { redisMetadata, ...event } = message;
    const { name } = event;

    const logData = {
      channel,
      ...message
    };

    const incomerTree = await this.getTree();

    const concernedIncomers = Object.values(incomerTree)
      .filter(
        (incomer) => incomer.eventsSubscribe.find((subscribedEvent) => subscribedEvent.name === name) &&
        (incomer.providedUUID !== redisMetadata.origin || (incomer.name !== this.dispatcherName && name !== "ping"))
      );

    if (concernedIncomers.length === 0) {
      if (name === "ping") {
        this.logger.warn(logData, "No concerned Incomer found");
      }
      else {
        await this.backupDispatcherTransactionStore.setTransaction({
          ...event,
          redisMetadata: {
            origin: this.privateUUID,
            to: ""
          },
          mainTransaction: false,
          relatedTransaction: redisMetadata.transactionId,
          resolved: false
        } as Transaction<"dispatcher">);

        this.logger.warn(this.standardLogFn(logData)("Backed-up event"));
      }

      return;
    }

    const filteredConcernedIncomers: RegisteredIncomer[] = [];
    for (const incomer of concernedIncomers) {
      const relatedEvent = incomer.eventsSubscribe.find((subscribedEvent) => subscribedEvent.name === name);

      // Prevent publishing an event to multiple instance of a same service if no horizontalScale of the event
      if (!relatedEvent.horizontalScale &&
        filteredConcernedIncomers.find(
          (filteredConcernedIncomer) => filteredConcernedIncomer.eventsSubscribe.find(
            (subscribedEvent) => subscribedEvent.name === relatedEvent.name
          )
        ) !== undefined
      ) {
        continue;
      }

      filteredConcernedIncomers.push(incomer);
    }

    const toResolve: Promise<any>[] = [];
    for (const incomer of filteredConcernedIncomers) {
      const { providedUUID, prefix } = incomer;

      let concernedIncomerChannel = this.incomerChannels.get(providedUUID);

      if (!concernedIncomerChannel) {
        concernedIncomerChannel = new Channel({
          name: providedUUID,
          prefix
        });

        this.incomerChannels.set(providedUUID, concernedIncomerChannel);
      }

      if (!concernedIncomerChannel) {
        throw new Error("Channel not found");
      }

      const formattedEvent = {
        ...message,
        redisMetadata: {
          origin: this.privateUUID,
          to: providedUUID
        }
      };

      toResolve.push(this.publishEvent({
        concernedChannel: concernedIncomerChannel,
        transactionMeta: {
          mainTransaction: false,
          relatedTransaction: redisMetadata.transactionId,
          resolved: false
        },
        formattedEvent
      }));
    }

    await this.updateIncomerState(redisMetadata.origin);
    await Promise.all(toResolve);

    this.logger.info(this.standardLogFn(logData)("Custom event distributed"));
  }

  private async approveIncomer(message: IncomerRegistrationMessage) {
    const { data, redisMetadata } = message;
    const { prefix, origin, transactionId } = redisMetadata;

    const relatedTransactionStore = new TransactionStore<"incomer">({
      prefix: `${prefix ? `${prefix}-` : ""}${origin}`,
      instance: "incomer"
    });

    const relatedTransaction = await relatedTransactionStore.getTransactionById(transactionId);
    if (!relatedTransaction) {
      throw new Error("No related transaction found next to register event");
    }

    const providedUUID = randomUUID();

    // Get Incomers Tree
    const relatedIncomerTree = await this.getTree();

    // Avoid multiple init from a same instance of a incomer
    for (const incomer of Object.values(relatedIncomerTree)) {
      if (incomer.baseUUID === origin) {
        await this.dispatcherTransactionStore.deleteTransaction(transactionId);

        throw new Error("Forbidden multiple registration for a same instance");
      }
    }

    // Update the tree
    const now = Date.now();

    const incomer = Object.assign({}, {
      ...data,
      providedUUID,
      baseUUID: origin,
      lastActivity: now,
      aliveSince: now,
      prefix
    });

    relatedIncomerTree[providedUUID] = incomer;

    await this.incomerStore.setValue({
      key: this.treeName,
      value: relatedIncomerTree
    });

    // Subscribe to the exclusive service channel
    this.incomerChannels.set(providedUUID, new Channel({
      name: providedUUID,
      prefix
    }));

    await this.subscriber.subscribe(`${prefix ? `${prefix}-` : ""}${providedUUID}`);

    const event: DispatcherRegistrationMessage = {
      name: "approvement",
      data: {
        uuid: providedUUID
      },
      redisMetadata: {
        origin: this.privateUUID,
        to: redisMetadata.origin
      }
    };

    // Approve the service & send him info so he can use the dedicated channel
    await Promise.all([
      this.dispatcherChannel.publish(event),
      relatedTransactionStore.deleteTransaction(transactionId),
      this.dispatcherTransactionStore.deleteTransaction(transactionId)
    ]);

    this.logger.info("Approved Incomer");
  }
}
