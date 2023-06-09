// Import Internal Dependencies
import {
  DispatcherTransactionMetadata, IncomerTransactionMetadata
} from "./index";

export type DispatcherPingMessage = { name: "ping", data: null, redisMetadata: DispatcherTransactionMetadata };
export type DistributedEventMessage<
  T extends Record<string, any> = Record<string, any>
> = {
  name: string;
  data: Record<string, any> | null;
  redisMetadata: DispatcherTransactionMetadata;
} & Omit<EventMessage<T>, "redisMetadata">;

export type EventMessage<T extends Record<string, any> = Record<string, any>> = {
  name: string;
  data: Record<string, any> | null;
  redisMetadata: IncomerTransactionMetadata;
} & T;

export type IncomerChannelMessages<T extends Record<string, any> = Record<string, any>> = {
  IncomerMessages: EventMessage;
  DispatcherMessages: DispatcherPingMessage | DistributedEventMessage<T>;
};
