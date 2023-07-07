// Import Third-party Dependencies
import Ajv, { ValidateFunction } from "ajv";

// Import Internal Dependencies
import { eventsValidationSchemas } from "../schema/index";
import { EventOptions, Events, GenericEvent } from "types";

// CONSTANTS
const ajv = new Ajv();
const kCustomKey = "scope";
const kScopeKeys = Object.freeze({
  transactionId: "id",
  schemaId: "s",
  firmId: "f",
  accountingFolderId: "acf",
  persPhysiqueId: "p"
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

export type StandardLog<T extends GenericEvent = GenericEvent> = (data: T) => (message: string) => string;

export function defaultStandardLog<
  T extends GenericEvent = EventOptions<keyof Events>
>(event: T & { redisMetadata: { transactionId: string } }) {
  const logs = Array.from(mapped<T>(event)).join("|");

  function log(message: string) {
    return `(${logs}) ${message}`;
  }

  return log;
}

function* mapped<
  T extends GenericEvent = EventOptions<keyof Events>
>(event: T & { redisMetadata: { transactionId: string } }) {
  for (const [key, formattedKey] of Object.entries(kScopeKeys)) {
    if (key === "transactionId") {
      yield `${formattedKey}:${event.redisMetadata[key] ?? "none"}`;

      continue;
    }

    if (!event[kCustomKey] || !event[kCustomKey][key]) {
      yield `${formattedKey}:none`;

      continue;
    }

    yield `${formattedKey}:${event[kCustomKey][key] ?? "none"}`;
  }
}
