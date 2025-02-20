/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable max-lines */

// Import Third-party Dependencies
import { Channel,
  RedisAdapter,
  Types
} from "@myunisoft/redis";
import { Mutex } from "@openally/mutex";
import type { Logger } from "pino";

// Import Internal Dependencies
import {
  TransactionStore,
  type Transaction,
  type Transactions
} from "../../store/transaction.class.js";
import { IncomerStore } from "../../store/incomer.class.js";
import { IncomerChannelHandler } from "./incomer-channel.class.js";
import {
  type StandardLog,
  type StandardLogOpts,
  defaultStandardLog
} from "../../../utils/index.js";
import { EventsHandler } from "./events.class.js";
import type {
  DispatcherApprovementMessage,
  TransactionMetadata,
  DistributedEventMessage,
  GenericEvent,
  IncomerChannelMessages,
  RegisteredIncomer
} from "../../../types/index.js";


interface DistributeMainTransactionOptions {
  isoPublisherIncomer: RegisteredIncomer;
  incomerTransaction: Transaction<"incomer">;
  inactiveIncomerTransactionStore: TransactionStore<"incomer">;
  incomerTransactionId: string;
}

interface ResolveTransactions {
  incomers: Set<RegisteredIncomer>;
  backupIncomerTransactions: Transactions<"incomer">;
  dispatcherTransactions: Transactions<"dispatcher">;
}

interface FindISOIncomerOptions {
  incomers: RegisteredIncomer[]
  incomerName: string;
  eventName: string;
  key: "eventsCast" | "eventsSubscribe";
}

type DispatchedEvent<T extends GenericEvent> = (
  IncomerChannelMessages<T>["DispatcherMessages"] | DispatcherApprovementMessage
) & {
  redisMetadata: Omit<DispatcherApprovementMessage["redisMetadata"], "transactionId">
};

export interface DispatchEventOptions<T extends GenericEvent> {
  channel: Channel<DispatchedEvent<T>>;
  redisMetadata: {
    mainTransaction: boolean;
    relatedTransaction?: null | string;
    eventTransactionId?: null | string;
    resolved: boolean;
  }
  event: DispatchedEvent<T>;
}

export type TransactionHandlerOptions<T extends GenericEvent = GenericEvent> = {
  redis: Types.DatabaseConnection<RedisAdapter>;
  eventsHandler: EventsHandler<T>;
  dispatcherTransactionStore: TransactionStore<"dispatcher">;
  backupDispatcherTransactionStore: TransactionStore<"dispatcher">;
  backupIncomerTransactionStore: TransactionStore<"incomer">;
  incomerChannelHandler: IncomerChannelHandler<T>;
  incomerStore: IncomerStore;
  privateUUID: string;
  parentLogger: Logger;
  logger?: Logger;
  standardLog?: StandardLog<T>;
  pingInterval?: number;
};

export interface RedistributeUnresolvedSpreadTransactionOptions {
  backupIncomerTransaction: Transaction<"incomer">;
  isoListener: RegisteredIncomer;
  relatedDispatcherTransactionId: string;
  backupTransactionId: string;
}

export interface RedistributeUnresolvedSpreadTransactionResponse<T extends GenericEvent = GenericEvent> {
  dispatcherTransactionUUID: string;
  event: Omit<DistributedEventMessage, "redisMetadata"> & {
    redisMetadata: Omit<TransactionMetadata<"dispatcher">, "iteration" | "transactionId">
  };
  redisMetadata: DispatchEventOptions<T>["redisMetadata"];
}

export interface RedistributeResolvedSpreadTransactionOptions {
  isoListener: RegisteredIncomer,
  backupIncomerTransaction: Transaction<"incomer">;
  backupTransactionId: string;
  relatedDispatcherTransaction: Transaction<"dispatcher">,
  relatedDispatcherTransactionId: string;
}

export class TransactionHandler<T extends GenericEvent = GenericEvent> {
  readonly privateUUID;

  public incomerStore: IncomerStore;
  public dispatcherTransactionStore: TransactionStore<"dispatcher">;
  public backupIncomerTransactionStore: TransactionStore<"incomer">;

  #redis: Types.DatabaseConnection<RedisAdapter>;

  // #incomerChannelHandler: IncomerChannelHandler<T>;
  // #eventsHandler: EventsHandler<T>;
  #logger: Logger;
  #standardLogFn: StandardLog<T>;

  #resolveTransactionsLock = new Mutex({ concurrency: 1 });

  constructor(opts: TransactionHandlerOptions<T>) {
    Object.assign(this, opts);

    this.#redis = opts.redis;

    // this.#incomerChannelHandler = opts.incomerChannelHandler;
    // this.#eventsHandler = opts.eventsHandler;

    this.#logger = opts.parentLogger.child({ module: "transaction-handler" }) || opts.parentLogger;
    this.#standardLogFn = opts.standardLog ?? defaultStandardLog;
  }

  public async resolveTransactions() {
    const free = await this.#resolveTransactionsLock.acquire();

    try {
      const [incomers, backupIncomerTransactions, dispatcherTransactions] = await Promise.all([
        this.incomerStore.getIncomers(),
        this.backupIncomerTransactionStore.getTransactions(),
        this.dispatcherTransactionStore.getTransactions()
      ]);

      let options = {
        incomers,
        backupIncomerTransactions,
        dispatcherTransactions
      };

      options = await this.handleBackupIncomerTransactions(options);

      await this.resolveMainTransactions(options);
    }
    finally {
      free();
    }
  }

  public async resolveInactiveIncomerTransactions(
    inactiveIncomer: RegisteredIncomer
  ) {
    const inactiveIncomerTransactionStore = new TransactionStore({
      adapter: this.#redis,
      prefix: inactiveIncomer.providedUUID,
      instance: "incomer"
    });

    const incomerTransactions = await inactiveIncomerTransactionStore.getTransactions();
    const dispatcherTransactions = await this.dispatcherTransactionStore.getTransactions();

    const incomers = await this.incomerStore.getIncomers();

    for (const incomer of incomers.values()) {
      if (incomer.providedUUID === inactiveIncomer.providedUUID) {
        incomers.delete(incomer);

        break;
      }
    }

    const transactionsToResolve: Promise<any>[] = [];

    const concernedDispatcherTransactions = [...dispatcherTransactions]
      .filter(([__, dispatcherTransaction]) => dispatcherTransaction.redisMetadata.to === inactiveIncomer.providedUUID ||
        dispatcherTransaction.redisMetadata.to === inactiveIncomer.baseUUID);

    const dispatcherPingTransactions = new Map(
      [...concernedDispatcherTransactions]
        .filter(
          ([__, dispatcherTransaction]) => dispatcherTransaction.name === "PING"
        )
    );

    transactionsToResolve.push(this.dispatcherTransactionStore.deleteTransactions([...dispatcherPingTransactions.keys()]));

    const dispatcherApprovementTransactions = new Map(
      [...concernedDispatcherTransactions]
        .filter(([__, dispatcherTransaction]) => dispatcherTransaction.name === "APPROVEMENT")
    );

    const incomerRegistrationTransactions = new Map(
      [...incomerTransactions].flatMap(([__, incomerTransaction]) => {
        if (incomerTransaction.name === "REGISTER") {
          return [[incomerTransaction.redisMetadata.relatedTransaction, incomerTransaction]];
        }

        return [];
      })
    );

    transactionsToResolve.push(
      Promise.all(
        [...incomerRegistrationTransactions]
          .map(([relatedApprovementTransactionId, incomerTransaction]) => {
            if (!dispatcherApprovementTransactions.has(relatedApprovementTransactionId)) {
              return inactiveIncomerTransactionStore.deleteTransaction(incomerTransaction.redisMetadata.transactionId);
            }

            return Promise.all([
              inactiveIncomerTransactionStore.deleteTransaction(incomerTransaction.redisMetadata.transactionId),
              this.dispatcherTransactionStore.deleteTransaction(relatedApprovementTransactionId)
            ]);
          })
      )
    );

    await Promise.all(transactionsToResolve);
    transactionsToResolve.length = 0;

    const restIncomerTransaction = new Map(
      [...incomerTransactions]
        .filter(([__, incomerTransaction]) => incomerTransaction.name !== "REGISTER" && incomerTransaction.name !== "PING")
    );

    const mainTransactionResolutionPromises = [...restIncomerTransaction.entries()]
      .flatMap(([incomerTransactionId, incomerTransaction]) => {
        const isoPublisherIncomer = this.findISOIncomer({
          incomers: [...incomers.values()],
          incomerName: inactiveIncomer.name,
          eventName: incomerTransaction.name,
          key: "eventsCast"
        });

        return [isoPublisherIncomer ? this.distributeMainTransaction({
          isoPublisherIncomer,
          incomerTransaction,
          inactiveIncomerTransactionStore,
          incomerTransactionId
        }) : this.backupMainTransaction(
          inactiveIncomerTransactionStore,
          incomerTransactionId,
          incomerTransaction
        )];
      });

    transactionsToResolve.push(Promise.all(mainTransactionResolutionPromises));

    await Promise.all(transactionsToResolve);
  }

  private async backupMainTransaction(
    inactiveIncomerTransactionStore: TransactionStore<"incomer">,
    incomerTransactionId: string,
    incomerTransaction: Transaction<"incomer">
  ) {
    const [newlyTransaction] = await Promise.all([
      this.backupIncomerTransactionStore.setTransaction({
        ...incomerTransaction
      }, incomerTransactionId),
      inactiveIncomerTransactionStore.deleteTransaction(incomerTransactionId)
    ]);

    this.#logger.debug(this.#standardLogFn({
      ...newlyTransaction,
      redisMetadata: {
        ...newlyTransaction.redisMetadata,
        origin: this.privateUUID
      }
    } as unknown as StandardLogOpts<T>)("Main transaction has been backup"));
  }

  private async distributeMainTransaction(options: DistributeMainTransactionOptions) {
    const {
      isoPublisherIncomer,
      incomerTransaction,
      inactiveIncomerTransactionStore,
      incomerTransactionId
    } = options;
    const { providedUUID } = isoPublisherIncomer;

    const concernedIncomerStore = new TransactionStore({
      adapter: this.#redis,
      prefix: providedUUID,
      instance: "incomer"
    });

    const [newlyIncomerMainTransaction] = await Promise.all([
      concernedIncomerStore.setTransaction({
        ...incomerTransaction,
        redisMetadata: {
          ...incomerTransaction.redisMetadata,
          origin: providedUUID
        }
      }, incomerTransactionId),
      inactiveIncomerTransactionStore.deleteTransaction(incomerTransactionId)
    ]);

    this.#logger.debug(this.#standardLogFn(
      newlyIncomerMainTransaction as unknown as StandardLogOpts<T>
    )("Main transaction redistributed to an Incomer"));
  }

  private async handleBackupIncomerTransactions(options: ResolveTransactions): Promise<ResolveTransactions> {
    const { incomers, backupIncomerTransactions, dispatcherTransactions } = options;

    const toResolve = [];

    for (const [backupTransactionId, backupIncomerTransaction] of backupIncomerTransactions.entries()) {
      const isoPublisher = this.findISOIncomer({
        incomers: [...incomers.values()],
        incomerName: backupIncomerTransaction.redisMetadata.incomerName,
        eventName: backupIncomerTransaction.name,
        key: "eventsCast"
      });

      if (!isoPublisher) {
        continue;
      }

      await this.redistributeMainTransaction(isoPublisher, backupIncomerTransaction, backupTransactionId);

      backupIncomerTransactions.delete(backupTransactionId);
    }

    await Promise.all(toResolve);

    return { incomers, backupIncomerTransactions, dispatcherTransactions };
  }

  private findISOIncomer(options: FindISOIncomerOptions) : RegisteredIncomer | undefined {
    const { incomers, incomerName, eventName, key } = options;

    return incomers.find((incomer) => {
      const isoEvent = key === "eventsCast" ? incomer.eventsCast.find((event) => event === eventName) :
        incomer.eventsSubscribe.find((event) => event.name === eventName);

      return incomer.name === incomerName && isoEvent;
    });
  }

  private async redistributeMainTransaction(
    isoPublisher: RegisteredIncomer,
    backupIncomerTransaction: Transaction<"incomer">,
    backupTransactionId: string
  ): Promise<void> {
    const concernedIncomerStore = new TransactionStore({
      adapter: this.#redis,
      prefix: isoPublisher.providedUUID,
      instance: "incomer"
    });

    await Promise.all([
      concernedIncomerStore.setTransaction({
        ...backupIncomerTransaction,
        redisMetadata: {
          ...backupIncomerTransaction.redisMetadata,
          origin: isoPublisher.providedUUID
        }
      }, backupTransactionId),
      this.backupIncomerTransactionStore.deleteTransaction(backupTransactionId)
    ]);
  }

  private async resolveMainTransactions(options: ResolveTransactions) {
    const { incomers, backupIncomerTransactions, dispatcherTransactions } = options;

    const toResolve: Promise<void>[] = [];
    const incomerStateToUpdate = new Set<string>();

    for (const incomer of incomers) {
      const incomerStore = new TransactionStore({
        adapter: this.#redis,
        prefix: incomer.providedUUID,
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
        const relatedDispatcherTransactions: Transaction<"dispatcher">[] = [...dispatcherTransactions.values()]
          .filter((dispatcherTransaction) => dispatcherTransaction.redisMetadata.relatedTransaction === incomerTransactionId);

        if (relatedDispatcherTransactions.length === 0) {
          continue;
        }

        const unResolvedRelatedTransactions = [...relatedDispatcherTransactions.values()].filter(
          (dispatcherTransaction) => !dispatcherTransaction.redisMetadata.resolved
        );

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

    toResolve.push(...[...incomerStateToUpdate.values()].map(
      (incomerId) => this.incomerStore.updateIncomerState(incomerId))
    );

    await Promise.all(toResolve);
  }
}
