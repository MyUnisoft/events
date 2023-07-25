// Import Internal Dependencies
import { Events } from "./events";

export interface Scope {
  schemaId: number;
  firmId?: number | null;
  accountingFolderId?: number | null;
  persPhysiqueId?: number | null;
}

export type Method = "POST" | "PATCH" | "PUT" | "DELETE";

export interface Metadata {
  agent: string;
  origin?: {
    endpoint: string;
    method: Method;
    requestId?: string;
  };
  createdAt: number;
}

export type EventOptions<T extends keyof Events = keyof Events> = {
  scope: Scope;
  metadata: Metadata;
} & Events[T];

export type EventsOptions<T extends (keyof Events)[] = (keyof Events)[]> = [
  ...(EventOptions<T[number]>)[]
];

type WebhookResponse<K extends keyof Events> = {
  scope: Scope;
  webhookId: string;
  createdAt: number;
} & Events[K];

export type WebhooksResponse<T extends (keyof Events)[] = (keyof Events)[]> = [
  ...(WebhookResponse<T[number]>)[]
];

export * from "./eventManagement/index";
export * from "./events";
