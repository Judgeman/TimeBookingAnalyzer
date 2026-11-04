import { describe, expect, it } from "vitest";
import { sampleResult } from "../../test/fixture";
import type { BudgetStatus, Forecast } from "../../types/results";
import {
  accuracySummary,
  activeBudgetIndex,
  budgetVerdict,
  cumulativeSeries,
  currentMonth,
  dataEndOf,
  deviation,
  monthEnd,
} from "./forecast";

const budget = (from: string, to: string, extra: Partial<BudgetStatus> = {}): BudgetStatus => ({
  from,
  to,
  amount: 1000,
  monthly_target: 100,
  month_count: 10,
  target_to_date: 0,
  actual_net: 0,
  forecast_net: 0,
  expected_net: 0,
  deviation: 0,
  exhausted_on: null,
  exceeded: false,
  ...extra,
});

describe("Prognose – Hilfsfunktionen", () => {
  it("Stand der Daten, Monatsende und laufender Monat", () => {
    const { forecast } = sampleResult();
    expect(dataEndOf(forecast)).toBe("2026-10-31");
    expect(dataEndOf({ ...forecast, from: "2026-03-01" })).toBe("2026-02-28");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
    expect(currentMonth(forecast)?.month).toBe("2026-11");
  });

  it("wählt das Budget mit dem ersten Prognosetag, sonst das zuletzt begonnene", () => {
    const base = sampleResult().forecast;
    const withBudgets = (budgets: BudgetStatus[]): Forecast => ({ ...base, budgets });
    expect(activeBudgetIndex(withBudgets([budget("2025-01", "2025-12"), budget("2026-01", "2026-12")]))).toBe(1);
    expect(activeBudgetIndex(withBudgets([budget("2025-01", "2025-06"), budget("2025-07", "2025-12")]))).toBe(1);
    expect(activeBudgetIndex(withBudgets([budget("2027-01", "2027-12")]))).toBe(0);
    expect(activeBudgetIndex(withBudgets([]))).toBe(0);
  });

  it("kumuliert Ist, Prognose und Richtwert – Übergang am Monatsende", () => {
    const { forecast } = sampleResult();
    const points = cumulativeSeries(forecast, "2026-01", "2026-12", 30_000);
    expect(points).toHaveLength(13);
    expect(points[0]).toEqual({ date: "2026-01-01", month: null, actual: 0, forecast: null, target: 0 });
    const oct = points.find((p) => p.month === "2026-10")!;
    expect(oct).toMatchObject({ date: "2026-10-31", actual: 319_865, forecast: 319_865, target: 300_000 });
    const dec = points[12];
    expect(dec.actual).toBeNull();
    expect(dec.forecast).toBeCloseTo(367_494.52, 2);
    expect(dec.target).toBe(360_000);
    expect(points.find((p) => p.month === "2026-09")!.forecast).toBeNull();
  });

  it("Übergang mitten im Monat und Budget nach dem Stand der Daten", () => {
    const { forecast } = sampleResult();
    const mid: Forecast = { ...forecast, from: "2026-10-14" };
    const points = cumulativeSeries(mid, "2026-10", "2026-11", null);
    // Start, Stand 13.10. (Ist → Prognose), Ende Oktober, Ende November
    expect(points.map((p) => p.date)).toEqual(["2026-10-01", "2026-10-13", "2026-10-31", "2026-11-30"]);
    expect(points[1]).toMatchObject({ actual: 30_526.25, forecast: 30_526.25, target: null });
    expect(points[2].actual).toBeNull();

    const future = cumulativeSeries(forecast, "2026-12", "2026-12", 1000);
    expect(future[0]).toMatchObject({ actual: null, forecast: 0, target: 0 });
    expect(future[1].forecast).toBeCloseTo(24_267.22, 2);

    const firstDay = cumulativeSeries({ ...forecast, from: "2026-11-02" }, "2026-11", "2026-11", null);
    expect(firstDay.map((p) => p.date)).toEqual(["2026-11-01", "2026-11-01", "2026-11-30"]);
  });

  it("beschreibt den Stand des Budgets", () => {
    expect(budgetVerdict(budget("a", "b", { exceeded: true, deviation: 10 }))).toEqual({
      over: true,
      text: "Budget bereits überschritten",
    });
    expect(budgetVerdict(budget("a", "b", { deviation: 10 })).text).toBe("Voraussichtliche Überziehung");
    expect(budgetVerdict(budget("a", "b", { deviation: -10 }))).toEqual({
      over: false,
      text: "Budget reicht voraussichtlich",
    });
  });
});

describe("Prognosegüte – Kennzahlen", () => {
  it("Ø Abweichung, Tendenz und Treffer (Werte unabhängig aus dem Fixture nachgerechnet)", () => {
    const months = sampleResult().forecast_accuracy;
    const backtest = accuracySummary(months, "backtest");
    expect(backtest.count).toBe(10);
    expect(backtest.meanError).toBeCloseTo(0.0847, 4);
    expect(backtest.bias).toBeCloseTo(0.0204, 4);
    expect(backtest.hits).toBe(7);
    expect(accuracySummary(months, "recorded")).toEqual({ count: 0, meanError: null, bias: null, hits: 0 });
    const recorded = months.map((m, i) => ({ ...m, recorded_net: i === 9 ? 27_000 : null }));
    expect(accuracySummary(recorded, "recorded")).toMatchObject({ count: 1, hits: 0 });
    expect(accuracySummary(recorded, "recorded").bias).toBeCloseTo((27_000 - 30_526.25) / 30_526.25, 6);
    expect(deviation(110, 100)).toBeCloseTo(0.1, 6);
    expect(deviation(5, 0)).toBeNull();
  });
});
