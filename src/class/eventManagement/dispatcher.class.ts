/* eslint-disable max-lines */
// Import Node.js Dependencies
import { once, EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import timers from "node:timers/promises";

// Import Third-party Dependencies
import {
  Channel,
  getRedis
} from "@myunisoft/redis";
import { pino } from "pino";

// Import Internal Dependencies
import {
  PartialTransaction,
  Transaction,
  TransactionStore
} from "../store/transaction.class";
import {
  Prefix,
  DispatcherChannelMessages,
  IncomerChannelMessages,
  DispatcherApprovementMessage,
  IncomerRegistrationMessage,
  DispatcherPingMessage,
  EventMessage,
  GenericEvent,
  CloseMessage
} from "../../types/eventManagement/index";
import { defaultStandardLog, handleLoggerMode, StandardLog } from "../../utils/index";
import { IncomerStore, RegisteredIncomer } from "../store/incomer.class";
import { TransactionHandler } from "./dispatcher/transaction-handler.class";
import { IncomerChannelHandler } from "./dispatcher/incomer-channel.class";
import { EventsHandler, customValidationCbFn, eventsValidationFn } from "./dispatcher/events.class";

// CONSTANTS
const kIdleTime = Number.isNaN(Number(process.env.MYUNISOFT_DISPATCHER_IDLE_TIME)) ? 60_000 * 10 :
  Number(process.env.MYUNISOFT_DISPATCHER_IDLE_TIME);
const kCheckLastActivityInterval = Number.isNaN(
  Number(process.env.MYUNISOFT_DISPATCHER_CHECK_LAST_ACTIVITY_INTERVAL)
) ? 60_000 * 2 : Number(process.env.MYUNISOFT_DISPATCHER_CHECK_LAST_ACTIVITY_INTERVAL);
const kBackupTransactionStoreName = String(process.env.MYUNISOFT_DISPATCHER_BACKUP_TRANSACTION_STORE_NAME ?? "backup");
const kLoggerMode = (handleLoggerMode(process.env.MYUNISOFT_EVENTS_LOGGER_MODE));
const kMaxInitTimeout = Number.isNaN(Number(process.env.MYUNISOFT_DISPATCHER_INIT_TIMEOUT)) ? 3_500 :
  Number(process.env.MYUNISOFT_DISPATCHER_INIT_TIMEOUT);

export const DISPATCHER_CHANNEL_NAME = "dispatcher";
export const RESOLVE_TRANSACTION_INTERVAL = Number.isNaN(
  Number(process.env.MYUNISOFT_DISPATCHER_RESOLVE_TRANSACTION_INTERVAL)
) ? 60_000 * 3 : Number(process.env.MYUNISOFT_DISPATCHER_RESOLVE_TRANSACTION_INTERVAL);
export const PING_INTERVAL = Number.isNaN(Number(process.env.MYUNISOFT_DISPATCHER_PING_INTERVAL)) ? 60_000 * 5 :
  Number(process.env.MYUNISOFT_DISPATCHER_PING_INTERVAL);

export type DefaultOptions<T extends GenericEvent> = {
  logger?: PartialLogger;
  standardLog?: StandardLog<T>;
  pingInterval?: number;
  idleTime?: number;
}

export type SharedOptions<T extends GenericEvent> = {
  dispatcherTransactionStore: TransactionStore<"dispatcher">;
  backupDispatcherTransactionStore: TransactionStore<"dispatcher">;
  backupIncomerTransactionStore: TransactionStore<"incomer">;
  incomerChannelHandler: IncomerChannelHandler<T>;
  incomerStore: IncomerStore;
  privateUUID: string;
  formattedPrefix: string;
  parentLogger: PartialLogger;
}

export type DispatcherOptions<T extends GenericEvent = GenericEvent> = DefaultOptions<T> & {
  /* Commonly used to distinguish envs */
  prefix?: Prefix;
  eventsValidation?: {
    eventsValidationFn?: eventsValidationFn<T>;
    customValidationCbFn?: customValidationCbFn<T>;
  };
  /** Used to avoid self ping & as discriminant for dispatcher instance that scale */
  incomerUUID?: string;
  /** Used as discriminant for dispatcher instance that scale */
  instanceName?: string;
  checkLastActivityInterval?: number;
  checkTransactionInterval?: number;
};

export type DispatcherChannelEvents = { name: "REGISTER" | "APPROVEMENT" | "ABORT_TAKING_LEAD" | "ABORT_TAKING_LEAD_BACK" };

type anyFn = (...args: any[]) => any;

export type PartialLogger = Record<string, any> & {
  info: anyFn;
  warn: anyFn;
  debug: anyFn;
  error: anyFn;
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
    { name: "ABORT_TAKING_LEAD", redisMetadata: { origin: string } } |
    { name: "ABORT_TAKING_LEAD_BACK", redisMetadata: { origin: string } }
  >;
  private incomerStore: IncomerStore;
  private eventsHandler: EventsHandler<T>;
  private dispatcherTransactionStore: TransactionStore<"dispatcher">;
  private backupDispatcherTransactionStore: TransactionStore<"dispatcher">;
  private backupIncomerTransactionStore: TransactionStore<"incomer">;

  private transactionHandler: TransactionHandler;

  private logger: PartialLogger;
  private incomerChannelHandler: IncomerChannelHandler<T>;
  private activeChannels = new Set<string>();

  private pingInterval: number;
  private pingIntervalTimer: NodeJS.Timer;
  private checkLastActivityInterval: number;
  private checkLastActivityIntervalTimer: NodeJS.Timer;
  private resolveTransactionInterval: number;
  private checkDispatcherStateInterval: NodeJS.Timer;
  private resetCheckLastActivityTimeout: NodeJS.Timer;
  private resolveTransactionsInterval: NodeJS.Timer;
  private idleTime: number;
  private minTimeout = 0;
  // Arbitrary value according to fastify default pluginTimeout
  // Max timeout is 8_000, but u may init both an Dispatcher & an Incomer
  private maxTimeout = kMaxInitTimeout;

  private standardLogFn: StandardLog<T>;

  constructor(options: DispatcherOptions<T>) {
    super();

    Object.assign(this, options);

    this.selfProvidedUUID = options.incomerUUID ?? randomUUID();
    this.prefix = options.prefix ?? "";
    this.formattedPrefix = options.prefix ? `${options.prefix}-` : "";
    this.dispatcherChannelName = this.formattedPrefix + DISPATCHER_CHANNEL_NAME;
    this.standardLogFn = options.standardLog ?? defaultStandardLog;
    this.idleTime = options.idleTime ?? kIdleTime;
    this.pingInterval = options.pingInterval ?? PING_INTERVAL;
    this.resolveTransactionInterval = options.checkTransactionInterval ?? RESOLVE_TRANSACTION_INTERVAL;
    this.checkLastActivityInterval = options.checkLastActivityInterval ?? kCheckLastActivityInterval;

    this.logger = options.logger ?? pino({
      name: this.formattedPrefix + this.type,
      level: kLoggerMode,
      transport: {
        target: "pino-pretty"
      }
    });

    this.incomerStore = new IncomerStore({
      prefix: this.prefix,
      idleTime: this.idleTime
    });

    this.eventsHandler = new EventsHandler({
      ...this,
      ...options,
      parentLogger: this.logger,
      standardLog: this.standardLogFn
    });

    this.backupDispatcherTransactionStore = new TransactionStore({
      prefix: this.formattedPrefix + kBackupTransactionStoreName,
      instance: "dispatcher"
    });

    this.dispatcherTransactionStore = new TransactionStore({
      prefix: this.prefix,
      instance: "dispatcher"
    });

    this.incomerChannelHandler = new IncomerChannelHandler({
      logger: this.logger
    });

    this.dispatcherChannel = new Channel({
      prefix: this.prefix,
      name: DISPATCHER_CHANNEL_NAME
    });

    this.backupIncomerTransactionStore = new TransactionStore({
      prefix: this.formattedPrefix + kBackupTransactionStoreName,
      instance: "incomer"
    });

    const sharedOptions: SharedOptions<T> = {
      privateUUID: this.privateUUID,
      formattedPrefix: this.formattedPrefix,
      parentLogger: this.logger,
      incomerStore: this.incomerStore,
      incomerChannelHandler: this.incomerChannelHandler,
      dispatcherTransactionStore: this.dispatcherTransactionStore,
      backupDispatcherTransactionStore: this.backupDispatcherTransactionStore,
      backupIncomerTransactionStore: this.backupIncomerTransactionStore
    };

    this.transactionHandler = new TransactionHandler({
      ...options,
      ...sharedOptions,
      eventsHandler: this.eventsHandler
    });

    this.eventsHandler
      .on("APPROVEMENT", async(registrationEvent: IncomerRegistrationMessage) => {
        try {
          await this.approveIncomer(registrationEvent);
        }
        catch (error) {
          this.logger.error({
            channel: "dispatcher",
            message: registrationEvent,
            error: error.stack
          });
        }
      })
      .on("CLOSE", async(channel: string, closeEvent: CloseMessage) => {
        try {
          const { redisMetadata } = closeEvent;

          const relatedIncomer = await this.incomerStore.getIncomer(redisMetadata.origin);

          if (!relatedIncomer) {
            this.logger.warn({ channel }, "Unable to find the Incomer closing the connection");

            return;
          }

          await this.removeNonActives([relatedIncomer]);
        }
        catch (error) {
          this.logger.error({
            channel: "dispatcher",
            message: closeEvent,
            error: error.stack
          });
        }
      })
      .on("CUSTOM_EVENT", async(channel: string, customEvent: EventMessage<T>) => {
        try {
          await this.handleCustomEvents(channel, customEvent);
        }
        catch (error) {
          this.logger.error({
            channel: "dispatcher",
            message: customEvent,
            error: error.stack
          });
        }
      });

    this.resolveTransactionsInterval = setInterval(() => {
      if (!this.isWorking) {
        return;
      }

      this.transactionHandler.resolveTransactions()
        .catch((error) => this.logger.error({ error: error.stack }, "failed at resolving transactions"));
    }, options.checkTransactionInterval ?? RESOLVE_TRANSACTION_INTERVAL).unref();

    this.pingIntervalTimer = setInterval(() => {
      if (!this.isWorking) {
        return;
      }

      this.ping()
        .catch((error) => this.logger.error({ error: error.stack }, "failed sending pings"));
    }, this.pingInterval).unref();

    this.checkLastActivityIntervalTimer = setInterval(() => this.checkLastActivity()
      .catch((error) => this.logger.error({ error: error.stack }, "failed to check activity")),
    this.checkLastActivityInterval).unref();
  }

  get redis() {
    return getRedis();
  }

  get subscriber() {
    return getRedis("subscriber");
  }

  public async initialize() {
    await this.subscriber.subscribe(this.dispatcherChannelName);
    this.subscriber.on("message", async(channel, message) => {
      await this.handleMessages(channel, message);
    });

    const incomers = await this.incomerStore.getIncomers();

    const activeDispatcher = [...incomers.values()]
      .find((incomer) => (incomer.name === this.instanceName && incomer.baseUUID !== this.selfProvidedUUID &&
        incomer.isDispatcherActiveInstance));

    if (activeDispatcher && this.incomerStore.isActive(activeDispatcher)) {
      this.checkDispatcherStateInterval = setInterval(() => this.takeLeadBack()
        .catch((error) => this.logger.error({ error: error.stack }, "failed while taking lead back")),
      this.pingInterval).unref();

      return;
    }

    await this.takeLead({ incomers });
  }

  public async close() {
    clearInterval(this.resolveTransactionsInterval);
    this.resolveTransactionsInterval = undefined;

    clearInterval(this.pingIntervalTimer);
    this.pingIntervalTimer = undefined;

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

    this.eventsHandler.removeAllListeners();
    this.removeAllListeners();

    await this.subscriber.unsubscribe(
      this.dispatcherChannelName,
      ...this.incomerChannelHandler.channels.keys(),
      ...this.activeChannels.values()
    );

    this.updateState(false);

    await timers.setImmediate();
  }

  async handleMessages(channel: string, message: string) {
    let parsedMessage: DispatcherChannelMessages["IncomerMessages"] |
        IncomerChannelMessages<T>["IncomerMessages"];

    try {
      parsedMessage = JSON.parse(message);
    }
    catch (error) {
      this.logger.error({ channel, error: error.message });

      return;
    }

    try {
      if (!parsedMessage.name || !parsedMessage.redisMetadata) {
        throw new Error("Malformed message");
      }

      // Avoid reacting to his own message
      if (parsedMessage.redisMetadata.origin === this.privateUUID) {
        return;
      }

      if (parsedMessage.name === "ABORT_TAKING_LEAD" || parsedMessage.name === "ABORT_TAKING_LEAD_BACK") {
        if (this.isWorking) {
          this.isWorking = false;
          await this.setAsInactiveDispatcher();
        }

        this.emit(parsedMessage.name);

        return;
      }

      if (!this.isWorking) {
        return;
      }

      await this.eventsHandler.handleEvents(channel, parsedMessage);
    }
    catch (error) {
      this.logger.error({
        channel,
        message: parsedMessage,
        error: error.message
      });
    }
  }

  async takeLead(opts: { incomers?: Set<RegisteredIncomer> } = {}) {
    const incomers = opts.incomers ?? await this.incomerStore.getIncomers();

    try {
      await once(this, "ABORT_TAKING_LEAD", {
        signal: AbortSignal.timeout(this.randomIntFromTimeoutRange())
      });

      if (this.isWorking) {
        this.updateState(false);
        await this.setAsInactiveDispatcher();
      }

      this.logger.warn("Dispatcher Timed out on taking lead");

      this.checkDispatcherStateInterval = setInterval(() => this.takeLeadBack()
        .catch((error) => this.logger.error({ error: error.stack }, "Fail while taking lead back")),
      this.pingInterval).unref();
    }
    catch {
      await this.dispatcherChannel.publish({
        name: "ABORT_TAKING_LEAD",
        redisMetadata: {
          origin: this.privateUUID
        }
      });

      try {
        await once(this, "ABORT_TAKING_LEAD", {
          signal: AbortSignal.timeout(this.randomIntFromTimeoutRange())
        });

        if (this.isWorking) {
          this.updateState(false);
          await this.setAsInactiveDispatcher();
        }

        await this.takeLead();
      }
      catch {
        this.updateState(true);
        await this.ping();

        for (const { providedUUID, prefix } of [...incomers.values()]) {
          await this.subscriber.subscribe(`${prefix ? `${prefix}-` : ""}${providedUUID}`);
        }

        this.logger.info(`Dispatcher ${this.selfProvidedUUID} took lead`);
      }
    }
  }

  private updateState(state: boolean) {
    this.isWorking = state;
  }

  private async takeLeadBack(opts: { incomers?: Set<RegisteredIncomer> } = {}) {
    const incomers = opts.incomers ?? await this.incomerStore.getIncomers();

    const dispatcherInstances = [...incomers.values()]
      .filter((incomer) => incomer.name === this.instanceName && incomer.baseUUID !== this.selfProvidedUUID);
    const dispatcherToRemove = dispatcherInstances
      .find((incomer) => incomer.isDispatcherActiveInstance && !this.incomerStore.isActive(incomer));

    if (!dispatcherToRemove && dispatcherInstances.length > 0) {
      return;
    }

    try {
      await once(this, "ABORT_TAKING_LEAD_BACK", {
        signal: AbortSignal.timeout(this.randomIntFromTimeoutRange())
      });

      if (this.isWorking) {
        this.updateState(false);
        await this.setAsInactiveDispatcher();
      }

      this.logger.warn("Dispatcher Timed out on taking back the lead");
    }
    catch {
      await this.setAsActiveDispatcher();
      await this.dispatcherChannel.publish({ name: "ABORT_TAKING_LEAD_BACK", redisMetadata: { origin: this.privateUUID } });

      clearInterval(this.checkLastActivityIntervalTimer);
      this.updateState(true);

      try {
        await Promise.all([
          this.ping(),
          dispatcherToRemove ? this.removeNonActives([dispatcherToRemove]) : () => void 0
        ]);
      }
      catch (error) {
        this.logger.error({ error: error.stack }, `${this.selfProvidedUUID} failed while taking back the lead`);

        return;
      }

      this.resetCheckLastActivityTimeout = setTimeout(() => this.transactionHandler.resolveTransactions()
        .then(() => {
          clearInterval(this.checkLastActivityIntervalTimer);
          this.checkLastActivityIntervalTimer = setInterval(() => this.checkLastActivity()
            .catch((error) => this.logger.error({ error: error.stack }, "failed while checking activity")),
          this.checkLastActivityInterval).unref();
        })
        .catch(
          (error) => this.logger.error({ error: error.stack }, "failed at resolving transaction while taking back the lead")
        ), this.resolveTransactionInterval).unref();

      if (this.checkDispatcherStateInterval) {
        clearInterval(this.checkDispatcherStateInterval);
        this.checkDispatcherStateInterval = undefined;
      }

      for (const { providedUUID, prefix } of [...incomers.values()]) {
        await this.subscriber.subscribe(`${prefix ? `${prefix}-` : ""}${providedUUID}`);
      }

      this.logger.info(
        // eslint-disable-next-line max-len
        `Dispatcher ${this.selfProvidedUUID} took lead back on ${dispatcherToRemove ? dispatcherToRemove.baseUUID ?? dispatcherToRemove.providedUUID : ""}`
      );
    }
  }

  private randomIntFromTimeoutRange() {
    return Math.floor((Math.random() * (this.maxTimeout - this.minTimeout)) + this.minTimeout);
  }

  private async checkLastActivity() {
    if (!this.isWorking) {
      return;
    }

    const inactiveIncomers = await this.incomerStore.getNonActives();

    const toResolve = [];

    let index = 0;
    for (const inactive of inactiveIncomers) {
      const transactionStore = new TransactionStore({
        prefix: `${inactive.prefix ? `${inactive.prefix}-` : ""}${inactive.providedUUID}`,
        instance: "incomer"
      });

      const transactions = await transactionStore.getTransactions();
      const recentPingTransactionKeys = [...(Object.entries(transactions) as [string, Transaction<"incomer">][])
        .filter(([, transaction]) => transaction.name === "PING" &&
          Date.now() < (Number(transaction.aliveSince) + Number(this.idleTime)))]
        .map(([transactionId]) => transactionId);

      if (recentPingTransactionKeys.length > 0) {
        toResolve.push(Promise.all([
          this.updateIncomerState(inactive.providedUUID),
          transactionStore.deleteTransactions(recentPingTransactionKeys)
        ]));

        inactiveIncomers.splice(index, 1);
      }

      index++;
    }

    await Promise.all(toResolve);

    await this.removeNonActives(inactiveIncomers);
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

      const incomerChannel = this.incomerChannelHandler.get(uuid) ??
        this.incomerChannelHandler.set({ uuid, prefix: incomer.prefix });

      const event: Omit<DispatcherPingMessage, "redisMetadata"> & {
        redisMetadata: Omit<DispatcherPingMessage["redisMetadata"], "transactionId">
      } = {
        name: "PING",
        data: null,
        redisMetadata: {
          origin: this.privateUUID,
          incomerName: "dispatcher",
          to: uuid
        }
      };

      concernedIncomers.push(uuid);

      pingToResolve.push(this.eventsHandler.dispatch({
        channel: incomerChannel,
        store: this.dispatcherTransactionStore,
        redisMetadata: {
          mainTransaction: true,
          eventTransactionId: null,
          relatedTransaction: null,
          resolved: false
        },
        event: event as any
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
      toHandle.push(Promise.all([
        this.incomerStore.deleteIncomer(inactive.providedUUID),
        this.transactionHandler.resolveInactiveIncomerTransactions(inactive),
        this.activeChannels.add(`${inactive.prefix ? `${inactive.prefix}-` : ""}${inactive.providedUUID}`)
      ]));
    }

    await Promise.all(toHandle);

    if (inactiveIncomers.length > 0) {
      this.logger.info(`[${inactiveIncomers.map(
        (incomer) => `(name:${incomer.name}|uuid:${incomer.providedUUID ?? incomer.baseUUID})`
      ).join(",")}], Removed Incomer`);
    }
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

  private async handleCustomEvents(channel: string, customEvent: EventMessage<T>) {
    const { redisMetadata, ...event } = customEvent;
    const { name } = event;
    const { transactionId } = redisMetadata;

    const logData = {
      channel,
      ...customEvent as EventMessage<T>
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
      if (name === "PING") {
        this.logger.warn(this.standardLogFn(logData)("No concerned Incomer found"));
      }
      else {
        await Promise.all([
          senderTransactionStore.updateTransaction(transactionId, {
            ...relatedTransaction,
            redisMetadata: {
              ...relatedTransaction.redisMetadata,
              mainTransaction: true,
              relatedTransaction: null,
              published: true
            }
          } as Transaction<"incomer">),
          this.backupDispatcherTransactionStore.setTransaction({
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

      const concernedIncomerChannel = this.incomerChannelHandler.get(providedUUID) ??
        this.incomerChannelHandler.set({ uuid: providedUUID, prefix });

      const formattedEvent = {
        ...customEvent,
        redisMetadata: {
          origin: this.privateUUID,
          to: providedUUID,
          incomerName: incomer.name
        }
      };

      toResolve.push(this.eventsHandler.dispatch({
        channel: concernedIncomerChannel,
        store: this.dispatcherTransactionStore,
        redisMetadata: {
          mainTransaction: false,
          relatedTransaction: transactionId,
          eventTransactionId: transactionId,
          resolved: false
        },
        event: formattedEvent as any
      }));
    }

    await this.updateIncomerState(redisMetadata.origin);
    await Promise.all([
      ...toResolve,
      senderTransactionStore.updateTransaction(transactionId, {
        ...relatedTransaction,
        redisMetadata: {
          ...relatedTransaction.redisMetadata,
          mainTransaction: true,
          relatedTransaction: null,
          published: true
        }
      } as Transaction<"incomer">)
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

    const incomers = await this.incomerStore.getIncomers();
    const now = Date.now();

    let providedUUID;
    if (data.providedUUID) {
      providedUUID = data.providedUUID;

      const relatedIncomer = [...incomers.values()]
        .find((incomer) => incomer.baseUUID === origin && incomer.providedUUID === providedUUID);

      if (!relatedIncomer) {
        const incomer = Object.assign({}, {
          ...data,
          isDispatcherActiveInstance: origin === this.selfProvidedUUID,
          baseUUID: origin,
          lastActivity: now,
          aliveSince: now,
          prefix
        });

        await this.incomerStore.setIncomer(incomer, data.providedUUID);
      }
    }
    else {
      for (const incomer of incomers) {
        if (incomer.baseUUID === origin) {
          await this.dispatcherTransactionStore.deleteTransaction(transactionId);

          throw new Error("Forbidden multiple registration for a same instance");
        }
      }

      const incomer = Object.assign({}, {
        ...data,
        isDispatcherActiveInstance: origin === this.selfProvidedUUID,
        baseUUID: origin,
        lastActivity: now,
        aliveSince: now,
        prefix
      });

      providedUUID = await this.incomerStore.setIncomer(incomer);
    }

    this.incomerChannelHandler.set({ uuid: providedUUID, prefix });

    if (!this.activeChannels.has(`${prefix ? `${prefix}-` : ""}${providedUUID}`)) {
      await this.subscriber.subscribe(`${prefix ? `${prefix}-` : ""}${providedUUID}`);
    }

    const event: Omit<DispatcherApprovementMessage, "redisMetadata"> & {
      redisMetadata: Omit<DispatcherApprovementMessage["redisMetadata"], "transactionId">
    } = {
      name: "APPROVEMENT",
      data: {
        uuid: providedUUID
      },
      redisMetadata: {
        origin: this.privateUUID,
        incomerName: "dispatcher",
        to: redisMetadata.origin
      }
    };

    await this.eventsHandler.dispatch({
      channel: this.dispatcherChannel as Channel<DispatcherChannelMessages["DispatcherMessages"]>,
      store: this.dispatcherTransactionStore,
      redisMetadata: {
        mainTransaction: false,
        relatedTransaction: transactionId,
        eventTransactionId: null,
        resolved: false
      },
      event: event as any
    });

    this.logger.info("Approved Incomer");
  }
}
