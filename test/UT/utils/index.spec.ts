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
  });

  describe("accountingFolder", () => {
    let accountingFolder;

    beforeAll(() => {
      expect(eventsValidationFn.has("accountingFolder")).toBe(true);

      accountingFolder = eventsValidationFn.get("accountingFolder");
    });

    test("connector should have a validation function for \"create\"", () => {
      expect(accountingFolder.has("create")).toBe(true);
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
  });

  describe("portfolio", () => {
    let portfolio;

    beforeAll(() => {
      expect(eventsValidationFn.has("portfolio")).toBe(true);

      portfolio = eventsValidationFn.get("portfolio");
    });

    test("portfolio should have a validation function for \"create\"", () => {
      expect(portfolio.has("create")).toBe(true);
    });

    test("portfolio should have a validation function for \"delete\"", () => {
      expect(portfolio.has("delete")).toBe(true);
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
  });
});

describe("defaultStandardLog", () => {
  test(`given a payload with a scope object with props schemaId,
        firmId, accountingFolderId, and persPhysiqueId, it should return
        a string with the given info formatted.`, () => {
    const payload = {
      event: "foo",
      channel: "bar",
      scope: {
        schemaId: 1,
        firmId: 2,
        accountingFolderId: 3,
        persPhysiqueId: 4
      },
      data: {
        foo: "bar"
      }
    };

    const expected = `(s:1|f:2|acf:3|p:4) ${JSON.stringify(payload)}, foo`;

    expect(defaultStandardLog(payload, "foo")).toBe(expected);
  });

  test("given a payload without scope object, it should just return the given object as string", () => {
    const payload = {
      event: "foo",
      channel: "bar",
      data: {
        foo: "bar"
      }
    };

    const expected = `${JSON.stringify(payload)}, foo`;

    expect(defaultStandardLog(payload, "foo")).toBe(expected);
  });

  test("given a payload with any of the specified property in the scope object, it should return the given object as string", () => {
    const payload = {
      event: "foo",
      channel: "bar",
      scope: {
        foo: "bar"
      },
      data: {
        foo: "bar"
      }
    };

    const expected = `${JSON.stringify(payload)}, foo`;

    expect(defaultStandardLog(payload, "foo")).toBe(expected);
  })
});


