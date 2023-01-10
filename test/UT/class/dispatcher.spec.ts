// Import Third-party Dependencies
import { initRedis, closeRedis, Redis } from "@myunisoft/redis-utils";

// Import Internal Dependencies
import { Dispatcher } from "../../../src/index";


let dispatcher: Dispatcher;

beforeAll(async() => {
  await initRedis({
    port: process.env.REDIS_PORT,
    host: process.env.REDIS_HOST
  } as any);
});

afterAll(async() => {
  await closeRedis();
});

describe("Dispatcher without options", () => {
  beforeAll(async() => {
    dispatcher = new Dispatcher();

    await dispatcher.initialize();
  });

  afterAll(async() => {
    await dispatcher.close();
  });

  test("Dispatcher should be defined", () => {
    expect(dispatcher).toBeInstanceOf(Dispatcher);
    expect(dispatcher.prefix).toBe("");
    expect(dispatcher.privateUuid).toBeDefined();
  });
});

describe("Dispatcher with subscriber", () => {
  let subscriber: Redis;

  beforeAll(async() => {
    subscriber = await initRedis({
      port: process.env.REDIS_PORT,
      host: process.env.REDIS_HOST
    } as any);

    dispatcher = new Dispatcher({}, subscriber);

    await dispatcher.initialize();
  });

  afterAll(async() => {
    await closeRedis(subscriber);
  });

  test("Dispatcher should be defined", () => {
    expect(dispatcher).toBeInstanceOf(Dispatcher);
    expect(dispatcher.prefix).toBe("");
    expect(dispatcher.privateUuid).toBeDefined();
  });
});
