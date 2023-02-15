// Import Internal Dependencies
import { eventsValidationFunction } from "../../../src/index";

describe("eventsValidationFunction", () => {
  test("events should be defined", () => {
    expect(eventsValidationFunction).toBeDefined();
  });

  describe("connector", () => {
    let connector;

    beforeAll(() => {
      expect(eventsValidationFunction.has("connector")).toBe(true);

      connector = eventsValidationFunction.get("connector");
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
      expect(eventsValidationFunction.has("accountingFolder")).toBe(true);

      accountingFolder = eventsValidationFunction.get("accountingFolder");
    });

    test("connector should have a validation function for \"create\"", () => {
      expect(accountingFolder.has("create")).toBe(true);
    });
  });

  describe("document", () => {
    let document;

    beforeAll(() => {
      expect(eventsValidationFunction.has("document")).toBe(true);

      document = eventsValidationFunction.get("document");
    });

    test("document should have a validation function for \"create\"", () => {
      expect(document.has("create")).toBe(true);
    });
  });

  describe("portfolio", () => {
    let portfolio;

    beforeAll(() => {
      expect(eventsValidationFunction.has("portfolio")).toBe(true);

      portfolio = eventsValidationFunction.get("portfolio");
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
      expect(eventsValidationFunction.has("accountingLineEntry")).toBe(true);

      accountingLineEntry = eventsValidationFunction.get("accountingLineEntry");
    });

    test("accountingLineEntry should have a validation function for \"create\"", () => {
      expect(accountingLineEntry.has("create")).toBe(true);
    });
  });
});
