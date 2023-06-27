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
const mockedDispatcherLoggerInfo = jest.spyOn(dispatcherLogger, "info");

describe("Ping", () => {
  const eventComeBackHandler = async(message) => {
    console.log(message);
  }

  let dispatcher: Dispatcher;
  let incomer: Incomer;
  let subscriber;

  beforeAll(async() => {
    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any);

    subscriber = await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any, true);

    dispatcher = new Dispatcher({
      pingInterval: 1_600,
      checkLastActivityInterval: 4_000,
      checkTransactionInterval: 2_400,
      idleTime: 4_000
     }, subscriber);

    Reflect.set(dispatcher, "logger", dispatcherLogger);

    await dispatcher.initialize();

    incomer = new Incomer({
      name: randomUUID(),
      eventsCast: [],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler
    }, subscriber);

    Reflect.set(incomer, "logger", incomerLogger);

    await incomer.initialize();

    await timers.setTimeout(2_000)
  });

  afterAll(async() => {
    await dispatcher.close();
    await closeRedis();
    await closeRedis(subscriber);
  });

  afterEach(async() => {
    await clearAllKeys();
  });

  test("Dispatcher should have ping", () => {
    expect(mockedDispatcherLoggerInfo).toHaveBeenNthCalledWith(3, expect.anything(), "New Ping event");
  });

  test("Incomer should have create a transaction to resolve the ping", async() => {
    expect(mockedIncomerLoggerInfo).toHaveBeenNthCalledWith(4, expect.anything(), "Resolved Ping event");
  });
});


