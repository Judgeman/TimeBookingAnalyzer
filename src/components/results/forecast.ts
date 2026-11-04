import type { AccuracyMonth, BudgetStatus, Forecast, ForecastMonth } from "../../types/results";

/** Letzter Tag mit Daten = Tag vor dem ersten Prognosetag (ISO). */
export function dataEndOf(forecast: Forecast): string {
  const d = new Date(`${forecast.from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Letzter Tag eines Monats ("2026-02" → "2026-02-28"). */
export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Budget, um das es gerade geht: das mit dem ersten Prognosetag, sonst das
 * zuletzt begonnene, sonst das erste.
 */
export function activeBudgetIndex(forecast: Forecast): number {
  const current = forecast.from.slice(0, 7);
  const containing = forecast.budgets.findIndex((b) => b.from <= current && current <= b.to);
  if (containing >= 0) return containing;
  let latest = -1;
  forecast.budgets.forEach((b, i) => {
    if (b.from <= current && (latest < 0 || b.from > forecast.budgets[latest].from)) latest = i;
  });
  return latest >= 0 ? latest : 0;
}

/** Monat, in dem die Prognose beginnt (laufender Monat). */
export function currentMonth(forecast: Forecast): ForecastMonth | undefined {
  return forecast.months.find((m) => m.month === forecast.from.slice(0, 7));
}

/** Ein Punkt der kumulierten Kurven (Werte in € netto). */
export interface ChartPoint {
  /** ISO-Datum der Position auf der x-Achse. */
  date: string;
  /** Monat, wenn der Punkt ein Monatsende ist. */
  month: string | null;
  /** Abgerechnet bis hierher (nur bis zum Stand der Daten). */
  actual: number | null;
  /** Ist + Prognose bis hierher (ab dem Stand der Daten). */
  forecast: number | null;
  /** Richtwert kumuliert (nur mit Budget). */
  target: number | null;
}

/**
 * Kumulierte Kurven über die Monate `from`…`to`: Start (0), je Monatsende und –
 * wenn er mitten im Monat liegt – der Stand der Daten als Übergang Ist → Prognose.
 */
export function cumulativeSeries(
  forecast: Forecast,
  from: string,
  to: string,
  monthlyTarget: number | null,
): ChartPoint[] {
  const dataEnd = dataEndOf(forecast);
  const months = forecast.months.filter((m) => m.month >= from && m.month <= to);
  const start = `${from}-01`;
  const hasActual = start <= dataEnd;
  const points: ChartPoint[] = [
    {
      date: start,
      month: null,
      actual: hasActual ? 0 : null,
      forecast: hasActual ? null : 0,
      target: monthlyTarget === null ? null : 0,
    },
  ];
  let actual = 0;
  let total = 0;
  let target = 0;
  for (const m of months) {
    const end = monthEnd(m.month);
    actual += m.actual_net;
    total += m.actual_net + m.forecast_net;
    target += monthlyTarget ?? 0;
    if (dataEnd >= `${m.month}-01` && dataEnd < end) {
      // Übergang mitten im Monat: Ist bis zum Stand, dort beginnt die Prognose
      points.push({ date: dataEnd, month: null, actual, forecast: actual, target: null });
    }
    points.push({
      date: end,
      month: m.month,
      actual: end <= dataEnd ? actual : null,
      forecast: end >= dataEnd && end > start ? total : null,
      target: monthlyTarget === null ? null : target,
    });
  }
  return points;
}

/** Text zum Stand des Budgets (Status + Kurzbeschreibung). */
export function budgetVerdict(budget: BudgetStatus): { over: boolean; text: string } {
  if (budget.exceeded) return { over: true, text: "Budget bereits überschritten" };
  if (budget.deviation > 0) return { over: true, text: "Voraussichtliche Überziehung" };
  return { over: false, text: "Budget reicht voraussichtlich" };
}

/** Treffer: Prognose höchstens 10 % neben dem Ist. */
export const ACCURACY_HIT = 0.1;

export interface AccuracySummary {
  /** Monate mit Vergleich (Ist > 0). */
  count: number;
  /** Ø absolute Abweichung (MAPE), 0…1. */
  meanError: number | null;
  /** Tendenz: Σ(Prognose − Ist) ÷ Σ Ist (positiv = zu hoch). */
  bias: number | null;
  /** Monate innerhalb ±10 %. */
  hits: number;
}

/** Relative Abweichung Prognose ↔ Ist (`null` ohne Ist). */
export function deviation(predicted: number, actual: number): number | null {
  return actual > 0 ? (predicted - actual) / actual : null;
}

/** Kennzahlen der Prognosegüte – nachgerechnet oder gespeichert. */
export function accuracySummary(months: AccuracyMonth[], source: "backtest" | "recorded"): AccuracySummary {
  const pairs = months
    .map((m) => ({ predicted: source === "backtest" ? m.backtest_net : m.recorded_net, actual: m.actual_net }))
    .filter((p): p is { predicted: number; actual: number } => p.predicted !== null && p.actual > 0);
  if (pairs.length === 0) return { count: 0, meanError: null, bias: null, hits: 0 };
  const errors = pairs.map((p) => Math.abs(p.predicted - p.actual) / p.actual);
  const actualSum = pairs.reduce((s, p) => s + p.actual, 0);
  return {
    count: pairs.length,
    meanError: errors.reduce((a, b) => a + b, 0) / errors.length,
    bias: pairs.reduce((s, p) => s + p.predicted - p.actual, 0) / actualSum,
    hits: errors.filter((e) => e <= ACCURACY_HIT + 1e-9).length,
  };
}
