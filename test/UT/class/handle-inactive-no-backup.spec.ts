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
  Dispatcher,
  Incomer,
  eventsValidationFn,
  type EventOptions,
  type Events,
  validate
} from "../../../src/index.js";
import { Transaction, TransactionStore } from "../../../src/class/store/transaction.class.js";

// Internal Dependencies Mocks
const dispatcherLogger = pino({
  level: "debug"
});
const mockedEventComeBackHandler = jest.fn().mockImplementation(() => Ok({ status: "RESOLVED" }));

describe("Publishing/exploiting a custom event & inactive incomer", () => {
  let dispatcher: Dispatcher<EventOptions<keyof Events>>;

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

    dispatcher = new Dispatcher({
      redis,
      name: "foo",
      subscriber,
      logger: dispatcherLogger,
      pingInterval: 2_000,
      checkLastActivityInterval: 2_000,
      checkTransactionInterval: 60_000,
      idleTime: 5_000,
      eventsValidation: {
        eventsValidationFn,
        customValidationCbFn: validate
      }
     });

    Reflect.set(dispatcher, "logger", dispatcherLogger);

    await dispatcher.initialize();
  });

  afterAll(async() => {
    await dispatcher.close();
    await redis.close();
    await subscriber.close()
  });

  afterEach(async() => {
    jest.clearAllMocks();
    await redis.flushdb();
  });

  describe("Inactive incomer without back-up available", () => {
    let concernedIncomer: Incomer;
    let secondConcernedIncomer: Incomer;
    let firstIncomerTransactionStore: TransactionStore<"incomer">;
    let secondIncomerTransactionStore: TransactionStore<"incomer">;

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

    let handleApprovementIndex = 0;
    jest.spyOn(Incomer.prototype as any, "handleApprovement")
      .mockImplementation(async(message: any) => {
        const { data } = message;

        if (handleApprovementIndex === 0) {
          Reflect.set(concernedIncomer, "incomerChannelName", data.uuid);
          Reflect.set(concernedIncomer, "providedUUID", data.uuid);

          concernedIncomer["subscriber"]!.subscribe(data.uuid);

          Reflect.set(concernedIncomer, "incomerChannel", new Channel({
            redis,
            name: data.uuid
          }));

          firstIncomerTransactionStore = new TransactionStore({
            adapter: redis as RedisAdapter<Transaction<"incomer">>,
            prefix: data.uuid,
            instance: "incomer"
          });

          Reflect.set(concernedIncomer, "newTransactionStore", firstIncomerTransactionStore);

          concernedIncomer["lastActivity"] = Date.now();
          concernedIncomer.emit("registered");

          handleApprovementIndex++;
        }
        else {
          Reflect.set(secondConcernedIncomer, "incomerChannelName", data.uuid);
          Reflect.set(secondConcernedIncomer, "providedUUID", data.uuid);

          secondConcernedIncomer["subscriber"]!.subscribe(data.uuid);

          Reflect.set(secondConcernedIncomer, "incomerChannel", new Channel({
            redis,
            name: data.uuid
          }));

          secondIncomerTransactionStore = new TransactionStore({
            adapter: redis as RedisAdapter<Transaction<"incomer">>,
            prefix: data.uuid,
            instance: "incomer"
          });

          Reflect.set(secondConcernedIncomer, "newTransactionStore", secondIncomerTransactionStore);

          secondConcernedIncomer["lastActivity"] = Date.now();
          secondConcernedIncomer.emit("registered");
        }
      });

    beforeAll(async() => {
      concernedIncomer = new Incomer({
        redis,
        subscriber,
        name: "foo",
        eventsCast: ["accountingFolder"],
        eventsSubscribe: [{ name: "accountingFolder" }],
        eventsValidation: {
          eventsValidationFn,
          customValidationCbFn: validate
        },
        eventCallback: mockedEventComeBackHandler,
        externalsInitialized: true
      });

      jest.spyOn(concernedIncomer as any, "customEvent")
        .mockImplementation(async(opts: any) => {
          // Do nothing
        });

      secondConcernedIncomer = new Incomer({
        redis,
        subscriber,
        name: "foo",
        eventsCast: ["accountingFolder"],
        eventsSubscribe: [{ name: "accountingFolder" }],
        eventCallback: mockedEventComeBackHandler,
        externalsInitialized: true
      });

      await concernedIncomer.initialize();
    });

    test("expect the second incomer to have handle the event by retaking the main Transaction", async() => {
      const eventId = await concernedIncomer.publish(event);

      await timers.setTimeout(500);

      await secondConcernedIncomer.initialize();
      await concernedIncomer.close();

      jest.spyOn(dispatcher as any, "checkLastActivity").mockImplementation(async(opts: any) => {
        // do nothing
      });
      dispatcher["subscriber"]!.on("message", (channel, message) => dispatcher["handleMessages"](channel, message));
      secondConcernedIncomer["subscriber"]!.on("message", (channel, message) => secondConcernedIncomer["handleMessages"](channel, message));

      const incomer = [...(await dispatcher["incomerStore"].getIncomers()).values()].find((incomer) => incomer.baseUUID === concernedIncomer.baseUUID);
      await dispatcher["removeNonActives"]([incomer!]);

      await timers.setTimeout(500);

      const mainTransactions = await secondConcernedIncomer["newTransactionStore"].getTransactions();

      expect([...mainTransactions.values()]).toEqual(expect.arrayContaining([
        expect.objectContaining({
          ...event,
          redisMetadata: {
            origin: expect.anything(),
            eventTransactionId: eventId,
            transactionId: expect.anything(),
            incomerName: concernedIncomer.name,
            mainTransaction: true,
            published: true,
            relatedTransaction: expect.anything(),
            resolved: false
          }
        })
      ]));

      await secondConcernedIncomer.close();
    });
  });
});

