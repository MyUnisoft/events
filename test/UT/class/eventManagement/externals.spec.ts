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

describe("Init Incomer without Dispatcher alive & prefix as \"test\"", () => {
  const eventComeBackHandler = () => void 0;

  describe("With externalsInitialized at true", () => {
    const incomer: Incomer = new Incomer({
      name: "foo",
      prefix: "test",
      logger: incomerLogger,
      eventsCast: ["accountingFolder"],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler,
      dispatcherInactivityOptions: {
        publishInterval: 5000
      },
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

  describe("Prefix as \"test\"", () => {
    const incomer: Incomer = new Incomer({
      name: "foo",
      prefix: "test",
      logger: incomerLogger,
      eventsCast: ["accountingFolder"],
      eventsSubscribe: [],
      eventCallback: eventComeBackHandler,
      dispatcherInactivityOptions: {
        publishInterval: 5000
      },
      externalsInitialized: false
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


