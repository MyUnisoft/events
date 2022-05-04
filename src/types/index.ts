// Import Internal Dependencies
import * as EventsDefinition from "./events";

export interface Scope {
  schemaId: number;
  accountingFolderId?: number;
}

export type Method = "POST" | "PATCH" | "PUT" | "DELETE";

export interface Metadata {
  agent: string;
  origin?: {
    endpoint: string;
    method: Method;
  };
  createdAt: string;
}

export type EventOptions<K extends keyof EventsDefinition.Events = keyof EventsDefinition.Events> = {
  scope: Scope;
  metadata: Metadata;
} & EventsDefinition.Events[K];

type TupleToObject<T extends readonly any[],
  M extends Record<Exclude<keyof T, keyof any[]>, PropertyKey>> =
  { [K in Exclude<keyof T, keyof any[]> as M[K]]: T[K] };

export type EventsOptions<T extends (keyof EventsDefinition.Events)[] = (keyof EventsDefinition.Events)[]> = TupleToObject<[
  ...(EventOptions<T[number]>)[]
], []>;

type WebhookResponse<K extends keyof EventsDefinition.Events> = {
  scope: Scope;
  webhookId: number;
  createdAt: string;
} & EventsDefinition.Events[K];

export type WebhooksResponse<T extends (keyof EventsDefinition.Events)[] = (keyof EventsDefinition.Events)[]> = [
  ...(WebhookResponse<T[number]>)[]
];

export { EventsDefinition };
