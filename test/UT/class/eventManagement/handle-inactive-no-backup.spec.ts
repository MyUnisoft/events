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
  eventsValidationFn,
  EventOptions,
  Events,
  validate
} from "../../../../src/index";
import { TransactionStore } from "../../../../src/class/eventManagement/transaction.class";

// Internal Dependencies Mocks
const dispatcherLogger = Logger.pino({
  level: "debug",
  transport: {
    target: "pino-pretty"
  }
});
const incomerLogger = Logger.pino({
  level: "debug",
  transport: {
    target: "pino-pretty"
  }
});
const mockedEventComeBackHandler = jest.fn();

describe("Publishing/exploiting a custom event & inactive incomer", () => {
  let dispatcher: Dispatcher<EventOptions<keyof Events>>;
  let backupIncomerTransactionStore;
  let mockedBackedUpSetTransaction;

  beforeAll(async() => {
    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any);

    dispatcher = new Dispatcher({
      pingInterval: 10_000,
      checkLastActivityInterval: 2_600,
      checkTransactionInterval: 6_500,
      idleTime: 3_000,
      eventsValidation: {
        eventsValidationFn,
        validationCbFn: validate
      }
     });

    backupIncomerTransactionStore = new TransactionStore({
      prefix: "backup",
      instance: "incomer"
    });

    mockedBackedUpSetTransaction = jest.spyOn(backupIncomerTransactionStore, "setTransaction");

    Reflect.set(dispatcher, "backupIncomerTransactionStore", backupIncomerTransactionStore);
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

  describe("Inactive incomer with back-up available", () => {
    let publisher: Incomer;
    let secondPublisher: Incomer;
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
        else if (handleApprovementIndex === 2) {
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
        else {
          Reflect.set(secondPublisher, "incomerChannelName", data.uuid);
          Reflect.set(secondPublisher, "providedUUID", data.uuid);

          secondPublisher["subscriber"].subscribe(data.uuid);

          Reflect.set(secondPublisher, "incomerChannel", new Channel({
            name: data.uuid
          }));

          const secondPublisherTransactionStore = new TransactionStore({
            prefix: data.uuid,
            instance: "incomer"
          });

          Reflect.set(secondPublisher, "incomerTransactionStore", secondPublisherTransactionStore);

          secondPublisher.emit("registered");
        }

        handleApprovementIndex++;
      });

    let handleIncomerMessagesIndex = 0;
    jest.spyOn(Incomer.prototype as any, "handleIncomerMessages")
      .mockImplementation(async(channel, message: any) => {
        if (message.name === "ping") {
          return eventHasBeenDeal;
        }

        if (handleIncomerMessagesIndex === 0) {
          eventHasBeenDeal = false;

          await firstIncomerTransactionStore.setTransaction({
            ...message,
            mainTransaction: false,
            relatedTransaction: message.redisMetadata.transactionId,
            resolved: false,
          });
        }
        else {
          eventHasBeenDeal = true;

          await secondIncomerTransactionStore.setTransaction({
            ...message,
            mainTransaction: false,
            relatedTransaction: message.redisMetadata.transactionId,
            resolved: true,
          });
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

      secondPublisher = new Incomer({
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

      await publisher.initialize();
      await concernedIncomer.initialize();

      await timers.setTimeout(1_600);

      await publisher.publish(event);

      await timers.setTimeout(1_600);
    });

    test("event must have been share only once & backedUp", async() => {
      expect(mockedPublisherSetTransaction).toHaveBeenCalledWith({
        ...event,
        redisMetadata: expect.anything(),
        mainTransaction: true,
        resolved: false,
        relatedTransaction: null
      });

      expect(eventHasBeenDeal).toBe(false);

      await timers.setTimeout(2_000);

      expect(mockedBackedUpSetTransaction).toHaveBeenCalledTimes(2);
      expect(mockedBackedUpSetTransaction).toHaveBeenCalledWith({
        ...event,
        redisMetadata: expect.anything(),
        aliveSince: expect.anything(),
        mainTransaction: true,
        relatedTransaction: null,
        resolved: false
      });
      expect(eventHasBeenDeal).toBe(false);

      Reflect.set(dispatcher, "idleTime", 10_000);
      await secondConcernedIncomer.initialize();
      await secondPublisher.initialize();
      await timers.setTimeout(1_500);

      const backupIncomerTransactions = await backupIncomerTransactionStore.getTransactions();

      expect(eventHasBeenDeal).toBe(true);
      expect([...backupIncomerTransactions.entries()].length).toBe(0);
    });
  });
});
