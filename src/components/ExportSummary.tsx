import type { ReactNode } from "react";
import type { ParsedExport } from "../types/results";
import { formatDate, formatHours, formatNumber } from "../lib/format";

interface Props {
  result: ParsedExport;
  elementFilter: string;
}

/** Übersicht über den eingelesenen Export – Grundlage für die spätere Auswertung. */
export function ExportSummary({ result, elementFilter }: Props) {
  // Billable-Spalte nur zeigen, wenn sie im Export-Format gesetzt ist
  const withBillable = result.preview.some((entry) => entry.billable !== null);
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Zeitraum">
          {formatDate(result.first_entry_date)} – {formatDate(result.last_entry_date)}
        </Stat>
        <Stat label="Buchungen">{formatNumber(result.entry_count)}</Stat>
        <Stat label="Stunden gesamt">{formatHours(result.total_hours)}</Stat>
        <Stat label={`Buchungen auf „${elementFilter || "–"}“`}>
          {formatNumber(result.element_match_count)}
        </Stat>
      </dl>

      {result.missing_team_members.length > 0 && (
        <Notice>
          Nicht im Export gefunden: <strong>{result.missing_team_members.join(", ")}</strong>. Stimmt
          die Schreibweise mit der Namensspalte überein?
        </Notice>
      )}

      {elementFilter && result.element_match_count === 0 && (
        <Notice>
          Keine Buchung hat das Element „{elementFilter}“. Element-Filter oder Spalten-Mapping
          prüfen.
        </Notice>
      )}

      {result.skipped_rows.length > 0 && (
        <details className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <summary className="cursor-pointer font-medium">
            {result.skipped_rows.length}{" "}
            {result.skipped_rows.length === 1 ? "Zeile wurde" : "Zeilen wurden"} übersprungen
          </summary>
          <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
            {result.skipped_rows.map((row) => (
              <li key={row.row}>
                Zeile {row.row}: {row.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <section>
        <h3 className={heading}>Personen</h3>
        <div className={tableWrap}>
          <table className="w-full text-sm">
            <thead className={thead}>
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Team</th>
                <th className={thNum}>Buchungen</th>
                <th className={thNum}>Stunden</th>
                <th className={thNum}>davon Projekt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.persons.map((person) => (
                <tr
                  key={person.name}
                  className={person.in_team || person.guest ? "" : "text-slate-400"}
                >
                  <td className={td}>{person.name}</td>
                  <td className={td}>
                    {person.in_team ? (
                      "✓"
                    ) : person.guest ? (
                      <span className="text-sky-700">darf buchen</span>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td className={tdNum}>{formatNumber(person.entry_count)}</td>
                  <td className={tdNum}>{formatHours(person.hours)}</td>
                  <td className={tdNum}>{formatHours(person.project_hours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className={heading}>
          Erste {result.preview.length} von {formatNumber(result.entry_count)} Buchungen
          <span className="ml-2 font-normal text-slate-500">(Blatt „{result.sheet_name}“)</span>
        </h3>
        <div className={tableWrap}>
          <table className="w-full text-sm">
            <thead className={thead}>
              <tr>
                <th className={th}>Datum</th>
                <th className={th}>Name</th>
                <th className={thNum}>Dauer</th>
                <th className={thNum}>Mult</th>
                <th className={th}>Element</th>
                <th className={th}>Kost2Art</th>
                <th className={th}>Ort</th>
                {withBillable && <th className={th}>Billable</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.preview.map((entry, i) => (
                <tr key={i}>
                  <td className={td}>{formatDate(entry.date)}</td>
                  <td className={td}>{entry.name}</td>
                  <td className={tdNum}>{formatHours(entry.hours)}</td>
                  <td className={tdNum}>{formatNumber(entry.mult)}</td>
                  <td className={td}>{entry.element}</td>
                  <td className={td}>{entry.kost2art}</td>
                  <td className={td}>{entry.location}</td>
                  {withBillable && (
                    <td className={td}>{entry.billable === null ? "–" : entry.billable ? "ja" : "nein"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <dt className="truncate text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">{children}</p>;
}

const heading = "mb-2 text-sm font-semibold text-slate-800";
const tableWrap = "overflow-x-auto rounded-xl border border-slate-200 bg-white";
const thead = "bg-slate-50 text-xs text-slate-500";
const th = "px-3 py-2 text-left font-medium whitespace-nowrap";
const thNum = "px-3 py-2 text-right font-medium whitespace-nowrap";
const td = "px-3 py-1.5 whitespace-nowrap";
const tdNum = "px-3 py-1.5 text-right tabular-nums whitespace-nowrap";
