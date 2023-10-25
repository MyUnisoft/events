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
  DispatcherPingMessage
} from "../../types/eventManagement/index";

export type Instance = "dispatcher" | "incomer";

type MetadataWithoutTransactionId<T extends Instance = Instance> = T extends "dispatcher" ?
  Omit<DispatcherTransactionMetadata, "to" | "transactionId"> & { to?: string } & (MainTransaction | SpreadTransaction) :
  Omit<IncomerTransactionMetadata, "transactionId"> & (MainTransaction | HandlerTransaction);

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
  mainTransaction: false;
  relatedTransaction: string;
  resolved: boolean;
};

type DispatcherTransaction = (
  DispatcherChannelMessages["DispatcherMessages"] & {
    redisMetadata: DispatcherChannelMessages["DispatcherMessages"]["redisMetadata"] & (SpreadTransaction | MainTransaction)
  } | IncomerChannelMessages["DispatcherMessages"] & {
    redisMetadata: IncomerChannelMessages["DispatcherMessages"]["redisMetadata"] & (SpreadTransaction | MainTransaction)
  }
) | (
  IncomerChannelMessages["IncomerMessages"] & {
    redisMetadata: IncomerChannelMessages["DispatcherMessages"]["redisMetadata"] & (SpreadTransaction | MainTransaction);
  }
);

type IncomerTransaction = DispatcherChannelMessages["IncomerMessages"] & {
  redisMetadata: DispatcherChannelMessages["IncomerMessages"]["redisMetadata"] & (HandlerTransaction | MainTransaction)
} | IncomerChannelMessages["IncomerMessages"] & {
  redisMetadata: IncomerChannelMessages["IncomerMessages"]["redisMetadata"] & (HandlerTransaction | MainTransaction)
} | DispatcherPingMessage & {
  redisMetadata: DispatcherPingMessage["redisMetadata"] & (HandlerTransaction | MainTransaction)
};

export type Transaction<
  T extends Instance = Instance
> = (
  T extends "dispatcher" ? DispatcherTransaction : IncomerTransaction
) & {
  aliveSince: number;
};

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
    const count = 1000;
    let cursor = 0;
    let lastResult = count;

    do {
      const [lastCursor, elements] = await this.redis.scan(cursor, "MATCH", `${this.key}-*`, "COUNT", count);

      cursor = Number(lastCursor);
      lastResult = elements.length;

      yield elements;

      continue;
    }
    while (lastResult !== 0 && cursor !== 0);

    const [, elements] = await this.redis.scan(cursor, "MATCH", `${this.key}-*`, "COUNT", count);

    return elements;
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

  async setTransaction(transaction: PartialTransaction<T>): Promise<Transaction<T>> {
    const transactionId = randomUUID();

    const transactionKey = `${this.key}-${transactionId}`;

    const formattedTransaction = {
      ...transaction,
      redisMetadata: {
        ...transaction.redisMetadata,
        transactionId
      },
      aliveSince: Date.now()
    } as unknown as Transaction<T>;

    this.setValue({ key: transactionKey, value: formattedTransaction });

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
}
