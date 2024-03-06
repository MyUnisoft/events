/* eslint-disable max-lines */
// Import Node.js Dependencies
import { once, EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import {
  Channel,
  getRedis
} from "@myunisoft/redis";
import { Logger, pino } from "pino";
import Ajv, { ValidateFunction } from "ajv";
import { match } from "ts-pattern";

// Import Internal Dependencies
import {
  channels
} from "../../utils/config";
import {
  PartialTransaction,
  Transaction,
  Transactions,
  TransactionStore
} from "../store/transaction.class";
import {
  Prefix,
  DispatcherChannelMessages,
  IncomerChannelMessages,
  DispatcherRegistrationMessage,
  IncomerRegistrationMessage,
  DispatcherPingMessage,
  DistributedEventMessage,
  EventMessage,
  GenericEvent,
  CloseMessage
} from "../../types/eventManagement/index";
import * as eventsSchema from "../../schema/eventManagement/index";
import { CustomEventsValidationFunctions, defaultStandardLog, handleLoggerMode, StandardLog } from "../../utils/index";
import { IncomerStore, RegisteredIncomer } from "../store/incomer.class";

// CONSTANTS
const ajv = new Ajv();
const kIdleTime = Number.isNaN(Number(process.env.MYUNISOFT_DISPATCHER_IDLE_TIME)) ? 60_000 * 10 :
  Number(process.env.MYUNISOFT_DISPATCHER_IDLE_TIME);
const kCheckLastActivityInterval = Number.isNaN(
  Number(process.env.MYUNISOFT_DISPATCHER_CHECK_LAST_ACTIVITY_INTERVAL)
) ? 60_000 * 2 : Number(process.env.MYUNISOFT_DISPATCHER_CHECK_LAST_ACTIVITY_INTERVAL);
const kCheckRelatedTransactionInterval = Number.isNaN(
  Number(process.env.MYUNISOFT_DISPATCHER_RESOLVE_TRANSACTION_INTERVAL)
) ? 60_000 * 3 : Number(process.env.MYUNISOFT_DISPATCHER_RESOLVE_TRANSACTION_INTERVAL);
const kBackupTransactionStoreName = String(process.env.MYUNISOFT_DISPATCHER_BACKUP_TRANSACTION_STORE_NAME ?? "backup");
const kLoggerMode = (handleLoggerMode(process.env.MYUNISOFT_EVENTS_LOGGER_MODE));
const kMaxInitTimeout = Number.isNaN(Number(process.env.MYUNISOFT_DISPATCHER_INIT_TIMEOUT)) ? 3_500 :
  Number(process.env.MYUNISOFT_DISPATCHER_INIT_TIMEOUT);
export const PING_INTERVAL = Number.isNaN(Number(process.env.MYUNISOFT_DISPATCHER_PING_INTERVAL)) ? 60_000 * 5 :
  Number(process.env.MYUNISOFT_DISPATCHER_PING_INTERVAL);

export type DispatcherOptions<T extends GenericEvent = GenericEvent> = {
  /* Prefix for the channel name, commonly used to distinguish envs */
  prefix?: Prefix;
  logger?: Partial<Logger> & Pick<Logger, "info" | "warn" | "debug">;
  standardLog?: StandardLog<T>;
  eventsValidation?: {
    eventsValidationFn?: Map<string, ValidateFunction<Record<string, any>> | CustomEventsValidationFunctions>;
    validationCbFn?: (event: T) => void;
  };
  pingInterval?: number;
  checkLastActivityInterval?: number;
  checkTransactionInterval?: number;
  idleTime?: number;
  /** Used to avoid self ping & as discriminant for dispatcher instance that scale */
  incomerUUID?: string;
  /** Used as discriminant for dispatcher instance that scale */
  instanceName?: string;
};

type DispatcherChannelEvents = { name: "register" };

interface PublishEventOptions<T extends GenericEvent> {
  concernedStore?: TransactionStore<"incomer">;
    concernedChannel: Channel<
      DispatcherChannelMessages["DispatcherMessages"] |
      (IncomerChannelMessages<T>["DispatcherMessages"] | DistributedEventMessage<T>)
    >;
    transactionMeta: {
      mainTransaction: boolean;
      relatedTransaction: null | string;
      eventTransactionId: null | string;
      resolved: boolean;
    };
    formattedEvent: any;
}

interface DistributeMainTransactionOptions {
  concernedPublisher: RegisteredIncomer;
  mainTransaction: Transaction<"incomer">;
  incomerTransactionStore: TransactionStore<"incomer">;
  transactionId: string;
}

interface BackupSpreadTransactionsOptions {
  concernedDispatcherTransactions: Transactions<"dispatcher">;
  handlerIncomerTransactions: Transactions<"incomer">;
  incomerToRemoveTransactionStore: TransactionStore<"incomer">;
  incomers: Set<RegisteredIncomer>;
}

interface InactiveIncomerTransactionsResolutionOptions {
  incomerToRemove: RegisteredIncomer;
  incomerTransactionStore: TransactionStore<"incomer">;
}

function isIncomerCloseMessage<T extends GenericEvent = GenericEvent>(
  value: IncomerChannelMessages<T>["IncomerMessages"]
): value is CloseMessage {
  return value.name === "close";
}

function isRegistrationOrCustomIncomerMessage<T extends GenericEvent = GenericEvent>(
  value: IncomerChannelMessages<T>["IncomerMessages"] | IncomerRegistrationMessage
): value is EventMessage<T> | IncomerRegistrationMessage {
  return value.name !== "close";
}

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
  return value.name !== "register" && value.name !== "ping";
}

function isIncomerRegistrationMessage(
  value: DispatcherChannelMessages["IncomerMessages"]
): value is IncomerRegistrationMessage {
  return value.name === "register";
}

export class Dispatcher<T extends GenericEvent = GenericEvent> extends EventEmitter {
  readonly type = "dispatcher";
  readonly formattedPrefix: string;
  readonly prefix: string;
  readonly dispatcherChannelName: string;
  readonly privateUUID = randomUUID();

  private selfProvidedUUID: string;
  private instanceName: string | undefined;
  private isWorking = false;
  private dispatcherChannel: Channel<
    DispatcherChannelMessages["DispatcherMessages"] |
    { name: "Abort_taking_lead", redisMetadata: { origin: string } } |
    { name: "Abort_taking_lead_back", redisMetadata: { origin: string } }
  >;
  private incomerStore: IncomerStore;
  private dispatcherTransactionStore: TransactionStore<"dispatcher">;
  private backupIncomerTransactionStore: TransactionStore<"incomer">;

  private logger: Partial<Logger> & Pick<Logger, "info" | "warn" | "debug">;
  private incomerChannels: Map<string,
    Channel<IncomerChannelMessages<T>["DispatcherMessages"] | DistributedEventMessage<T>>> = new Map();

  private pingInterval: number;
  private pingIntervalTimer: NodeJS.Timer;
  private checkLastActivityInterval: number;
  private checkLastActivityIntervalTimer: NodeJS.Timer;
  private checkRelatedTransactionInterval: number;
  private checkRelatedTransactionIntervalTimer: NodeJS.Timer;
  private checkDispatcherStateInterval: NodeJS.Timer;
  private resetCheckLastActivityTimeout: NodeJS.Timer;
  private idleTime: number;
  private minTimeout = 0;
  // Arbitrary value according to fastify default pluginTimeout
  // Max timeout is 8_000, but u may init both an Dispatcher & an Incomer
  private maxTimeout = kMaxInitTimeout;

  private eventsValidationFn: Map<string, ValidateFunction<Record<string, any>> | CustomEventsValidationFunctions>;
  private validationCbFn: (event: T) => void = null;
  private standardLogFn: StandardLog<T>;

  constructor(options: DispatcherOptions<T>) {
    super();

    Object.assign(this, options);

    this.selfProvidedUUID = options.incomerUUID;
    this.prefix = options.prefix ?? "";
    this.formattedPrefix = options.prefix ? `${options.prefix}-` : "";
    this.dispatcherChannelName = this.formattedPrefix + channels.dispatcher;
    this.standardLogFn = options.standardLog ?? defaultStandardLog;
    this.idleTime = options.idleTime ?? kIdleTime;
    this.pingInterval = options.pingInterval ?? PING_INTERVAL;
    this.checkRelatedTransactionInterval = options.checkTransactionInterval ?? kCheckRelatedTransactionInterval;
    this.checkLastActivityInterval = options.checkLastActivityInterval ?? kCheckLastActivityInterval;

    this.eventsValidationFn = options?.eventsValidation?.eventsValidationFn ?? new Map();
    this.validationCbFn = options?.eventsValidation?.validationCbFn;

    for (const [name, validationSchema] of Object.entries(eventsSchema)) {
      this.eventsValidationFn.set(name, ajv.compile(validationSchema));
    }

    this.logger = options.logger ?? pino({
      name: this.formattedPrefix + this.type,
      level: kLoggerMode,
      transport: {
        target: "pino-pretty"
      }
    });

    this.incomerStore = new IncomerStore({
      prefix: this.prefix
    });

    this.backupIncomerTransactionStore = new TransactionStore({
      prefix: this.formattedPrefix + kBackupTransactionStoreName,
      instance: "incomer"
    });

    this.dispatcherTransactionStore = new TransactionStore({
      prefix: this.prefix,
      instance: "dispatcher"
    });

    this.dispatcherChannel = new Channel({
      prefix: this.prefix,
      name: channels.dispatcher
    });

    this.pingIntervalTimer = setInterval(async() => {
      try {
        if (!this.isWorking) {
          return;
        }

        await this.ping();
      }
      catch (error) {
        this.logger.error({ error: error.stack }, "Failed while sending ping");
      }
    }, this.pingInterval).unref();

    this.checkLastActivityIntervalTimer = this.checkLastActivityIntervalFn();

    this.checkRelatedTransactionIntervalTimer = setInterval(async() => {
      try {
        if (!this.isWorking) {
          return;
        }

        const dispatcherTransactions = await this.dispatcherTransactionStore.getTransactions();
        const backupIncomerTransactions = await this.backupIncomerTransactionStore.getTransactions();

        await this.resolveDispatcherTransactions(
          dispatcherTransactions,
          backupIncomerTransactions
        );

        await this.resolveIncomerMainTransactions(
          dispatcherTransactions,
          backupIncomerTransactions
        );
      }
      catch (error) {
        this.logger.error({ error: error.stack }, "Failed while resolving transactions");
      }
    }, this.checkRelatedTransactionInterval).unref();
  }

  get redis() {
    return getRedis();
  }

  get subscriber() {
    return getRedis("subscriber");
  }

  public async initialize() {
    await this.subscriber.subscribe(this.dispatcherChannelName);
    this.subscriber.on("message", (channel, message) => this.handleMessages(channel, message));

    const incomers = await this.incomerStore.getIncomers();

    const activeDispatcher = [...incomers.values()]
      .find((incomer) => (incomer.name === this.instanceName && incomer.baseUUID !== this.selfProvidedUUID &&
        incomer.isDispatcherActiveInstance));

    if (activeDispatcher && this.isIncomerActive(activeDispatcher)) {
      this.checkDispatcherStateInterval = setInterval(
        async() => await this.takeLeadBack(), this.pingInterval
      ).unref();

      return;
    }

    await this.takeLead({ incomers });
  }

  public async close() {
    clearInterval(this.pingIntervalTimer);
    this.pingIntervalTimer = undefined;

    clearInterval(this.checkRelatedTransactionIntervalTimer);
    this.checkRelatedTransactionIntervalTimer = undefined;

    clearInterval(this.checkLastActivityIntervalTimer);
    this.checkLastActivityIntervalTimer = undefined;

    if (this.resetCheckLastActivityTimeout) {
      clearTimeout(this.resetCheckLastActivityTimeout);
      this.resetCheckLastActivityTimeout = undefined;
    }

    if (this.checkDispatcherStateInterval) {
      clearInterval(this.checkDispatcherStateInterval);
      this.checkDispatcherStateInterval = undefined;
    }

    await this.subscriber.unsubscribe(this.dispatcherChannelName, ...this.incomerChannels.keys());

    this.isWorking = false;
  }

  async takeLead(opts: { incomers?: Set<RegisteredIncomer> } = {}) {
    const incomers = [...opts.incomers.values()].length > 0 ? opts.incomers : await this.incomerStore.getIncomers();

    try {
      await once(this, "ABORT_TAKING_LEAD", {
        signal: AbortSignal.timeout(this.randomIntFromRange())
      });

      this.logger.warn("Dispatcher Timed out on taking lead");

      this.checkDispatcherStateInterval = setInterval(async() => await this.takeLeadBack(), this.pingInterval).unref();
    }
    catch {
      await this.dispatcherChannel.publish({
        name: "Abort_taking_lead",
        redisMetadata: {
          origin: this.privateUUID
        }
      });

      try {
        await once(this, "ABORT_TAKING_LEAD", {
          signal: AbortSignal.timeout(this.randomIntFromRange())
        });

        await this.takeLead();
      }
      catch {
        this.isWorking = true;
        await this.ping();

        for (const { providedUUID, prefix } of [...incomers.values()]) {
          await this.subscriber.subscribe(`${prefix ? `${prefix}-` : ""}${providedUUID}`);
        }

        this.logger.info(`Dispatcher ${this.selfProvidedUUID} took lead`);
      }
    }
  }

  private isIncomerActive(incomer: RegisteredIncomer) {
    const now = Date.now();

    return now < (Number(incomer.lastActivity) + Number(this.idleTime));
  }

  private async takeLeadBack(opts: { incomers?: Set<RegisteredIncomer> } = {}) {
    const incomers = opts.incomers ?? await this.incomerStore.getIncomers();

    const dispatcherInstances = [...incomers.values()]
      .filter((incomer) => incomer.name === this.instanceName && incomer.baseUUID !== this.selfProvidedUUID);
    const dispatcherToRemove = dispatcherInstances
      .find((incomer) => incomer.isDispatcherActiveInstance && !this.isIncomerActive(incomer));

    if (!dispatcherToRemove && dispatcherInstances.length > 0) {
      return;
    }

    try {
      await once(this, "ABORT_TAKING_LEAD_BACK", {
        signal: AbortSignal.timeout(this.randomIntFromRange())
      });

      this.logger.warn("Dispatcher Timed out on taking back the lead");
    }
    catch {
      await this.setAsActiveDispatcher();
      await this.dispatcherChannel.publish({ name: "Abort_taking_lead_back", redisMetadata: { origin: this.privateUUID } });

      clearInterval(this.checkLastActivityIntervalTimer);
      this.isWorking = true;

      try {
        await Promise.all([
          this.ping(),
          dispatcherToRemove ? this.removeNonActives([dispatcherToRemove]) : () => void 0
        ]);
      }
      catch (error) {
        this.logger.error({ error: error.stack }, "failed while taking back the lead");

        return;
      }

      this.resetCheckLastActivityTimeout = setTimeout(async() => {
        try {
          const dispatcherTransactions = await this.dispatcherTransactionStore.getTransactions();
          const backupIncomerTransactions = await this.backupIncomerTransactionStore.getTransactions();

          await this.resolveDispatcherTransactions(
            dispatcherTransactions,
            backupIncomerTransactions
          );

          this.checkLastActivityIntervalTimer = this.checkLastActivityIntervalFn();
        }
        catch (error) {
          this.logger.error({ error: error.stack }, "Failed while reset of last activity interval");
        }
      }, this.checkRelatedTransactionInterval).unref();

      if (this.checkDispatcherStateInterval) {
        clearInterval(this.checkDispatcherStateInterval);
        this.checkDispatcherStateInterval = undefined;
      }

      for (const { providedUUID, prefix } of [...incomers.values()]) {
        await this.subscriber.subscribe(`${prefix ? `${prefix}-` : ""}${providedUUID}`);
      }

      this.logger.info(`Dispatcher ${this.selfProvidedUUID} took lead back on ${dispatcherToRemove.baseUUID}`);
    }
  }

  private randomIntFromRange() {
    return Math.floor((Math.random() * (this.maxTimeout - this.minTimeout)) + this.minTimeout);
  }

  private checkLastActivityIntervalFn() {
    return setInterval(async() => {
      try {
        if (!this.isWorking) {
          return;
        }

        await this.checkLastActivity();
      }
      catch (error) {
        this.logger.error({ error: error.stack }, "Failed while checking incomers last activity");
      }
    }, this.checkLastActivityInterval).unref();
  }

  private async ping() {
    const incomers = await this.incomerStore.getIncomers();
    const pingToResolve = [];
    const concernedIncomers: string[] = [];
    for (const incomer of incomers) {
      if (incomer === null) {
        continue;
      }

      const { providedUUID: uuid } = incomer;

      if (incomer.baseUUID === this.selfProvidedUUID) {
        await this.updateIncomerState(uuid);

        continue;
      }

      const incomerChannel = this.incomerChannels.get(uuid) ??
        new Channel({
          name: uuid,
          prefix: incomer.prefix
        });

      const event: Omit<DispatcherPingMessage, "redisMetadata"> & {
        redisMetadata: Omit<DispatcherPingMessage["redisMetadata"], "transactionId">
      } = {
        name: "ping",
        data: null,
        redisMetadata: {
          origin: this.privateUUID,
          incomerName: "dispatcher",
          to: uuid
        }
      };

      concernedIncomers.push(uuid);

      pingToResolve.push(this.publishEvent({
        concernedChannel: incomerChannel,
        transactionMeta: {
          mainTransaction: true,
          eventTransactionId: null,
          relatedTransaction: null,
          resolved: false
        },
        formattedEvent: event
      }));
    }

    await Promise.all(pingToResolve);
    if (concernedIncomers.length > 0) {
      this.logger.debug({ incomers: concernedIncomers }, "New Ping events");
    }
  }

  private async removeNonActives(inactiveIncomers: RegisteredIncomer[]) {
    const toHandle = [];

    for (const inactive of inactiveIncomers) {
      const transactionStore = new TransactionStore({
        prefix: `${inactive.prefix ? `${inactive.prefix}-` : ""}${inactive.providedUUID}`,
        instance: "incomer"
      });

      toHandle.push(Promise.all([
        this.incomerStore.deleteIncomer(inactive.providedUUID),
        this.inactiveIncomerTransactionsResolution({
          incomerToRemove: inactive,
          incomerTransactionStore: transactionStore
        }),
        this.subscriber.unsubscribe(`${inactive.prefix ? `${inactive.prefix}-` : ""}${inactive.providedUUID}`)
      ]));
    }

    await Promise.all(toHandle);

    this.logger.info(`[${inactiveIncomers.map(
      (incomer) => `(name:${incomer.name}|uuid:${incomer.providedUUID ?? incomer.baseUUID})`
    ).join(",")}], Removed Incomer`);
  }

  private async checkLastActivity() {
    const incomers = await this.incomerStore.getIncomers();

    const now = Date.now();

    const nonActives = [...incomers].filter((incomer) => now > (Number(incomer.lastActivity) + Number(this.idleTime)));

    if (nonActives.length === 0) {
      return;
    }

    const toResolve = [];
    let index = 0;
    for (const inactive of nonActives) {
      const transactionStore = new TransactionStore({
        prefix: `${inactive.prefix ? `${inactive.prefix}-` : ""}${inactive.providedUUID}`,
        instance: "incomer"
      });

      const transactions = await transactionStore.getTransactions();
      const recentPingTransactionKeys = Object.keys(await transactionStore.getTransactions())
        .filter((transactionKey) => {
          const transaction = transactions.get(transactionKey);

          return transaction.name === "ping" && now < (Number(transaction.aliveSince) + Number(this.idleTime));
        });

      if (recentPingTransactionKeys.length > 0) {
        toResolve.push(Promise.all([
          this.updateIncomerState(inactive.providedUUID),
          transactionStore.redis.del(recentPingTransactionKeys)
        ]));

        nonActives.splice(index, 1);
      }

      index++;
    }

    await Promise.all(toResolve);

    await this.removeNonActives(nonActives);
  }

  private async publishEvent(options: PublishEventOptions<T>) {
    const {
      concernedChannel,
      transactionMeta,
      formattedEvent
    } = options;
    const {
      mainTransaction,
      relatedTransaction,
      eventTransactionId,
      resolved
    } = transactionMeta;

    const concernedStore = options.concernedStore ?? this.dispatcherTransactionStore;

    const transaction = formattedEvent.name === "approvement" ? await concernedStore.setTransaction({
      ...formattedEvent,
      redisMetadata: {
        ...formattedEvent.redisMetadata,
        to: formattedEvent.data.uuid,
        mainTransaction,
        relatedTransaction,
        resolved
      }
    }) : await concernedStore.setTransaction({
      ...formattedEvent,
      redisMetadata: {
        ...formattedEvent.redisMetadata,
        mainTransaction,
        relatedTransaction,
        resolved
      }
    });

    await concernedChannel.publish({
      ...formattedEvent,
      redisMetadata: {
        ...formattedEvent.redisMetadata,
        eventTransactionId,
        transactionId: transaction.redisMetadata.transactionId
      }
    });
  }

  private async backupMainTransaction(
    incomerTransactionStore: TransactionStore<"incomer">,
    transactionId: string,
    mainTransaction: Transaction<"incomer">
  ) {
    const [, newlyTransaction] = await Promise.all([
      incomerTransactionStore.deleteTransaction(transactionId),
      this.backupIncomerTransactionStore.setTransaction({
        ...mainTransaction
      }, transactionId)
    ]);

    this.logger.debug(this.standardLogFn(newlyTransaction as any)("Main transaction has been backup"));
  }

  private async distributeMainTransaction(options: DistributeMainTransactionOptions) {
    const {
      concernedPublisher,
      mainTransaction,
      incomerTransactionStore,
      transactionId
    } = options;
    const { prefix, providedUUID } = concernedPublisher;

    const concernedIncomerStore = new TransactionStore({
      prefix: `${prefix ? `${prefix}-` : ""}${providedUUID}`,
      instance: "incomer"
    });

    const [newlyIncomerMainTransaction] = await Promise.all([
      concernedIncomerStore.setTransaction({
        ...mainTransaction,
        redisMetadata: {
          ...mainTransaction.redisMetadata,
          origin: providedUUID
        }
      }, transactionId),
      incomerTransactionStore.deleteTransaction(transactionId)
    ]);

    this.logger.debug(this.standardLogFn(newlyIncomerMainTransaction as any)("Main transaction redistributed to an Incomer"));
  }

  private async removeDispatcherUnknownTransaction(dispatcherTransaction: Transaction<"dispatcher">) {
    await this.dispatcherTransactionStore.deleteTransaction(dispatcherTransaction.redisMetadata.transactionId);

    this.logger.warn(
      this.standardLogFn({ ...dispatcherTransaction } as any)("Removed Dispatcher Transaction unrelated to an known event")
    );
  }

  private async backupResolvedTransaction(
    relatedHandlerTransaction: Transaction<"incomer">,
    incomerToRemoveTransactionStore: TransactionStore<"incomer">
  ) {
    await Promise.all([
      this.backupIncomerTransactionStore.setTransaction(
        relatedHandlerTransaction,
        relatedHandlerTransaction.redisMetadata.transactionId
      ),
      incomerToRemoveTransactionStore.deleteTransaction(relatedHandlerTransaction.redisMetadata.transactionId)
    ]);

    this.logger.debug(
      this.standardLogFn({ ...relatedHandlerTransaction } as unknown as T)("Resolved transaction has been back up")
    );
  }

  private async backupSpreadTransactions(options: BackupSpreadTransactionsOptions): Promise<any> {
    const {
      concernedDispatcherTransactions,
      handlerIncomerTransactions,
      incomerToRemoveTransactionStore,
      incomers
    } = options;

    const toResolve: Promise<any>[] = [];

    for (const [id, dispatcherTransaction] of concernedDispatcherTransactions.entries()) {
      if (!dispatcherTransaction.redisMetadata.relatedTransaction) {
        toResolve.push(this.removeDispatcherUnknownTransaction(dispatcherTransaction));

        continue;
      }

      const concernedIncomer = [...incomers].find(
        (incomer) => dispatcherTransaction.redisMetadata.incomerName === incomer.name && incomer.eventsSubscribe.find(
          (eventSubscribe) => eventSubscribe.name === dispatcherTransaction.name
        )
      );
      const relatedHandlerTransaction = [...handlerIncomerTransactions.values()]
        .find(
          (transaction) => transaction.redisMetadata.relatedTransaction === dispatcherTransaction.redisMetadata.transactionId
        );

      if (relatedHandlerTransaction && relatedHandlerTransaction.redisMetadata.resolved) {
        toResolve.push(this.backupResolvedTransaction(relatedHandlerTransaction, incomerToRemoveTransactionStore));

        continue;
      }

      if (concernedIncomer) {
        const { providedUUID, prefix } = concernedIncomer;

        let concernedIncomerChannel = this.incomerChannels.get(providedUUID);

        if (!concernedIncomerChannel) {
          concernedIncomerChannel = new Channel({
            name: providedUUID,
            prefix
          });

          this.incomerChannels.set(providedUUID, concernedIncomerChannel);
        }

        toResolve.push(Promise.all([
          this.publishEvent({
            concernedChannel: concernedIncomerChannel,
            transactionMeta: {
              mainTransaction: false,
              relatedTransaction: dispatcherTransaction.redisMetadata.relatedTransaction,
              eventTransactionId: dispatcherTransaction.redisMetadata.eventTransactionId,
              resolved: false
            },
            formattedEvent: {
              ...dispatcherTransaction,
              redisMetadata: {
                origin: dispatcherTransaction.redisMetadata.origin,
                to: providedUUID
              }
            }
          }),
          this.dispatcherTransactionStore.deleteTransaction(id),
          typeof relatedHandlerTransaction === "undefined" ? () => void 0 :
            incomerToRemoveTransactionStore.deleteTransaction(relatedHandlerTransaction.redisMetadata.transactionId)
        ]));

        this.logger.debug(this.standardLogFn(dispatcherTransaction && { redisMetadata: {
          ...dispatcherTransaction.redisMetadata,
          origin: this.privateUUID,
          to: concernedIncomer.providedUUID
        } } as unknown as T)("Redistributed unresolved injected event to an Incomer"));

        continue;
      }

      toResolve.push(Promise.all([
        this.backupIncomerTransactionStore.setTransaction({
          ...dispatcherTransaction
        }, dispatcherTransaction.redisMetadata.transactionId),
        typeof relatedHandlerTransaction === "undefined" ? () => void 0 :
          incomerToRemoveTransactionStore.deleteTransaction(relatedHandlerTransaction.redisMetadata.transactionId)
      ]));

      // To publish later when concerned Incomer

      this.logger.debug(this.standardLogFn(dispatcherTransaction as any)("Spread transaction has been backup"));

      continue;
    }

    await Promise.all(toResolve);
  }

  private async inactiveIncomerTransactionsResolution(options: InactiveIncomerTransactionsResolutionOptions) {
    const { incomerToRemove, incomerTransactionStore: incomerToRemoveTransactionStore } = options;

    const incomerTransactions = await incomerToRemoveTransactionStore.getTransactions();
    const dispatcherTransactions = await this.dispatcherTransactionStore.getTransactions();

    const incomers = await this.incomerStore.getIncomers();

    delete incomers[incomerToRemove.providedUUID];

    const transactionsToResolve: Promise<any>[] = [];

    const concernedDispatcherTransactions = [...dispatcherTransactions]
      .filter(([__, dispatcherTransaction]) => dispatcherTransaction.redisMetadata.to === incomerToRemove.providedUUID);

    const dispatcherPingTransactions = new Map(
      [...concernedDispatcherTransactions]
        .filter(
          ([__, dispatcherTransaction]) => dispatcherTransaction.name === "ping"
        )
    );

    const incomerPingTransactions = new Map(
      [...incomerTransactions]
        .filter(([__, incomerTransaction]) => incomerTransaction.name === "ping")
        .map(([__, incomerTransaction]) => [incomerTransaction.redisMetadata.relatedTransaction, incomerTransaction])
    );

    transactionsToResolve.push(
      Promise.all(
        [...dispatcherPingTransactions]
          .map(([relatedPingTransactionId]) => {
            if (!incomerPingTransactions.has(relatedPingTransactionId)) {
              return this.dispatcherTransactionStore.deleteTransaction(relatedPingTransactionId);
            }

            const relatedIncomerPingTransaction = incomerPingTransactions.get(relatedPingTransactionId);

            return Promise.all([
              incomerToRemoveTransactionStore.deleteTransaction(relatedIncomerPingTransaction.redisMetadata.transactionId),
              this.dispatcherTransactionStore.deleteTransaction(relatedPingTransactionId)
            ]);
          })
      )
    );

    const dispatcherApprovementTransactions = new Map(
      [...concernedDispatcherTransactions]
        .filter(([__, dispatcherTransaction]) => dispatcherTransaction.name === "approvement")
    );

    const incomerRegistrationTransactions = new Map(
      [...incomerTransactions]
        .filter(([__, incomerTransaction]) => incomerTransaction.name === "register")
        .map(([__, incomerTransaction]) => [incomerTransaction.redisMetadata.relatedTransaction, incomerTransaction])
    );

    transactionsToResolve.push(
      Promise.all(
        [...incomerRegistrationTransactions]
          .map(([relatedApprovementTransactionId, incomerTransaction]) => {
            if (!dispatcherApprovementTransactions.has(relatedApprovementTransactionId)) {
              return incomerToRemoveTransactionStore.deleteTransaction(incomerTransaction.redisMetadata.transactionId);
            }

            return Promise.all([
              incomerToRemoveTransactionStore.deleteTransaction(incomerTransaction.redisMetadata.transactionId),
              this.dispatcherTransactionStore.deleteTransaction(relatedApprovementTransactionId)
            ]);
          })
      )
    );

    const restIncomerTransaction = new Map(
      [...incomerTransactions]
        .filter(([__, incomerTransaction]) => incomerTransaction.name !== "register" && incomerTransaction.name !== "ping")
    );

    const concernedDispatcherTransactionRest = new Map(
      [...concernedDispatcherTransactions]
        .filter(([__, dispatcherTransaction]) => dispatcherTransaction.name !== "approvement" &&
          dispatcherTransaction.name !== "ping"
        )
    );

    const mainTransactionResolutionPromises = [...restIncomerTransaction]
      .filter(([__, incomerTransaction]) => incomerTransaction.redisMetadata.mainTransaction)
      .map(([id, mainTransaction]) => {
        const concernedPublisher = [...incomers].find(
          (incomer) => incomer.name === incomerToRemove.name && incomer.eventsCast.find(
            (eventCast) => eventCast === mainTransaction.name
          )
        );

        if (!concernedPublisher) {
          return this.backupMainTransaction(incomerToRemoveTransactionStore, id, mainTransaction);
        }

        return this.distributeMainTransaction({
          concernedPublisher,
          mainTransaction,
          incomerTransactionStore: incomerToRemoveTransactionStore,
          transactionId: id
        });
      });

    transactionsToResolve.push(Promise.all(mainTransactionResolutionPromises));

    const handlerIncomerTransactionRest = new Map(
      [...restIncomerTransaction]
        .filter(([__, incomerTransaction]) => !incomerTransaction.redisMetadata.mainTransaction)
    );

    transactionsToResolve.push(this.backupSpreadTransactions({
      concernedDispatcherTransactions: concernedDispatcherTransactionRest,
      handlerIncomerTransactions: handlerIncomerTransactionRest,
      incomerToRemoveTransactionStore,
      incomers
    }));

    await Promise.all(transactionsToResolve);
  }

  private async handleIncomerBackupTransactions(
    backedUpIncomerTransactions: Transactions<"incomer">,
    dispatcherTransactions: Transactions<"dispatcher">,
    incomers: Set<RegisteredIncomer>
  ) {
    const toResolve = [];

    for (const [backupTransactionId, backupIncomerTransaction] of backedUpIncomerTransactions.entries()) {
      if (backupIncomerTransaction.redisMetadata.mainTransaction) {
        const concernedIncomer = [...incomers.values()].find(
          (incomer) => incomer.name === backupIncomerTransaction.redisMetadata.incomerName && incomer.eventsCast.find(
            (castedEvent) => castedEvent === backupIncomerTransaction.name
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
            ...backupIncomerTransaction,
            redisMetadata: {
              ...backupIncomerTransaction.redisMetadata,
              origin: concernedIncomer.providedUUID
            }
          }, backupTransactionId),
          this.backupIncomerTransactionStore.deleteTransaction(backupTransactionId)
        );

        continue;
      }

      if (backupIncomerTransaction.redisMetadata.relatedTransaction) {
        const concernedIncomer = [...incomers].find(
          (incomer) => incomer.name === backupIncomerTransaction.redisMetadata.incomerName && incomer.eventsSubscribe.find(
            (subscribedEvent) => subscribedEvent.name === backupIncomerTransaction.name
          )
        );

        if (!concernedIncomer) {
          continue;
        }

        const relatedDispatcherTransactionId = [...dispatcherTransactions.keys()]
          .find(
            (dispatcherTransactionId) => dispatcherTransactionId === backupIncomerTransaction.redisMetadata.relatedTransaction
          );

        if (!relatedDispatcherTransactionId) {
          continue;
        }

        if (!backupIncomerTransaction.redisMetadata.resolved) {
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
                mainTransaction: backupIncomerTransaction.redisMetadata.mainTransaction,
                relatedTransaction: backupIncomerTransaction.redisMetadata.relatedTransaction,
                eventTransactionId: null,
                resolved: backupIncomerTransaction.redisMetadata.resolved
              },
              formattedEvent: {
                ...backupIncomerTransaction,
                redisMetadata: {
                  origin: this.privateUUID,
                  to: concernedIncomer.providedUUID
                }
              }
            }),
            this.backupIncomerTransactionStore.deleteTransaction(backupTransactionId),
            this.dispatcherTransactionStore.deleteTransaction(relatedDispatcherTransactionId)
          ]);

          continue;
        }

        const concernedIncomerStore = new TransactionStore({
          prefix: `${concernedIncomer.prefix ? `${concernedIncomer.prefix}-` : ""}${concernedIncomer.providedUUID}`,
          instance: "incomer"
        });

        toResolve.push(
          concernedIncomerStore.setTransaction({
            ...backupIncomerTransaction,
            redisMetadata: {
              ...backupIncomerTransaction.redisMetadata,
              origin: concernedIncomer.providedUUID
            }
          }, backupIncomerTransaction.redisMetadata.transactionId),
          this.backupIncomerTransactionStore.deleteTransaction(backupTransactionId)
        );
      }
    }

    await Promise.all(toResolve);
  }

  private async resolveDispatcherTransactions(
    dispatcherTransactions: Transactions<"dispatcher">,
    backupIncomerTransactions: Transactions<"incomer">
  ) {
    const incomers = await this.incomerStore.getIncomers();

    await this.handleIncomerBackupTransactions(backupIncomerTransactions, dispatcherTransactions, incomers);

    const toResolve = [];
    const incomerStateToUpdate = new Set<string>();
    for (const [dispatcherTransactionId, dispatcherTransaction] of dispatcherTransactions.entries()) {
      const transactionRecipient = dispatcherTransaction.redisMetadata.to;

      const relatedIncomer = [...incomers].find((incomer) => incomer.providedUUID === transactionRecipient ||
        incomer.baseUUID === transactionRecipient);

      const [relatedBackupIncomerTransactionId, relatedBackupIncomerTransaction] = [...backupIncomerTransactions.entries()]
        .find(([__, incomerTransaction]) => incomerTransaction.redisMetadata.relatedTransaction === dispatcherTransactionId) ||
          [];

      if (relatedBackupIncomerTransaction) {
        if (relatedBackupIncomerTransaction.redisMetadata.resolved) {
          dispatcherTransaction.redisMetadata.resolved = true;
          toResolve.push(Promise.all([
            this.backupIncomerTransactionStore.deleteTransaction(relatedBackupIncomerTransactionId),
            this.dispatcherTransactionStore.updateTransaction(
              dispatcherTransactionId,
              dispatcherTransaction
            )
          ]));

          continue;
        }

        // Event not resolved yet

        continue;
      }

      if (!relatedIncomer) {
        continue;
      }

      const relatedIncomerTransactionStore = new TransactionStore({
        prefix: `${relatedIncomer.prefix ? `${relatedIncomer.prefix}-` : ""}${transactionRecipient}`,
        instance: "incomer"
      });

      const relatedIncomerTransactions = await relatedIncomerTransactionStore.getTransactions();

      const [relatedIncomerTransactionId, relatedIncomerTransaction] = [...relatedIncomerTransactions.entries()]
        .find(([__, incomerTransaction]) => incomerTransaction.redisMetadata.relatedTransaction === dispatcherTransactionId &&
          incomerTransaction.redisMetadata.resolved) ||
          [];

      // Event not resolved yet
      if (!relatedIncomerTransactionId) {
        continue;
      }

      if (dispatcherTransaction.redisMetadata.mainTransaction) {
        // Only in case of ping event
        incomerStateToUpdate.add(relatedIncomerTransaction.redisMetadata.origin);
        toResolve.push(Promise.all([
          relatedIncomerTransactionStore.deleteTransaction(relatedIncomerTransactionId),
          this.dispatcherTransactionStore.deleteTransaction(dispatcherTransactionId)
        ]));

        continue;
      }

      if (dispatcherTransaction.name === "approvement") {
        if (!relatedIncomerTransaction || !relatedIncomerTransaction.redisMetadata.resolved) {
          continue;
        }

        toResolve.push(Promise.all([
          relatedIncomerTransactionStore.deleteTransaction(relatedIncomerTransactionId),
          this.dispatcherTransactionStore.deleteTransaction(dispatcherTransactionId)
        ]));

        continue;
      }

      dispatcherTransaction.redisMetadata.resolved = true;
      incomerStateToUpdate.add(relatedIncomerTransaction.redisMetadata.to);
      toResolve.push(Promise.all([
        relatedIncomerTransactionStore.deleteTransaction(relatedIncomerTransactionId),
        this.dispatcherTransactionStore.updateTransaction(
          dispatcherTransactionId,
          dispatcherTransaction
        )
      ]));
    }

    toResolve.push([...incomerStateToUpdate.values()].map(
      (incomerId) => this.updateIncomerState(incomerId))
    );

    await Promise.all(toResolve);
  }

  private async resolveIncomerMainTransactions(
    dispatcherTransactions: Transactions<"dispatcher">,
    backupIncomerTransactions: Transactions<"incomer">
  ) {
    const incomers = await this.incomerStore.getIncomers();

    const toResolve = [];
    const incomerStateToUpdate = new Set<string>();
    for (const incomer of incomers) {
      const incomerStore = new TransactionStore({
        prefix: `${incomer.prefix ? `${incomer.prefix}-` : ""}${incomer.providedUUID}`,
        instance: "incomer"
      });

      const discriminatedIncomerTransaction = new Map([...backupIncomerTransactions.entries()].map(([id, backupTransaction]) => {
        const formatted = {
          ...backupTransaction,
          isBackupTransaction: true
        };

        return [id, formatted];
      }));

      const incomerTransactions: Map<string, Transaction<"incomer"> & { isBackupTransaction?: boolean }> = new Map([
        ...await incomerStore.getTransactions(),
        ...discriminatedIncomerTransaction
      ]);

      for (const [incomerTransactionId, incomerTransaction] of incomerTransactions.entries()) {
        if (!incomerTransaction.redisMetadata.mainTransaction) {
          continue;
        }

        const relatedDispatcherTransactions: Transaction<"dispatcher">[] = [...dispatcherTransactions.values()]
          .filter((dispatcherTransaction) => dispatcherTransaction.redisMetadata.relatedTransaction === incomerTransactionId);

        // Event not resolved yet by the dispatcher
        if (relatedDispatcherTransactions.length === 0) {
          continue;
        }

        const unResolvedRelatedTransactions = [...relatedDispatcherTransactions.values()].filter(
          (dispatcherTransaction) => !dispatcherTransaction.redisMetadata.resolved
        );

        // Event not resolved yet by the different incomers
        if (unResolvedRelatedTransactions.length > 0) {
          continue;
        }

        for (const relatedDispatcherTransaction of relatedDispatcherTransactions.values()) {
          if (!incomerTransaction.isBackupTransaction) {
            incomerStateToUpdate.add(relatedDispatcherTransaction.redisMetadata.to);
          }

          toResolve.push(
            this.dispatcherTransactionStore.deleteTransaction(relatedDispatcherTransaction.redisMetadata.transactionId)
          );
        }

        toResolve.push(
          incomerTransaction.isBackupTransaction ? this.backupIncomerTransactionStore.deleteTransaction(incomerTransactionId) :
            incomerStore.deleteTransaction(incomerTransactionId)
        );
      }
    }

    toResolve.push([...incomerStateToUpdate.values()].map(
      (incomerId) => this.updateIncomerState(incomerId))
    );

    await Promise.all(toResolve);
  }

  private async updateIncomerState(origin: string) {
    try {
      await this.incomerStore.updateIncomerState(origin);
    }
    catch (error) {
      this.logger.error({ uuid: origin, error: error.stack }, "Failed to update incomer state");
    }
  }

  private async setAsActiveDispatcher() {
    const incomers = await this.incomerStore.getIncomers();

    const relatedIncomer = [...incomers.values()].find((incomer) => incomer.baseUUID === this.selfProvidedUUID);

    if (!relatedIncomer) {
      this.logger.warn("No Incomer found while setting incomer as active Dispatcher Instance");

      return;
    }

    await this.incomerStore.updateIncomer({
      ...relatedIncomer,
      lastActivity: Date.now(),
      isDispatcherActiveInstance: true
    });
  }

  private async setAsInactiveDispatcher() {
    const incomers = await this.incomerStore.getIncomers();

    const relatedIncomer = [...incomers.values()].find((incomer) => incomer.baseUUID === this.selfProvidedUUID);

    if (!relatedIncomer) {
      this.logger.warn("No Incomer found while setting incomer as inactive Dispatcher Instance");

      return;
    }

    await this.incomerStore.updateIncomer({
      ...relatedIncomer,
      isDispatcherActiveInstance: false
    });
  }

  private schemaValidation(message: IncomerRegistrationMessage | EventMessage<T>) {
    const { redisMetadata, ...event } = message;

    const eventValidations = this.eventsValidationFn.get(event.name) as ValidateFunction<Record<string, any>>;
    const redisMetadataValidationFn = this.eventsValidationFn.get("redisMetadata") as ValidateFunction<Record<string, any>>;

    if (!eventValidations) {
      throw new Error(`Unknown Event ${event.name}`);
    }

    if (!redisMetadataValidationFn(redisMetadata)) {
      throw new Error(
        `Malformed redis metadata: [${[...redisMetadataValidationFn.errors]
          .map((error) => `${error.instancePath ? `${error.instancePath}:` : ""} ${error.message}`).join("|")}]`
      );
    }

    if (this.validationCbFn && isIncomerChannelMessage(message)) {
      this.validationCbFn({ ...message } as EventMessage<T>);

      return;
    }

    if (!eventValidations(event)) {
      throw new Error(
        `Malformed event: [${[...eventValidations.errors]
          .map((error) => `${error.instancePath ? `${error.instancePath}:` : ""} ${error.message}`).join("|")}]`
      );
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
      if (formattedMessage.redisMetadata.origin === this.privateUUID) {
        return;
      }

      if (!this.isWorking) {
        if (formattedMessage.name === "Abort_taking_lead") {
          this.emit("ABORT_TAKING_LEAD");

          return;
        }

        if (formattedMessage.name === "Abort_taking_lead_back") {
          this.emit("ABORT_TAKING_LEAD_BACK");

          return;
        }

        return;
      }

      if (this.isWorking) {
        if (formattedMessage.name === "Abort_taking_lead") {
          this.isWorking = false;
          await this.setAsInactiveDispatcher();
          this.emit("ABORT_TAKING_LEAD");

          return;
        }
        else if (formattedMessage.name === "Abort_taking_lead_back") {
          this.isWorking = false;
          await this.setAsInactiveDispatcher();
          this.emit("ABORT_TAKING_LEAD_BACK");

          return;
        }
      }

      if (isRegistrationOrCustomIncomerMessage(formattedMessage)) {
        this.schemaValidation(formattedMessage);
      }

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
      this.logger.error({ channel, message: formattedMessage, error: error.stack }, "Failed while handling unknown message");
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
        this.logger.error({ channel: "dispatcher", message, error: error.stack }, "Failed on handling new message");
      });
  }

  private async handleIncomerMessages(
    channel: string,
    message: IncomerChannelMessages<T>["IncomerMessages"]
  ) {
    const { redisMetadata, ...event } = message;
    const { name } = event;
    const { transactionId } = redisMetadata;

    if (isIncomerCloseMessage(message)) {
      const logData = {
        channel,
        ...message as CloseMessage
      };

      const relatedIncomer = await this.incomerStore.getIncomer(redisMetadata.origin);

      if (!relatedIncomer) {
        this.logger.warn(logData, "Unable to find the Incomer closing the connection");

        return;
      }

      await this.removeNonActives([relatedIncomer]);

      return;
    }

    const logData = {
      channel,
      ...message as EventMessage<T>
    };

    const senderTransactionStore = new TransactionStore({
      prefix: `${redisMetadata.prefix ? `${redisMetadata.prefix}-` : ""}${redisMetadata.origin}`,
      instance: "incomer"
    });

    const relatedTransaction = await senderTransactionStore.getTransactionById(transactionId);

    if (!relatedTransaction) {
      throw new Error(this.standardLogFn(logData)(`Couldn't find the related main transaction for: ${transactionId}`));
    }

    const incomers = await this.incomerStore.getIncomers();

    const concernedIncomers = [...incomers]
      .filter(
        (incomer) => incomer.eventsSubscribe.find((subscribedEvent) => subscribedEvent.name === name)
      );

    if (concernedIncomers.length === 0) {
      if (name === "ping") {
        this.logger.warn(this.standardLogFn(logData)("No concerned Incomer found"));
      }
      else {
        await Promise.all([
          senderTransactionStore.updateTransaction(transactionId, {
            ...relatedTransaction,
            redisMetadata: {
              ...relatedTransaction.redisMetadata,
              published: true
            }
          }),
          this.dispatcherTransactionStore.setTransaction({
            ...event,
            redisMetadata: {
              origin: this.privateUUID,
              to: "",
              mainTransaction: false,
              relatedTransaction: transactionId,
              resolved: false
            }
          } as unknown as PartialTransaction<"dispatcher">)
        ]);

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
            (subscribedEvent) => subscribedEvent.name === relatedEvent.name && filteredConcernedIncomer.name === incomer.name
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

      const formattedEvent = {
        ...message,
        redisMetadata: {
          origin: this.privateUUID,
          to: providedUUID,
          incomerName: incomer.name
        }
      };

      toResolve.push(this.publishEvent({
        concernedChannel: concernedIncomerChannel,
        transactionMeta: {
          mainTransaction: false,
          relatedTransaction: transactionId,
          eventTransactionId: transactionId,
          resolved: false
        },
        formattedEvent
      }));
    }

    await this.updateIncomerState(redisMetadata.origin);
    await Promise.all([
      ...toResolve,
      senderTransactionStore.updateTransaction(transactionId, {
        ...relatedTransaction,
        redisMetadata: {
          ...relatedTransaction.redisMetadata,
          published: true
        }
      })
    ]);

    this.logger.info(this.standardLogFn(
      Object.assign({}, logData, {
        redisMetadata: {
          ...redisMetadata,
          eventTransactionId: transactionId,
          to: `[${filteredConcernedIncomers.map((incomer) => incomer.providedUUID)}]`
        }
      })
    )("Custom event distributed"));
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

    // Get Incomers Tree
    const incomers = await this.incomerStore.getIncomers();

    // Avoid multiple init from a same instance of a incomer
    for (const incomer of incomers) {
      if (incomer.baseUUID === origin) {
        await this.dispatcherTransactionStore.deleteTransaction(transactionId);

        throw new Error("Forbidden multiple registration for a same instance");
      }
    }

    // Update the tree
    const now = Date.now();

    const incomer = Object.assign({}, {
      ...data,
      isDispatcherActiveInstance: origin === this.selfProvidedUUID,
      baseUUID: origin,
      lastActivity: now,
      aliveSince: now,
      prefix
    });

    const providedUUID = await this.incomerStore.setIncomer(incomer, data.providedUUID);

    // Subscribe to the exclusive service channel
    this.incomerChannels.set(providedUUID, new Channel({
      name: providedUUID,
      prefix
    }));

    await this.subscriber.subscribe(`${prefix ? `${prefix}-` : ""}${providedUUID}`);

    const event: Omit<DispatcherRegistrationMessage, "redisMetadata"> & {
      redisMetadata: Omit<DispatcherRegistrationMessage["redisMetadata"], "transactionId">
    } = {
      name: "approvement",
      data: {
        uuid: providedUUID
      },
      redisMetadata: {
        origin: this.privateUUID,
        incomerName: "dispatcher",
        to: redisMetadata.origin
      }
    };

    // Approve the service & send him info so he can use the dedicated channel
    await this.publishEvent({
      concernedChannel: this.dispatcherChannel as Channel<DispatcherChannelMessages["DispatcherMessages"]>,
      transactionMeta: {
        mainTransaction: false,
        relatedTransaction: transactionId,
        eventTransactionId: null,
        resolved: false
      },
      formattedEvent: event
    });

    this.logger.info("Approved Incomer");
  }
}
