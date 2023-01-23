// Import Internal Dependencies
import {
  Message,
  DispatcherTransactionMetadata,
  IncomerTransactionMetadata,
  SubscribeTo
} from "./index";


// Send by the a Dispatcher
type DispatcherMessages = DispatcherRegistrationMessage;

interface DispatcherRegistrationData {
  uuid: string;
}

export type DispatcherRegistrationMessage = Message & {
  data: DispatcherRegistrationData;
  metadata: DispatcherTransactionMetadata;
}

// Send by an Incomer
type IncomerMessages = IncomerRegistrationMessage;


interface IncomerRegistrationDataIn {
  /* Service name */
  name: string;
  /* Commonly used to distinguish envs */
  subscribeTo: SubscribeTo[];
}

export type IncomerRegistrationMessage = Message & {
  data: IncomerRegistrationDataIn;
  metadata: IncomerTransactionMetadata;
}

export type DispatcherChannelMessages = {
  IncomerMessages: IncomerMessages;
  DispatcherMessages: DispatcherMessages;
};
