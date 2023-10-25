// Import Third-party Dependencies
import {
  initRedis,
  closeRedis
} from "@myunisoft/redis";

// Import Internal Dependencies
import { PartialTransaction, Transaction, TransactionStore } from "../../../../src/class/store/transaction.class";

let transactionStore: TransactionStore<"dispatcher">;

beforeAll(async() => {
  const redis = await initRedis({
    port: process.env.REDIS_PORT,
    host: process.env.REDIS_HOST
  } as any);

  await redis.flushall();
});

afterAll(async() => {
  await closeRedis();
});

describe("Transaction options", () => {
  beforeAll(async() => {
    transactionStore = new TransactionStore<"dispatcher">({
      instance: "dispatcher"
    });
  });

  test("Transaction should be defined", () => {
    expect(transactionStore).toBeInstanceOf(TransactionStore);
  });

  describe("deleteTransaction", () => {
    let transaction: Transaction<"dispatcher">;

    beforeAll(async() => {
      const partialTransaction: PartialTransaction<"dispatcher"> = {
        name: "ping",
        data: null,
        redisMetadata: {
          origin: "foo",
          to: "foo",
          mainTransaction: true,
          relatedTransaction: null,
          resolved: false,
          incomerName: "foo"
        }
      };

      transaction = await transactionStore.setTransaction(partialTransaction);
    });


    test("calling deleteTransaction, it should delete the transaction & return null", async() => {
      await transactionStore.deleteTransaction(transaction.redisMetadata.transactionId);

      const result = await transactionStore.getTransactionById(transaction.redisMetadata.transactionId);

      expect(result).toBeNull();
    });
  });

  describe("setTransaction", () => {
    test("calling setTransaction, it should add a new transaction to the transaction tree", async() => {
      const partialTransaction: PartialTransaction<"dispatcher"> = {
        name: "ping",
        data: null,
        redisMetadata: {
          origin: "foo",
          to: "foo",
          mainTransaction: true,
          relatedTransaction: null,
          resolved: false,
          incomerName: "foo"
        },
      };

      const transaction = await transactionStore.setTransaction(partialTransaction);
      await transactionStore.deleteTransaction(transaction.redisMetadata.transactionId);

      expect(transaction).toBeDefined();
    });
  });

  describe("getTransactionById", () => {
    let transaction: Transaction<"dispatcher">;

    beforeAll(async() => {
      const partialTransaction: PartialTransaction<"dispatcher"> = {
        name: "ping",
        data: null,
        redisMetadata: {
          origin: "foo",
          to: "foo",
          mainTransaction: true,
          relatedTransaction: null,
          resolved: false,
          incomerName: "foo"
        },
      };

      transaction = await transactionStore.setTransaction(partialTransaction);
    });

    afterAll(async() => {
      await transactionStore.deleteTransaction(transaction.redisMetadata.transactionId);
    });

    test("calling getTransactionById, it should return the according transaction", async() => {
      const finalTransaction = await transactionStore.getTransactionById(transaction.redisMetadata.transactionId);

      expect(finalTransaction).toBeDefined();
    });
  });

  describe("getTransactions", () => {
    beforeAll(async() => {
      const transaction: PartialTransaction<"dispatcher"> = {
        name: "ping",
        data: null,
        redisMetadata: {
          origin: "foo",
          to: "foo",
          mainTransaction: true,
          relatedTransaction: null,
          resolved: false,
          incomerName: "foo"
        },
      };

      await transactionStore.setTransaction(transaction);
      await transactionStore.setTransaction(transaction);
    });


    test("calling getTransactions, it should return the transaction tree", async() => {
      const transactionTree = await transactionStore.getTransactions();

      expect(transactionTree).toBeDefined();
      expect(transactionTree.size).toBe(2);

      for (const transactionId of Object.keys(transactionTree)) {
        await transactionStore.deleteTransaction(transactionId);
      }
    });
  });
});
