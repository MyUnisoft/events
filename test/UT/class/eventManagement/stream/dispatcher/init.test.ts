// Import Node.js Dependencies
import { randomUUID } from "node:crypto";
import timers from "node:timers/promises";

// Import Third-party Dependencies
import {
  initRedis,
  closeAllRedis
} from "@myunisoft/redis";
import { pino } from "pino";

// Import Internal Dependencies
import { InitHandler } from "../../../../../../src/class/eventManagement/stream/dispatcher/init.class";
import { IncomerStore } from "../../../../../../src/class/store/incomer.class";
import { PubSubHandler } from "../../../../../../src/class/eventManagement/stream/dispatcher/pubsub.class";

async function multipleInit() {
  const modules = new Array(10);

  const initModules: InitHandler[] = [];
  for (const _ of modules) {
    const consumerUUID = randomUUID();
    const instanceName = "Pulsar";
    const incomerStore = new IncomerStore({});

    const logger = pino({
      name: "Dispatcher",
      level: "info"
    });

    logger.setBindings({ consumer: consumerUUID });

    const initModule = new InitHandler({
      instanceName: "Pulsar",
      consumerUUID,
      idleTime: 2000,
      logger,
      eventsSubscribe: [],
      incomerStore: incomerStore,
      pubsubHandler: new PubSubHandler({
        instanceName,
        consumerUUID,
        idleTime: 2000,
        logger,
        incomerStore
      })
    });

    initModules.push(initModule)
  }

  await Promise.all([
    ...initModules.map((module) => module.init())
  ]);

  return initModules;
}

describe("init", () => {
  let initModules: InitHandler[] = [];

  beforeAll(async() => {
    await initRedis({
      port: Number(process.env.REDIS_PORT),
      host: process.env.REDIS_HOST
    });

    await initRedis({
      port: Number(process.env.REDIS_PORT),
      host: process.env.REDIS_HOST
    }, "subscriber");

    initModules = await multipleInit();
  });

  afterAll(async() => {
    for (const module of initModules) {
      await module.close();
    }

    await closeAllRedis();
  });

  test("Only one module should call `takedLead()` and set `isLeader` as true", async() => {
    expect.assertions(1);

    await timers.setTimeout(200);
    for (const module of initModules) {
      if (module["pubsubHandler"].isLeader === true) {
        expect(true).toBe(true);
      }
    }
  });
});
