import type { ReactNode } from "react";
import type { CatchUp, CatchUpBudget, CatchUpPerson } from "../../types/results";
import {
  formatDate,
  formatEuro,
  formatHours,
  formatMonth,
  formatNumber,
  formatSignedHours,
} from "../../lib/format";
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

function Figure({
  label,
  note,
  tone = "text-red-700",
  children,
}: {
  label: string;
  note?: string;
  tone?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-2xl font-semibold tabular-nums ${tone}`}>{children}</dd>
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
        {shared && catchUp.budget && (
          <BudgetCatchUp budget={catchUp.budget} deficit={team.deficit} />
        )}
        <p className="text-xs text-slate-500">
          Arbeitstage = Werktage im Einsatz bis {formatDate(catchUp.to)} − geplante Abwesenheiten −
          offener Urlaub (Anspruch + Übertrag − genommen − eingeplant). „Allein aufholen“ = eigene
          Fehlstunden ÷ eigene Arbeitstage.
        </p>
      </div>
    </section>
  );
}

/** Was das Team mit dem restlichen Budget aufholen kann. */
function BudgetCatchUp({ budget, deficit }: { budget: CatchUpBudget; deficit: number }) {
  const period = `${formatMonth(budget.from)} – ${formatMonth(budget.to)}`;
  const until = formatDate(budget.until);
  return (
    <section aria-label="Aufholen im Budget" className="space-y-3 border-t border-slate-100 pt-4">
      <h4 className="text-sm font-semibold">Mit dem restlichen Budget ({period})</h4>
      {budget.remaining <= 0 ? (
        <p className="text-red-800">
          Das Budget ist laut Prognose schon ohne Aufholen ausgeschöpft (
          {formatEuro(-budget.remaining)} über Budget) – die fehlenden {formatHours(deficit)} h
          lassen sich nur ohne Abrechnung aufholen.
        </p>
      ) : budget.extra_per_person_day === null || budget.available_days <= 0 ? (
        <p className="text-red-800">
          Bis zum Budgetende ({until}) bleiben keine Arbeitstage – die fehlenden{" "}
          {formatHours(deficit)} h lassen sich nur ohne Abrechnung aufholen.
        </p>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-10 gap-y-3">
            <Figure
              label="Rest laut Prognose"
              note={`Budget ${formatEuro(budget.amount)} − abgerechnet + Prognose ${formatEuro(budget.expected_net)}`}
              tone="text-slate-900"
            >
              {formatEuro(budget.remaining)}
            </Figure>
            <Figure
              label="Damit aufholbar"
              note={
                budget.affordable_hours === null
                  ? "ohne Stundensatz – kostet kein Budget"
                  : `von ${formatHours(deficit)} h · Ø Satz ${formatEuro(budget.average_rate ?? 0)} · ${formatEuro(budget.covered_net)} netto`
              }
              tone="text-slate-900"
            >
              {formatHours(budget.covered_hours)} h
            </Figure>
            <Figure
              label={`Je Person und Arbeitstag bis ${until}`}
              note={`${formatHours(budget.covered_hours)} h ÷ ${formatNumber(budget.available_days)} Personen-Arbeitstage · ${minutes(budget.extra_per_person_day)}`}
            >
              {formatSignedHours(budget.extra_per_person_day)} h
            </Figure>
            {budget.extra_per_workday !== null && (
              <Figure
                label={`Team gesamt je Werktag bis ${until}`}
                note={`${formatHours(budget.covered_hours)} h ÷ ${budget.workdays} Werktage`}
              >
                {formatSignedHours(budget.extra_per_workday)} h
              </Figure>
            )}
          </dl>
          {budget.uncovered_hours > 0 ? (
            <p className="text-red-800">
              Ohne Budget bleiben {formatHours(budget.uncovered_hours)} h – diese lassen sich
              nur ohne Abrechnung aufholen (z. B. intern
              {budget.until < `${budget.until.slice(0, 4)}-12-31` ? " oder nach dem Budgetende" : ""}).
            </p>
          ) : (
            <p className="text-emerald-800">
              Der Rest reicht für die ganzen {formatHours(deficit)} h.
            </p>
          )}
        </>
      )}
      <p className="text-xs text-slate-500">
        Rest = Budget − (abgerechnet + Prognose bis zum Budgetende). Aufgeholt wird bis {until}{" "}
        (Budgetende, spätestens 31.12.); nachgeholte Stunden kosten den vollen Stundensatz, offener
        Urlaub zählt anteilig.
      </p>
    </section>
  );
}
