// Import Internal Dependencies
import { events } from "./utils/index";

export interface ValidateEventDataOptions {
  name: string;
  operation: "CREATE" | "UPDATE" | "DELETE" | "VOID";
  data: Record<string, any>;
}

export function validateEventData(options: ValidateEventDataOptions) {
  const { name, operation, data } = options;

  if(!events.has(name)) {
    throw "Unknown Event";
  }

  const event = events.get(name);
  if(!event.has(operation)) {
    throw "Unknown \"operation\" for for the specified \"event\"";
  }

  const operationValidationFunction = event.get(operation.toLocaleLowerCase());
  if (!operationValidationFunction(data)) {
    throw "Wrong data for the specified \"event\" & \"operation\"";
  }
}
