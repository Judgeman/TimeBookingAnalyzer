import type {
  AuswertungResult,
  BudgetStatus,
  MissingBooking,
  PeriodData,
  VacationStatus,
} from "../../types/results";
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
  /** Mindestens 5 offene Urlaubstage in den letzten 3 Monaten des Jahres. */
  vacationOpenDays: 5,
  vacationMonthsLeft: 3,
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
  return selectedBudgetMonths(result, { kind: "range", from: budget.from, to: budget.to });
}

/** Auswahl für „Abruf je Monat“: ein Budget, alle Budgets oder ein eigener Zeitraum. */
export type BudgetSelection =
  | { kind: "budget"; index: number }
  | { kind: "all" }
  | { kind: "range"; from: string; to: string };

/**
 * Abgeschlossene Monate der Auswahl, jeweils mit dem Richtwert des Budgets, zu
 * dem der Monat gehört (Budget-Zeiträume überschneiden sich nicht). Monate ohne
 * Budget haben keinen Richtwert und fehlen.
 */
export function selectedBudgetMonths(result: AuswertungResult, selection: BudgetSelection): BudgetMonth[] {
  const dataEnd = dataEndOf(result.forecast);
  const { budgets } = result.forecast;
  const only = selection.kind === "budget" ? budgets[selection.index] : undefined;
  return result.forecast.months.flatMap((m) => {
    if (monthEnd(m.month) > dataEnd) return [];
    if (selection.kind === "range" && (m.month < selection.from || m.month > selection.to)) return [];
    const budget = budgets.find((b) => b.from <= m.month && m.month <= b.to);
    if (!budget || (only && budget !== only)) return [];
    const target = budget.monthly_target;
    return [{ month: m.month, actual: m.actual_net, target, diff: m.actual_net - target }];
  });
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
  /** Saldo, wenn Krankheit als Fehlzeit zählt (Plus − Krank), gesamt und zuletzt. */
  overtimeSick: number;
  recentOvertimeSick: number;
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
      overtimeSick: sum(active, (d) => d.plus_krank),
      recentOvertimeSick: sum(recent, (d) => d.plus_krank),
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
    } else if (p.overtimeSick < THRESHOLDS.overtimeLow) {
      list.push({
        level: "info",
        text: `${p.name}: ${hours(p.overtimeSick)} unter Soll, wenn Krankheit als Fehlzeit zählt.`,
      });
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

export interface PersonMissing {
  name: string;
  /** Tage mit fehlender Buchung (neueste zuerst). */
  dates: string[];
  /** Fehlende Stunden: Σ (Soll − gebucht). */
  hours: number;
}

/** Fehlende Buchungen bis zum Vortag des Exports je Person – meiste zuerst. */
export function currentMissing(bookings: MissingBooking[]): PersonMissing[] {
  const byPerson = new Map<string, PersonMissing>();
  for (const b of bookings) {
    const entry = byPerson.get(b.person) ?? { name: b.person, dates: [], hours: 0 };
    entry.dates.push(b.date);
    entry.hours += b.expected_hours - b.booked_hours;
    byPerson.set(b.person, entry);
  }
  return [...byPerson.values()]
    .map((p) => ({ ...p, dates: [...p.dates].sort().reverse() }))
    .sort((a, b) => b.dates.length - a.dates.length || b.hours - a.hours || a.name.localeCompare(b.name));
}

const days = (v: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(v);

/** Hinweise zum Resturlaub: überzogen bzw. viel offen kurz vor Jahresende. */
export function vacationInsights(vacation: VacationStatus[], dataEnd: string): Insight[] {
  const monthsLeft = 12 - Number(dataEnd.slice(5, 7));
  const list: Insight[] = [];
  for (const v of vacation) {
    if (v.remaining < 0) {
      list.push({
        level: "warning",
        text: `${v.person}: ${days(-v.remaining)} Urlaubstage mehr genommen bzw. geplant als Anspruch ${v.year}.`,
      });
    } else if (
      Number(dataEnd.slice(0, 4)) === v.year &&
      monthsLeft <= THRESHOLDS.vacationMonthsLeft &&
      v.remaining >= THRESHOLDS.vacationOpenDays
    ) {
      list.push({
        level: "warning",
        text: `${v.person}: noch ${days(v.remaining)} Urlaubstage offen und nicht eingeplant – bis 31.12.${v.year} einplanen.`,
      });
    }
  }
  return list;
}
