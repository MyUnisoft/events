// Import Node.js Dependencies
import timers from "node:timers/promises";

// Import Third-party Dependencies
import {
  RedisAdapter,
  Channel
} from "@myunisoft/redis";
import { pino } from "pino";
import { Ok } from "@openally/result";

// Import Internal Dependencies
import {
  validate,
  Dispatcher,
  Incomer,
  eventsValidationFn,
  type EventOptions,
  type Events,
  DOCUMENT_KIND
} from "../../../src/index.js";
import {
  Transaction,
  TransactionStore
} from "../../../src/class/store/transaction.class.js";

// Internal Dependencies Mocks
const incomerLogger = pino({
  level: "debug"
});
const mockedEventComeBackHandler = jest.fn().mockImplementation(() => Ok({ status: "RESOLVED" }));

async function updateRegisterTransactionState(
  publisherOldTransacStore: TransactionStore<"incomer">
) {
  const [_, registerTransaction] = [...await publisherOldTransacStore.getTransactions()].find(([id, transac]) => transac.name === "REGISTER")!;

  await publisherOldTransacStore.updateTransaction(registerTransaction.redisMetadata.transactionId!, {
    ...registerTransaction,
    redisMetadata: {
      ...registerTransaction!.redisMetadata,
      resolved: true
    }
  } as Transaction<"incomer">);
}

interface InitDispatcherInstanceOptions {
  pingInterval?: number;
  checkLastActivityInterval?: number;
  checkTransactionInterval?: number;
  idleTime?: number;
}


async function initDispatcherInstance(
  redis: RedisAdapter, subscriber: RedisAdapter,
  options: InitDispatcherInstanceOptions = {
    pingInterval: 10_000,
    checkLastActivityInterval: 15_000,
    idleTime: 15_000,
    checkTransactionInterval: 1_000
  }
): Promise<Dispatcher<EventOptions<keyof Events>>> {
  const { pingInterval, checkTransactionInterval, idleTime, checkLastActivityInterval } = options;

  const dispatcher = new Dispatcher<EventOptions<keyof Events>>({
    name: "foo",
    redis,
    subscriber,
    pingInterval,
    checkLastActivityInterval,
    checkTransactionInterval,
    idleTime,
    eventsValidation: {
      eventsValidationFn,
      customValidationCbFn: validate
    }
   });

  await dispatcher.initialize();

  return dispatcher;
}

async function handleRegistration(redis: RedisAdapter, instance: Incomer, message: any) {
  const { data } = message;

  Reflect.set(instance, "incomerChannelName", data.uuid);
  Reflect.set(instance, "providedUUID", data.uuid);

  instance["subscriber"]!.subscribe(data.uuid);

  Reflect.set(instance, "incomerChannel", new Channel({
    redis,
    name: data.uuid
  }));

  await updateRegisterTransactionState(
    instance["defaultIncomerTransactionStore"]
  );

  const instanceTransactionStore = new TransactionStore({
    adapter: redis as RedisAdapter<Transaction<"incomer">>,
    prefix: data.uuid,
    instance: "incomer"
  });

  Reflect.set(instance, "newTransactionStore", instanceTransactionStore);

  return { instanceTransactionStore };
}


describe("event", () => {
  const redis = new RedisAdapter({
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST
  });
  const subscriber = new RedisAdapter({
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST
  });

  beforeAll(async() => {
    await redis.initialize();
    await subscriber.initialize();

    await redis.flushall();
  });

  afterAll(async() => {
    await redis.close();
    await subscriber.close();
  });

  afterEach(async() => {
    jest.clearAllMocks();
  });

  describe("Publishing an event without concerned Incomer", () => {
    let dispatcher: Dispatcher<EventOptions<keyof Events>>;
    let publisher: Incomer;
    let unConcernedIncomer: Incomer;
    let publisherTransactionStore: TransactionStore<"incomer">;
    let unConcernedTransactionStore: TransactionStore<"incomer">;

    // CONSTANTS
    const event: EventOptions<"accountingFolder"> = {
      name: "accountingFolder",
      operation: "CREATE",
      data: {
        id: "1"
      },
      scope: {
        schemaId: 1,
        firmId: 1
      },
      metadata: {
        agent: "jest",
        createdAt: Date.now()
      }
    };

    const dispatcherTransactionStore: TransactionStore<"dispatcher"> = new TransactionStore({
      adapter: redis as RedisAdapter<Transaction<"dispatcher">>,
      instance: "dispatcher"
    });

    afterAll(async() => {
      await publisher.close();
      await unConcernedIncomer.close();

      await dispatcher.close();
    });

    beforeAll(async() => {
      dispatcher = await initDispatcherInstance(redis, subscriber);

      publisher = new Incomer({
        redis,
        subscriber,
        name: "foo",
        logger: incomerLogger,
        eventsCast: ["accountingFolder"],
        eventsSubscribe: [],
        eventCallback: mockedEventComeBackHandler,
        externalsInitialized: true
      });

      unConcernedIncomer = new Incomer({
        redis,
        subscriber,
        name: "bar",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [],
        eventCallback: mockedEventComeBackHandler,
        externalsInitialized: true
      });

      let index = 0;
      jest.spyOn(Incomer.prototype as any, "handleApprovement")
        .mockImplementation(async(message: any) => {
          const { data } = message;

          if (index === 0) {
            Reflect.set(publisher, "incomerChannelName", data.uuid);
            Reflect.set(publisher, "providedUUID", data.uuid);

            publisher["subscriber"]!.subscribe(data.uuid);

            Reflect.set(publisher, "incomerChannel", new Channel({
              redis,
              name: data.uuid
            }));

            publisherTransactionStore = new TransactionStore({
              adapter: redis as RedisAdapter<Transaction<"incomer">>,
              prefix: data.uuid,
              instance: "incomer"
            });

            Reflect.set(publisher, "incomerTransactionStore", publisherTransactionStore);

            publisher.emit("registered");
          }
          else {
            Reflect.set(unConcernedIncomer, "incomerChannelName", data.uuid);
            Reflect.set(unConcernedIncomer, "providedUUID", data.uuid);

            unConcernedIncomer["subscriber"]!.subscribe(data.uuid);

            Reflect.set(unConcernedIncomer, "#incomerChannel", new Channel({
              redis,
              name: data.uuid
            }));

            unConcernedTransactionStore = new TransactionStore({
              adapter: redis as RedisAdapter<Transaction<"incomer">>,
              prefix: data.uuid,
              instance: "incomer"
            });

            Reflect.set(unConcernedIncomer, "incomerTransactionStore", unConcernedTransactionStore);

            unConcernedIncomer.emit("registered");
          }

          index++
      });

      await publisher.initialize();
      await unConcernedIncomer.initialize();

      await publisher.publish(event);
    });

    test("The event is not spread & callback function must not have been call", async() => {
      await timers.setTimeout(1_600);

      const spreadTransactions = await dispatcherTransactionStore.getTransactions();

      expect([...spreadTransactions.keys()].length).toBe(2);
      expect(mockedEventComeBackHandler).not.toHaveBeenCalled();
    });
  });

  describe("Event that doesn't scale", () => {
    let dispatcher: Dispatcher<EventOptions<keyof Events>>;
    let publisher: Incomer;
    let concernedIncomer: Incomer;
    let secondConcernedIncomer: Incomer;
    let diffConcernedIncomer: Incomer;
    let publisherTransactionStore: TransactionStore<"incomer">;

    // Constants
    const ACFEvent: EventOptions<"accountingFolder"> = {
      name: "accountingFolder",
      operation: "CREATE",
      data: {
        id: "1"
      },
      scope: {
        schemaId: 1,
        firmId: 1
      },
      metadata: {
        agent: "jest",
        createdAt: Date.now(),
          origin: {
            endpoint: "/foo",
            method: "POST",
            requestId: "1"
          }
      }
    };

    const dispatcherTransactionStore: TransactionStore<"dispatcher"> = new TransactionStore({
      adapter: redis as RedisAdapter<Transaction<"dispatcher">>,
      instance: "dispatcher"
    });

    beforeAll(async() => {
      dispatcher = await initDispatcherInstance(redis, subscriber,
          {
          pingInterval: 10_000,
          checkLastActivityInterval: 15_000,
          idleTime: 15_000,
          checkTransactionInterval: 10_000
        }
      );

      publisher = new Incomer({
        redis,
        subscriber,
        name: "foo",
        logger: incomerLogger,
        eventsCast: ["accountingFolder"],
        eventsSubscribe: [],
        eventCallback: mockedEventComeBackHandler,
        externalsInitialized: true
      });

      concernedIncomer = new Incomer({
        redis,
        subscriber,
        name: "bar",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [{ name: "accountingFolder" }],
        eventCallback: mockedEventComeBackHandler,
        externalsInitialized: true
      });

      secondConcernedIncomer = new Incomer({
        redis,
        subscriber,
        name: "bar",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [{ name: "accountingFolder" }],
        eventCallback: mockedEventComeBackHandler,
        externalsInitialized: true
      });

      diffConcernedIncomer = new Incomer({
        redis,
        subscriber,
        name: "foo-bar",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [{ name: "accountingFolder" }],
        eventCallback: mockedEventComeBackHandler,
        externalsInitialized: true
      });

      let index = 0;
      jest.spyOn(Incomer.prototype as any, "handleApprovement")
        .mockImplementation(async(message: any) => {
          if (index === 0) {
            const { instanceTransactionStore } = await handleRegistration(redis, publisher, message);

            publisherTransactionStore = instanceTransactionStore;

            publisher.emit("registered");
          }
          else if (index === 1) {
            await handleRegistration(redis, concernedIncomer, message);

            concernedIncomer.emit("registered");
          }
          else if (index === 2) {
            await handleRegistration(redis, secondConcernedIncomer, message);

            secondConcernedIncomer.emit("registered");
          }
          else {
            await handleRegistration(redis, diffConcernedIncomer, message);

            diffConcernedIncomer.emit("registered");
          }

          index++;
      });

      await publisher.initialize();
      await concernedIncomer.initialize();
      await secondConcernedIncomer.initialize();
      await diffConcernedIncomer.initialize();

      await timers.setTimeout(1_000);
    });

    afterAll(async() => {
      await publisher.close();
      await concernedIncomer.close();
      await secondConcernedIncomer.close();
      await diffConcernedIncomer.close();

      await dispatcher.close();
    });

    test("callback function must have been call & both diff incomers should have update the relating transaction", async() => {
      await publisher.publish(ACFEvent);

      await timers.setTimeout(1_000);

      const relatedSpreadTransactions = [...(await dispatcherTransactionStore.getTransactions()).values()]
        .filter((transaction) => transaction.name === ACFEvent.name);

      expect(relatedSpreadTransactions.length).toBe(2);
      for (const transaction of relatedSpreadTransactions) {
        expect(transaction.redisMetadata.resolved).toBe(true);
      }

      expect(mockedEventComeBackHandler).toHaveBeenCalledTimes(2);
      expect(mockedEventComeBackHandler).toHaveBeenCalledWith({
        ...ACFEvent,
        eventTransactionId: expect.anything()
      });
    });

    test("Then the dispatcher should have delete the mainTransaction on the publisherTransactionStore", async() => {
      await timers.setTimeout(2_400);

      const publisherTransactions = await publisherTransactionStore.getTransactions();
      expect(publisherTransactions).not.toContain({
        ...ACFEvent,
        redisMetadata: expect.anything(),
        relatedTransaction: null,
        mainTransaction: true,
        resolved: false
      });
    });
  });

  describe("Event that scale", () => {
    let dispatcher: Dispatcher<EventOptions<keyof Events>>;
    let publisher: Incomer;
    let concernedIncomer: Incomer;
    let secondConcernedIncomer: Incomer;
    let diffConcernedIncomer: Incomer;
    let publisherTransactionStore: TransactionStore<"incomer">;

    // CONSTANTS
    const documentEvent: EventOptions<"document"> = {
      name: "document",
      operation: "CREATE",
      data: {
        id: "1",
        name: "foo",
        kind: DOCUMENT_KIND.DossierAnnuel
      },
      scope: {
        schemaId: 1,
        firmId: 1
      },
      metadata: {
        agent: "jest",
        createdAt: Date.now()
      }
    }

    const dispatcherTransactionStore: TransactionStore<"dispatcher"> = new TransactionStore({
      adapter: redis as RedisAdapter<Transaction<"dispatcher">>,
      instance: "dispatcher"
    });

    afterAll(async() => {
      await publisher.close();
      await concernedIncomer.close();
      await secondConcernedIncomer.close();
      await diffConcernedIncomer.close();

      await dispatcher.close();
    });

    beforeAll(async() => {
      dispatcher = await initDispatcherInstance(redis, subscriber,
        {
          pingInterval: 10_000,
          checkLastActivityInterval: 15_000,
          idleTime: 15_000,
          checkTransactionInterval: 10_000
        }
      );

      publisher = new Incomer({
        redis,
        subscriber,
        name: "foo",
        logger: incomerLogger,
        eventsCast: ["document"],
        eventsSubscribe: [],
        eventCallback: mockedEventComeBackHandler,
        externalsInitialized: true
      });

      concernedIncomer = new Incomer({
        redis,
        subscriber,
        name: "bar",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [{ name: "document", horizontalScale: true }],
        eventCallback: mockedEventComeBackHandler,
        externalsInitialized: true
      });

      secondConcernedIncomer = new Incomer({
        redis,
        subscriber,
        name: "bar",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [{ name: "document", horizontalScale: true }],
        eventCallback: mockedEventComeBackHandler,
        externalsInitialized: true
      });

      diffConcernedIncomer = new Incomer({
        redis,
        subscriber,
        name: "foo-bar",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [{ name: "document", horizontalScale: true }],
        eventCallback: mockedEventComeBackHandler,
        externalsInitialized: true
      });

      let index = 0;
      jest.spyOn(Incomer.prototype as any, "handleApprovement")
        .mockImplementation(async(message: any) => {
          if (index === 0) {
            const { instanceTransactionStore } = await handleRegistration(redis, publisher, message);

            publisherTransactionStore = instanceTransactionStore;

            publisher.emit("registered");
          }
          else if (index === 1) {
            await handleRegistration(redis, concernedIncomer, message);

            concernedIncomer.emit("registered");
          }
          else if (index === 2) {
            await handleRegistration(redis, secondConcernedIncomer, message);

            secondConcernedIncomer.emit("registered");
          }
          else {
            await handleRegistration(redis, diffConcernedIncomer, message);

            diffConcernedIncomer.emit("registered");
          }

          index++;
      });

      await publisher.initialize();
      await concernedIncomer.initialize();
      await secondConcernedIncomer.initialize();
      await diffConcernedIncomer.initialize();

      await timers.setTimeout(1_000);
    });

    test("callback function must have been call & every incomers should have create the relating transaction", async() => {
      await publisher.publish(documentEvent);

      await timers.setTimeout(2_000);

      const relatedSpreadTransactions = [...(await dispatcherTransactionStore.getTransactions()).values()]
        .filter((transaction) => transaction.name === documentEvent.name);

      expect(relatedSpreadTransactions.length).toBe(3);
      for (const transaction of relatedSpreadTransactions) {
        expect(transaction.redisMetadata.resolved).toBe(true);
      }

      expect(mockedEventComeBackHandler).toHaveBeenCalledTimes(3);
      expect(mockedEventComeBackHandler).toHaveBeenCalledWith({
        ...documentEvent,
        eventTransactionId: expect.anything()
      });

      await timers.setTimeout(2_400);

      const SecondPublisherTransactions = await publisherTransactionStore.getTransactions();
      expect(SecondPublisherTransactions.values()).not.toContainEqual({
        ...documentEvent,
        redisMetadata: expect.anything(),
        published: true,
        relatedTransaction: null,
        mainTransaction: true,
        resolved: false
      });
    });
  });
});
