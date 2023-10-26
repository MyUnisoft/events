// Import Node.js Dependencies
import { randomUUID } from "node:crypto";
import timers from "node:timers/promises";

// Import Third-party Dependencies
import {
  initRedis,
  closeAllRedis
} from "@myunisoft/redis";
import * as Logger from "pino";

// Import Internal Dependencies
import { Dispatcher, Incomer } from "../../../../src/index";

// Internal Dependencies Mocks
const mockedIncomerHandleDispatcherMessage = jest.spyOn(Incomer.prototype as any, "handleDispatcherMessages");

const incomerLogger = Logger.pino({
  level: "debug"
});

describe("Init Incomer without Dispatcher alive", () => {
  const eventComeBackHandler = () => void 0;

  let incomer: Incomer;
  let dispatcherIncomer: Incomer;
  let dispatcher: Dispatcher;

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
      logger: incomerLogger,
      eventsCast: [],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler,
      dispatcherInactivityOptions: {
        publishInterval: 2_000,
        maxPingInterval: 2_000
      },
      externalsInitialized: true
    });

    dispatcherIncomer = new Incomer({
      name: "node:Pulsar",
      logger: incomerLogger,
      eventsCast: [],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler,
      dispatcherInactivityOptions: {
        publishInterval: 2_000,
        maxPingInterval: 2_000
      },
      isDispatcherInstance: true,
      externalsInitialized: true
    });

    dispatcher = new Dispatcher({
      pingInterval: 2_000,
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
    await dispatcher.initialize();

    await timers.setTimeout(3_000);

    expect(incomer.dispatcherIsAlive).toBe(true);
    expect(dispatcherIncomer.dispatcherIsAlive).toBe(true);
    expect(mockedIncomerHandleDispatcherMessage).toHaveBeenCalled();
  })

  test(`It should set the dispatcher state at false when there is not Dispatcher sending ping`, async() =>
  {
    await dispatcher.close();
    await dispatcherIncomer.close();

    await timers.setTimeout(5_000);

    expect(incomer.dispatcherIsAlive).toBe(false);
  });

  test("It should set the dispatcher state at true when there is a Dispatcher sending ping", async() => {
    const idleTime = 2_000;

    await timers.setTimeout(idleTime);

    const secondDispatcherIncomer = new Incomer({
      name: "node:Pulsar",
      logger: incomerLogger,
      eventsCast: [],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler,
      dispatcherInactivityOptions: {
        publishInterval: 2_000,
        maxPingInterval: 2_000
      },
      isDispatcherInstance: true,
      externalsInitialized: true
    });

    const secondDispatcher = new Dispatcher({
      instanceName: "node:Pulsar",
      idleTime: idleTime,
      checkLastActivityInterval: 60_000 * 1,
      pingInterval: 60_000 * 2,
      checkTransactionInterval: 60_000 * 1,
      incomerUUID: secondDispatcherIncomer.baseUUID
    });

    await secondDispatcher.initialize();
    await secondDispatcherIncomer.initialize();

    await timers.setTimeout(1_000);

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
