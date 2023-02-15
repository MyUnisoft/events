export type Prefix = "local" | "dev" | "preprod" | "prod";

export interface SubscribeTo<T extends string = string> {
  name: T;
  delay?: number;
  horizontalScale?: boolean;
}

export interface DispatcherTransactionMetadata {
  origin: string;
  to: string;
  transactionId?: string;
}

export interface IncomerTransactionMetadata {
  origin: string;
  prefix?: Prefix;
  transactionId?: string;
}

export { DispatcherChannelMessages } from "./dispatcherChannel";
export { IncomerChannelMessages } from "./incomerChannel";
