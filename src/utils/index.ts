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

export function* deepParse(object: Record<string, any>) {
  for (const [key, value] of Object.entries(object)) {
    if (typeof value !== "object" || !Array.isArray(value)) {
      if (!isNaN(Number(value))) {
        yield [key, value];
      }

      try {
        yield [key, JSON.parse(value)];
      }
      catch {
        yield [key, value];
      }
    }

    yield [key, value];
  }
}
