// Import Internal Dependencies
import { eventsValidationFonction } from "../../../src/index";

describe("eventsValidationFonction", () => {
  test("events should be defined", () => {
    expect(eventsValidationFonction).toBeDefined();
  });

  describe("connector", () => {
    let connector;

    beforeAll(() => {
      expect(eventsValidationFonction.has("connector")).toBe(true);

      connector = eventsValidationFonction.get("connector");
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
      expect(eventsValidationFonction.has("accountingFolder")).toBe(true);

      accountingFolder = eventsValidationFonction.get("accountingFolder");
    });

    test("connector should have a validation function for \"create\"", () => {
      expect(accountingFolder.has("create")).toBe(true);
    });
  });

  describe("document", () => {
    let document;

    beforeAll(() => {
      expect(eventsValidationFonction.has("document")).toBe(true);

      document = eventsValidationFonction.get("document");
    });

    test("document should have a validation function for \"create\"", () => {
      expect(document.has("create")).toBe(true);
    });
  });

  describe("portfolio", () => {
    let portfolio;

    beforeAll(() => {
      expect(eventsValidationFonction.has("portfolio")).toBe(true);

      portfolio = eventsValidationFonction.get("portfolio");
    });

    test("portfolio should have a validation function for \"create\"", () => {
      expect(portfolio.has("create")).toBe(true);
    });

    test("portfolio should have a validation function for \"delete\"", () => {
      expect(portfolio.has("delete")).toBe(true);
    });
  });
});
