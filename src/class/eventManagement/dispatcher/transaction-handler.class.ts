/* eslint-disable max-lines */
// Import Third-party Dependencies
import { Logger } from "pino";
import { Channel } from "@myunisoft/redis";

// Import Internal Dependencies
import {
  DispatcherSpreadTransaction,
  IncomerHandlerTransaction,
  IncomerMainTransaction,
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
import { DefaultOptions, SharedOptions } from "../dispatcher.class";
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
  public backupDispatcherTransactionStore: TransactionStore<"dispatcher">;

  private incomerChannelHandler: IncomerChannelHandler<T>;
  private eventsHandler: EventsHandler<T>;
  private logger: Partial<Logger> & Pick<Logger, "info" | "warn" | "error">;
  private standardLogFn: StandardLog<T>;

  constructor(opts: TransactionHandlerOptions<T>) {
    Object.assign(this, opts);

    this.logger = opts.parentLogger.child({ module: "transaction-handler" });
    this.standardLogFn = opts.standardLog ?? defaultStandardLog;
  }

  public async resolveTransactions() {
    const currentBackupDispatcherTransactions = await this.resolveBackupTransactions();

    await this.resolveSpreadTransactions();
    await this.resolveMainTransactions(currentBackupDispatcherTransactions);
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
      .filter(([__, dispatcherTransaction]) => dispatcherTransaction.redisMetadata.to === inactiveIncomer.providedUUID);

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
              inactiveIncomerTransactionStore.deleteTransaction(relatedIncomerPingTransaction.redisMetadata.transactionId),
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
              return inactiveIncomerTransactionStore.deleteTransaction(incomerTransaction.redisMetadata.transactionId);
            }

            return Promise.all([
              inactiveIncomerTransactionStore.deleteTransaction(incomerTransaction.redisMetadata.transactionId),
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
      .map(([incomerTransactionId, mainTransaction]) => {
        const isoPublisherIncomer = findISOIncomer({
          incomers: [...incomers.values()],
          incomerName: inactiveIncomer.name,
          eventName: mainTransaction.name,
          key: "eventsCast"
        });

        if (!isoPublisherIncomer) {
          return this.backupMainTransaction(
            inactiveIncomerTransactionStore,
            incomerTransactionId,
            mainTransaction
          );
        }

        return this.distributeMainTransaction({
          isoPublisherIncomer,
          incomerTransaction: mainTransaction,
          inactiveIncomerTransactionStore,
          incomerTransactionId
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

      // To publish later when concerned Incomer

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

  private async resolveBackupTransactions() {
    await this.resolveBackupIncomerTransactions();

    return await this.resolveBackupDispatcherTransactions();
  }

  private async resolveBackupIncomerTransactions() {
    const [incomers, backupIncomerTransactions, backupDispatcherTransactions] = await Promise.all([
      this.incomerStore.getIncomers(),
      this.backupIncomerTransactionStore.getTransactions(),
      this.backupDispatcherTransactionStore.getTransactions()
    ]);

    const backupTransactionsToHandle = [];

    for (const [backupIncomerTransactionId, backupIncomerTransaction] of backupIncomerTransactions.entries()) {
      const {
        incomerName,
        mainTransaction: backupIncomerMainTransaction,
        relatedTransaction: backupIncomerRelatedTransaction
      } = backupIncomerTransaction.redisMetadata;
      const {
        name: backupIncomerEventName
      } = backupIncomerTransaction;

      if (backupIncomerMainTransaction) {
        const isoPublisherIncomer = findISOIncomer({
          incomers: [...incomers.values()],
          incomerName,
          eventName: backupIncomerEventName,
          key: "eventsCast"
        });

        if (!isoPublisherIncomer) {
          continue;
        }

        const concernedIncomerStore = new TransactionStore({
          prefix: `${isoPublisherIncomer.prefix ? `${isoPublisherIncomer.prefix}-` : ""}${isoPublisherIncomer.providedUUID}`,
          instance: "incomer"
        });

        backupTransactionsToHandle.push(
          concernedIncomerStore.setTransaction({
            ...backupIncomerTransaction,
            redisMetadata: {
              ...backupIncomerTransaction.redisMetadata,
              origin: isoPublisherIncomer.providedUUID
            }
          }),
          this.backupIncomerTransactionStore.deleteTransaction(backupIncomerTransactionId)
        );

        continue;
      }

      if (backupIncomerRelatedTransaction) {
        const isoListenerIncomer = findISOIncomer({
          incomers: [...incomers.values()],
          incomerName,
          eventName: backupIncomerEventName,
          key: "eventsSubscribe"
        });

        if (!isoListenerIncomer) {
          continue;
        }

        const relatedDispatcherTransaction = [...backupDispatcherTransactions.values()]
          .find(
            (backupDispatcherTransaction) => backupDispatcherTransaction.redisMetadata.transactionId ===
              backupIncomerTransaction.redisMetadata.relatedTransaction
          );

        if (!relatedDispatcherTransaction) {
          continue;
        }

        if (!backupIncomerTransaction.redisMetadata.resolved) {
          const { providedUUID, prefix } = isoListenerIncomer;

          const concernedIncomerChannel = this.incomerChannelHandler.get(providedUUID) ??
            this.incomerChannelHandler.set({ uuid: providedUUID, prefix });

          backupTransactionsToHandle.push([
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
            this.backupIncomerTransactionStore.deleteTransaction(backupIncomerTransactionId),
            this.backupDispatcherTransactionStore.deleteTransaction(relatedDispatcherTransaction.redisMetadata.transactionId)
          ]);

          continue;
        }

        const concernedIncomerStore = new TransactionStore({
          prefix: `${isoListenerIncomer.prefix ? `${isoListenerIncomer.prefix}-` : ""}${isoListenerIncomer.providedUUID}`,
          instance: "incomer"
        });

        backupTransactionsToHandle.push(
          async() => {
            const dispatcherTransaction = await this.dispatcherTransactionStore.setTransaction({
              ...relatedDispatcherTransaction,
              redisMetadata: {
                ...relatedDispatcherTransaction.redisMetadata,
                to: isoListenerIncomer.providedUUID
              }
            });

            await concernedIncomerStore.setTransaction({
              ...backupIncomerTransaction as IncomerHandlerTransaction["incomerDistributedEventTransaction"],
              redisMetadata: {
                ...backupIncomerTransaction.redisMetadata as
                  IncomerHandlerTransaction["incomerDistributedEventTransaction"]["redisMetadata"],
                origin: isoListenerIncomer.providedUUID,
                relatedTransaction: dispatcherTransaction.redisMetadata.transactionId
              }
            });
          },
          this.backupIncomerTransactionStore.deleteTransaction(backupIncomerTransactionId)
        );
      }
    }

    await Promise.all(backupTransactionsToHandle);
  }

  private async resolveBackupDispatcherTransactions() {
    const [incomers, backupDispatcherTransactions] = await Promise.all([
      this.incomerStore.getIncomers(),
      this.backupDispatcherTransactionStore.getTransactions()
    ]);

    const backupTransactionsToHandle = [];

    for (const [transactionId, backupDispatcherTransaction] of backupDispatcherTransactions.entries()) {
      const isoSubscriberIncomer = findISOIncomer({
        incomers: [...incomers.values()],
        incomerName: backupDispatcherTransaction.redisMetadata.incomerName,
        eventName: backupDispatcherTransaction.name,
        key: "eventsSubscribe"
      });

      if (!isoSubscriberIncomer) {
        continue;
      }

      const { providedUUID, prefix } = isoSubscriberIncomer;

      const concernedIncomerChannel = this.incomerChannelHandler.get(providedUUID) ??
        this.incomerChannelHandler.set({ uuid: providedUUID, prefix });

      backupTransactionsToHandle.push([
        this.eventsHandler.dispatch({
          channel: concernedIncomerChannel,
          store: this.dispatcherTransactionStore,
          redisMetadata: {
            ...backupDispatcherTransaction.redisMetadata,
            eventTransactionId: backupDispatcherTransaction.redisMetadata.relatedTransaction
          },
          event: {
            ...backupDispatcherTransaction as DispatcherSpreadTransaction["dispatcherDistributedEventTransaction"],
            redisMetadata: {
              ...backupDispatcherTransaction.redisMetadata,
              origin: this.privateUUID,
              to: isoSubscriberIncomer.providedUUID,
              incomerName: isoSubscriberIncomer.name
            }
          } as any
        }),
        this.backupDispatcherTransactionStore.deleteTransaction(transactionId),
        backupDispatcherTransactions.delete(transactionId)
      ]);
    }

    await Promise.all(backupTransactionsToHandle);

    return backupDispatcherTransactions;
  }

  private async resolveSpreadTransactions() {
    const [incomers, dispatcherTransactions] = await Promise.all([
      this.incomerStore.getIncomers(),
      this.dispatcherTransactionStore.getTransactions()
    ]);

    const spreadTransactionsToResolve = [];
    const incomerStateToUpdate = new Set<string>();

    for (const [dispatcherTransactionId, dispatcherTransaction] of dispatcherTransactions.entries()) {
      const transactionRecipient = dispatcherTransaction.redisMetadata.to;

      const relatedIncomer = [...incomers]
        .find((incomer) => incomer.providedUUID === transactionRecipient || incomer.baseUUID === transactionRecipient);

      if (!relatedIncomer) {
        // Cannot log on every iteration since should iterate on short range
        // Warnings system to raise log after multiple iteration aborted
        continue;
      }

      const prefix = relatedIncomer.prefix ?? "";
      const relatedIncomerTransactionStore = new TransactionStore({
        prefix: `${prefix ? `${prefix}-` : ""}${transactionRecipient}`,
        instance: "incomer"
      });

      const relatedIncomerTransactions = await relatedIncomerTransactionStore.getTransactions();

      const relatedIncomerTransactionId = [...relatedIncomerTransactions.keys()].find(((relatedIncomerTransactionId) => {
        const incomerTransaction = relatedIncomerTransactions.get(relatedIncomerTransactionId);
        const { relatedTransaction, resolved } = incomerTransaction.redisMetadata;

        return relatedTransaction === dispatcherTransactionId && resolved;
      }));

      // Event not resolved yet
      if (!relatedIncomerTransactionId) {
        // Cannot log on every iteration since should iterate on short range
        // Warnings system to raise log after multiple iteration aborted
        continue;
      }

      if (dispatcherTransaction.redisMetadata.mainTransaction) {
        // Only in case of ping event
        incomerStateToUpdate.add(dispatcherTransaction.redisMetadata.to);
        spreadTransactionsToResolve.push(Promise.all([
          relatedIncomerTransactionStore.deleteTransaction(relatedIncomerTransactionId),
          this.dispatcherTransactionStore.deleteTransaction(dispatcherTransactionId)
        ]));

        continue;
      }

      if (dispatcherTransaction.name === "APPROVEMENT") {
        const transaction = relatedIncomerTransactions.get(relatedIncomerTransactionId);

        // What if service asked for registration but won't never resolve the approvement
        // TTL on approvement
        if (!transaction || !transaction.redisMetadata.resolved) {
          continue;
        }

        spreadTransactionsToResolve.push(Promise.all([
          relatedIncomerTransactionStore.deleteTransaction(relatedIncomerTransactionId),
          this.dispatcherTransactionStore.deleteTransaction(dispatcherTransactionId)
        ]));

        continue;
      }

      dispatcherTransaction.redisMetadata.resolved = true;
      incomerStateToUpdate.add(dispatcherTransaction.redisMetadata.to);
      spreadTransactionsToResolve.push(Promise.all([
        relatedIncomerTransactionStore.deleteTransaction(relatedIncomerTransactionId),
        this.dispatcherTransactionStore.updateTransaction(
          dispatcherTransactionId,
          dispatcherTransaction
        )
      ]));
    }

    spreadTransactionsToResolve.push([...incomerStateToUpdate.values()].map(
      (incomerId) => this.incomerStore.updateIncomerState(incomerId))
    );

    await Promise.all(spreadTransactionsToResolve);
  }

  private async resolveMainTransactions(currentBackupDispatcherTransactions: Transactions<"dispatcher">) {
    const [incomers, dispatcherTransactions] = await Promise.all([
      this.incomerStore.getIncomers(),
      this.dispatcherTransactionStore.getTransactions()
    ]);

    const mainTransactionsToResolve = [];
    const incomerStateToUpdate = new Set<string>();
    for (const incomer of incomers) {
      const incomerStore = new TransactionStore({
        prefix: `${incomer.prefix ? `${incomer.prefix}-` : ""}${incomer.providedUUID}`,
        instance: "incomer"
      });

      const incomerMainTransactions = await incomerStore.getTransactions();

      for (const [incomerTransactionId, incomerTransaction] of incomerMainTransactions.entries()) {
        if (!incomerTransaction.redisMetadata.mainTransaction) {
          continue;
        }

        const allRelatedDispatcherTransactions: Transaction<"dispatcher">[][] = [
          [...dispatcherTransactions.values()], [...currentBackupDispatcherTransactions.values()]
        ].map(
          (everyDispatcherTransactions) => everyDispatcherTransactions
            .filter((dispatcherTransaction) => dispatcherTransaction.redisMetadata.relatedTransaction ===
              incomerTransactionId
            )
        );

        const [relatedDispatcherTransactions, relatedBackupDispatcherTransactions] = allRelatedDispatcherTransactions;

        // Event not resolved yet by the dispatcher
        // Lack of default config for event dispatch, possible edge case where an event is never distributed & so never resolved
        if (relatedDispatcherTransactions.length === 0 && relatedBackupDispatcherTransactions.length === 0) {
          continue;
        }

        const unResolvedRelatedTransactions = [...relatedDispatcherTransactions.values()].filter(
          (dispatcherTransaction) => !dispatcherTransaction.redisMetadata.resolved
        );

        for (const backupTransaction of relatedBackupDispatcherTransactions.values()) {
          const isoSubscribedIncomer = findISOIncomer({
            incomers: [...incomers.values()],
            incomerName: backupTransaction.redisMetadata.incomerName,
            eventName: backupTransaction.name,
            key: "eventsSubscribe"
          });

          if (!isoSubscribedIncomer) {
            continue;
          }

          const { providedUUID, prefix } = isoSubscribedIncomer;

          const concernedIncomerChannel = this.incomerChannelHandler.get(providedUUID) ??
            this.incomerChannelHandler.set({ uuid: providedUUID, prefix });

          mainTransactionsToResolve.push(Promise.all([
            this.eventsHandler.dispatch({
              channel: concernedIncomerChannel,
              store: this.dispatcherTransactionStore,
              redisMetadata: {
                ...backupTransaction.redisMetadata,
                eventTransactionId: backupTransaction.redisMetadata.relatedTransaction
              },
              event: {
                ...incomerTransaction as IncomerMainTransaction["incomerEventCastTransaction"],
                redisMetadata: {
                  ...backupTransaction.redisMetadata,
                  origin: backupTransaction.redisMetadata.origin,
                  to: providedUUID
                }
              } as any
            }),
            this.backupDispatcherTransactionStore.deleteTransaction(backupTransaction.redisMetadata.transactionId)
          ]));
        }

        // Event not resolved yet by the different incomers
        if (unResolvedRelatedTransactions.length > 0 || relatedBackupDispatcherTransactions.length > 0) {
          continue;
        }

        for (const relatedDispatcherTransaction of relatedDispatcherTransactions.values()) {
          incomerStateToUpdate.add(relatedDispatcherTransaction.redisMetadata.to);

          mainTransactionsToResolve.push(
            this.dispatcherTransactionStore.deleteTransaction(relatedDispatcherTransaction.redisMetadata.transactionId)
          );
        }

        // Create state transaction like Main transaction + incomer prefix/name/uuid + date of resolution
        // transaction with ttl or callback for custom implem/dealing with the transaction state
        // use case => calling job/webhook on event resolution
        mainTransactionsToResolve.push(incomerStore.deleteTransaction(incomerTransactionId));
      }
    }

    mainTransactionsToResolve.push([...incomerStateToUpdate.values()].map(
      (incomerId) => this.incomerStore.updateIncomerState(incomerId))
    );

    await Promise.all(mainTransactionsToResolve);
  }
}
