/* eslint-disable max-lines */

// Import Third-party Dependencies
import { Logger } from "pino";
import { Channel } from "@myunisoft/redis";

// Import Internal Dependencies
import {
  DispatcherSpreadTransaction,
  IncomerHandlerTransaction,
  IncomerMainTransaction,
  PartialTransaction,
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

interface FindISOIncomerOptions {
  incomers: RegisteredIncomer[]
  incomerName: string;
  eventName: string;
  key: "eventsCast" | "eventsSubscribe";
}

function findISOIncomer(options: FindISOIncomerOptions):
  RegisteredIncomer | null {
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

    await this.backupInactiveIncomerMainTransactions(inactiveIncomer, inactiveIncomerTransactionStore);
    await this.backupInactiveIncomerHandlerTransactions(inactiveIncomer, inactiveIncomerTransactionStore);
    await this.backupInactiveIncomerRelatedSpreadDispatcherTransactions(inactiveIncomer);
  }

  private async backupInactiveIncomerMainTransactions(
    inactiveIncomer: RegisteredIncomer,
    inactiveIncomerTransactionStore: TransactionStore<"incomer">
  ) {
    const [incomers, incomerTransactions, dispatcherTransactions] = await Promise.all([
      this.incomerStore.getIncomers(),
      inactiveIncomerTransactionStore.getTransactions(),
      this.dispatcherTransactionStore.getTransactions()
    ]);

    delete incomers[inactiveIncomer.providedUUID];

    for (const [incomerTransactionId, incomerTransaction] of incomerTransactions.entries()) {
      if (!incomerTransaction.redisMetadata.mainTransaction) {
        continue;
      }

      if (incomerTransaction.name === "REGISTER") {
        const approvementRelatedTransaction = Object.keys(dispatcherTransactions)
          .find(
            (dispatcherTransactionId) => dispatcherTransactions[dispatcherTransactionId].redisMetadata.relatedTransaction ===
            incomerTransactionId
          );

        await Promise.all([
          typeof approvementRelatedTransaction === "undefined" ? () => void 0 :
            this.dispatcherTransactionStore.deleteTransaction(approvementRelatedTransaction),
          inactiveIncomerTransactionStore.deleteTransaction(incomerTransactionId)
        ]);

        continue;
      }

      const isoPublisherIncomer = findISOIncomer({
        incomers: [...incomers.values()],
        incomerName: inactiveIncomer.name,
        eventName: incomerTransaction.name,
        key: "eventsCast"
      });

      if (!isoPublisherIncomer) {
        const [, newlyTransaction] = await Promise.all([
          inactiveIncomerTransactionStore.deleteTransaction(incomerTransactionId),
          this.backupIncomerTransactionStore.setTransaction({
            ...incomerTransaction
          })
        ]);

        this.logger.info(this.standardLogFn({
          ...newlyTransaction,
          redisMetadata: {
            ...newlyTransaction.redisMetadata,
            origin: this.privateUUID
          }
        } as unknown as StandardLogOpts<T>)("Main transaction has been backup"));

        continue;
      }

      const { prefix, providedUUID } = isoPublisherIncomer;

      const relatedIncomerStore = new TransactionStore({
        prefix: `${prefix ? `${prefix}-` : ""}${providedUUID}`,
        instance: "incomer"
      });

      const [newlyIncomerTransaction] = await Promise.all([
        relatedIncomerStore.setTransaction({
          ...incomerTransaction,
          redisMetadata: {
            ...incomerTransaction.redisMetadata,
            origin: providedUUID
          }
        }),
        inactiveIncomerTransactionStore.deleteTransaction(incomerTransactionId)
      ]);

      // UPDATE RELATED DISPATCHER TRANSACTIONS
      const relatedDispatcherTransactions = [...dispatcherTransactions.values()]
        .filter(
          (dispatcherTransaction) => dispatcherTransaction.redisMetadata.relatedTransaction ===
          incomerTransaction.redisMetadata.transactionId
        );

      await Promise.all(relatedDispatcherTransactions.map(
        (dispatcherTransaction) => this.dispatcherTransactionStore.updateTransaction(
          dispatcherTransaction.redisMetadata.transactionId,
          {
            ...dispatcherTransaction,
            redisMetadata: {
              ...dispatcherTransaction.redisMetadata,
              mainTransaction: false,
              relatedTransaction: newlyIncomerTransaction.redisMetadata.transactionId
            }
          }
        )
      ));

      this.logger.info(this.standardLogFn({
        ...newlyIncomerTransaction,
        redisMetadata: {
          ...newlyIncomerTransaction.redisMetadata,
          origin: this.privateUUID
        }
      } as unknown as StandardLogOpts<T>)("Main transaction redistributed to an Incomer"));
    }
  }

  private async backupInactiveIncomerHandlerTransactions(
    inactiveIncomer: RegisteredIncomer,
    inactiveIncomerTransactionStore: TransactionStore<"incomer">
  ) {
    const [incomers, incomerTransactions, dispatcherTransactions] = await Promise.all([
      this.incomerStore.getIncomers(),
      inactiveIncomerTransactionStore.getTransactions(),
      this.dispatcherTransactionStore.getTransactions()
    ]);

    delete incomers[inactiveIncomer.providedUUID];

    for (const [incomerTransactionId, incomerTransaction] of incomerTransactions.entries()) {
      if (incomerTransaction.redisMetadata.mainTransaction) {
        continue;
      }

      const handlerTransaction = incomerTransaction as IncomerHandlerTransaction["incomerDistributedEventTransaction"];

      if (handlerTransaction.name === "PING") {
        await Promise.all([
          inactiveIncomerTransactionStore.deleteTransaction(incomerTransactionId),
          this.dispatcherTransactionStore.deleteTransaction(handlerTransaction.redisMetadata.relatedTransaction)
        ]);

        continue;
      }

      const isoSubscriberIncomer = findISOIncomer({
        incomers: [...incomers],
        incomerName: handlerTransaction.redisMetadata.incomerName,
        eventName: handlerTransaction.name,
        key: "eventsSubscribe"
      });

      let relatedSpreadTransaction = dispatcherTransactions
        .get(handlerTransaction.redisMetadata.relatedTransaction);

      if (!isoSubscriberIncomer) {
        if (!relatedSpreadTransaction) {
          relatedSpreadTransaction = await this.backupDispatcherTransactionStore.setTransaction({
            ...handlerTransaction,
            redisMetadata: {
              ...handlerTransaction.redisMetadata,
              relatedTransaction: handlerTransaction.redisMetadata.eventTransactionId
            }
          } as Transaction<"dispatcher">);
        }

        const [, newlyTransaction] = await Promise.all([
          inactiveIncomerTransactionStore.deleteTransaction(incomerTransactionId),
          this.backupIncomerTransactionStore.setTransaction({
            ...handlerTransaction,
            redisMetadata: {
              ...handlerTransaction.redisMetadata,
              relatedTransaction: relatedSpreadTransaction.redisMetadata.transactionId
            }
          })
        ]);

        this.logger.info(this.standardLogFn({
          ...newlyTransaction,
          redisMetadata: {
            ...newlyTransaction.redisMetadata,
            origin: this.privateUUID
          }
        } as unknown as StandardLogOpts<T>)("Handler Transaction has been backup"));

        continue;
      }

      const { providedUUID, prefix } = isoSubscriberIncomer;

      if (!incomerTransaction.redisMetadata.resolved) {
        const isoSubscriberChannel = this.incomerChannelHandler.get(providedUUID) ??
          this.incomerChannelHandler.set({ uuid: providedUUID, prefix });

        await Promise.all([
          this.eventsHandler.dispatch({
            channel: isoSubscriberChannel,
            store: this.dispatcherTransactionStore,
            redisMetadata: {
              ...handlerTransaction.redisMetadata
            },
            event: {
              ...handlerTransaction,
              redisMetadata: {
                ...handlerTransaction.redisMetadata,
                origin: handlerTransaction.redisMetadata.origin,
                to: providedUUID
              }
            } as any
          }),
          inactiveIncomerTransactionStore.deleteTransaction(incomerTransactionId),
          this.dispatcherTransactionStore.deleteTransaction(relatedSpreadTransaction.redisMetadata.transactionId)
        ]);

        this.logger.info(this.standardLogFn({
          ...incomerTransaction,
          redisMetadata: {
            ...incomerTransaction.redisMetadata,
            origin: this.privateUUID
          }
        } as unknown as StandardLogOpts<T>)("Handler Transaction published again to an Incomer"));

        continue;
      }

      await Promise.all([
        this.backupResolvedHandlerTransaction(handlerTransaction, inactiveIncomerTransactionStore, providedUUID),
        inactiveIncomerTransactionStore.deleteTransaction(incomerTransactionId),
        this.dispatcherTransactionStore.deleteTransaction(relatedSpreadTransaction.redisMetadata.transactionId)
      ]);

      this.logger.info(this.standardLogFn({
        ...incomerTransaction,
        redisMetadata: {
          ...incomerTransaction.redisMetadata,
          origin: this.privateUUID
        }
      } as unknown as StandardLogOpts<T>)("Handler Transaction redistributed to an Incomer"));
    }
  }

  private async backupResolvedHandlerTransaction(
    handlerTransaction: IncomerHandlerTransaction["incomerDistributedEventTransaction"],
    incomerTransactionStore: TransactionStore<"incomer">,
    providedUUID: string
  ) {
    const dispatcherTransaction = await this.dispatcherTransactionStore.setTransaction({
      ...handlerTransaction,
      redisMetadata: {
        ...handlerTransaction.redisMetadata,
        relatedTransaction: handlerTransaction.redisMetadata.eventTransactionId,
        to: providedUUID
      }
    } as PartialTransaction<"dispatcher">);

    await incomerTransactionStore.setTransaction({
      ...handlerTransaction,
      redisMetadata: {
        ...handlerTransaction.redisMetadata,
        relatedTransaction: dispatcherTransaction.redisMetadata.transactionId
      }
    });
  }

  private async backupInactiveIncomerRelatedSpreadDispatcherTransactions(
    inactiveIncomer: RegisteredIncomer
  ) {
    const [incomers, dispatcherTransactions] = await Promise.all([
      this.incomerStore.getIncomers(),
      this.dispatcherTransactionStore.getTransactions()
    ]);

    delete incomers[inactiveIncomer.providedUUID];

    for (const [dispatcherTransactionId, dispatcherTransaction] of dispatcherTransactions.entries()) {
      if (dispatcherTransaction.redisMetadata.to !== inactiveIncomer.providedUUID) {
        continue;
      }

      if (dispatcherTransaction.name === "PING" || dispatcherTransaction.name === "APPROVEMENT") {
        await this.dispatcherTransactionStore.deleteTransaction(dispatcherTransactionId);

        continue;
      }

      if (dispatcherTransaction.redisMetadata.relatedTransaction) {
        const isoSubscribedIncomer = findISOIncomer({
          incomers: [...incomers],
          incomerName: dispatcherTransaction.redisMetadata.incomerName,
          eventName: dispatcherTransaction.name,
          key: "eventsSubscribe"
        });

        if (!isoSubscribedIncomer) {
          await Promise.all([
            this.dispatcherTransactionStore.deleteTransaction(dispatcherTransactionId),
            this.backupDispatcherTransactionStore.setTransaction({ ...dispatcherTransaction })
          ]);

          this.logger.info(this.standardLogFn({
            ...dispatcherTransaction,
            redisMetadata: {
              ...dispatcherTransaction.redisMetadata,
              origin: this.privateUUID
            }
          } as unknown as StandardLogOpts<T>)("Unresolved injected event has been backup"));

          continue;
        }

        const incomerRelatedTransactionStore = new TransactionStore({
          prefix: `${isoSubscribedIncomer.prefix ? `${isoSubscribedIncomer.prefix}-` : ""}${isoSubscribedIncomer.providedUUID}`,
          instance: "incomer"
        });

        const relatedTransaction = [...(await incomerRelatedTransactionStore.getTransactions()).values()]
          .find((incomerTransaction) => incomerTransaction.redisMetadata.relatedTransaction ===
            dispatcherTransaction.redisMetadata.transactionId
          );

        if (relatedTransaction) {
          continue;
        }

        const { providedUUID, prefix } = isoSubscribedIncomer;

        const isoSubscriberChannel = this.incomerChannelHandler.get(providedUUID) ??
          this.incomerChannelHandler.set({ uuid: providedUUID, prefix });

        await Promise.all([
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
                origin: this.privateUUID,
                to: isoSubscribedIncomer.providedUUID
              }
            } as DispatchedEvent<T>
          }),
          this.dispatcherTransactionStore.deleteTransaction(dispatcherTransactionId)
        ]);

        this.logger.info(this.standardLogFn({
          ...dispatcherTransaction,
          redisMetadata: {
            ...dispatcherTransaction.redisMetadata,
            origin: this.privateUUID,
            to: isoSubscribedIncomer.providedUUID
          }
        } as unknown as StandardLogOpts<T>)("Redistributed unresolved injected event to an Incomer"));
      }
    }
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
