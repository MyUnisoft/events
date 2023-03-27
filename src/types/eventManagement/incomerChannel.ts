// Import Internal Dependencies
import {
  DispatcherTransactionMetadata,
  IncomerTransactionMetadata
} from "./index";

// Send by the a Dispatcher
type DispatcherMessages = DispatcherPingMessage;

export type DispatcherPingMessage = { event: "ping", data: null, metadata: DispatcherTransactionMetadata };

// Send by an Incomer
type IncomerMessages = { event: string, data: Record<string, any>, metadata: IncomerTransactionMetadata };

export type IncomerChannelMessages = {
  IncomerMessage: IncomerMessages;
  DispatcherMessages: DispatcherMessages;
};
