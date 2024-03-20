// Import Node.js Dependencies
import { randomUUID } from "node:crypto";
import timers from "timers/promises";

// Import Third-party Dependencies
import {
  initRedis,
  closeRedis,
  Channel,
  closeAllRedis,
  clearAllKeys,
  getRedis
} from "@myunisoft/redis";
import * as Logger from "pino";
import Ajv from "ajv";

// Import Internal Dependencies
import { Dispatcher, EventOptions, Events } from "../../../../src/index";
import * as EventsSchemas from "../../schema/index";
import { Transaction, TransactionStore } from "../../../../src/class/store/transaction.class";
import { TransactionHandler } from "../../../../src/class/eventManagement/dispatcher/transaction-handler.class";
import { EventsHandler } from "../../../../src/class/eventManagement/dispatcher/events.class";

// Internal Dependencies Mocks
const logger = Logger.pino({
  level: "debug"
});
const mockedLoggerError = jest.spyOn(logger, "error");
const mockedLoggerInfo = jest.spyOn(logger, "info");

const mockedHandleDispatcherMessages = jest.spyOn(Dispatcher.prototype as any, "approveIncomer");
const mockedHandleIncomerMessages = jest.spyOn(Dispatcher.prototype as any, "handleCustomEvents");
const mockedPing = jest.spyOn(Dispatcher.prototype as any, "ping");
const mockedCheckLastActivity = jest.spyOn(Dispatcher.prototype as any, "checkLastActivityIntervalFn");
const mockedHandleInactiveIncomer =  jest.spyOn(TransactionHandler.prototype, "resolveInactiveIncomerTransactions");

const mockedSetTransaction = jest.spyOn(TransactionStore.prototype, "setTransaction");

// CONSTANTS
const ajv = new Ajv();

describe("Dispatcher", () => {
  afterEach(async() => {
    jest.clearAllMocks();
  });

  beforeAll(async() => {
    await initRedis({
      port: Number(process.env.REDIS_PORT),
      host: process.env.REDIS_HOST,
      enableAutoPipelining: true
    });

    await getRedis()!.flushall();
  });

  afterAll(async() => {
    await closeAllRedis();
  });

  describe("Dispatcher without options", () => {
    let dispatcher: Dispatcher;
    let subscriber;

    beforeAll(async() => {
      subscriber = await initRedis({
        port: Number(process.env.REDIS_PORT),
        host: process.env.REDIS_HOST,
        enableAutoPipelining: true
      }, "subscriber");

      dispatcher = new Dispatcher({
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
      await closeRedis("subscriber");
    });

    test("Dispatcher should be defined", () => {
      expect(dispatcher).toBeInstanceOf(Dispatcher);
      expect(dispatcher.prefix).toBe("");
      expect(dispatcher.privateUUID).toBeDefined();
    });

    test("Publishing a malformed message, it should log a new Error", async() => {
      const channel = new Channel({
        name: "dispatcher"
      });

      await channel.publish({ foo: "bar" });

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
        await clearAllKeys();
      });

      test("without unresolved transaction, it should fail and throw a new Error", async() => {
        const channel = new Channel({
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

        await channel.publish(event);

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
        let channel;
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
            name: "dispatcher"
          });

          incomerTransactionStore = new TransactionStore({
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

          await channel.publish({
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

          await channel.publish({
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
      let pongTransaction: Transaction<"incomer">;
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
              prefix: providedUUID,
              instance: "incomer"
            });
          }
          else if (formattedMessage.name === "PING" && index === 0) {
            pingTransactionId = formattedMessage.redisMetadata.transactionId;
            pongTransaction = await incomerTransactionStore.setTransaction({
              ...formattedMessage,
              redisMetadata: {
                ...formattedMessage.redisMetadata,
                origin: formattedMessage.redisMetadata.to,
                mainTransaction: false,
                relatedTransaction: formattedMessage.redisMetadata.transactionId,
                resolved: true
              },
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

        await channel.publish({
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
        expect(pongTransaction).toBeDefined();
      });

      test("It should have update the update the incomer last activity", async () => {
        await timers.setTimeout(10_000);

        const pongTransactionToRetrieve = await incomerTransactionStore.getTransactionById(pongTransaction.redisMetadata.transactionId!);
        const pingTransaction = await dispatcherTransactionStore.getTransactionById(pingTransactionId);

        expect(pongTransactionToRetrieve).toBeNull();
        expect(pingTransaction).toBeNull();
        expect(mockedCheckLastActivity).toHaveBeenCalled();
      });
    });
  });

  describe("Dispatcher with prefix", () => {
    let dispatcher: Dispatcher;
    let prefix = "test" as const;
    let subscriber;

    beforeAll(async() => {
      subscriber = await initRedis({
        port: process.env.REDIS_PORT,
        host: process.env.REDIS_HOST,
        enableAutoPipelining: true
      } as any, "subscriber");

      await subscriber.flushall();

      dispatcher = new Dispatcher({
        logger,
        pingInterval: 1_600,
        checkLastActivityInterval: 2_000,
        checkTransactionInterval: 2_000,
        idleTime: 8_000,
        prefix
      });

      await dispatcher.initialize();
    });

    afterAll(async() => {
      await dispatcher.close();
      await closeRedis("subscriber");
    });

    test("Dispatcher should be defined", () => {
      expect(dispatcher).toBeInstanceOf(Dispatcher);
      expect(dispatcher.formattedPrefix).toBe("test-");
      expect(dispatcher.privateUUID).toBeDefined();
    });

    describe("Publishing on the dispatcher channel", () => {
      describe("Publishing well formed register event", () => {
        let incomerName = "foo";
        let uuid = randomUUID();
        let approved = false;

        beforeAll(async() => {
          jest.clearAllMocks();

          await subscriber.subscribe(`${prefix}-dispatcher`);

          subscriber.on("message", async(channel, message) => {
            const formattedMessage = JSON.parse(message);

            if (formattedMessage.name && formattedMessage.name === "APPROVEMENT") {
              approved = true;
            }
          });

          const channel = new Channel({
            name: "dispatcher",
            prefix
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
              prefix
            }
          }

          const incomerTransactionStore = new TransactionStore({
            prefix: `${prefix}-${uuid}`,
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


          await channel.publish({
            ...event,
            redisMetadata: {
              origin: uuid,
              prefix,
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
    });

    describe("Handling a ping event", () => {
      let incomerName = "foo";
      let uuid = randomUUID();
      let pongTransaction: Transaction<"incomer">;
      let incomerTransactionStore: TransactionStore<"incomer">;

      beforeAll(async() => {
        await clearAllKeys();
        jest.clearAllMocks();

        let index = 0;

        await subscriber.subscribe(`${prefix}-dispatcher`);

        subscriber.on("message", async(channel, message) => {
          const formattedMessage = JSON.parse(message);

          if (formattedMessage.name === "APPROVEMENT") {
            const providedUUid = formattedMessage.data.uuid;

            incomerTransactionStore = new TransactionStore({
              prefix: `${prefix}-${providedUUid}`,
              instance: "incomer"
            });

            await subscriber.subscribe(`${prefix}-${providedUUid}`);
          }
          else if (formattedMessage.name === "PING" && index === 0) {
            pongTransaction = await incomerTransactionStore.setTransaction({
              ...formattedMessage,
              redisMetadata: {
                ...formattedMessage.redisMetadata,
                prefix,
                origin: formattedMessage.redisMetadata.to,
                mainTransaction: false,
                relatedTransaction: formattedMessage.redisMetadata.transactionId,
                resolved: true
              },
            });

            index++;
          }
        });

        const channel = new Channel({
          name: "dispatcher",
          prefix
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
            prefix
          }
        };

        incomerTransactionStore = new TransactionStore({
          prefix: `${prefix}-${uuid}`,
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

        await channel.publish({
          name: "REGISTER",
          data: {
            name: incomerName,
            eventsCast: [],
            eventsSubscribe: []
          },
          redisMetadata: {
            origin: uuid,
            prefix,
            transactionId: transaction.redisMetadata.transactionId
          }
        });

        await timers.setTimeout(1_000);
      });

      test("It should have ping and a new transaction should have been create", async() => {
        await timers.setTimeout(3_000);

        expect(mockedPing).toHaveBeenCalled();
        expect(pongTransaction).toBeDefined();
      });

      test("It should have update the update the incomer last activity & remove the ping transaction", async () => {
        await timers.setTimeout(4_000);

        const transaction = await incomerTransactionStore.getTransactionById(pongTransaction.redisMetadata.transactionId!);

        expect(transaction).toBeNull();
        expect(mockedCheckLastActivity).toHaveBeenCalled();
        expect(mockedHandleInactiveIncomer).not.toHaveBeenCalled();
      });

      test("It should remove the inactive incomers", async() => {
        await timers.setTimeout(8_000);

        expect(mockedCheckLastActivity).toHaveBeenCalled();
        expect(mockedHandleInactiveIncomer).toHaveBeenCalled();
      });
    });
  });

  describe("Dispatcher with injected schemas", () => {
    let dispatcher: Dispatcher<EventOptions<keyof Events>>;
    let subscriber;

    beforeAll(async() => {
      jest.clearAllMocks();

      subscriber = await initRedis({
        port: process.env.REDIS_PORT,
        host: process.env.REDIS_HOST,
        enableAutoPipelining: true
      } as any, "subscriber");

      await subscriber.flushall();

      const eventsValidationFn = new Map();

      for (const [name, validationSchema] of Object.entries(EventsSchemas)) {
        eventsValidationFn.set(name, ajv.compile(validationSchema));
      }

      dispatcher = new Dispatcher({
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
      await closeRedis("subscriber");
    });

    test("Dispatcher should be defined", () => {
      expect(dispatcher).toBeInstanceOf(Dispatcher);
      expect(dispatcher.prefix).toBe("");
      expect(dispatcher.privateUUID).toBeDefined();
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
          redisMetadata: {
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

      test(`Publishing a message without redisMetadata,
            it should log a new Error with the message "Malformed message"`,
      async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        const event = {
          name: "foo",
          data: {
            foo: "bar"
          }
        };

        await channel.publish(event);

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

        await channel.publish(event);

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
          await clearAllKeys();
          jest.clearAllMocks();

          await subscriber.subscribe("dispatcher");

          subscriber.on("message", async(channel, message) => {
            const formattedMessage = JSON.parse(message);

            if (formattedMessage.name && formattedMessage.name === "APPROVEMENT") {
              approved = true;
            }
          });

          const channel = new Channel({
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

          await channel.publish({
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

        await channel.publish(event);

        await timers.setTimeout(1_000);

        expect(mockedLoggerError).toHaveBeenCalledWith({ channel: "dispatcher", message: event, error: "Unknown event on Dispatcher Channel" });
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
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
        await dispatcher["subscriber"]!.subscribe("foo");

        await channel.publish({
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
        let secondIncomerProvidedUUID;
        let hasDistributedEvents = false;
        let firstIncomerTransactionStore: TransactionStore<"incomer">;
        let secondIncomerTransactionStore: TransactionStore<"incomer">;
        let mainTransactionId;

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
                    prefix: uuid,
                    instance: "incomer"
                  });

                  const exclusiveChannel = new Channel({
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

                  await exclusiveChannel.publish({
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
            prefix: firstUuid,
            instance: "incomer"
          });

          secondIncomerTransactionStore = new TransactionStore({
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

          await channel.publish({
            ...firstEvent,
            redisMetadata: {
              ...firstEvent.redisMetadata,
              transactionId: firstTransaction.redisMetadata.transactionId
            }
          });

          await channel.publish({
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

          const transaction = await firstIncomerTransactionStore.getTransactionById(mainTransactionId);

          expect(transaction).toBeNull();

          expect(mockedLoggerInfo).toHaveBeenCalled();
          expect(mockedHandleIncomerMessages).toHaveBeenCalled();
          expect(hasDistributedEvents).toBe(true);
        });
      });
    });
  });

  describe("Dispatcher with prefix & injected schema", () => {
    let dispatcher: Dispatcher<EventOptions<keyof Events>>;
    let prefix = "test" as "test";
    let subscriber;

    beforeAll(async() => {
      jest.clearAllMocks();

      subscriber = await initRedis({
        port: process.env.REDIS_PORT,
        host: process.env.REDIS_HOST,
        enableAutoPipelining: true
      } as any, "subscriber");

      await subscriber.flushall();

      const eventsValidationFn = new Map();

      for (const [name, validationSchema] of Object.entries(EventsSchemas)) {
        eventsValidationFn.set(name, ajv.compile(validationSchema));
      }

      dispatcher = new Dispatcher({
        logger,
        eventsValidation: {
          eventsValidationFn
        },
        pingInterval: 20_000,
        checkLastActivityInterval: 6_000,
        checkTransactionInterval: 2_000,
        idleTime: 60_000,
        prefix
      });

      Reflect.set(dispatcher, "logger", logger);

      await dispatcher.initialize();
    });

    afterAll(async() => {
      await dispatcher.close();
      await closeRedis("subscriber");
    });

    test("Dispatcher should be defined", () => {
      expect(dispatcher).toBeInstanceOf(Dispatcher);
      expect(dispatcher.formattedPrefix).toBe("test-");
      expect(dispatcher.privateUUID).toBeDefined();
    });

    describe("Publishing on a dedicated channel", () => {
      beforeAll(async() => {
        await clearAllKeys();
        jest.clearAllMocks();
      });

      test("it should be calling handleIncomerMessages", async() => {
        const channel = new Channel({
          name: "foo",
          prefix
        });

        // eslint-disable-next-line dot-notation
        await dispatcher["subscriber"]!.subscribe(`${prefix}-foo`);

        await channel.publish({
          name: "foo",
          data: {
            foo: "foo"
          },
          redisMetadata: {
            origin: "bar",
            transactionId: "1",
            prefix
          }
        });

        await timers.setTimeout(1_000);

        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).toHaveBeenCalled();
      });

      describe("Publishing an injected event", () => {
        const firstIncomerName = "foo";
        const firstIncomerUuid = randomUUID();
        const secondIncomerName = "bar";
        const secondIncomerUuid = randomUUID();
        const thirdIncomerName = "foo-bar";
        const thirdIncomerUuid = randomUUID();
        let firstIncomerProvidedUUID;
        let secondIncomerProvidedUUID;
        let thirdIncomerProvidedUUID;
        let hasDistributedEvents: [boolean, boolean] = [false, false];
        let firstIncomerTransactionStore: TransactionStore<"incomer">;
        let secondIncomerTransactionStore: TransactionStore<"incomer">;
        let thirdIncomerTransactionStore: TransactionStore<"incomer">;
        let mainTransactionId;
        let secondIncomerTransactionId;
        let thirdIncomerTransactionId;

        beforeAll(async() => {
          await subscriber.subscribe(`${prefix}-dispatcher`);

          subscriber.on("message", async(channel, message) => {
            const formattedMessage = JSON.parse(message);

            if (channel === `${prefix}-dispatcher`) {
              if (formattedMessage.name === "APPROVEMENT") {
                const uuid = formattedMessage.data.uuid;

                if (formattedMessage.redisMetadata.to === firstIncomerUuid) {
                  firstIncomerProvidedUUID = uuid;

                  firstIncomerTransactionStore = new TransactionStore({
                    prefix: `${prefix}-${uuid}`,
                    instance: "incomer"
                  });

                  const exclusiveChannel = new Channel({
                    name: firstIncomerProvidedUUID,
                    prefix
                  });

                  const event = {
                    name: "foo",
                    data: {
                      foo: "foo"
                    },
                    redisMetadata: {
                      origin: firstIncomerProvidedUUID,
                      prefix
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

                  await exclusiveChannel.publish({
                    ...event,
                    redisMetadata: {
                      ...event.redisMetadata,
                      transactionId: mainTransactionId
                    }
                  });
                }
                else if (formattedMessage.redisMetadata.to === secondIncomerUuid) {
                  secondIncomerProvidedUUID = uuid;
                  secondIncomerTransactionStore = new TransactionStore({
                    prefix: `${prefix}-${secondIncomerProvidedUUID}`,
                    instance: "incomer"
                  });
                }
                else if (formattedMessage.redisMetadata.to === thirdIncomerUuid) {
                  thirdIncomerProvidedUUID = uuid;
                  thirdIncomerTransactionStore = new TransactionStore({
                    prefix: `${prefix}-${thirdIncomerProvidedUUID}`,
                    instance: "incomer"
                  });
                }

                await Promise.all([
                  subscriber.subscribe(`${prefix}-${secondIncomerProvidedUUID}`),
                  subscriber.subscribe(`${prefix}-${thirdIncomerProvidedUUID}`)
                ]);
              }
            }
            else {
              if (channel === `${prefix}-${secondIncomerProvidedUUID}`) {
                if (formattedMessage.name === "foo") {
                  hasDistributedEvents[0] = true;
                  const secondIncomerTransaction = await secondIncomerTransactionStore.setTransaction({
                    ...formattedMessage,
                    redisMetadata: {
                      ...formattedMessage.redisMetadata,
                      origin: formattedMessage.redisMetadata.to,
                      mainTransaction: false,
                      relatedTransaction: formattedMessage.redisMetadata.transactionId,
                      resolved: true
                    },
                  });
                  secondIncomerTransactionId = secondIncomerTransaction.redisMetadata.transactionId;
                }
              }
              else if (channel === `${prefix}-${thirdIncomerProvidedUUID}`) {
                if (formattedMessage.name === "foo") {
                  hasDistributedEvents[1] = true;
                  const secondIncomerTransaction = await thirdIncomerTransactionStore.setTransaction({
                    ...formattedMessage,
                    redisMetadata: {
                      ...formattedMessage.redisMetadata,
                      origin: formattedMessage.redisMetadata.to,
                      mainTransaction: false,
                      relatedTransaction: formattedMessage.redisMetadata.transactionId,
                      resolved: true
                    },
                  });
                  thirdIncomerTransactionId = secondIncomerTransaction.redisMetadata.transactionId;
                }
              }
            }
          });

          const channel = new Channel({
            name: "dispatcher",
            prefix
          });

          const firstEvent = {
            name: "REGISTER",
            data: {
              name: firstIncomerName,
              eventsCast: ["foo"],
              eventsSubscribe: []
            },
            redisMetadata: {
              origin: firstIncomerUuid,
              prefix
            }
          };

          const secondEvent = {
            name: "REGISTER",
            data: {
              name: secondIncomerName,
              eventsCast: [],
              eventsSubscribe: [{ name: "foo", horizontalScale: true }]
            },
            redisMetadata: {
              origin: secondIncomerUuid,
              prefix
            }
          };

          const thirdEvent = {
            name: "REGISTER",
            data: {
              name: thirdIncomerName,
              eventsCast: [],
              eventsSubscribe: [{ name: "foo", horizontalScale: true }]
            },
            redisMetadata: {
              origin: thirdIncomerUuid,
              prefix
            }
          };

          firstIncomerTransactionStore = new TransactionStore({
            prefix: `${prefix}-${firstIncomerUuid}`,
            instance: "incomer"
          });

          secondIncomerTransactionStore = new TransactionStore({
            prefix: `${prefix}-${secondIncomerUuid}`,
            instance: "incomer"
          });

          thirdIncomerTransactionStore = new TransactionStore({
            prefix: `${prefix}-${thirdIncomerUuid}`,
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

          const thirdTransaction = await thirdIncomerTransactionStore.setTransaction({
            ...thirdEvent,
            redisMetadata: {
              ...thirdEvent.redisMetadata,
              mainTransaction: true,
              relatedTransaction: null,
              resolved: false,
              incomerName: thirdIncomerName
            }
          });

          await Promise.all([
            channel.publish({
              ...firstEvent,
              redisMetadata: {
                ...firstEvent.redisMetadata,
                transactionId: firstTransaction.redisMetadata.transactionId
              }
            }),
            channel.publish({
              ...secondEvent,
              redisMetadata: {
                ...secondEvent.redisMetadata,
                transactionId: secondTransaction.redisMetadata.transactionId
              }
            }),
            channel.publish({
              ...thirdEvent,
              redisMetadata: {
                ...thirdEvent.redisMetadata,
                transactionId: thirdTransaction.redisMetadata.transactionId
              }
            })
          ]);

          await timers.setTimeout(20_000);
        });

        test("it should have distributed the event & resolve the main transaction", async() => {
          await timers.setTimeout(25_000);

          const [mainTransaction, secondIncomerTransaction, thirdIncomerTransaction] = await Promise.all([
            firstIncomerTransactionStore.getTransactionById(mainTransactionId),
            secondIncomerTransactionStore.getTransactionById(secondIncomerTransactionId),
            thirdIncomerTransactionStore.getTransactionById(thirdIncomerTransactionId)
          ]);

          expect(mockedLoggerInfo).toHaveBeenCalled();
          expect(mockedHandleIncomerMessages).toHaveBeenCalled();
          expect(hasDistributedEvents).toStrictEqual([true, true]);
          expect(mainTransaction).toBeNull();
          expect(secondIncomerTransaction).toBeNull();
          expect(thirdIncomerTransaction).toBeNull();
        });
      });
    });
  });
});
