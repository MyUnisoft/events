// Import Node.js Dependencies
import { randomUUID } from "node:crypto";
import timers from "timers/promises";

// Import Third-party Dependencies
import {
  initRedis,
  clearAllKeys,
  Channel,
  closeAllRedis
} from "@myunisoft/redis";
import * as Logger from "pino";

// Import Internal Dependencies
import {
  Dispatcher,
  Incomer,
  eventsValidationFn,
  EventOptions,
  Events,
  validate
} from "../../../../src/index";
import { TransactionStore } from "../../../../src/class/eventManagement/transaction.class";

// Internal Dependencies Mocks
const dispatcherLogger = Logger.pino({
  level: "debug"
});
const incomerLogger = Logger.pino({
  level: "debug"
});
const mockedEventComeBackHandler = jest.fn();

describe("Publishing/exploiting a custom event & inactive incomer", () => {
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
      name: "pulsar",
      logger: dispatcherLogger,
      pingInterval: 10_000,
      checkLastActivityInterval: 2_600,
      checkTransactionInterval: 10_000,
      idleTime: 3_000,
      eventsValidation: {
        eventsValidationFn,
        validationCbFn: validate
      }
     });

    Reflect.set(dispatcher, "logger", dispatcherLogger);

    await dispatcher.initialize();
  });

  afterAll(async() => {
    dispatcher.close();
    await closeAllRedis();
  });

  afterEach(async() => {
    jest.clearAllMocks();
    await clearAllKeys();
  });

  describe("Inactive incomer with back-up available", () => {
    let publisher: Incomer;
    let concernedIncomer: Incomer;
    let secondConcernedIncomer: Incomer;
    let publisherTransactionStore: TransactionStore<"incomer">;
    let firstIncomerTransactionStore: TransactionStore<"incomer">;
    let secondIncomerTransactionStore: TransactionStore<"incomer">;
    let mockedPublisherSetTransaction;
    let eventHasBeenDeal;

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

    let handleApprovementIndex = 0;
    jest.spyOn(Incomer.prototype as any, "handleApprovement")
      .mockImplementation(async(message: any) => {
        const { data } = message;

        if (handleApprovementIndex === 0) {
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
        else if (handleApprovementIndex === 1) {
          Reflect.set(concernedIncomer, "incomerChannelName", data.uuid);
          Reflect.set(concernedIncomer, "providedUUID", data.uuid);

          concernedIncomer["subscriber"].subscribe(data.uuid);

          Reflect.set(concernedIncomer, "incomerChannel", new Channel({
            name: data.uuid
          }));

          firstIncomerTransactionStore = new TransactionStore({
            prefix: data.uuid,
            instance: "incomer"
          });

          Reflect.set(concernedIncomer, "incomerTransactionStore", firstIncomerTransactionStore);

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

          Reflect.set(secondConcernedIncomer, "incomerTransactionStore", secondIncomerTransactionStore);

          secondConcernedIncomer.emit("registered");
        }

        handleApprovementIndex++;
      });

    let handleIncomerMessagesIndex = 0;
    jest.spyOn(Incomer.prototype as any, "handleIncomerMessages")
      .mockImplementation(async(message: any) => {
        if (message.name === "ping") {
          return eventHasBeenDeal;
        }

        if (handleIncomerMessagesIndex === 0) {
          eventHasBeenDeal = false;
        }
        else {
          eventHasBeenDeal = true;
        }

        handleIncomerMessagesIndex++;

        return eventHasBeenDeal;
      });

    beforeAll(async() => {
      publisher = new Incomer({
        name: randomUUID(),
        eventsCast: ["accountingFolder"],
        eventsSubscribe: [],
        eventCallback: mockedEventComeBackHandler
      });

      concernedIncomer = new Incomer({
        name: randomUUID(),
        logger: incomerLogger,
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

      await publisher.initialize();
      await concernedIncomer.initialize();

      await timers.setTimeout(1_600);

      await publisher.publish(event);

      await timers.setTimeout(1_600);
    });

    test("event must have been share two times & dealed only once by the second incomer when the first one become inactive", async() => {
      await secondConcernedIncomer.initialize();
      await timers.setTimeout(1_600);

      expect(mockedPublisherSetTransaction).toHaveBeenCalledWith({
        ...event,
        redisMetadata: expect.anything(),
        published: true,
        mainTransaction: true,
        resolved: false,
        relatedTransaction: null
      });

      expect(eventHasBeenDeal).toBe(false);

      await timers.setTimeout(2_000);

      expect(eventHasBeenDeal).toBe(true);
    });
  });
});
