// Import Node.js Dependencies
import { randomUUID } from "node:crypto";
import timers from "timers/promises";

// Import Third-party Dependencies
import {
  initRedis,
  closeRedis,
  clearAllKeys,
  Channel
} from "@myunisoft/redis";
import * as Logger from "pino";

// Import Internal Dependencies
import {
  Dispatcher,
  Incomer,
  eventsValidationFunction,
  EventOptions
} from "../../../../src/index";
import { TransactionStore } from "../../../../src/class/eventManagement/transaction.class";

// Internal Dependencies Mocks
const dispatcherLogger = Logger.pino();
const incomerLogger = Logger.pino();
const mockedEventComeBackHandler = jest.fn();


describe("Publishing a custom event that doesn't scale", () => {
  let dispatcher: Dispatcher;

  beforeAll(async() => {
    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any);

    dispatcher = new Dispatcher({
      pingInterval: 10_000,
      checkLastActivityInterval: 14_000,
      checkTransactionInterval: 10_600,
      idleTime: 14_000,
      eventsValidationFunction: eventsValidationFunction
     });

    Reflect.set(dispatcher, "logger", dispatcherLogger);

    await dispatcher.initialize();
  });

  afterAll(async() => {
    await dispatcher.close();
    await closeRedis();
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
        schemaId: 1
      },
      metadata: {
        agent: "jest",
        createdAt: Date.now()
      }
    };

    beforeAll(async() => {
      publisher = new Incomer({
        name: randomUUID(),
        eventsCast: ["accountingFolder"],
        eventsSubscribe: [],
        eventCallback: mockedEventComeBackHandler
      });

      unConcernedIncomer = new Incomer({
        name: randomUUID(),
        eventsCast: [],
        eventsSubscribe: [],
        eventCallback: mockedEventComeBackHandler
      });

      Reflect.set(publisher, "logger", incomerLogger);

      let index = 0;
      jest.spyOn(Incomer.prototype as any, "handleApprovement")
        .mockImplementation(async(message: any) => {
          const { data } = message;

          if (index === 0) {
            Reflect.set(publisher, "incomerChannelName", data.uuid);
            Reflect.set(publisher, "providedUUID", data.uuid);

            publisher["subscriber"].subscribe(data.uuid);

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

            unConcernedIncomer["subscriber"].subscribe(data.uuid);

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

  describe("Publishing an event with concerned Incomers", () => {
    let publisher: Incomer;
    let concernedIncomer: Incomer;
    let secondConcernedIncomer: Incomer;
    let incomerTransactionStore: TransactionStore<"incomer">;
    let secondIncomerTransactionStore: TransactionStore<"incomer">;
    let mockedSecondIncomerSetTransaction;
    let mockedIncomerSetTransaction;

    // Constants
    const event: EventOptions<"accountingFolder"> = {
      name: "accountingFolder",
      operation: "CREATE",
      data: {
        id: "1"
      },
      scope: {
        schemaId: 1
      },
      metadata: {
        agent: "jest",
        createdAt: Date.now()
      }
    }

    beforeAll(async() => {
      publisher = new Incomer({
        name: randomUUID(),
        eventsCast: ["accountingFolder"],
        eventsSubscribe: [],
        eventCallback: mockedEventComeBackHandler
      });

      concernedIncomer = new Incomer({
        name: randomUUID(),
        eventsCast: [],
        eventsSubscribe: [{ name: "accountingFolder" }],
        eventCallback: mockedEventComeBackHandler
      });

      secondConcernedIncomer = new Incomer({
        name: randomUUID(),
        eventsCast: [],
        eventsSubscribe: [{ name: "accountingFolder" }],
        eventCallback: mockedEventComeBackHandler
      });

      Reflect.set(concernedIncomer, "logger", incomerLogger);

      let index = 0;
      jest.spyOn(Incomer.prototype as any, "handleApprovement")
        .mockImplementation(async(message: any) => {
          const { data } = message;

          if (index === 0) {
            Reflect.set(publisher, "incomerChannelName", data.uuid);
            Reflect.set(publisher, "providedUUID", data.uuid);

            publisher["subscriber"].subscribe(data.uuid);

            Reflect.set(publisher, "incomerChannel", new Channel({
              name: data.uuid
            }));

            Reflect.set(publisher, "incomerTransactionStore", new TransactionStore({
              prefix: data.uuid,
              instance: "incomer"
            }));

            publisher.emit("registered");
          }
          else if (index === 1) {
            Reflect.set(concernedIncomer, "incomerChannelName", data.uuid);
            Reflect.set(concernedIncomer, "providedUUID", data.uuid);

            concernedIncomer["subscriber"].subscribe(data.uuid);

            Reflect.set(concernedIncomer, "incomerChannel", new Channel({
              name: data.uuid
            }));

            incomerTransactionStore = new TransactionStore({
              prefix: data.uuid,
              instance: "incomer"
            });

            mockedIncomerSetTransaction = jest.spyOn(incomerTransactionStore, "setTransaction");

            Reflect.set(concernedIncomer, "incomerTransactionStore", incomerTransactionStore);

            concernedIncomer.emit("registered");
          }
          else {
            Reflect.set(secondConcernedIncomer, "incomerChannelName", data.uuid);
            Reflect.set(secondConcernedIncomer, "providedUUID", data.uuid);

            secondConcernedIncomer["subscriber"].subscribe(data.uuid);

            Reflect.set(secondConcernedIncomer, "incomerChannel", new Channel({
              name: data.uuid
            }));

            secondIncomerTransactionStore = new TransactionStore({
              prefix: data.uuid,
              instance: "incomer"
            });

            mockedSecondIncomerSetTransaction = jest.spyOn(secondIncomerTransactionStore, "setTransaction");

            Reflect.set(secondConcernedIncomer, "incomerTransactionStore", secondIncomerTransactionStore);

            secondConcernedIncomer.emit("registered");
          }

          index++;
      });

      await publisher.initialize();
      await concernedIncomer.initialize();
      await secondConcernedIncomer.initialize();

      await timers.setTimeout(1_600);

      await publisher.publish(event);
    });

    test("callback function must have been call & incomer should have create the relating transaction", async() => {
      await timers.setTimeout(1_600);

      if (mockedIncomerSetTransaction.mock.calls.length === 1) {
        expect(mockedIncomerSetTransaction).toHaveBeenCalledWith(
          {
            ...event,
            redisMetadata: expect.anything(),
            mainTransaction: false,
            resolved: false,
            relatedTransaction: expect.anything()
          }
        );
        expect(mockedSecondIncomerSetTransaction).not.toHaveBeenCalledWith({
          ...event,
          redisMetadata: expect.anything(),
          mainTransaction: false,
          resolved: false,
          relatedTransaction: expect.anything()
        });
      }
      else {
        expect(mockedIncomerSetTransaction).not.toHaveBeenCalledWith(
          {
            ...event,
            redisMetadata: expect.anything(),
            mainTransaction: false,
            resolved: false,
            relatedTransaction: expect.anything()
          }
        );
        expect(mockedSecondIncomerSetTransaction).toHaveBeenCalledWith({
          ...event,
          redisMetadata: expect.anything(),
          mainTransaction: false,
          resolved: false,
          relatedTransaction: expect.anything()
        });
      }

      expect(mockedEventComeBackHandler).toHaveBeenCalledTimes(1);
      expect(mockedEventComeBackHandler).toHaveBeenCalledWith({
        ...event
      });
    });
  });
});


