// Import Internal Dependencies
import {
  DispatcherTransactionMetadata, IncomerTransactionMetadata
} from "./index";

export type DispatcherPingMessage = { name: "ping", data: null, redisMetadata: DispatcherTransactionMetadata };
export type DistributedEventMessage = Record<string, any> & {
  name: string;
  data: Record<string, any>;
  redisMetadata: DispatcherTransactionMetadata;
};

export type EventMessage = Record<string, any> & {
  name: string;
  data: Record<string, any>;
  redisMetadata: IncomerTransactionMetadata;
};

export type IncomerChannelMessages = {
  IncomerMessages: EventMessage;
  DispatcherMessages: DispatcherPingMessage | DistributedEventMessage;
};
