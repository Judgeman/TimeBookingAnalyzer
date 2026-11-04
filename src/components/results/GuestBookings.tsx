import { useState } from "react";
import type { GuestBooking, PersonResult } from "../../types/results";
import { describeAssignments } from "../../lib/assignments";
import { formatDateWithWeekday, formatEuro, formatHours, formatMonth } from "../../lib/format";

interface Props {
  bookings: GuestBooking[];
  /** Team: Buchungen von Teammitgliedern stammen von außerhalb ihres Einsatzes. */
  persons?: PersonResult[];
}

interface Totals {
  hours: number;
  billedHours: number;
  net: number;
  notBilledHours: number;
}

function totalsOf(bookings: GuestBooking[]): Totals {
  return bookings.reduce(
    (t, b) => ({
      hours: t.hours + b.hours,
      billedHours: t.billedHours + (b.invoiced ? b.billed_hours : 0),
      net: t.net + b.net,
      notBilledHours: t.notBilledHours + (b.invoiced ? 0 : b.hours),
    }),
    { hours: 0, billedHours: 0, net: 0, notBilledHours: 0 },
  );
}

function describe(t: Totals): string {
  const parts = [`${formatHours(t.hours)} h aufs Projekt`];
  if (t.billedHours > 0) {
    parts.push(`${formatHours(t.billedHours)} h abgerechnet (${formatEuro(t.net)} netto)`);
  }
  if (t.notBilledHours > 0) parts.push(`${formatHours(t.notBilledHours)} h nicht abgerechnet`);
  return parts.join(" · ");
}

/**
 * Buchungen von Personen mit der Rolle „darf buchen“ – neutraler Hinweis:
 * erlaubt, ohne Zeiterfassung; abgerechnet nach Kost2Art (Abrechnungsregeln).
 * Dazu Teammitglieder, die außerhalb ihres Einsatzes buchen dürfen.
 */
const ALL = "";
type Invoiced = "" | "yes" | "no";

export function GuestBookings({ bookings, persons: team = [] }: Props) {
  const persons = [...new Set(bookings.map((b) => b.person))];
  const months = [...new Set(bookings.map((b) => b.date.slice(0, 7)))].sort().reverse();
  const memberOf = (name: string) => team.find((p) => p.name === name);
  const [person, setPerson] = useState(ALL);
  const [month, setMonth] = useState(ALL);
  const [invoiced, setInvoiced] = useState<Invoiced>(ALL);
  const filtered = bookings.filter(
    (b) =>
      (person === ALL || b.person === person) &&
      (month === ALL || b.date.startsWith(month)) &&
      (invoiced === ALL || b.invoiced === (invoiced === "yes")),
  );
  const filterActive = person !== ALL || month !== ALL || invoiced !== ALL;
  const select = "rounded-md border border-sky-300 bg-white px-2 py-1 text-sm text-sky-950";

  return (
    <details className="rounded-xl border border-sky-200 bg-sky-50">
      <summary className="cursor-pointer px-4 py-2.5 text-sm text-sky-950">
        <span className="font-medium">ℹ Darf buchen (ohne Zeiterfassung):</span>{" "}
        {describe(totalsOf(bookings))}
      </summary>
      <div className="border-t border-sky-200">
        {persons.length > 1 && (
          <ul className="px-4 py-2 text-sm text-sky-950">
            {persons.map((p) => (
              <li key={p}>
                <span className="font-medium">{p}:</span>{" "}
                {describe(totalsOf(bookings.filter((b) => b.person === p)))}
              </li>
            ))}
          </ul>
        )}
        <div
          role="group"
          aria-label="Filter darf buchen"
          className="flex flex-wrap items-center gap-2 border-t border-sky-200 px-4 py-2 text-sm text-sky-950"
        >
          <select aria-label="Filter Person" value={person} onChange={(e) => setPerson(e.target.value)} className={select}>
            <option value={ALL}>Alle Personen</option>
            {persons.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select aria-label="Filter Monat" value={month} onChange={(e) => setMonth(e.target.value)} className={select}>
            <option value={ALL}>Alle Monate</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter abgerechnet"
            value={invoiced}
            onChange={(e) => setInvoiced(e.target.value as Invoiced)}
            className={select}
          >
            <option value={ALL}>abgerechnet und nicht abgerechnet</option>
            <option value="yes">nur abgerechnet</option>
            <option value="no">nur nicht abgerechnet</option>
          </select>
          {filterActive && (
            <>
              <span role="status" className="text-sky-900">
                Auswahl: {filtered.length} von {bookings.length} Buchungen · {describe(totalsOf(filtered))}
              </span>
              <button
                type="button"
                onClick={() => {
                  setPerson(ALL);
                  setMonth(ALL);
                  setInvoiced(ALL);
                }}
                className="text-sky-800 underline hover:text-sky-950"
              >
                Filter zurücksetzen
              </button>
            </>
          )}
        </div>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm text-sky-950">
            <thead className="sticky top-0 bg-sky-100 text-xs text-sky-900">
              <tr>
                <th className="px-4 py-1.5 text-left font-medium">Datum</th>
                <th className="px-4 py-1.5 text-left font-medium">Person</th>
                <th className="px-4 py-1.5 text-left font-medium">Element / Kost2Art</th>
                <th className="px-4 py-1.5 text-right font-medium">Stunden</th>
                <th className="px-4 py-1.5 text-left font-medium">Regel</th>
                <th className="px-4 py-1.5 text-right font-medium">Rechnung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-3 text-sky-800">
                    Keine Buchungen für diese Auswahl.
                  </td>
                </tr>
              )}
              {filtered.map((b, i) => {
                const member = memberOf(b.person);
                return (
                  <tr key={i}>
                    <td className="px-4 py-1.5 whitespace-nowrap">{formatDateWithWeekday(b.date)}</td>
                    <td className="px-4 py-1.5">
                      <span className="whitespace-nowrap">{b.person}</span>
                      {member && (
                        <span
                          className="ml-2 rounded bg-sky-200 px-1.5 py-0.5 text-xs whitespace-nowrap text-sky-950"
                          title={`Team – im Projekt: ${describeAssignments(member.assignments) ?? "immer"}`}
                        >
                          außerhalb Einsatz
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-1.5">
                      {b.element} · <span className="text-sky-800">{b.kost2art || "–"}</span>
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{formatHours(b.hours)}</td>
                    <td className="px-4 py-1.5">
                      {b.rule ?? <span className="text-sky-700">keine passende Regel</span>}
                    </td>
                    <td className="px-4 py-1.5 text-right whitespace-nowrap">
                      {b.invoiced ? (
                        <span className="font-medium">abgerechnet: {formatEuro(b.net)}</span>
                      ) : (
                        <span className="text-sky-700">nicht abgerechnet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
