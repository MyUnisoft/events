// Import Third-party Dependencies
import Ajv from "ajv";

// Import Internal Dependencies
import { eventsValidationFunction } from "./utils/index";
import { metadata as metadataSchema, scope as scopeSchema } from "./schema";

// Import Types
import { EventOptions, Events, Operation } from "./types/index";

// CONSTANTS
const ajv = new Ajv();
const metadataValidationFunction = ajv.compile(metadataSchema);
const scopeValidationFunction = ajv.compile(scopeSchema);

export function validate<T extends keyof Events = keyof Events>(options: EventOptions<T>) {
  const { name, operation, data, scope, metadata } = options;

  if (!eventsValidationFunction.has(name)) {
    throw new Error(`Unknown "event": ${name}`);
  }

  const event = eventsValidationFunction.get(name);
  if (!event.has(operation.toLocaleLowerCase())) {
    throw new Error(`Unknown "operation": ${operation} for the "event": ${name}`);
  }

  const operationValidationFunction = event.get(operation.toLocaleLowerCase());
  if (!operationValidationFunction(data)) {
    throw new Error(`Wrong data for the "operation": ${operation} on "event": ${name}`);
  }

  if (!metadataValidationFunction(metadata)) {
    throw new Error("Wrong data for metadata");
  }

  if (!scopeValidationFunction(scope)) {
    throw new Error("Wrong data for scope");
  }
}

export function isCreateOperation<T extends keyof Events>(
  operation: EventOptions<T>["operation"]
): operation is Operation["create"] {
  return operation === "CREATE";
}

export function isUpdateOperation<T extends keyof Events>(
  operation: EventOptions<T>["operation"]
): operation is Operation["update"] {
  return operation === "UPDATE";
}

export function isDeleteOperation<T extends keyof Events>(
  operation: EventOptions<T>["operation"]
): operation is Operation["delete"] {
  return operation === "DELETE";
}

export * as EventSchemas from "./schema/events/index";
export * from "./types/index";
export { eventsValidationFunction } from "./utils/index";
export * from "./class/eventManagement/dispatcher.class";
export * from "./class/eventManagement/incomer.class";
