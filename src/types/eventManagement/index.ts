export type Prefix = "local" | "dev" | "preprod" | "prod";

export interface SubscribeTo<T extends string = string> {
  name: T;
  delay?: number;
  horizontalScale?: boolean;
}

export type TransactionAck = {
  event: "ack";
  data: null;
  metadata: {
    origin: string;
    prefix?: string;
    to?: string;
    transactionId: string;
  };
};

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
