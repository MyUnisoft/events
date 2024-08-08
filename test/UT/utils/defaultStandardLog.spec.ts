// Import Internal Dependencies
import { defaultStandardLog } from "../../../src/utils/index.js";

describe("defaultStandardLog", () => {
  test(`given a payload with a scope object with props schemaId,
        firmId, accountingFolderId, and persPhysiqueId, it should return
        a string with the given info formatted.`, () => {
    const payload = {
      name: "foo",
      operation: "CREATE",
      channel: "bar",
      metadata: {
        origin: {
          endpoint: "/foo",
          method: "POST",
          requestId: "1"
        }
      },
      scope: {
        schemaId: 1,
        firmId: 2,
        accountingFolderId: 3,
        persPhysiqueId: 4
      },
      redisMetadata: {
        origin: "bar",
        transactionId: "foo"
      },
      data: {
        foo: "bar"
      }
    };

    const expected = `(event-id:none|t-id:${payload.redisMetadata.transactionId}|s:1|f:2|acf:3|p:4|req-id:1)(name:foo|ope:CREATE|from:bar|to:none) foo`;

    expect(defaultStandardLog(payload)("foo")).toBe(expected);
  });

  test("given a payload without scope object, it should just return data about the event & the message", () => {
    const payload = {
      name: "foo",
      channel: "bar",
      redisMetadata: {
        origin: "bar",
        transactionId: "foo",
        to: "[foo, bar]"
      },
      data: {
        foo: "bar"
      }
    };

    const expected = `(event-id:none|t-id:${payload.redisMetadata.transactionId}|s:none|f:none|acf:none|p:none|req-id:none)(name:foo|ope:none|from:bar|to:[foo, bar]) foo`;

    expect(defaultStandardLog(payload)("foo")).toBe(expected);
  });

  test("given a payload with any of the specified property in the scope object, it should return the props", () => {
    const payload = {
      name: "foo",
      channel: "bar",
      scope: {
        foo: "bar"
      },
      redisMetadata: {
        transactionId: "foo",
        eventTransactionId: "foo-bar"
      },
      data: {
        foo: "bar"
      }
    };

    const { redisMetadata } = payload;
    const { transactionId, eventTransactionId } = redisMetadata;

    const expected = `(event-id:${eventTransactionId}|t-id:${transactionId}|s:none|f:none|acf:none|p:none|req-id:none)(name:foo|ope:none|from:none|to:none) foo`;

    expect(defaultStandardLog(payload)("foo")).toBe(expected);
  });
});


