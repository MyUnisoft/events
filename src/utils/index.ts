// Import Third-party Dependencies
import Ajv, { ValidateFunction } from "ajv";

// Import Internal Dependencies
import { eventsValidationSchemas } from "../schema/index";

// CONSTANTS
const ajv = new Ajv();

export type OperationFunctions = Record<string, any>;

type MappedEventsValidationFonction = Map<string, Map<string, ValidateFunction<OperationFunctions>>>;

export const eventsValidationFonction: MappedEventsValidationFonction = new Map();

for (const [name, validationSchemas] of Object.entries(eventsValidationSchemas)) {
  const operationsValidationFunctions: Map<string, ValidateFunction<OperationFunctions>> = new Map();

  for (const [operation, validationSchema] of Object.entries(validationSchemas)) {
    operationsValidationFunctions.set(operation, ajv.compile(validationSchema));
  }

  eventsValidationFonction.set(name, operationsValidationFunctions);
}
