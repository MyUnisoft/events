// Import Internal Dependencies
import {
  DispatcherTransactionMetadata, IncomerTransactionMetadata
} from "./index";

export type DispatcherPingMessage = { event: "ping", data: null, metadata: DispatcherTransactionMetadata };
export type DistributedEventMessage = { event: string, data: Record<string, any>, metadata: DispatcherTransactionMetadata };

export type EventMessage = { event: string, data: Record<string, any>, metadata: IncomerTransactionMetadata };

export type IncomerChannelMessages = {
  IncomerMessages: EventMessage;
  DispatcherMessages: DispatcherPingMessage | DistributedEventMessage;
};
