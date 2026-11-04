import type { GuestBooking, PersonResult } from "../../types/results";
import { describeAssignments } from "../../lib/assignments";
import { formatDateWithWeekday, formatEuro, formatHours } from "../../lib/format";

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
export function GuestBookings({ bookings, persons: team = [] }: Props) {
  const persons = [...new Set(bookings.map((b) => b.person))];
  const memberOf = (name: string) => team.find((p) => p.name === name);

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
              {bookings.map((b, i) => {
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
