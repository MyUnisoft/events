// Import Third-party Dependencies
import Ajv, { ValidateFunction } from "ajv";

// Import Internal Dependencies
import { eventsValidationSchemas } from "../schema/index";
import { EventOptions, Events, GenericEvent } from "types";

// CONSTANTS
const ajv = new Ajv();
const kCustomKey = "scope";
const kScopeKeys = Object.freeze({
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

export function defaultStandardLog<
  T extends GenericEvent = EventOptions<keyof Events>
>(event: T & { channel: string }, message: string) {
  const formattedMessage = `${JSON.stringify(event)}, ${message}`;

  if (!event[kCustomKey]) {
    return formattedMessage;
  }

  const logs = Array.from(mapped(event)).join("|");

  return logs.length > 0 ? `(${logs}) ${formattedMessage}` : formattedMessage;
}

function* mapped(event: Record<string, any>) {
  for (const [key, value] of Object.entries(event[kCustomKey])) {
    const formattedKey = kScopeKeys[key];

    if (!formattedKey) {
      continue;
    }

    yield `${formattedKey}:${value}`;
  }
}
