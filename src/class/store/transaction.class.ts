// Import Node.js Dependencies
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import {
  KVOptions,
  KVPeer
} from "@myunisoft/redis";

// Import Internal Dependencies
import {
  DispatcherTransactionMetadata,
  IncomerTransactionMetadata,
  DispatcherChannelMessages,
  IncomerChannelMessages,
  DispatcherPingMessage,
  DistributedEventMessage
} from "../../types/eventManagement/index";

export type Instance = "dispatcher" | "incomer";

type MainTransaction = {
  published?: boolean;
  mainTransaction: true;
  relatedTransaction: null;
  resolved: boolean;
};

type SpreadTransaction = {
  published?: boolean;
  mainTransaction: false;
  relatedTransaction: string;
  resolved: boolean;
};

type HandlerTransaction = {
  published?: boolean;
  eventTransactionId?: string;
  mainTransaction: false;
  relatedTransaction: string;
  resolved: boolean;
};

export type DispatcherMainTransaction = DispatcherPingMessage & {
  redisMetadata: MainTransaction & IncomerChannelMessages["DispatcherMessages"]["redisMetadata"];
}

type DispatcherApprovementTransaction = DispatcherChannelMessages["DispatcherMessages"] & {
  redisMetadata: SpreadTransaction & DispatcherChannelMessages["DispatcherMessages"]["redisMetadata"];
};

type DispatcherDistributedEventTransaction = DistributedEventMessage & {
  redisMetadata: SpreadTransaction & IncomerChannelMessages["DispatcherMessages"]["redisMetadata"];
}

export interface DispatcherSpreadTransaction {
  dispatcherApprovementTransaction: DispatcherApprovementTransaction;
  dispatcherDistributedEventTransaction: DispatcherDistributedEventTransaction;
}

type DispatcherTransaction = (
  DispatcherSpreadTransaction["dispatcherApprovementTransaction"] |
  DispatcherSpreadTransaction["dispatcherDistributedEventTransaction"]
) | DispatcherMainTransaction;

type IncomerApprovementTransaction = DispatcherChannelMessages["IncomerMessages"] & {
  redisMetadata: MainTransaction & DispatcherChannelMessages["IncomerMessages"]["redisMetadata"];
};

type IncomerEventCastTransaction = IncomerChannelMessages["IncomerMessages"] & {
  redisMetadata: MainTransaction & IncomerChannelMessages["IncomerMessages"]["redisMetadata"];
}

export interface IncomerMainTransaction {
  incomerApprovementTransaction: IncomerApprovementTransaction;
  incomerEventCastTransaction: IncomerEventCastTransaction;
}

type IncomerDistributedEventTransaction = IncomerChannelMessages["IncomerMessages"] & {
  redisMetadata: HandlerTransaction & IncomerChannelMessages["IncomerMessages"]["redisMetadata"];
}

type IncomerPongTransaction = DispatcherPingMessage & {
  redisMetadata: HandlerTransaction & DispatcherPingMessage["redisMetadata"];
}

export interface IncomerHandlerTransaction {
  incomerDistributedEventTransaction: IncomerDistributedEventTransaction;
  incomerPongTransaction: IncomerPongTransaction;
}

type IncomerTransaction = (
  IncomerMainTransaction["incomerApprovementTransaction"] |
  IncomerMainTransaction["incomerEventCastTransaction"]
) | (
  IncomerHandlerTransaction["incomerDistributedEventTransaction"] |
  IncomerHandlerTransaction["incomerPongTransaction"]
);

export type Transaction<
  T extends Instance = Instance
> = (
  T extends "dispatcher" ? DispatcherTransaction : IncomerTransaction
) & {
  aliveSince: number;
};

type MetadataWithoutTransactionId<T extends Instance = Instance> = T extends "dispatcher" ?
  Omit<DispatcherTransactionMetadata, "to" | "transactionId"> & { to?: string } & (MainTransaction | SpreadTransaction) :
  Omit<IncomerTransactionMetadata, "transactionId"> & (MainTransaction | HandlerTransaction);

export type PartialTransaction<
  T extends Instance = Instance
> = Omit<Transaction<T>, "redisMetadata" | "aliveSince"> & {
  redisMetadata: MetadataWithoutTransactionId<T>
};

export type Transactions<
  T extends Instance = Instance,
> = Map<string, Transaction<T>>;

export type TransactionStoreOptions<
  T extends Instance = Instance
> = (Partial<KVOptions<Transactions<T>>> &
  T extends "incomer" ? { prefix: string; } : { prefix?: string; }) & {
    instance: T;
};

export class TransactionStore<
  T extends Instance = Instance
>
  extends KVPeer<Transaction<T>> {
  private key: string;

  constructor(options: TransactionStoreOptions<T>) {
    super({ ...options, prefix: undefined, type: "object" });

    this.key = `${options.prefix ? `${options.prefix}-` : ""}${options.instance}-transaction`;
  }

  async* transactionLazyFetch() {
    const count = 5000;
    let cursor = 0;

    do {
      const [lastCursor, elements] = await this.redis.scan(cursor, "MATCH", `${this.key}-*`, "COUNT", count);

      cursor = Number(lastCursor);
      yield elements;

      continue;
    }
    while (cursor !== 0);
  }

  async getTransactions(): Promise<Transactions<T>> {
    const mappedTransactions: Transactions<T> = new Map();

    for await (const transactionKeys of this.transactionLazyFetch()) {
      const transactions = await Promise.all(transactionKeys.map(
        (transactionKey) => this.getValue(transactionKey)
      ));

      for (const transaction of transactions) {
        if (transaction !== null && (transaction.redisMetadata && "transactionId" in transaction.redisMetadata)) {
          mappedTransactions.set(transaction.redisMetadata.transactionId, transaction);
        }
      }
    }

    return mappedTransactions;
  }

  async setTransaction(transaction: PartialTransaction<T>, transactionId: string = randomUUID()): Promise<Transaction<T>> {
    const transactionKey = `${this.key}-${transactionId}`;

    const formattedTransaction = {
      ...transaction,
      redisMetadata: {
        ...transaction.redisMetadata,
        eventTransactionId: transaction.redisMetadata.eventTransactionId ?? transactionId,
        transactionId
      },
      aliveSince: Date.now()
    } as unknown as Transaction<T>;

    await this.setValue({ key: transactionKey, value: formattedTransaction });

    return formattedTransaction;
  }

  async updateTransaction(transactionId: string, transaction: Transaction<T>): Promise<void> {
    const key = `${this.key}-${transactionId}`;

    this.setValue({ key, value: { ...transaction, aliveSince: Date.now() } });
  }

  async getTransactionById(transactionId: string): Promise<Transaction<T> | null> {
    return await this.getValue(`${this.key}-${transactionId}`);
  }

  async deleteTransaction(transactionId: string): Promise<void> {
    await this.deleteValue(`${this.key}-${transactionId}`);
  }

  async deleteTransactions(transactionIds: string[]): Promise<void> {
    await this.redis.del(transactionIds);
  }
}
