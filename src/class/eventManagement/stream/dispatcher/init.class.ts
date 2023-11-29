// Import Node.js Dependencies
import { Readable } from "node:stream";
import { once, EventEmitter } from "node:events";
import timers from "node:timers/promises";

// Import Third-party Dependencies
import {
  Interpersonal,
  InterpersonalOptions,
  Stream,
  getRedis
} from "@myunisoft/redis";
import { Logger } from "pino";

// Import Internal Dependencies
import { EventSubscribe, Prefix } from "../../../../types";
import { PubSubHandler } from "./pubsub.class";
import { SharedConf } from "./dispatcher.class";
import { IncomerStore } from "../../../store/incomer.class";

export type InitHandlerOptions = Partial<InterpersonalOptions> & SharedConf & {
  eventsSubscribe: (EventSubscribe & {
    horizontalScale?: boolean;
  })[];
}

// CONSTANTS
const kNullTimeStamp = 0;

export class InitHandler extends EventEmitter {
  public dispatcherStreamName = "Local-Dispatcher-Stream";
  public groupName = "Dispatcher";

  public prefix: Prefix;
  public formattedPrefix: string;
  public prefixedDispatcherStreamName: string;
  public consumerName: string;

  public interpersonal: Interpersonal;
  public streams = new Map<string, Stream>();

  private dispatcherStream: Interpersonal;
  private pubSubHandler: PubSubHandler;
  private DispatcherStreamReader: Readable;

  private logger: Partial<Logger> & Pick<Logger, "info" | "warn">;
  private incomerStore: IncomerStore;

  private nextInitCustomId = 2;

  constructor(options: InitHandlerOptions) {
    super();

    Object.assign(this, options);

    this.formattedPrefix = `${this.prefix ? `${this.prefix}-` : ""}`;
    this.prefixedDispatcherStreamName = this.formattedPrefix + this.dispatcherStreamName;

    this.logger = options.logger.child({ module: "init-handler" });

    this.incomerStore = new IncomerStore({
      prefix: this.prefix
    });

    this.dispatcherStream = new Interpersonal({
      ...options,
      // Threshold of Dispatcher Instance
      count: 1000,
      lastId: ">",
      frequency: 1,
      claimOptions: {
        idleTime: 500
      },
      streamName: this.prefixedDispatcherStreamName,
      groupName: this.groupName,
      consumerName: this.consumerName
    });

    this.pubSubHandler = new PubSubHandler({ ...options });
  }

  get redis() {
    return getRedis();
  }

  get subscriber() {
    return getRedis("subscriber");
  }

  public async init(): Promise<void> {
    const streamExist = await this.dispatcherStream.streamExist();

    if (streamExist) {
      // eslint-disable-next-line dot-notation
      const groupExist = await this.dispatcherStream["groupExist"]();
      if (groupExist) {
        await this.pubSubHandler.init();

        await this.pubSubHandler.register();

        // eslint-disable-next-line dot-notation
        await this.dispatcherStream["createConsumer"]();

        return;
      }
    }

    try {
      await this.dispatcherStream.init();
    }
    catch {
      // wait for stream & group to be init
      await timers.setTimeout(10);

      await this.dispatcherStream.init();
    }

    this.DispatcherStreamReader = Readable.from(this.dispatcherStream[Symbol.asyncIterator]());

    this.DispatcherStreamReader.on("readable", async() => {
      const entries = this.DispatcherStreamReader.read();

      for (const entry of entries) {
        if (String(entry.id) === `${kNullTimeStamp}-${this.nextInitCustomId}`) {
          await this.takeLead();
        }

        await this.dispatcherStream.claimEntry(entry.id);
      }
    });

    this.DispatcherStreamReader.on("error", (error) => {
      this.logger.warn({ error }, "Handle Redis Stream Error Here");

      return;
    });

    await this.pubSubHandler.init();

    try {
      await this.dispatcherStream.push({ event: "init" }, { id: `${kNullTimeStamp}-${this.nextInitCustomId}` });
    }
    catch (error) {
      this.logger.warn("Key already pushed");

      await this.pubSubHandler.register();
    }
  }

  public async takeLeadBack() {
    //
  }

  public async close(): Promise<void> {
    this.DispatcherStreamReader.destroy();
    once(this.DispatcherStreamReader, "close");

    this.dispatcherStream.deleteConsumer();
  }

  private async takeLead() {
    this.pubSubHandler.isLeader = true;

    const takeLeadEvent = {
      name: "dispatcher-take_lead",
      redisMetadata: {
        origin: this.consumerName
      }
    };

    await this.pubSubHandler.dispatcherChannel.publish(takeLeadEvent);

    const now = Date.now();

    const incomer = Object.assign({}, {
      name: "foo",
      isDispatcherActiveInstance: true,
      eventsCast: [],
      eventsSubscribe: [],
      baseUUID: this.consumerName,
      lastActivity: now,
      aliveSince: now,
      prefix: this.prefix
    });

    this.pubSubHandler.providedUUID = await this.incomerStore.setIncomer(incomer);

    this.logger.info("Resolved initialization and taking Lead");
  }
}
