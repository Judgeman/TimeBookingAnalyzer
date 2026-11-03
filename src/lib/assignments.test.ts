import { describe, expect, it } from "vitest";
import { describeAssignments, overlapsAssignments } from "./assignments";

describe("Einsatzzeiträume", () => {
  it("beschreibt Zeiträume lesbar", () => {
    expect(describeAssignments([])).toBeNull();
    expect(describeAssignments([{ from: "2026-01-01", to: "2026-02-28" }])).toBe("01.01.2026–28.02.2026");
    expect(
      describeAssignments([
        { from: "2026-01-01", to: "2026-02-28" },
        { from: "2026-10-01", to: null },
      ]),
    ).toBe("01.01.2026–28.02.2026, ab 01.10.2026");
  });

  it("prüft Überschneidung mit einem Zeitraum (leer = immer)", () => {
    const lena = [{ from: "2026-01-01", to: "2026-02-28" }];
    expect(overlapsAssignments([], ["2026-04-01", "2026-04-30"])).toBe(true);
    expect(overlapsAssignments(lena, ["2026-02-01", "2026-02-28"])).toBe(true);
    expect(overlapsAssignments(lena, ["2026-02-23", "2026-03-01"])).toBe(true); // Woche über Monatsgrenze
    expect(overlapsAssignments(lena, ["2026-03-01", "2026-03-31"])).toBe(false);
    expect(overlapsAssignments([{ from: "2026-10-01", to: null }], ["2026-12-01", "2026-12-31"])).toBe(true);
  });
});
