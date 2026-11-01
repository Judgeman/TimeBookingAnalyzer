import { useState } from "react";
import type { AuswertungResult, PeriodBreakdown } from "../../types/results";
import {
  clampRange,
  formatDate,
  formatMonth,
  formatRange,
  formatWeek,
  isoWeekRange,
  monthRange,
} from "../../lib/format";
import { ExportSummary } from "../ExportSummary";
import { InvoiceView } from "./InvoiceView";
import { PeriodTable, type PeriodRow } from "./PeriodTable";
import { YearView } from "./YearView";

type Tab = "year" | "months" | "weeks" | "invoice" | "import";

const TABS: [Tab, string][] = [
  ["year", "Jahr"],
  ["months", "Monate"],
  ["weeks", "Wochen"],
  ["invoice", "Rechnung"],
  ["import", "Import"],
];

interface Props {
  result: AuswertungResult;
  elementFilter: string;
  busy: boolean;
  onCutoffChange: (cutoff: string | null) => void;
}

const TEAM = -1;

export function ResultsView({ result, elementFilter, busy, onCutoffChange }: Props) {
  const [tab, setTab] = useState<Tab>("year");
  const [personIndex, setPersonIndex] = useState(0);

  const period: [string, string] = [result.period_start, result.cutoff_date];
  const selectedIndex = personIndex < result.persons.length ? personIndex : TEAM;
  const selected: PeriodBreakdown =
    selectedIndex === TEAM ? result.team : result.persons[selectedIndex];

  const monthRows: PeriodRow[] = Object.entries(selected.by_month).map(([month, data]) => {
    const range = clampRange(monthRange(month), period);
    const weeks = selected.month_weeks[month] ?? {};
    return {
      key: month,
      label: formatMonth(month),
      detail: range[1] < monthRange(month)[1] ? `bis ${formatDate(range[1])}` : undefined,
      data,
      children: Object.entries(weeks).map(([week, weekData]) => ({
        key: week,
        label: formatWeek(week),
        detail: formatRange(...clampRange(isoWeekRange(week), range)),
        data: weekData,
      })),
    };
  });

  const weekRows: PeriodRow[] = Object.entries(selected.by_week).map(([week, data]) => ({
    key: week,
    label: formatWeek(week),
    detail: formatRange(...clampRange(isoWeekRange(week), period)),
    data,
  }));

  const sourceLabel =
    result.export_date_source === "file_name"
      ? "aus Dateiname"
      : result.export_date_source === "modified"
        ? "Änderungsdatum der Datei"
        : "letzte Buchung";

  return (
    <div className={`space-y-5 transition-opacity ${busy ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">
            Auswertung {formatDate(result.period_start)} – {formatDate(result.cutoff_date)}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Stand des Exports: {formatDate(result.export_date)} ({sourceLabel}) · Feiertage{" "}
            {result.holiday_region}: <HolidayList result={result} />
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium text-slate-700">Stichtag</span>
          <input
            type="date"
            value={result.cutoff_date}
            onChange={(e) => e.target.value && onCutoffChange(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          {result.cutoff_date !== result.default_cutoff_date && (
            <button
              type="button"
              onClick={() => onCutoffChange(null)}
              className="text-sm text-slate-500 underline hover:text-slate-800"
            >
              zurücksetzen
            </button>
          )}
        </label>
      </div>

      {result.warnings.length > 0 && (
        <ul className="space-y-1 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {result.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <nav className="flex gap-1" role="tablist">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                tab === key
                  ? "border-slate-800 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {(tab === "months" || tab === "weeks") && (
          <div className="flex flex-wrap gap-1 pb-2" role="group" aria-label="Person">
            {result.persons.map((p, i) => (
              <PersonPill
                key={p.name}
                label={p.name}
                active={selectedIndex === i}
                onClick={() => setPersonIndex(i)}
              />
            ))}
            <PersonPill
              label="Team gesamt"
              active={selectedIndex === TEAM}
              onClick={() => setPersonIndex(TEAM)}
            />
          </div>
        )}
      </div>

      {result.persons.length === 0 && tab !== "import" ? (
        <p className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-600">
          Im Projekt ist kein Team hinterlegt. Personen und Stundensätze unter „Projekt
          bearbeiten“ ergänzen.
        </p>
      ) : (
        <>
          {tab === "year" && (
            <YearView
              columns={[
                ...result.persons.map((p) => ({ name: p.name, data: p.ytd })),
                { name: "Team gesamt", data: result.team.ytd },
              ]}
            />
          )}
          {tab === "months" && (
            <PeriodTable
              rows={monthRows}
              total={selected.ytd}
              totalLabel="Jahr bis Stichtag"
              periodLabel="Monat"
            />
          )}
          {tab === "weeks" && (
            <PeriodTable
              rows={weekRows}
              total={selected.ytd}
              totalLabel="Jahr bis Stichtag"
              periodLabel="Kalenderwoche"
            />
          )}
          {tab === "invoice" && (
            <InvoiceView
              invoice={result.invoice}
              persons={result.persons.map((p) => p.name)}
              cutoffDate={result.cutoff_date}
            />
          )}
        </>
      )}
      {tab === "import" && <ExportSummary result={result.overview} elementFilter={elementFilter} />}
    </div>
  );
}

function PersonPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        active ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function HolidayList({ result }: { result: AuswertungResult }) {
  const inPeriod = result.holidays.filter(
    (h) => h.date >= result.period_start && h.date <= result.cutoff_date,
  );
  return (
    <span
      className="cursor-help border-b border-dotted border-slate-400"
      title={result.holidays.map((h) => `${formatDate(h.date)} ${h.name}`).join("\n")}
    >
      {inPeriod.length} im Zeitraum
    </span>
  );
}
