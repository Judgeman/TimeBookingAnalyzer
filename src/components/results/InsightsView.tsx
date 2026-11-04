import type { ReactNode } from "react";
import type { AuswertungResult, PeriodData } from "../../types/results";
import { formatEuro, formatHours, formatMonth, formatNumber, formatPercent } from "../../lib/format";
import { DeviationChart } from "./DeviationChart";
import {
  completedMonths,
  extremeMonth,
  insights,
  personPace,
  RECENT_MONTHS,
  teamPace,
  THRESHOLDS,
  type Extreme,
} from "./insights";
import { styles } from "./styles";

interface Props {
  result: AuswertungResult;
}

const pct = (v: number | null) => (v === null ? "–" : formatPercent(v * 100));
const signedHours = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatHours(Math.abs(v))} h`;
const signedEuro = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatEuro(Math.abs(v))}`;

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
  const hints = insights(pace, persons);

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

      <section>
        <h3 className={styles.heading}>Rekord-Monate (Team)</h3>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Record label="Meiste Krankheitstage" extreme={extremeMonth(result, (d) => d.sick_days)} unit={(v) => `${formatNumber(v)} Tage`} />
          <Record label="Meiste Urlaubstage" extreme={extremeMonth(result, (d) => d.vac_days)} unit={(v) => `${formatNumber(v)} Tage`} />
          <Record label="Meiste Überstunden" extreme={extremeMonth(result, (d) => d.plus)} unit={signedHours} />
          <Record label="Meiste Minusstunden" extreme={extremeMonth(result, (d) => d.plus, "min")} unit={signedHours} />
          <Record label="Meiste fehlende Buchungen" extreme={extremeMonth(result, (d) => d.missing_days)} unit={(v) => `${formatNumber(v)} Tage`} />
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
        {pace && pace.months.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-sm font-medium text-slate-700">Abruf je Monat gegenüber dem Richtwert</p>
            <DeviationChart months={pace.months} ariaLabel="Abweichung des Abrufs vom Richtwert je Monat" />
          </div>
        )}
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
                <th className={styles.thNum}>Krank · Urlaub</th>
                <th className={styles.thNum}>Fehlend</th>
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
                    {pct(p.sickRate)} · {formatNumber(p.vacationDays)} T
                  </td>
                  <td className={styles.tdNum} title="Tage mit fehlender Buchung">
                    {p.missingDays > 0 ? `${formatNumber(p.missingDays)} T` : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">Kennzahlen erklärt</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><strong>Pace (Team)</strong>: Ø abgerechnet je abgeschlossenem Monat im Verhältnis zum Richtwert (Budget ÷ Monate). Über {pct(THRESHOLDS.paceHigh)} → Hinweis „Überziehung“, unter {pct(THRESHOLDS.paceLow)} → „liegen gelassen“.</li>
          <li><strong>Nötig je Restmonat</strong>: (Budget − bisher abgerechnet) ÷ offene Monate – so viel darf je Monat noch abgerufen werden, um genau im Budget zu landen.</li>
          <li><strong>Abrechnungsquote</strong>: abrechenbare Stunden ÷ Soll netto; über 100 % = mehr abgerechnet als vertraglich verfügbar (Überstunden). Hinweis, wenn die letzten {RECENT_MONTHS} Monate {pct(THRESHOLDS.utilizationDrop)}-Punkte unter dem Jahr liegen.</li>
          <li><strong>€ je gearbeitete Stunde</strong>: abgerechnet ÷ gearbeitet – sinkt, wenn viel nicht abrechenbare Arbeit anfällt.</li>
          <li><strong>Überstunden</strong>: gearbeitet − Soll netto. Hinweis über +{THRESHOLDS.overtimeHigh} h bzw. unter {THRESHOLDS.overtimeLow} h.</li>
          <li><strong>Krankenquote</strong>: krank ÷ Soll brutto (Hinweis über {pct(THRESHOLDS.sickRate)}); nicht abrechenbarer Anteil aus der Prognose (Hinweis über {pct(THRESHOLDS.distraction)}).</li>
        </ul>
      </details>
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
