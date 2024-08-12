// Import Node.js Dependencies
import assert from "node:assert";
import { describe, test } from "node:test";

// Import Internal Dependencies
import {
  EventOptions,
  validate,
  isUpdateOperation,
  isCreateOperation,
  isDeleteOperation
} from "../../src/index.js";

describe("validate", () => {
  test("Given a wrong event name, it should throw", () => {
    const event = {
      name: "eventThatDoesNotExist",
      operation: "VOID",
      data: {}
    };


    assert.throws(() => validate(event as any), {
      name: "Error",
      message: `Unknown "event": ${event.name}`
    });
  });

  test("Given a wrong operation according to the event name, it should throw", () => {
    const event = {
      name: "accountingFolder",
      operation: "VOID",
      data: {
        accountingFolderId: "1"
      }
    };

    assert.throws(() => validate(event as any), {
      name: "Error",
      message: `operation: ${event.operation} doesn't exist for the event: ${event.name}`
    });
  });

  test("Given a wrong data according to the operation and the event name, it should throw", () => {
    const event = {
      name: "connector",
      operation: "CREATE",
      data: {}
    };

    assert.throws(() => validate(event as any), {
      name: "Error",
      message: `data: [must have required property 'id']`
    });
  });

  test("Given a wrong property, it should throw", () => {
    const event = {
      name: "connector",
      operation: "CREATE",
      data: {
        id: "foo",
        code: "bar"
      }
    };

    assert.throws(() => validate(event as any), {
      name: "Error",
      message: `data: [/id: must match pattern \"^[0-9]+\"]`
    });
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

    assert.throws(() => validate(event as any), {
      name: "Error",
      message: "metadata: [must have required property 'agent']"
    });
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

    assert.throws(() => validate(event as any), {
      name: "Error",
      message: "scope: [must have required property 'schemaId']"
    });
  });
});

describe("isCreateOperation", () => {
  test("given operation as \"CREATE\"", async() => {
    assert.ok(isCreateOperation("CREATE"));
  });

  test("given another operation", async() => {
    assert.ok(!isCreateOperation("UPDATE"));
    assert.ok(!isCreateOperation("DELETE"));
    assert.ok(!isCreateOperation("VOID"));
  });
});

describe("isUpdateOperation", () => {
  test("given operation as \"UPDATE\"", async() => {
    assert.ok(isUpdateOperation("UPDATE"));
  });

  test("given another operation", async() => {
    assert.ok(!isUpdateOperation("CREATE"));
    assert.ok(!isUpdateOperation("DELETE"));
    assert.ok(!isUpdateOperation("VOID"));
  });
});

describe("isDeleteOperation", () => {
  test("given operation as \"DELETE\"", async() => {
    assert.ok(isDeleteOperation("DELETE"));
  });

  test("given another operation", async() => {
    assert.ok(!isDeleteOperation("CREATE"));
    assert.ok(!isDeleteOperation("UPDATE"));
    assert.ok(!isDeleteOperation("VOID"));
  });
});
