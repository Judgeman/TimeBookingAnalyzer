import { describe, expect, it } from "vitest";
import { sampleResult } from "../../test/fixture";
import {
  completedMonths,
  currentMissing,
  extremeMonth,
  insights,
  personPace,
  selectedBudgetMonths,
  teamPace,
  THRESHOLDS,
  vacationInsights,
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
    // Krank = Fehlzeit: Februar (Erika krank)
    expect(extremeMonth(r, (d) => d.plus_krank, "min")).toEqual({
      month: "2026-02",
      value: -15.5,
      persons: [
        { name: "Erika Mustermann", value: -14.5 },
        { name: "Max Mustermann", value: -1 },
      ],
    });
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
    expect([erika.overtimeSick, erika.recentOvertimeSick]).toEqual([21, 22.25]);
    expect([max.overtimeSick, max.recentOvertimeSick]).toEqual([73.5, 65.5]);
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
      overtime: -25, recentOvertime: 0, overtimeSick: -30, recentOvertimeSick: 0, sickRate: 0.08, vacationDays: 0,
      missingDays: 0, distraction: 0.2,
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
    expect(insights(null, [{ ...base, utilization: null, overtime: 0, overtimeSick: 0, sickRate: null, distraction: null }])).toEqual([]);
    // erst mit Krankheit als Fehlzeit unter Soll
    expect(insights(null, [{ ...base, utilization: null, overtime: 5, sickRate: null, distraction: null }])).toEqual([
      { level: "info", text: "Test: -30 h unter Soll, wenn Krankheit als Fehlzeit zählt." },
    ]);
    expect(THRESHOLDS.paceHigh).toBeGreaterThan(1);
  });
});

describe("Insights – Abruf je Monat (Auswahl)", () => {
  const sum = (months: { actual: number; target: number }[]) =>
    months.reduce((t, m) => ({ actual: t.actual + m.actual, target: t.target + m.target }), { actual: 0, target: 0 });

  it("ein Budget, alle Budgets oder ein eigener Zeitraum", () => {
    const r = sampleResult();
    const single = selectedBudgetMonths(r, { kind: "budget", index: 0 });
    expect(single).toEqual(teamPace(r)!.months);
    expect(sum(single)).toEqual({ actual: 319_865, target: 300_000 });
    expect(selectedBudgetMonths(r, { kind: "all" })).toEqual(single);
    const spring = selectedBudgetMonths(r, { kind: "range", from: "2026-03", to: "2026-05" });
    expect(spring.map((m) => m.month)).toEqual(["2026-03", "2026-04", "2026-05"]);
    expect(sum(spring)).toEqual({ actual: 84_955, target: 90_000 });
    // November/Dezember sind noch nicht abgeschlossen
    expect(selectedBudgetMonths(r, { kind: "range", from: "2026-10", to: "2026-12" })).toHaveLength(1);
  });

  it("jeder Monat mit dem Richtwert seines Budgets, Monate ohne Budget fehlen", () => {
    const r = sampleResult();
    const [b] = r.forecast.budgets;
    r.forecast.budgets = [
      { ...b, from: "2026-01", to: "2026-03", monthly_target: 35_000 },
      { ...b, from: "2026-07", to: "2026-12", monthly_target: 25_000 },
    ];
    const second = selectedBudgetMonths(r, { kind: "budget", index: 1 });
    expect(second.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(sum(second)).toEqual({ actual: 117_795, target: 100_000 });
    const all = selectedBudgetMonths(r, { kind: "all" });
    expect(all.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(all.find((m) => m.month === "2026-02")).toEqual({ month: "2026-02", actual: 40_790, target: 35_000, diff: 5_790 });
    const range = selectedBudgetMonths(r, { kind: "range", from: "2026-03", to: "2026-07" });
    expect(range.map((m) => [m.month, m.target])).toEqual([["2026-03", 35_000], ["2026-07", 25_000]]);
  });
});

describe("Insights – fehlende Buchungen aktuell", () => {
  it("je Person, meiste Tage zuerst, neueste Tage zuerst", () => {
    const r = sampleResult();
    expect(r.missing_current!.checked_until).toBe("2026-10-30");
    // je 1 Tag – bei Gleichstand mehr offene Stunden zuerst
    expect(currentMissing(r.missing_current!.bookings)).toEqual([
      { name: "Erika Mustermann", dates: ["2026-10-20"], hours: 7.5 },
      { name: "Max Mustermann", dates: ["2026-10-22"], hours: 4 },
    ]);
    const missing = (person: string, date: string) => ({
      person, date, expected_hours: 8, booked_hours: 0, coverage_percent: 0,
    });
    expect(
      currentMissing([missing("Max Mustermann", "2026-10-28"), missing("Erika Mustermann", "2026-10-29"),
        missing("Max Mustermann", "2026-10-30")]).map((p) => [p.name, p.dates]),
    ).toEqual([
      ["Max Mustermann", ["2026-10-30", "2026-10-28"]],
      ["Erika Mustermann", ["2026-10-29"]],
    ]);
    expect(currentMissing([])).toEqual([]);
  });
});

describe("Insights – Resturlaub", () => {
  const status = (remaining: number) => ({
    person: "Erika Mustermann", year: 2026, entitlement: 30, carry_over: 0, taken: 10, planned: 0, remaining,
  });
  it("meldet offenen Urlaub nur kurz vor Jahresende und überzogenen immer", () => {
    expect(vacationInsights([status(12)], "2026-10-31")).toHaveLength(1);
    expect(vacationInsights([status(12)], "2026-08-31")).toEqual([]); // noch 4 Monate
    expect(vacationInsights([status(4.5)], "2026-11-30")).toEqual([]); // unter 5 Tagen
    expect(vacationInsights([status(12)], "2027-01-31")).toEqual([]); // anderes Jahr
    expect(vacationInsights([status(-1.5)], "2026-03-31")[0]).toEqual({
      level: "warning",
      text: "Erika Mustermann: 1,5 Urlaubstage mehr genommen bzw. geplant als Anspruch 2026.",
    });
  });
});
