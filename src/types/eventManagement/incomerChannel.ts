// Import Internal Dependencies
import {
  DispatcherTransactionMetadata, IncomerTransactionMetadata
} from "./index";

export type DispatcherPingMessage = { name: "ping", data: null, redisMetadata: DispatcherTransactionMetadata };
export type DistributedEventMessage<
  T extends Record<string, any> & { data: Record<string, any> } = Record<string, any> & { data: Record<string, any> }
> = {
  name: string;
  redisMetadata: DispatcherTransactionMetadata;
} & T;

export type CallBackEventMessage<
  T extends Record<string, any> & { data: Record<string, any> } = Record<string, any> & { data: Record<string, any> }
> = {
  name: string;
} & T;

export type EventMessage<
  T extends Record<string, any> & { data: Record<string, any> } = Record<string, any> & { data: Record<string, any> }
> = {
  name: string;
  redisMetadata: IncomerTransactionMetadata;
} & T;

export type IncomerChannelMessages<
  T extends Record<string, any> & { data: Record<string, any> } = Record<string, any> & { data: Record<string, any> }
> = {
  IncomerMessages: EventMessage;
  DispatcherMessages: DispatcherPingMessage | DistributedEventMessage<T>;
};
