// Import Third-party Dependencies
import Ajv from "ajv";

// Import Internal Dependencies
import { concatErrors, eventsValidationFn } from "./utils/index.js";
import {
  metadata as metadataSchema,
  scope as scopeSchema
} from "./schema/index.js";
import type {
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
    throw new Error(`operation: ${operation} doesn't exist for the event: ${name}`);
  }

  const operationValidationFunction = event.get(operation?.toLocaleLowerCase());
  if (!operationValidationFunction(data)) {
    throw new Error(`data: [${concatErrors(operationValidationFunction.errors)}]`);
  }

  if (!metadataValidationFunction(metadata)) {
    throw new Error(`metadata: [${concatErrors(metadataValidationFunction.errors)}]`);
  }

  if (!scopeValidationFunction(scope)) {
    throw new Error(`scope: [${concatErrors(scopeValidationFunction.errors)}]`);
  }

  if (event.has("scope")) {
    const eventScopeValidationFn = event.get("scope");

    if (!eventScopeValidationFn(scope)) {
      throw new Error(`scope: [${concatErrors(eventScopeValidationFn.errors)}]`);
    }
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

export { eventsValidationFn } from "./utils/index";
export * as EventSchemas from "./schema/events/index";
export * from "./types/index";
export * from "./class/eventManagement/dispatcher.class";
export * from "./class/eventManagement/incomer.class";
