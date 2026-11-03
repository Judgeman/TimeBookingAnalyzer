import { Fragment, useState } from "react";
import type { PeriodData } from "../../types/results";
import { TABLE_METRICS, formatMetric, metricTitle, metricTone } from "./metrics";
import { styles } from "./styles";

export interface PeriodRow {
  key: string;
  label: string;
  /** Zusatz, z. B. Datumsbereich. */
  detail?: string;
  data: PeriodData;
  /** Hervorgehobene Buchungen in diesem Zeitraum (Tooltip-Zeilen). */
  flags?: string[];
  /** Fehlende Buchungen in diesem Zeitraum (Tooltip-Zeilen). */
  missing?: string[];
  /** Buchungen aufs Projekt außerhalb des Teams (Tooltip-Zeilen). */
  outside?: string[];
  /** Person in diesem Zeitraum nicht im Projekt (Einsatzzeitraum). */
  inactive?: boolean;
  /** Aufklappbare Unterzeilen (z. B. Kalenderwochen eines Monats). */
  children?: PeriodRow[];
}

interface Props {
  rows: PeriodRow[];
  total: PeriodData;
  totalLabel: string;
  periodLabel: string;
}

/** Zeitraum als Zeile, Kennzahlen als Spalten; optional aufklappbar. */
export function PeriodTable({ rows, total, totalLabel, periodLabel }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const expandable = rows.some((r) => r.children?.length);

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className={styles.tableWrap}>
      <table className="w-full text-sm">
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>
              {expandable && (
                <button
                  type="button"
                  onClick={() =>
                    setOpen(open.size ? new Set() : new Set(rows.map((r) => r.key)))
                  }
                  className="mr-2 text-slate-400 hover:text-slate-700"
                  title={open.size ? "Alle zuklappen" : "Alle aufklappen"}
                >
                  {open.size ? "▾" : "▸"}
                </button>
              )}
              {periodLabel}
            </th>
            {TABLE_METRICS.map((m) => (
              <th key={m.key} className={styles.thNum} title={`${m.label}: ${m.help}`}>
                <span className="cursor-help">{m.short}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => {
            const isOpen = open.has(row.key);
            const hasChildren = Boolean(row.children?.length);
            return (
              <Fragment key={row.key}>
                <tr
                  className={`${hasChildren ? "cursor-pointer hover:bg-slate-50" : ""} ${
                    row.inactive ? "bg-slate-50 text-slate-400" : ""
                  }`}
                  onClick={hasChildren ? () => toggle(row.key) : undefined}
                >
                  <td className={styles.td}>
                    {expandable && (
                      <span className="mr-2 inline-block w-3 text-slate-400">
                        {hasChildren ? (isOpen ? "▾" : "▸") : ""}
                      </span>
                    )}
                    <span className="font-medium">{row.label}</span>
                    {row.detail && <span className="ml-2 text-xs text-slate-500">{row.detail}</span>}
                    {row.inactive && (
                      <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">
                        nicht im Projekt
                      </span>
                    )}
                    <FlagMarker flags={row.flags} />
                    <MissingMarker missing={row.missing} />
                    <OutsideMarker outside={row.outside} />
                  </td>
                  <MetricCells data={row.data} />
                </tr>
                {isOpen &&
                  row.children?.map((child) => (
                    <tr key={`${row.key}/${child.key}`} className="bg-slate-50/60 text-slate-600">
                      <td className={`${styles.td} pl-10`}>
                        {child.label}
                        {child.detail && (
                          <span className="ml-2 text-xs text-slate-500">{child.detail}</span>
                        )}
                        <FlagMarker flags={child.flags} />
                        <MissingMarker missing={child.missing} />
                        <OutsideMarker outside={child.outside} />
                      </td>
                      <MetricCells data={child.data} />
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-medium">
          <tr>
            <td className={styles.td}>{totalLabel}</td>
            <MetricCells data={total} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function FlagMarker({ flags }: { flags?: string[] }) {
  if (!flags?.length) return null;
  return (
    <span
      className="ml-2 cursor-help rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800"
      title={flags.join("\n")}
    >
      ⚑ {flags.length}
    </span>
  );
}

function MissingMarker({ missing }: { missing?: string[] }) {
  if (!missing?.length) return null;
  return (
    <span
      className="ml-2 cursor-help rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800"
      title={missing.join("\n")}
    >
      ! {missing.length} fehlende Buchung{missing.length === 1 ? "" : "en"}
    </span>
  );
}

function OutsideMarker({ outside }: { outside?: string[] }) {
  if (!outside?.length) return null;
  return (
    <span
      className="ml-2 cursor-help rounded bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white"
      title={outside.join("\n")}
    >
      ⚠ {outside.length} außerhalb des Teams
    </span>
  );
}

function MetricCells({ data }: { data: PeriodData }) {
  return (
    <>
      {TABLE_METRICS.map((m) => (
        <td
          key={m.key}
          className={`${styles.tdNum} ${metricTone(m, data[m.key])}`}
          title={metricTitle(m, data)}
        >
          {formatMetric(m, data[m.key])}
        </td>
      ))}
    </>
  );
}
