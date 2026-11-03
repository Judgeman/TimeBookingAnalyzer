import { useState, type ReactNode } from "react";
import type { PlannedAbsence } from "../../types/config";
import type { BudgetStatus, Forecast } from "../../types/results";
import {
  formatDate,
  formatEuro,
  formatHours,
  formatMonth,
  formatNumber,
  formatPercent,
} from "../../lib/format";
import { BudgetChart } from "./BudgetChart";
import {
  activeBudgetIndex,
  budgetVerdict,
  cumulativeSeries,
  currentMonth,
  dataEndOf,
} from "./forecast";
import { styles } from "./styles";

interface Props {
  forecast: Forecast;
  /** Geplante Abwesenheiten aus der Projektkonfiguration (Anzeige). */
  plannedAbsences?: PlannedAbsence[];
}

const monthRange = (from: string, to: string) =>
  `${formatMonth(from)} – ${formatMonth(to)}`;
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatEuro(Math.abs(value))}`;

/** Prognose der Rechnung bis Jahresende bzw. Budget-Ende, Budget-Abgleich, Faktoren. */
export function ForecastView({ forecast, plannedAbsences = [] }: Props) {
  const [budgetIndex, setBudgetIndex] = useState(() => activeBudgetIndex(forecast));
  const budget: BudgetStatus | null = forecast.budgets[budgetIndex] ?? null;
  const dataEnd = dataEndOf(forecast);
  const current = currentMonth(forecast);
  const months = budget
    ? forecast.months.filter((m) => m.month >= budget.from && m.month <= budget.to)
    : forecast.months;
  const range = {
    from: budget?.from ?? forecast.months[0]?.month ?? forecast.from.slice(0, 7),
    to: budget?.to ?? forecast.months[forecast.months.length - 1]?.month ?? forecast.to.slice(0, 7),
  };
  const points = cumulativeSeries(forecast, range.from, range.to, budget?.monthly_target ?? null);

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Prognose ab <strong>{formatDate(forecast.from)}</strong> bis {formatDate(forecast.to)} (Tag nach
        dem Stand der Daten) · Faktoren je Person aus{" "}
        {forecast.reference_to
          ? `${formatDate(forecast.reference_from)} – ${formatDate(forecast.reference_to)}`
          : "– (keine Daten)"}
      </p>

      {current && (
        <section>
          <h3 className={styles.heading}>Rechnung {formatMonth(current.month)} (laufender Monat)</h3>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Tile label={`Abgerechnet bis ${formatDate(dataEnd)}`}>{formatEuro(current.actual_net)}</Tile>
            <Tile label="Prognose für den Rest" note={`${formatHours(current.forecast_hours)} h`}>
              {formatEuro(current.forecast_net)}
            </Tile>
            <Tile label="Erwartet netto" strong>
              {formatEuro(current.actual_net + current.forecast_net)}
            </Tile>
          </dl>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={styles.heading}>
            {budget ? `Budget ${monthRange(budget.from, budget.to)}` : "Verlauf bis Jahresende"}
          </h3>
          {forecast.budgets.length > 1 && (
            <div className="flex gap-1" role="group" aria-label="Budget-Zeitraum">
              {forecast.budgets.map((b, i) => (
                <button
                  key={`${b.from}-${b.to}`}
                  type="button"
                  aria-pressed={i === budgetIndex}
                  onClick={() => setBudgetIndex(i)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    i === budgetIndex ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {b.from} – {b.to}
                </button>
              ))}
            </div>
          )}
        </div>

        {budget ? (
          <BudgetSummary budget={budget} dataEnd={dataEnd} />
        ) : (
          <p className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-600">
            Kein Budget hinterlegt – unter „Projekt bearbeiten“ → „Planung“ einen Budget-Zeitraum
            anlegen, um Richtwert und Überziehung zu sehen.
          </p>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <BudgetChart
            points={points}
            budget={budget?.amount ?? null}
            ariaLabel={`Abgerechnet und Prognose kumuliert${budget ? " mit Richtwert und Budget" : ""}`}
          />
        </div>

        <MonthTable months={months} budget={budget} dataEnd={dataEnd} />
      </section>

      <section>
        <h3 className={styles.heading}>Prognose je Person</h3>
        <div className={styles.tableWrap}>
          <table className="w-full text-sm">
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>Person</th>
                <th className={styles.thNum}>Krankheitsfaktor</th>
                <th className={styles.thNum}>Ablenkungsfaktor</th>
                <th className={styles.thNum}>Soll (h)</th>
                <th className={styles.thNum}>geplant abwesend</th>
                <th className={styles.thNum}>Prognose (h)</th>
                <th className={styles.thNum}>Prognose netto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {forecast.persons.map((p) => (
                <tr key={p.name} className={p.contract_hours === 0 ? "text-slate-400" : ""}>
                  <td className={styles.td}>
                    {p.name}
                    {p.contract_hours === 0 && <span className="ml-2 text-xs">(im Zeitraum nicht im Einsatz)</span>}
                  </td>
                  <td
                    className={`${styles.tdNum} cursor-help`}
                    title={`${formatHours(p.reference.sick_hours)} h krank von ${formatHours(p.reference.available_hours)} h verfügbar (Soll − Urlaub)`}
                  >
                    {formatPercent(p.sick_factor * 100)}
                  </td>
                  <td
                    className={`${styles.tdNum} cursor-help`}
                    title={`${formatHours(p.reference.invoiced_hours)} h abgerechnet (zum vollen Satz) von ${formatHours(p.reference.worked_hours)} h gearbeitet`}
                  >
                    {formatPercent(p.distraction_factor * 100)}
                  </td>
                  <td className={styles.tdNum}>{formatHours(p.contract_hours)}</td>
                  <td className={styles.tdNum}>
                    {p.planned_absence_days > 0
                      ? `${formatNumber(p.planned_absence_days)} T (${formatHours(p.planned_absence_hours)} h)`
                      : "–"}
                  </td>
                  <td className={styles.tdNum}>{formatHours(p.hours)}</td>
                  <td className={`${styles.tdNum} font-semibold text-slate-900`}>{formatEuro(p.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {plannedAbsences.length > 0 && (
        <section>
          <h3 className={styles.heading}>Geplante Abwesenheiten</h3>
          <ul className="space-y-1 text-sm text-slate-700">
            {plannedAbsences.map((a, i) => (
              <li key={i}>
                <span className="font-medium">{a.person}</span>: {formatDate(a.from)}
                {a.to !== a.from && ` – ${formatDate(a.to)}`} · {a.kind === "vacation" ? "Urlaub" : "Sonstiges"}
                {a.half_day && " (halbe Tage)"}
              </li>
            ))}
          </ul>
        </section>
      )}

      {forecast.notes.length > 0 && (
        <ul className="space-y-1 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {forecast.notes.map((n) => (
            <li key={n}>⚠ {n}</li>
          ))}
        </ul>
      )}

      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">So wird gerechnet</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>Krankheitsfaktor</strong> = krank ÷ (Soll − Urlaub) im Referenzzeitraum.
          </li>
          <li>
            <strong>Ablenkungsfaktor</strong> = Anteil der gearbeiteten Zeit, der nicht in Rechnung
            gestellt wurde (andere Projekte, intern, nicht abrechenbare Kost2Art, Satz-Anteile unter
            100 %).
          </li>
          <li>
            Je Werktag nach dem Stand: (h/Tag − geplante Abwesenheit) × (1 − Krankheit) × (1 −
            Ablenkung) × Stundensatz. Überstunden werden nicht hochgerechnet.
          </li>
          <li>Richtwert = Budget ÷ Anzahl Monate; Abweichung = Abgerechnet + Prognose − Budget.</li>
        </ul>
      </details>
    </div>
  );
}

function BudgetSummary({ budget, dataEnd }: { budget: BudgetStatus; dataEnd: string }) {
  const verdict = budgetVerdict(budget);
  const share = budget.amount > 0 ? (budget.actual_net / budget.amount) * 100 : 0;
  const vsTarget = budget.actual_net - budget.target_to_date;
  return (
    <>
      <div
        role="status"
        className={`rounded-xl border-2 px-4 py-3 text-sm ${
          verdict.over ? "border-red-500 bg-red-50 text-red-950" : "border-emerald-500 bg-emerald-50 text-emerald-950"
        }`}
      >
        <p className="font-semibold">
          <span aria-hidden className="mr-1.5">{verdict.over ? "⚠" : "✓"}</span>
          {verdict.text}
          {budget.deviation > 0
            ? `: ${formatEuro(budget.deviation)} über Budget zum Ende ${formatMonth(budget.to)}`
            : `: ${formatEuro(-budget.deviation)} Rest zum Ende ${formatMonth(budget.to)}`}
        </p>
        {budget.exhausted_on && (
          <p className="mt-0.5">Budget laut Prognose aufgebraucht am {formatDate(budget.exhausted_on)}.</p>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Budget netto" note={`Richtwert ${formatEuro(budget.monthly_target)} / Monat (${budget.month_count} Monate)`}>
          {formatEuro(budget.amount)}
        </Tile>
        <Tile
          label={`Abgerechnet bis ${formatDate(dataEnd)}`}
          note={`${formatPercent(share)} des Budgets · ${signed(vsTarget)} zum Richtwert`}
        >
          {formatEuro(budget.actual_net)}
        </Tile>
        <Tile label="Prognose bis Ende">{formatEuro(budget.forecast_net)}</Tile>
        <Tile label="Erwartet zum Ende" note={`${signed(budget.deviation)} zum Budget`} strong>
          {formatEuro(budget.expected_net)}
        </Tile>
      </dl>
    </>
  );
}

function MonthTable({
  months,
  budget,
  dataEnd,
}: {
  months: Forecast["months"];
  budget: BudgetStatus | null;
  dataEnd: string;
}) {
  let cumulative = 0;
  let target = 0;
  return (
    <div className={styles.tableWrap}>
      <table className="w-full text-sm">
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Monat</th>
            <th className={styles.thNum}>Abgerechnet</th>
            <th className={styles.thNum}>Prognose</th>
            <th className={styles.thNum}>Summe</th>
            <th className={styles.thNum}>kumuliert</th>
            {budget && (
              <>
                <th className={styles.thNum}>Richtwert kumuliert</th>
                <th className={styles.thNum}>Differenz</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {months.map((m) => {
            const sum = m.actual_net + m.forecast_net;
            cumulative += sum;
            target += budget?.monthly_target ?? 0;
            const diff = cumulative - target;
            const future = `${m.month}-01` > dataEnd;
            return (
              <tr key={m.month} className={future ? "text-slate-600" : ""}>
                <td className={styles.td}>{formatMonth(m.month)}</td>
                <td className={styles.tdNum}>{m.actual_net ? formatEuro(m.actual_net) : "–"}</td>
                <td className={styles.tdNum}>{m.forecast_net ? formatEuro(m.forecast_net) : "–"}</td>
                <td className={`${styles.tdNum} font-semibold text-slate-900`}>{formatEuro(sum)}</td>
                <td className={styles.tdNum}>{formatEuro(cumulative)}</td>
                {budget && (
                  <>
                    <td className={styles.tdNum}>{formatEuro(target)}</td>
                    <td className={`${styles.tdNum} ${diff > 0.005 ? "text-red-700" : "text-emerald-700"}`}>
                      {signed(diff)}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Tile({
  label,
  note,
  strong,
  children,
}: {
  label: string;
  note?: string;
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${strong ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white"}`}>
      <dt className={`text-xs ${strong ? "text-slate-300" : "text-slate-500"}`}>{label}</dt>
      <dd className="mt-1 text-xl font-semibold">{children}</dd>
      {note && <dd className={`mt-0.5 text-xs ${strong ? "text-slate-300" : "text-slate-500"}`}>{note}</dd>}
    </div>
  );
}
