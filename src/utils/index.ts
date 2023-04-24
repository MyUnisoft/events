// Import Third-party Dependencies
import Ajv, { ValidateFunction } from "ajv";

// Import Internal Dependencies
import { eventsValidationSchemas } from "../schema/index";

// CONSTANTS
const ajv = new Ajv();

export type OperationFunctions = Record<string, any>;

export type CustomEventsValidationFunctions = Map<string, ValidateFunction<OperationFunctions>>;

type MappedEventsValidationFunction = Map<string, CustomEventsValidationFunctions>;

export const eventsValidationFunction: MappedEventsValidationFunction = new Map();

for (const [name, validationSchemas] of Object.entries(eventsValidationSchemas)) {
  const operationsValidationFunctions: Map<string, ValidateFunction<OperationFunctions>> = new Map();

  for (const [operation, validationSchema] of Object.entries(validationSchemas)) {
    operationsValidationFunctions.set(operation, ajv.compile(validationSchema));
  }

  eventsValidationFunction.set(name, operationsValidationFunctions);
}
