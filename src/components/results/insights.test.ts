import { describe, expect, it } from "vitest";
import { sampleResult } from "../../test/fixture";
import {
  completedMonths,
  extremeMonth,
  insights,
  personPace,
  teamPace,
  THRESHOLDS,
  type PersonPace,
} from "./insights";

// Erwartungswerte unabhängig (Python) aus src/test/fixtures/sample-result.json nachgerechnet.
describe("Insights – Kennzahlen", () => {
  it("nimmt nur abgeschlossene Monate", () => {
    const months = completedMonths(sampleResult());
    expect(months[0]).toBe("2026-01");
    expect(months.at(-1)).toBe("2026-10");
    const november = sampleResult();
    november.forecast.from = "2026-10-14"; // Oktober noch nicht abgeschlossen
    expect(completedMonths(november).at(-1)).toBe("2026-09");
  });

  it("findet die Rekord-Monate des Teams mit Beiträgen der Personen", () => {
    const r = sampleResult();
    expect(extremeMonth(r, (d) => d.sick_days)).toEqual({
      month: "2026-10",
      value: 3,
      persons: [{ name: "Max Mustermann", value: 3 }],
    });
    expect(extremeMonth(r, (d) => d.vac_days)).toMatchObject({ month: "2026-07", value: 11 });
    expect(extremeMonth(r, (d) => d.plus)).toMatchObject({ month: "2026-09", value: 54.5 });
    expect(extremeMonth(r, (d) => d.plus, "min")).toMatchObject({ month: "2026-03", value: -0.75 });
    expect(extremeMonth(r, (d) => d.missing_days)).toMatchObject({ month: "2026-10", value: 2 });
    expect(extremeMonth(r, () => 0)).toBeNull();
  });

  it("Team-Pace gegenüber dem Richtwert", () => {
    const pace = teamPace(sampleResult())!;
    expect(pace.months).toHaveLength(10);
    expect(pace.average).toBeCloseTo(31_986.5, 2);
    expect(pace.ratio).toBeCloseTo(1.0662, 4);
    expect(pace.recentAverage).toBeCloseTo(29_827.92, 2);
    expect(pace.recentRatio).toBeCloseTo(0.9943, 4);
    expect(pace.remainingMonths).toBe(2);
    expect(pace.neededPerMonth).toBeCloseTo(20_067.5, 2);
    expect(pace.forecastPerMonth).toBeCloseTo(23_814.76, 2);
    expect(pace.mostLeft).toMatchObject({ month: "2026-08", actual: 24_557.5, diff: -5_442.5 });
    expect(pace.mostUsed).toMatchObject({ month: "2026-01", actual: 44_350, diff: 14_350 });

    const none = sampleResult();
    none.forecast.budgets = [];
    expect(teamPace(none)).toBeNull();
    const ended = sampleResult();
    ended.forecast.from = "2027-01-01"; // alle 12 Monate abgeschlossen
    expect(teamPace(ended)).toMatchObject({ remainingMonths: 0, neededPerMonth: null, forecastPerMonth: null });
  });

  it("Pace je Person", () => {
    const [erika, max, lena] = personPace(sampleResult());
    expect(erika).toMatchObject({ name: "Erika Mustermann", activeMonths: 10, overtime: 41, recentOvertime: 22.25, vacationDays: 15, missingDays: 1 });
    expect(erika.utilization).toBeCloseTo(0.9893, 4);
    expect(erika.recentUtilization).toBeCloseTo(1.0139, 4);
    expect(erika.averageInvoiced).toBeCloseTo(15_194, 2);
    expect(erika.effectiveRate).toBeCloseTo(98.5344, 4);
    expect(erika.sickRate).toBeCloseTo(0.0122, 4);
    expect(erika.distraction).toBe(0.034);
    expect(max.utilization).toBeCloseTo(1.0323, 4);
    expect(max.recentUtilization).toBeCloseTo(1.1698, 4);
    expect(max.overtime).toBe(91.5);
    // Lena nur Januar/Februar im Einsatz
    expect(lena).toMatchObject({ activeMonths: 2, utilization: 1, averageInvoiced: 13_120, effectiveRate: 80 });
  });

  it("leitet Hinweise aus den Schwellen ab", () => {
    const r = sampleResult();
    const list = insights(teamPace(r), personPace(r)).map((i) => `${i.level}: ${i.text.replace(/ /g, " ")}`);
    expect(list).toContain("warning: Das Team ruft 107 % des Richtwerts ab – bei diesem Tempo wird das Budget um 7.495 € überzogen.");
    expect(list).toContain("warning: Erika Mustermann: +41 h Überstunden – Abbau einplanen.");
    expect(list).toContain("warning: Max Mustermann: +91,5 h Überstunden – Abbau einplanen.");
    expect(list).toContain("info: Erika Mustermann: 1 Tag(e) mit fehlender Buchung – nachbuchen lassen.");
    expect(list.some((t) => t.includes("Krankenquote"))).toBe(false);

    const base: PersonPace = {
      name: "Test", activeMonths: 6, utilization: 0.95, recentUtilization: 0.8, averageInvoiced: 1, effectiveRate: 1,
      overtime: -25, recentOvertime: 0, sickRate: 0.08, vacationDays: 0, missingDays: 0, distraction: 0.2,
    };
    const low = teamPace(r)!;
    low.ratio = 0.8;
    low.budget = { ...low.budget, deviation: -20_000 };
    const texts = insights(low, [base]).map((i) => i.text.replace(/ /g, " "));
    expect(texts).toEqual([
      "Das Team ruft nur 80 % des Richtwerts ab – voraussichtlich bleiben 20.000 € liegen.",
      "Test: Abrechnungsquote gesunken (Jahr 95 %, zuletzt 80 %).",
      "Test: -25 h unter Soll.",
      "Test: Krankenquote 8 %.",
      "Test: 20 % der Arbeitszeit nicht abrechenbar.",
    ]);
    expect(insights(null, [{ ...base, utilization: null, overtime: 0, sickRate: null, distraction: null }])).toEqual([]);
    expect(THRESHOLDS.paceHigh).toBeGreaterThan(1);
  });
});
