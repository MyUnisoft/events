// Import Node.js Dependencies
import timers from "node:timers/promises";

// Import Third-party Dependencies
import {
  RedisAdapter
} from "@myunisoft/redis";
import { Ok } from "@openally/result";

// Import Internal Dependencies
import {
  Dispatcher,
  Incomer
} from "../../../src/index.js";

// Internal Dependencies Mocks
const mockedIncomerHandleDispatcherMessage = jest.spyOn(Incomer.prototype as any, "handleDispatcherMessages");
const mockedDispatcherRemoveNonActives = jest.spyOn(Dispatcher.prototype as any, "removeNonActives");

const kIdleTime = 4_000;

describe("Init Incomer without Dispatcher alive", () => {
  const eventCallBackHandler = jest.fn().mockImplementation(() => Ok({ status: "RESOLVED" }));

  const redis = new RedisAdapter({
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST
  });
  const subscriber = new RedisAdapter({
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST
  });

  const pingInterval = 2_000;

  let incomer: Incomer;

  beforeAll(async() => {
    await redis.initialize();
    await subscriber.initialize();

    await redis.flushall();

    incomer = new Incomer({
      redis,
      subscriber,
      name: "foo",
      eventsCast: [],
      eventsSubscribe: [],
      eventCallback: eventCallBackHandler,
      dispatcherInactivityOptions: {
        publishInterval: pingInterval,
        maxPingInterval: pingInterval
      },
      externalsInitialized: true
    });
  });

  test("Incomer should init without a Dispatcher alive", async() => {
    await incomer.initialize();

    await timers.setTimeout(3_000);

    expect(incomer.dispatcherConnectionState).toBe(false);
  });

  afterAll(async() => {
    await redis.close();
    await subscriber.close();
  });
});

describe("Init Incomer with Dispatcher alive", () => {
  const eventComeBackHandler = jest.fn().mockImplementation(() => Ok({ status: "RESOLVED" }));;

  const redis = new RedisAdapter({
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST
  });
  const subscriber = new RedisAdapter({
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST
  });

  const pingInterval = 2_000;

  let incomer: Incomer;
  let dispatcherIncomer: Incomer;
  let dispatcher: Dispatcher;

  beforeAll(async() => {
    await redis.initialize();
    await subscriber.initialize();

    await redis.flushall();

    incomer = new Incomer({
      redis,
      subscriber,
      name: "foo",
      eventsCast: [],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler,
      dispatcherInactivityOptions: {
        publishInterval: pingInterval,
        maxPingInterval: pingInterval
      },
      externalsInitialized: true
    });

    dispatcherIncomer = new Incomer({
      redis,
      subscriber,
      name: "node:Pulsar",
      eventsCast: [],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler,
      dispatcherInactivityOptions: {
        publishInterval: pingInterval,
        maxPingInterval: pingInterval
      },
      isDispatcherInstance: true,
      externalsInitialized: true
    });

    dispatcher = new Dispatcher({
      redis,
      subscriber,
      pingInterval: pingInterval,
      idleTime: kIdleTime,
      incomerUUID: dispatcherIncomer.baseUUID,
      name: "node:Pulsar"
    });

    await dispatcher.initialize();

    await timers.setTimeout(2_000);
  });

  test("It should register when a Dispatcher is alive", async() => {
    await incomer.initialize();
    await dispatcherIncomer.initialize();

    expect(incomer.dispatcherConnectionState).toBe(true);
    expect(dispatcherIncomer.dispatcherConnectionState).toBe(true);
    expect(mockedIncomerHandleDispatcherMessage).toHaveBeenCalled();
  });

  test("Incomer calling close, it should remove the given Incomer", async() => {
    await incomer["incomerChannel"].pub({
      name: "CLOSE",
      redisMetadata: {
        origin: incomer["providedUUID"],
        incomerName: incomer["name"]
      }
    });

    await timers.setTimeout(1_000);

    expect(mockedDispatcherRemoveNonActives).toHaveBeenCalled();

    const incomers = await dispatcher["incomerStore"].getIncomers();

    expect([...incomers.keys()]).not.toContain(incomer["providedUUID"]);
  });

  afterAll(async() => {
    await incomer.close();
    await dispatcherIncomer.close();
    await dispatcher.close();
    await redis.close();
    await subscriber.close();
  });
});
