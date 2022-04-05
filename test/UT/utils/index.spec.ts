// Import Internal Dependencies
import { events } from "../../../src/utils/index";

describe("events", () => {
  test("events should be defined", () => {
    expect(events).toBeDefined();
  });

  describe("connector", () => {
    let connector;

    beforeAll(() => {
      expect(events.has("connector")).toBe(true);

      connector = events.get("connector");
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
      expect(events.has("accountingFolder")).toBe(true);

      accountingFolder = events.get("accountingFolder");
    });

    test("connector should have a validation function for \"create\"", () => {
      expect(accountingFolder.has("create")).toBe(true);
    });
  });
});
