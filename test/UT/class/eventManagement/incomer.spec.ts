// Import Node.js Dependencies
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import {
  initRedis,
  closeAllRedis
} from "@myunisoft/redis";
import * as Logger from "pino";

// Import Internal Dependencies
import { Incomer } from "../../../../src/index";

const incomerLogger = Logger.pino({
  level: "debug"
});

describe("Init Incomer without Dispatcher alive", () => {
  const eventComeBackHandler = async(message) => {
    console.log(message);
  }

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
    } as any, "subscriber");

    incomer = new Incomer({
      name: randomUUID(),
      logger: incomerLogger,
      eventsCast: [],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler,
      abortTime: 5_000
    });
  });

  test("Incomer should not init", async() => {
    expect.assertions(1);

    try {
      await incomer.initialize();
    }
    catch (error) {
      expect(error).toBeDefined();
    }
  })

  afterAll(async() => {
    await closeAllRedis();
  });
});
