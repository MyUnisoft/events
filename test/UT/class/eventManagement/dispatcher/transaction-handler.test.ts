// Import Node.js Dependencies
import assert from "node:assert";
import { describe, before, after, test } from "node:test";
import { randomUUID } from "node:crypto";

// Import Third-Party Dependencies
import {
  closeAllRedis,
  closeRedis,
  initRedis,
  Redis
} from "@myunisoft/redis";
import pino, { Logger } from "pino";

// Import Internal Dependencies
import {
  TransactionHandler
} from "../../../../../src/class/eventManagement/dispatcher/transaction-handler.class";
import { TransactionStore } from "../../../../../src/class/store/transaction.class";
import { IncomerChannelHandler } from "../../../../../src/class/eventManagement/dispatcher/incomer-channel.class";
import { IncomerStore } from "../../../../../src/class/store/incomer.class";
import { EventsHandler } from "../../../../../src/class/eventManagement/dispatcher/events.class";
import { GenericEvent } from "../../../../../src/types";
import { createResolvedTransactions } from "../../../../fixtures/transactions";

// CONSTANTS
const kPrefix = "test";
const kDispatcher = "dispatcher";
const kBackupTransactionStoreName = "backup";
const kIdleTime = 60_000;

describe("transactionHandler", () => {
  let redis: Redis;

  before(async() => {
    await initRedis({
      port: Number(process.env.REDIS_PORT),
      host: process.env.REDIS_HOST
    });

    redis = await initRedis({
      port: Number(process.env.REDIS_PORT),
      host: process.env.REDIS_HOST
    }, undefined, true);

    await redis.flushall();
  });

  after(async() => {
    await closeAllRedis();
    await closeRedis(undefined, redis);
  });

  describe("transactionHandler with default options", () => {
    const formattedPrefix: string = `${kPrefix}-`;
    const privateUUID: string = randomUUID();

    const logger: Logger = pino({
      name: formattedPrefix + kDispatcher,
      level: "debug",
      transport: {
        target: "pino-pretty"
      }
    });

    const incomerStore: IncomerStore = new IncomerStore({
      prefix: kPrefix,
      idleTime: kIdleTime
    });

    const dispatcherTransactionStore: TransactionStore<"dispatcher"> = new TransactionStore({
      prefix: kPrefix,
      instance: "dispatcher"
    });

    const backupDispatcherTransactionStore: TransactionStore<"dispatcher"> = new TransactionStore({
      prefix: formattedPrefix + kBackupTransactionStoreName,
      instance: "dispatcher"
    });

    const backupIncomerTransactionStore: TransactionStore<"incomer"> = new TransactionStore({
      prefix: formattedPrefix + kBackupTransactionStoreName,
      instance: "incomer"
    });

    const incomerChannelHandler: IncomerChannelHandler = new IncomerChannelHandler({
      logger
    });

    const eventsHandler: EventsHandler<GenericEvent> = new EventsHandler({
      privateUUID,
      dispatcherChannelName: kDispatcher,
      parentLogger: logger
    })

    const transactionHandler: TransactionHandler = new TransactionHandler({
      privateUUID,
      formattedPrefix,
      incomerStore,
      dispatcherTransactionStore,
      backupDispatcherTransactionStore,
      backupIncomerTransactionStore,
      incomerChannelHandler,
      eventsHandler,
      parentLogger: logger
    });

    test("transactionHandler must have property \"logger\" and \"standardLogFn\"", () => {
      assert.ok(transactionHandler["logger"]);
      assert.ok(transactionHandler["standardLogFn"]);
    });

    describe("resolveInactiveIncomerTransactions", () => {
      describe("Given a resolved event", () => {
        const now = Date.now();

        const publisher = {
          name: "publisher",
          eventsCast: [],
          eventsSubscribe: [],
          providedUUID: randomUUID(),
          isDispatcherActiveInstance: false,
          baseUUID: randomUUID(),
          lastActivity: now,
          aliveSince: now
        };
        const dispatcher = {
          name: "dispatcher",
          eventsCast: [],
          eventsSubscribe: [],
          providedUUID: randomUUID(),
          isDispatcherActiveInstance: false,
          baseUUID: randomUUID(),
          lastActivity: now,
          aliveSince: now
        };
        const listener = {
          name: "listener",
          eventsCast: [],
          eventsSubscribe: [],
          providedUUID: randomUUID(),
          isDispatcherActiveInstance: false,
          baseUUID: randomUUID(),
          lastActivity: now,
          aliveSince: now
        };

        const publisherTransactionStore = new TransactionStore({
          prefix: publisher.providedUUID,
          instance: "incomer"
        });

        const listenerTransactionStore = new TransactionStore({
          prefix: listener.providedUUID,
          instance: "incomer"
        });

        let resolvedEvent;

        before(async() => {
          await incomerStore.setIncomer(publisher, publisher.providedUUID);
          await incomerStore.setIncomer(listener, listener.providedUUID);

          resolvedEvent = await createResolvedTransactions({
            publisher: {
              transactionStore: publisherTransactionStore,
              instance: publisher
            },
            dispatcher: {
              transactionStore: dispatcherTransactionStore,
              instance: dispatcher
            },
            event: {
              name: "connector",
              data: {}
            },
            listener: {
              transactionStore: listenerTransactionStore,
              instance: listener
            }
          });
        });

        test("it should backup the handler transaction", async() => {
          await transactionHandler.resolveInactiveIncomerTransactions(listener);

          const resolvedBackupTransaction = (await backupIncomerTransactionStore.getTransactions())
            .get(resolvedEvent.handlerTransaction.redisMetadata.transactionId);

          assert.equal(resolvedBackupTransaction!.redisMetadata.relatedTransaction, resolvedEvent.spreadTransaction.redisMetadata.transactionId);
          assert.equal(resolvedBackupTransaction!.redisMetadata.incomerName, listener.name);
        });
      });
    });
  });
});
