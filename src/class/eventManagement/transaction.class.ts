// Import Node.js Dependencies
import { randomUUID } from "crypto";

// Import Third-party Dependencies
import {
  KVOptions,
  KVPeer,
  Redis
} from "@myunisoft/redis";

// Import Internal Dependencies
import {
  DispatcherTransactionMetadata,
  IncomerTransactionMetadata,
  DispatcherChannelMessages,
  IncomerChannelMessages
} from "../../types/eventManagement/index";

export type Instance = "dispatcher" | "incomer";

type MetadataWithoutTransactionId<T extends Instance = Instance> = T extends "dispatcher" ?
  Omit<DispatcherTransactionMetadata, "to" | "transactionId"> & { to?: string } :
  Omit<IncomerTransactionMetadata, "transactionId">;

type MainTransaction = {
  mainTransaction: true;
  relatedTransaction: null;
  resolved: false;
}

type SpreedTransaction = {
  mainTransaction: false;
  relatedTransaction: string;
  resolved: boolean;
}

type HandlerTransaction = {
  mainTransaction: false;
  relatedTransaction: string;
  resolved: false;
}

export type Transaction<T extends Instance = Instance> = (
  T extends "dispatcher" ? (
    (
      (
        DispatcherChannelMessages["DispatcherMessages"] | IncomerChannelMessages["DispatcherMessages"]
      ) | (
        Omit<IncomerChannelMessages["IncomerMessages"], "redisMetadata"> &
        Pick<IncomerChannelMessages["DispatcherMessages"], "redisMetadata">
      )
    ) & (
      SpreedTransaction | MainTransaction
    )
  ) : (
    (
      DispatcherChannelMessages["IncomerMessages"] | IncomerChannelMessages["IncomerMessages"]
    ) & (
      HandlerTransaction | MainTransaction
    )
  )
) & {
  aliveSince: number;
}

export type PartialTransaction<T extends Instance = Instance> = Omit<Transaction<T>, "redisMetadata" | "aliveSince"> & {
  redisMetadata: MetadataWithoutTransactionId<T>
};

export type Transactions<T extends Instance = Instance> = Map<string, Transaction<T>>;

export type TransactionStoreOptions<T extends Instance = Instance> = (Partial<KVOptions<Transactions<T>>> &
  T extends "incomer" ? { prefix: string; } : { prefix?: string; }) & {
    instance: T;
};

export class TransactionStore<T extends Instance = Instance> extends KVPeer<Transaction<T>> {
  private key: string;

  constructor(options: TransactionStoreOptions<T>, redis?: Redis) {
    super({ ...options, prefix: undefined, type: "object" }, redis);

    this.key = `${options.prefix ? `${options.prefix}-` : ""}${options.instance}-transaction`;
  }

  async getTransactions(): Promise<Transactions<T>> {
    const transactionsKeys = await this.redis.keys(`${this.key}-*`);

    const mappedTransactions: Transactions<T> = new Map();

    const transactions = await Promise.all(transactionsKeys.map(
      (transactionKey) => super.getValue(transactionKey)
    ));

    for (const transaction of transactions) {
      if (transaction !== null) {
        mappedTransactions.set(transaction.redisMetadata.transactionId, transaction);
      }
    }

    return mappedTransactions;
  }

  async setTransaction(transaction: PartialTransaction<T>): Promise<string> {
    const transactionId = randomUUID();

    const transactionKey = `${this.key}-${transactionId}`;

    const formattedTransaction = {
      ...transaction,
      redisMetadata: {
        ...transaction.redisMetadata,
        transactionId
      },
      aliveSince: Date.now()
    } as Transaction<T>;

    super.setValue({ key: transactionKey, value: formattedTransaction });

    return transactionId;
  }

  async updateTransaction(transactionId: string, transaction: Transaction<T>): Promise<void> {
    const key = `${this.key}-${transactionId}`;

    super.setValue({ key, value: transaction });
  }

  async getTransactionById(transactionId: string): Promise<Transaction | null> {
    return await super.getValue(`${this.key}-${transactionId}`);
  }

  async deleteTransaction(transactionId: string) {
    await super.deleteValue(`${this.key}-${transactionId}`);
  }
}
