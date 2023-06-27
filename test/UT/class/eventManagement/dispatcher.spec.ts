// Import Node.js Dependencies
import { randomUUID } from "node:crypto";
import timers from "timers/promises";

// Import Third-party Dependencies
import {
  initRedis,
  closeRedis,
  Channel,
  closeAllRedis,
  clearAllKeys
} from "@myunisoft/redis";
import * as Logger from "pino";
import Ajv from "ajv";

// Import Internal Dependencies
import { Dispatcher, EventOptions, Events } from "../../../../src/index";
import * as EventsSchemas from "../../schema/index";
import { TransactionStore } from "../../../../src/class/eventManagement/transaction.class";

// Internal Dependencies Mocks
const logger = Logger.pino({
  level: "debug"
});
const mockedLoggerError = jest.spyOn(logger, "error");
const mockedLoggerInfo = jest.spyOn(logger, "info");

const mockedHandleDispatcherMessages = jest.spyOn(Dispatcher.prototype as any, "handleDispatcherMessages");
const mockedHandleIncomerMessages = jest.spyOn(Dispatcher.prototype as any, "handleIncomerMessages");
const mockedPing = jest.spyOn(Dispatcher.prototype as any, "ping");
const mockedCheckLastActivity = jest.spyOn(Dispatcher.prototype as any, "checkLastActivity");
const mockedHandleInactiveIncomer =  jest.spyOn(Dispatcher.prototype as any, "handleInactiveIncomer");

const mockedSetTransaction = jest.spyOn(TransactionStore.prototype, "setTransaction");

// CONSTANTS
const ajv = new Ajv();

beforeAll(async() => {
  await initRedis({
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST
  });
});

afterAll(async() => {
  await closeAllRedis();
});

describe("Dispatcher", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Dispatcher without options", () => {
    let dispatcher: Dispatcher;
    let subscriber;

    beforeAll(async() => {
      subscriber = await initRedis({
        port: Number(process.env.REDIS_PORT),
        host: process.env.REDIS_HOST
      }, "subscriber");

      dispatcher = new Dispatcher({
        logger,
        pingInterval: 1_600,
        checkLastActivityInterval: 5_000,
        checkTransactionInterval: 2_400,
        idleTime: 5_000
       });


      await clearAllKeys();

      await dispatcher.initialize();
    });

    afterAll(async() => {
      await clearAllKeys();
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

      expect(mockedLoggerError).toHaveBeenCalledWith({ channel: "dispatcher", message: { foo: "bar" }, error: "Malformed message" });
      expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
      expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
    });

    describe("Publishing a well formed register event", () => {
      let incomerName = randomUUID();

      beforeAll(() => {
        jest.clearAllMocks();
      });

      test("without unresolved transaction, it should fail and throw a new Error", async() => {
        const channel = new Channel({
          name: "dispatcher"
        });

        const event = {
          name: "register",
          data: {
            name: incomerName,
            eventsCast: [],
            eventsSubscribe: []
          },
          redisMetadata: {
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

      describe("Publishing a well formed register event but multiple times", () => {
        let channel;
        let incomerTransactionStore: TransactionStore<"incomer">;

        const event = {
          name: "register",
          data: {
            name: incomerName,
            eventsCast: [],
            eventsSubscribe: []
          },
          redisMetadata: {
            origin: incomerName
          }
        };

        beforeAll(async() => {
          channel = new Channel({
            name: "dispatcher"
          });

          // jest.clearAllMocks();

          incomerTransactionStore = new TransactionStore({
            prefix: incomerName,
            instance: "incomer"
          });

          const transactionId = await incomerTransactionStore.setTransaction({
            ...event,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: false
          });

          await channel.publish({
            ...event,
            redisMetadata: {
              ...event.redisMetadata,
              transactionId
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
          const transactionId = await incomerTransactionStore.setTransaction({
            ...event,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: false
          });

          await channel.publish({
            ...event,
            redisMetadata: {
              ...event.redisMetadata,
              transactionId
            }
          });

          await timers.setTimeout(4_000);

          expect(mockedHandleDispatcherMessages).toHaveBeenCalled();
          expect(mockedLoggerError).toHaveBeenLastCalledWith({
            channel: "dispatcher",
            message: {
              ...event,
              redisMetadata: {
                ...event.redisMetadata,
                transactionId
              }
            },
            error: "Forbidden multiple registration for a same instance"
          });
        });
      });
    });

    describe("Handling a ping event", () => {
      let incomerName = randomUUID();
      let pongTransactionId: string;
      let pingTransactionId: string;
      let incomerTransactionStore: TransactionStore<"incomer">;
      let dispatcherTransactionStore: TransactionStore<"dispatcher">

      beforeAll(async() => {
        jest.clearAllMocks();

        let index = 0;

        await subscriber.subscribe("dispatcher");

        subscriber.on("message", async(channel, message) => {
          const formattedMessage = JSON.parse(message);

          if (formattedMessage.name === "approvement") {
            const providedUUID = formattedMessage.data.uuid;

            await subscriber.subscribe(providedUUID);

            incomerTransactionStore = new TransactionStore({
              prefix: providedUUID,
              instance: "incomer"
            });
          }
          else if (formattedMessage.name === "ping" && index === 0) {
            pingTransactionId = formattedMessage.redisMetadata.transactionId;
            pongTransactionId = await incomerTransactionStore.setTransaction({
              ...formattedMessage,
              redisMetadata: {
                ...formattedMessage.redisMetadata,
                origin: formattedMessage.redisMetadata.to
              },
              mainTransaction: false,
              relatedTransaction: formattedMessage.redisMetadata.transactionId,
              resolved: true
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
          name: "register",
          data: {
            name: incomerName,
            eventsCast: [],
            eventsSubscribe: []
          },
          redisMetadata: {
            origin: incomerName
          }
        };

        incomerTransactionStore = new TransactionStore({
          prefix: incomerName,
          instance: "incomer"
        });

        const transactionId = await incomerTransactionStore.setTransaction({
          ...event,
          mainTransaction: true,
          relatedTransaction: null,
          resolved: false
        });

        await channel.publish({
          name: "register",
          data: {
            name: incomerName,
            eventsCast: [],
            eventsSubscribe: []
          },
          redisMetadata: {
            origin: incomerName,
            transactionId
          }
        });
      });

      test("It should have ping and a new transaction should have been create", async() => {
        await timers.setTimeout(2_000);

        expect(mockedPing).toHaveBeenCalled();
        expect(pongTransactionId).toBeDefined();
      });

      test("It should have update the update the incomer last activity", async () => {
        await timers.setTimeout(4_000);

        const pongTransaction = await incomerTransactionStore.getTransactionById(pongTransactionId);
        const pingTransaction = await dispatcherTransactionStore.getTransactionById(pingTransactionId);

        expect(pongTransaction).toBeNull();
        expect(pingTransaction).toBeNull();
        expect(mockedCheckLastActivity).toHaveBeenCalled();
        expect(mockedHandleInactiveIncomer).not.toHaveBeenCalled();
      });

      test("It should remove the inactive incomers", async() => {
        await timers.setTimeout(4_000);

        expect(mockedCheckLastActivity).toHaveBeenCalled();
        expect(mockedHandleInactiveIncomer).toHaveBeenCalled();
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
        host: process.env.REDIS_HOST
      } as any, "subscriber");

      dispatcher = new Dispatcher({
        logger,
        pingInterval: 1_600,
        checkLastActivityInterval: 3_800,
        checkTransactionInterval: 3_000,
        idleTime: 4_000,
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
        let incomerName = randomUUID();
        let approved = false;

        beforeAll(async() => {
          jest.clearAllMocks();

          await subscriber.subscribe(`${prefix}-dispatcher`);

          subscriber.on("message", async(channel, message) => {
            const formattedMessage = JSON.parse(message);

            if (formattedMessage.name && formattedMessage.name === "approvement") {
              approved = true;
            }
          });

          const channel = new Channel({
            name: "dispatcher",
            prefix
          });

          const event = {
            name: "register",
            data: {
              name: incomerName,
              eventsCast: [],
              eventsSubscribe: []
            },
            redisMetadata: {
              origin: incomerName,
              prefix
            }
          }

          const incomerTransactionStore = new TransactionStore({
            prefix: `${prefix}-${incomerName}`,
            instance: "incomer"
          });

          const transactionId = await incomerTransactionStore.setTransaction({
            ...event,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: false
          });


          await channel.publish({
            ...event,
            redisMetadata: {
              origin: incomerName,
              prefix,
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
    });

    describe("Handling a ping event", () => {
      let incomerName = randomUUID();
      let pingResponseTransaction: string;
      let incomerTransactionStore: TransactionStore<"incomer">;

      beforeAll(async() => {
        await clearAllKeys();
        jest.clearAllMocks();

        let index = 0;

        await subscriber.subscribe(`${prefix}-dispatcher`);

        subscriber.on("message", async(channel, message) => {
          const formattedMessage = JSON.parse(message);

          if (formattedMessage.name === "approvement") {
            const providedUUid = formattedMessage.data.uuid;

            incomerTransactionStore = new TransactionStore({
              prefix: `${prefix}-${providedUUid}`,
              instance: "incomer"
            });

            await subscriber.subscribe(`${prefix}-${providedUUid}`);
          }
          else if (formattedMessage.name === "ping" && index === 0) {
            pingResponseTransaction = await incomerTransactionStore.setTransaction({
              ...formattedMessage,
              redisMetadata: {
                ...formattedMessage.redisMetadata,
                prefix,
                origin: formattedMessage.redisMetadata.to
              },
              mainTransaction: false,
              relatedTransaction: formattedMessage.redisMetadata.transactionId,
              resolved: true
            });

            index++;
          }
        });

        const channel = new Channel({
          name: "dispatcher",
          prefix
        });

        const event = {
          name: "register",
          data: {
            name: incomerName,
            eventsCast: [],
            eventsSubscribe: []
          },
          redisMetadata: {
            origin: incomerName,
            prefix
          }
        };

        incomerTransactionStore = new TransactionStore({
          prefix: `${prefix}-${incomerName}`,
          instance: "incomer"
        });

        const transactionId = await incomerTransactionStore.setTransaction({
          ...event,
          mainTransaction: true,
          relatedTransaction: null,
          resolved: false
        });

        await channel.publish({
          name: "register",
          data: {
            name: incomerName,
            eventsCast: [],
            eventsSubscribe: []
          },
          redisMetadata: {
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
        expect(pingResponseTransaction).toBeDefined();
      });

      test("It should have update the update the incomer last activity & remove the ping transaction", async () => {
        await timers.setTimeout(4_000);

        const transaction = await incomerTransactionStore.getTransactionById(pingResponseTransaction);

        expect(transaction).toBeNull();
        expect(mockedCheckLastActivity).toHaveBeenCalled();
        expect(mockedHandleInactiveIncomer).not.toHaveBeenCalled();
      });

      test("It should remove the inactive incomers", async() => {
        await timers.setTimeout(4_000);

        expect(mockedCheckLastActivity).toHaveBeenCalled();
        expect(mockedHandleInactiveIncomer).toHaveBeenCalled();
      });
    });
  });

  describe("Dispatcher with injected schemas", () => {
    let dispatcher: Dispatcher<EventOptions<keyof Events>>;
    let subscriber;

    beforeAll(async() => {
      await clearAllKeys();
      jest.clearAllMocks();

      subscriber = await initRedis({
        port: process.env.REDIS_PORT,
        host: process.env.REDIS_HOST
      } as any, "subscriber");

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

        expect(mockedLoggerError).toHaveBeenCalledWith({ channel: "dispatcher", message: event, error: "Malformed message" });
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

        expect(mockedLoggerError).toHaveBeenCalledWith({ channel: "dispatcher", message: event, error: "Unknown Event" });
        expect(mockedHandleDispatcherMessages).not.toHaveBeenCalled();
        expect(mockedHandleIncomerMessages).not.toHaveBeenCalled();
      });
    });

    describe("Publishing on the dispatcher channel", () => {
      describe("Publishing well formed register event", () => {
        let incomerName = randomUUID();
        let approved = false;

        beforeAll(async() => {
          await clearAllKeys();
          jest.clearAllMocks();

          await subscriber.subscribe("dispatcher");

          subscriber.on("message", async(channel, message) => {
            const formattedMessage = JSON.parse(message);

            if (formattedMessage.name && formattedMessage.name === "approvement") {
              approved = true;
            }
          });

          const channel = new Channel({
            name: "dispatcher"
          });

          const event = {
            name: "register",
            data: {
              name: incomerName,
              eventsCast: [],
              eventsSubscribe: []
            },
            redisMetadata: {
              origin: incomerName
            }
          }

          const incomerTransactionStore = new TransactionStore({
            prefix: incomerName,
            instance: "incomer"
          });

          const transactionId = await incomerTransactionStore.setTransaction({
            ...event,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: false
          });

          await channel.publish({
            ...event,
            redisMetadata: {
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
        await dispatcher["subscriber"].subscribe("foo");

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
        const firstIncomerName = randomUUID();
        const secondIncomerName = randomUUID();
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
              if (formattedMessage.name === "approvement") {
                const uuid = formattedMessage.data.uuid;

                if (formattedMessage.redisMetadata.to === firstIncomerName) {
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

                  mainTransactionId = await firstIncomerTransactionStore.setTransaction({
                    ...event,
                    mainTransaction: true,
                    relatedTransaction: null,
                    resolved: false
                  });

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
                      origin: formattedMessage.redisMetadata.to
                    },
                    mainTransaction: false,
                    relatedTransaction: formattedMessage.redisMetadata.transactionId,
                    resolved: true
                  });
                }
              }
            }
          });

          const channel = new Channel({
            name: "dispatcher"
          });

          const firstEvent = {
            name: "register",
            data: {
              name: firstIncomerName,
              eventsCast: ["foo"],
              eventsSubscribe: []
            },
            redisMetadata: {
              origin: firstIncomerName
            }
          };

          const secondEvent = {
            name: "register",
            data: {
              name: secondIncomerName,
              eventsCast: [],
              eventsSubscribe: [{ name: "foo" }]
            },
            redisMetadata: {
              origin: secondIncomerName
            }
          };

          firstIncomerTransactionStore = new TransactionStore({
            prefix: firstIncomerName,
            instance: "incomer"
          });

          secondIncomerTransactionStore = new TransactionStore({
            prefix: secondIncomerName,
            instance: "incomer"
          });

          const firstTransactionId = await firstIncomerTransactionStore.setTransaction({
            ...firstEvent,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: true
          });

          const secondTransactionId = await secondIncomerTransactionStore.setTransaction({
            ...secondEvent,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: true
          });

          await channel.publish({
            ...firstEvent,
            redisMetadata: {
              ...firstEvent.redisMetadata,
              transactionId: firstTransactionId
            }
          });

          await channel.publish({
            ...secondEvent,
            redisMetadata: {
              ...secondEvent.redisMetadata,
              transactionId: secondTransactionId
            }
          });

          await timers.setTimeout(2_000);
        });

        test("it should have distributed the event & resolve the main transaction", async() => {
          await timers.setTimeout(3_000);

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
      await clearAllKeys();
      jest.clearAllMocks();

      subscriber = await initRedis({
        port: process.env.REDIS_PORT,
        host: process.env.REDIS_HOST
      } as any, "subscriber");

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
        idleTime: 6_000,
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
        await dispatcher["subscriber"].subscribe(`${prefix}-foo`);

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
        const firstIncomerName = randomUUID();
        const secondIncomerName = randomUUID();
        const thirdIncomerName = randomUUID();
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
              if (formattedMessage.name === "approvement") {
                const uuid = formattedMessage.data.uuid;

                if (formattedMessage.redisMetadata.to === firstIncomerName) {
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

                  mainTransactionId = await firstIncomerTransactionStore.setTransaction({
                    ...event,
                    mainTransaction: true,
                    relatedTransaction: null,
                    resolved: false
                  });

                  await exclusiveChannel.publish({
                    ...event,
                    redisMetadata: {
                      ...event.redisMetadata,
                      transactionId: mainTransactionId
                    }
                  });
                }
                else if (formattedMessage.redisMetadata.to === secondIncomerName) {
                  secondIncomerProvidedUUID = uuid;
                  secondIncomerTransactionStore = new TransactionStore({
                    prefix: `${prefix}-${secondIncomerProvidedUUID}`,
                    instance: "incomer"
                  });
                }
                else if (formattedMessage.redisMetadata.to === thirdIncomerName) {
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
                  secondIncomerTransactionId = await secondIncomerTransactionStore.setTransaction({
                    ...formattedMessage,
                    redisMetadata: {
                      ...formattedMessage.redisMetadata,
                      origin: formattedMessage.redisMetadata.to
                    },
                    mainTransaction: false,
                    relatedTransaction: formattedMessage.redisMetadata.transactionId,
                    resolved: true
                  });
                }
              }
              else if (channel === `${prefix}-${thirdIncomerProvidedUUID}`) {
                if (formattedMessage.name === "foo") {
                  setTimeout(async() => {
                    hasDistributedEvents[1] = true;
                    thirdIncomerTransactionId = await thirdIncomerTransactionStore.setTransaction({
                      ...formattedMessage,
                      redisMetadata: {
                        ...formattedMessage.redisMetadata,
                        origin: formattedMessage.redisMetadata.to
                      },
                      mainTransaction: false,
                      relatedTransaction: formattedMessage.redisMetadata.transactionId,
                      resolved: true
                    });
                  }, 1600);
                }
              }
            }
          });

          const channel = new Channel({
            name: "dispatcher",
            prefix
          });

          const firstEvent = {
            name: "register",
            data: {
              name: firstIncomerName,
              eventsCast: ["foo"],
              eventsSubscribe: []
            },
            redisMetadata: {
              origin: firstIncomerName,
              prefix
            }
          };

          const secondEvent = {
            name: "register",
            data: {
              name: secondIncomerName,
              eventsCast: [],
              eventsSubscribe: [{ name: "foo", horizontalScale: true }]
            },
            redisMetadata: {
              origin: secondIncomerName,
              prefix
            }
          };

          const thirdEvent = {
            name: "register",
            data: {
              name: thirdIncomerName,
              eventsCast: [],
              eventsSubscribe: [{ name: "foo", horizontalScale: true }]
            },
            redisMetadata: {
              origin: thirdIncomerName,
              prefix
            }
          };

          firstIncomerTransactionStore = new TransactionStore({
            prefix: `${prefix}-${firstIncomerName}`,
            instance: "incomer"
          });

          secondIncomerTransactionStore = new TransactionStore({
            prefix: `${prefix}-${secondIncomerName}`,
            instance: "incomer"
          });

          thirdIncomerTransactionStore = new TransactionStore({
            prefix: `${prefix}-${thirdIncomerName}`,
            instance: "incomer"
          });

          const firstTransactionId = await firstIncomerTransactionStore.setTransaction({
            ...firstEvent,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: false
          });

          const secondTransactionId = await secondIncomerTransactionStore.setTransaction({
            ...secondEvent,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: false
          });

          const thirdTransactionId = await thirdIncomerTransactionStore.setTransaction({
            ...thirdEvent,
            mainTransaction: true,
            relatedTransaction: null,
            resolved: false
          });

          await Promise.all([
            channel.publish({
              ...firstEvent,
              redisMetadata: {
                ...firstEvent.redisMetadata,
                transactionId: firstTransactionId
              }
            }),
            channel.publish({
              ...secondEvent,
              redisMetadata: {
                ...secondEvent.redisMetadata,
                transactionId: secondTransactionId
              }
            }),
            channel.publish({
              ...thirdEvent,
              redisMetadata: {
                ...thirdEvent.redisMetadata,
                transactionId: thirdTransactionId
              }
            })
          ]);

          await timers.setTimeout(2_000);
        });

        test("it should have distributed the event & resolve the main transaction", async() => {
          await timers.setTimeout(10_000);

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
