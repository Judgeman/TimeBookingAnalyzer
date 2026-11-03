import type { ReactNode } from "react";
import type { InvoiceMonth, InvoiceSummary, VatGroup } from "../../types/results";
import { formatDate, formatEuro, formatHours, formatMonth, formatNumber } from "../../lib/format";
import { styles } from "./styles";

interface Props {
  invoice: InvoiceSummary;
  /** Teammitglieder in Konfigurations-Reihenfolge (Spalten der Übersicht). */
  persons: string[];
  cutoffDate: string;
}

const vatText = (percent: number) => `USt. ${formatNumber(percent)} %`;

/** "USt. 19 %" oder bei mehreren Sätzen "USt. 7 % / 19 %". */
function vatLabelOf(groups: VatGroup[], fallback: number): string {
  if (groups.length <= 1) return vatText(groups[0]?.vat_percent ?? fallback);
  return `USt. ${groups.map((g) => `${formatNumber(g.vat_percent)} %`).join(" / ")}`;
}

/**
 * Rechnungsübersicht: pro Monat eine Rechnung. Netto je Position = Stunden ×
 * Satz, USt. je Steuersatz auf die Monats-Nettosumme, Brutto = Netto + USt.
 */
export function InvoiceView({ invoice, persons, cutoffDate }: Props) {
  const vatLabel = vatLabelOf(invoice.total.vat_groups, invoice.vat_percent);

  if (invoice.months.length === 0) {
    return (
      <p className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-600">
        Bis zum Stichtag gibt es keine abrechenbaren Stunden auf dem Projekt-Element.
      </p>
    );
  }

  const netOf = (month: InvoiceMonth, person: string) =>
    month.lines.filter((l) => l.person === person).reduce((sum, l) => sum + l.net, 0);
  const personTotal = (person: string) =>
    invoice.months.reduce((sum, m) => sum + netOf(m, person), 0);

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card label={`Netto gesamt bis ${formatDate(cutoffDate)}`} strong>
          {formatEuro(invoice.total.net)}
        </Card>
        <Card label={vatLabel}>
          {formatEuro(invoice.total.vat)}
          {invoice.total.vat_groups.length > 1 && (
            <span className="mt-1 block text-xs font-normal text-slate-500">
              {invoice.total.vat_groups
                .map((g) => `${formatNumber(g.vat_percent)} %: ${formatEuro(g.vat)}`)
                .join(" · ")}
            </span>
          )}
        </Card>
        <Card label="Brutto gesamt">{formatEuro(invoice.total.gross)}</Card>
        <Card label="Abgerechnete Stunden">{formatHours(invoice.total.hours)}</Card>
      </dl>

      <section>
        <h3 className={styles.heading}>Netto pro Person und Monat</h3>
        <div className={styles.tableWrap}>
          <table className="w-full text-sm">
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>Monat</th>
                {persons.map((p) => (
                  <th key={p} className={styles.thNum}>
                    {p}
                  </th>
                ))}
                <th className={`${styles.thNum} bg-slate-100`}>Netto</th>
                <th className={styles.thNum}>USt.</th>
                <th className={styles.thNum}>Brutto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoice.months.map((month) => (
                <tr key={month.month}>
                  <td className={styles.td}>
                    {formatMonth(month.month)}
                    {month.partial && <PartialBadge cutoffDate={cutoffDate} />}
                  </td>
                  {persons.map((p) => (
                    <td key={p} className={styles.tdNum}>
                      {formatEuro(netOf(month, p))}
                    </td>
                  ))}
                  <td className={`${styles.tdNum} bg-slate-50 font-semibold text-slate-900`}>
                    {formatEuro(month.net)}
                  </td>
                  <td className={styles.tdNum}>{formatEuro(month.vat)}</td>
                  <td className={`${styles.tdNum} text-slate-500`}>{formatEuro(month.gross)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-medium">
              <tr>
                <td className={styles.td}>Gesamt</td>
                {persons.map((p) => (
                  <td key={p} className={styles.tdNum}>
                    {formatEuro(personTotal(p))}
                  </td>
                ))}
                <td className={`${styles.tdNum} font-semibold text-slate-900`}>
                  {formatEuro(invoice.total.net)}
                </td>
                <td className={styles.tdNum}>{formatEuro(invoice.total.vat)}</td>
                <td className={`${styles.tdNum} font-normal text-slate-500`}>
                  {formatEuro(invoice.total.gross)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className={styles.heading}>Rechnungspositionen je Monat</h3>
        {[...invoice.months].reverse().map((month, i) => (
          <details
            key={month.month}
            open={i === 0}
            className="group rounded-xl border border-slate-200 bg-white"
          >
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm">
              <span className="font-medium">
                <span className="mr-2 inline-block text-slate-400 group-open:rotate-90">▸</span>
                {formatMonth(month.month)}
                {month.partial && <PartialBadge cutoffDate={cutoffDate} />}
              </span>
              <span className="tabular-nums text-slate-600">
                {formatHours(month.hours)} h · netto{" "}
                <span className="font-semibold text-slate-900">{formatEuro(month.net)}</span> ·
                brutto {formatEuro(month.gross)}
              </span>
            </summary>
            <MonthLines month={month} />
          </details>
        ))}
      </section>
    </div>
  );
}

function MonthLines({ month }: { month: InvoiceMonth }) {
  const multipleVat = month.vat_groups.length > 1;
  return (
    <div className="overflow-x-auto border-t border-slate-200">
      <table className="w-full text-sm">
        <thead className={styles.thead}>
          <tr>
            <th className={styles.th}>Person</th>
            <th className={styles.th}>Leistung</th>
            <th className={styles.thNum}>Stunden</th>
            <th className={styles.thNum}>Satz</th>
            <th className={styles.thNum}>USt.</th>
            <th className={styles.thNum}>Netto</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {month.lines.map((line, i) => (
            <tr key={i}>
              <td className={styles.td}>{line.person}</td>
              <td className={styles.td}>{line.service}</td>
              <td className={styles.tdNum}>{formatHours(line.hours)}</td>
              <td className={styles.tdNum}>
                {line.rate === null ? (
                  <span className="text-red-700">kein Satz hinterlegt</span>
                ) : (
                  <>
                    {formatEuro(line.rate)}
                    {line.rate_percent !== 100 && line.base_rate !== null && (
                      <span className="ml-1 text-xs text-slate-500">
                        ({formatNumber(line.rate_percent)} % von {formatEuro(line.base_rate)})
                      </span>
                    )}
                  </>
                )}
              </td>
              <td className={styles.tdNum}>{formatNumber(line.vat_percent)} %</td>
              <td className={styles.tdNum}>{formatEuro(line.net)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-slate-200 bg-slate-50">
          <TotalRow
            label="Netto"
            value={formatEuro(month.net)}
            hours={formatHours(month.hours)}
            strong
          />
          {month.vat_groups.map((g) => (
            <TotalRow
              key={g.vat_percent}
              label={`zzgl. ${vatText(g.vat_percent)}${multipleVat ? ` auf ${formatEuro(g.net)}` : ""}`}
              value={formatEuro(g.vat)}
            />
          ))}
          <TotalRow label="Brutto" value={formatEuro(month.gross)} muted />
        </tfoot>
      </table>
    </div>
  );
}

function TotalRow({
  label,
  value,
  hours,
  strong,
  muted,
}: {
  label: string;
  value: string;
  hours?: string;
  /** Hervorgehoben (Netto – wir rechnen netto ab). */
  strong?: boolean;
  /** Zurückhaltend (Brutto). */
  muted?: boolean;
}) {
  return (
    <tr className={strong ? "font-semibold text-slate-900" : muted ? "text-slate-500" : ""}>
      <td className={styles.td} colSpan={2}>
        {label}
      </td>
      <td className={styles.tdNum}>{hours ?? ""}</td>
      <td colSpan={2} />
      <td className={styles.tdNum}>{value}</td>
    </tr>
  );
}

function PartialBadge({ cutoffDate }: { cutoffDate: string }) {
  return (
    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800">
      bis {formatDate(cutoffDate)}
    </span>
  );
}

function Card({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        strong ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white"
      }`}
    >
      <dt className={`truncate text-xs ${strong ? "text-slate-300" : "text-slate-500"}`}>{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{children}</dd>
    </div>
  );
}
