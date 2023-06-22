// Import Node.js Dependencies
import { randomUUID } from "node:crypto";
import timers from "node:timers/promises";

// Import Third-party Dependencies
import {
  initRedis,
  closeRedis,
  clearAllKeys
} from "@myunisoft/redis";
import * as Logger from "pino";

// Import Internal Dependencies
import { Incomer } from "../../../../src/index";

const incomerLogger = Logger.pino({
  level: "debug",
  transport: {
    target: "pino-pretty"
  }
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

    incomer = new Incomer({
      name: randomUUID(),
      eventsCast: [],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler,
      abortTime: 5_000
    });

    Reflect.set(incomer, "logger", incomerLogger);
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
    await closeRedis();
  });
});
