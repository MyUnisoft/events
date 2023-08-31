// Import Node.js Dependencies
import { randomUUID } from "node:crypto";
import timers from "timers/promises";

// Import Third-party Dependencies
import {
  initRedis,
  clearAllKeys,
  closeAllRedis
} from "@myunisoft/redis";
import * as Logger from "pino";

// Import Internal Dependencies
import { Dispatcher, Incomer } from "../../../../src/index";

const dispatcherLogger = Logger.pino({
  level: "debug"
});
const incomerLogger = Logger.pino({
  level: "debug"
});
const mockedIncomerLoggerInfo = jest.spyOn(incomerLogger, "info");

describe("Ping", () => {
  const eventComeBackHandler = () => void 0;

  let dispatcher: Dispatcher;
  let incomer: Incomer;

  beforeAll(async() => {
    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any);

    await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any, "subscriber");

    dispatcher = new Dispatcher({
      name: "pulsar",
      logger: dispatcherLogger,
      pingInterval: 1_600,
      checkLastActivityInterval: 4_000,
      checkTransactionInterval: 2_400,
      idleTime: 4_000
     });

    Reflect.set(dispatcher, "logger", dispatcherLogger);

    await dispatcher.initialize();

    incomer = new Incomer({
      name: randomUUID(),
      logger: incomerLogger,
      eventsCast: [],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler
    });

    await incomer.initialize();

    await timers.setTimeout(2_000)
  });

  afterAll(async() => {
    dispatcher.close();
    await incomer.close();
    await closeAllRedis();
  });

  afterEach(async() => {
    await clearAllKeys();
  });

  test("Dispatcher should have ping", () => {
    expect(mockedIncomerLoggerInfo.mock.calls[3][1]).toContain("Resolved Ping event");
  });

  test("Incomer should have create a transaction to resolve the ping", async() => {
    expect(mockedIncomerLoggerInfo.mock.calls[3][1]).toContain("Resolved Ping event");
  });
});


