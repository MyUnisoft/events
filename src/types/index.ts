// Import Internal Dependencies
import * as EventsDefinition from "./events";

export interface Scope {
  schemaId: number;
  accountingFolderId?: number;
}

export interface Metadata {
  agent: string;
  origin?: {
    endpoint: string;
    method: "POST" | "PATCH" | "PUT" | "DELETE";
  };
  createdAt: string;
}

export type EventOptions<K extends keyof EventsDefinition.Events = keyof EventsDefinition.Events> = {
  scope: Scope;
  metadata: Metadata;
} & EventsDefinition.Events[K];

export type EventsOptions<T extends (keyof EventsDefinition.Events)[] = (keyof EventsDefinition.Events)[]> = [
  ...(EventOptions<T[number]>)[]
];

type WebhookResponse<K extends keyof EventsDefinition.Events> = {
  scope: Scope;
  webhookId: number;
  createdAt: string;
} & EventsDefinition.Events[K];

export type WebhooksResponse<T extends (keyof EventsDefinition.Events)[] = (keyof EventsDefinition.Events)[]> = [
  ...(WebhookResponse<T[number]>)[]
];

export { EventsDefinition };
