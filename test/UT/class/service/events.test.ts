// Import Node.js Dependencies
import assert from "node:assert";
import { describe, after, before, test } from "node:test";
import timers from "node:timers/promises";

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
const kPingInterval = 500;
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
    name: "foo",
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
    test("should return an array of Registered Incomers including the relative dispatcher instance", async() => {
      const incomers = await dispatcher.eventsService.getIncomers();

      assert.equal([...incomers.values()].length, 1);
      assert.equal([...incomers.values()][0].isDispatcherActiveInstance, "true");
    });
  });

  describe("forceDispatcherTakeLead", () => {
    test("Calling forceDispatcherTakeLead as the only dispatcher, it should stay alive", async() => {
      let incomers = await dispatcher.eventsService.getIncomers();

      dispatcher.eventsService.forceDispatcherTakeLead(incomers, incomers[0]);

      await timers.setTimeout(2_000);

      incomers = await dispatcher.eventsService.getIncomers();

      assert.equal([...incomers.values()][0].isDispatcherActiveInstance, "true");
    });

    describe("Working with a second dispatcher", () => {
      const secondIncomer = new Incomer({
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

      const secondDispatcher = new Dispatcher({
        redis,
        name: "foo",
        subscriber,
        logger,
        pingInterval: kPingInterval,
        checkLastActivityInterval: 5_000,
        checkTransactionInterval: 2_400,
        idleTime: 5_000,
        incomerUUID: secondIncomer.baseUUID
      });

      before(async() => {
        await secondDispatcher.initialize();
        await secondIncomer.initialize();
      });

      after(async() => {
        await secondIncomer.close();
        await secondDispatcher.close();
      });

      test("Calling forceDispatcherTakeLead with another dispatcher alive, he should take the lead", async() => {
        let incomers = await secondDispatcher.eventsService.getIncomers();

        const isLead = [...incomers.values()].find((incomer) => incomer.isDispatcherActiveInstance === "true");

        secondDispatcher.eventsService.forceDispatcherTakeLead(incomers, isLead!);

        await timers.setTimeout(5_000);

        incomers = await secondDispatcher.eventsService.getIncomers();

        console.log("FOOOOOO", incomers, secondIncomer.baseUUID);
        for (const incomer of incomers.values()) {
          if (incomer.baseUUID === secondIncomer.baseUUID) {
            assert.equal(incomer.isDispatcherActiveInstance, "true");

            continue;
          }

          assert.equal(incomer.isDispatcherActiveInstance, "false");
        }
      });
    })
  });

  describe("GetEventById", () => {
    test("foo", async() => {
      let incomers = await dispatcher.eventsService.getIncomers();

      const isLead = [...incomers.values()].find((incomer) => incomer.isDispatcherActiveInstance === "true");

      dispatcher.eventsService.forceDispatcherTakeLead(incomers, isLead!);

      await timers.setTimeout(2_000);

      incomers = await dispatcher.eventsService.getIncomers();
      console.log("incomers :", incomers);
    });
  });
});
