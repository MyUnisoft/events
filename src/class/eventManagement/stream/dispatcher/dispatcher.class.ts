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

// CONSTANTS
const kLoggerLevel = process.env.MYUNISOFT_EVENTS_SILENT_LOGGER;
const kDefaultIdleTime = Number.isNaN(Number(process.env.MYUNISOFT_IDLE_TIME)) ? undefined :
  Number(process.env.MYUNISOFT_IDLE_TIME);

export interface SharedConf {
  consumerName: string;
  logger:Partial<Logger> & Pick<Logger, "info" | "warn">;
  idleTime: number;
  prefix?: Prefix;
}

export type DispatcherOptions = Partial<InterpersonalOptions> & Partial<SharedConf> & {
  eventsSubscribe: (EventSubscribe & {
    horizontalScale?: boolean;
  })[];
}

export class Dispatcher {
  public dispatcherStreamName = "Local-Dispatcher-Stream";
  public groupName = "Dispatcher";

  public consumerName = randomUUID();
  public prefix: Prefix;
  public logger: Partial<Logger> & Pick<Logger, "info" | "warn">;

  public interpersonal: Interpersonal;
  public streams = new Map<string, Stream>();

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
      consumer: this.consumerName
    });

    this.initHandler = new InitHandler({
      ...options,
      idleTime: kDefaultIdleTime ?? options.idleTime ?? 2000,
      consumerName: this.consumerName,
      logger: this.logger
    });
  }

  public async init(): Promise<void> {
    await this.initHandler.init();
  }

  public async publish() {
    //
  }
}

