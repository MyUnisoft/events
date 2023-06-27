// Import Internal Dependencies
import {
  DispatcherTransactionMetadata,
  GenericEvent,
  IncomerTransactionMetadata
} from "./index";

export type DispatcherPingMessage = { name: "ping", data: null, redisMetadata: DispatcherTransactionMetadata };
export type DistributedEventMessage<
  T extends GenericEvent = GenericEvent
> = T & {
  name: string;
  redisMetadata: DispatcherTransactionMetadata;
};

export type CallBackEventMessage<
  T extends GenericEvent = GenericEvent
> = T & {
  name: string;
};

export type EventMessage<
  T extends GenericEvent = GenericEvent
> = T & {
  name: string;
  redisMetadata: IncomerTransactionMetadata;
};

export type IncomerChannelMessages<
  T extends GenericEvent = GenericEvent
> = {
  IncomerMessages: EventMessage<T>;
  DispatcherMessages: DispatcherPingMessage | DistributedEventMessage<T>;
};
