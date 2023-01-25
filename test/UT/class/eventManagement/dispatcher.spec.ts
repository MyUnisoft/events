// Import Third-party Dependencies
import {
  initRedis,
  closeRedis,
  Redis,
  Channel
} from "@myunisoft/redis";
import * as Logger from "pino";
import Ajv from "ajv";

// Import Internal Dependencies
import { Dispatcher } from "../../../../src/index";
import * as EventsSchemas from "../../schema/index";
import { TransactionStore } from "../../../../src/class/eventManagement/transaction.class";

// Internal Dependencies Mocks
const logger = Logger.pino();
const mockedLoggerError = jest.spyOn(logger, "error");
const mockedLoggerInfo = jest.spyOn(logger, "info");
const mockedHandleDispatcherMessages = jest.spyOn(Dispatcher.prototype as any, "handleDispatcherMessages");
const mockedHandleIncomerMessages = jest.spyOn(Dispatcher.prototype as any, "handleIncomerMessages");
const mockedSetTransaction = jest.spyOn(TransactionStore.prototype, "setTransaction");
const mockedGetTransaction = jest.spyOn(TransactionStore.prototype, "getTransaction");
const mockedDeleteTransaction = jest.spyOn(TransactionStore.prototype, "deleteTransaction");

// CONSTANTS
const ajv = new Ajv();

describe("Dispatcher", () => {
  afterEach(() => {
    mockedLoggerError.mockClear();
    mockedLoggerInfo.mockClear();
    mockedHandleDispatcherMessages.mockClear();
    mockedHandleIncomerMessages.mockClear();
  });

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

      await new Promise((resolve) => setTimeout(resolve, 1_000));

      expect(mockedLoggerError).toHaveBeenCalledWith(new Error("Malformed message"));
      expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
      expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
    });

    test("Publishing a malformed message, it should log a new Error", async() => {
      const channel = new Channel({
        name: "dispatcher"
      });

      await channel.publish({ event: "foo" });

      await new Promise((resolve) => setTimeout(resolve, 1_000));

      expect(mockedLoggerError).toHaveBeenCalledWith(new Error("Malformed message"));
      expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
      expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
    });

    describe("Publishing a well formed event", () => {
      beforeAll(async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        await channel.publish({
          event: "register",
          data: {
            name: "bar",
            subscribeTo: []
          },
          metadata: {
            origin: "foo"
          }
        });

        await new Promise((resolve) => setTimeout(resolve, 1_000));
      });

      test("It should handle the message and log infos about it", async() => {
        expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
        expect(mockedLoggerInfo).toHaveBeenCalled();
      });

      test("Publishing multiple time a register event with the same origin, it should throw a new Error", async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        await channel.publish({
          event: "register",
          data: {
            name: "bar",
            subscribeTo: []
          },
          metadata: {
            origin: "foo"
          }
        });

        await new Promise((resolve) => setTimeout(resolve, 1_000));

        expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
        expect(mockedLoggerError).toHaveBeenCalledWith(new Error("Forbidden multiple registration for a same instance"));
      });
    });
  });


  describe("Dispatcher with prefix", () => {
    let dispatcher: Dispatcher;

    beforeAll(async() => {
      dispatcher = new Dispatcher({
        prefix: "local"
      });

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
      expect(dispatcher.prefix).toBe("local-");
      expect(dispatcher.privateUuid).toBeDefined();
    });

    describe("Publishing on the dispatcher channel", () => {
      describe("Publishing well formed register event", () => {
        let transactionId;
        let subscriber: Redis;

        beforeAll(async() => {
          subscriber = await initRedis({
            port: process.env.REDIS_PORT,
            host: process.env.REDIS_HOST
          } as any, true);

          await subscriber.subscribe("local-dispatcher");

          subscriber.on("message", async(channel, message) => {
            const formattedMessage = JSON.parse(message);

            if (formattedMessage.event && formattedMessage.event === "approvement") {
              transactionId = formattedMessage.metadata.transactionId;
            }
          });

          const channel = new Channel({
            name: "dispatcher",
            prefix: "local"
          });

          await channel.publish({
            event: "register",
            data: {
              name: "bar",
              subscribeTo: []
            },
            metadata: {
              origin: "foo"
            }
          });
        });

        test("it should set a new transaction", async() => {
          await new Promise((resolve) => setTimeout(resolve, 1_000));

          expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
          expect(mockedSetTransaction).toHaveBeenCalled();
        });

        test("it should publish a well formed approvement event and transactionId should be defined", async() => {
          await new Promise((resolve) => setTimeout(resolve, 1_000));

          expect(transactionId).toBeDefined();
        });

        test("Publishing a well formed ack event, it should be calling deleteTransaction", async() => {
          const channel = new Channel({
            name: "dispatcher",
            prefix: "local"
          });

          await channel.publish({
            event: "ack",
            metadata: {
              origin: "foo",
              prefix: "local",
              transactionId
            }
          });

          await new Promise((resolve) => setTimeout(resolve, 1_000));

          expect(mockedDeleteTransaction).toHaveBeenCalled();
        });
      });
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

    test("Dispatcher should be defined", () => {
      expect(dispatcher).toBeInstanceOf(Dispatcher);
      expect(dispatcher.prefix).toBe("");
      expect(dispatcher.privateUuid).toBeDefined();
    });

    describe("On any channel", () => {
      test(`Publishing a message without event,
            it should log a new Error with the message "Malformed message"`,
      async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        await channel.publish({
          data: {
            foo: "bar"
          },
          metadata: {
            origin: "foo",
            transactionId: "bar"
          }
        });

        await new Promise((resolve) => setTimeout(resolve, 1_000));

        expect(mockedLoggerError).toHaveBeenCalledWith(new Error("Malformed message"));
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
      });

      test(`Publishing a message without metadata,
            it should log a new Error with the message "Malformed message"`,
      async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        await channel.publish({
          event: "foo",
          data: {
            foo: "bar"
          }
        });

        await new Promise((resolve) => setTimeout(resolve, 1_000));

        expect(mockedLoggerError).toHaveBeenCalledWith(new Error("Malformed message"));
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
      });

      test("Publishing an unknown event, it should log a new Error with the message `Unknown Event`", async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        await channel.publish({
          event: "bar",
          data: {
            foo: "bar"
          },
          metadata: {
            origin: "foo",
            transactionId: "bar"
          }
        });

        await new Promise((resolve) => setTimeout(resolve, 1_000));

        expect(mockedLoggerError).toHaveBeenCalledWith(new Error("Unknown Event"));
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
      });
    });

    describe("Publishing on the dispatcher channel", () => {
      describe("Publishing well formed register event", () => {
        let transactionId;
        let subscriber: Redis;

        beforeAll(async() => {
          subscriber = await initRedis({
            port: process.env.REDIS_PORT,
            host: process.env.REDIS_HOST
          } as any, true);

          await subscriber.subscribe("dispatcher");

          subscriber.on("message", async(channel, message) => {
            const formattedMessage = JSON.parse(message);

            if (formattedMessage.event && formattedMessage.event === "approvement") {
              transactionId = formattedMessage.metadata.transactionId;
            }
          });

          const channel = new Channel({
            name: "dispatcher"
          });

          await channel.publish({
            event: "register",
            data: {
              name: "bar",
              subscribeTo: []
            },
            metadata: {
              origin: "bar"
            }
          });

          await new Promise((resolve) => setTimeout(resolve, 1_000));
        });

        test("it should set a new transaction", async() => {
          expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
          expect(mockedSetTransaction).toHaveBeenCalled();
        });

        test("it should publish a well formed approvement event and transactionId should be defined", async() => {
          expect(transactionId).toBeDefined();
        });

        test("Publishing a well formed ack event, it should be calling deleteTransaction", async() => {
          const channel = new Channel({
            name: "dispatcher"
          });

          await channel.publish({
            event: "ack",
            metadata: {
              origin: "foo",
              transactionId
            }
          });

          await new Promise((resolve) => setTimeout(resolve, 1_000));

          expect(mockedDeleteTransaction).toHaveBeenCalled();
        });
      });

      test(`Publishing an unknown event on the dispatcher channel,
            it should log a new Error with the message "Unknown event on dispatcher channel"`,
      async() => {
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

        await new Promise((resolve) => setTimeout(resolve, 1_000));

        expect(mockedLoggerError).toHaveBeenCalledWith(new Error("Unknown event on dispatcher channel"));
        expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
      });

      test(`Publish a well known event with wrong data,
            it should log a new Error with the message "Malformed message"`,
      async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        await channel.publish({
          event: "foo",
          data: {
            bar: "foo"
          },
          metadata: {
            origin: "foo",
            transactionId: "bar"
          }
        });

        await new Promise((resolve) => setTimeout(resolve, 1_000));

        expect(mockedLoggerError).toHaveBeenCalledWith(new Error("Malformed message"));
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
      });
    });

    describe("Publishing on a dedicated channel", () => {
      test("it should be calling handleIncomerMessages", async() => {
        const channel = new Channel({
          name: "foo"
        });

        // eslint-disable-next-line dot-notation
        await dispatcher["subscriber"].subscribe("foo");

        await channel.publish({
          event: "foo",
          data: {
            foo: "foo"
          },
          metadata: {
            origin: "bar",
            transactionId: "1"
          }
        });

        await new Promise((resolve) => setTimeout(resolve, 1_000));

        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).toHaveBeenCalled();
      });

      describe("Publishing an injected event", () => {
        test("it should log info", async() => {
          const channel = new Channel({
            name: "foo"
          });

          // eslint-disable-next-line dot-notation
          await dispatcher["subscriber"].subscribe("foo");

          await channel.publish({
            event: "foo",
            data: {
              foo: "foo"
            },
            metadata: {
              origin: "bar",
              transactionId: "1"
            }
          });

          await new Promise((resolve) => setTimeout(resolve, 1_000));

          expect(mockedLoggerInfo).toHaveBeenCalled();
          expect(mockedHandleIncomerMessages).toHaveBeenCalled();
        });
      });
    });
  });

  describe("Dispatcher with subscriber", () => {
    let dispatcher: Dispatcher;
    let subscriber: Redis;

    beforeAll(async() => {
      subscriber = await initRedis({
        port: process.env.REDIS_PORT,
        host: process.env.REDIS_HOST
      } as any, true);

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
});
