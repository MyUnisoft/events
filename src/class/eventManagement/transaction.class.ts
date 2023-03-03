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
  Omit<DispatcherTransactionMetadata, "transactionId"> :
  Omit<IncomerTransactionMetadata, "transactionId">;

type MainTransaction = {
  mainTransaction: true;
  relatedTransaction: null;
  resolved: null;
}

type DispatcherTransaction = {
  mainTransaction: false;
  relatedTransaction: string;
  resolved: boolean;
}

type HandlerTransaction = {
  mainTransaction: false;
  relatedTransaction: string;
  resolved: null;
}

export type Transaction<T extends Instance = Instance> = (T extends "dispatcher" ?
  DispatcherChannelMessages["DispatcherMessages"] |
  (IncomerChannelMessages["DispatcherMessages"] |
  { event: string, data: Record<string, any> }) :
  DispatcherChannelMessages["IncomerMessages"] | IncomerChannelMessages["IncomerMessage"]) & {
    aliveSince: number;
  } & (
    (T extends "dispatcher" ? DispatcherTransaction : HandlerTransaction) |
    MainTransaction
  );

export type PartialTransaction<T extends Instance = Instance> = Omit<Transaction<T>, "metadata" | "aliveSince"> & {
  metadata: MetadataWithoutTransactionId;
};

export type Transactions<T extends Instance = Instance> = Record<string, Transaction<T>>;

export type TransactionStoreOptions<T extends Instance = Instance> = {
  instance: T
} & Partial<KVOptions<Transactions<T>>>;

export class TransactionStore<T extends Instance = Instance> extends KVPeer<Transactions<T>> {
  private key: string;

  constructor(options: TransactionStoreOptions<T>, redis?: Redis) {
    super({ ...options, prefix: undefined, type: "object" }, redis);

    this.key = `${options.prefix ? `${options.prefix}-` : ""}${options.instance}-transaction`;
  }

  async getTransactions(): Promise<Transactions<T> | Record<string, any>> {
    return await super.getValue(this.key) ?? {};
  }

  async setTransaction(transaction: PartialTransaction<T>): Promise<string> {
    const transactions = await this.getTransactions();

    const transactionId = randomUUID();

    const formattedTransaction = {
      ...transaction,
      aliveSince: Date.now(),
      metadata: {
        ...transaction.metadata,
        transactionId
      }
    } as Transaction<T>;

    transactions[transactionId] = formattedTransaction;

    await this.updateTransactions(transactions);

    return transactionId;
  }

  async updateTransaction(transactionId: string, transaction: Transaction<T>): Promise<void> {
    const transactions = await this.getTransactions();

    transactions[transactionId] = transaction;

    await this.updateTransactions(transactions);
  }

  async getTransactionById(transactionId: string): Promise<Transaction | null> {
    const transactions = await this.getTransactions();

    return transactions[transactionId];
  }

  async deleteTransaction(transactionId: string) {
    const transactions = await this.getTransactions();

    const { [transactionId]: deletedTransaction, ...finalTransactions } = transactions;

    if (Object.entries(finalTransactions).length === 0) {
      await super.deleteValue(this.key);
    }
    else {
      await this.updateTransactions(finalTransactions);
    }
  }

  private async updateTransactions(transactions: Transactions<T>): Promise<string | Buffer> {
    return await super.setValue({ key: this.key, value: transactions });
  }
}
