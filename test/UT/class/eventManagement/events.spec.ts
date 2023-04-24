// Import Node.js Dependencies
import { randomUUID } from "node:crypto";
import timers from "timers/promises";

// Import Third-party Dependencies
import {
  initRedis,
  closeRedis,
  clearAllKeys
} from "@myunisoft/redis";
import * as Logger from "pino";

// Import Internal Dependencies
import {
  Dispatcher,
  Incomer,
  eventsValidationFunction,
  EventOptions
} from "../../../../src/index";

// Internal Dependencies Mocks
const mockedIncomerHandleDispatcherMessage = jest.spyOn(Incomer.prototype as any, "handleDispatcherMessages");

const dispatcherLogger = Logger.pino();
const incomerLogger = Logger.pino();
const mockedIncomerLoggerInfo = jest.spyOn(incomerLogger, "info");
const mockedDispatcherLoggerInfo = jest.spyOn(dispatcherLogger, "info");
const mockedEventComeBackHandler = jest.fn();


describe("Publishing a custom event", () => {
  let dispatcher: Dispatcher;

  beforeAll(async() => {
    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any);

    dispatcher = new Dispatcher({
      pingInterval: 1_600,
      checkLastActivityInterval: 4_000,
      checkTransactionInterval: 2_400,
      idleTime: 4_000,
      eventsValidationFunction: eventsValidationFunction
     });

    Reflect.set(dispatcher, "logger", dispatcherLogger);

    await dispatcher.initialize();
  });

  // describe("Publishing an event without concerned Incomer", () => {
  //   let publisher: Incomer;

  //   beforeAll(async() => {
  //     publisher = new Incomer({
  //       name: randomUUID(),
  //       eventsCast: ["accountingFolder"],
  //       eventsSubscribe: [],
  //       eventCallback: eventComeBackHandler
  //     });

  //     Reflect.set(publisher, "logger", incomerLogger);

  //     await publisher.initialize();
  //   });
  // });

  describe("Publishing an event with concerned Incomer", () => {
    let publisher: Incomer;
    let concernedIncomer: Incomer;

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

      Reflect.set(concernedIncomer, "logger", incomerLogger);

      await Promise.all([
        publisher.initialize(),
        concernedIncomer.initialize()
      ]);

      await timers.setTimeout(1_600);

      await concernedIncomer.publish(event);
    });

    test("should do nothing", async() => {
      await timers.setTimeout(1_600);

      expect(mockedEventComeBackHandler).toHaveBeenCalledWith({
        ...event,
        redisMetadata: expect.anything()
      });
    });
  });

  afterAll(async() => {
    await dispatcher.close();
    await closeRedis();
  });

  afterEach(async() => {
    await clearAllKeys();
  });
});


