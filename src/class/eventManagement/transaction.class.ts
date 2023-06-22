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
  resolved: boolean;
}

type DispatcherTransaction = (SpreedTransaction | MainTransaction) & (
  (
    DispatcherChannelMessages["DispatcherMessages"] | IncomerChannelMessages["DispatcherMessages"]
  ) | (
    Omit<IncomerChannelMessages["IncomerMessages"], "redisMetadata"> &
    Pick<IncomerChannelMessages["DispatcherMessages"], "redisMetadata">
  )
)

type IncomerTransaction<
  T extends Record<string, any> & { data: Record<string, any> } = Record<string, any> & { data: Record<string, any> }
> = (
  DispatcherChannelMessages["IncomerMessages"] | IncomerChannelMessages<T>["IncomerMessages"]
) & (
  HandlerTransaction | MainTransaction
)

export type Transaction<
  T extends Instance = Instance,
  K extends Record<string, any> & { data: Record<string, any> } = Record<string, any> & { data: Record<string, any> }
> = (
  T extends "dispatcher" ? DispatcherTransaction : IncomerTransaction<K>
) & {
  aliveSince: number;
}

export type PartialTransaction<
  T extends Instance = Instance,
  K extends Record<string, any> & { data: Record<string, any> } = Record<string, any> & { data: Record<string, any> }
> = Omit<Transaction<T, K>, "redisMetadata" | "aliveSince"> & {
  redisMetadata: MetadataWithoutTransactionId<T>
};

export type Transactions<T extends Instance = Instance> = Map<string, Transaction<T>>;

export type TransactionStoreOptions<T extends Instance = Instance> = (Partial<KVOptions<Transactions<T>>> &
  T extends "incomer" ? { prefix: string; } : { prefix?: string; }) & {
    instance: T;
};

export class TransactionStore<
  T extends Instance = Instance, K extends Record<string, any> & { data: Record<string, any> } =
  Record<string, any> & { data: Record<string, any> }
>
  extends KVPeer<Transaction<T>> {
  private key: string;

  constructor(options: TransactionStoreOptions<T>) {
    super({ ...options, prefix: undefined, type: "object" });

    this.key = `${options.prefix ? `${options.prefix}-` : ""}${options.instance}-transaction`;
  }

  async getTransactions(): Promise<Transactions<T>> {
    const transactionsKeys = await this.redis.keys(`${this.key}-*`);

    const mappedTransactions: Transactions<T> = new Map();

    const transactions = await Promise.all(transactionsKeys.map(
      (transactionKey) => this.getValue(transactionKey)
    ));

    for (const transaction of transactions) {
      if (transaction !== null) {
        mappedTransactions.set(transaction.redisMetadata.transactionId, transaction);
      }
    }

    return mappedTransactions;
  }

  async setTransaction(transaction: PartialTransaction<T, K>): Promise<string> {
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

    this.setValue({ key: transactionKey, value: formattedTransaction });

    return transactionId;
  }

  async updateTransaction(transactionId: string, transaction: Transaction<T>): Promise<void> {
    const key = `${this.key}-${transactionId}`;

    this.setValue({ key, value: { ...transaction, aliveSince: Date.now() } });
  }

  async getTransactionById(transactionId: string): Promise<Transaction | null> {
    return await this.getValue(`${this.key}-${transactionId}`);
  }

  async deleteTransaction(transactionId: string) {
    await this.deleteValue(`${this.key}-${transactionId}`);
  }
}
