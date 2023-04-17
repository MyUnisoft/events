// Import Internal Dependencies
import {
  DispatcherTransactionMetadata, IncomerTransactionMetadata
} from "./index";

// Send by the a Dispatcher
type DispatcherMessages = DispatcherPingMessage | DistributedEventMessage;

export type DispatcherPingMessage = { event: "ping", data: null, metadata: DispatcherTransactionMetadata };
export type DistributedEventMessage = { event: string, data: Record<string, any>, metadata: DispatcherTransactionMetadata };

// Send by an Incomer
type IncomerMessages = EventMessage;

export type EventMessage = { event: string, data: Record<string, any>, metadata: IncomerTransactionMetadata };

export type IncomerChannelMessages = {
  IncomerMessages: IncomerMessages;
  DispatcherMessages: DispatcherMessages;
};
