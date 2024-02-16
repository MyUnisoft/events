// Import Internal Dependencies
import {
  DispatcherTransactionMetadata,
  IncomerTransactionMetadata,
  EventSubscribe,
  EventCast
} from "./index";

// Send by the a Dispatcher
type DispatcherMessages = DispatcherApprovementMessage |
  AbortTakingLeadMessage |
  AbortTakingLeadBackMessage;

interface DispatcherApprovementData {
  uuid: string;
}

export type DispatcherApprovementMessage = {
  name: "APPROVEMENT";
  data: DispatcherApprovementData;
  redisMetadata: DispatcherTransactionMetadata;
}

export type AbortTakingLeadMessage = {
  name: "ABORT_TAKING_LEAD";
  data: null;
  redisMetadata: null;
}

export type AbortTakingLeadBackMessage = {
  name: "ABORT_TAKING_LEAD_BACK";
  data: null;
  redisMetadata: null;
}

// Send by an Incomer
type IncomerMessages = IncomerRegistrationMessage;


interface IncomerRegistrationData {
  /* Service name */
  name: string;
  eventsCast: EventCast[];
  eventsSubscribe: EventSubscribe[];
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
