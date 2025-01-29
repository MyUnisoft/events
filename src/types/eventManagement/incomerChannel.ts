// Import Internal Dependencies
import type {
  TransactionMetadata,
  GenericEvent
} from "./index.js";

export type DispatcherPingMessage = {
  name: "PING";
  data: null;
  redisMetadata: Omit<TransactionMetadata<"dispatcher">, "iteration">;
};

export type DistributedEventMessage<T extends GenericEvent = GenericEvent> = T & {
  redisMetadata: TransactionMetadata<"dispatcher">;
};

export type CallBackEventMessage<T extends GenericEvent = GenericEvent> = T & {
  eventTransactionId: string;
};

export type EventMessage<T extends GenericEvent = GenericEvent> = T & {
  redisMetadata: TransactionMetadata<"incomer">;
};

export type CloseMessage = {
  name: "CLOSE";
  redisMetadata: {
    origin: string;
    incomerName: string;
    transactionId?: null;
  };
};

export type RetryMessage = {
  name: "RETRY";
  data: {
    dispatcherTransactionId: string;
    incomerTransactionId: string;
  };
  redisMetadata: {
    origin: string;
    incomerName: string;
  };
};

export type IncomerChannelMessages<T extends GenericEvent = GenericEvent> = {
  IncomerMessages: EventMessage<T> | CloseMessage;
  DispatcherMessages: DispatcherPingMessage | DistributedEventMessage<T>;
};
