// Import Internal Dependencies
import { Events } from "./events";

export type Prefix = "local" | "dev" | "preprod" | "prod";

export interface SubscribeTo<T extends keyof Events = keyof Events> {
  name: T;
  delay?: number;
  horizontalScall?: boolean;
}

export interface Transaction {
  event: string;
  data?: IncomingMessages | extMessages;
  metadata: {
    origin: string;
    to?: string;
  }
  aliveSince: number;
}

export type IncomingMessages = IncomerRegistrationDataIn;
export type extMessages = DispatcherRegistrationData;

// Messages

// Dispatcher

export interface DispatcherTransactionMetadata {
  origin: string;
  to: string;
  transactionId: string;
}

export interface DispatcherRegistrationData {
  uuid: string;
}

export type DispatcherRegistrationMetadata = DispatcherTransactionMetadata;

export interface DispatcherRegistrationMessage {
  data: DispatcherRegistrationData;
  metadata: DispatcherRegistrationMetadata;
}

// Incomer

export interface IncomerTransactionMetadata {
  origin: string;
  prefix?: Prefix;
  transactionId?: string;
}

export interface IncomerRegistrationDataIn {
  /* Service name */
  name: string;
  /* Commonly used to distinguish environnements */
  subscribeTo: SubscribeTo[];
}

export interface IncomerRegistrationMetadataIn {
  origin: string;
  prefix?: Prefix;
}

export interface IncomerRegistrationMessage {
  data: IncomerRegistrationDataIn;
  metadata: IncomerRegistrationMetadataIn;
}

export interface PongData {
  event: string;
}
