// Import Third-party Dependencies
import Ajv from "ajv";

// Import Internal Dependencies
import { eventsValidationFn } from "./utils/index";
import { metadata as metadataSchema, scope as scopeSchema } from "./schema";

// Import Types
import {
  EventOptions,
  EventSubscribe,
  Events,
  Operation
} from "./types/index";

// CONSTANTS
const ajv = new Ajv();
const metadataValidationFunction = ajv.compile(metadataSchema);
const scopeValidationFunction = ajv.compile(scopeSchema);

export function validate<T extends keyof Events = keyof Events>(options: EventOptions<T>) {
  const { name, operation, data, scope, metadata } = options;

  if (!eventsValidationFn.has(name)) {
    throw new Error(`Unknown "event": ${name}`);
  }

  const event = eventsValidationFn.get(name);
  if (!event.has(operation?.toLocaleLowerCase())) {
    throw new Error(`Unknown "operation": ${operation} for the "event": ${name}`);
  }

  const operationValidationFunction = event.get(operation?.toLocaleLowerCase());
  if (!operationValidationFunction(data)) {
    throw new Error(`"event": ${name} | "operation": ${operation}: ${[...operationValidationFunction.errors]
      .map((error) => error.message)}`);
  }

  if (!metadataValidationFunction(metadata)) {
    throw new Error(`metadata: ${[...metadataValidationFunction.errors].map((error) => error.message)}`);
  }

  if (!scopeValidationFunction(scope)) {
    throw new Error(`scope: ${[...scopeValidationFunction.errors].map((error) => error.message)}`);
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

export const AVAILABLE_EVENTS = Object.freeze<Record<keyof Events, EventSubscribe>>(
  ([...eventsValidationFn.keys()].map((name) => {
    return {
      name,
      delay: undefined,
      horizontalScale: undefined
    };
  })).reduce((prev, curr) => Object.assign(prev, { [curr.name]: curr }), {}) as Record<keyof Events, EventSubscribe>
);

export * as EventSchemas from "./schema/events/index";
export * from "./types/index";
export { eventsValidationFn } from "./utils/index";
export * from "./class/eventManagement/dispatcher.class";
export * from "./class/eventManagement/incomer.class";
