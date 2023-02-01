// Import Internal Dependencies
import {
  DispatcherTransactionMetadata,
  IncomerTransactionMetadata
} from "./index";

// Send by the a Dispatcher
type DispatcherMessages = DispatcherPingMessage;

export type DispatcherPingMessage = { event: "ping", data: null, metadata: DispatcherTransactionMetadata };

// Send by an Incomer
type IncomerMessages = IncomerPongMessage;

export type IncomerPongMessage = { event: "pong", data: null, metadata: IncomerTransactionMetadata };

export type IncomerChannelMessages = {
  IncomerMessage: IncomerMessages;
  DispatcherMessages: DispatcherMessages;
};
