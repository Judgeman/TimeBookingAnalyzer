import { describe, expect, it } from "vitest";
import type { PeriodData } from "../../types/results";
import { METRICS, TABLE_METRICS, formatMetric, metricTitle, metricTone } from "./metrics";

const metric = (key: keyof PeriodData) => METRICS.find((m) => m.key === key)!;
const nbsp = (s: string) => s.replace(/\u00a0|\u202f/g, " ");

describe("Kennzahlen", () => {
  it("deckt jedes Feld von PeriodData genau einmal ab", () => {
    const keys = METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(13);
  });

  it("zeigt Tage und fehlende Buchungen nicht als Tabellenspalten", () => {
    const keys = TABLE_METRICS.map((m) => m.key);
    expect(keys).not.toContain("vac_days");
    expect(keys).not.toContain("sick_days");
    expect(keys).not.toContain("missing_days");
  });

  it("formatiert je nach Art", () => {
    expect(formatMetric(metric("soll_b"), 1636)).toBe("1.636,00");
    expect(formatMetric(metric("vac_days"), 2.5)).toBe("2,5");
    expect(nbsp(formatMetric(metric("bill_eur"), 1234.5))).toBe("1.234,50 €");
    expect(formatMetric(metric("plus"), -4.75)).toBe("−4,75");
  });

  it("färbt Plus grün, Minus rot und fehlende Buchungen rot", () => {
    expect(metricTone(metric("plus"), 3)).toBe("text-emerald-700");
    expect(metricTone(metric("plus_krank"), -1)).toBe("text-red-700");
    expect(metricTone(metric("plus"), 0)).toBe("");
    expect(metricTone(metric("gearb"), -1)).toBe("");
    expect(metricTone(metric("missing_days"), 2)).toContain("text-red-700");
    expect(metricTone(metric("missing_days"), 0)).toBe("");
  });

  it("zeigt bei Urlaub/Krank in Stunden die Tage als Tooltip", () => {
    const data = { vac_days: 1.5, sick_days: 2 } as PeriodData;
    expect(metricTitle(metric("vac_h"), data)).toBe("1,5 Tag(e)");
    expect(metricTitle(metric("sick_h"), data)).toBe("2 Tag(e)");
    expect(metricTitle(metric("gearb"), data)).toBeUndefined();
  });
});
