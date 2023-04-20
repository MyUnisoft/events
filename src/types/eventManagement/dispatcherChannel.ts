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
  event: "approvement";
  data: DispatcherRegistrationData;
  metadata: DispatcherTransactionMetadata;
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
  event: "register";
  data: IncomerRegistrationDataIn;
  metadata: IncomerTransactionMetadata;
}

export type DispatcherChannelMessages = {
  IncomerMessages: IncomerMessages;
  DispatcherMessages: DispatcherMessages;
};
