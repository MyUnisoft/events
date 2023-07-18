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

beforeAll(async() => {
  await initRedis({
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST
  });

  await initRedis({
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST
  }, "subscriber");
});

afterAll(async() => {
  await closeAllRedis();
});

describe("Init Incomer without Dispatcher alive & prefix as \"development\" | \"test\"", () => {
  const eventComeBackHandler = async(message) => {
    console.log(message);
  }

  describe("With externalsInitialized at true", () => {
    const incomer: Incomer = new Incomer({
      name: randomUUID(),
      prefix: "test",
      logger: incomerLogger,
      eventsCast: ["accountingFolder"],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler,
      abortRegistrationTime: 5_000,
      externalsInitialized: true
    });

    test("it should init", async() => {
      await incomer.initialize();

      expect(incomer.externals).not.toBeDefined();
    });

    afterAll(async() => {
      await incomer.close();
    });
  });

  describe("Prefix as \"development\"", () => {
    const incomer: Incomer = new Incomer({
      name: randomUUID(),
      prefix: "development",
      logger: incomerLogger,
      eventsCast: ["accountingFolder"],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler,
      abortRegistrationTime: 5_000
    });

    test("it should init", async() => {
      await incomer.initialize();

      expect(incomer.externals).toBeDefined();
    });

    afterAll(async() => {
      await incomer.close();
    });
  });

  describe("Prefix as \"test\"", () => {
    const incomer: Incomer = new Incomer({
      name: randomUUID(),
      prefix: "test",
      logger: incomerLogger,
      eventsCast: ["accountingFolder"],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler,
      abortRegistrationTime: 5_000
    });

    test("it should init", async() => {
      await incomer.initialize();

      expect(incomer.externals).toBeDefined();
    });

    afterAll(async() => {
      await incomer.close();
    });
  });
});


