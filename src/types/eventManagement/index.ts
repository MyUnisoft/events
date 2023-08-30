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
  transactionId?: string;
}

export interface IncomerTransactionMetadata {
  origin: string;
  to?: string;
  prefix?: Prefix;
  transactionId?: string;
}

export type GenericEvent = Record<string, any> & { data: Record<string, any> };

export * from "./dispatcherChannel";
export * from "./incomerChannel";
