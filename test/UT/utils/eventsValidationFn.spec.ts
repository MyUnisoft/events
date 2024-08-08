// Import Internal Dependencies
import { eventsValidationFn } from "../../../src/utils/index.js";

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

    test("accountingFolder should have a validation function for \"create\", \"update\", \"delete\", \"scope\"", () => {
      expect(accountingFolder.has("create")).toBe(true);
      expect(accountingFolder.has("update")).toBe(true);
      expect(accountingFolder.has("delete")).toBe(true);
      expect(accountingFolder.has("scope")).toBe(true);
    });

    test("accountingFolder should not have a validation function for \"void\"", () => {
      expect(accountingFolder.has("void")).toBe(false);
    });
  });

  describe("document", () => {
    let document;

    beforeAll(() => {
      expect(eventsValidationFn.has("document")).toBe(true);

      document = eventsValidationFn.get("document");
    });

    test("document should have a validation function for \"create\", \"delete\"", () => {
      expect(document.has("create")).toBe(true);
      expect(document.has("delete")).toBe(true);
    });

    test("document should not have a validation function for \"update\", \"void\"", () => {
      expect(document.has("update")).toBe(false);
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

    test("accountingEntryLettering should have a validation function for \"create\", \"delete\"", () => {
      expect(accountingEntryLettering.has("create")).toBe(true);
      expect(accountingEntryLettering.has("delete")).toBe(true);
    });

    test("accountingEntryLettering should not have a validation function for \"update\", \"void\"", () => {
      expect(accountingEntryLettering.has("update")).toBe(false);
      expect(accountingEntryLettering.has("void")).toBe(false);
    });
  });

  describe("DocumentCloud", () => {
    let cloudDocument;

    beforeAll(() => {
      expect(eventsValidationFn.has("cloudDocument")).toBe(true);

      cloudDocument = eventsValidationFn.get("cloudDocument");
    });

    test("cloudDocument should have a validation function for \"create\", \"update\"", () => {
      expect(cloudDocument.has("create")).toBe(true);
      expect(cloudDocument.has("update")).toBe(true);
    });

    test("cloudDocument should not have a validation function for \"delete\", \"void\"", () => {
      expect(cloudDocument.has("delete")).toBe(false);
      expect(cloudDocument.has("void")).toBe(false);
    });
  });
});
