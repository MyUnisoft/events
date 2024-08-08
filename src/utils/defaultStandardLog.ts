// Import Internal Dependencies
import type { EventOptions, Events, GenericEvent } from "../types";

// CONSTANTS
const kScopeKey = "scope";
const kMetadataKey = "metadata";
const kOriginKey = "origin";
const kScopeKeys = Object.freeze({
  eventTransactionId: "event-id",
  transactionId: "t-id",
  schemaId: "s",
  firmId: "f",
  accountingFolderId: "acf",
  persPhysiqueId: "p",
  requestId: "req-id"
});

export type StandardLog<T extends GenericEvent = GenericEvent> = (data: StandardLogOpts<T>) => (message: string) => string;
export type StandardLogOpts<T extends GenericEvent = GenericEvent> = T & {
  redisMetadata: {
    transactionId: string;
    origin?: string;
    to?: string;
    eventTransactionId?: string;
  }
}

export function defaultStandardLog<
  T extends GenericEvent = EventOptions<keyof Events>
>(event: T & { redisMetadata: { transactionId: string; origin?: string; to?: string, eventTransactionId?: string } }) {
  const logs = Array.from(mapped<T>(event)).join("|");

  // eslint-disable-next-line max-len
  const eventMeta = `name:${logValueFallback(event.name)}|ope:${logValueFallback(event.operation)}|from:${logValueFallback(event.redisMetadata.origin)}|to:${logValueFallback(event.redisMetadata.to)}`;

  function log(message: string) {
    return `(${logs})(${eventMeta}) ${message}`;
  }

  return log;
}

function logValueFallback(value: string): string {
  return value ?? "none";
}

function* mapped<
  T extends GenericEvent = EventOptions<keyof Events>
>(event: T & { redisMetadata: { transactionId: string } }) {
  for (const [key, formattedKey] of Object.entries(kScopeKeys)) {
    if (key === "transactionId") {
      yield `${formattedKey}:${logValueFallback(event.redisMetadata[key])}`;

      continue;
    }

    if (key === "eventTransactionId") {
      yield `${formattedKey}:${logValueFallback(event.redisMetadata[key])}`;

      continue;
    }

    const originExist = event[kMetadataKey] && event[kMetadataKey][kOriginKey];

    if (!event[kScopeKey] || !event[kScopeKey][key]) {
      if (originExist && event[kMetadataKey][kOriginKey][key]) {
        yield `${formattedKey}:${logValueFallback(event[kMetadataKey][kOriginKey][key])}`;

        continue;
      }

      yield `${formattedKey}:none`;

      continue;
    }

    yield `${formattedKey}:${logValueFallback(event[kScopeKey][key])}`;
  }
}
