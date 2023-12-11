// Import Node.js Dependencies
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import {
  Channel,
  getRedis
} from "@myunisoft/redis";
import { Logger } from "pino";

// Import Internal Dependencies
import { TransactionStore } from "../store/transaction.class";
import { Prefix } from "../../../../types";
import { SharedConf } from "./dispatcher.class";
import { DispatcherStore } from "../store/dispatcher.class";

// CONSTANTS
const kDispatcherChannel = "dispatcher";
const kDispatcherTakeLeadEvent = "dispatcher-take_lead";
const kDispatcherApprovementEvent = "dispatcher-approvement";
const kDispatcherRegistrationEvent = "dispatcher-register";

export type PubSubHandlerOptions = SharedConf & {
  dispatcherStore: DispatcherStore;
};

export class PubSubHandler {
  public isLeader = false;

  public instanceName: string;
  public prefix: Prefix;
  public formattedPrefix: string;
  public consumerUUID: string;

  public dispatcherChannel: Channel;
  public providedUUID: string | undefined;

  private dispatcherTransactionStore: TransactionStore<"dispatcher">;
  private dispatcherStore: DispatcherStore;

  private logger: Partial<Logger> & Pick<Logger, "info" | "warn">;

  constructor(options: PubSubHandlerOptions) {
    Object.assign(this, options);

    this.formattedPrefix = `${this.prefix ? `${this.prefix}-` : ""}`;

    this.logger = options.logger.child({ module: "pubsub-handler" });

    this.dispatcherTransactionStore = new TransactionStore({
      instance: "dispatcher",
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
    await this.subscriber.subscribe(this.formattedPrefix + kDispatcherChannel);
    this.subscriber.on("message", async(channel, message) => {
      if (!message) {
        return;
      }

      const parsedMessage = JSON.parse(message);

      try {
        if (!parsedMessage.name || !parsedMessage.redisMetadata) {
          throw new Error("Malformed message");
        }

        if (parsedMessage.redisMetadata.origin === this.consumerUUID) {
          return;
        }

        if (parsedMessage.name === kDispatcherTakeLeadEvent) {
          await this.dispatcherRegistration();

          return;
        }

        if (!this.isLeader) {
          if (parsedMessage.redisMetadata.to === this.consumerUUID) {
            if (parsedMessage.name === kDispatcherApprovementEvent) {
              await this.handleDispatcherApprovement(parsedMessage);
            }
          }

          return;
        }

        if (parsedMessage.name === kDispatcherRegistrationEvent) {
          await this.approveDispatcher(parsedMessage);
        }
      }
      catch (error) {
        this.logger.error(error);
      }
    });
  }

  public async dispatcherRegistration() {
    try {
      const registerEvent = {
        name: kDispatcherRegistrationEvent,
        data: {
          incomerName: this.instanceName,
          eventsSubscribe: [
            {
              name: "foo",
              horizontalScale: true
            }
          ]
        },
        redisMetadata: {
          origin: this.consumerUUID,
          incomerName: this.instanceName,
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
    catch (error) {
      this.logger.error({ error }, "Unable to publish the registration");
    }
  }

  private async approveDispatcher(message: any) {
    const { data, redisMetadata } = message;
    const { transactionId, prefix, origin } = redisMetadata;

    try {
      const transaction = await this.dispatcherTransactionStore.getTransactionById(transactionId);

      if (!transaction) {
        throw new Error("Unknown Transaction");
      }

      const dispatchers = await this.dispatcherStore.getAll();

      for (const dispatcher of dispatchers) {
        if (dispatcher.baseUUID === origin) {
          await this.dispatcherTransactionStore.deleteTransaction(transactionId);

          throw new Error("Forbidden multiple registration for a same instance");
        }
      }

      const now = Date.now();

      const dispatcher = Object.assign({}, {
        ...data,
        baseUUID: origin,
        lastActivity: now,
        aliveSince: now,
        prefix
      });

      if (data.incomerName === this.instanceName) {
        dispatcher.isDispatcherActiveInstance = false;
      }

      const providedUUID = await this.dispatcherStore.set(dispatcher);

      const event = {
        name: kDispatcherApprovementEvent,
        data: {
          providedUUID
        },
        redisMetadata: {
          origin: this.consumerUUID,
          incomerName: this.instanceName,
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
    catch (error) {
      this.logger.error({ error }, `Unable to approve next to the transaction: ${transactionId}`);
    }
  }

  private async handleDispatcherApprovement(message: any) {
    const { data, redisMetadata } = message;
    const { transactionId } = redisMetadata;

    try {
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
    catch (error) {
      this.logger.error({ error }, `Unable to handle approvement next to the transaction: ${transactionId}`);
    }
  }
}
