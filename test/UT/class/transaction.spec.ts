// Import Third-party Dependencies
import {
  initRedis,
  closeRedis
} from "@myunisoft/redis-utils";

// Import Internal Dependencies
import { PartialTransaction, TransactionStore } from "../../../src/class/transaction.class";

let transactionStore: TransactionStore;

beforeAll(async() => {
  await initRedis({
    port: process.env.REDIS_PORT,
    host: process.env.REDIS_HOST
  } as any);
});

afterAll(async() => {
  await closeRedis();
});

describe("Transaction options", () => {
  beforeAll(async() => {
    transactionStore = new TransactionStore({
      instance: "dispatcher"
    });
  });

  test("Transaction should be defined", () => {
    expect(transactionStore).toBeInstanceOf(TransactionStore);
  });

  describe("deleteTransaction", () => {
    let transactionId: string;

    beforeAll(async() => {
      const transaction: PartialTransaction<"dispatcher"> = {
        event: "foo",
        data: {
          uuid: "foo"
        },
        metadata: {
          origin: "foo",
          to: "foo"
        }
      };

      transactionId = await transactionStore.setTransaction(transaction);
    });


    test("calling deleteTransaction, it should delete the transaction & return void", async() => {
      await transactionStore.deleteTransaction(transactionId);

      const result = await transactionStore.getTransaction(transactionId);

      expect(result).toBeUndefined();
    });
  });

  describe("setTransaction", () => {
    test("calling setTransaction, it should add a new transaction to the transaction tree", async() => {
      const transaction: PartialTransaction<"dispatcher"> = {
        event: "foo",
        data: {
          uuid: "foo"
        },
        metadata: {
          origin: "foo",
          to: "foo"
        }
      };

      const transactionId = await transactionStore.setTransaction(transaction);

      expect(transactionId).toBeDefined();

      await transactionStore.deleteTransaction(transactionId);
    });
  });

  describe("getTransaction", () => {
    let transactionId: string;

    beforeAll(async() => {
      const transaction: PartialTransaction<"dispatcher"> = {
        event: "foo",
        data: {
          uuid: "foo"
        },
        metadata: {
          origin: "foo",
          to: "foo"
        }
      };

      transactionId = await transactionStore.setTransaction(transaction);
    });

    afterAll(async() => {
      await transactionStore.deleteTransaction(transactionId);
    });

    test("calling getTransaction, it should return the according transaction", async() => {
      const finalTransaction = await transactionStore.getTransaction(transactionId);

      expect(finalTransaction).toBeDefined();
    });
  });

  describe("getTransactions", () => {
    beforeAll(async() => {
      const transaction: PartialTransaction<"dispatcher"> = {
        event: "foo",
        data: {
          uuid: "foo"
        },
        metadata: {
          origin: "foo",
          to: "foo"
        }
      };

      await transactionStore.setTransaction(transaction);
      await transactionStore.setTransaction(transaction);
    });


    test("calling getTransactions, it should return the transaction tree", async() => {
      const transactionTree = await transactionStore.getTransactions();

      expect(transactionTree).toBeDefined();
      expect(Object.entries(transactionTree).length).toBe(2);

      for (const transactionId of Object.keys(transactionTree)) {
        await transactionStore.deleteTransaction(transactionId);
      }
    });
  });
});
