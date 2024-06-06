/* eslint-disable max-lines */
// Import Third-party Dependencies
import { Channel } from "@myunisoft/redis";
import { Mutex } from "@openally/mutex";

// Import Internal Dependencies
import {
  IncomerHandlerTransaction,
  Transaction,
  TransactionStore,
  Transactions
} from "../../store/transaction.class";
import { IncomerStore, RegisteredIncomer } from "../../store/incomer.class";
import {
  DispatcherChannelMessages,
  GenericEvent,
  IncomerChannelMessages
} from "../../../types";
import { IncomerChannelHandler } from "./incomer-channel.class";
import { DefaultOptions, PartialLogger, SharedOptions } from "../dispatcher.class";
import { StandardLog, StandardLogOpts, defaultStandardLog } from "../../../utils";
import { EventsHandler } from "./events.class";

interface DistributeMainTransactionOptions {
  isoPublisherIncomer: RegisteredIncomer;
  incomerTransaction: Transaction<"incomer">;
  inactiveIncomerTransactionStore: TransactionStore<"incomer">;
  incomerTransactionId: string;
}

interface BackupSpreadTransactionsOptions {
  concernedDispatcherTransactions: Transactions<"dispatcher">;
  handlerIncomerTransactions: Transactions<"incomer">;
  inactiveIncomerTransactionStore: TransactionStore<"incomer">;
  incomers: Set<RegisteredIncomer>;
}

interface FindISOIncomerOptions {
  incomers: RegisteredIncomer[]
  incomerName: string;
  eventName: string;
  key: "eventsCast" | "eventsSubscribe";
}

function findISOIncomer(options: FindISOIncomerOptions):
  RegisteredIncomer | undefined {
  const { incomers, incomerName, eventName, key } = options;

  return incomers.find((incomer) => {
    const isoEvent = key === "eventsCast" ? incomer.eventsCast.find((event) => event === eventName) :
      incomer.eventsSubscribe.find((event) => event.name === eventName);

    return incomer.name === incomerName && isoEvent;
  });
}

type DispatchedEvent<T extends GenericEvent> = (
  IncomerChannelMessages<T>["DispatcherMessages"] | DispatcherChannelMessages["DispatcherMessages"]
) & {
  redisMetadata: Omit<DispatcherChannelMessages["DispatcherMessages"]["redisMetadata"], "transactionId">
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

export type TransactionHandlerOptions<T extends GenericEvent = GenericEvent> = DefaultOptions<T> & SharedOptions<T> & {
  eventsHandler: EventsHandler<T>;
};

export class TransactionHandler<T extends GenericEvent = GenericEvent> {
  readonly prefix: string;
  readonly formattedPrefix: string;
  readonly privateUUID;

  public incomerStore: IncomerStore;
  public dispatcherTransactionStore: TransactionStore<"dispatcher">;
  public backupIncomerTransactionStore: TransactionStore<"incomer">;

  private incomerChannelHandler: IncomerChannelHandler<T>;
  private eventsHandler: EventsHandler<T>;
  private logger: PartialLogger;
  private standardLogFn: StandardLog<T>;

  private resolveTransactionsLock = new Mutex({ concurrency: 1 });

  constructor(opts: TransactionHandlerOptions<T>) {
    Object.assign(this, opts);

    this.logger = opts.parentLogger.child({ module: "transaction-handler" }) || opts.parentLogger;
    this.standardLogFn = opts.standardLog ?? defaultStandardLog;
  }

  public async resolveTransactions() {
    const free = await this.resolveTransactionsLock.acquire();

    try {
      await this.handleBackupIncomerTransactions();

      await this.resolveSpreadTransactions();
      await this.resolveMainTransactions();
    }
    finally {
      free();
    }
  }

  public async resolveInactiveIncomerTransactions(
    inactiveIncomer: RegisteredIncomer
  ) {
    const inactiveIncomerTransactionStore = new TransactionStore({
      prefix: `${inactiveIncomer.prefix ? `${inactiveIncomer.prefix}-` : ""}${inactiveIncomer.providedUUID}`,
      instance: "incomer"
    });

    const incomerTransactions = await inactiveIncomerTransactionStore.getTransactions();
    const dispatcherTransactions = await this.dispatcherTransactionStore.getTransactions();

    const incomers = await this.incomerStore.getIncomers();

    delete incomers[inactiveIncomer.providedUUID];

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

    const incomerPingTransactions = new Map([...incomerTransactions].flatMap(([__, incomerTransaction]) => {
      if (incomerTransaction.name === "PING") {
        return [[incomerTransaction.redisMetadata.relatedTransaction, incomerTransaction]];
      }

      return [];
    }));

    transactionsToResolve.push(
      Promise.all(
        [...dispatcherPingTransactions]
          .map(([relatedPingTransactionId]) => {
            if (!incomerPingTransactions.has(relatedPingTransactionId)) {
              return this.dispatcherTransactionStore.deleteTransaction(relatedPingTransactionId);
            }

            const relatedIncomerPingTransaction = incomerPingTransactions.get(relatedPingTransactionId);

            return Promise.all([
              inactiveIncomerTransactionStore.deleteTransaction(relatedIncomerPingTransaction.redisMetadata.transactionId),
              this.dispatcherTransactionStore.deleteTransaction(relatedPingTransactionId)
            ]);
          })
      )
    );

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

    const concernedDispatcherTransactionRest = new Map(
      [...concernedDispatcherTransactions]
        .filter(([__, dispatcherTransaction]) => dispatcherTransaction.name !== "APPROVEMENT" &&
          dispatcherTransaction.name !== "PING"
        )
    );

    const mainTransactionResolutionPromises = [...restIncomerTransaction.entries()]
      .flatMap(([incomerTransactionId, incomerTransaction]) => {
        if (incomerTransaction.redisMetadata.mainTransaction) {
          const isoPublisherIncomer = findISOIncomer({
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
        }

        return [];
      });

    transactionsToResolve.push(Promise.all(mainTransactionResolutionPromises));

    const handlerIncomerTransactionRest = new Map(
      [...restIncomerTransaction]
        .filter(([__, incomerTransaction]) => !incomerTransaction.redisMetadata.mainTransaction)
    );

    transactionsToResolve.push(this.backupSpreadTransactions({
      concernedDispatcherTransactions: concernedDispatcherTransactionRest,
      handlerIncomerTransactions: handlerIncomerTransactionRest,
      inactiveIncomerTransactionStore,
      incomers
    }));

    await Promise.all(transactionsToResolve);
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
      this.standardLogFn({ ...relatedHandlerTransaction } as any)("Resolved transaction has been back up")
    );
  }

  private async backupSpreadTransactions(options: BackupSpreadTransactionsOptions): Promise<any> {
    const {
      concernedDispatcherTransactions,
      handlerIncomerTransactions,
      inactiveIncomerTransactionStore,
      incomers
    } = options;

    const toResolve: Promise<any>[] = [];

    for (const [id, dispatcherTransaction] of concernedDispatcherTransactions.entries()) {
      if (!dispatcherTransaction.redisMetadata.relatedTransaction) {
        toResolve.push(this.removeDispatcherUnknownTransaction(dispatcherTransaction));

        continue;
      }

      const isoSubscriberIncomer = findISOIncomer({
        incomers: [...incomers],
        incomerName: dispatcherTransaction.redisMetadata.incomerName,
        eventName: dispatcherTransaction.name,
        key: "eventsSubscribe"
      });

      const relatedHandlerTransaction = [...handlerIncomerTransactions.values()]
        .find(
          (transaction) => transaction.redisMetadata.relatedTransaction === dispatcherTransaction.redisMetadata.transactionId
        );

      if (relatedHandlerTransaction && relatedHandlerTransaction.redisMetadata.resolved) {
        toResolve.push(this.backupResolvedTransaction(relatedHandlerTransaction, inactiveIncomerTransactionStore));

        continue;
      }

      if (isoSubscriberIncomer) {
        const { providedUUID, prefix } = isoSubscriberIncomer;

        const isoSubscriberChannel = this.incomerChannelHandler.get(providedUUID) ??
          this.incomerChannelHandler.set({ uuid: providedUUID, prefix });

        toResolve.push(Promise.all([
          this.eventsHandler.dispatch({
            channel: isoSubscriberChannel,
            store: this.dispatcherTransactionStore,
            redisMetadata: {
              ...dispatcherTransaction.redisMetadata
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
          this.dispatcherTransactionStore.deleteTransaction(id),
          typeof relatedHandlerTransaction === "undefined" ? () => void 0 :
            inactiveIncomerTransactionStore.deleteTransaction(relatedHandlerTransaction.redisMetadata.transactionId)
        ]));

        this.logger.debug(this.standardLogFn({
          ...dispatcherTransaction,
          redisMetadata: {
            ...dispatcherTransaction.redisMetadata,
            origin: this.privateUUID,
            to: providedUUID
          }
        } as unknown as StandardLogOpts<T>)("Redistributed unresolved injected event to an Incomer"));

        continue;
      }

      toResolve.push(Promise.all([
        this.backupIncomerTransactionStore.setTransaction({
          ...dispatcherTransaction
        }, dispatcherTransaction.redisMetadata.transactionId),
        typeof relatedHandlerTransaction === "undefined" ? () => void 0 :
          inactiveIncomerTransactionStore.deleteTransaction(relatedHandlerTransaction.redisMetadata.transactionId)
      ]));

      this.logger.debug(this.standardLogFn(
        dispatcherTransaction as unknown as StandardLogOpts<T>
      )("Spread transaction has been backup"));

      continue;
    }

    await Promise.all(toResolve);
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

    this.logger.info(this.standardLogFn({
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
    const { prefix, providedUUID } = isoPublisherIncomer;

    const concernedIncomerStore = new TransactionStore({
      prefix: `${prefix ? `${prefix}-` : ""}${providedUUID}`,
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

    this.logger.debug(this.standardLogFn(
      newlyIncomerMainTransaction as unknown as StandardLogOpts<T>
    )("Main transaction redistributed to an Incomer"));
  }

  private async handleBackupIncomerTransactions() {
    const [incomers, backupIncomerTransactions, dispatcherTransactions] = await Promise.all([
      this.incomerStore.getIncomers(),
      this.backupIncomerTransactionStore.getTransactions(),
      this.dispatcherTransactionStore.getTransactions()
    ]);

    const toResolve = [];

    for (const [backupTransactionId, backupIncomerTransaction] of backupIncomerTransactions.entries()) {
      if (backupIncomerTransaction.redisMetadata.mainTransaction) {
        const isoPublisherIncomer = findISOIncomer({
          incomers: [...incomers.values()],
          incomerName: backupIncomerTransaction.redisMetadata.incomerName,
          eventName: backupIncomerTransaction.name,
          key: "eventsCast"
        });

        if (!isoPublisherIncomer) {
          continue;
        }

        const concernedIncomerStore = new TransactionStore({
          prefix: `${isoPublisherIncomer.prefix ? `${isoPublisherIncomer.prefix}-` : ""}${isoPublisherIncomer.providedUUID}`,
          instance: "incomer"
        });

        toResolve.push(
          concernedIncomerStore.setTransaction({
            ...backupIncomerTransaction,
            redisMetadata: {
              ...backupIncomerTransaction.redisMetadata,
              origin: isoPublisherIncomer.providedUUID
            }
          }, backupTransactionId),
          this.backupIncomerTransactionStore.deleteTransaction(backupTransactionId)
        );

        continue;
      }

      if (backupIncomerTransaction.redisMetadata.relatedTransaction) {
        const isoListenerIncomer = findISOIncomer({
          incomers: [...incomers.values()],
          incomerName: backupIncomerTransaction.redisMetadata.incomerName,
          eventName: backupIncomerTransaction.name,
          key: "eventsSubscribe"
        });

        if (!isoListenerIncomer) {
          continue;
        }

        const [relatedDispatcherTransactionId, relatedDispatcherTransaction] = [...dispatcherTransactions.entries()]
          .find(
            ([id]) => id === backupIncomerTransaction.redisMetadata.relatedTransaction
          ) || [];

        if (!relatedDispatcherTransactionId) {
          continue;
        }

        if (!backupIncomerTransaction.redisMetadata.resolved) {
          const { providedUUID, prefix } = isoListenerIncomer;

          const concernedIncomerChannel = this.incomerChannelHandler.get(providedUUID) ??
            this.incomerChannelHandler.set({ uuid: providedUUID, prefix });

          toResolve.push([
            this.eventsHandler.dispatch({
              channel: concernedIncomerChannel,
              store: this.dispatcherTransactionStore,
              redisMetadata: {
                mainTransaction: backupIncomerTransaction.redisMetadata.mainTransaction,
                relatedTransaction: backupIncomerTransaction.redisMetadata.relatedTransaction,
                eventTransactionId: null,
                resolved: backupIncomerTransaction.redisMetadata.resolved
              },
              event: {
                ...backupIncomerTransaction as IncomerHandlerTransaction["incomerDistributedEventTransaction"],
                redisMetadata: {
                  ...backupIncomerTransaction.redisMetadata,
                  origin: this.privateUUID,
                  to: isoListenerIncomer.providedUUID
                }
              } as any
            }),
            this.backupIncomerTransactionStore.deleteTransaction(backupTransactionId),
            this.dispatcherTransactionStore.deleteTransaction(relatedDispatcherTransactionId)
          ]);

          continue;
        }

        const concernedIncomerStore = new TransactionStore({
          prefix: `${isoListenerIncomer.prefix ? `${isoListenerIncomer.prefix}-` : ""}${isoListenerIncomer.providedUUID}`,
          instance: "incomer"
        });

        toResolve.push(
          concernedIncomerStore.setTransaction({
            ...backupIncomerTransaction,
            redisMetadata: {
              ...backupIncomerTransaction.redisMetadata,
              origin: this.privateUUID,
              to: isoListenerIncomer.providedUUID
            }
          }, backupIncomerTransaction.redisMetadata.transactionId),
          this.dispatcherTransactionStore.updateTransaction(relatedDispatcherTransactionId, {
            ...relatedDispatcherTransaction,
            redisMetadata: {
              ...relatedDispatcherTransaction.redisMetadata,
              to: isoListenerIncomer.providedUUID
            }
          } as Transaction<"dispatcher">),
          this.backupIncomerTransactionStore.deleteTransaction(backupTransactionId)
        );
      }
    }

    await Promise.all(toResolve);
  }

  private async resolveSpreadTransactions() {
    const [incomers, backupIncomerTransactions, dispatcherTransactions] = await Promise.all([
      this.incomerStore.getIncomers(),
      this.backupIncomerTransactionStore.getTransactions(),
      this.dispatcherTransactionStore.getTransactions()
    ]);

    const toResolve = [];
    const incomerStateToUpdate = new Set<string>();

    for (const [dispatcherTransactionId, dispatcherTransaction] of dispatcherTransactions.entries()) {
      const relatedIncomer = [...incomers].find((incomer) => incomer.providedUUID === dispatcherTransaction.redisMetadata.to ||
        incomer.baseUUID === dispatcherTransaction.redisMetadata.to);

      const transactionRecipient = relatedIncomer ? relatedIncomer.providedUUID : dispatcherTransaction.redisMetadata.to;

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

      const filteredIncomerTransactions = [...relatedIncomerTransactions.values()]
        .filter((incomerTransaction) => incomerTransaction.redisMetadata.relatedTransaction === dispatcherTransactionId &&
          incomerTransaction.redisMetadata.resolved) ||
          [];

      // Event not resolved yet
      if (filteredIncomerTransactions.length === 0) {
        continue;
      }

      for (const filteredIncomerTransaction of filteredIncomerTransactions) {
        const filteredIncomerTransactionId = filteredIncomerTransaction.redisMetadata.transactionId;

        if (dispatcherTransaction.redisMetadata.mainTransaction) {
          // Only in case of ping event
          incomerStateToUpdate.add(filteredIncomerTransaction.redisMetadata.origin);
          toResolve.push(Promise.all([
            relatedIncomerTransactionStore.deleteTransaction(filteredIncomerTransactionId),
            this.dispatcherTransactionStore.deleteTransaction(dispatcherTransactionId)
          ]));

          continue;
        }

        if (dispatcherTransaction.name === "APPROVEMENT") {
          if (!filteredIncomerTransaction || !filteredIncomerTransaction.redisMetadata.resolved) {
            continue;
          }

          toResolve.push(Promise.all([
            relatedIncomerTransactionStore.deleteTransaction(filteredIncomerTransactionId),
            this.dispatcherTransactionStore.deleteTransaction(dispatcherTransactionId)
          ]));

          continue;
        }

        dispatcherTransaction.redisMetadata.resolved = true;
        incomerStateToUpdate.add((filteredIncomerTransaction.redisMetadata as any).to);
        toResolve.push(Promise.all([
          relatedIncomerTransactionStore.deleteTransaction(filteredIncomerTransactionId),
          this.dispatcherTransactionStore.updateTransaction(
            dispatcherTransactionId,
            dispatcherTransaction
          )
        ]));
      }
    }

    toResolve.push([...incomerStateToUpdate.values()].map(
      (incomerId) => this.incomerStore.updateIncomerState(incomerId))
    );

    await Promise.all(toResolve);
  }

  private async resolveMainTransactions() {
    const [incomers, backupIncomerTransactions, dispatcherTransactions] = await Promise.all([
      this.incomerStore.getIncomers(),
      this.backupIncomerTransactionStore.getTransactions(),
      this.dispatcherTransactionStore.getTransactions()
    ]);

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
      (incomerId) => this.incomerStore.updateIncomerState(incomerId))
    );

    await Promise.all(toResolve);
  }
}
