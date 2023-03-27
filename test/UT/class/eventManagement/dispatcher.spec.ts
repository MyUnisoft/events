// Import Node.js Dependencies
import { randomUUID } from "node:crypto";
import timers from "timers/promises";

// Import Third-party Dependencies
import {
  initRedis,
  closeRedis,
  Redis,
  Channel,
  clearAllKeys
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
const mockedPing = jest.spyOn(Dispatcher.prototype as any, "ping");
const mockedCheckLastActivity = jest.spyOn(Dispatcher.prototype as any, "checkLastActivity");
const mockedHandleInactiveIncomer =  jest.spyOn(Dispatcher.prototype as any, "handleInactiveIncomer");

const mockedSetTransaction = jest.spyOn(TransactionStore.prototype, "setTransaction");
const mockedDeleteTransaction = jest.spyOn(TransactionStore.prototype, "deleteTransaction");

// CONSTANTS
const ajv = new Ajv();

describe("Dispatcher", () => {
  afterEach(() => {
    jest.clearAllMocks();
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
      dispatcher = new Dispatcher({
        pingInterval: 2_000,
        checkLastActivityInterval: 5_000,
        checkTransactionInterval: 3_600,
        idleTime: 5_000
       });

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

      await timers.setTimeout(1_000);

      expect(mockedLoggerError).toHaveBeenCalledWith({ channel: "dispatcher", message: { foo: "bar" }, error: "Malformed message" });
      expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
      expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
    });

    test("Publishing a malformed message, it should log a new Error", async() => {
      const channel = new Channel({
        name: "dispatcher"
      });

      await channel.publish({ event: "foo" });

      await timers.setTimeout(1_000);

      expect(mockedLoggerError).toHaveBeenCalledWith({ channel: "dispatcher", message: { event: "foo" }, error: "Malformed message" });
      expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
      expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
    });

    describe("Publishing a well formed register event", () => {
      let incomerName = randomUUID();

      test("without unresolved transaction, it should fail and throw a new Error", async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        const event = {
          event: "register",
          data: {
            name: incomerName,
            subscribeTo: []
          },
          metadata: {
            origin: incomerName,
            transactionId: "foo"
          }
        };

        await channel.publish(event);

        await timers.setTimeout(1_000);

        expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
        expect(mockedLoggerError).toHaveBeenCalledWith({
          channel: "dispatcher",
          message: event,
          error: "No related transaction found next to register event"
        });
      });

      test("It should handle the message and log infos about it", async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        const dispatcherTransactionStore = new TransactionStore({
          instance: "dispatcher"
        });

        const event = {
          event: "register",
          data: {
            name: incomerName,
            subscribeTo: []
          },
          metadata: {
            origin: incomerName
          }
        };

        const transactionId = await dispatcherTransactionStore.setTransaction({
          ...event,
          mainTransaction: true,
          relatedTransaction: null,
          resolved: null
        });

        await channel.publish({
          ...event,
          metadata: {
            ...event.metadata,
            transactionId
          }
        });

        await timers.setTimeout(1_000);

        expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
        expect(mockedLoggerInfo).toHaveBeenCalled();
      });

      test("Publishing multiple time a register event with the same origin, it should throw a new Error", async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        const dispatcherTransactionStore = new TransactionStore({
          instance: "dispatcher"
        });

        const event = {
          event: "register",
          data: {
            name: incomerName,
            subscribeTo: []
          },
          metadata: {
            origin: incomerName
          }
        };

        const transactionId = await dispatcherTransactionStore.setTransaction({
          ...event,
          mainTransaction: true,
          relatedTransaction: null,
          resolved: null
        });

        await channel.publish({
          ...event,
          metadata: {
            ...event.metadata,
            transactionId
          }
        });

        await timers.setTimeout(1_000);

        expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
        expect(mockedLoggerError).toHaveBeenCalledWith({
          channel: "dispatcher",
          message: {
            ...event,
            metadata: {
              ...event.metadata,
              transactionId
            }
          },
          error: "Forbidden multiple registration for a same instance"
        });
      });
    });

    describe("Handling a ping event", () => {
      let incomerName = randomUUID();
      let pongTransactionId: string;
      let subscriber: Redis;
      let incomerTransactionStore: TransactionStore<"incomer">;
      let dispatcherTransactionStore: TransactionStore<"dispatcher">

      beforeAll(async() => {
        await clearAllKeys();
        jest.clearAllMocks();

        let index = 0;
        subscriber = await initRedis({
          port: process.env.REDIS_PORT,
          host: process.env.REDIS_HOST
        } as any, true);

        await subscriber.subscribe("dispatcher");

        subscriber.on("message", async(channel, message) => {
          const formattedMessage = JSON.parse(message);

          if (formattedMessage.event === "approvement") {
            const providedUuid = formattedMessage.data.uuid;

            await subscriber.subscribe(providedUuid);

            incomerTransactionStore = new TransactionStore({
              prefix: providedUuid,
              instance: "incomer"
            });
          }
          else if (formattedMessage.event === "ping" && index === 0) {
            pongTransactionId = await incomerTransactionStore.setTransaction({
              ...formattedMessage,
              metadata: {
                ...formattedMessage.metadata,
                origin: formattedMessage.metadata.to
              },
              createdAt: Date.now(),
              mainTransaction: false,
              relatedTransaction: formattedMessage.metadata.transactionId,
              resolved: null
            });

            index++;
          }
        });

        const channel = new Channel({
          name: "dispatcher"
        });

        dispatcherTransactionStore = new TransactionStore({
          instance: "dispatcher"
        });

        const event = {
          event: "register",
          data: {
            name: incomerName,
            subscribeTo: []
          },
          metadata: {
            origin: incomerName
          }
        };

        const transactionId = await dispatcherTransactionStore.setTransaction({
          ...event,
          mainTransaction: true,
          relatedTransaction: null,
          resolved: null
        });

        await channel.publish({
          event: "register",
          data: {
            name: incomerName,
            subscribeTo: []
          },
          metadata: {
            origin: incomerName,
            transactionId
          }
        });

        await timers.setTimeout(1_000);
      });

      test("It should have ping and a new transaction should have been create", async() => {
        await timers.setTimeout(3_000);

        expect(mockedPing).toHaveBeenCalled();
        expect(pongTransactionId).toBeDefined();
      });

      test("It should have update the update the incomer last activity", async () => {
        await timers.setTimeout(3_000);

        const transaction = await incomerTransactionStore.getTransactionById(pongTransactionId);

        expect(transaction).not.toBeDefined();
        expect(mockedCheckLastActivity).toHaveBeenCalled();
        expect(mockedHandleInactiveIncomer).not.toHaveBeenCalled();
      });

      test("It should remove the inactive incomers", async() => {
        await timers.setTimeout(3_000);

        expect(mockedCheckLastActivity).toHaveBeenCalled();
        expect(mockedHandleInactiveIncomer).toHaveBeenCalled();
      });
    });
  });

  describe("Dispatcher with prefix", () => {
    let dispatcher: Dispatcher;
    let prefix = "local" as "local";
    beforeAll(async() => {
      dispatcher = new Dispatcher({
        pingInterval: 2_000,
        checkLastActivityInterval: 5_000,
        checkTransactionInterval: 3_600,
        idleTime: 5_000,
        prefix
      });

      await dispatcher.initialize();
    });

    afterAll(async() => {
      await dispatcher.close();
    });

    test("Dispatcher should be defined", () => {
      expect(dispatcher).toBeInstanceOf(Dispatcher);
      expect(dispatcher.prefix).toBe("local-");
      expect(dispatcher.privateUuid).toBeDefined();
    });

    describe("Publishing on the dispatcher channel", () => {
      describe("Publishing well formed register event", () => {
        let incomerName = randomUUID();
        let approved = false;
        let subscriber: Redis;

        beforeAll(async() => {
          jest.clearAllMocks();

          subscriber = await initRedis({
            port: process.env.REDIS_PORT,
            host: process.env.REDIS_HOST
          } as any, true);

          await subscriber.subscribe(`${prefix}-dispatcher`);

          subscriber.on("message", async(channel, message) => {
            const formattedMessage = JSON.parse(message);

            if (formattedMessage.event && formattedMessage.event === "approvement") {
              approved = true;
            }
          });

          const channel = new Channel({
            name: "dispatcher",
            prefix
          });

          const dispatcherTransactionStore = new TransactionStore({
            instance: "dispatcher",
            prefix
          });

          const event = {
            event: "register",
            data: {
              name: incomerName,
              subscribeTo: []
            },
            metadata: {
              origin: incomerName,
              prefix
            }
          }

          const transactionId = await dispatcherTransactionStore.setTransaction({
            ...event,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: null
          });

          const foo = await dispatcherTransactionStore.getTransactionById(transactionId);

          await channel.publish({
            ...event,
            metadata: {
              origin: incomerName,
              prefix,
              transactionId
            }
          });
        });

        afterAll(async() => {
          await closeRedis(subscriber);
        });

        test("it should delete the main transaction in Incomer store", async() => {
          await timers.setTimeout(1_800);

          expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
          expect(mockedSetTransaction).toHaveBeenCalled();
        });

        test("it should publish a well formed approvement event", async() => {
          await timers.setTimeout(1_000);

          expect(approved).toBe(true);
        });
      });
    });

    describe("Handling a ping event", () => {
      let incomerName = randomUUID();
      let pongTransactionId: string;
      let subscriber: Redis;
      let dispatcherTransactionStore: TransactionStore<"dispatcher">;
      let incomerTransactionStore: TransactionStore<"incomer">;

      beforeAll(async() => {
        await clearAllKeys();
        jest.clearAllMocks();

        let index = 0;
        subscriber = await initRedis({
          port: process.env.REDIS_PORT,
          host: process.env.REDIS_HOST
        } as any, true);

        await subscriber.subscribe(`${prefix}-dispatcher`);

        subscriber.on("message", async(channel, message) => {
          const formattedMessage = JSON.parse(message);

          if (formattedMessage.event === "approvement") {
            const providedUUid = formattedMessage.data.uuid;

            incomerTransactionStore = new TransactionStore({
              prefix: providedUUid,
              instance: "incomer"
            });

            await subscriber.subscribe(`${prefix}-${providedUUid}`);
          }
          else if (formattedMessage.event === "ping" && index === 0) {
            pongTransactionId = await incomerTransactionStore.setTransaction({
              ...formattedMessage,
              metadata: {
                ...formattedMessage.metadata,
                prefix,
                origin: formattedMessage.metadata.to
              },
              createdAt: Date.now(),
              mainTransaction: false,
              relatedTransaction: formattedMessage.metadata.transactionId,
              resolved: null
            });

            index++;
          }
        });

        const channel = new Channel({
          name: "dispatcher",
          prefix
        });

        dispatcherTransactionStore = new TransactionStore({
          instance: "dispatcher",
          prefix
        });

        const event = {
          event: "register",
          data: {
            name: incomerName,
            subscribeTo: []
          },
          metadata: {
            origin: incomerName,
            prefix
          }
        };

        const transactionId = await dispatcherTransactionStore.setTransaction({
          ...event,
          mainTransaction: true,
          relatedTransaction: null,
          resolved: null
        });

        await channel.publish({
          event: "register",
          data: {
            name: incomerName,
            subscribeTo: []
          },
          metadata: {
            origin: incomerName,
            prefix,
            transactionId
          }
        });

        await timers.setTimeout(1_000);
      });

      test("It should have ping and a new transaction should have been create", async() => {
        await timers.setTimeout(3_000);

        expect(mockedPing).toHaveBeenCalled();
        expect(pongTransactionId).toBeDefined();
      });

      test("It should have update the update the incomer last activity", async () => {
        await timers.setTimeout(3_000);

        const transaction = await incomerTransactionStore.getTransactionById(pongTransactionId);

        expect(transaction).not.toBeDefined();
        expect(mockedHandleInactiveIncomer).not.toHaveBeenCalled();
      });

      test("It should remove the inactive incomers", async() => {
        await timers.setTimeout(3_000);

        expect(mockedCheckLastActivity).toHaveBeenCalled();
        expect(mockedHandleInactiveIncomer).toHaveBeenCalled();
      });
    });
  });

  describe("Dispatcher with injected schemas", () => {
    let dispatcher: Dispatcher;

    beforeAll(async() => {
      await clearAllKeys();
      jest.clearAllMocks();

      const eventsValidationFunction = new Map();

      for (const [name, validationSchema] of Object.entries(EventsSchemas)) {
        eventsValidationFunction.set(name, ajv.compile(validationSchema));
      }

      dispatcher = new Dispatcher({
        eventsValidationFunction,
        pingInterval: 2_000,
        checkLastActivityInterval: 6_000,
        checkTransactionInterval: 4_000,
        idleTime: 6_000
      });

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

        const event = {
          data: {
            foo: "bar"
          },
          metadata: {
            origin: "foo",
            transactionId: "bar"
          }
        };

        await channel.publish(event);

        await timers.setTimeout(1_000);

        expect(mockedLoggerError).toHaveBeenCalledWith({ channel: "dispatcher", message: event, error: "Malformed message" });
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
      });

      test(`Publishing a message without metadata,
            it should log a new Error with the message "Malformed message"`,
      async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        const event = {
          event: "foo",
          data: {
            foo: "bar"
          }
        };

        await channel.publish(event);

        await timers.setTimeout(1_000);

        expect(mockedLoggerError).toHaveBeenCalledWith({ channel: "dispatcher", message: event, error: "Malformed message" });
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
      });

      test("Publishing an unknown event, it should log a new Error with the message `Unknown Event`", async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        const event = {
          event: "bar",
          data: {
            foo: "bar"
          },
          metadata: {
            origin: "foo",
            transactionId: "bar"
          }
        };

        await channel.publish(event);

        await timers.setTimeout(1_000);

        expect(mockedLoggerError).toHaveBeenCalledWith({ channel: "dispatcher", message: event, error: "Unknown Event" });
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
      });
    });

    describe("Publishing on the dispatcher channel", () => {
      describe("Publishing well formed register event", () => {
        let incomerName = randomUUID();
        let approved = false;
        let subscriber: Redis;

        beforeAll(async() => {
          await clearAllKeys();
          jest.clearAllMocks();

          subscriber = await initRedis({
            port: process.env.REDIS_PORT,
            host: process.env.REDIS_HOST
          } as any, true);

          await subscriber.subscribe("dispatcher");

          subscriber.on("message", async(channel, message) => {
            const formattedMessage = JSON.parse(message);

            if (formattedMessage.event && formattedMessage.event === "approvement") {
              approved = true;
            }
          });

          const channel = new Channel({
            name: "dispatcher"
          });

          const dispatcherTransactionStore = new TransactionStore({
            instance: "dispatcher"
          });

          const event = {
            event: "register",
            data: {
              name: incomerName,
              subscribeTo: []
            },
            metadata: {
              origin: incomerName
            }
          }

          const transactionId = await dispatcherTransactionStore.setTransaction({
            ...event,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: null
          });

          await channel.publish({
            ...event,
            metadata: {
              origin: incomerName,
              transactionId
            }
          });
        });

        test("it should delete the main transaction in Incomer store", async() => {
          await timers.setTimeout(1_800);

          expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
          expect(mockedSetTransaction).toHaveBeenCalled();
        });

        test("it should publish a well formed approvement event", async() => {
          await timers.setTimeout(1_000);

          expect(approved).toBe(true);
        });
      });

      test(`Publishing an unknown event on the dispatcher channel,
            it should log a new Error with the message "Unknown event on Dispatcher Channel"`,
      async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        const event = {
          event: "foo",
          data: {
            foo: "bar"
          },
          metadata: {
            origin: "foo",
            transactionId: "bar"
          }
        };

        await channel.publish(event);

        await timers.setTimeout(1_000);

        expect(mockedLoggerError).toHaveBeenCalledWith({ channel: "dispatcher", message: event, error: "Unknown event on Dispatcher Channel" });
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
      });

      test(`Publish a well known event with wrong data,
            it should log a new Error with the message "Malformed message"`,
      async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        const event = {
          event: "foo",
          data: {
            bar: "foo"
          },
          metadata: {
            origin: "foo",
            transactionId: "bar"
          }
        };

        await channel.publish(event);

        await timers.setTimeout(1_000);

        expect(mockedLoggerError).toHaveBeenCalledWith({ channel: "dispatcher", message: event, error: "Malformed message" });
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
      });
    });

    describe("Publishing on a dedicated channel", () => {
      beforeAll(async() => {
        await clearAllKeys();
        jest.clearAllMocks();
      });

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

        await timers.setTimeout(1_000);

        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).toHaveBeenCalled();
      });

      describe("Publishing an injected event", () => {
        const firstIncomerName = randomUUID();
        const secondIncomerName = randomUUID();
        let firstIncomerProvidedUuid;
        let secondIncomerProvidedUuid;
        let subscriber: Redis;
        let hasDistributedEvents = false;
        let firstIncomerTransactionStore: TransactionStore<"incomer">;
        let secondIncomerTransactionStore: TransactionStore<"incomer">;
        let dispatcherTransactionStore: TransactionStore<"dispatcher">;
        let mainTransactionId;

        beforeAll(async() => {
          subscriber = await initRedis({
            port: process.env.REDIS_PORT,
            host: process.env.REDIS_HOST
          } as any, true);

          await subscriber.subscribe("dispatcher");

          subscriber.on("message", async(channel, message) => {
            const formattedMessage = JSON.parse(message);

            if (channel === "dispatcher") {
              if (formattedMessage.event === "approvement") {
                const uuid = formattedMessage.data.uuid;

                if (formattedMessage.metadata.to === firstIncomerName) {
                  firstIncomerProvidedUuid = uuid;

                  firstIncomerTransactionStore = new TransactionStore({
                    prefix: uuid,
                    instance: "incomer"
                  });

                  const exclusiveChannel = new Channel({
                    name: firstIncomerProvidedUuid
                  });

                  const event = {
                    event: "foo",
                    data: {
                      foo: "foo"
                    },
                    metadata: {
                      origin: firstIncomerProvidedUuid
                    }
                  }

                  mainTransactionId = await firstIncomerTransactionStore.setTransaction({
                    ...event,
                    mainTransaction: true,
                    relatedTransaction: null,
                    resolved: null
                  });

                  await exclusiveChannel.publish({
                    ...event,
                    metadata: {
                      ...event.metadata,
                      transactionId: mainTransactionId
                    }
                  });
                }
                else {
                  secondIncomerProvidedUuid = uuid;
                  secondIncomerTransactionStore = new TransactionStore({
                    prefix: secondIncomerProvidedUuid,
                    instance: "incomer"
                  });
                }

                await subscriber.subscribe(secondIncomerProvidedUuid);
              }
            }
            else {
              if (channel === secondIncomerProvidedUuid) {
                if (formattedMessage.event === "foo") {
                  hasDistributedEvents = true;
                  await secondIncomerTransactionStore.setTransaction({
                    ...formattedMessage,
                    metadata: {
                      ...formattedMessage.metadata,
                      origin: formattedMessage.metadata.to
                    },
                    createdAt: Date.now(),
                    mainTransaction: false,
                    relatedTransaction: formattedMessage.metadata.transactionId,
                    resolved: null
                  });
                }
              }
            }
          });

          dispatcherTransactionStore = new TransactionStore({
            instance: "dispatcher"
          });

          const channel = new Channel({
            name: "dispatcher"
          });

          const firstEvent = {
            event: "register",
            data: {
              name: firstIncomerName,
              subscribeTo: []
            },
            metadata: {
              origin: firstIncomerName
            }
          };

          const secondEvent = {
            event: "register",
            data: {
              name: secondIncomerName,
              subscribeTo: [{ name: "foo" }]
            },
            metadata: {
              origin: secondIncomerName
            }
          };

          const firstTransactionId = await dispatcherTransactionStore.setTransaction({
            ...firstEvent,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: null
          });

          const secondTransactionId = await dispatcherTransactionStore.setTransaction({
            ...secondEvent,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: null
          });

          await channel.publish({
            ...firstEvent,
            metadata: {
              ...firstEvent.metadata,
              transactionId: firstTransactionId
            }
          });

          await channel.publish({
            ...secondEvent,
            metadata: {
              ...secondEvent.metadata,
              transactionId: secondTransactionId
            }
          });

          await timers.setTimeout(2_000);
        });

        test("it should have distributed the event & resolve the main transaction", async() => {
          await timers.setTimeout(3_000);

          const transaction = await firstIncomerTransactionStore.getTransactionById(mainTransactionId);

          expect(transaction).toBeUndefined();

          expect(mockedLoggerInfo).toHaveBeenCalled();
          expect(mockedHandleIncomerMessages).toHaveBeenCalled();
          expect(hasDistributedEvents).toBe(true);
        });
      });
    });
  });

  describe("Dispatcher with subscriber", () => {
    let dispatcher: Dispatcher;
    let subscriber: Redis;

    beforeAll(async() => {
      await clearAllKeys();
      jest.clearAllMocks();

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

    test("Dispatcher should be defined", () => {
      expect(dispatcher).toBeInstanceOf(Dispatcher);
      expect(dispatcher.prefix).toBe("");
      expect(dispatcher.privateUuid).toBeDefined();
    });
  });
});
