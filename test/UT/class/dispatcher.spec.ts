// Import Third-party Dependencies
import { initRedis, closeRedis, Redis, Channel } from "@myunisoft/redis-utils";
import * as Logger from "pino";
import Ajv from "ajv";

// Import Internal Dependencies
import { Dispatcher } from "../../../src/index";
import * as EventsSchemas from "../schema/index";

// Internal Dependencies Mocks
const logger = Logger.pino();
const mockedLoggerError = jest.spyOn(logger, "error");
const mockedLoggerInfo = jest.spyOn(logger, "info");
const mockedHandleDispatcherMessages = jest.spyOn(Dispatcher.prototype as any, "handleDispatcherMessages");
const mockedHandleIncomerMessages = jest.spyOn(Dispatcher.prototype as any, "handleIncomerMessages");

// CONSTANTS
const ajv = new Ajv();

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
  let dispatcher: Dispatcher;

  beforeAll(async() => {
    dispatcher = new Dispatcher();

    Reflect.set(dispatcher, "logger", logger);

    await dispatcher.initialize();
  });

  afterAll(async() => {
    await dispatcher.close();
  });

  beforeEach(() => {
    mockedLoggerError.mockClear();
    mockedLoggerInfo.mockClear();
    mockedHandleDispatcherMessages.mockClear();
    mockedHandleIncomerMessages.mockClear();
  });

  test("Dispatcher should be defined", () => {
    expect(dispatcher).toBeInstanceOf(Dispatcher);
    expect(dispatcher.prefix).toBe("");
    expect(dispatcher.privateUuid).toBeDefined();
  });

  test("Publishing a malformed message, it should log a new Error", async() => {
    const channel = new Channel({
      name: "dispatcher"
    });

    await channel.publish({ foo: "bar" });

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockedLoggerError).toHaveBeenCalledWith(new Error("Malformed message"));
    expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
    expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
  });

  test("Publishing an unknown event, it should log a new Error", async() => {
    const channel = new Channel({
      name: "dispatcher"
    });

    await channel.publish({ event: "foo" });

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockedLoggerError).toHaveBeenCalledWith(new Error("Unknown Event"));
    expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
    expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
  });
});

describe("Dispatcher with injected schemas", () => {
  let dispatcher: Dispatcher;

  beforeAll(async() => {
    const eventsValidationFunction = new Map();

    for (const [name, validationSchema] of Object.entries(EventsSchemas)) {
      eventsValidationFunction.set(name, ajv.compile(validationSchema));
    }

    dispatcher = new Dispatcher({ eventsValidationFunction });

    Reflect.set(dispatcher, "logger", logger);

    await dispatcher.initialize();
  });

  afterAll(async() => {
    await dispatcher.close();
  });

  beforeEach(() => {
    mockedLoggerError.mockClear();
    mockedLoggerInfo.mockClear();
    mockedHandleDispatcherMessages.mockClear();
    mockedHandleIncomerMessages.mockClear();
  });

  test("Dispatcher should be defined", () => {
    expect(dispatcher).toBeInstanceOf(Dispatcher);
    expect(dispatcher.prefix).toBe("");
    expect(dispatcher.privateUuid).toBeDefined();
  });

  test("Publishing a malformed message, it should log a new Error", async() => {
    const channel = new Channel({
      name: "dispatcher"
    });

    await channel.publish({
      event: "foo",
      data: {
        foo: "bar"
      },
      metadata: {
        origin: "foo",
        transactionId: "bar"
      }
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockedLoggerError).toHaveBeenCalledWith(new Error("Unknown event on dispatcher channel"));
    expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
    expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
  });
});

describe("Dispatcher with subscriber", () => {
  let dispatcher: Dispatcher;
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
    await dispatcher.close();
    await closeRedis(subscriber);
  });

  beforeEach(() => {
    mockedLoggerError.mockClear();
    mockedLoggerInfo.mockClear();
    mockedHandleDispatcherMessages.mockClear();
    mockedHandleIncomerMessages.mockClear();
  });

  test("Dispatcher should be defined", () => {
    expect(dispatcher).toBeInstanceOf(Dispatcher);
    expect(dispatcher.prefix).toBe("");
    expect(dispatcher.privateUuid).toBeDefined();
  });
});
