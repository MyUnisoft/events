// Import Node.js Dependencies
import { randomUUID } from "node:crypto";

// Import Third-party Dependencies
import {
  Interpersonal,
  InterpersonalOptions,
  Stream,
  initRedis
} from "@myunisoft/redis";
import { Logger, pino } from "pino";

// Import Internal Dependencies
import {
  CallBackEventMessage,
  EventCast,
  EventSubscribe,
  GenericEvent,
  Prefix
} from "../../../../types";
import { InitHandler } from "./init.class";
import { DispatcherStore } from "../store/dispatcher.class";
import { PubSubHandler } from "./pubsub.class";

// CONSTANTS
const kLoggerLevel = process.env.MYUNISOFT_EVENTS_SILENT_LOGGER;
const kEnvIdleTime = Number.isNaN(Number(process.env.MYUNISOFT_IDLE_TIME)) ? undefined :
  Number(process.env.MYUNISOFT_IDLE_TIME);
const kDefaultIdleTime = 2_000;
const kDispatcherStreamName = "dispatcher";

export interface SharedConf {
  instanceName: string;
  consumerUUID: string;
  dispatcherInitStream: Interpersonal;
  logger: Partial<Logger> & Pick<Logger, "info" | "warn">;
  idleTime: number;
  prefix?: Prefix;
}

export interface DefaultEventDispatchSubscriber {
  name: string;
  horizontalScale: boolean;
  replicas: number;
}

export interface DefaultEventDispatchConfig {
  [key: string]: {
    subscribers: DefaultEventDispatchSubscriber[];
  }
}

type DispatcherPartialSharedConf = Partial<SharedConf> & Pick<SharedConf, "instanceName">;

export type EventCallBackFn<
  T extends GenericEvent
> = (message: CallBackEventMessage<T>) => void;

export type DispatcherOptions<
  T extends GenericEvent
> = Partial<InterpersonalOptions> & DispatcherPartialSharedConf & {
  eventsSubscribe: (EventSubscribe & {
    eventCallback?: EventCallBackFn<T>;
  })[];
  eventsCast: EventCast[];
  defaultEventConfig?: DefaultEventDispatchConfig;
  eventCallback: EventCallBackFn<T>;
}

export class Dispatcher<T extends GenericEvent = GenericEvent> {
  public dispatcherStreamName = "dispatcher-stream";

  public instanceName: string;
  public consumerUUID = randomUUID();
  public prefix: Prefix;
  public logger: Partial<Logger> & Pick<Logger, "info" | "warn">;
  public eventsCast: EventCast[];
  public eventsSubscribe: EventSubscribe[];

  public formattedPrefix: string;
  public interpersonal: Interpersonal;
  public streams = new Map<string, Stream>();

  private dispatcherStore: DispatcherStore;

  private stateManager: StateManager;
  private pubsubHandler: PubSubHandler;
  private initHandler: InitHandler<T>;

  constructor(options: DispatcherOptions<T>) {
    Object.assign(this, options);

    this.logger = options.logger ?? pino({
      name: "Dispatcher",
      level: kLoggerLevel ?? "info",
      transport: {
        target: "pino-pretty"
      }
    });

    this.logger.setBindings({
      prefix: this.prefix,
      consumer: this.consumerUUID
    });

    const genericOptions = {
      instanceName: options.instanceName,
      idleTime: kEnvIdleTime ?? options.idleTime ?? kDefaultIdleTime,
      eventsSubscribe: this.eventsSubscribe,
      eventsCast: this.eventsCast,
      consumerUUID: this.consumerUUID,
      logger: this.logger
    };

    this.dispatcherStore = new DispatcherStore({
      prefix: this.prefix
    });

    this.formattedPrefix = `${this.prefix ? `${this.prefix}-` : ""}`;

    const dispatcherInitStream = new Interpersonal({
      ...options,
      count: 1,
      lastId: ">",
      frequency: 1,
      claimOptions: {
        idleTime: 500
      },
      streamName: this.formattedPrefix + kDispatcherStreamName,
      groupName: this.instanceName,
      consumerName: this.consumerUUID
    });

    this.stateManager = new StateManager();

    this.pubsubHandler = new PubSubHandler({
      ...options,
      ...genericOptions,
      stateManager: this.stateManager,
      dispatcherStore: this.dispatcherStore,
      dispatcherInitStream
    });

    this.initHandler = new InitHandler({
      ...options,
      ...genericOptions,
      stateManager: this.stateManager,
      pubsubHandler: this.pubsubHandler,
      dispatcherStore: this.dispatcherStore,
      dispatcherInitStream
    });
  }

  public async init(): Promise<void> {
    try {
      await this.initHandler.init();
    }
    catch (error) {
      this.logger.error({ error }, "Unable to init");
    }
  }

  public async publish(event: T) {
    const { name } = event;

    const eventStream = this.initHandler.streamsReadable.get(this.formattedPrefix + name);

    if (!eventStream) {
      throw new Error(`Unknown Event: ${JSON.stringify(event)}`);
    }

    const parsedMessage = Object.assign({}, event) as Record<string, any>;

    for (const key of Object.keys(event)) {
      parsedMessage[key] = typeof parsedMessage[key] === "object" ?
        JSON.stringify(parsedMessage[key]) : parsedMessage[key];
    }

    await eventStream.instance.push(parsedMessage, {});
  }
}

import timers from "node:timers/promises";
import { StateManager } from "./state-manager.class";

async function main() {
  await initRedis();
  await initRedis({}, "subscriber");

  const dispatchers = new Array(2);
  const toInit: Dispatcher[] = [];
  for (const _ of dispatchers) {
    toInit.push(new Dispatcher({
      instanceName: "Pulsar",
      prefix: "test",
      eventsSubscribe: [
        {
          name: "accountingFolder",
          horizontalScale: false,
          eventCallback: (message) => {
            console.log("Received event with custom callback: ", message);
          }
        }
      ],
      eventsCast: [],
      defaultEventConfig: {
        accountingFolder: {
          subscribers: [
            {
              name: "GED",
              horizontalScale: true,
              replicas: 2
            }
          ]
        }
      },
      eventCallback: (message) => {
        console.log("Received event: ", message);
      }
    }));
  }

  await Promise.all([
    ...toInit.map((dispatcher) => dispatcher.init())
  ]);

  await timers.setTimeout(2000);

  await toInit[0].publish({ name: "accountingFolder", data: { foo: "bar" } });
}

main().then(() => console.log("init")).catch((error) => console.error(error));
