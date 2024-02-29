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
import { Dispatcher, EventOptions, Incomer } from "../../../../src/index";

// Internal Dependencies Mocks
const mockedIncomerHandleDispatcherMessage = jest.spyOn(Incomer.prototype as any, "handleDispatcherMessages");
const mockedIncomerRegistrationIntervalCb = jest.spyOn(Incomer.prototype as any, "registrationIntervalCb");
const mockedDispatcherRemoveNonActives = jest.spyOn(Dispatcher.prototype as any, "removeNonActives");
const mockedIncomerHandleApprovement = jest.spyOn(Incomer.prototype as any, "handleApprovement");

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

  function updateIncomerState(...args) {
    incomer["lastPingDate"] = Date.now();
    incomer["dispatcherConnectionState"] = true;
  }

  beforeAll(async() => {
    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any);

    await getRedis()!.flushall();

    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any, "subscriber");

    dispatcher = new Dispatcher({
      logger: dispatcherLogger,
      pingInterval: 1_000,
      checkLastActivityInterval: 1_000,
      checkTransactionInterval: 1_500,
      idleTime: 2_000
     });

    await dispatcher.initialize();
  });

  afterAll(async() => {
    await dispatcher.close();
    await closeAllRedis();
  });

  afterEach(async() => {
    await clearAllKeys();
  });

  describe("Initializing a new Incomer", () => {
    let handlePingFn: (...any) => any;
    let incomerProvidedUUID: string;

    const eventComeBackHandler = () => void 0;

    afterAll(async() => {
      await incomer.close();
    });

    beforeAll(async() => {
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
      expect(mockedIncomerHandleApprovement).toHaveBeenCalledTimes(1);
      expect(mockedIncomerRegistrationIntervalCb).toHaveBeenCalledTimes(0);
      expect(incomer["providedUUID"]).toBeDefined();

      incomerProvidedUUID = incomer["providedUUID"];
    });

    it("Should have removed the incomer", async() => {
      await timers.setTimeout(4_000);

      expect(mockedDispatcherRemoveNonActives).toHaveBeenCalled();

      Reflect.set(incomer, "handlePing", handlePingFn);
      expect(incomer.dispatcherConnectionState).toBe(false);
      await incomer.publish(event);

      const incomerTransactions = await incomer["newTransactionStore"].getTransactions();

      expect([...incomerTransactions.values()]).toContainEqual(expect.objectContaining({
        name: event.name
      }));
    });

    it("Should have register again & handle the unpublished event", async() => {
      await timers.setTimeout(2_000);
      expect(mockedIncomerRegistrationIntervalCb).toHaveBeenCalled();
      expect(incomer.dispatcherConnectionState).toBe(true);
      await timers.setTimeout(2_000);

      expect(mockedIncomerHandleApprovement).toHaveBeenCalledTimes(2);
      expect(incomer["providedUUID"]).toBe(incomerProvidedUUID);

      const incomerTransactions = await incomer["newTransactionStore"].getTransactions();

      expect([...incomerTransactions.values()]).not.toContainEqual(expect.objectContaining({
        name: event.name
      }));
    });
  });
});


