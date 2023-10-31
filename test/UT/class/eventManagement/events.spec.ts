// Import Node.js Dependencies
import timers from "timers/promises";

// Import Third-party Dependencies
import {
  initRedis,
  closeAllRedis,
  clearAllKeys,
  Channel
} from "@myunisoft/redis";
import * as Logger from "pino";

// Import Internal Dependencies
import {
  Dispatcher,
  Incomer,
  eventsValidationFn,
  EventOptions,
  Events
} from "../../../../src/index";
import { Transaction, TransactionStore } from "../../../../src/class/store/transaction.class";
import { validate } from "../../../../src/index";

// Internal Dependencies Mocks
const incomerLogger = Logger.pino({
  level: "debug"
});
const mockedEventComeBackHandler = jest.fn();

async function updateRegisterTransactionState(
  publisherOldTransacStore: TransactionStore<"incomer">,
  publisherRegistrationTransacId: string,
  approvementTransactionId: string
) {
  const registerTransaction = await publisherOldTransacStore.getTransactionById(publisherRegistrationTransacId);

  await publisherOldTransacStore.updateTransaction(publisherRegistrationTransacId, {
    ...registerTransaction,
    redisMetadata: {
      ...registerTransaction!.redisMetadata,
      relatedTransaction: approvementTransactionId,
      resolved: true
    }
  } as Transaction<"incomer">);
}

async function handleRegistration(instance: Incomer, message: any) {
  const { data } = message;

  Reflect.set(instance, "incomerChannelName", data.uuid);
  Reflect.set(instance, "providedUUID", data.uuid);

  instance["subscriber"]!.subscribe(data.uuid);

  Reflect.set(instance, "incomerChannel", new Channel({
    name: data.uuid
  }));

  await updateRegisterTransactionState(
    instance["incomerTransactionStore"],
    instance["registerTransactionId"]!,
    message.redisMetadata.transactionId
  );

  const instanceTransactionStore = new TransactionStore({
    prefix: data.uuid,
    instance: "incomer"
  });

  Reflect.set(instance, "incomerTransactionStore", instanceTransactionStore);

  return { instanceTransactionStore };
}

describe("Publishing/exploiting a custom event", () => {
  let dispatcher: Dispatcher<EventOptions<keyof Events>>;

  beforeAll(async() => {
    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any);

    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any, "subscriber");

    dispatcher = new Dispatcher({
      pingInterval: 10_000,
      checkLastActivityInterval: 14_000,
      checkTransactionInterval: 5_000,
      idleTime: 14_000,
      eventsValidation: {
        eventsValidationFn,
        validationCbFn: validate
      }
     });

    await dispatcher.initialize();
  });

  afterAll(async() => {
    await dispatcher.close();
    await closeAllRedis();
  });

  afterEach(async() => {
    jest.clearAllMocks();
    await clearAllKeys();
  });

  describe("Publishing an event without concerned Incomer", () => {
    let publisher: Incomer;
    let unConcernedIncomer: Incomer;
    let publisherTransactionStore: TransactionStore<"incomer">;
    let unConcernedTransactionStore: TransactionStore<"incomer">;
    let mockedPublisherSetTransaction;
    let mockedUnConcernedSetTransaction;

    // Constants
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

    afterAll(async() => {
      await publisher.close();
      await unConcernedIncomer.close();
    })

    beforeAll(async() => {
      publisher = new Incomer({
        name: "foo",
        logger: incomerLogger,
        eventsCast: ["accountingFolder"],
        eventsSubscribe: [],
        eventCallback: mockedEventComeBackHandler
      });

      unConcernedIncomer = new Incomer({
        name: "bar",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [],
        eventCallback: mockedEventComeBackHandler
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
              name: data.uuid
            }));

            publisherTransactionStore = new TransactionStore({
              prefix: data.uuid,
              instance: "incomer"
            });

            mockedPublisherSetTransaction = jest.spyOn(publisherTransactionStore, "setTransaction");

            Reflect.set(publisher, "incomerTransactionStore", publisherTransactionStore);

            publisher.emit("registered");
          }
          else {
            Reflect.set(unConcernedIncomer, "incomerChannelName", data.uuid);
            Reflect.set(unConcernedIncomer, "providedUUID", data.uuid);

            unConcernedIncomer["subscriber"]!.subscribe(data.uuid);

            Reflect.set(unConcernedIncomer, "incomerChannel", new Channel({
              name: data.uuid
            }));

            unConcernedTransactionStore = new TransactionStore({
              prefix: data.uuid,
              instance: "incomer"
            });

            mockedUnConcernedSetTransaction = jest.spyOn(unConcernedTransactionStore, "setTransaction");

            Reflect.set(unConcernedIncomer, "incomerTransactionStore", unConcernedTransactionStore);

            unConcernedIncomer.emit("registered");
          }

          index++
      });

      await publisher.initialize();
      await unConcernedIncomer.initialize();

      await publisher.publish(event);
    });

    test("callback function must not have been call & incomer shouldn't have create the relating transaction", async() => {
      await timers.setTimeout(1_600);

      expect(mockedPublisherSetTransaction).not.toHaveBeenCalledWith({
        ...event,
        redisMetadata: expect.anything(),
        mainTransaction: false,
        resolved: false,
        relatedTransaction: expect.anything()
      });
      expect(mockedUnConcernedSetTransaction).not.toHaveBeenCalledWith({
        ...event,
        redisMetadata: expect.anything(),
        mainTransaction: false,
        resolved: false,
        relatedTransaction: expect.anything()
      });
      expect(mockedEventComeBackHandler).not.toHaveBeenCalled();
    });
  });

  describe("Event that doesn't scale", () => {
    let publisher: Incomer;
    let concernedIncomer: Incomer;
    let secondConcernedIncomer: Incomer;
    let diffConcernedIncomer: Incomer;
    let publisherTransactionStore: TransactionStore<"incomer">;
    let mockedPublisherSetTransaction;
    let mockedIncomerSetTransaction;
    let mockedSecondIncomerSetTransaction;
    let mockedDiffIncomerSetTransaction;

    // Constants
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

    afterAll(async() => {
      await publisher.close();
      await concernedIncomer.close();
      await secondConcernedIncomer.close();
      await diffConcernedIncomer.close();
    });

    beforeAll(async() => {
      publisher = new Incomer({
        name: "foo",
        logger: incomerLogger,
        eventsCast: ["accountingFolder"],
        eventsSubscribe: [],
        eventCallback: mockedEventComeBackHandler
      });

      concernedIncomer = new Incomer({
        name: "bar",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [{ name: "accountingFolder" }],
        eventCallback: mockedEventComeBackHandler
      });

      secondConcernedIncomer = new Incomer({
        name: "bar",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [{ name: "accountingFolder" }],
        eventCallback: mockedEventComeBackHandler
      });

      diffConcernedIncomer = new Incomer({
        name: "foo-bar",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [{ name: "accountingFolder" }],
        eventCallback: mockedEventComeBackHandler
      });

      let index = 0;
      jest.spyOn(Incomer.prototype as any, "handleApprovement")
        .mockImplementation(async(message: any) => {
          if (index === 0) {
            const { instanceTransactionStore } = await handleRegistration(publisher, message);

            publisherTransactionStore = instanceTransactionStore;
            mockedPublisherSetTransaction = jest.spyOn(instanceTransactionStore, "setTransaction");

            publisher.emit("registered");
          }
          else if (index === 1) {
            const { instanceTransactionStore } = await handleRegistration(concernedIncomer, message);
            mockedIncomerSetTransaction = jest.spyOn(instanceTransactionStore, "setTransaction");

            concernedIncomer.emit("registered");
          }
          else if (index === 2) {
            const { instanceTransactionStore } = await handleRegistration(secondConcernedIncomer, message);
            mockedSecondIncomerSetTransaction = jest.spyOn(instanceTransactionStore, "setTransaction");

            secondConcernedIncomer.emit("registered");
          }
          else {
            const { instanceTransactionStore } = await handleRegistration(diffConcernedIncomer, message);
            mockedDiffIncomerSetTransaction = jest.spyOn(instanceTransactionStore, "setTransaction");

            diffConcernedIncomer.emit("registered");
          }

          index++;
      });

      await publisher.initialize();
      await concernedIncomer.initialize();
      await secondConcernedIncomer.initialize();
      await diffConcernedIncomer.initialize();

      await timers.setTimeout(1_600);

      await publisher.publish(event);
    });

    test("callback function must have been call & both incomers should have create the relating transaction", async() => {
      expect(mockedPublisherSetTransaction).toHaveBeenCalledWith({
        ...event,
        redisMetadata: {
          incomerName: publisher.name,
          origin: expect.any(String),
          prefix: publisher.prefix,
          published: false,
          mainTransaction: true,
          resolved: false,
          relatedTransaction: null
        }
      });

      await timers.setTimeout(1_600);

      const mockedEvent = {
        ...event,
        redisMetadata: {
          eventTransactionId: expect.any(String),
          incomerName: expect.any(String),
          origin: expect.any(String),
          prefix: publisher.prefix,
          mainTransaction: false,
          resolved: false,
          to: expect.any(String),
          relatedTransaction: expect.any(String),
          transactionId: expect.any(String)
        },
      };

      if (mockedIncomerSetTransaction.mock.calls.length === 1) {
        expect(mockedIncomerSetTransaction).toHaveBeenCalledWith(mockedEvent);
        expect(mockedSecondIncomerSetTransaction).not.toHaveBeenCalledWith(mockedEvent);
        expect(mockedDiffIncomerSetTransaction).toHaveBeenCalledWith(mockedEvent);
      }

      expect(mockedEventComeBackHandler).toHaveBeenCalledTimes(2);
      expect(mockedEventComeBackHandler).toHaveBeenCalledWith({
        ...event,
        eventTransactionId: expect.anything()
      });
    });

    test("Then the dispatcher should have delete the mainTransaction on the publisherTransactionStore", async() => {
      await timers.setTimeout(2_400);

      const publisherTransactions = await publisherTransactionStore.getTransactions();
      expect(publisherTransactions).not.toContain({
        ...event,
        redisMetadata: expect.anything(),
        relatedTransaction: null,
        mainTransaction: true,
        resolved: false
      });
    });
  });

  describe("Event that scale", () => {
    let publisher: Incomer;
    let concernedIncomer: Incomer;
    let secondConcernedIncomer: Incomer;
    let diffConcernedIncomer: Incomer;
    let publisherTransactionStore: TransactionStore<"incomer">;
    let mockedPublisherSetTransaction;
    let mockedIncomerSetTransaction;
    let mockedSecondIncomerSetTransaction;
    let mockedDiffIncomerSetTransaction;

    // Constants
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
    }

    afterAll(async() => {
      await publisher.close();
      await concernedIncomer.close();
      await secondConcernedIncomer.close();
      await diffConcernedIncomer.close();
    });

    beforeAll(async() => {
      publisher = new Incomer({
        name: "foo",
        logger: incomerLogger,
        eventsCast: ["accountingFolder"],
        eventsSubscribe: [],
        eventCallback: mockedEventComeBackHandler
      });

      concernedIncomer = new Incomer({
        name: "bar",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [{ name: "accountingFolder", horizontalScale: true }],
        eventCallback: mockedEventComeBackHandler
      });

      secondConcernedIncomer = new Incomer({
        name: "bar",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [{ name: "accountingFolder", horizontalScale: true }],
        eventCallback: mockedEventComeBackHandler
      });

      diffConcernedIncomer = new Incomer({
        name: "foo-bar",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [{ name: "accountingFolder", horizontalScale: true }],
        eventCallback: mockedEventComeBackHandler
      });

      let index = 0;
      jest.spyOn(Incomer.prototype as any, "handleApprovement")
        .mockImplementation(async(message: any) => {
          if (index === 0) {
            const { instanceTransactionStore } = await handleRegistration(publisher, message);

            publisherTransactionStore = instanceTransactionStore;
            mockedPublisherSetTransaction = jest.spyOn(instanceTransactionStore, "setTransaction");

            publisher.emit("registered");
          }
          else if (index === 1) {
            const { instanceTransactionStore } = await handleRegistration(concernedIncomer, message);
            mockedIncomerSetTransaction = jest.spyOn(instanceTransactionStore, "setTransaction");

            concernedIncomer.emit("registered");
          }
          else if (index === 2) {
            const { instanceTransactionStore } = await handleRegistration(secondConcernedIncomer, message);
            mockedSecondIncomerSetTransaction = jest.spyOn(instanceTransactionStore, "setTransaction");

            secondConcernedIncomer.emit("registered");
          }
          else {
            const { instanceTransactionStore } = await handleRegistration(diffConcernedIncomer, message);
            mockedDiffIncomerSetTransaction = jest.spyOn(instanceTransactionStore, "setTransaction");

            diffConcernedIncomer.emit("registered");
          }

          index++;
      });

      await publisher.initialize();
      await concernedIncomer.initialize();
      await secondConcernedIncomer.initialize();
      await diffConcernedIncomer.initialize();

      await timers.setTimeout(1_000);

      await publisher.publish(event);
    });

    test("callback function must have been call & every incomers should have create the relating transaction", async() => {
      expect(mockedPublisherSetTransaction).toHaveBeenNthCalledWith(1, {
        ...event,
        redisMetadata: {
          incomerName: publisher.name,
          origin: expect.any(String),
          prefix: publisher.prefix,
          published: false,
          mainTransaction: true,
          resolved: false,
          relatedTransaction: null
        }
      });

      await timers.setTimeout(5_000);

      const mockedEvent = {
        ...event,
        redisMetadata: {
          eventTransactionId: expect.any(String),
          origin: expect.any(String),
          incomerName: expect.any(String),
          to: expect.any(String),
          transactionId: expect.any(String),
          mainTransaction: false,
          resolved: false,
          relatedTransaction: expect.any(String)
        }
      };

      expect(mockedIncomerSetTransaction).toHaveBeenCalledWith(mockedEvent);
      expect(mockedSecondIncomerSetTransaction).toHaveBeenCalledWith(mockedEvent);
      expect(mockedDiffIncomerSetTransaction).toHaveBeenCalledWith(mockedEvent);

      expect(mockedEventComeBackHandler).toHaveBeenCalledTimes(3);
      expect(mockedEventComeBackHandler).toHaveBeenCalledWith({
        ...event,
        eventTransactionId: expect.anything()
      });

      await timers.setTimeout(2_400);

      const SecondPublisherTransactions = await publisherTransactionStore.getTransactions();
      expect(SecondPublisherTransactions.values()).not.toContainEqual({
        ...event,
        redisMetadata: expect.anything(),
        published: true,
        relatedTransaction: null,
        mainTransaction: true,
        resolved: false
      });
    });
  });
});


