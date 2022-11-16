// Import Internal Dependencies
import * as MyEvents from "../../src/index";

describe("validate", () => {
  test("Casting no events name, it should take any events", () => {
    const event: MyEvents.EventOptions<"connector"> = {
      name: "connector",
      operation: "CREATE",
      metadata: {
        agent: "Jest",
        createdAt: Date.now().toString(),
        origin: {
          endpoint: "fake",
          method: "POST"
        }
      },
      scope: {
        schemaId: 1,
        firmId: 1,
        accountingFolderId: 1
      },
      data: {
        id: "1",
        code: "JFAC"
      }
    };

    expect(() => MyEvents.validate(event)).not.toThrow();
  });

  test("Casting events name, it should only take the specified events", () => {
    const event: MyEvents.EventOptions<"connector"> = {
      name: "connector",
      operation: "CREATE",
      metadata: {
        agent: "Jest",
        createdAt: Date.now().toString(),
        origin: {
          endpoint: "fake",
          method: "POST"
        }
      },
      scope: {
        schemaId: 1,
        firmId: 1,
        accountingFolderId: 1
      },
      data: {
        id: "10",
        code: "JFAC"
      }
    };

    expect(() => MyEvents.validate<"connector">(event)).not.toThrow();
  });

  test("Given a wrong event name, it should throw", () => {
    const event = {
      name: "eventThatDoesNotExist",
      operation: "VOID",
      data: {}
    };

    expect(() => MyEvents.validate(event as any)).toThrow(`Unknown "event": ${event.name}`);
  });

  test("Given a wrong operation according to the event name, it should throw", () => {
    const event = {
      name: "accountingFolder",
      operation: "UPDATE",
      data: {
        accountingFolderId: "1"
      }
    };

    expect(() => MyEvents.validate(event as any))
      .toThrow(`Unknown "operation": ${event.operation} for the "event": ${event.name}`);
  });

  test("Given a wrong data according to the operation and the event name, it should throw", () => {
    const event = {
      name: "accountingFolder",
      operation: "CREATE",
      data: {}
    };

    expect(() => MyEvents.validate(event as any))
      .toThrow(`Wrong data for the "operation": ${event.operation} on "event": ${event.name}`);
  });
});
