// Import Internal Dependencies
import { events } from "./utils/index";

// Import Types
import { EventsDefinition } from "./types/index";

export function validateEventData<T extends keyof EventsDefinition.Events = keyof EventsDefinition.Events>(options: EventsDefinition.Events[T]) {
  const { name, operation, data } = options;

  if(!events.has(name)) {
    throw "Unknown Event";
  }

  const event = events.get(name);
  if(!event.has(operation)) {
    throw `Unknown "operation" for for the specified "event"`;
  }

  const operationValidationFunction = event.get(operation.toLocaleLowerCase());
  if (!operationValidationFunction(data)) {
    throw `Wrong data for the specified "event" & "operation"`;
  }
}

export * as EventTypes from "./types/index";
