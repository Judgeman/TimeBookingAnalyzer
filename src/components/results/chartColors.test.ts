import { describe, expect, it } from "vitest";
import { OTHER_LABEL, SERIES_COLORS, colorMapFor } from "./chartColors";

describe("colorMapFor", () => {
  it("vergibt die Farben in fester Reihenfolge", () => {
    const { colors, folded } = colorMapFor(["Home Office", "Büro", "Kunde vor Ort"]);
    expect([...colors]).toEqual([
      ["Home Office", SERIES_COLORS[0]],
      ["Büro", SERIES_COLORS[1]],
      ["Kunde vor Ort", SERIES_COLORS[2]],
    ]);
    expect(folded.size).toBe(0);
  });

  it("nutzt bei genau sechs Orten alle Farben ohne „Sonstige“", () => {
    const { colors, folded } = colorMapFor(["a", "b", "c", "d", "e", "f"]);
    expect(colors.size).toBe(6);
    expect(colors.has(OTHER_LABEL)).toBe(false);
    expect(folded.size).toBe(0);
  });

  it("fasst ab sieben Orten die kleinsten zu „Sonstige“ zusammen (Farbe 6)", () => {
    const { colors, folded } = colorMapFor(["a", "b", "c", "d", "e", "f", "g"]);
    expect([...folded]).toEqual(["f", "g"]);
    expect(colors.get(OTHER_LABEL)).toBe(SERIES_COLORS[5]);
    expect(colors.get("e")).toBe(SERIES_COLORS[4]);
    expect(colors.has("f")).toBe(false);
  });
});
