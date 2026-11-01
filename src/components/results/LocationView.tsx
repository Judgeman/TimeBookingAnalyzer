import { useState } from "react";
import type { PeriodBreakdown } from "../../types/results";
import { formatHours, formatMonth, formatNumber, formatPercent } from "../../lib/format";
import { OTHER_LABEL, type ColorMap } from "./chartColors";
import { homeOfficeShares, toRows } from "./locationRows";
import { PieChart, type PieSlice } from "./PieChart";
import { styles } from "./styles";

interface Props {
  name: string;
  data: PeriodBreakdown;
  colorMap: ColorMap;
  isTeam: boolean;
}

const YEAR = "ytd";

/**
 * Arbeitsort-Auswertung: Anteile der gearbeiteten Stunden je Ort als Torte
 * plus Tabelle (genaue Werte) und Verlauf je Monat.
 */
export function LocationView({ name, data, colorMap, isTeam }: Props) {
  const [period, setPeriod] = useState<string>(YEAR);
  // Hervorhebung gilt nur für die Ansicht (Person + Zeitraum), in der sie entstand.
  const [hover, setHover] = useState<{ scope: string; key: string } | null>(null);

  const months = Object.keys(data.locations.by_month).filter(
    (m) => data.locations.by_month[m].length > 0,
  );
  const effective = period === YEAR || months.includes(period) ? period : YEAR;
  const shares =
    effective === YEAR ? data.locations.ytd : (data.locations.by_month[effective] ?? []);
  const rows = toRows(shares, colorMap);
  const total = rows.reduce((sum, r) => sum + r.hours, 0);
  const totalDays = rows.reduce((sum, r) => sum + r.days, 0);
  const periodLabel = effective === YEAR ? "Jahr bis Stichtag" : formatMonth(effective);
  const scope = `${name}|${effective}`;
  const active = hover?.scope === scope ? hover.key : null;
  const setActive = (key: string | null) => setHover(key === null ? null : { scope, key });
  const dayLabel = isTeam ? "Personentage" : "Tage";

  const homeOffice = homeOfficeShares(shares);
  const homeHours = homeOffice.reduce((sum, s) => sum + s.hours, 0);
  const homeDays = homeOffice.reduce((sum, s) => sum + s.days, 0);

  const slices: PieSlice[] = rows.map((r) => ({
    key: r.key,
    label: r.label,
    value: r.hours,
    share: r.share,
    color: r.color,
    detail: `${r.label}: ${formatHours(r.hours)} h · ${formatPercent(r.share)} · ${r.days} ${dayLabel}`,
  }));

  // Spalten des Monatsverlaufs: alle Farben der Auswertung in fester Reihenfolge.
  const columns = [...colorMap.colors.keys()];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Anteil der <strong>gearbeiteten Stunden</strong> (wie „Gearbeitet“: × Mult, ohne
          Urlaub/Krank) je Wert der Spalte „Ort“.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium text-slate-700">Zeitraum</span>
          <select
            value={effective}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value={YEAR}>Jahr bis Stichtag</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-600">
          Keine gearbeiteten Stunden im Zeitraum.
        </p>
      ) : (
        <>
          {homeOffice.length > 0 && (
            <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <dt className="truncate text-xs text-slate-500">
                  Home-Office-Anteil · {name} · {periodLabel}
                </dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatPercent(total > 0 ? (homeHours / total) * 100 : 0)}
                </dd>
                <dd className="text-xs text-slate-500">
                  {formatHours(homeHours)} h an {homeDays} {dayLabel} (
                  {homeOffice.map((s) => s.location).join(", ")})
                </dd>
              </div>
            </dl>
          )}

          <section className="grid items-center gap-6 rounded-xl border border-slate-200 bg-white p-5 lg:grid-cols-[minmax(0,340px)_1fr]">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-slate-800">
                Arbeitsorte · {name} · {periodLabel}
              </h3>
              <PieChart
                key={scope}
                slices={slices}
                active={active}
                onActive={setActive}
                ariaLabel={`Arbeitsorte ${name}, ${periodLabel}: ${rows
                  .map((r) => `${r.label} ${formatPercent(r.share)}`)
                  .join(", ")}`}
              />
            </div>

            <table className="w-full text-sm" onMouseLeave={() => setActive(null)}>
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className={styles.th}>Arbeitsort</th>
                  <th className={styles.thNum}>Stunden</th>
                  <th className={styles.thNum}>Anteil</th>
                  <th className="w-32 px-3 py-2" />
                  <th className={styles.thNum}>{dayLabel}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr
                    key={r.key}
                    onMouseEnter={() => setActive(r.key)}
                    className={`transition-opacity ${
                      active !== null && active !== r.key ? "opacity-50" : ""
                    }`}
                  >
                    <td className={styles.td}>
                      <span
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                        style={{ backgroundColor: r.color }}
                        aria-hidden
                      />
                      {r.label}
                      {r.key === OTHER_LABEL && (
                        <span className="ml-1 text-xs text-slate-500">
                          ({[...colorMap.folded].join(", ")})
                        </span>
                      )}
                    </td>
                    <td className={styles.tdNum}>{formatHours(r.hours)}</td>
                    <td className={styles.tdNum}>{formatPercent(r.share)}</td>
                    <td className="px-3 py-1.5">
                      <div className="h-1.5 w-full rounded-full bg-slate-100">
                        <div
                          className="h-1.5 rounded-full"
                          style={{ width: `${Math.min(100, r.share)}%`, backgroundColor: r.color }}
                        />
                      </div>
                    </td>
                    <td className={styles.tdNum}>{formatNumber(r.days)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 font-medium">
                <tr>
                  <td className={styles.td}>Gesamt (= Gearbeitet)</td>
                  <td className={styles.tdNum}>{formatHours(total)}</td>
                  <td className={styles.tdNum}>100 %</td>
                  <td />
                  <td className={styles.tdNum} title="Tage mit mehreren Orten zählen je Ort">
                    {formatNumber(totalDays)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
        </>
      )}

      {months.length > 0 && (
        <section>
          <h3 className={styles.heading}>Verlauf je Monat · {name}</h3>
          <div className={styles.tableWrap}>
            <table className="w-full text-sm">
              <thead className={styles.thead}>
                <tr>
                  <th className={styles.th}>Monat</th>
                  {columns.map((c) => (
                    <th key={c} className={styles.thNum}>
                      <span
                        className="mr-1.5 inline-block h-2 w-2 rounded-sm"
                        style={{ backgroundColor: colorMap.colors.get(c) }}
                        aria-hidden
                      />
                      {c}
                    </th>
                  ))}
                  <th className={styles.thNum}>Gearbeitet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {months.map((m) => {
                  const monthRows = toRows(data.locations.by_month[m], colorMap);
                  const monthTotal = monthRows.reduce((sum, r) => sum + r.hours, 0);
                  return (
                    <tr
                      key={m}
                      className={`cursor-pointer hover:bg-slate-50 ${
                        effective === m ? "bg-slate-50 font-medium" : ""
                      }`}
                      onClick={() => setPeriod(m)}
                    >
                      <td className={styles.td}>{formatMonth(m)}</td>
                      {columns.map((c) => {
                        const row = monthRows.find((r) => r.key === c);
                        return (
                          <td
                            key={c}
                            className={styles.tdNum}
                            title={row ? `${formatHours(row.hours)} h` : undefined}
                          >
                            {row ? formatPercent(row.share) : "–"}
                          </td>
                        );
                      })}
                      <td className={styles.tdNum}>{formatHours(monthTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Klick auf einen Monat zeigt ihn im Diagramm. Stunden im Tooltip der Prozentwerte.
          </p>
        </section>
      )}
    </div>
  );
}
