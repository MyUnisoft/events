
/* eslint-disable max-lines */

// Import Third-party Dependencies
import { Channel,
  RedisAdapter
} from "@myunisoft/redis";
import { Mutex } from "@openally/mutex";
import type { Logger } from "pino";

// Import Internal Dependencies
import {
  TransactionStore,
  type Transaction,
  type Transactions
} from "./store/transaction.class.js";
import { IncomerStore } from "./store/incomer.class.js";
import { IncomerChannelHandler } from "./incomer-channel.class.js";
import {
  type StandardLog,
  type StandardLogOpts,
  defaultStandardLog
} from "../utils/index.js";
import { EventsHandler } from "./events.class.js";
import type {
  DispatcherApprovementMessage,
  TransactionMetadata,
  DistributedEventMessage,
  GenericEvent,
  IncomerChannelMessages,
  RegisteredIncomer
} from "../types/index.js";


interface DistributeMainTransactionOptions {
  isoPublisherIncomer: RegisteredIncomer;
  incomerTransaction: Transaction<"incomer">;
  inactiveIncomerTransactionStore: TransactionStore<"incomer">;
  incomerTransactionId: string;
}

interface ResolveTransactions {
  incomers: Set<RegisteredIncomer>;
  backupIncomerTransactions: Transactions<"incomer">;
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
  redis: RedisAdapter;
  eventsHandler: EventsHandler<T>;
  dispatcherTransactionStore: TransactionStore<"dispatcher">;
  backupDispatcherTransactionStore: TransactionStore<"dispatcher">;
  backupIncomerTransactionStore: TransactionStore<"incomer">;
  incomerChannelHandler: IncomerChannelHandler<T>;
  incomerStore: IncomerStore;
  privateUUID: string;
  parentLogger: Logger;
  idleTime: number;
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
  public backupDispatcherTransactionStore: TransactionStore<"dispatcher">;
  public backupIncomerTransactionStore: TransactionStore<"incomer">;

  #idleTime: number;
  #redis: RedisAdapter;

  #incomerChannelHandler: IncomerChannelHandler<T>;
  #eventsHandler: EventsHandler<T>;
  #logger: Logger;
  #standardLogFn: StandardLog<T>;

  #resolveTransactionsLock = new Mutex({ concurrency: 1 });

  constructor(opts: TransactionHandlerOptions<T>) {
    Object.assign(this, opts);

    this.#redis = opts.redis;

    this.#idleTime = opts.idleTime;
    this.#incomerChannelHandler = opts.incomerChannelHandler;
    this.#eventsHandler = opts.eventsHandler;

    this.#logger = opts.parentLogger.child({ module: "transaction-handler" }) || opts.parentLogger;
    this.#standardLogFn = opts.standardLog ?? defaultStandardLog;
  }

  public close() {
    this.#resolveTransactionsLock.reset();
  }

  public async resolveTransactions() {
    const free = await this.#resolveTransactionsLock.acquire();

    try {
      const [incomers, backupIncomerTransactions, dispatcherTransactions, backupDispatcherTransactions] = await Promise.all([
        this.incomerStore.getIncomers(),
        this.backupIncomerTransactionStore.getTransactions(),
        this.dispatcherTransactionStore.getTransactions(),
        this.backupDispatcherTransactionStore.getTransactions()
      ]);

      let sharedOptions = {
        incomers,
        backupIncomerTransactions
      };

      const mappedBackupDispatcherTransactions = new Map([...backupDispatcherTransactions.entries()]
        .map(([id, backupTransaction]) => {
          const formatted = {
            ...backupTransaction,
            isBackupTransaction: true
          };

          return [id, formatted];
        }));

      sharedOptions = await this.handleBackupIncomerTransactions(sharedOptions);

      await this.resolvePingTransactions(dispatcherTransactions);

      await this.resolveMainTransactions({
        ...sharedOptions,
        dispatcherTransactions: new Map([...dispatcherTransactions, ...mappedBackupDispatcherTransactions])
      });
    }
    finally {
      free();
    }
  }

  public async resolveInactiveIncomerTransactions(
    inactiveIncomer: RegisteredIncomer
  ) {
    const inactiveIncomerTransactionStore = new TransactionStore({
      adapter: this.#redis as RedisAdapter<Transaction<"incomer">>,
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
      .filter(([, dispatcherTransaction]) => dispatcherTransaction.redisMetadata.to === inactiveIncomer.providedUUID ||
        dispatcherTransaction.redisMetadata.to === inactiveIncomer.baseUUID);

    const dispatcherPingTransactions = new Map(
      [...concernedDispatcherTransactions]
        .filter(
          ([, dispatcherTransaction]) => dispatcherTransaction.name === "PING"
        )
    );

    if ([...dispatcherPingTransactions.keys()].length > 0) {
      transactionsToResolve.push(
        this.dispatcherTransactionStore.deleteTransactions(
          [...dispatcherPingTransactions.keys()]
        )
      );
    }

    const dispatcherApprovementTransactions = new Map(
      [...concernedDispatcherTransactions]
        .filter(([, dispatcherTransaction]) => dispatcherTransaction.name === "APPROVEMENT")
    );

    const incomerRegistrationTransactions = new Set(
      [...incomerTransactions.values()].filter((incomerTransaction) => incomerTransaction.name === "REGISTER")
    );

    transactionsToResolve.push(
      Promise.all(
        [...incomerRegistrationTransactions].map((registrationTransaction) => {
          if (registrationTransaction.redisMetadata.relatedTransaction !== null) {
            if (!dispatcherApprovementTransactions.has(registrationTransaction.redisMetadata.relatedTransaction[0])) {
              return inactiveIncomerTransactionStore.deleteTransaction(registrationTransaction.redisMetadata.transactionId);
            }

            return Promise.all([
              inactiveIncomerTransactionStore.deleteTransaction(registrationTransaction.redisMetadata.transactionId),
              this.dispatcherTransactionStore.deleteTransaction(registrationTransaction.redisMetadata.relatedTransaction[0])
            ]);
          }

          return inactiveIncomerTransactionStore.deleteTransaction(registrationTransaction.redisMetadata.transactionId);
        })
      )
    );

    await Promise.all(transactionsToResolve);
    transactionsToResolve.length = 0;

    const restIncomerTransaction = new Map(
      [...incomerTransactions]
        .filter(([, incomerTransaction]) => incomerTransaction.name !== "REGISTER" && incomerTransaction.name !== "PING")
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

    const restDispatcherTransactions = new Map(
      [...concernedDispatcherTransactions]
        .filter(
          ([, dispatcherTransaction]) => dispatcherTransaction.name !== "APPROVEMENT" &&
            dispatcherTransaction.name !== "PING"
        )
    );

    for (const [id, dispatcherTransaction] of restDispatcherTransactions.entries()) {
      if (dispatcherTransaction.redisMetadata.resolved) {
        continue;
      }

      const isoSubscriberIncomer = this.findISOIncomer({
        incomers: [...incomers],
        incomerName: dispatcherTransaction.redisMetadata.incomerName,
        eventName: dispatcherTransaction.name,
        key: "eventsSubscribe"
      });

      if (isoSubscriberIncomer) {
        const { providedUUID } = isoSubscriberIncomer;

        const isoSubscriberChannel = this.#incomerChannelHandler.get(providedUUID) ??
          this.#incomerChannelHandler.set({ uuid: providedUUID });

        transactionsToResolve.push(Promise.all([
          this.#eventsHandler.dispatch({
            channel: isoSubscriberChannel,
            store: this.dispatcherTransactionStore,
            redisMetadata: {
              ...dispatcherTransaction.redisMetadata,
              relatedTransaction: dispatcherTransaction.redisMetadata.relatedTransaction as string
            },
            event: {
              ...dispatcherTransaction,
              redisMetadata: {
                ...dispatcherTransaction.redisMetadata,
                origin: dispatcherTransaction.redisMetadata.origin,
                to: providedUUID
              }
            } as any
          }),
          this.dispatcherTransactionStore.deleteTransaction(id)
        ]));

        this.#logger.info(this.#standardLogFn({
          ...dispatcherTransaction,
          redisMetadata: {
            ...dispatcherTransaction.redisMetadata,
            origin: this.privateUUID,
            to: providedUUID
          }
        } as unknown as StandardLogOpts<T>)("Redistributed unresolved injected event to an Incomer"));

        continue;
      }

      transactionsToResolve.push(Promise.all([
        this.backupDispatcherTransactionStore.setTransaction({
          ...dispatcherTransaction
        } as any, dispatcherTransaction.redisMetadata.transactionId),
        this.dispatcherTransactionStore.deleteTransaction(id)
      ]));

      this.#logger.info(this.#standardLogFn({
        ...dispatcherTransaction,
        redisMetadata: {
          ...dispatcherTransaction.redisMetadata,
          origin: this.privateUUID
        }
      } as unknown as StandardLogOpts<T>)("Backup unresolved injected event"));
    }

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
      adapter: this.#redis as RedisAdapter<Transaction<"incomer">>,
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
    const { incomers, backupIncomerTransactions } = options;

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

    return { incomers, backupIncomerTransactions };
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
      adapter: this.#redis as RedisAdapter<Transaction<"incomer">>,
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

  private async resolvePingTransactions(dispatcherTransactions: Transactions<"dispatcher">) {
    for (const dispatcherTransaction of dispatcherTransactions.values()) {
      if (dispatcherTransaction.name === "PING" && dispatcherTransaction.redisMetadata.resolved) {
        try {
          await this.incomerStore.updateIncomerState(dispatcherTransaction.redisMetadata.to);
        }
        catch {
          // Do Nothing
        }

        await this.dispatcherTransactionStore.deleteTransaction(dispatcherTransaction.redisMetadata.transactionId);
      }
    }
  }

  private async resolveMainTransactions(options: ResolveTransactions & { dispatcherTransactions: Transactions<"dispatcher">}) {
    const { incomers, backupIncomerTransactions, dispatcherTransactions } = options;

    const toResolve = [];
    const incomerStateToUpdate = new Set<string>();

    for (const incomer of incomers) {
      const incomerStore = new TransactionStore({
        adapter: this.#redis as RedisAdapter<Transaction<"incomer">>,
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
        ) as (Transaction<"dispatcher"> & { isBackupTransaction?: boolean })[];


        if (unResolvedRelatedTransactions.length > 0) {
          await this.republishBackupDispatcherEvents({
            unResolvedRelatedTransactions,
            incomers
          });

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

    try {
      await Promise.all([...incomerStateToUpdate.values()].map(
        (incomerId) => this.incomerStore.updateIncomerState(incomerId)
      ));
    }
    catch {
      //
    }

    await Promise.all(toResolve);
  }

  private async republishBackupDispatcherEvents(options: {
    unResolvedRelatedTransactions: (Transaction<"dispatcher"> & { isBackupTransaction?: boolean })[];
    incomers: Set<RegisteredIncomer>;
  }) {
    const { unResolvedRelatedTransactions, incomers } = options;
    const now = Date.now();

    const toResolve = [];

    for (const dispatcherTransaction of unResolvedRelatedTransactions) {
      if (
        (now >= (Number(dispatcherTransaction.aliveSince) + Number(this.#idleTime))) &&
        dispatcherTransaction.isBackupTransaction
      ) {
        const isoSubscriberIncomer = this.findISOIncomer({
          incomers: [...incomers],
          incomerName: dispatcherTransaction.redisMetadata.incomerName,
          eventName: dispatcherTransaction.name,
          key: "eventsSubscribe"
        });

        if (isoSubscriberIncomer) {
          const { providedUUID } = isoSubscriberIncomer;

          const isoSubscriberChannel = this.#incomerChannelHandler.get(providedUUID) ??
            this.#incomerChannelHandler.set({ uuid: providedUUID });

          toResolve.push(Promise.all([
            this.#eventsHandler.dispatch({
              channel: isoSubscriberChannel,
              store: this.dispatcherTransactionStore,
              redisMetadata: {
                ...dispatcherTransaction.redisMetadata,
                relatedTransaction: dispatcherTransaction.redisMetadata.relatedTransaction as string
              },
              event: {
                ...dispatcherTransaction,
                redisMetadata: {
                  ...dispatcherTransaction.redisMetadata,
                  origin: dispatcherTransaction.redisMetadata.origin,
                  to: providedUUID
                }
              } as any
            }),
            this.backupDispatcherTransactionStore.deleteTransaction(dispatcherTransaction.redisMetadata.transactionId)
          ]));

          this.#logger.info(this.#standardLogFn({
            ...dispatcherTransaction,
            redisMetadata: {
              ...dispatcherTransaction.redisMetadata,
              origin: this.privateUUID,
              to: providedUUID
            }
          } as unknown as StandardLogOpts<T>)("Redistributed unresolved injected event to an Incomer"));

          continue;
        }
      }
    }
  }
}
