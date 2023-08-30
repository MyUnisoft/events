// Import Node.js Dependencies
import { randomUUID } from "node:crypto";
import timers from "timers/promises";

// Import Third-party Dependencies
import {
  initRedis,
  clearAllKeys,
  closeAllRedis
} from "@myunisoft/redis";
import * as Logger from "pino";

// Import Internal Dependencies
import { Dispatcher, Incomer } from "../../../../src/index";

// Internal Dependencies Mocks
const mockedIncomerHandleDispatcherMessage = jest.spyOn(Incomer.prototype as any, "handleDispatcherMessages");

const dispatcherLogger = Logger.pino({
  level: "debug"
});
const incomerLogger = Logger.pino({
  level: "debug"
});
const mockedIncomerLoggerInfo = jest.spyOn(incomerLogger, "info");

describe("Registration", () => {
  let dispatcher: Dispatcher;
  let incomer: Incomer;

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
      pingInterval: 1_600,
      checkLastActivityInterval: 4_000,
      checkTransactionInterval: 2_400,
      idleTime: 4_000
     });

    await dispatcher.initialize();
  });

  afterAll(async() => {
    dispatcher.close();
    await closeAllRedis();
  });

  afterEach(async() => {
    await clearAllKeys();
  });

  describe("Initializing consecutively the same Incomer", () => {
    const eventComeBackHandler = () => void 0;

    afterAll(async() => {
      await incomer.close();
    });

    beforeAll(async() => {
      incomer = new Incomer({
        name: "foo",
        logger: incomerLogger,
        eventsCast: [],
        eventsSubscribe: [],
        eventCallback: eventComeBackHandler
      });

      await incomer.initialize();
    });

    it("Should correctly register the new incomer", async() => {
      await timers.setTimeout(1_600);

      expect(mockedIncomerHandleDispatcherMessage).toHaveBeenCalled();
      expect(mockedIncomerLoggerInfo.mock.calls[2][0]).toContain("Incomer registered");
    });

    test("Calling Incomer initialize a second time, it should fail", async() => {
      expect.assertions(1);

      try {
        await incomer.initialize()
      }
      catch (error) {
        expect(error.message).toBe("Cannot init multiple times.");
      }
    });
  });

  describe("Initializing a new Incomer", () => {
    const eventComeBackHandler = () => void 0;

    afterAll(async() => {
      await incomer.close();
    })

    beforeAll(async() => {
      incomer = new Incomer({
        name: randomUUID(),
        eventsCast: [],
        eventsSubscribe: [],
        eventCallback: eventComeBackHandler
      });

      Reflect.set(incomer, "logger", incomerLogger);

      await incomer.initialize();
    });

    it("Should correctly register the new incomer", async() => {
      await timers.setTimeout(1_600);

      expect(mockedIncomerHandleDispatcherMessage).toHaveBeenCalled();
      expect(mockedIncomerLoggerInfo.mock.calls[2][0]).toContain("Incomer registered");
    });
  });
});


