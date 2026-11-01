import { describe, expect, it } from "vitest";
import { parseDateList } from "./dates";

describe("parseDateList", () => {
  it("akzeptiert deutsche und ISO-Daten, je Zeile oder getrennt", () => {
    expect(parseDateList("24.12.2026\n2026-12-31")).toEqual(["2026-12-24", "2026-12-31"]);
    expect(parseDateList("1.5.2026; 3.10.2026, ")).toEqual(["2026-05-01", "2026-10-03"]);
    expect(parseDateList("  \n ")).toEqual([]);
  });

  it("lehnt ungültige Daten mit verständlicher Meldung ab", () => {
    expect(() => parseDateList("31.02.2026")).toThrow("„31.02.2026“ ist kein gültiges Datum.");
    expect(() => parseDateList("morgen")).toThrow("„morgen“ ist kein gültiges Datum.");
    expect(() => parseDateList("2026-13-01")).toThrow();
  });
});
