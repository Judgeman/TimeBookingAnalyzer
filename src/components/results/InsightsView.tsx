import { useState, type ReactNode } from "react";
import type { AuswertungResult, BudgetStatus, PeriodData } from "../../types/results";
import {
  formatDate,
  formatDateWithWeekday,
  formatEuro,
  formatHours,
  formatMonth,
  formatNumber,
  formatPercent,
} from "../../lib/format";
import { DeviationChart } from "./DeviationChart";
import { activeBudgetIndex, dataEndOf, monthEnd } from "./forecast";
import {
  completedMonths,
  currentMissing,
  extremeMonth,
  insights,
  personPace,
  RECENT_MONTHS,
  selectedBudgetMonths,
  teamPace,
  THRESHOLDS,
  vacationInsights,
  type BudgetSelection,
  type Extreme,
} from "./insights";
import { styles } from "./styles";

interface Props {
  result: AuswertungResult;
}

const pct = (v: number | null) => (v === null ? "–" : formatPercent(v * 100));
const signedHours = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatHours(Math.abs(v))} h`;
const signedEuro = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatEuro(Math.abs(v))}`;
const budgetLabel = (b: BudgetStatus) => `${formatMonth(b.from)} – ${formatMonth(b.to)} · ${formatEuro(b.amount)}`;

/** Trend „zuletzt“ gegenüber dem Jahr (±5 Prozentpunkte gelten als gleich). */
function Trend({ year, recent }: { year: number | null; recent: number | null }) {
  if (year === null || recent === null) return null;
  const delta = recent - year;
  const [arrow, label] = delta > 0.05 ? ["↗", "steigend"] : delta < -0.05 ? ["↘", "fallend"] : ["→", "gleichbleibend"];
  return (
    <span className="ml-1 text-slate-500" title={label} aria-label={label}>
      {arrow}
    </span>
  );
}

/** Insights: Rekord-Monate, Tempo (Pace) von Team und Personen, Hinweise. */
export function InsightsView({ result }: Props) {
  const months = completedMonths(result);
  const pace = teamPace(result);
  const persons = personPace(result);
  const hints = [
    ...insights(pace, persons),
    ...vacationInsights(result.vacation, dataEndOf(result.forecast)),
  ];

  if (months.length === 0) {
    return (
      <p className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-600">
        Noch kein abgeschlossener Monat – Insights gibt es ab dem ersten vollständigen Monat.
      </p>
    );
  }

  const team = months.map((m) => result.team.by_month[m]);
  const recentTeam = team.slice(-RECENT_MONTHS);
  const quota = (data: PeriodData[]) => {
    const soll = data.reduce((s, d) => s + d.soll_n, 0);
    return soll > 0 ? data.reduce((s, d) => s + d.bill_h, 0) / soll : null;
  };
  const invoiced = result.forecast.months.filter((m) => months.includes(m.month));
  const highest = invoiced.reduce((a, b) => (b.actual_net > a.actual_net ? b : a), invoiced[0]);
  const lowest = invoiced.reduce((a, b) => (b.actual_net < a.actual_net ? b : a), invoiced[0]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Grundlage: abgeschlossene Monate {formatMonth(months[0])} – {formatMonth(months[months.length - 1])}
        {" "}(der laufende Monat zählt erst, wenn er vollständig ist).
      </p>

      {hints.length > 0 && (
        <section aria-label="Hinweise" className="space-y-2">
          {hints.map((h) => (
            <p
              key={h.text}
              className={`rounded-md px-4 py-2 text-sm ${
                h.level === "warning" ? "bg-amber-50 text-amber-950" : "bg-sky-50 text-sky-950"
              }`}
            >
              <span aria-hidden className="mr-1.5">{h.level === "warning" ? "⚠" : "ℹ"}</span>
              <span className="sr-only">{h.level === "warning" ? "Achtung: " : "Hinweis: "}</span>
              {h.text}
            </p>
          ))}
        </section>
      )}

      <CurrentMissingSection result={result} />

      <section>
        <h3 className={styles.heading}>Rekord-Monate (Team)</h3>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Record label="Meiste Krankheitstage" extreme={extremeMonth(result, (d) => d.sick_days)} unit={(v) => `${formatNumber(v)} Tage`} />
          <Record label="Meiste Urlaubstage" extreme={extremeMonth(result, (d) => d.vac_days)} unit={(v) => `${formatNumber(v)} Tage`} />
          <Record label="Meiste Überstunden" extreme={extremeMonth(result, (d) => d.plus)} unit={signedHours} />
          <Record label="Meiste Minusstunden" extreme={extremeMonth(result, (d) => d.plus, "min")} unit={signedHours} />
          <Record label="Meiste Minusstunden (Krank = Fehlzeit)" extreme={extremeMonth(result, (d) => d.plus_krank, "min")} unit={signedHours} />
          {pace ? (
            <>
              <Tile label="Meistes Budget liegen gelassen">
                {pace.mostLeft ? (
                  <MonthValue month={pace.mostLeft.month} value={signedEuro(pace.mostLeft.diff)} note={`${formatEuro(pace.mostLeft.actual)} statt ${formatEuro(pace.mostLeft.target)}`} />
                ) : (
                  <Empty>kein Monat unter dem Richtwert</Empty>
                )}
              </Tile>
              <Tile label="Meistes Budget abgerufen">
                {pace.mostUsed ? (
                  <MonthValue month={pace.mostUsed.month} value={signedEuro(pace.mostUsed.diff)} note={`${formatEuro(pace.mostUsed.actual)} statt ${formatEuro(pace.mostUsed.target)}`} />
                ) : (
                  <Empty>kein Monat über dem Richtwert</Empty>
                )}
              </Tile>
            </>
          ) : (
            <>
              <Tile label="Höchster Abruf">
                <MonthValue month={highest.month} value={formatEuro(highest.actual_net)} />
              </Tile>
              <Tile label="Niedrigster Abruf">
                <MonthValue month={lowest.month} value={formatEuro(lowest.actual_net)} />
              </Tile>
            </>
          )}
        </dl>
      </section>

      <section className="space-y-4">
        <h3 className={styles.heading}>Pace des Teams</h3>
        {pace && result.forecast.budgets.length > 1 && (
          <p className="text-sm text-slate-600">Bezogen auf das aktuelle Budget {budgetLabel(pace.budget)}.</p>
        )}
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {pace && (
            <>
              <Tile label="Ø Abruf je Monat" note={`${pct(pace.ratio)} des Richtwerts (${formatEuro(pace.budget.monthly_target)})`}>
                {pace.average === null ? "–" : formatEuro(pace.average)}
              </Tile>
              <Tile label={`Ø letzte ${RECENT_MONTHS} Monate`} note={`${pct(pace.recentRatio)} des Richtwerts`}>
                {pace.recentAverage === null ? "–" : formatEuro(pace.recentAverage)}
                <Trend year={pace.ratio} recent={pace.recentRatio} />
              </Tile>
              <Tile
                label={`Nötig je Restmonat (${pace.remainingMonths})`}
                note={pace.forecastPerMonth === null ? "Budget-Zeitraum abgeschlossen" : `Prognose: ${formatEuro(pace.forecastPerMonth)} je Monat`}
              >
                {pace.neededPerMonth === null ? "–" : formatEuro(pace.neededPerMonth)}
              </Tile>
            </>
          )}
          <Tile label="Abrechnungsquote Team" note={`zuletzt ${pct(quota(recentTeam))} (${RECENT_MONTHS} Monate)`}>
            {pct(quota(team))}
            <Trend year={quota(team)} recent={quota(recentTeam)} />
          </Tile>
        </dl>
        {pace && <BudgetDeviation result={result} />}
      </section>

      <section>
        <h3 className={styles.heading}>Pace je Person</h3>
        <div className={styles.tableWrap}>
          <table className="w-full text-sm">
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>Person</th>
                <th className={styles.thNum} title="Abrechenbare Stunden ÷ Soll netto (Arbeitszeit ohne Urlaub/Krank)">Abrechnungsquote</th>
                <th className={styles.thNum}>zuletzt ({RECENT_MONTHS} M.)</th>
                <th className={styles.thNum}>Ø abgerechnet / Monat</th>
                <th className={styles.thNum} title="Abgerechnet (€) ÷ gearbeitete Stunden">€ je gearb. Stunde</th>
                <th className={styles.thNum}>Überstunden</th>
                <th className={styles.thNum} title="Saldo, wenn Krankheit als Fehlzeit zählt: gearbeitet − (Soll brutto − Urlaub)">
                  Krank = Fehlzeit
                </th>
                <th className={styles.thNum}>Krank · Urlaub</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {persons.map((p) => (
                <tr key={p.name} className={p.activeMonths === 0 ? "text-slate-400" : ""}>
                  <td className={styles.td}>
                    {p.name}
                    <span className="ml-2 text-xs text-slate-400">{p.activeMonths} M.</span>
                  </td>
                  <td className={styles.tdNum}>{pct(p.utilization)}</td>
                  <td className={styles.tdNum}>
                    {pct(p.recentUtilization)}
                    <Trend year={p.utilization} recent={p.recentUtilization} />
                  </td>
                  <td className={styles.tdNum}>{p.averageInvoiced === null ? "–" : formatEuro(p.averageInvoiced)}</td>
                  <td className={styles.tdNum}>{p.effectiveRate === null ? "–" : formatEuro(p.effectiveRate)}</td>
                  <td className={styles.tdNum}>
                    <span className={p.overtime > THRESHOLDS.overtimeHigh || p.overtime < THRESHOLDS.overtimeLow ? "font-semibold text-slate-900" : ""}>
                      {signedHours(p.overtime)}
                    </span>
                    <span className="block text-xs text-slate-500">zuletzt {signedHours(p.recentOvertime)}</span>
                  </td>
                  <td className={styles.tdNum}>
                    <span className={p.overtimeSick < THRESHOLDS.overtimeLow ? "font-semibold text-slate-900" : ""}>
                      {signedHours(p.overtimeSick)}
                    </span>
                    <span className="block text-xs text-slate-500">zuletzt {signedHours(p.recentOvertimeSick)}</span>
                  </td>
                  <td className={styles.tdNum}>
                    {pct(p.sickRate)} · {formatNumber(p.vacationDays)} T
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <VacationSection result={result} />

      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">Kennzahlen erklärt</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><strong>Pace (Team)</strong>: Ø abgerechnet je abgeschlossenem Monat im Verhältnis zum Richtwert (Budget ÷ Monate). Über {pct(THRESHOLDS.paceHigh)} → Hinweis „Überziehung“, unter {pct(THRESHOLDS.paceLow)} → „liegen gelassen“.</li>
          <li><strong>Nötig je Restmonat</strong>: (Budget − bisher abgerechnet) ÷ offene Monate – so viel darf je Monat noch abgerufen werden, um genau im Budget zu landen.</li>
          <li><strong>Abrechnungsquote</strong>: abrechenbare Stunden ÷ Soll netto; über 100 % = mehr abgerechnet als vertraglich verfügbar (Überstunden). Hinweis, wenn die letzten {RECENT_MONTHS} Monate {pct(THRESHOLDS.utilizationDrop)}-Punkte unter dem Jahr liegen.</li>
          <li><strong>€ je gearbeitete Stunde</strong>: abgerechnet ÷ gearbeitet – sinkt, wenn viel nicht abrechenbare Arbeit anfällt.</li>
          <li><strong>Überstunden</strong>: gearbeitet − Soll netto. Hinweis über +{THRESHOLDS.overtimeHigh} h bzw. unter {THRESHOLDS.overtimeLow} h.</li>
          <li><strong>Krank = Fehlzeit</strong>: Saldo, wenn Krankheit nicht als Arbeitszeit angerechnet wird (Überstunden − Krankheitsstunden). Hinweis unter {THRESHOLDS.overtimeLow} h.</li>
          <li><strong>Fehlende Buchungen aktuell</strong>: Werktage bis zum Vortag des Exports, an denen weniger als die Schwelle des Projekts gebucht ist – unabhängig vom Stichtag.</li>
          <li><strong>Resturlaub</strong>: Anspruch + Übertrag − genommen (bis Stichtag) − geplant (geplante Urlaube nach dem Stand der Daten). Hinweis, wenn in den letzten {THRESHOLDS.vacationMonthsLeft} Monaten noch mindestens {THRESHOLDS.vacationOpenDays} Tage offen sind.</li>
          <li><strong>Krankenquote</strong>: krank ÷ Soll brutto (Hinweis über {pct(THRESHOLDS.sickRate)}); nicht abrechenbarer Anteil aus der Prognose (Hinweis über {pct(THRESHOLDS.distraction)}).</li>
        </ul>
      </details>
    </div>
  );
}

/** Wer aktuell (bis zum Vortag des Exports) die meisten Tage ohne Buchung hat. */
function CurrentMissingSection({ result }: { result: AuswertungResult }) {
  const current = result.missing_current;
  if (!current) return null;
  const persons = currentMissing(current.bookings);
  const SHOWN = 6;
  return (
    <section>
      <h3 className={styles.heading}>Fehlende Buchungen aktuell</h3>
      <p className="mb-2 text-sm text-slate-600">
        Bis {formatDate(current.checked_until)} (Vortag des Exports) – unabhängig vom Stichtag; Werktage mit
        weniger als {formatNumber(result.missing_threshold_percent)} % der Soll-Stunden gebucht.
      </p>
      {persons.length === 0 ? (
        <p className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-600">
          Alles gebucht bis {formatDate(current.checked_until)}.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className="w-full text-sm">
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>Person</th>
                <th className={styles.thNum}>Tage</th>
                <th className={styles.thNum}>offen</th>
                <th className={styles.th}>fehlt am (neueste zuerst)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {persons.map((p, i) => (
                <tr key={p.name}>
                  <td className={`${styles.td} ${i === 0 ? "font-semibold" : ""}`}>{p.name}</td>
                  <td className={`${styles.tdNum} ${i === 0 ? "font-semibold" : ""}`}>{p.dates.length}</td>
                  <td className={styles.tdNum}>{formatHours(p.hours)} h</td>
                  <td className={`${styles.td} text-slate-600`}>
                    {p.dates.slice(0, SHOWN).map(formatDateWithWeekday).join(" · ")}
                    {p.dates.length > SHOWN && ` · +${p.dates.length - SHOWN} weitere`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Abruf je Monat gegenüber dem Richtwert – wählbar: ein Budget (Standard: das
 * aktuelle), alle Budgets oder ein eigener Zeitraum.
 */
function BudgetDeviation({ result }: { result: AuswertungResult }) {
  const { budgets } = result.forecast;
  const dataEnd = dataEndOf(result.forecast);
  const lastCompleted = result.forecast.months.filter((m) => monthEnd(m.month) <= dataEnd).at(-1)?.month;
  const [mode, setMode] = useState(`budget:${activeBudgetIndex(result.forecast)}`);
  const [range, setRange] = useState({
    from: budgets.reduce((a, b) => (b.from < a ? b.from : a), budgets[0].from),
    to: lastCompleted ?? budgets[0].to,
  });
  const selection: BudgetSelection =
    mode === "all"
      ? { kind: "all" }
      : mode === "range"
        ? { kind: "range", ...range }
        : { kind: "budget", index: Number(mode.slice("budget:".length)) };
  const months = selectedBudgetMonths(result, selection);
  const actual = months.reduce((s, m) => s + m.actual, 0);
  const target = months.reduce((s, m) => s + m.target, 0);
  const input = "rounded-md border border-slate-300 px-2 py-1 text-sm";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">Abruf je Monat gegenüber dem Richtwert</p>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Zeitraum des Diagramms" value={mode} onChange={(e) => setMode(e.target.value)} className={input}>
            {budgets.map((b, i) => (
              <option key={b.from} value={`budget:${i}`}>
                Budget {budgetLabel(b)}
              </option>
            ))}
            {budgets.length > 1 && <option value="all">Alle Budgets</option>}
            <option value="range">Eigener Zeitraum …</option>
          </select>
          {mode === "range" && (
            <>
              <input
                type="month"
                aria-label="Zeitraum von"
                value={range.from}
                max={range.to}
                onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })}
                className={input}
              />
              <span className="text-slate-400">–</span>
              <input
                type="month"
                aria-label="Zeitraum bis"
                value={range.to}
                min={range.from}
                onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })}
                className={input}
              />
            </>
          )}
        </div>
      </div>
      {months.length === 0 ? (
        <p className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-600">
          Keine abgeschlossenen Monate mit Budget in diesem Zeitraum.
        </p>
      ) : (
        <>
          <DeviationChart months={months} ariaLabel="Abweichung des Abrufs vom Richtwert je Monat" />
          <p className="mt-2 text-xs text-slate-600">
            {months.length} {months.length === 1 ? "Monat" : "Monate"} ({formatMonth(months[0].month)} –{" "}
            {formatMonth(months[months.length - 1].month)}): {formatEuro(actual)} abgerufen, Richtwert{" "}
            {formatEuro(target)} → <strong className="text-slate-900">{signedEuro(actual - target)}</strong>
            {target > 0 && ` (${pct(actual / target)} des Richtwerts)`}
            {mode === "range" && " · Monate ohne Budget haben keinen Richtwert und fehlen."}
          </p>
        </>
      )}
    </div>
  );
}

function Record({ label, extreme, unit }: { label: string; extreme: Extreme | null; unit: (v: number) => string }) {
  return (
    <Tile label={label}>
      {extreme ? (
        <MonthValue
          month={extreme.month}
          value={unit(extreme.value)}
          note={extreme.persons.map((p) => `${p.name} ${unit(p.value)}`).join(" · ")}
        />
      ) : (
        <Empty>keine</Empty>
      )}
    </Tile>
  );
}

function MonthValue({ month, value, note }: { month: string; value: string; note?: string }) {
  return (
    <>
      <span className="block">{formatMonth(month)}</span>
      <span className="block text-base font-medium text-slate-700">{value}</span>
      {note && <span className="mt-0.5 block text-xs font-normal text-slate-500">{note}</span>}
    </>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <span className="text-base font-normal text-slate-400">{children}</span>;
}

function Tile({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-xl font-semibold">{children}</dd>
      {note && <dd className="mt-0.5 text-xs text-slate-500">{note}</dd>}
    </div>
  );
}

/** Resturlaub je Person (nur mit hinterlegtem Anspruch). */
function VacationSection({ result }: { result: AuswertungResult }) {
  const year = result.cutoff_date.slice(0, 4);
  const without = result.persons
    .map((p) => p.name)
    .filter((name) => !result.vacation.some((v) => v.person === name));
  return (
    <section>
      <h3 className={styles.heading}>Urlaub {year}</h3>
      {result.vacation.length === 0 ? (
        <p className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-600">
          Kein Urlaubsanspruch hinterlegt – unter „Projekt bearbeiten“ → Team je Person den
          Anspruch eintragen, um den Resturlaub zu sehen.
        </p>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className="w-full text-sm">
              <thead className={styles.thead}>
                <tr>
                  <th className={styles.th}>Person</th>
                  <th className={styles.thNum}>Anspruch</th>
                  <th className={styles.thNum}>Übertrag</th>
                  <th className={styles.thNum}>genommen</th>
                  <th className={styles.thNum}>geplant</th>
                  <th className={styles.thNum}>Rest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.vacation.map((v) => (
                  <tr key={v.person}>
                    <td className={styles.td}>{v.person}</td>
                    <td className={styles.tdNum}>{formatNumber(v.entitlement)} T</td>
                    <td className={styles.tdNum}>{formatNumber(v.carry_over)} T</td>
                    <td className={styles.tdNum}>{formatNumber(v.taken)} T</td>
                    <td className={styles.tdNum}>{v.planned ? `${formatNumber(v.planned)} T` : "–"}</td>
                    <td className={`${styles.tdNum} font-semibold ${v.remaining < 0 ? "text-red-700" : "text-slate-900"}`}>
                      {formatNumber(v.remaining)} T
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {without.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">Ohne Urlaubsanspruch {year}: {without.join(", ")}</p>
          )}
        </>
      )}
    </section>
  );
}
