// Import Internal Dependencies
import type {
  TransactionMetadata,
  EventSubscribe
} from "./index.js";

export type DispatcherApprovementMessage = {
  name: "APPROVEMENT";
  data: {
    uuid: string;
  };
  redisMetadata: Omit<TransactionMetadata<"dispatcher">, "iteration">;
};

export type IncomerRegistrationMessage = {
  name: "REGISTER";
  data: {
    name: string;
    eventsCast: string[];
    eventsSubscribe: EventSubscribe[];
    providedUUID?: string;
  };
  redisMetadata: TransactionMetadata<"incomer">;
};
