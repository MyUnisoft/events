// Import Internal Dependencies
import { events } from "./utils/index";

// Import Types
import { Events } from "./types/index";

export function validate<T extends keyof Events = keyof Events>(options: Events[T]) {
  const { name, operation, data } = options;

  if (!events.has(name)) {
    throw new Error(`Unknown "event": ${name}`);
  }

  const event = events.get(name);
  if (!event.has(operation.toLocaleLowerCase())) {
    throw new Error(`Unknown "operation": ${operation} for the "event": ${name}`);
  }

  const operationValidationFunction = event.get(operation.toLocaleLowerCase());
  if (!operationValidationFunction(data)) {
    throw new Error(`Wrong data for the "operation": ${operation} on "event": ${name}`);
  }
}

export * as Schema from "./schema";
export * from "./types/index";
export { events } from "./utils/index";
