/* eslint-disable max-depth */
// Import Node.js Dependencies
import { Readable } from "node:stream";
import { once, EventEmitter } from "node:events";
import timers from "node:timers/promises";
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import {
  Interpersonal,
  InterpersonalOptions,
  Stream,
  getRedis
} from "@myunisoft/redis";
import { Logger } from "pino";

// Import Internal Dependencies
import { CallBackEventMessage, EventCast, EventSubscribe, GenericEvent, Prefix } from "../../../../types";
import { PubSubHandler } from "./pubsub.class";
import { DefaultEventDispatchConfig, EventCallBackFn, SharedConf } from "./dispatcher.class";
import { DispatcherStore } from "../store/dispatcher.class";
import { StateManager } from "./state-manager.class";

export type InitHandlerOptions<
  T extends GenericEvent
> = Partial<InterpersonalOptions> & SharedConf & {
  eventsSubscribe: (EventSubscribe & {
    eventCallback?: EventCallBackFn<T>;
  })[];
  pubsubHandler: PubSubHandler;
  dispatcherStore: DispatcherStore;
  defaultEventConfig?: DefaultEventDispatchConfig;
  stateManager: StateManager;
  eventCallback: EventCallBackFn<T>;
}

export type RedisResponse<T extends GenericEvent> = (CallBackEventMessage<T> & {
  id: string;
  // data: string;
})[];

// CONSTANTS
const kNullTimeStamp = 0;

export class InitHandler<
  T extends GenericEvent = GenericEvent
> extends EventEmitter {
  public instanceName: string;
  public prefix: Prefix;
  public formattedPrefix: string;
  public consumerUUID: string;
  public eventsSubscribe: (EventSubscribe & {
    eventCallback?: EventCallBackFn<T>;
  })[];
  public eventsCast: EventCast[];
  public eventCallback: EventCallBackFn<T>;

  public interpersonal: Interpersonal;
  public eventStreams = new Map<string, Stream>();

  // Move into a dedicated class to handle streams interactions
  public streamsReadable: Map<string, { instance: Interpersonal, stream: Readable }> = new Map();

  private dispatcherInitStream: Interpersonal;
  private DispatcherStreamReader: Readable;

  private logger: Partial<Logger> & Pick<Logger, "info" | "warn">;
  private dispatcherStore: DispatcherStore;
  private pubsubHandler: PubSubHandler;
  private stateManager: StateManager;
  private defaultEventConfig: DefaultEventDispatchConfig | undefined;

  private initCustomId = 2;

  constructor(options: InitHandlerOptions<T>) {
    super();

    Object.assign(this, options);

    this.formattedPrefix = `${this.prefix ? `${this.prefix}-` : ""}`;

    this.logger = options.logger.child({ module: "init-handler" });
  }

  get redis() {
    return getRedis();
  }

  get subscriber() {
    return getRedis("subscriber");
  }

  public async init(): Promise<void> {
    const streamExist = await this.dispatcherInitStream.streamExist();

    if (streamExist) {
      // eslint-disable-next-line dot-notation
      const groupExist = await this.dispatcherInitStream["groupExist"]();
      if (groupExist) {
        await this.pubsubHandler.init();

        await this.pubsubHandler.dispatcherRegistration();

        // eslint-disable-next-line dot-notation
        await this.dispatcherInitStream["createConsumer"]();

        return;
      }
    }

    try {
      await this.dispatcherInitStream.init();
    }
    catch {
      // wait for stream & group to be init
      await timers.setTimeout(10);

      await this.dispatcherInitStream.init();
    }

    this.DispatcherStreamReader = Readable.from(this.dispatcherInitStream[Symbol.asyncIterator]());

    this.DispatcherStreamReader.on("readable", async() => {
      const entries = this.DispatcherStreamReader.read();

      for (const entry of entries) {
        if (String(entry.id) === `${kNullTimeStamp}-${this.initCustomId}`) {
          this.logger.info("Taking lead");

          await this.takeLead();
        }

        await this.dispatcherInitStream.claimEntry(entry.id);
      }
    });

    this.DispatcherStreamReader.on("error", (error) => {
      this.logger.warn({ error }, "Handle Redis Stream Error Here");

      return;
    });


    await this.pubsubHandler.init();

    await this.pushInitStreamEntry();
  }

  private async pushInitStreamEntry() {
    try {
      await this.dispatcherInitStream.push(
        { event: "init" },
        { id: `${kNullTimeStamp}-${this.initCustomId}` }
      );
    }
    catch (error) {
      await this.pubsubHandler.dispatcherRegistration();
    }
  }

  public async takeLeadBack() {
    //
  }

  public async close(): Promise<void> {
    this.DispatcherStreamReader.destroy();
    once(this.DispatcherStreamReader, "close");

    this.dispatcherInitStream.deleteConsumer();
  }

  private async handleDefaultEventConfig() {
    for (const [event, config] of Object.entries(this.defaultEventConfig)) {
      const streamName = this.formattedPrefix + event;

      const eventStream = new Stream({
        frequency: 0,
        streamName
      });

      await eventStream.init();

      for (const subscriber of config.subscribers) {
        const { name, horizontalScale, replicas } = subscriber;

        const subscriberGroupExist = (await eventStream.getGroupsData())
          .some((group) => group.name === name);

        if (!subscriberGroupExist) {
          await eventStream.createGroup(name);
        }

        if (horizontalScale) {
          const existingGroups = (await eventStream.getGroupsData())
            .filter((group) => group.name.startsWith(`${name}-`));

          for (let index = existingGroups.length; index < replicas - 1; index++) {
            const groupName = `${name}-${randomUUID()}`;
            await eventStream.createGroup(groupName);
          }
        }
      }
    }
  }

  private async initDispatcherGroup() {
    for (const subEvent of this.eventsSubscribe) {
      const { name, eventCallback } = subEvent;

      const streamName = this.formattedPrefix + name;

      const eventStream = new Interpersonal({
        count: 100,
        lastId: ">",
        frequency: 0,
        claimOptions: {
          idleTime: 5_000
        },
        streamName,
        groupName: this.instanceName,
        consumerName: this.consumerUUID
      });

      await eventStream.init();

      const eventStreamReadable = Readable.from(eventStream[Symbol.asyncIterator]());

      this.streamsReadable.set(streamName, { instance: eventStream, stream: eventStreamReadable });

      eventStreamReadable.on("readable", async() => {
        const redisEvents = eventStreamReadable.read() as RedisResponse<T>;

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

          try {
            Promise.all([
              typeof eventCallback === "undefined" ? this.eventCallback(event as CallBackEventMessage<T>) :
                eventCallback(event as CallBackEventMessage<T>),
              eventStream.claimEntry(id)
            ]);
          }
          catch (error) {
            this.logger.error({ error }, "Unable to handle the Event with id... (Inject custom ID on publish)");
          }
        }
      });
    }
  }

  private async takeLead() {
    this.stateManager.isLeader = true;

    const takeLeadEvent = {
      name: "dispatcher-take_lead",
      redisMetadata: {
        origin: this.consumerUUID
      }
    };

    await this.pubsubHandler.dispatcherChannel.publish(takeLeadEvent);

    if (this.defaultEventConfig) {
      await this.handleDefaultEventConfig();
    }

    await this.initDispatcherGroup();

    const now = Date.now();

    const dispatcher = Object.assign({}, {
      instanceName: this.instanceName,
      isActiveInstance: true,
      eventsSubscribe: this.eventsSubscribe,
      eventsCast: this.eventsCast,
      baseUUID: this.consumerUUID,
      lastActivity: now,
      aliveSince: now,
      prefix: this.prefix
    });

    await this.dispatcherStore.set({
      ...dispatcher,
      providedUUID: this.consumerUUID
    });

    this.logger.info("Resolved initialization and took Lead");
  }
}
