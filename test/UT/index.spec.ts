// Import Internal Dependencies
import { validateEventData, EventTypes } from "../../src/index";

// Import Types
import { EventsDefinition } from "../../src/types/index";

describe("validateEventData", () => {
  test("Casting no events name, it should take any events", () => {
    const event: EventsDefinition.Connector | EventsDefinition.AccountingFolder = {
      name: "connector",
      operation: "CREATE",
      data: {
        id: "1"
      }
    };

    expect(() => validateEventData(event)).not.toThrow();
  });

  test("Casting events name, it should only take the specified events", () => {
    const event: EventTypes.EventOptions<"connector"> = {
      name: "connector",
      operation: "CREATE",
      metadata: {
        agent: "Jest",
        createdAt: Date.now().toLocaleString()
      },
      scope: {
        schemaId: 1
      },
      data: {
        id: "10"
      }
    };

    expect(() => validateEventData<"connector">(event)).not.toThrow();
  });

  test("Given a wrong event name, it should throw", () => {
    const event = {
      name: "eventThatDoesNotExist",
      operation: "VOID",
      data: {}
    };

    expect(() => validateEventData(event as any)).toThrow(`Unknown "event": ${event.name}`);
  });

  test("Given a wrong operation according to the event name, it should throw", () => {
    const event = {
      name: "accountingFolder",
      operation: "UPDATE",
      data: {
        accountingFolderId: "1"
      }
    };

    expect(() => validateEventData(event as any))
      .toThrow(`Unknown "operation": ${event.operation} for the "event": ${event.name}`);
  });

  test("Given a wrong data according to the operation and the event name, it should throw", () => {
    const event = {
      name: "accountingFolder",
      operation: "CREATE",
      data: {}
    };

    expect(() => validateEventData(event as any))
      .toThrow(`Wrong data for the "operation": ${event.operation} on "event": ${event.name}`);
  });
});
