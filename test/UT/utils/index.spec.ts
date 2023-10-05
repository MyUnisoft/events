// Import Internal Dependencies
import { eventsValidationFn } from "../../../src/index";
import { defaultStandardLog } from "../../../src/utils";

describe("eventsValidationFn", () => {
  test("events should be defined", () => {
    expect(eventsValidationFn).toBeDefined();
  });

  describe("connector", () => {
    let connector;

    beforeAll(() => {
      expect(eventsValidationFn.has("connector")).toBe(true);

      connector = eventsValidationFn.get("connector");
    });

    test("connector should have a validation function for \"create\", \"update\", \"delete\"", () => {
      expect(connector.has("create")).toBe(true);
      expect(connector.has("update")).toBe(true);
      expect(connector.has("delete")).toBe(true);
    });

    test("connector should not have a validation function for \"void\"", () => {
      expect(connector.has("void")).toBe(false);
    });
  });

  describe("accountingFolder", () => {
    let accountingFolder;

    beforeAll(() => {
      expect(eventsValidationFn.has("accountingFolder")).toBe(true);

      accountingFolder = eventsValidationFn.get("accountingFolder");
    });

    test("connector should have a validation function for \"create\" & \"scope\"", () => {
      expect(accountingFolder.has("create")).toBe(true);
      expect(accountingFolder.has("scope")).toBe(true);
    });

    test("accountingFolder should not have a validation function for \"update\", \"delete\", \"void\"", () => {
      expect(accountingFolder.has("update")).toBe(false);
      expect(accountingFolder.has("delete")).toBe(false);
      expect(accountingFolder.has("void")).toBe(false);
    });
  });

  describe("document", () => {
    let document;

    beforeAll(() => {
      expect(eventsValidationFn.has("document")).toBe(true);

      document = eventsValidationFn.get("document");
    });

    test("document should have a validation function for \"create\"", () => {
      expect(document.has("create")).toBe(true);
    });

    test("document should not have a validation function for \"update\", \"delete\", \"void\"", () => {
      expect(document.has("update")).toBe(false);
      expect(document.has("delete")).toBe(false);
      expect(document.has("void")).toBe(false);
    });
  });

  describe("portfolio", () => {
    let portfolio;

    beforeAll(() => {
      expect(eventsValidationFn.has("portfolio")).toBe(true);

      portfolio = eventsValidationFn.get("portfolio");
    });

    test("portfolio should have a validation function for \"create\", \"delete\"", () => {
      expect(portfolio.has("create")).toBe(true);
      expect(portfolio.has("delete")).toBe(true);
    });

    test("portfolio should not have a validation function for \"update\", \"void\"", () => {
      expect(portfolio.has("update")).toBe(false);
      expect(portfolio.has("void")).toBe(false);
    });
  });

  describe("AccountingLineEntry", () => {
    let accountingLineEntry;

    beforeAll(() => {
      expect(eventsValidationFn.has("accountingLineEntry")).toBe(true);

      accountingLineEntry = eventsValidationFn.get("accountingLineEntry");
    });

    test("accountingLineEntry should have a validation function for \"create\"", () => {
      expect(accountingLineEntry.has("create")).toBe(true);
    });

    test("accountingLineEntry should not have a validation function for \"update\", \"delete\", \"void\"", () => {
      expect(accountingLineEntry.has("update")).toBe(false);
      expect(accountingLineEntry.has("delete")).toBe(false);
      expect(accountingLineEntry.has("void")).toBe(false);
    });
  });

  describe("AdminMessage", () => {
    let adminMessage;

    beforeAll(() => {
      expect(eventsValidationFn.has("adminMessage")).toBe(true);

      adminMessage = eventsValidationFn.get("adminMessage");
    });

    test("adminMessage should have a validation function for \"void\"", () => {
      expect(adminMessage.has("void")).toBe(true);
    });

    test("adminMessage should not have a validation function for \"create\", \"update\", \"delete\"", () => {
      expect(adminMessage.has("create")).toBe(false);
      expect(adminMessage.has("update")).toBe(false);
      expect(adminMessage.has("delete")).toBe(false);
    });
  });

  describe("ThirdParty", () => {
    let thirdParty;

    beforeAll(() => {
      expect(eventsValidationFn.has("thirdParty")).toBe(true);

      thirdParty = eventsValidationFn.get("thirdParty");
    });

    test("thirdParty should have a validation function for \"create\", \"update\", \"delete\"", () => {
      expect(thirdParty.has("create")).toBe(true);
      expect(thirdParty.has("update")).toBe(true);
      expect(thirdParty.has("delete")).toBe(true);
    });

    test("thirdParty should not have a validation function for \"void\"", () => {
      expect(thirdParty.has("void")).toBe(false);
    });
  });

  describe("AccountingEntryLettering", () => {
    let accountingEntryLettering;

    beforeAll(() => {
      expect(eventsValidationFn.has("accountingEntryLettering")).toBe(true);

      accountingEntryLettering = eventsValidationFn.get("accountingEntryLettering");
    });

    test("thirdParty should have a validation function for \"create\", \"update\", \"delete\"", () => {
      expect(accountingEntryLettering.has("create")).toBe(true);
    });

    test("thirdParty should not have a validation function for \"update\", \"delete\", \"void\"", () => {
      expect(accountingEntryLettering.has("update")).toBe(false);
      expect(accountingEntryLettering.has("delete")).toBe(false);
      expect(accountingEntryLettering.has("void")).toBe(false);
    });
  });
});

describe("defaultStandardLog", () => {
  test(`given a payload with a scope object with props schemaId,
        firmId, accountingFolderId, and persPhysiqueId, it should return
        a string with the given info formatted.`, () => {
    const payload = {
      name: "foo",
      operation: "CREATE",
      channel: "bar",
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

    const expected = `(event-id:none|t-id:${payload.redisMetadata.transactionId}|s:1|f:2|acf:3|p:4)(name:foo|ope:CREATE|from:bar|to:none) foo`;

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

    const expected = `(event-id:none|t-id:${payload.redisMetadata.transactionId}|s:none|f:none|acf:none|p:none)(name:foo|ope:none|from:bar|to:[foo, bar]) foo`;

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

    const expected = `(event-id:${eventTransactionId}|t-id:${transactionId}|s:none|f:none|acf:none|p:none)(name:foo|ope:none|from:none|to:none) foo`;

    expect(defaultStandardLog(payload)("foo")).toBe(expected);
  });
});


