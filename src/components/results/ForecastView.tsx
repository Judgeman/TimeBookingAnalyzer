import { useState, type ReactNode } from "react";
import type { PlannedAbsence } from "../../types/config";
import type { AccuracyMonth, BudgetStatus, Forecast } from "../../types/results";
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
  ACCURACY_HIT,
  accuracySummary,
  activeBudgetIndex,
  budgetVerdict,
  cumulativeSeries,
  currentMonth,
  dataEndOf,
  deviation,
  monthEnd,
} from "./forecast";
import { styles } from "./styles";

interface Props {
  forecast: Forecast;
  /** Geplante Abwesenheiten aus der Projektkonfiguration (Anzeige). */
  plannedAbsences?: PlannedAbsence[];
  /** Prognosegüte je abgeschlossenem Monat. */
  accuracy?: AccuracyMonth[];
}

const monthRange = (from: string, to: string) =>
  `${formatMonth(from)} – ${formatMonth(to)}`;
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatEuro(Math.abs(value))}`;

/** Prognose der Rechnung bis Jahresende bzw. Budget-Ende, Budget-Abgleich, Faktoren. */
export function ForecastView({ forecast, plannedAbsences = [], accuracy = [] }: Props) {
  const [budgetIndex, setBudgetIndex] = useState(() => activeBudgetIndex(forecast));
  const budget: BudgetStatus | null = forecast.budgets[budgetIndex] ?? null;
  const dataEnd = dataEndOf(forecast);
  const current = currentMonth(forecast);
  // Budget, in dem der laufende Monat liegt (unabhängig von der Auswahl unten)
  const activeBudget: BudgetStatus | null = forecast.budgets[activeBudgetIndex(forecast)] ?? null;
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
          <dl className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${activeBudget ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            <Tile label={`Abgerechnet bis ${formatDate(dataEnd)}`}>{formatEuro(current.actual_net)}</Tile>
            <Tile label="Prognose für den Rest" note={`${formatHours(current.forecast_hours)} h`}>
              {formatEuro(current.forecast_net)}
            </Tile>
            <Tile label="Erwartet netto" strong>
              {formatEuro(current.actual_net + current.forecast_net)}
            </Tile>
            {activeBudget && <BudgetEndTile budget={activeBudget} month={current.month} />}
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

        <MonthTable months={months} budget={budget} dataEnd={dataEnd} forecastFrom={forecast.from} />
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
                  {p.utilization !== null ? (
                    <td
                      colSpan={2}
                      className={`${styles.tdNum} cursor-help`}
                      title={`Ohne Zeiterfassung: ${formatHours(p.reference.invoiced_hours)} h abgerechnet (zum vollen Satz) von ${formatHours(p.reference.available_hours)} h verfügbar (Soll − Urlaub)`}
                    >
                      Auslastung {formatPercent(p.utilization * 100)}
                      <span className="block text-xs text-slate-500">ohne Zeiterfassung</span>
                    </td>
                  ) : (
                    <>
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
                    </>
                  )}
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

      {accuracy.length > 0 && <AccuracySection months={accuracy} />}

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
          <li>
            <strong>Ohne Zeiterfassung</strong> (Export unvollständig): statt der beiden Faktoren die
            Auslastung = abgerechnet (zum vollen Satz) ÷ (Soll − Urlaub) im Einsatz; je Werktag (h/Tag −
            geplante Abwesenheit) × Auslastung × Stundensatz.
          </li>
          <li>
            Summe je Monat = abgerechnet (bis zum Stand der Daten) + Prognose (ab dem Tag danach) – kein
            Tag zählt doppelt. Liegen abgerechnete Buchungen nach dem Stand des Exports, beginnt die
            Prognose erst nach der letzten davon (mit Hinweis).
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
        <Tile
          label={`Prognose bis Ende ${formatMonth(budget.to)}`}
          note={`Abgerechnet ${formatEuro(budget.actual_net)} + Prognose ${formatEuro(budget.forecast_net)}`}
          strong
        >
          {formatEuro(budget.expected_net)}
        </Tile>
        <Tile
          label="Abweichung zum Budget"
          note={`${budget.deviation > 0 ? "über Budget" : "Rest"} · Prognose = ${formatPercent(
            budget.amount > 0 ? (budget.expected_net / budget.amount) * 100 : 0,
          )} des Budgets`}
        >
          <span className={budget.deviation > 0.005 ? "text-red-700" : "text-emerald-700"}>{signed(budget.deviation)}</span>
        </Tile>
      </dl>
    </>
  );
}

/** Wann das Budget laut Prognose aufgebraucht ist (für den laufenden Monat). */
function BudgetEndTile({ budget, month }: { budget: BudgetStatus; month: string }) {
  const period = `Budget ${formatMonth(budget.from)} – ${formatMonth(budget.to)}`;
  if (budget.exceeded) {
    return (
      <Tile label="Budget" note={`${formatEuro(budget.actual_net - budget.amount)} über Budget · ${period}`}>
        <span className="text-red-700">bereits überschritten</span>
      </Tile>
    );
  }
  if (budget.exhausted_on) {
    const thisMonth = budget.exhausted_on.startsWith(month);
    return (
      <Tile label="Budget aufgebraucht am" note={`laut Prognose${thisMonth ? " – noch in diesem Monat" : ""} · ${period}`}>
        <span className={thisMonth ? "text-red-700" : ""}>{formatDate(budget.exhausted_on)}</span>
      </Tile>
    );
  }
  return (
    <Tile label="Budget reicht laut Prognose" note={`Rest ${formatEuro(-budget.deviation)} · ${period}`}>
      bis Ende {formatMonth(budget.to)}
    </Tile>
  );
}

function MonthTable({
  months,
  budget,
  dataEnd,
  forecastFrom,
}: {
  months: Forecast["months"];
  budget: BudgetStatus | null;
  dataEnd: string;
  /** Erster Prognosetag (Tag nach dem Stand der Daten). */
  forecastFrom: string;
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
            // Monat mit dem Stand der Daten: abgerechnet bis dahin, Prognose ab dem Tag danach
            const transition = m.month === dataEnd.slice(0, 7) && dataEnd < monthEnd(m.month);
            return (
              <tr key={m.month} className={future ? "text-slate-600" : ""}>
                <td className={styles.td}>
                  {formatMonth(m.month)}
                  {transition && (
                    <span className="block text-xs text-slate-500">
                      abgerechnet bis {formatDate(dataEnd)} · Prognose ab {formatDate(forecastFrom)}
                    </span>
                  )}
                </td>
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

const signedPercent = (v: number | null) =>
  v === null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${formatPercent(Math.abs(v) * 100)}`;

/** Prognosegüte: nachgerechnete und gespeicherte Prognosen gegenüber dem Ist. */
function AccuracySection({ months }: { months: AccuracyMonth[] }) {
  const backtest = accuracySummary(months, "backtest");
  const recorded = accuracySummary(months, "recorded");
  const tendency = (bias: number | null) =>
    bias === null ? "–" : `im Schnitt ${formatPercent(Math.abs(bias) * 100)} ${bias > 0 ? "zu hoch" : "zu niedrig"}`;
  return (
    <section className="space-y-3">
      <h3 className={styles.heading}>Prognosegüte</h3>
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Ø Abweichung (nachgerechnet)" note={`${backtest.count} abgeschlossene Monate`}>
          {backtest.meanError === null ? "–" : formatPercent(backtest.meanError * 100)}
        </Tile>
        <Tile label="Tendenz">{tendency(backtest.bias)}</Tile>
        <Tile label={`Treffer (± ${formatPercent(ACCURACY_HIT * 100)})`} note="Monate nah am Ist">
          {backtest.count ? `${backtest.hits} von ${backtest.count}` : "–"}
        </Tile>
        <Tile
          label="Gespeicherte Prognosen"
          note={recorded.count ? tendency(recorded.bias) : "Vergleich ab dem ersten abgeschlossenen Monat nach dem Speichern"}
        >
          {recorded.meanError === null ? "noch keine" : `Ø ${formatPercent(recorded.meanError * 100)}`}
        </Tile>
      </dl>
      <div className={styles.tableWrap}>
        <table className="w-full text-sm">
          <thead className={styles.thead}>
            <tr>
              <th className={styles.th}>Monat</th>
              <th className={styles.thNum}>Abgerechnet</th>
              <th className={styles.thNum}>Prognose zu Monatsbeginn</th>
              <th className={styles.thNum}>Abweichung</th>
              <th className={styles.thNum}>Gespeicherte Prognose</th>
              <th className={styles.thNum}>Abweichung</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {months.map((m) => {
              const own = deviation(m.backtest_net, m.actual_net);
              const saved = m.recorded_net === null ? null : deviation(m.recorded_net, m.actual_net);
              const tone = (d: number | null) =>
                d !== null && Math.abs(d) > ACCURACY_HIT + 1e-9 ? "font-semibold text-slate-900" : "";
              return (
                <tr key={m.month}>
                  <td className={styles.td}>{formatMonth(m.month)}</td>
                  <td className={styles.tdNum}>{formatEuro(m.actual_net)}</td>
                  <td className={styles.tdNum}>{formatEuro(m.backtest_net)}</td>
                  <td className={`${styles.tdNum} ${tone(own)}`}>{signedPercent(own)}</td>
                  <td className={styles.tdNum}>
                    {m.recorded_net === null ? (
                      <span className="text-slate-400">–</span>
                    ) : (
                      <>
                        {formatEuro(m.recorded_net)}
                        <span className="block text-xs text-slate-500">Stand {formatDate(m.recorded_on)}</span>
                      </>
                    )}
                  </td>
                  <td className={`${styles.tdNum} ${tone(saved)}`}>{signedPercent(saved)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        <strong>Nachgerechnet</strong>: Prognose mit dem Stand am Ende des Vormonats und der heutigen
        Konfiguration (geplante Abwesenheiten, Sätze). Große Abweichungen in Urlaubsmonaten zeigen,
        dass Urlaube nicht als geplante Abwesenheit eingetragen waren. <strong>Gespeichert</strong>:
        die App legt bei jeder Auswertung eines vollständigen Exports die Prognose im Ordner
        „Prognosen“ neben der Exe ab; verglichen wird die letzte vor Monatsbeginn.
      </p>
    </section>
  );
}
