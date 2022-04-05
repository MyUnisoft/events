// Import Third-party Dependencies
import Ajv, { ValidateFunction } from "ajv";

// Import Internal Dependencies
import * as eventsValidationSchemas from "../schema/index";

// CONSTANTS
const ajv = new Ajv();

export type OperationFunctions = Record<string, any>;

type MappedEvents = Map<string, Map<string, ValidateFunction<OperationFunctions>>>;

export const events: MappedEvents = new Map();

for (const [name, validationSchemas] of Object.entries(eventsValidationSchemas)) {
  const operationsValidationFunctions: Map<string, ValidateFunction<OperationFunctions>> = new Map();

  for (const [operation, validationSchema] of Object.entries(validationSchemas)) {
    operationsValidationFunctions.set(operation, ajv.compile(validationSchema));
  }

  events.set(name, operationsValidationFunctions);
}
