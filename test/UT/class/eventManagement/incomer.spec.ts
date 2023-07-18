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

const incomerLogger = Logger.pino({
  level: "debug"
});

describe("Init Incomer without Dispatcher alive", () => {
  const eventComeBackHandler = async(message) => {
    console.log(message);
  }

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

    incomer = new Incomer({
      name: randomUUID(),
      logger: incomerLogger,
      eventsCast: [],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler,
      abortRegistrationTime: 2_000,
      externalsInitialized: true
    });
  });

  test("Incomer should not init", async() => {
    await incomer.initialize();

    await timers.setTimeout(10_000);

    const dispatcher = new Dispatcher({});

    await dispatcher.initialize();

    await timers.setTimeout(5_000);
  })

  afterAll(async() => {
    await closeAllRedis();
  });
});
