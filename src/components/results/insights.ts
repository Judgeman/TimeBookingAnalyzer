import type { AuswertungResult, BudgetStatus, PeriodData } from "../../types/results";
import { activeBudgetIndex, dataEndOf, monthEnd } from "./forecast";

/**
 * Schwellen der automatischen Hinweise – bewusst einfach und sichtbar, damit
 * nachvollziehbar ist, warum ein Hinweis erscheint.
 */
export const THRESHOLDS = {
  /** Abruf über 105 % bzw. unter 90 % des Richtwerts. */
  paceHigh: 1.05,
  paceLow: 0.9,
  /** Abrechnungsquote der letzten 3 Monate mindestens 10 Prozentpunkte unter dem Jahr. */
  utilizationDrop: 0.1,
  /** Überstundensaldo über +40 h bzw. unter −20 h. */
  overtimeHigh: 40,
  overtimeLow: -20,
  /** Krankenquote über 5 %. */
  sickRate: 0.05,
  /** Nicht abrechenbarer Anteil (Ablenkung) über 15 %. */
  distraction: 0.15,
};

/** Zahl der Monate für „zuletzt“. */
export const RECENT_MONTHS = 3;

/** Abgeschlossene Monate des Jahres (Monatsende ≤ Stand der Daten), aufsteigend. */
export function completedMonths(result: AuswertungResult): string[] {
  const dataEnd = dataEndOf(result.forecast);
  return Object.keys(result.team.by_month)
    .filter((m) => monthEnd(m) <= dataEnd)
    .sort();
}

export interface Extreme {
  month: string;
  value: number;
  /** Beiträge der Personen in diesem Monat (absteigend, ohne 0). */
  persons: { name: string; value: number }[];
}

type Metric = (d: PeriodData) => number;

/** Monat mit dem größten (bzw. kleinsten) Teamwert; `null`, wenn keiner ≠ 0. */
export function extremeMonth(
  result: AuswertungResult,
  metric: Metric,
  pick: "max" | "min" = "max",
): Extreme | null {
  const sign = pick === "max" ? 1 : -1;
  let best: { month: string; value: number } | null = null;
  for (const month of completedMonths(result)) {
    const value = metric(result.team.by_month[month]);
    if (sign * value > 0.005 && (!best || sign * value > sign * best.value)) best = { month, value };
  }
  if (!best) return null;
  const persons = result.persons
    .map((p) => ({ name: p.name, value: p.by_month[best.month] ? metric(p.by_month[best.month]) : 0 }))
    .filter((p) => Math.abs(p.value) > 0.005)
    .sort((a, b) => sign * (b.value - a.value));
  return { ...best, persons };
}

export interface BudgetMonth {
  month: string;
  actual: number;
  target: number;
  /** Abgerechnet − Richtwert (positiv = mehr abgerufen, negativ = liegen gelassen). */
  diff: number;
}

/** Abgeschlossene Monate des Budget-Zeitraums mit Abweichung zum Richtwert. */
export function budgetMonths(result: AuswertungResult, budget: BudgetStatus): BudgetMonth[] {
  const dataEnd = dataEndOf(result.forecast);
  return result.forecast.months
    .filter((m) => m.month >= budget.from && m.month <= budget.to && monthEnd(m.month) <= dataEnd)
    .map((m) => ({
      month: m.month,
      actual: m.actual_net,
      target: budget.monthly_target,
      diff: m.actual_net - budget.monthly_target,
    }));
}

export interface TeamPace {
  budget: BudgetStatus;
  months: BudgetMonth[];
  /** Ø Abruf je abgeschlossenem Monat und Verhältnis zum Richtwert. */
  average: number | null;
  ratio: number | null;
  /** Dasselbe für die letzten (bis zu) 3 abgeschlossenen Monate. */
  recentAverage: number | null;
  recentRatio: number | null;
  /** Monate des Zeitraums, die noch nicht abgeschlossen sind. */
  remainingMonths: number;
  /** Je Restmonat nötig, um genau im Budget zu landen (0, wenn schon aufgebraucht). */
  neededPerMonth: number | null;
  /** Je Restmonat laut Prognose (inkl. bereits Abgerechnetem im laufenden Monat). */
  forecastPerMonth: number | null;
  /** Monat mit dem meisten liegen gelassenen bzw. abgerufenen Budget. */
  mostLeft: BudgetMonth | null;
  mostUsed: BudgetMonth | null;
}

const average = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** Tempo des Teams gegenüber dem Richtwert des aktiven Budgets. */
export function teamPace(result: AuswertungResult): TeamPace | null {
  const budget = result.forecast.budgets[activeBudgetIndex(result.forecast)];
  if (!budget) return null;
  const months = budgetMonths(result, budget);
  const recent = months.slice(-RECENT_MONTHS);
  const avg = average(months.map((m) => m.actual));
  const recentAvg = average(recent.map((m) => m.actual));
  const ratio = (v: number | null) => (v === null || budget.monthly_target <= 0 ? null : v / budget.monthly_target);
  const remainingMonths = budget.month_count - months.length;
  const completedActual = months.reduce((sum, m) => sum + m.actual, 0);
  const below = months.filter((m) => m.diff < -0.005);
  const above = months.filter((m) => m.diff > 0.005);
  return {
    budget,
    months,
    average: avg,
    ratio: ratio(avg),
    recentAverage: recentAvg,
    recentRatio: ratio(recentAvg),
    remainingMonths,
    neededPerMonth:
      remainingMonths > 0 ? Math.max(budget.amount - budget.actual_net, 0) / remainingMonths : null,
    forecastPerMonth:
      remainingMonths > 0 ? (budget.expected_net - completedActual) / remainingMonths : null,
    mostLeft: below.length ? below.reduce((a, b) => (b.diff < a.diff ? b : a)) : null,
    mostUsed: above.length ? above.reduce((a, b) => (b.diff > a.diff ? b : a)) : null,
  };
}

export interface PersonPace {
  name: string;
  /** Abgeschlossene Monate mit Soll (im Einsatz). */
  activeMonths: number;
  /** Abrechenbare Stunden ÷ Soll netto (Jahr bzw. letzte 3 Monate im Einsatz). */
  utilization: number | null;
  recentUtilization: number | null;
  /** Ø abgerechnet (€) je Monat im Einsatz. */
  averageInvoiced: number | null;
  /** Abgerechnet (€) je gearbeiteter Stunde. */
  effectiveRate: number | null;
  /** Überstundensaldo (Plus) gesamt und in den letzten 3 Monaten. */
  overtime: number;
  recentOvertime: number;
  /** Krank ÷ Soll brutto. */
  sickRate: number | null;
  vacationDays: number;
  missingDays: number;
  /** Nicht abrechenbarer Anteil laut Prognose (Ablenkungsfaktor). */
  distraction: number | null;
}

const sum = (months: PeriodData[], metric: Metric) => months.reduce((a, m) => a + metric(m), 0);
const share = (a: number, b: number) => (b > 0 ? a / b : null);

/** Tempo und Kennzahlen je Teammitglied (nur abgeschlossene Monate). */
export function personPace(result: AuswertungResult): PersonPace[] {
  const months = completedMonths(result);
  return result.persons.map((person) => {
    const active = months.map((m) => person.by_month[m]).filter((d): d is PeriodData => !!d && d.soll_b > 0);
    const recent = active.slice(-RECENT_MONTHS);
    const forecast = result.forecast.persons.find((p) => p.name === person.name);
    return {
      name: person.name,
      activeMonths: active.length,
      utilization: share(sum(active, (d) => d.bill_h), sum(active, (d) => d.soll_n)),
      recentUtilization: share(sum(recent, (d) => d.bill_h), sum(recent, (d) => d.soll_n)),
      averageInvoiced: active.length ? sum(active, (d) => d.bill_eur) / active.length : null,
      effectiveRate: share(sum(active, (d) => d.bill_eur), sum(active, (d) => d.gearb)),
      overtime: sum(active, (d) => d.plus),
      recentOvertime: sum(recent, (d) => d.plus),
      sickRate: share(sum(active, (d) => d.sick_h), sum(active, (d) => d.soll_b)),
      vacationDays: sum(active, (d) => d.vac_days),
      missingDays: sum(active, (d) => d.missing_days),
      distraction: forecast && forecast.reference.worked_hours > 0 ? forecast.distraction_factor : null,
    };
  });
}

export interface Insight {
  level: "warning" | "info";
  text: string;
}

const pct = (v: number) =>
  `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(v * 100)} %`;
const hours = (v: number) =>
  `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, signDisplay: "always" }).format(v)} h`;
const euro = (v: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

/** Automatische Hinweise aus Budget-Tempo und Kennzahlen je Person. */
export function insights(pace: TeamPace | null, persons: PersonPace[]): Insight[] {
  const list: Insight[] = [];
  if (pace?.ratio != null) {
    if (pace.ratio > THRESHOLDS.paceHigh) {
      list.push({
        level: "warning",
        text: `Das Team ruft ${pct(pace.ratio)} des Richtwerts ab${
          pace.budget.deviation > 0 ? ` – bei diesem Tempo wird das Budget um ${euro(pace.budget.deviation)} überzogen` : ""
        }.`,
      });
    } else if (pace.ratio < THRESHOLDS.paceLow) {
      list.push({
        level: "info",
        text: `Das Team ruft nur ${pct(pace.ratio)} des Richtwerts ab${
          pace.budget.deviation < 0 ? ` – voraussichtlich bleiben ${euro(-pace.budget.deviation)} liegen` : ""
        }.`,
      });
    }
  }
  for (const p of persons) {
    if (p.utilization !== null && p.recentUtilization !== null && p.activeMonths > RECENT_MONTHS &&
        p.utilization - p.recentUtilization >= THRESHOLDS.utilizationDrop) {
      list.push({
        level: "warning",
        text: `${p.name}: Abrechnungsquote gesunken (Jahr ${pct(p.utilization)}, zuletzt ${pct(p.recentUtilization)}).`,
      });
    }
    if (p.overtime > THRESHOLDS.overtimeHigh) {
      list.push({ level: "warning", text: `${p.name}: ${hours(p.overtime)} Überstunden – Abbau einplanen.` });
    } else if (p.overtime < THRESHOLDS.overtimeLow) {
      list.push({ level: "warning", text: `${p.name}: ${hours(p.overtime)} unter Soll.` });
    }
    if (p.sickRate !== null && p.sickRate > THRESHOLDS.sickRate) {
      list.push({ level: "info", text: `${p.name}: Krankenquote ${pct(p.sickRate)}.` });
    }
    if (p.distraction !== null && p.distraction > THRESHOLDS.distraction) {
      list.push({
        level: "info",
        text: `${p.name}: ${pct(p.distraction)} der Arbeitszeit nicht abrechenbar.`,
      });
    }
    if (p.missingDays > 0) {
      list.push({
        level: "info",
        text: `${p.name}: ${p.missingDays} Tag(e) mit fehlender Buchung – nachbuchen lassen.`,
      });
    }
  }
  return list;
}
