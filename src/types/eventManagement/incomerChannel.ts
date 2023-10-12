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

export type IncomerChannelMessages<
  T extends GenericEvent = GenericEvent
> = {
  IncomerMessages: EventMessage<T>;
  DispatcherMessages: DispatcherPingMessage | DistributedEventMessage<T>;
};
