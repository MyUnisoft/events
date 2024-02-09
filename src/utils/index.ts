// Import Third-party Dependencies
import Ajv, { ValidateFunction } from "ajv";

// Import Internal Dependencies
import { eventsValidationSchemas } from "../schema/index";
import { EventOptions, Events, GenericEvent } from "../types";

// CONSTANTS
const ajv = new Ajv();
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

export type OperationFunctions = Record<string, any>;

export type CustomEventsValidationFunctions = Map<string, ValidateFunction<OperationFunctions>>;

type MappedEventsValidationFn = Map<string, CustomEventsValidationFunctions>;

export const eventsValidationFn: MappedEventsValidationFn = new Map<string, CustomEventsValidationFunctions>();

for (const [name, validationSchemas] of Object.entries(eventsValidationSchemas)) {
  const operationsValidationFunctions: Map<string, ValidateFunction<OperationFunctions>> = new Map();

  for (const [operation, validationSchema] of Object.entries(validationSchemas)) {
    operationsValidationFunctions.set(operation, ajv.compile(validationSchema));
  }

  eventsValidationFn.set(name, operationsValidationFunctions);
}

export type StandardLog<T extends GenericEvent = GenericEvent> = (data: StandardLogOpts<T>) => (message: string) => string;
export type StandardLogOpts<T extends GenericEvent = GenericEvent> = T & {
  redisMetadata: {
    transactionId: string;
    origin?: string;
    to?: string;
    eventTransactionId?: string;
  }
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

export function handleLoggerMode(mode: string): string {
  return (mode === "info" || mode === "debug" || mode === "warn" || mode === "silent") ? mode : "info";
}
