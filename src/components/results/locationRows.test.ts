import { describe, expect, it } from "vitest";
import type { LocationShare } from "../../types/results";
import { OTHER_LABEL, colorMapFor } from "./chartColors";
import { homeOfficeShares, toRows } from "./locationRows";

const share = (location: string, hours: number, share: number, days: number): LocationShare => ({
  location,
  hours,
  share,
  days,
});

describe("toRows", () => {
  it("übernimmt Orte mit fester Farbe", () => {
    const colorMap = colorMapFor(["Home Office", "Büro"]);
    const rows = toRows([share("Büro", 30, 75, 4), share("Home Office", 10, 25, 2)], colorMap);
    expect(rows.map((r) => [r.label, r.hours, r.share, r.color])).toEqual([
      ["Büro", 30, 75, colorMap.colors.get("Büro")],
      ["Home Office", 10, 25, colorMap.colors.get("Home Office")],
    ]);
  });

  it("fasst gefaltete und unbekannte Orte zu „Sonstige“ zusammen", () => {
    const colorMap = colorMapFor(["a", "b", "c", "d", "e", "f", "g"]);
    const rows = toRows(
      [share("a", 50, 50, 5), share("f", 20, 20, 2), share("g", 10, 10, 1), share("neu", 20, 20, 3)],
      colorMap,
    );
    expect(rows.map((r) => r.label)).toEqual(["a", OTHER_LABEL]);
    const other = rows[1];
    expect([other.hours, other.days, other.share]).toEqual([50, 6, 50]);
  });
});

describe("homeOfficeShares", () => {
  it("erkennt Home Office, Remote und mobiles Arbeiten", () => {
    const shares = [
      share("Home Office", 1, 0, 1),
      share("remote", 1, 0, 1),
      share("Mobiles Arbeiten", 1, 0, 1),
      share("Büro", 1, 0, 1),
    ];
    expect(homeOfficeShares(shares).map((s) => s.location)).toEqual([
      "Home Office",
      "remote",
      "Mobiles Arbeiten",
    ]);
  });
});
