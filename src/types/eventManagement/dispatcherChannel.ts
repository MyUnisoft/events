// Import Internal Dependencies
import {
  DispatcherTransactionMetadata,
  IncomerTransactionMetadata,
  EventSubscribe,
  EventCast
} from "./index";

interface DispatcherApprovementData {
  uuid: string;
}

export type DispatcherApprovementMessage = {
  name: "APPROVEMENT";
  data: DispatcherApprovementData;
  redisMetadata: Omit<DispatcherTransactionMetadata, "iteration">;
};

interface IncomerRegistrationData {
  name: string;
  eventsCast: EventCast[];
  eventsSubscribe: EventSubscribe[];
  providedUUID?: string;
}

export type IncomerRegistrationMessage = {
  name: "REGISTER";
  data: IncomerRegistrationData;
  redisMetadata: IncomerTransactionMetadata;
};

export type DispatcherChannelMessages = {
  IncomerMessages: IncomerRegistrationMessage;
  DispatcherMessages: DispatcherApprovementMessage;
};
