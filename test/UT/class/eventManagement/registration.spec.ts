// Import Node.js Dependencies
import { randomUUID } from "node:crypto";
import timers from "timers/promises";

// Import Third-party Dependencies
import {
  initRedis,
  clearAllKeys,
  closeAllRedis,
  getRedis
} from "@myunisoft/redis";
import * as Logger from "pino";

// Import Internal Dependencies
import { Dispatcher, Incomer } from "../../../../src/index";

// Internal Dependencies Mocks
const mockedIncomerHandleDispatcherMessage = jest.spyOn(Incomer.prototype as any, "handleDispatcherMessages");
const mockedIncomerRegistrationIntervalCb = jest.spyOn(Incomer.prototype as any, "registrationIntervalCb");
const mockedDispatcherRemoveNonActives = jest.spyOn(Dispatcher.prototype as any, "removeNonActives");

const dispatcherLogger = Logger.pino({
  level: "debug"
});
const incomerLogger = Logger.pino({
  level: "debug"
});
const mockedIncomerLoggerInfo = jest.spyOn(incomerLogger, "info");


describe("Registration", () => {
  beforeAll(async() => {
    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST,
      enableAutoPipelining: true
    } as any);

    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST,
      enableAutoPipelining: true
    } as any, "subscriber");
  });

  afterAll(async() => {
    await closeAllRedis();
  });

  beforeEach(async() => {
    await getRedis()!.flushall();
  });

  describe("Initializing consecutively the same Incomer", () => {
    const eventComeBackHandler = () => void 0;

    let dispatcher: Dispatcher;
    let incomer: Incomer;

    afterAll(async() => {
      await incomer.close();
      await dispatcher.close();
    });

    beforeAll(async() => {
      dispatcher = new Dispatcher({
        logger: dispatcherLogger,
        pingInterval: 1_000,
        checkLastActivityInterval: 1_000,
        checkTransactionInterval: 1_500,
        idleTime: 2_000
       });

      await dispatcher.initialize();

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

    function updateIncomerState(...args) {
      incomer["lastPingDate"] = Date.now();
      incomer["dispatcherConnectionState"] = true;
    }

    let dispatcher: Dispatcher;
    let incomer: Incomer;
    let handlePingFn: (...args: any[]) => Promise<void>;

    afterAll(async() => {
      await incomer.close();
      await dispatcher.close();
    });

    beforeAll(async() => {
      dispatcher = new Dispatcher({
        logger: dispatcherLogger,
        pingInterval: 1_000,
        checkLastActivityInterval: 1_000,
        checkTransactionInterval: 1_500,
        idleTime: 2_000
       });

      await dispatcher.initialize();

      incomer = new Incomer({
        name: "bar",
        eventsCast: [],
        eventsSubscribe: [],
        eventCallback: eventComeBackHandler,
        dispatcherInactivityOptions: {
          maxPingInterval: 2_000,
          publishInterval: 2_000
        }
      });

      handlePingFn = incomer["handlePing"];

      Reflect.set(incomer, "logger", incomerLogger);
      Reflect.set(incomer, "handlePing", updateIncomerState);

      await incomer.initialize();
    });

    it("Should correctly register the new incomer", async() => {
      await timers.setTimeout(3_000);

      expect(mockedIncomerHandleDispatcherMessage).toHaveBeenCalled();
      expect(mockedIncomerLoggerInfo.mock.calls[2][0]).toContain("Incomer registered");
      expect(mockedIncomerRegistrationIntervalCb).toHaveBeenCalledTimes(0);
    });

    it("Should have removed the incomer", async() => {
      await timers.setTimeout(4_000);

      expect(mockedDispatcherRemoveNonActives).toHaveBeenCalled();

      Reflect.set(incomer, "handlePing", handlePingFn);
    });

    it("Should have register again", async() => {
      await timers.setTimeout(2_000);
      expect(mockedIncomerRegistrationIntervalCb).toHaveBeenCalled();
      expect(incomer.dispatcherConnectionState).toBe(true);
    });
  });
});


