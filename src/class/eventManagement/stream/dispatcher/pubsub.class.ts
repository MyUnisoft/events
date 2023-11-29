// Import Node.js Dependencies
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import {
  Channel,
  getRedis
} from "@myunisoft/redis";
import { Logger } from "pino";

// Import Internal Dependencies
import { TransactionStore } from "../../../store/transaction.class";
import { IncomerStore } from "../../../store/incomer.class";
import { Prefix } from "../../../../types";
import { SharedConf } from "./dispatcher.class";

// CONSTANTS
const kDispatcherChannel = "dispatcher";

export type PubSubHandlerOptions = SharedConf;

export class PubSubHandler {
  public isLeader = false;

  public prefix: Prefix;

  public dispatcherChannel: Channel;
  public consumerName: string;
  public providedUUID: string | undefined;

  private dispatcherTransactionStore: TransactionStore<"dispatcher">;
  private incomerStore: IncomerStore;

  private logger: Partial<Logger> & Pick<Logger, "info" | "warn">;

  constructor(options: PubSubHandlerOptions) {
    Object.assign(this, options);

    this.logger = options.logger.child({ module: "pubsub-handler" });

    this.dispatcherTransactionStore = new TransactionStore({
      instance: "dispatcher"
    });

    this.incomerStore = new IncomerStore({
      prefix: this.prefix
    });

    this.dispatcherChannel = new Channel({
      name: "dispatcher",
      prefix: this.prefix
    });
  }

  get redis() {
    return getRedis();
  }

  get subscriber() {
    return getRedis("subscriber");
  }

  public async init() {
    await this.subscriber.subscribe(kDispatcherChannel);
    this.subscriber.on("message", async(channel, message) => {
      if (!message) {
        return;
      }

      const parsedMessage = JSON.parse(message);

      if (!parsedMessage.name || !parsedMessage.redisMetadata) {
        throw new Error("Malformed message");
      }

      if (parsedMessage.redisMetadata.origin === this.consumerName) {
        return;
      }

      if (parsedMessage.name === "ok") {
        this.logger.info("here register");
        await this.register();

        return;
      }

      if (!this.isLeader) {
        if (parsedMessage.redisMetadata.to === this.consumerName) {
          if (parsedMessage.name === "dispatcher-approvement") {
            await this.handleApprovement(parsedMessage);
          }
        }

        return;
      }

      if (parsedMessage.name === "dispatcher-register") {
        await this.approveIncomer(parsedMessage);
      }
    });
  }

  public async register() {
    const registerEvent = {
      name: "dispatcher-register",
      data: {
        eventsSubscribe: [
          {
            name: "foo",
            horizontalScale: true
          }
        ]
      },
      redisMetadata: {
        origin: this.consumerName,
        prefix: this.prefix
      }
    };

    const transaction = await this.dispatcherTransactionStore.setTransaction({
      ...registerEvent,
      redisMetadata: {
        ...registerEvent.redisMetadata,
        published: false,
        resolved: false
      }
    } as any);

    await this.dispatcherChannel.publish({
      ...registerEvent,
      redisMetadata: {
        ...registerEvent.redisMetadata,
        transactionId: transaction.redisMetadata.transactionId
      }
    });

    this.logger.info("Asking for registration");
  }

  private async approveIncomer(message: any) {
    const { data, redisMetadata } = message;
    const { transactionId, prefix, origin } = redisMetadata;

    const transaction = await this.dispatcherTransactionStore.getTransactionById(transactionId);

    if (!transaction) {
      throw new Error("Unknown Transaction");
    }

    const dispatchers = await this.incomerStore.getIncomers();

    for (const dispatcher of dispatchers) {
      if (dispatcher.baseUUID === origin) {
        await this.dispatcherTransactionStore.deleteTransaction(transactionId);

        throw new Error("Forbidden multiple registration for a same instance");
      }
    }

    const now = Date.now();

    const incomer = Object.assign({}, {
      ...data,
      baseUUID: origin,
      lastActivity: now,
      aliveSince: now,
      prefix
    });

    const providedUUID = await this.incomerStore.setIncomer(incomer);

    const event = {
      name: "dispatcher-approvement",
      data: {
        providedUUID
      },
      redisMetadata: {
        origin: this.consumerName,
        incomerName: "dispatcher",
        to: redisMetadata.origin
      }
    };

    await Promise.all([
      this.dispatcherChannel.publish({
        ...event,
        redisMetadata: {
          ...event.redisMetadata,
          transactionId
        }
      }),
      this.dispatcherTransactionStore.updateTransaction(transactionId, {
        ...transaction,
        redisMetadata: {
          ...transaction.redisMetadata,
          published: true
        }
      })
    ]);

    this.logger.info(`Approved Incomer with uuid: ${providedUUID}`);
  }

  private async handleApprovement(message: any) {
    const { data, redisMetadata } = message;
    const { transactionId } = redisMetadata;

    const transaction = await this.dispatcherTransactionStore.getTransactionById(transactionId);

    if (!transaction) {
      throw new Error("Unknown Transaction");
    }

    this.providedUUID = data.providedUUID;

    await this.dispatcherTransactionStore.updateTransaction(transactionId, {
      ...transaction,
      redisMetadata: {
        ...transaction.redisMetadata,
        resolved: true
      }
    });

    this.logger.info(`Dispatcher Approved width uuid: ${this.providedUUID}`);
  }
}
