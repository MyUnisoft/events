// Import Node.js Dependencies
import timers from "node:timers/promises";

// Import Third-party Dependencies
import {
  RedisAdapter
} from "@myunisoft/redis";
import { pino } from "pino";
import { Ok } from "@openally/result";

// Import Internal Dependencies
import {
  Dispatcher,
  Incomer,
  type EventOptions
} from "../../../src/index.js";

// Internal Dependencies Mocks
const mockedIncomerHandleDispatcherMessage = jest.spyOn(Incomer.prototype as any, "handleDispatcherMessages");
const mockedDispatcherRemoveNonActives = jest.spyOn(Dispatcher.prototype as any, "removeNonActives");
const mockedIncomerHandleApprovement = jest.spyOn(Incomer.prototype as any, "handleApprovement");

// CONSTANTS
const dispatcherLogger = pino({
  level: "debug"
});
const incomerLogger = pino({
  level: "debug"
});
const mockedIncomerLoggerInfo = jest.spyOn(incomerLogger, "info");
const kPingInterval = 1_000;
const kCheckLastActivityInterval = 1_000;
const kCheckTransactionInterval = 1_500;
const kIdleTime = 2_000;

describe("Registration", () => {
  const redis = new RedisAdapter({
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST
  });
  const subscriber = new RedisAdapter({
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST
  });

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
    await redis.initialize();
    await subscriber.initialize();

    await redis.flushall();

    dispatcher = new Dispatcher({
      redis,
      name: "foo",
      subscriber,
      logger: dispatcherLogger,
      pingInterval: kPingInterval,
      checkLastActivityInterval: kCheckLastActivityInterval,
      checkTransactionInterval: kCheckTransactionInterval,
      idleTime: kIdleTime
     });

    await dispatcher.initialize();
  });

  afterAll(async() => {
    await dispatcher.close();
    await redis.close();
    await subscriber.close();
  });

  describe("Initializing a new Incomer", () => {
    let handlePingFn: (...any) => any;
    let incomerProvidedUUID: string;
    let callLength;

    const eventComeBackHandler = jest.fn().mockImplementation(() => Ok({ status: "RESOLVED" }));

    afterAll(async() => {
      await incomer.close();
    });

    beforeAll(async() => {
      incomer = new Incomer({
        redis,
        subscriber,
        name: "bar",
        eventsCast: [],
        eventsSubscribe: [],
        eventCallback: eventComeBackHandler,
        dispatcherInactivityOptions: {
          maxPingInterval: kPingInterval,
          publishInterval: kCheckTransactionInterval,
          idleTime: 10_000
        },
        externalsInitialized: true
      });

      handlePingFn = incomer["handlePing"];

      Reflect.set(incomer, "logger", incomerLogger);
      Reflect.set(incomer, "handlePing", updateIncomerState);

      await incomer.initialize();
    });

    it("Should correctly register the new incomer", async() => {
      await timers.setTimeout(3_000);

      callLength = mockedIncomerHandleApprovement.mock.calls.length;

      expect(mockedIncomerHandleDispatcherMessage).toHaveBeenCalled();
      expect(mockedIncomerLoggerInfo.mock.calls[2][0]).toContain("Incomer registered");
      expect(callLength).toBeGreaterThan(0);
      expect(incomer["providedUUID"]).toBeDefined();

      incomerProvidedUUID = incomer["providedUUID"];
    });

    it("Should have removed the incomer", async() => {
      await timers.setTimeout(kIdleTime + 1_000);

      expect(mockedDispatcherRemoveNonActives).toHaveBeenCalled();

      Reflect.set(incomer, "handlePing", handlePingFn);

      await timers.setTimeout(10_000);

      expect(incomer.dispatcherConnectionState).toBe(false);

      await incomer.publish(event);

      const incomerTransactions = await incomer["newTransactionStore"].getTransactions();

      expect([...incomerTransactions.values()]).toContainEqual(expect.objectContaining({
        name: event.name
      }));
    });

    it("Should have register again & handle the unpublished event", async() => {
      await timers.setTimeout(5_000);

      expect(incomer.dispatcherConnectionState).toBe(true);

      await timers.setTimeout(kCheckTransactionInterval + 1_000);

      expect(mockedIncomerHandleApprovement.mock.calls.length).toBeGreaterThan(callLength)
      expect(incomer["providedUUID"]).toBe(incomerProvidedUUID);

      const incomerTransactions = await incomer["newTransactionStore"].getTransactions();

      expect([...incomerTransactions.values()]).not.toContainEqual(expect.objectContaining({
        name: event.name
      }));
    });
  });
});


