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
});
