import type { ReactNode } from "react";
import type { CatchUp, CatchUpPerson } from "../../types/results";
import { formatDate, formatHours, formatNumber, formatSignedHours } from "../../lib/format";
import { styles } from "./styles";

/** Kleine Werte zusätzlich in Minuten, z. B. "≈ 8 Min.". */
const minutes = (hours: number) => `≈ ${Math.round(hours * 60)} Min.`;

const tone = (value: number) =>
  value > 0.004 ? "text-emerald-700" : value < -0.004 ? "text-red-700" : "";

function Title({ catchUp, suffix }: { catchUp: CatchUp; suffix?: string }) {
  return (
    <header className="border-b border-slate-100 px-5 py-3">
      <h3 className="text-sm font-semibold">
        Aufholen bis {formatDate(catchUp.to)}
        {suffix} – Krankheit als Fehlzeit
      </h3>
      <p className="text-xs text-slate-500">
        Zusätzlich je Arbeitstag ab {formatDate(catchUp.from)}, um auf 100 % Erfüllung zu kommen –
        ohne weitere Krankheit; an Urlaubstagen wird nichts aufgeholt.
      </p>
    </header>
  );
}

function Figure({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums text-red-700">{children}</dd>
      {note && <dd className="text-xs text-slate-500">{note}</dd>}
    </div>
  );
}

/** Arbeitstage = Werktage im Einsatz − geplante Abwesenheiten − offener Urlaub. */
function daysBreakdown(p: CatchUpPerson): string {
  const vacation = p.has_entitlement
    ? `${formatNumber(p.open_vacation_days)} offener Urlaub`
    : "kein Urlaubsanspruch hinterlegt";
  return `${formatNumber(p.workdays)} Werktage im Einsatz − ${formatNumber(
    p.planned_days,
  )} geplant abwesend − ${vacation}`;
}

/** Aufholen für eine Person (nur bei Erfüllung unter 100 %). */
export function PersonCatchUp({ catchUp, person }: { catchUp: CatchUp; person: string }) {
  const p = catchUp.persons.find((c) => c.person === person);
  if (!p || p.deficit <= 0) return null;
  const share = catchUp.team.deficit > 0 && p.team_share > 0;
  return (
    <section aria-label="Aufholen" className="rounded-xl border border-red-200 bg-white">
      <Title catchUp={catchUp} />
      <div className="space-y-3 px-5 py-4 text-sm">
        {p.extra_per_day === null ? (
          <p className="text-red-800">
            Bis {formatDate(catchUp.to)} bleiben {person} keine Arbeitstage im Projekt – die fehlenden{" "}
            {formatHours(p.deficit)} h lassen sich in diesem Jahr nicht mehr aufholen.
          </p>
        ) : (
          <dl className="flex flex-wrap gap-x-10 gap-y-3">
            <Figure label="Mehr je Arbeitstag" note={minutes(p.extra_per_day)}>
              {formatSignedHours(p.extra_per_day)} h
            </Figure>
            <div>
              <dt className="text-xs text-slate-500">Statt Ø h/Tag</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {formatHours(p.hours_per_day)} → {formatHours(p.hours_per_day + p.extra_per_day)} h
              </dd>
            </div>
          </dl>
        )}
        <p className="text-slate-600">
          Es fehlen {formatHours(p.deficit)} h bis 100 % · {formatNumber(p.available_days)} Arbeitstage
          bis {formatDate(catchUp.to)} ({daysBreakdown(p)}).
        </p>
        {share && catchUp.team.extra_per_person_day !== null && (
          <p className="text-slate-600">
            Im Team verteilt (Fehlstunden aller, gleichmäßig je Arbeitstag):{" "}
            {formatSignedHours(catchUp.team.extra_per_person_day)} h je Arbeitstag, Anteil{" "}
            {formatHours(p.team_share)} h – s. Team.
          </p>
        )}
      </div>
    </section>
  );
}

/** Aufholen fürs Team: gesamt je Werktag und gleichmäßig je Person verteilt. */
export function TeamCatchUp({ catchUp }: { catchUp: CatchUp }) {
  const { team } = catchUp;
  const anyone = catchUp.persons.some((p) => p.deficit > 0);
  if (team.deficit <= 0 && !anyone) return null;
  const shared = team.deficit > 0;
  return (
    <section aria-label="Aufholen" className="rounded-xl border border-red-200 bg-white">
      <Title catchUp={catchUp} suffix=" – Team" />
      <div className="space-y-4 px-5 py-4 text-sm">
        {!shared ? (
          <p className="text-emerald-800">
            Das Team liegt insgesamt bei 100 % oder mehr (Saldo {formatSignedHours(team.balance)} h):
            Überstunden anderer gleichen die Fehlstunden einzelner aus.
          </p>
        ) : team.extra_per_workday === null || team.extra_per_person_day === null ? (
          <p className="text-red-800">
            Bis {formatDate(catchUp.to)} bleiben keine Arbeitstage – die fehlenden{" "}
            {formatHours(team.deficit)} h lassen sich in diesem Jahr nicht mehr aufholen.
          </p>
        ) : (
          <dl className="flex flex-wrap gap-x-10 gap-y-3">
            <Figure
              label="Team gesamt je Werktag"
              note={`${formatHours(team.deficit)} h ÷ ${catchUp.workdays} Werktage`}
            >
              {formatSignedHours(team.extra_per_workday)} h
            </Figure>
            <Figure
              label="Je Person und Arbeitstag"
              note={`${formatHours(team.deficit)} h ÷ ${formatNumber(team.available_days)} Personen-Arbeitstage · ${minutes(team.extra_per_person_day)}`}
            >
              {formatSignedHours(team.extra_per_person_day)} h
            </Figure>
          </dl>
        )}
        {shared && (
          <p className="text-slate-600">
            Dem Team fehlen {formatHours(team.deficit)} h bis 100 % (Summe der Salden – Überstunden
            gleichen Fehlstunden aus). Verteilt wird gleichmäßig auf jeden Arbeitstag, an dem eine
            Person bis {formatDate(catchUp.to)} da ist.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>Person</th>
                <th className={styles.thNum}>Saldo</th>
                <th className={styles.thNum}>Arbeitstage</th>
                <th className={styles.thNum}>Ø h/Tag</th>
                <th className={styles.thNum}>Allein aufholen</th>
                {shared && <th className={styles.thNum}>Anteil Team</th>}
                {shared && <th className={styles.thNum}>Neu h/Tag (Team)</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {catchUp.persons.map((p) => (
                <tr key={p.person}>
                  <td className={styles.td}>{p.person}</td>
                  <td className={`${styles.tdNum} ${tone(p.balance)}`}>
                    {formatSignedHours(p.balance)}
                  </td>
                  <td className={styles.tdNum} title={daysBreakdown(p)}>
                    {formatNumber(p.available_days)}
                  </td>
                  <td className={styles.tdNum}>
                    {p.workdays > 0 ? formatHours(p.hours_per_day) : "–"}
                  </td>
                  <td className={styles.tdNum}>
                    {p.deficit <= 0
                      ? "–"
                      : p.extra_per_day === null
                        ? "nicht mehr möglich"
                        : `${formatSignedHours(p.extra_per_day)} h/Tag`}
                  </td>
                  {shared && (
                    <td className={styles.tdNum}>
                      {p.team_share > 0 ? `${formatHours(p.team_share)} h` : "–"}
                    </td>
                  )}
                  {shared && (
                    <td className={styles.tdNum}>
                      {p.available_days > 0 && team.extra_per_person_day !== null
                        ? `${formatHours(p.hours_per_day)} → ${formatHours(
                            p.hours_per_day + team.extra_per_person_day,
                          )}`
                        : "–"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          Arbeitstage = Werktage im Einsatz bis {formatDate(catchUp.to)} − geplante Abwesenheiten −
          offener Urlaub (Anspruch + Übertrag − genommen − eingeplant). „Allein aufholen“ = eigene
          Fehlstunden ÷ eigene Arbeitstage.
        </p>
      </div>
    </section>
  );
}
