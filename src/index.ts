// Import Internal Dependencies
import { events } from "./utils/index";

// Import Types
import { Events, EventsDefinition } from "types";

export type ValidateEventDataOptions<T extends keyof EventsDefinition = Events> = EventsDefinition[T];

export function validateEventData<T extends keyof EventsDefinition = Events>(options: ValidateEventDataOptions<T>) {
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
