import type { PeriodData } from "../../types/results";
import { METRICS, formatMetric, metricTone } from "./metrics";
import { styles } from "./styles";

interface Props {
  columns: { name: string; data: PeriodData }[];
}

/** Jahresübersicht bis Stichtag: Kennzahlen als Zeilen, Personen als Spalten. */
export function YearView({ columns }: Props) {
  return (
    <div className={styles.tableWrap}>
      <table className="w-full text-sm">
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Kennzahl</th>
            {columns.map((c, i) => (
              <th
                key={c.name}
                className={`${styles.thNum} ${i === columns.length - 1 ? "bg-slate-100" : ""}`}
              >
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {METRICS.map((metric) => (
            <tr
              key={metric.key}
              className={
                metric.key === "soll_n" || metric.key === "plus" ? "border-t-2 border-slate-200" : ""
              }
            >
              <td className={styles.td} title={metric.help}>
                <span className="cursor-help border-b border-dotted border-slate-300">
                  {metric.label}
                </span>
              </td>
              {columns.map((c, i) => (
                <td
                  key={c.name}
                  className={`${styles.tdNum} ${metricTone(metric, c.data[metric.key])} ${
                    i === columns.length - 1 ? "bg-slate-50 font-medium" : ""
                  }`}
                >
                  {formatMetric(metric, c.data[metric.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
