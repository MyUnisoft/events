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
import { Dispatcher, Incomer } from "../../../../src/index";

// Internal Dependencies Mocks
const mockedIncomerHandleDispatcherMessage = jest.spyOn(Incomer.prototype as any, "handleDispatcherMessages");

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
const mockedIncomerLoggerInfo = jest.spyOn(incomerLogger, "info");

describe("Registration", () => {
  let dispatcher: Dispatcher;
  let incomer: Incomer;

  beforeAll(async() => {
    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any);

    dispatcher = new Dispatcher({
      pingInterval: 1_600,
      checkLastActivityInterval: 4_000,
      checkTransactionInterval: 2_400,
      idleTime: 4_000
     });

    Reflect.set(dispatcher, "logger", dispatcherLogger);

    await dispatcher.initialize();
  });

  afterAll(async() => {
    await dispatcher.close();
    await closeRedis();
  });

  afterEach(async() => {
    await clearAllKeys();
  });

  describe("Initializing consecutively the same Incomer", () => {
    const eventComeBackHandler = async(message) => {
      console.log(message);
    }

    beforeAll(async() => {
      incomer = new Incomer({
        name: "foo",
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
      expect(mockedIncomerLoggerInfo).toHaveBeenNthCalledWith(3, expect.anything(), "Incomer registered");
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
    const eventComeBackHandler = async(message) => {
      console.log(message);
    }

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
      expect(mockedIncomerLoggerInfo).toHaveBeenNthCalledWith(3, expect.anything(), "Incomer registered");
    });
  });
});


