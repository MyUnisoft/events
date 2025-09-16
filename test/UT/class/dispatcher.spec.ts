// Import Node.js Dependencies
import { randomUUID } from "node:crypto";
import timers from "node:timers/promises";

// Import Third-party Dependencies
import {
  RedisAdapter,
  Channel
} from "@myunisoft/redis";
import { pino } from "pino";
import Ajv from "ajv";

// Import Internal Dependencies
import {
  Dispatcher,
  type EventOptions,
  type Events
} from "../../../src/index.js";
import * as EventsSchemas from "../../fixtures/foo.js";
import {
  Transaction,
  TransactionStore
} from "../../../src/class/store/transaction.class.js";

// Internal Dependencies Mocks
const logger = pino({
  level: "debug"
});
const mockedLoggerError = jest.spyOn(logger, "error");
const mockedLoggerInfo = jest.spyOn(logger, "info");

const mockedHandleDispatcherMessages = jest.spyOn(Dispatcher.prototype as any, "approveIncomer");
const mockedHandleIncomerMessages = jest.spyOn(Dispatcher.prototype as any, "handleCustomEvents");
const mockedPing = jest.spyOn(Dispatcher.prototype as any, "ping");
const mockedCheckLastActivity = jest.spyOn(Dispatcher.prototype as any, "checkLastActivity");

const mockedSetTransaction = jest.spyOn(TransactionStore.prototype, "setTransaction");

// CONSTANTS
const ajv = new Ajv();

describe("Dispatcher", () => {
  const redis = new RedisAdapter({
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST
  });

  afterEach(async() => {
    jest.clearAllMocks();
  });

  beforeAll(async() => {
    await redis.initialize();

    await redis.flushall();
  });

  afterAll(async() => {
    await redis.close();
  });

  describe("Dispatcher without options", () => {
    const subscriber = new RedisAdapter({
      port: Number(process.env.REDIS_PORT),
      host: process.env.REDIS_HOST
    });

    let dispatcher: Dispatcher;

    beforeAll(async() => {
      await subscriber.initialize();

      dispatcher = new Dispatcher({
        name: "foo",
        redis,
        subscriber,
        logger,
        pingInterval: 1_600,
        checkLastActivityInterval: 5_000,
        checkTransactionInterval: 2_400,
        idleTime: 5_000
       });

      await dispatcher.initialize();
    });

    afterAll(async() => {
      await dispatcher.close();
      await subscriber.close();
    });

    test("Dispatcher should be defined", () => {
      expect(dispatcher).toBeInstanceOf(Dispatcher);
      expect(dispatcher.privateUUID).toBeDefined();
    });

    test("Publishing a malformed message, it should log a new Error", async() => {
      const channel = new Channel({
        redis,
        name: "dispatcher"
      });

      await channel.pub({ foo: "bar" });

      await timers.setTimeout(1_000);

      const mockLogs = mockedLoggerError.mock.calls.flat();
      expect(mockLogs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          channel: "dispatcher",
          message: { foo: "bar" },
          error: expect.anything()
        }),
        expect.anything()
      ]));
      expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
      expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
    });

    describe("Publishing a well formed register event", () => {
      let incomerName = "foo";
      let uuid = randomUUID();

      beforeAll(async() => {
        jest.clearAllMocks();
        await redis.flushdb();
      });

      test("without unresolved transaction, it should fail and throw a new Error", async() => {
        const channel = new Channel({
          redis,
          name: "dispatcher"
        });

        const event = {
          name: "REGISTER",
          data: {
            name: incomerName,
            eventsCast: [],
            eventsSubscribe: []
          },
          redisMetadata: {
            origin: uuid,
            transactionId: "foo"
          }
        };

        await channel.pub(event);

        await timers.setTimeout(1_000);

        expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
        const mockLogs = mockedLoggerError.mock.calls.flat();
        expect(mockLogs).toEqual(expect.arrayContaining([
          expect.objectContaining({
            channel: "dispatcher",
            message: event,
            error: expect.anything()
          }),
          expect.anything()
        ]));
      });

      describe("Publishing a well formed register event but multiple times", () => {
        let channel: Channel;
        let incomerTransactionStore: TransactionStore<"incomer">;

        const event = {
          name: "REGISTER",
          data: {
            name: incomerName,
            eventsCast: [],
            eventsSubscribe: []
          },
          redisMetadata: {
            origin: uuid
          }
        };

        beforeAll(async() => {
          channel = new Channel({
            redis,
            name: "dispatcher"
          });

          incomerTransactionStore = new TransactionStore({
            adapter: redis as RedisAdapter<Transaction<"incomer">>,
            prefix: uuid,
            instance: "incomer"
          });

          const transaction = await incomerTransactionStore.setTransaction({
            ...event,
            redisMetadata: {
              ...event.redisMetadata,
              mainTransaction: true,
              relatedTransaction: null,
              resolved: false,
              incomerName
            }
          });

          await channel.pub({
            ...event,
            redisMetadata: {
              ...event.redisMetadata,
              transactionId: transaction.redisMetadata.transactionId
            }
          });

          await timers.setTimeout(2_000);
        });


        test("It should handle the message and log infos about it", async() => {
          await timers.setTimeout(2_000);

          expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
          expect(mockedLoggerInfo).toHaveBeenCalled();
        });

        test("Publishing multiple time a register event with the same origin, it should throw a new Error", async() => {
          const transaction = await incomerTransactionStore.setTransaction({
            ...event,
            redisMetadata: {
              ...event.redisMetadata,
              mainTransaction: true,
              relatedTransaction: null,
              resolved: false,
              incomerName
            }
          });

          await channel.pub({
            ...event,
            redisMetadata: {
              ...event.redisMetadata,
              transactionId: transaction.redisMetadata.transactionId
            }
          });

          await timers.setTimeout(4_000);

          expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
          const mockLogs = mockedLoggerError.mock.calls.flat();
          expect(mockLogs).toEqual(expect.arrayContaining([
            expect.objectContaining({
              channel: "dispatcher",
              message: {
                ...event,
                redisMetadata: {
                  ...event.redisMetadata,
                  transactionId: transaction.redisMetadata.transactionId
                }
              },
              error: expect.anything()
            }),
            expect.anything()
          ]));
        });
      });
    });

    describe("Handling a ping event", () => {
      let incomerName = "foo";
      let uuid = randomUUID();
      let pingTransactionId: string;
      let incomerTransactionStore: TransactionStore<"incomer">;
      let dispatcherTransactionStore: TransactionStore<"dispatcher">

      beforeAll(async() => {
        jest.clearAllMocks();

        let index = 0;

        await subscriber.subscribe("dispatcher");

        subscriber.on("message", async(channel, message) => {
          const formattedMessage = JSON.parse(message);

          if (formattedMessage.name === "APPROVEMENT") {
            const providedUUID = formattedMessage.data.uuid;

            await subscriber.subscribe(providedUUID);

            incomerTransactionStore = new TransactionStore({
              adapter: redis as RedisAdapter<Transaction<"incomer">>,
              prefix: providedUUID,
              instance: "incomer"
            });
          }
          else if (formattedMessage.name === "PING" && index === 0) {
            pingTransactionId = formattedMessage.redisMetadata.transactionId;
            await dispatcherTransactionStore.updateTransaction(pingTransactionId, {
              ...formattedMessage,
              redisMetadata: {
                ...formattedMessage.redisMetadata,
                resolved: true
              },
            });

            index++;
          }
        });

        const channel = new Channel({
          redis,
          name: "dispatcher"
        });

        dispatcherTransactionStore = new TransactionStore({
          adapter: redis as RedisAdapter<Transaction<"dispatcher">>,
          instance: "dispatcher"
        });

        const event = {
          name: "REGISTER",
          data: {
            name: incomerName,
            eventsCast: [],
            eventsSubscribe: []
          },
          redisMetadata: {
            origin: uuid
          }
        };

        incomerTransactionStore = new TransactionStore({
          adapter: redis as RedisAdapter<Transaction<"incomer">>,
          prefix: uuid,
          instance: "incomer"
        });

        const transaction = await incomerTransactionStore.setTransaction({
          ...event,
          redisMetadata: {
            ...event.redisMetadata,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: false,
            incomerName
          }
        });

        await channel.pub({
          name: "REGISTER",
          data: {
            name: incomerName,
            eventsCast: [],
            eventsSubscribe: []
          },
          redisMetadata: {
            origin: uuid,
            transactionId: transaction.redisMetadata.transactionId
          }
        });
      });

      test("It should have ping and a new transaction should have been create", async() => {
        await timers.setTimeout(2_000);

        expect(mockedPing).toHaveBeenCalled();
      });

      test("It should have update the update the incomer last activity", async () => {
        await timers.setTimeout(15_000);

        const pingTransaction = await dispatcherTransactionStore.getTransactionById(pingTransactionId);

        expect(pingTransaction).toEqual(null);
        expect(mockedCheckLastActivity).toHaveBeenCalled();
      });
    });
  });

  describe("Dispatcher with injected schemas", () => {
    const subscriber = new RedisAdapter({
      port: Number(process.env.REDIS_PORT),
      host: process.env.REDIS_HOST
    });

    let dispatcher: Dispatcher<EventOptions<keyof Events>>;

    beforeAll(async() => {
      jest.clearAllMocks();

      await subscriber.initialize();

      await subscriber.flushall();

      const eventsValidationFn = new Map();

      for (const [name, validationSchema] of Object.entries(EventsSchemas)) {
        eventsValidationFn.set(name, ajv.compile(validationSchema));
      }

      dispatcher = new Dispatcher({
        name: "foo",
        redis,
        subscriber,
        logger,
        eventsValidation: {
          eventsValidationFn
        },
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
      await subscriber.close();
    });

    test("Dispatcher should be defined", () => {
      expect(dispatcher).toBeInstanceOf(Dispatcher);
      expect(dispatcher.privateUUID).toBeDefined();
    });

    describe("On any channel", () => {
      test(`Publishing a message without event,
            it should log a new Error with the message "Malformed message"`,
      async() => {
        const channel = new Channel({
          redis,
          name: "dispatcher"
        });

        const event = {
          data: {
            foo: "bar"
          },
          redisMetadata: {
            origin: "foo",
            transactionId: "bar"
          }
        };

        await channel.pub(event);

        await timers.setTimeout(1_000);

        expect(mockedLoggerError).toHaveBeenCalledWith({ channel: "dispatcher", message: event, error: "Malformed message" });
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
      });

      test(`Publishing a message without redisMetadata,
            it should log a new Error with the message "Malformed message"`,
      async() => {
        const channel = new Channel({
          redis,
          name: "dispatcher"
        });

        const event = {
          name: "foo",
          data: {
            foo: "bar"
          }
        };

        await channel.pub(event);

        await timers.setTimeout(1_000);

        const mockLogs = mockedLoggerError.mock.calls.flat();
        expect(mockLogs).toEqual(expect.arrayContaining([
          expect.objectContaining({
            channel: "dispatcher",
            message: event,
            error: expect.anything()
          }),
          expect.anything()
        ]));
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
      });

      test("Publishing an unknown event, it should log a new Error with the message `Unknown Event`", async() => {
        const channel = new Channel({
          redis,
          name: "dispatcher"
        });

        const event = {
          name: "bar",
          data: {
            foo: "bar"
          },
          redisMetadata: {
            origin: "foo",
            transactionId: "bar"
          }
        };

        await channel.pub(event);

        await timers.setTimeout(1_000);

        const mockLogs = mockedLoggerError.mock.calls.flat();
        expect(mockLogs).toEqual(expect.arrayContaining([
          expect.objectContaining({
            channel: "dispatcher",
            message: event,
            error: expect.anything()
          }),
          expect.anything()
        ]));
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
      });
    });

    describe("Publishing on the dispatcher channel", () => {
      describe("Publishing well formed register event", () => {
        let incomerName = "foo";
        let uuid = randomUUID();
        let approved = false;

        beforeAll(async() => {
          await redis.flushdb();
          jest.clearAllMocks();

          await subscriber.subscribe("dispatcher");

          subscriber.on("message", async(channel, message) => {
            const formattedMessage = JSON.parse(message);

            if (formattedMessage.name && formattedMessage.name === "APPROVEMENT") {
              approved = true;
            }
          });

          const channel = new Channel({
            redis,
            name: "dispatcher"
          });

          const event = {
            name: "REGISTER",
            data: {
              name: incomerName,
              eventsCast: [],
              eventsSubscribe: []
            },
            redisMetadata: {
              origin: uuid
            }
          }

          const incomerTransactionStore = new TransactionStore({
            adapter: redis as RedisAdapter<Transaction<"incomer">>,
            prefix: uuid,
            instance: "incomer"
          });

          const transaction = await incomerTransactionStore.setTransaction({
            ...event,
            redisMetadata: {
              ...event.redisMetadata,
              mainTransaction: true,
              relatedTransaction: null,
              resolved: false,
              incomerName
            }
          });

          await channel.pub({
            ...event,
            redisMetadata: {
              origin: uuid,
              transactionId: transaction.redisMetadata.transactionId
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
          redis,
          name: "dispatcher"
        });

        const event = {
          name: "foo",
          data: {
            foo: "bar"
          },
          redisMetadata: {
            origin: "foo",
            transactionId: "bar"
          }
        };

        await channel.pub(event);

        await timers.setTimeout(1_000);

        expect(mockedLoggerError).toHaveBeenCalledWith({ channel: "dispatcher", message: event, error: "Unknown event on Dispatcher Channel" });
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
      });
    });

    describe("Publishing on a dedicated channel", () => {
      beforeAll(async() => {
        await redis.flushdb();
        jest.clearAllMocks();
      });

      test("it should be calling handleIncomerMessages", async() => {
        const channel = new Channel({
          redis,
          name: "foo"
        });

        // eslint-disable-next-line dot-notation
        await dispatcher["subscriber"]!.subscribe("foo");

        await channel.pub({
          name: "foo",
          data: {
            foo: "foo"
          },
          redisMetadata: {
            origin: "bar",
            transactionId: "1"
          }
        });

        await timers.setTimeout(1_000);

        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).toHaveBeenCalled();
      });

      describe("Publishing an injected event", () => {
        const firstIncomerName = "foo";
        const firstUuid = randomUUID();
        const secondIncomerName = "bar";
        const secondUuid = randomUUID();
        let firstIncomerProvidedUUID;
        let secondIncomerProvidedUUID: string;
        let hasDistributedEvents = false;
        let firstIncomerTransactionStore: TransactionStore<"incomer">;
        let secondIncomerTransactionStore: TransactionStore<"incomer">;
        let mainTransactionId: string | null | undefined;

        beforeAll(async() => {
          await subscriber.subscribe("dispatcher");

          subscriber.on("message", async(channel, message) => {
            const formattedMessage = JSON.parse(message);

            if (channel === "dispatcher") {
              if (formattedMessage.name === "APPROVEMENT") {
                const uuid = formattedMessage.data.uuid;

                if (formattedMessage.redisMetadata.to === firstUuid) {
                  firstIncomerProvidedUUID = uuid;

                  firstIncomerTransactionStore = new TransactionStore({
                    adapter: redis as RedisAdapter<Transaction<"incomer">>,
                    prefix: uuid,
                    instance: "incomer"
                  });

                  const exclusiveChannel = new Channel({
                    redis,
                    name: firstIncomerProvidedUUID
                  });

                  const event = {
                    name: "foo",
                    data: {
                      foo: "foo"
                    },
                    redisMetadata: {
                      origin: firstIncomerProvidedUUID
                    }
                  }

                  const mainTransaction = await firstIncomerTransactionStore.setTransaction({
                    ...event,
                    redisMetadata: {
                      ...event.redisMetadata,
                      mainTransaction: true,
                      relatedTransaction: null,
                      resolved: false,
                      incomerName: firstIncomerName
                    }
                  });
                  mainTransactionId = mainTransaction.redisMetadata.transactionId;

                  await exclusiveChannel.pub({
                    ...event,
                    redisMetadata: {
                      ...event.redisMetadata,
                      transactionId: mainTransactionId
                    }
                  });
                }
                else {
                  secondIncomerProvidedUUID = uuid;
                  secondIncomerTransactionStore = new TransactionStore({
                    adapter: redis as RedisAdapter<Transaction<"incomer">>,
                    prefix: secondIncomerProvidedUUID,
                    instance: "incomer"
                  });
                }

                await subscriber.subscribe(secondIncomerProvidedUUID);
              }
            }
            else {
              if (channel === secondIncomerProvidedUUID) {
                if (formattedMessage.name === "foo") {
                  hasDistributedEvents = true;
                  await secondIncomerTransactionStore.setTransaction({
                    ...formattedMessage,
                    redisMetadata: {
                      ...formattedMessage.redisMetadata,
                      origin: formattedMessage.redisMetadata.to,
                      mainTransaction: false,
                      relatedTransaction: formattedMessage.redisMetadata.transactionId,
                      resolved: true
                    },
                  });
                }
              }
            }
          });

          const channel = new Channel({
            redis,
            name: "dispatcher"
          });

          const firstEvent = {
            name: "REGISTER",
            data: {
              name: firstIncomerName,
              eventsCast: ["foo"],
              eventsSubscribe: []
            },
            redisMetadata: {
              origin: firstUuid
            }
          };

          const secondEvent = {
            name: "REGISTER",
            data: {
              name: secondIncomerName,
              eventsCast: [],
              eventsSubscribe: [{ name: "foo" }]
            },
            redisMetadata: {
              origin: secondUuid
            }
          };

          firstIncomerTransactionStore = new TransactionStore({
            adapter: redis as RedisAdapter<Transaction<"incomer">>,
            prefix: firstUuid,
            instance: "incomer"
          });

          secondIncomerTransactionStore = new TransactionStore({
            adapter: redis as RedisAdapter<Transaction<"incomer">>,
            prefix: secondUuid,
            instance: "incomer"
          });

          const firstTransaction = await firstIncomerTransactionStore.setTransaction({
            ...firstEvent,
            redisMetadata: {
              ...firstEvent.redisMetadata,
              mainTransaction: true,
              relatedTransaction: null,
              resolved: false,
              incomerName: firstIncomerName
            }
          });

          const secondTransaction = await secondIncomerTransactionStore.setTransaction({
            ...secondEvent,
            redisMetadata: {
              ...secondEvent.redisMetadata,
              mainTransaction: true,
              relatedTransaction: null,
              resolved: false,
              incomerName: secondIncomerName
            }
          });

          await channel.pub({
            ...firstEvent,
            redisMetadata: {
              ...firstEvent.redisMetadata,
              transactionId: firstTransaction.redisMetadata.transactionId
            }
          });

          await channel.pub({
            ...secondEvent,
            redisMetadata: {
              ...secondEvent.redisMetadata,
              transactionId: secondTransaction.redisMetadata.transactionId
            }
          });

          await timers.setTimeout(5_000);
        });

        test("it should have distributed the event & resolve the main transaction", async() => {
          await timers.setTimeout(10_000);

          const transaction = await firstIncomerTransactionStore.getTransactionById(mainTransactionId!);

          expect(transaction).toBeNull();

          expect(mockedLoggerInfo).toHaveBeenCalled();
          expect(mockedHandleIncomerMessages).toHaveBeenCalled();
          expect(hasDistributedEvents).toBe(true);
        });
      });
    });
  });
});
