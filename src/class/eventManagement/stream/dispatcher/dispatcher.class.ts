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
import { EventSubscribe, Prefix } from "../../../../types";
import { InitHandler } from "./init.class";
import { IncomerStore } from "../../../store/incomer.class";
import { PubSubHandler } from "./pubsub.class";

// CONSTANTS
const kLoggerLevel = process.env.MYUNISOFT_EVENTS_SILENT_LOGGER;
const kEnvIdleTime = Number.isNaN(Number(process.env.MYUNISOFT_IDLE_TIME)) ? undefined :
  Number(process.env.MYUNISOFT_IDLE_TIME);
const kDefaultIdleTime = 2_000;

export interface SharedConf {
  consumerUUID: string;
  logger:Partial<Logger> & Pick<Logger, "info" | "warn">;
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

export type DispatcherOptions = Partial<InterpersonalOptions> & Partial<SharedConf> & {
  eventsSubscribe: (EventSubscribe & {
    horizontalScale?: boolean;
  })[];
  defaultEventConfig?: DefaultEventDispatchConfig;
}

export class Dispatcher {
  public dispatcherStreamName = "dispatcher-stream";
  public groupName = "dispatcher";

  public consumerUUID = randomUUID();
  public prefix: Prefix;
  public logger: Partial<Logger> & Pick<Logger, "info" | "warn">;

  public interpersonal: Interpersonal;
  public streams = new Map<string, Stream>();

  private incomerStore: IncomerStore;

  private pubsubHandler: PubSubHandler;
  private initHandler: InitHandler;

  constructor(options: DispatcherOptions) {
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
      idleTime: kEnvIdleTime ?? options.idleTime ?? kDefaultIdleTime,
      consumerUUID: this.consumerUUID,
      logger: this.logger
    };

    this.incomerStore = new IncomerStore({
      prefix: this.prefix
    });

    this.pubsubHandler = new PubSubHandler({
      ...options,
      ...genericOptions,
      incomerStore: this.incomerStore
    });

    this.initHandler = new InitHandler({
      ...options,
      ...genericOptions,
      pubsubHandler: this.pubsubHandler,
      incomerStore: this.incomerStore
    });
  }

  public async init(): Promise<void> {
    await this.initHandler.init();
  }

  public async publish() {
    //
  }
}

import timers from "node:timers/promises";

async function main() {
  await initRedis();
  await initRedis({}, "subscriber");

  // const foo = new Dispatcher({
  //   eventsSubscribe: []
  // });

  // await foo.init();

  const dispatchers = new Array(1);
  const toInit: any[] = [];
  for (const _ of dispatchers) {
    toInit.push(new Dispatcher({
      eventsSubscribe: [],
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
      }
    }));
  }

  await Promise.all([
    ...toInit.map((dispatcher) => dispatcher.init())
  ]);

  // await timers.setTimeout(2000);

  // const bar = new Dispatcher({
  //   eventsSubscribe: []
  // });

  // await bar.init();
}

main().then(() => console.log("init")).catch((error) => console.error(error));
