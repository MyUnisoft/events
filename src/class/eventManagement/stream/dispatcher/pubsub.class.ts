// Import Node.js Dependencies
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import {
  Channel,
  Interpersonal,
  Stream,
  getRedis
} from "@myunisoft/redis";
import { Logger } from "pino";

// Import Internal Dependencies
import { TransactionStore } from "../store/transaction.class";
import { EventCast, EventSubscribe, Prefix } from "../../../../types";
import { SharedConf } from "./dispatcher.class";
import { DispatcherStore } from "../store/dispatcher.class";
import { StateManager } from "./state-manager.class";

// CONSTANTS
const kDispatcherChannel = "dispatcher";
const kDispatcherTakeLeadEvent = "dispatcher-take_lead";
const kDispatcherApprovementEvent = "dispatcher-approvement";
const kDispatcherRegistrationEvent = "dispatcher-register";

export type PubSubHandlerOptions = SharedConf & {
  dispatcherStore: DispatcherStore;
  eventsSubscribe: (EventSubscribe & {
    horizontalScale?: boolean;
  })[];
  eventsCast: EventCast[];
  stateManager: StateManager;
};

export class PubSubHandler {
  public instanceName: string;
  public prefix: Prefix;
  public formattedPrefix: string;
  public consumerUUID: string;
  public eventsCast: EventCast[];
  public eventsSubscribe: EventSubscribe[];

  public dispatcherChannel: Channel;

  private dispatcherTransactionStore: TransactionStore<"dispatcher">;
  private dispatcherStore: DispatcherStore;
  private dispatcherInitStream: Interpersonal;

  private stateManager: StateManager;
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

        if (!this.stateManager.isLeader) {
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
          instanceName: this.instanceName,
          eventsSubscribe: this.eventsSubscribe,
          eventsCast: this.eventsCast
        },
        redisMetadata: {
          origin: this.consumerUUID,
          instanceName: this.instanceName,
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

  private async* lazyFetchStreams(this: PubSubHandler) {
    const count = 5000;
    let cursor = 0;

    do {
      // eslint-disable-next-line no-invalid-this
      const [lastCursor, keys] = await this.redis.scan(
        cursor,
        // eslint-disable-next-line no-invalid-this
        "MATCH", `${this.prefix}-*`,
        "COUNT", count,
        "TYPE", "stream"
      );

      cursor = Number(lastCursor);

      yield keys;

      continue;
    }
    while (cursor !== 0);
  }

  private async getStreams() {
    const streams: string[] = [];

    for await (const streamKeys of this.lazyFetchStreams()) {
      for (const streamKey of streamKeys) {
        streams.push(streamKey);
      }
    }

    return streams;
  }

  private async assignStreamGroups(options: {
    prefix: string;
    instanceName: string;
    eventsSubscribe: EventSubscribe[];
  }) {
    const { prefix, instanceName, eventsSubscribe } = options;

    const consumerUUID = randomUUID();
    const formattedPrefix = `${prefix ? `${prefix}-` : ""}`;

    const streams = await this.getStreams();
    const unknownEvents = eventsSubscribe.filter(
      (eventSubscribe) => !streams.find((streamKey) => streamKey.split("-").includes(eventSubscribe.name))
    );

    const streamsData: { streamKey: string; groupKey: string; consumerUUID: string; }[] = [];
    for (const unknownEvent of unknownEvents) {
      const streamKey = `${formattedPrefix}${unknownEvent.name}`;

      const stream = new Stream({
        streamName: streamKey,
        frequency: 500
      });

      await stream.init();

      const groupKey = `${formattedPrefix}${instanceName}-${consumerUUID}`;

      await this.redis.xgroup("CREATE", streamKey, groupKey, "$", "MKSTREAM");
      await this.redis.xgroup("CREATECONSUMER", streamKey, groupKey, consumerUUID);

      streamsData.push({
        streamKey,
        groupKey,
        consumerUUID
      });
    }

    // NOTES:
    // Correlate Pulsar id with his consumer ID according to the dispatcher stream
    // Check for horizontal scaling before creating new group.

    for (const streamKey of streams) {
      const stream = new Stream({
        streamName: streamKey,
        frequency: 500
      });

      if (eventsSubscribe.find((event) => streamKey.split("-").includes(event.name))) {
        await stream.init();

        const groupKey = `${instanceName}-${consumerUUID}`;

        await this.redis.xgroup("CREATE", streamKey, groupKey, "$", "MKSTREAM");
        await this.redis.xgroup("CREATECONSUMER", streamKey, groupKey, consumerUUID);

        streamsData.push({
          streamKey,
          groupKey,
          consumerUUID
        });

        // Also create group & consumer for each dispatcher instances & comm to

        continue;
      }

      // const groups = await stream.getGroupsData();

      // const filteredGroups = groups.filter((group) => group.name.split("-").includes(instanceName));

      // if (filteredGroups.length === 0) {
      //   // Create Group & consumer
      //   // Push into array response
      // }

      // // for (const group of groups) {
      // //   // Find related group by their name
      // //   // check if already in use or not according to scaling prop
      // //   // If match group => assign uuid & create the consumer
      // //   // If no match group => create new group with random uuid, assign & create consumer
      // // }
      // resultData.push(streamKey);
    }

    return {
      consumerUUID,
      streamsData
    };
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
        isActiveInstance: false,
        baseUUID: origin,
        lastActivity: now,
        aliveSince: now,
        prefix
      });

      console.log("here");
      // get streams & groups
      const { streamsData, consumerUUID } = await this.assignStreamGroups({ ...dispatcher });

      await this.dispatcherStore.set({ ...dispatcher, providedUUID: consumerUUID });

      const event = {
        name: kDispatcherApprovementEvent,
        data: {
          providedUUID: consumerUUID,
          streamsData
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

      this.logger.info(`Approved Dispatcher with uuid: ${consumerUUID}`);
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

      this.consumerUUID = data.providedUUID;

      await Promise.all([
        this.dispatcherTransactionStore.updateTransaction(transactionId, {
          ...transaction,
          redisMetadata: {
            ...transaction.redisMetadata,
            resolved: true
          }
        }),
        this.dispatcherInitStream.deleteConsumer(),
        this.redis.xgroup(
          "CREATECONSUMER",
          // eslint-disable-next-line dot-notation
          this.dispatcherInitStream["streamName"],
          this.dispatcherInitStream.groupName,
          this.consumerUUID
        )
      ]);

      this.logger.info(`Dispatcher Approved width uuid: ${this.consumerUUID}`);
    }
    catch (error) {
      this.logger.error({ error }, `Unable to handle approvement next to the transaction: ${transactionId}`);
    }
  }
}
