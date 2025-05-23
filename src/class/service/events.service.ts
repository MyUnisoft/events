// Import Nodejs Dependencies
import { EventEmitter } from "node:stream";

// Import Third-party Dependencies
import { RedisAdapter } from "@myunisoft/redis";

// Import Internal Dependencies
import { IncomerStore } from "../store/incomer.class.js";
import { Transaction, TransactionStore } from "../store/transaction.class.js";
import type { RegisteredIncomer } from "../../types/index.js";

// CONSTANTS
export const TAKE_LEAD_BACK_SYM = Symbol("TAKE_LEAD_BACK");

export interface EventsServiceOptions {
  redis: RedisAdapter;
  incomerStore: IncomerStore;
  dispatcherTransactionStore: TransactionStore<"dispatcher">;
  backupDispatcherTransactionStore: TransactionStore<"dispatcher">;
  backupIncomerTransactionStore: TransactionStore<"incomer">;
  idleTime: number;
}

interface GetEventSharedOptions {
  incomerId: string;
}

export type GetEventByIdOptions = GetEventSharedOptions & {
  eventId: string;
};

export type GetSentEventByIdResponse = Omit<Transaction<"incomer">, "redisMetadata"> & {
  redisMetadata: {
    published: boolean;
    resolved: boolean;
  },
  relatedTransactions: Transaction<"dispatcher">[];
};

export type GetIncomerReceivedEventsOptions = GetEventSharedOptions;

export type GetIncomerReceivedEventsResponse = Omit<Transaction<"incomer">, "redisMetadata"> & {
  redisMetadata: {
    eventTransactionId: string;
    resolved: boolean;
  };
};

export class EventsService extends EventEmitter {
  public idleTime: number;

  #redis: RedisAdapter;
  private incomerStore: IncomerStore;
  private dispatcherTransactionStore: TransactionStore<"dispatcher">;
  private backupDispatcherTransactionStore: TransactionStore<"dispatcher">;
  private backupIncomerTransactionStore: TransactionStore<"incomer">;

  constructor(opts: EventsServiceOptions) {
    super();

    Object.assign(this, opts);

    this.#redis = opts.redis;
  }

  async getIncomers(): Promise<Set<RegisteredIncomer>> {
    const now = Date.now();

    const incomers = await this.incomerStore.getIncomers();

    return new Set([...incomers.values()].map((incomer) => {
      return {
        ...incomer,
        isAlive: incomer.lastActivity + Number(this.idleTime) >= now
      };
    }));
  }

  forceDispatcherTakeLead(incomers: Set<RegisteredIncomer>, dispatcherToRemove: RegisteredIncomer) {
    this.emit(TAKE_LEAD_BACK_SYM, incomers, dispatcherToRemove);
  }

  async getEventById(opts: GetEventByIdOptions): Promise<GetSentEventByIdResponse> {
    const { incomerId, eventId } = opts;

    const incomerTransactionStore = new TransactionStore({
      adapter: this.#redis as RedisAdapter<Transaction<"incomer">>,
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

  async getIncomerReceivedEvents(opts: GetIncomerReceivedEventsOptions): Promise<GetIncomerReceivedEventsResponse[]> {
    const { incomerId } = opts;

    const dispatcherTransactions = await this.dispatcherTransactionStore.getTransactions();
    const backupDispatcherTransactions = await this.backupDispatcherTransactionStore.getTransactions();

    const mappedBackupDispatcherTransactions = [...backupDispatcherTransactions.values()].map((backupDispatcherTransaction) => {
      return {
        ...backupDispatcherTransaction,
        isBackupTransaction: true
      };
    });

    const receivedEvents: GetIncomerReceivedEventsResponse[] = [];
    for (const dispatcherTransaction of [...dispatcherTransactions.values(), ...mappedBackupDispatcherTransactions]) {
      if (dispatcherTransaction.redisMetadata.to === incomerId && dispatcherTransaction.name !== "PING") {
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
