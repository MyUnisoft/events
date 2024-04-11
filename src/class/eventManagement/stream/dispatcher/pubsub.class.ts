// Import Node.js Dependencies
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

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
import { CallBackEventMessage, EventCast, EventSubscribe, Prefix } from "../../../../types";
import { SharedConf } from "./dispatcher.class";
import { DispatcherStore } from "../store/dispatcher.class";
import { StateManager } from "./state-manager.class";
import { RedisResponse } from "./init.class";

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
      const { horizontalScale } = unknownEvent;

      const streamKey = `${formattedPrefix}${unknownEvent.name}`;

      const stream = new Stream({
        streamName: streamKey,
        frequency: 500
      });

      await stream.init();

      const groupKey = `${formattedPrefix}${instanceName}${horizontalScale ? `-${consumerUUID}` : ""}`;

      await stream.createGroup(groupKey);
      // NOT HERE, THE GIVEN INSTANCE MUST BE THE ONE CREATING THE CONSUMER THROUGH INIT OF INTRAPERSONAL CLASS
      // await this.redis.xgroup("CREATECONSUMER", streamKey, groupKey, consumerUUID);

      streamsData.push({
        streamKey,
        groupKey,
        consumerUUID
      });
    }

    for (const streamKey of streams) {
      const stream = new Stream({
        streamName: streamKey,
        frequency: 500
      });

      const relatedEvent = eventsSubscribe.find((event) => streamKey.split("-").includes(event.name));
      if (relatedEvent) {
        const { horizontalScale } = relatedEvent;

        await stream.init();

        const groupKey = `${instanceName}${horizontalScale ? `-${consumerUUID}` : ""}`;

        await stream.createGroup(groupKey);
        await stream.createConsumer(groupKey, consumerUUID);

        streamsData.push({
          streamKey,
          groupKey,
          consumerUUID
        });

        continue;
      }
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
        (new Stream({ streamName: this.dispatcherInitStream.streamName, frequency: 0 }))
          .createConsumer(this.dispatcherInitStream.groupName, this.consumerUUID)
      ]);

      for (const streamData of data.streamsData) {
        const eventStream = new Interpersonal({
          count: 100,
          lastId: ">",
          frequency: 0,
          claimOptions: {
            idleTime: 5_000
          },
          streamName: streamData.streamKey,
          groupName: streamData.groupKey,
          consumerName: streamData.consumerUUID
        });

        await eventStream.init();

        const eventReadable = Readable.from(eventStream[Symbol.asyncIterator]());

        eventReadable.on("readable", async() => {
          const redisEvents = eventReadable.read() as RedisResponse<any>;

          for (const redisEvent of redisEvents) {
            const { id, data: eventData } = redisEvent;

            const parsedEventData = JSON.parse(eventData.data);
            const fullyParsedData = Object.assign({}, parsedEventData);

            for (const key of Object.keys(parsedEventData)) {
              try {
                fullyParsedData[key] = JSON.parse(parsedEventData[key]);
              }
              catch {
                continue;
              }
            }

            const event = {
              ...eventData,
              data: fullyParsedData
            };

            console.log(`EventId: ${id}`);

            try {
              console.log("HEHEHEHER", event);
              eventStream.claimEntry(id);
            }
            catch (error) {
              this.logger.error({ error }, "Unable to handle the Event with id... (Inject custom ID on publish)");
            }
          }
        });
      }

      this.logger.info(`Dispatcher Approved width uuid: ${this.consumerUUID}`);
    }
    catch (error) {
      this.logger.error({ error }, `Unable to handle approvement next to the transaction: ${transactionId}`);
    }
  }
}
