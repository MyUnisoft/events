// Import Internal Dependencies
import { Events, Metadata } from "./events.js";

export type EventOptions<T extends keyof Events = keyof Events> = {
  metadata: Metadata;
} & Events[T];

export type EventsOptions<T extends (keyof Events)[] = (keyof Events)[]> = [
  ...(EventOptions<T[number]>)[]
];

export type WebhookResponse<K extends keyof Events> = {
  webhookId: string;
  createdAt: number;
} & Events[K];

export type WebhooksResponse<T extends (keyof Events)[] = (keyof Events)[]> = [
  ...(WebhookResponse<T[number]>)[]
];

export * from "./events/index.js";
export * from "./events/dispatcher-channel.js";
export * from "./events/incomer-channel.js";
export * from "./events.js";
