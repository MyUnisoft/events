// Import Third-party Dependencies
import {
  initRedis,
  closeAllRedis,
  getRedis
} from "@myunisoft/redis";
import * as Logger from "pino";
import { Ok } from "@openally/result";

// Import Internal Dependencies
import { Incomer } from "../../../../src/index.js";

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

  await getRedis()!.flushall();
});

afterAll(async() => {
  await closeAllRedis();
});

describe("Init Incomer without Dispatcher alive & prefix as \"test\"", () => {
  const eventComeBackHandler = jest.fn().mockImplementation(() => Ok({ status: "RESOLVED" }));;

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


