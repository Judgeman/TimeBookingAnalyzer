import { useState } from "react";
import type { PlannedAbsence } from "../../types/config";
import type {
  AuswertungResult,
  FlaggedBooking,
  MissingBooking,
  OutsideBooking,
  PeriodBreakdown,
} from "../../types/results";
import { describeAssignments, overlapsAssignments } from "../../lib/assignments";
import {
  clampRange,
  endOfPreviousMonth,
  endOfPreviousWeek,
  formatDate,
  formatDateWithWeekday,
  formatHours,
  formatMonth,
  formatNumber,
  formatRange,
  formatWeek,
  isoWeekKey,
  isoWeekRange,
  monthRange,
  previousDay,
  todayIso,
} from "../../lib/format";
import { ExportSummary } from "../ExportSummary";
import { AccountView } from "./AccountView";
import { BillableMismatches } from "./BillableMismatches";
import { colorMapFor } from "./chartColors";
import { ForecastView } from "./ForecastView";
import { GuestBookings } from "./GuestBookings";
import { InsightsView } from "./InsightsView";
import { InvoiceView } from "./InvoiceView";
import { LocationView } from "./LocationView";
import { OutsideBookings } from "./OutsideBookings";
import { PeriodTable, type PeriodRow } from "./PeriodTable";
import { YearView } from "./YearView";

type Tab =
  | "year"
  | "months"
  | "weeks"
  | "account"
  | "locations"
  | "invoice"
  | "forecast"
  | "insights"
  | "import";

const TABS: [Tab, string][] = [
  ["year", "Jahr"],
  ["months", "Monate"],
  ["weeks", "Wochen"],
  ["account", "Stundenkonto"],
  ["locations", "Arbeitsort"],
  ["invoice", "Rechnung"],
  ["forecast", "Prognose"],
  ["insights", "Insights"],
  ["import", "Import"],
];

/** Tabs mit Personenauswahl. */
const PERSON_TABS: Tab[] = ["months", "weeks", "account", "locations"];

interface Props {
  result: AuswertungResult;
  elementFilter: string;
  busy: boolean;
  onCutoffChange: (cutoff: string) => void;
  /** Geplante Abwesenheiten aus der Projektkonfiguration (Tab „Prognose“). */
  plannedAbsences?: PlannedAbsence[];
}

const TEAM = -1;

export function ResultsView({
  result,
  elementFilter,
  busy,
  onCutoffChange,
  plannedAbsences = [],
}: Props) {
  const [tab, setTab] = useState<Tab>("year");
  const [personIndex, setPersonIndex] = useState(0);

  const period: [string, string] = [result.period_start, result.cutoff_date];
  const selectedIndex = personIndex < result.persons.length ? personIndex : TEAM;
  const selected: PeriodBreakdown =
    selectedIndex === TEAM ? result.team : result.persons[selectedIndex];
  const selectedName = selectedIndex === TEAM ? "Das Team" : result.persons[selectedIndex].name;

  // Hervorgehobene Buchungen der Auswahl, nach Monat bzw. Kalenderwoche.
  const flags = result.flagged.filter(
    (f) => selectedIndex === TEAM || f.person === result.persons[selectedIndex]?.name,
  );
  const flagsWhere = (match: (f: FlaggedBooking) => boolean) =>
    flags.filter(match).map(describeFlag);
  const missing = result.missing.filter(
    (m) => selectedIndex === TEAM || m.person === result.persons[selectedIndex]?.name,
  );
  const missingWhere = (match: (m: MissingBooking) => boolean) =>
    missing.filter(match).map(describeMissing);
  // Buchungen außerhalb des Teams (Team: alle, auch Nicht-Teammitglieder).
  const outside = result.outside.filter(
    (o) => selectedIndex === TEAM || o.person === result.persons[selectedIndex]?.name,
  );
  const outsideWhere = (match: (o: OutsideBooking) => boolean) =>
    outside.filter(match).map(describeOutside);
  const assignments = selectedIndex === TEAM ? [] : result.persons[selectedIndex].assignments;

  const monthRows: PeriodRow[] = Object.entries(selected.by_month).map(([month, data]) => {
    const range = clampRange(monthRange(month), period);
    const weeks = selected.month_weeks[month] ?? {};
    return {
      key: month,
      label: formatMonth(month),
      detail: range[1] < monthRange(month)[1] ? `bis ${formatDate(range[1])}` : undefined,
      data,
      flags: flagsWhere((f) => f.date.startsWith(month)),
      missing: missingWhere((m) => m.date.startsWith(month)),
      outside: outsideWhere((o) => o.date.startsWith(month)),
      inactive: !overlapsAssignments(assignments, range),
      children: Object.entries(weeks).map(([week, weekData]) => ({
        key: week,
        label: formatWeek(week),
        detail: formatRange(...clampRange(isoWeekRange(week), range)),
        data: weekData,
        flags: flagsWhere((f) => f.date.startsWith(month) && isoWeekKey(f.date) === week),
        missing: missingWhere((m) => m.date.startsWith(month) && isoWeekKey(m.date) === week),
        outside: outsideWhere((o) => o.date.startsWith(month) && isoWeekKey(o.date) === week),
      })),
    };
  });

  const weekRows: PeriodRow[] = Object.entries(selected.by_week).map(([week, data]) => ({
    key: week,
    label: formatWeek(week),
    detail: formatRange(...clampRange(isoWeekRange(week), period)),
    data,
    flags: flagsWhere((f) => isoWeekKey(f.date) === week),
    missing: missingWhere((m) => isoWeekKey(m.date) === week),
    outside: outsideWhere((o) => isoWeekKey(o.date) === week),
    inactive: !overlapsAssignments(assignments, clampRange(isoWeekRange(week), period)),
  }));

  const sourceLabel =
    result.export_date_source === "file_name"
      ? "aus Dateiname"
      : result.export_date_source === "modified"
        ? "Änderungsdatum der Datei"
        : "letzte Buchung";

  const today = todayIso();
  // [Beschriftung, Datum, Erklärung]
  const quickCutoffs: [string, string, string][] = [
    ["Heute", today, ""],
    ["Gestern", previousDay(today), ""],
    ["Ende letzter Woche", endOfPreviousWeek(today), " (Sonntag)"],
    ["Ende Vormonat", endOfPreviousMonth(today), ""],
  ];

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
        <div className="flex flex-col items-end gap-1.5">
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium text-slate-700">Stichtag</span>
            <input
              type="date"
              value={result.cutoff_date}
              onChange={(e) => e.target.value && onCutoffChange(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <div className="flex gap-1">
            {quickCutoffs.map(([label, date, hint]) => (
              <button
                key={label}
                type="button"
                onClick={() => onCutoffChange(date)}
                title={formatDate(date) + hint}
                className={`rounded px-2 py-0.5 text-xs ${
                  result.cutoff_date === date
                    ? "bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {result.outside.length > 0 && (
        <OutsideBookings outside={result.outside} persons={result.persons} />
      )}

      {result.warnings.length > 0 && (
        <ul className="space-y-1 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {result.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {result.missing.length > 0 && (
        <MissingList
          missing={result.missing}
          checkedUntil={result.missing_checked_until}
          threshold={result.missing_threshold_percent}
        />
      )}

      {result.flagged.length > 0 && <FlaggedList flagged={result.flagged} />}

      {result.billable_mismatches.length > 0 && <BillableMismatches mismatches={result.billable_mismatches} />}

      {result.guest_bookings.length > 0 && (
        <GuestBookings bookings={result.guest_bookings} untracked={result.untracked} />
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
              {key === "invoice" && result.outside.length > 0 && (
                <span
                  className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white"
                  title="Buchungen außerhalb des Teams"
                >
                  ⚠ {result.outside.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {PERSON_TABS.includes(tab) && (
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
                ...result.persons.map((p) => ({
                  name: p.name,
                  data: p.ytd,
                  note: describeAssignments(p.assignments) ?? undefined,
                })),
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
          {tab === "account" && (
            <AccountView
              name={selectedName}
              data={selected}
              catchUp={result.catch_up}
              person={selectedIndex === TEAM ? null : result.persons[selectedIndex].name}
            />
          )}
          {tab === "locations" && (
            <LocationView
              name={selectedIndex === TEAM ? "Team" : selectedName}
              data={selected}
              colorMap={colorMapFor(result.team.locations.ytd.map((s) => s.location))}
              isTeam={selectedIndex === TEAM}
            />
          )}
          {tab === "invoice" && (
            <InvoiceView
              invoice={result.invoice}
              outside={result.outside}
              persons={[...result.persons.map((p) => p.name), ...result.untracked]}
              guests={result.guests}
              untracked={result.untracked}
              cutoffDate={result.cutoff_date}
            />
          )}
          {tab === "forecast" && (
            <ForecastView
              forecast={result.forecast}
              plannedAbsences={plannedAbsences}
              accuracy={result.forecast_accuracy}
            />
          )}
          {tab === "insights" && <InsightsView result={result} />}
        </>
      )}
      {tab === "import" && <ExportSummary result={result.overview} elementFilter={elementFilter} />}
    </div>
  );
}

const KIND_LABEL: Record<FlaggedBooking["kind"], string> = {
  vacation: "Urlaub",
  sick: "Krank",
};

function describeFlag(f: FlaggedBooking): string {
  return `${formatDateWithWeekday(f.date)} · ${f.person}: ${KIND_LABEL[f.kind]} ${formatHours(
    f.hours,
  )} h → ${formatNumber(f.credited_days)} Tag(e) (${f.reasons.join(", ")})`;
}

function describeOutside(o: OutsideBooking): string {
  const reason =
    o.reason === "outside_assignment" ? "außerhalb Einsatzzeitraum, abgerechnet" : "nicht im Team, nicht abgerechnet";
  return `${formatDateWithWeekday(o.date)} · ${o.person}: ${formatHours(o.hours)} h auf ${o.element} (${reason})`;
}

function missingReason(m: MissingBooking): string {
  return m.booked_hours === 0
    ? "keine Buchung"
    : `nur ${formatNumber(m.coverage_percent)} % gebucht`;
}

function describeMissing(m: MissingBooking): string {
  return `${formatDateWithWeekday(m.date)} · ${m.person}: fehlende Buchung – ${missingReason(m)} (${formatHours(
    m.booked_hours,
  )} von ${formatHours(m.expected_hours)} h)`;
}

/** Werktage mit fehlender oder zu geringer Buchung. */
function MissingList({
  missing,
  checkedUntil,
  threshold,
}: {
  missing: MissingBooking[];
  checkedUntil: string;
  threshold: number;
}) {
  return (
    <details open={missing.length <= 10} className="rounded-xl border border-red-200 bg-red-50">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-red-900">
        ! {missing.length} fehlende Buchung{missing.length === 1 ? "" : "en"}
        <span className="ml-2 font-normal text-red-800">
          (Werktage mit weniger als {formatNumber(threshold)} % der Soll-Stunden, geprüft bis{" "}
          {formatDate(checkedUntil)})
        </span>
      </summary>
      <div className="max-h-72 overflow-auto border-t border-red-200">
        <table className="w-full text-sm text-red-950">
          <thead className="sticky top-0 bg-red-50 text-xs text-red-800">
            <tr>
              <th className="px-4 py-1.5 text-left font-medium">Datum</th>
              <th className="px-4 py-1.5 text-left font-medium">Person</th>
              <th className="px-4 py-1.5 text-left font-medium">Eintrag</th>
              <th className="px-4 py-1.5 text-right font-medium">Gebucht</th>
              <th className="px-4 py-1.5 text-right font-medium">Soll</th>
              <th className="px-4 py-1.5 text-right font-medium">Anteil</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-red-100">
            {missing.map((m) => (
              <tr key={`${m.person}/${m.date}`}>
                <td className="px-4 py-1.5 whitespace-nowrap">{formatDateWithWeekday(m.date)}</td>
                <td className="px-4 py-1.5 whitespace-nowrap">{m.person}</td>
                <td className="px-4 py-1.5">
                  <span className="font-medium">Fehlende Buchung</span> – {missingReason(m)}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">
                  {formatHours(m.booked_hours)} h
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">
                  {formatHours(m.expected_hours)} h
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">
                  {formatNumber(m.coverage_percent)} %
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Urlaub/Krank an arbeitsfreien Tagen u. Ä. – zählt mit, wird aber hervorgehoben. */
function FlaggedList({ flagged }: { flagged: FlaggedBooking[] }) {
  return (
    <details open className="rounded-xl border border-amber-200 bg-amber-50">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-amber-900">
        ⚑ {flagged.length} hervorgehobene Buchung(en) – werden mitgezählt
      </summary>
      <div className="overflow-x-auto border-t border-amber-200">
        <table className="w-full text-sm text-amber-950">
          <thead className="text-xs text-amber-800">
            <tr>
              <th className="px-4 py-1.5 text-left font-medium">Datum</th>
              <th className="px-4 py-1.5 text-left font-medium">Person</th>
              <th className="px-4 py-1.5 text-left font-medium">Art</th>
              <th className="px-4 py-1.5 text-right font-medium">Gebucht</th>
              <th className="px-4 py-1.5 text-right font-medium">Angerechnet</th>
              <th className="px-4 py-1.5 text-left font-medium">Grund</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100">
            {flagged.map((f) => (
              <tr key={`${f.person}/${f.date}/${f.kind}`}>
                <td className="px-4 py-1.5 whitespace-nowrap">{formatDateWithWeekday(f.date)}</td>
                <td className="px-4 py-1.5 whitespace-nowrap">{f.person}</td>
                <td className="px-4 py-1.5">{KIND_LABEL[f.kind]}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{formatHours(f.hours)} h</td>
                <td className="px-4 py-1.5 text-right tabular-nums whitespace-nowrap">
                  {formatNumber(f.credited_days)} T = {formatHours(f.credited_hours)} h
                </td>
                <td className="px-4 py-1.5">{f.reasons.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
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
