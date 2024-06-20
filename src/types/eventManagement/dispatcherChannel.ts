// Import Internal Dependencies
import {
  DispatcherTransactionMetadata,
  IncomerTransactionMetadata,
  EventSubscribe,
  EventCast
} from "./index";

// Send by the a Dispatcher
type DispatcherMessages = DispatcherApprovementMessage;

interface DispatcherApprovementData {
  uuid: string;
}

export type DispatcherApprovementMessage = {
  name: "APPROVEMENT";
  data: DispatcherApprovementData;
  redisMetadata: Omit<DispatcherTransactionMetadata, "iteration">;
}

// Send by an Incomer
type IncomerMessages = IncomerRegistrationMessage;

interface IncomerRegistrationData {
  /* Service name */
  name: string;
  eventsCast: EventCast[];
  eventsSubscribe: EventSubscribe[];
  providedUUID?: string;
}

export type IncomerRegistrationMessage = {
  name: "REGISTER";
  data: IncomerRegistrationData;
  redisMetadata: IncomerTransactionMetadata;
}

export type DispatcherChannelMessages = {
  IncomerMessages: IncomerMessages;
  DispatcherMessages: DispatcherMessages;
};
