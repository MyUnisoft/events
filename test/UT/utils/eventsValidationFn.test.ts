// Import Node.js Dependencies
import assert from "node:assert";
import { describe, before, test } from "node:test";

// Import Internal Dependencies
import { eventsValidationFn } from "../../../src/utils/index.js";


describe("eventsValidationFn", () => {
  test("events should be defined", () => {
    assert.ok(eventsValidationFn);
  });

  describe("connector", () => {
    let connector;

    before(() => {
      assert.ok(eventsValidationFn.has("connector"));

      connector = eventsValidationFn.get("connector");
    });

    test("connector should have a validation function for \"create\", \"update\", \"delete\"", () => {
      assert.ok(connector.has("create"));
      assert.ok(connector.has("update"));
      assert.ok(connector.has("delete"));
    });

    test("connector should not have a validation function for \"void\"", () => {
      assert.ok(!connector.has("void"));
    });
  });

  describe("accountingFolder", () => {
    let accountingFolder;

    before(() => {
      assert.ok(eventsValidationFn.has("accountingFolder"));

      accountingFolder = eventsValidationFn.get("accountingFolder");
    });

    test("accountingFolder should have a validation function for \"create\", \"update\", \"delete\", \"scope\"", () => {
      assert.ok(accountingFolder.has("create"));
      assert.ok(accountingFolder.has("update"));
      assert.ok(accountingFolder.has("delete"));
      assert.ok(accountingFolder.has("scope"));
    });

    test("accountingFolder should not have a validation function for \"void\"", () => {
      assert.ok(!accountingFolder.has("void"));
    });
  });

  describe("document", () => {
    let document;

    before(() => {
      assert.ok(eventsValidationFn.has("document"));

      document = eventsValidationFn.get("document");
    });

    test("document should have a validation function for \"create\", \"delete\"", () => {
      assert.ok(document.has("create"));
      assert.ok(document.has("delete"));
    });

    test("document should not have a validation function for \"update\", \"void\"", () => {
      assert.ok(!document.has("update"));
      assert.ok(!document.has("void"));
    });
  });

  describe("portfolio", () => {
    let portfolio;

    before(() => {
      assert.ok(eventsValidationFn.has("portfolio"));

      portfolio = eventsValidationFn.get("portfolio");
    });

    test("portfolio should have a validation function for \"create\", \"delete\"", () => {
      assert.ok(portfolio.has("create"));
      assert.ok(portfolio.has("delete"));
    });

    test("portfolio should not have a validation function for \"update\", \"void\"", () => {
      assert.ok(!portfolio.has("update"));
      assert.ok(!portfolio.has("void"));
    });
  });

  describe("AccountingLineEntry", () => {
    let accountingLineEntry;

    before(() => {
      assert.ok(eventsValidationFn.has("accountingLineEntry"));

      accountingLineEntry = eventsValidationFn.get("accountingLineEntry");
    });

    test("accountingLineEntry should have a validation function for \"create\"", () => {
      assert.ok(accountingLineEntry.has("create"));
    });

    test("accountingLineEntry should not have a validation function for \"update\", \"delete\", \"void\"", () => {
      assert.ok(!accountingLineEntry.has("update"));
      assert.ok(!accountingLineEntry.has("delete"));
      assert.ok(!accountingLineEntry.has("void"));
    });
  });

  describe("AdminMessage", () => {
    let adminMessage;

    before(() => {
      assert.ok(eventsValidationFn.has("adminMessage"));

      adminMessage = eventsValidationFn.get("adminMessage");
    });

    test("adminMessage should have a validation function for \"void\"", () => {
      assert.ok(adminMessage.has("void"));
    });

    test("adminMessage should not have a validation function for \"create\", \"update\", \"delete\"", () => {
      assert.ok(!adminMessage.has("create"));
      assert.ok(!adminMessage.has("update"));
      assert.ok(!adminMessage.has("delete"));
    });
  });

  describe("ThirdParty", () => {
    let thirdParty;

    before(() => {
      assert.ok(eventsValidationFn.has("thirdParty"));

      thirdParty = eventsValidationFn.get("thirdParty");
    });

    test("thirdParty should have a validation function for \"create\", \"update\", \"delete\"", () => {
      assert.ok(thirdParty.has("create"));
      assert.ok(thirdParty.has("update"));
      assert.ok(thirdParty.has("delete"));
    });

    test("thirdParty should not have a validation function for \"void\"", () => {
      assert.ok(!thirdParty.has("void"));
    });
  });

  describe("AccountingEntryLettering", () => {
    let accountingEntryLettering;

    before(() => {
      assert.ok(eventsValidationFn.has("accountingEntryLettering"));

      accountingEntryLettering = eventsValidationFn.get("accountingEntryLettering");
    });

    test("accountingEntryLettering should have a validation function for \"create\", \"delete\"", () => {
      assert.ok(accountingEntryLettering.has("create"));
      assert.ok(accountingEntryLettering.has("delete"));
    });

    test("accountingEntryLettering should not have a validation function for \"update\", \"void\"", () => {
      assert.ok(!accountingEntryLettering.has("update"));
      assert.ok(!accountingEntryLettering.has("void"));
    });
  });

  describe("DocumentCloud", () => {
    let cloudDocument;

    before(() => {
      assert.ok(eventsValidationFn.has("cloudDocument"));

      cloudDocument = eventsValidationFn.get("cloudDocument");
    });

    test("cloudDocument should have a validation function for \"create\", \"update\"", () => {
      assert.ok(cloudDocument.has("create"));
      assert.ok(cloudDocument.has("update"));
    });

    test("cloudDocument should not have a validation function for \"delete\", \"void\"", () => {
      assert.ok(!cloudDocument.has("delete"));
      assert.ok(!cloudDocument.has("void"));
    });
  });
});
