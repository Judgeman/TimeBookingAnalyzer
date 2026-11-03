import type { OutsideBooking, PersonResult } from "../../types/results";
import { describeAssignments } from "../../lib/assignments";
import { formatDateWithWeekday, formatEuro, formatHours } from "../../lib/format";

interface Props {
  outside: OutsideBooking[];
  persons: PersonResult[];
}

const sum = (items: OutsideBooking[], key: "hours" | "net") =>
  items.reduce((total, o) => total + o[key], 0);

/**
 * Buchungen aufs Projekt „außerhalb des Teams“ – bewusst auffällig, weil sie
 * die Rechnung betreffen: außerhalb des Einsatzzeitraums (abgerechnet) oder
 * von Personen, die nicht im Team sind (nicht abgerechnet).
 */
export function OutsideBookings({ outside, persons }: Props) {
  const invoiced = outside.filter((o) => o.reason === "outside_assignment");
  const notInTeam = outside.filter((o) => o.reason === "not_in_team");
  const assignmentOf = (name: string) =>
    describeAssignments(persons.find((p) => p.name === name)?.assignments ?? []);

  return (
    <section
      role="alert"
      aria-label="Buchungen außerhalb des Teams"
      className="overflow-hidden rounded-xl border-2 border-red-500 bg-red-50 shadow-sm"
    >
      <header className="flex items-start gap-3 bg-red-600 px-4 py-3 text-white">
        <span aria-hidden className="text-xl leading-none">
          ⚠
        </span>
        <div>
          <h2 className="text-base font-semibold">
            {outside.length} Buchung{outside.length === 1 ? "" : "en"} auf das Projekt außerhalb
            des Teams
          </h2>
          <ul className="mt-0.5 text-sm text-red-50">
            {invoiced.length > 0 && (
              <li>
                {formatHours(sum(invoiced, "hours"))} h außerhalb des Einsatzzeitraums –{" "}
                <strong>abgerechnet ({formatEuro(sum(invoiced, "net"))} netto)</strong>
              </li>
            )}
            {notInTeam.length > 0 && (
              <li>
                {formatHours(sum(notInTeam, "hours"))} h von Personen, die nicht im Team sind –{" "}
                <strong>nicht abgerechnet</strong> (kein Stundensatz)
              </li>
            )}
          </ul>
        </div>
      </header>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-sm text-red-950">
          <thead className="sticky top-0 bg-red-100 text-xs text-red-900">
            <tr>
              <th className="px-4 py-1.5 text-left font-medium">Datum</th>
              <th className="px-4 py-1.5 text-left font-medium">Person</th>
              <th className="px-4 py-1.5 text-left font-medium">Grund</th>
              <th className="px-4 py-1.5 text-left font-medium">Element / Kost2Art</th>
              <th className="px-4 py-1.5 text-right font-medium">Stunden</th>
              <th className="px-4 py-1.5 text-right font-medium">Rechnung</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-red-100">
            {outside.map((o, i) => (
              <tr key={i}>
                <td className="px-4 py-1.5 whitespace-nowrap">{formatDateWithWeekday(o.date)}</td>
                <td className="px-4 py-1.5 whitespace-nowrap font-medium">{o.person}</td>
                <td className="px-4 py-1.5">
                  {o.reason === "outside_assignment" ? (
                    <>
                      <span className="rounded bg-orange-200 px-1.5 py-0.5 text-xs font-medium text-orange-950">
                        außerhalb Einsatzzeitraum
                      </span>
                      {assignmentOf(o.person) && (
                        <span className="ml-2 text-xs text-red-800">
                          im Projekt: {assignmentOf(o.person)}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="rounded bg-red-200 px-1.5 py-0.5 text-xs font-medium text-red-950">
                      nicht im Team
                    </span>
                  )}
                </td>
                <td className="px-4 py-1.5">
                  {o.element}
                  {o.kost2art && <span className="text-red-800"> · {o.kost2art}</span>}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">{formatHours(o.hours)}</td>
                <td className="px-4 py-1.5 text-right whitespace-nowrap">
                  {o.invoiced ? (
                    <span className="font-semibold">abgerechnet: {formatEuro(o.net)}</span>
                  ) : (
                    <span>nicht abgerechnet</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
