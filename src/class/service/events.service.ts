// Import Third-party Dependencies
import { RedisAdapter, type Types } from "@myunisoft/redis";

// Import Internal Dependencies
import { IncomerStore } from "../store/incomer.class.js";
import { Transaction, TransactionStore } from "../store/transaction.class.js";
import type { Events } from "../../types/index.js";

export interface EventsServiceOptions {
  redis: Types.DatabaseConnection<RedisAdapter>;
  incomerStore: IncomerStore;
  dispatcherTransactionStore: TransactionStore<"dispatcher">;
  backupDispatcherTransactionStore: TransactionStore<"dispatcher">;
  backupIncomerTransactionStore: TransactionStore<"incomer">;
}

interface SharedOptions {
  incomerId: string;
}

export type GetEventById = SharedOptions & {
  eventId: string;
};

export type GetSentEventByIdResponse = Omit<Transaction<"incomer">, "redisMetadata"> & {
  redisMetadata: {
    published: boolean;
    resolved: boolean;
  },
  relatedTransactions: Transaction<"dispatcher">[];
};

export type GetIncomerSendEventsResponse = GetSentEventByIdResponse[];

export type GetEventsByName = SharedOptions & {
  name: keyof Events;
};

export class EventsService {
  #redis: Types.DatabaseConnection<RedisAdapter>;
  private incomerStore: IncomerStore;
  private dispatcherTransactionStore: TransactionStore<"dispatcher">;
  private backupDispatcherTransactionStore: TransactionStore<"dispatcher">;
  private backupIncomerTransactionStore: TransactionStore<"incomer">;

  constructor(opts: EventsServiceOptions) {
    Object.assign(this, opts);

    this.#redis = opts.redis;
  }

  async getIncomers() {
    return await this.incomerStore.getIncomers();
  }

  async getEventById(opts: GetEventById): Promise<GetSentEventByIdResponse> {
    const { incomerId, eventId } = opts;

    const incomerTransactionStore = new TransactionStore({
      adapter: this.#redis,
      prefix: incomerId,
      instance: "incomer"
    });

    const mainTransaction = await incomerTransactionStore.getTransactionById(eventId) ??
      await this.backupIncomerTransactionStore.getTransactionById(eventId);

    if (mainTransaction === null) {
      return null;
    }

    const spreadTransactions: Transaction<"dispatcher">[] = [];

    for (const spreadTransactionId of mainTransaction.redisMetadata.relatedTransaction) {
      const spreadTransaction = await this.dispatcherTransactionStore.getTransactionById(spreadTransactionId);

      spreadTransactions.push(spreadTransaction);
    }

    return {
      ...mainTransaction,
      redisMetadata: {
        published: mainTransaction.redisMetadata.published,
        resolved: mainTransaction.redisMetadata.resolved
      },
      relatedTransactions: spreadTransactions
    };
  }

  async getIncomerReceivedEvents(opts: SharedOptions) {
    const { incomerId } = opts;

    const dispatcherTransactions = await this.dispatcherTransactionStore.getTransactions();
    const backupDispatcherTransactions = await this.backupDispatcherTransactionStore.getTransactions();

    const mappedBackupDispatcherTransactions = [...backupDispatcherTransactions.values()].map((backupDispatcherTransaction) => {
      return {
        ...backupDispatcherTransaction,
        isBackupTransaction: true
      };
    });

    const receivedEvents = [];
    for (const dispatcherTransaction of [...dispatcherTransactions.values(), ...mappedBackupDispatcherTransactions]) {
      if (dispatcherTransaction.redisMetadata.to === incomerId) {
        receivedEvents.push({
          ...dispatcherTransaction,
          redisMetadata: {
            eventTransactionId: dispatcherTransaction.redisMetadata.eventTransactionId,
            resolved: dispatcherTransaction.redisMetadata.resolved
          }
        });
      }
    }

    return receivedEvents;
  }
}
