import { useState } from "react";
import type { BillableMismatch } from "../../types/results";
import { formatDateWithWeekday, formatEuro, formatHours, formatMonth } from "../../lib/format";

interface Props {
  mismatches: BillableMismatch[];
}

const sumOf = (items: BillableMismatch[], key: "hours" | "net") => items.reduce((s, m) => s + m[key], 0);

/** „X h zusätzlich abgerechnet (+Y €) · Z h nicht abgerechnet (−W € laut Regel)“ */
function describe(items: BillableMismatch[]): string {
  const added = items.filter((m) => m.billable);
  const removed = items.filter((m) => !m.billable);
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`${formatHours(sumOf(added, "hours"))} h zusätzlich abgerechnet (+${formatEuro(sumOf(added, "net"))} netto)`);
  }
  if (removed.length > 0) {
    parts.push(`${formatHours(sumOf(removed, "hours"))} h nicht abgerechnet (−${formatEuro(sumOf(removed, "net"))} laut Regel)`);
  }
  return parts.join(" · ");
}

const ALL = "";
type Direction = "" | "billable" | "not";

/**
 * Buchungen aufs Projekt, bei denen die Billable-Spalte des Exports von den
 * Abrechnungsregeln (Kost2Art) abweicht. Abgerechnet wird nach der Spalte –
 * die Liste dient der Kontrolle (filterbar nach Person, Monat, Richtung).
 */
export function BillableMismatches({ mismatches }: Props) {
  const persons = [...new Set(mismatches.map((m) => m.person))];
  const months = [...new Set(mismatches.map((m) => m.date.slice(0, 7)))].sort().reverse();
  const [person, setPerson] = useState(ALL);
  const [month, setMonth] = useState(ALL);
  const [direction, setDirection] = useState<Direction>(ALL);
  const filtered = mismatches.filter(
    (m) =>
      (person === ALL || m.person === person) &&
      (month === ALL || m.date.startsWith(month)) &&
      (direction === ALL || m.billable === (direction === "billable")),
  );
  const filterActive = person !== ALL || month !== ALL || direction !== ALL;
  const select = "rounded-md border border-amber-300 bg-white px-2 py-1 text-sm text-amber-950";

  return (
    <details className="rounded-xl border border-amber-300 bg-amber-50">
      <summary className="cursor-pointer px-4 py-2.5 text-sm text-amber-950">
        <span className="font-medium">
          ⚑ Billable-Spalte weicht bei {mismatches.length} Buchung{mismatches.length === 1 ? "" : "en"} von den
          Abrechnungsregeln ab (es gilt die Spalte):
        </span>{" "}
        {describe(mismatches)}
      </summary>
      <div
        role="group"
        aria-label="Filter Billable-Abweichungen"
        className="flex flex-wrap items-center gap-2 border-t border-amber-200 px-4 py-2 text-sm text-amber-950"
      >
        <select aria-label="Abweichungen Person" value={person} onChange={(e) => setPerson(e.target.value)} className={select}>
          <option value={ALL}>Alle Personen</option>
          {persons.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select aria-label="Abweichungen Monat" value={month} onChange={(e) => setMonth(e.target.value)} className={select}>
          <option value={ALL}>Alle Monate</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {formatMonth(m)}
            </option>
          ))}
        </select>
        <select
          aria-label="Abweichungen Richtung"
          value={direction}
          onChange={(e) => setDirection(e.target.value as Direction)}
          className={select}
        >
          <option value={ALL}>beide Richtungen</option>
          <option value="billable">Spalte billable, Regel nicht</option>
          <option value="not">Regel billable, Spalte nicht</option>
        </select>
        {filterActive && (
          <>
            <span role="status">
              Auswahl: {filtered.length} von {mismatches.length} · {describe(filtered) || "keine"}
            </span>
            <button
              type="button"
              onClick={() => {
                setPerson(ALL);
                setMonth(ALL);
                setDirection(ALL);
              }}
              className="text-amber-900 underline hover:text-amber-950"
            >
              Filter zurücksetzen
            </button>
          </>
        )}
      </div>
      <div className="max-h-72 overflow-auto border-t border-amber-200">
        <table className="w-full text-sm text-amber-950">
          <thead className="sticky top-0 bg-amber-100 text-xs text-amber-900">
            <tr>
              <th className="px-4 py-1.5 text-left font-medium">Datum</th>
              <th className="px-4 py-1.5 text-left font-medium">Person</th>
              <th className="px-4 py-1.5 text-left font-medium">Element / Kost2Art</th>
              <th className="px-4 py-1.5 text-right font-medium">Stunden</th>
              <th className="px-4 py-1.5 text-left font-medium">Billable-Spalte</th>
              <th className="px-4 py-1.5 text-left font-medium">Regel laut Kost2Art</th>
              <th className="px-4 py-1.5 text-right font-medium">Rechnung</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-3 text-amber-800">
                  Keine Abweichungen für diese Auswahl.
                </td>
              </tr>
            )}
            {filtered.map((m, i) => (
              <tr key={i}>
                <td className="px-4 py-1.5 whitespace-nowrap">{formatDateWithWeekday(m.date)}</td>
                <td className="px-4 py-1.5 whitespace-nowrap">{m.person}</td>
                <td className="px-4 py-1.5">
                  {m.element} · <span className="text-amber-800">{m.kost2art || "–"}</span>
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">{formatHours(m.hours)}</td>
                <td className="px-4 py-1.5">{m.billable ? "billable" : "nicht billable"}</td>
                <td className="px-4 py-1.5">{m.rule ?? <span className="text-amber-800">keine passende Regel</span>}</td>
                <td className="px-4 py-1.5 text-right whitespace-nowrap">
                  {m.billable ? (
                    <span className="font-medium">+{formatEuro(m.net)} abgerechnet</span>
                  ) : (
                    <span>−{formatEuro(m.net)} nicht abgerechnet</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
