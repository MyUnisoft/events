// Import Internal Dependencies
import {
  DispatcherTransactionMetadata,
  GenericEvent,
  IncomerTransactionMetadata,
  Prefix
} from "./index";

export type DispatcherPingMessage = { name: "ping", data: null, redisMetadata: DispatcherTransactionMetadata };
export type DistributedEventMessage<
  T extends GenericEvent = GenericEvent
> = T & {
  redisMetadata: DispatcherTransactionMetadata;
};

export type CallBackEventMessage<
  T extends GenericEvent = GenericEvent
> = T & {
  eventTransactionId: string;
};

export type EventMessage<
  T extends GenericEvent = GenericEvent
> = T & {
  redisMetadata: IncomerTransactionMetadata;
};

export type CloseMessage = {
  name: string;
  redisMetadata: {
    origin: string;
    incomerName: string;
    prefix?: Prefix;
    transactionId?: null;
  }
}

export type IncomerChannelMessages<
  T extends GenericEvent = GenericEvent
> = {
  IncomerMessages: EventMessage<T> | CloseMessage;
  DispatcherMessages: DispatcherPingMessage | DistributedEventMessage<T>;
};
