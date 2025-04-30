// Import Node.js Dependencies
import assert from "node:assert";
import { describe, after, before, test } from "node:test";

// Import Third-party Dependencies
import { RedisAdapter } from "@myunisoft/redis";
import { Ok } from "@openally/result";
import pino from "pino";

// Import Internal Dependencies
import { Dispatcher, Incomer } from "../../../../src";

// Internal Dependencies Mocks
const logger = pino({
  level: "debug"
});

// CONSTANTS
const kPingInterval = 1_600;
const resolved = "RESOLVED" as const;

describe("EventsService", () => {
  const eventCallBackHandler = async () => Ok({ status: resolved });

  const redis = new RedisAdapter({
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST
  });

  const subscriber = new RedisAdapter({
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST
  });

  const incomer = new Incomer({
    redis,
    subscriber,
    name: "foo",
    eventsCast: [],
    eventsSubscribe: [],
    eventCallback: eventCallBackHandler,
    dispatcherInactivityOptions: {
      publishInterval: kPingInterval,
      maxPingInterval: kPingInterval
    },
    externalsInitialized: true
  });

  const dispatcher = new Dispatcher({
    redis,
    subscriber,
    logger,
    pingInterval: kPingInterval,
    checkLastActivityInterval: 5_000,
    checkTransactionInterval: 2_400,
    idleTime: 5_000,
    incomerUUID: incomer.baseUUID
  });


  before(async() => {
    await redis.initialize();
    await subscriber.initialize();
    await redis.flushall();

    await dispatcher.initialize();
    await incomer.initialize();
  });

  after(async() => {
    await incomer.close();
    await dispatcher.close();

    await subscriber.close();
    await redis.close();
  });

  describe("getIncomers", () => {
    it("should return an array of Registered Incomers including the relative dispatcher instance", async() => {
      const incomers = await dispatcher.eventsService.getIncomers();

      assert.equal(incomers.length, 1);
      assert.equal(incomers[0].isDispatcherActiveInstance, "true");
    });
  });
});
