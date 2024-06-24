import { Events } from "../index";

export type Prefix = "test" | "development" | "staging" | "production";

export type EventCast<T extends string | keyof Events = string> = T;

export type EventSubscribe<T extends string | keyof Events = string> = {
  name: T;
  delay?: number;
  horizontalScale?: boolean;
};

export interface DispatcherTransactionMetadata {
  origin: string;
  to: string;
  incomerName: string;
  transactionId: string;
  iteration: number;
  prefix?: Prefix;
  eventTransactionId?: string;
}

export interface IncomerTransactionMetadata {
  origin: string;
  incomerName: string;
  to?: string;
  prefix?: Prefix;
  transactionId: string;
  eventTransactionId?: string;
}

export type GenericEvent = {
  name: string;
  data: Record<string, any>;
  [key: string]: any;
};

export * from "./dispatcherChannel";
export * from "./incomerChannel";
