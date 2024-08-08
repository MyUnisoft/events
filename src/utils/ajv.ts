// Import Third-party Dependencies
import Ajv, { ErrorObject, ValidateFunction } from "ajv";

// Import Internal Dependencies
import { eventsValidationSchemas } from "../schema/index.js";

// CONSTANTS
const ajv = new Ajv();

export type NestedValidationFunctions = Map<string, ValidateFunction<Record<string, any>>>;

type MappedEventsValidationFn = Map<string, NestedValidationFunctions>;

export const eventsValidationFn: MappedEventsValidationFn = new Map<string, NestedValidationFunctions>();

for (const [name, validationSchemas] of Object.entries(eventsValidationSchemas)) {
  const operationsValidationFunctions: Map<string, ValidateFunction<Record<string, any>>> = new Map();

  for (const [operation, validationSchema] of Object.entries(validationSchemas)) {
    operationsValidationFunctions.set(operation, ajv.compile(validationSchema));
  }

  eventsValidationFn.set(name, operationsValidationFunctions);
}

export function concatErrors(
  errors: ErrorObject<string, Record<string, any>, unknown>[]
): string {
  return errors
    .map((error) => `${error.instancePath ? `${error.instancePath}: ` : ""}${error.message}`)
    .join("|");
}
