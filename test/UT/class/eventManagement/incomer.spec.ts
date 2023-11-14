// Import Node.js Dependencies
import timers from "node:timers/promises";

// Import Third-party Dependencies
import {
  initRedis,
  closeAllRedis
} from "@myunisoft/redis";

// Import Internal Dependencies
import { Dispatcher, Incomer } from "../../../../src/index";

// Internal Dependencies Mocks
const mockedIncomerHandleDispatcherMessage = jest.spyOn(Incomer.prototype as any, "handleDispatcherMessages");

const kIdleTime = 4_000;

describe("Init Incomer without Dispatcher alive", () => {
  const eventComeBackHandler = () => void 0;

  const pingInterval = 2_000;

  let incomer: Incomer;
  let dispatcherIncomer: Incomer;
  let dispatcher: Dispatcher | undefined;

  beforeAll(async() => {
    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any);

    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any, "subscriber");

    incomer = new Incomer({
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
      pingInterval: pingInterval,
      idleTime: kIdleTime,
      incomerUUID: dispatcherIncomer.baseUUID,
      instanceName: "node:Pulsar"
    });
  });

  test("Incomer should init without a Dispatcher alive", async() => {
    await incomer.initialize();
    await dispatcherIncomer.initialize();

    await timers.setTimeout(3_000);

    expect(incomer.dispatcherIsAlive).toBe(false);
    expect(dispatcherIncomer.dispatcherIsAlive).toBe(false);
  });

  test("It should register when a Dispatcher is alive", async() => {
    await dispatcher!.initialize();

    await timers.setTimeout(5_000);

    expect(incomer.dispatcherIsAlive).toBe(true);
    expect(dispatcherIncomer.dispatcherIsAlive).toBe(true);
    expect(mockedIncomerHandleDispatcherMessage).toHaveBeenCalled();
  })

  test(`It should set the dispatcher state at false when there is not Dispatcher sending ping`, async() =>
  {
    await dispatcher!.close();
    await dispatcherIncomer.close();

    incomer["subscriber"]!.subscribe(incomer["dispatcherChannelName"], incomer["incomerChannelName"]);
    incomer["subscriber"]!.on("message", (channel: string, message: string) => incomer["handleMessages"](channel, message));

    await timers.setTimeout(pingInterval * 2);

    expect(incomer.dispatcherIsAlive).toBe(false);
  });

  test("It should set the dispatcher state at true when there is a Dispatcher sending ping", async() => {
    await timers.setTimeout(kIdleTime + pingInterval);

    const secondDispatcherIncomer = new Incomer({
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

    const secondDispatcher = new Dispatcher({
      instanceName: "node:Pulsar",
      idleTime: kIdleTime,
      checkLastActivityInterval: 60_000 * 1,
      pingInterval: pingInterval,
      checkTransactionInterval: 60_000 * 1,
      incomerUUID: secondDispatcherIncomer.baseUUID
    });

    await secondDispatcher.initialize();
    await secondDispatcherIncomer.initialize();

    await timers.setTimeout(10_000);

    expect(secondDispatcherIncomer.dispatcherIsAlive).toBe(true);
    expect(incomer.dispatcherIsAlive).toBe(true);

    await secondDispatcher.close();
    await secondDispatcherIncomer.close();
  });

  afterAll(async() => {
    setImmediate(async() => {
      await dispatcherIncomer.close();
      await incomer.close();
      await closeAllRedis();
    });
  });
});
