import { Events } from "../index.js";

export type Prefix = "test" | "development" | "staging" | "production";

export type EventCast<T extends string | keyof Events = string> = T;

export type EventSubscribe<T extends string | keyof Events = string> = {
  name: T;
  delay?: number;
  horizontalScale?: boolean;
};

export interface SharedTransactionMetadata {
  origin: string;
  incomerName: string;
  transactionId: string;
  prefix?: Prefix;
  eventTransactionId?: string;
}

export interface DispatcherTransactionMetadata extends SharedTransactionMetadata {
  to: string;
  iteration: number;
}

export interface IncomerTransactionMetadata extends SharedTransactionMetadata {
  to?: string;
}

export type GenericEvent = {
  name: string;
  data: Record<string, any>;
  [key: string]: any;
};

export type anyFn = (...args: any[]) => void;

export type PartialLogger = {
  info: anyFn;
  warn: anyFn;
  debug: anyFn;
  error: anyFn;
  [key: string]: any;
};

export interface RegisteredIncomer {
  providedUUID: string;
  baseUUID: string;
  name: string;
  isDispatcherActiveInstance: boolean;
  lastActivity: number;
  aliveSince: number;
  eventsCast: EventCast[];
  eventsSubscribe: EventSubscribe[];
  prefix?: string;
}

export type Instance = "dispatcher" | "incomer";

export * from "./dispatcherChannel.js";
export * from "./incomerChannel.js";
