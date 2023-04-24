// Import Internal Dependencies
import {
  DispatcherTransactionMetadata,
  IncomerTransactionMetadata,
  EventsSubscribe,
  EventsCast
} from "./index";

// Send by the a Dispatcher
type DispatcherMessages = DispatcherRegistrationMessage;

interface DispatcherRegistrationData {
  uuid: string;
}

export type DispatcherRegistrationMessage = {
  name: "approvement";
  data: DispatcherRegistrationData;
  redisMetadata: DispatcherTransactionMetadata;
}

// Send by an Incomer
type IncomerMessages = IncomerRegistrationMessage;


interface IncomerRegistrationDataIn {
  /* Service name */
  name: string;
  eventsCast: EventsCast;
  eventsSubscribe: EventsSubscribe;
}

export type IncomerRegistrationMessage = {
  name: "register";
  data: IncomerRegistrationDataIn;
  redisMetadata: IncomerTransactionMetadata;
}

export type DispatcherChannelMessages = {
  IncomerMessages: IncomerMessages;
  DispatcherMessages: DispatcherMessages;
};
