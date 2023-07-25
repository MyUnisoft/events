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
  const eventComeBackHandler = async(message) => {
    console.log(message);
  }

  let incomer: Incomer;
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
      name: randomUUID(),
      logger: incomerLogger,
      eventsCast: [],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler,
      abortPublishTime: 2_000,
      externalsInitialized: true
    });

    dispatcher = new Dispatcher();
  });

  test("Incomer should init with or without a Dispatcher", async() => {
    await incomer.initialize();

    await timers.setTimeout(5_000);

    await dispatcher.initialize();

    await timers.setTimeout(5_000);

    expect(mockedIncomerHandleDispatcherMessage).toHaveBeenCalled();
  })

  afterAll(async() => {
    dispatcher.close();
    await incomer.close();
    await closeAllRedis();
  });
});
