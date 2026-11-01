import type { PeriodData } from "../../types/results";
import { formatEuro, formatHours, formatNumber, formatSignedHours } from "../../lib/format";

export type MetricKey = keyof PeriodData;

export interface Metric {
  key: MetricKey;
  label: string;
  /** Kurzform für Tabellenköpfe. */
  short: string;
  /** Berechnungsregel (Tooltip). */
  help: string;
  kind: "hours" | "days" | "euro" | "signed";
}

/** Alle Kennzahlen in Anzeige-Reihenfolge (Regeln siehe CLAUDE.md). */
export const METRICS: Metric[] = [
  { key: "soll_b", label: "Soll brutto", short: "Soll br.", kind: "hours",
    help: "Werktage (Mo–Fr ohne Feiertage) × vertragliche h/Tag" },
  { key: "vac_days", label: "Urlaub (Tage)", short: "Urlaub T", kind: "days",
    help: "Personio-Stunden ÷ 8 (nur Werktage)" },
  { key: "vac_h", label: "Urlaub (h)", short: "Urlaub h", kind: "hours",
    help: "Urlaubstage × vertragliche h/Tag" },
  { key: "sick_days", label: "Krank (Tage)", short: "Krank T", kind: "days",
    help: "Personio-Stunden ÷ 8 (nur Werktage)" },
  { key: "sick_h", label: "Krank (h)", short: "Krank h", kind: "hours",
    help: "Krankheitstage × vertragliche h/Tag" },
  { key: "soll_n", label: "Soll netto", short: "Soll n.", kind: "hours",
    help: "Soll brutto − Urlaub (h) − Krank (h)" },
  { key: "gearb", label: "Gearbeitet", short: "Gearb.", kind: "hours",
    help: "Σ Stunden × Mult (nur Mult > 0), ohne Urlaub/Krank, inkl. Wochenende, alle Elemente" },
  { key: "bill_h", label: "Billable (h)", short: "Bill. h", kind: "hours",
    help: "Projekt-Element + „Delivery (billable)“ (ohne Mult)" },
  { key: "nonbill_h", label: "Nicht billable (h)", short: "N.-bill. h", kind: "hours",
    help: "Übrige gearbeitete Stunden (Mult > 0): Travel, Sales, andere Elemente …" },
  { key: "bill_eur", label: "Billable (€)", short: "Bill. €", kind: "euro",
    help: "Projekt-Element + alle „(billable)“ (inkl. Travel) × Stundensatz am Buchungstag" },
  { key: "plus", label: "Plus/Minus", short: "Plus", kind: "signed",
    help: "Gearbeitet − Soll netto" },
  { key: "plus_krank", label: "Plus/Minus (Krank = Fehlzeit)", short: "Plus (Kr.)", kind: "signed",
    help: "Plus − Krank (h): Krankheit wird nicht gutgeschrieben" },
];

/** Kompakte Auswahl für Monats-/Wochentabellen (Tage stehen im Tooltip). */
export const TABLE_METRICS: Metric[] = METRICS.filter(
  (m) => m.key !== "vac_days" && m.key !== "sick_days",
);

export function formatMetric(metric: Metric, value: number): string {
  switch (metric.kind) {
    case "euro":
      return formatEuro(value);
    case "days":
      return formatNumber(value);
    case "signed":
      return formatSignedHours(value);
    default:
      return formatHours(value);
  }
}

export function metricTone(metric: Metric, value: number): string {
  if (metric.kind !== "signed" || value === 0) return "";
  return value > 0 ? "text-emerald-700" : "text-red-700";
}

/** Tooltip für Urlaub/Krank in Stunden-Spalten: zeigt zusätzlich die Tage. */
export function metricTitle(metric: Metric, data: PeriodData): string | undefined {
  if (metric.key === "vac_h") return `${formatNumber(data.vac_days)} Tag(e)`;
  if (metric.key === "sick_h") return `${formatNumber(data.sick_days)} Tag(e)`;
  return undefined;
}
