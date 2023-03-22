// Import Internal Dependencies
import * as MyEvents from "../../src/index";

describe("validate", () => {
  test("Casting no events name, it should take any events", () => {
    const event: MyEvents.EventOptions<"connector"> = {
      name: "connector",
      operation: "CREATE",
      metadata: {
        agent: "Jest",
        createdAt: Date.now(),
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
        createdAt: Date.now(),
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

  test("Given a wrong metadata, it should throw", () => {
    const event = {
      name: "accountingFolder",
      operation: "CREATE",
      data: {
        id: "1"
      },
      metadata: {
        origin: {
          endpoint: "fake",
          method: "POST"
        }
      },
      scope: {
        schemaId: 1,
        firmId: 1,
        accountingFolderId: 1
      }
    };

    expect(() => MyEvents.validate(event as any))
      .toThrow("Wrong data for metadata");
  });

  test("Given a wrong scope, it should throw", () => {
    const event = {
      name: "accountingFolder",
      operation: "CREATE",
      data: {
        id: "1"
      },
      metadata: {
        agent: "Jest",
        createdAt: Date.now(),
        origin: {
          endpoint: "fake",
          method: "POST"
        }
      },
      scope: {
        firmId: 1,
        accountingFolderId: 1
      }
    };

    expect(() => MyEvents.validate(event as any))
      .toThrow("Wrong data for scope");
  });
});

describe("isCreateOperation", () => {
  test("given operation as \"CREATE\"", async() => {
    expect(MyEvents.isCreateOperation("CREATE")).toBe(true);
  });

  test("given another operation", async() => {
    expect(MyEvents.isCreateOperation("UPDATE")).toBe(false);
    expect(MyEvents.isCreateOperation("DELETE")).toBe(false);
  });
});

describe("isUpdateOperation", () => {
  test("given operation as \"UPDATE\"", async() => {
    expect(MyEvents.isUpdateOperation("UPDATE")).toBe(true);
  });

  test("given another operation", async() => {
    expect(MyEvents.isUpdateOperation("CREATE")).toBe(false);
    expect(MyEvents.isUpdateOperation("DELETE")).toBe(false);
  });
});

describe("isDeleteOperation", () => {
  test("given operation as \"DELETE\"", async() => {
    expect(MyEvents.isDeleteOperation("DELETE")).toBe(true);
  });

  test("given another operation", async() => {
    expect(MyEvents.isDeleteOperation("UPDATE")).toBe(false);
    expect(MyEvents.isDeleteOperation("CREATE")).toBe(false);
  });
});
