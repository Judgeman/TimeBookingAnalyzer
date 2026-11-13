import type { ReactNode } from "react";
import type { CatchUp, PeriodBreakdown, PeriodData } from "../../types/results";
import {
  formatHours,
  formatMonth,
  formatNumber,
  formatPercent,
  formatSignedHours,
} from "../../lib/format";
import { PersonCatchUp, TeamCatchUp } from "./CatchUpView";
import { styles } from "./styles";

interface Props {
  name: string;
  data: PeriodBreakdown;
  catchUp: CatchUp;
  /** Name der Person; `null` = Team. */
  person: string | null;
}

/** Zu leisten, wenn Krankheit als Fehlzeit zählt (nur Urlaub wird angerechnet). */
const dueSickAsAbsence = (d: PeriodData) => d.soll_b - d.vac_h;

const tone = (value: number) =>
  value > 0.004 ? "text-emerald-700" : value < -0.004 ? "text-red-700" : "";

const fulfilment = (worked: number, due: number) =>
  due > 0 ? formatPercent((worked / due) * 100) : "–";

/**
 * Vertragsabgleich: vertraglich geschuldete Stunden vs. tatsächlich gearbeitet.
 * Urlaub/Krank werden als ganzer oder halber Standard-Tag (h/Tag der Person)
 * angerechnet. Variante 2 zählt Krankheit als Fehlzeit (z. B. für Bonus-Kalkulation).
 */
export function AccountView({ name, data, catchUp, person }: Props) {
  const ytd = data.ytd;
  const months = Object.entries(data.by_month);
  let cumulative = 0;
  let cumulativeSick = 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <Balance
          title="Urlaub & Krankheit angerechnet"
          subtitle="Vertragsabgleich"
          rows={[
            ["Vertragliche Stunden (Soll brutto)", formatHours(ytd.soll_b)],
            [`− Urlaub (${formatNumber(ytd.vac_days)} Tage)`, formatHours(ytd.vac_h)],
            [`− Krankheit (${formatNumber(ytd.sick_days)} Tage)`, formatHours(ytd.sick_h)],
            ["= Zu leisten", formatHours(ytd.soll_n)],
            ["Tatsächlich gearbeitet", formatHours(ytd.gearb)],
          ]}
          balance={ytd.plus}
          fulfilment={fulfilment(ytd.gearb, ytd.soll_n)}
          name={name}
        />
        <Balance
          title="Krankheit als Fehlzeit"
          subtitle="z. B. für die Bonus-Kalkulation"
          rows={[
            ["Vertragliche Stunden (Soll brutto)", formatHours(ytd.soll_b)],
            [`− Urlaub (${formatNumber(ytd.vac_days)} Tage)`, formatHours(ytd.vac_h)],
            [
              `Krankheit (${formatNumber(ytd.sick_days)} Tage) – nicht angerechnet`,
              formatHours(ytd.sick_h),
            ],
            ["= Zu leisten", formatHours(dueSickAsAbsence(ytd))],
            ["Tatsächlich gearbeitet", formatHours(ytd.gearb)],
          ]}
          balance={ytd.plus_krank}
          fulfilment={fulfilment(ytd.gearb, dueSickAsAbsence(ytd))}
          name={name}
        />
      </div>

      {person === null ? (
        <TeamCatchUp catchUp={catchUp} />
      ) : (
        <PersonCatchUp catchUp={catchUp} person={person} />
      )}

      <section>
        <h3 className={styles.heading}>Monatsverlauf</h3>
        <div className={styles.tableWrap}>
          <table className="w-full text-sm">
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th} colSpan={5} />
                <th className={`${styles.th} border-l border-slate-200 text-center`} colSpan={3}>
                  Urlaub &amp; Krankheit angerechnet
                </th>
                <th className={`${styles.th} border-l border-slate-200 text-center`} colSpan={3}>
                  Krankheit als Fehlzeit
                </th>
              </tr>
              <tr>
                <th className={styles.th}>Monat</th>
                <th className={styles.thNum}>Vertraglich</th>
                <th className={styles.thNum}>Urlaub (T)</th>
                <th className={styles.thNum}>Krank (T)</th>
                <th className={styles.thNum}>Gearbeitet</th>
                <th className={`${styles.thNum} border-l border-slate-200`}>Zu leisten</th>
                <th className={styles.thNum}>Saldo</th>
                <th className={styles.thNum}>kumuliert</th>
                <th className={`${styles.thNum} border-l border-slate-200`}>Zu leisten</th>
                <th className={styles.thNum}>Saldo</th>
                <th className={styles.thNum}>kumuliert</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {months.map(([month, d]) => {
                cumulative += d.plus;
                cumulativeSick += d.plus_krank;
                return (
                  <tr key={month}>
                    <td className={styles.td}>{formatMonth(month)}</td>
                    <td className={styles.tdNum}>{formatHours(d.soll_b)}</td>
                    <td className={styles.tdNum} title={`${formatHours(d.vac_h)} h`}>
                      {formatNumber(d.vac_days)}
                    </td>
                    <td className={styles.tdNum} title={`${formatHours(d.sick_h)} h`}>
                      {formatNumber(d.sick_days)}
                    </td>
                    <td className={styles.tdNum}>{formatHours(d.gearb)}</td>
                    <td className={`${styles.tdNum} border-l border-slate-100`}>
                      {formatHours(d.soll_n)}
                    </td>
                    <Signed value={d.plus} />
                    <Signed value={cumulative} strong />
                    <td className={`${styles.tdNum} border-l border-slate-100`}>
                      {formatHours(dueSickAsAbsence(d))}
                    </td>
                    <Signed value={d.plus_krank} />
                    <Signed value={cumulativeSick} strong />
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-medium">
              <tr>
                <td className={styles.td}>Jahr bis Stichtag</td>
                <td className={styles.tdNum}>{formatHours(ytd.soll_b)}</td>
                <td className={styles.tdNum}>{formatNumber(ytd.vac_days)}</td>
                <td className={styles.tdNum}>{formatNumber(ytd.sick_days)}</td>
                <td className={styles.tdNum}>{formatHours(ytd.gearb)}</td>
                <td className={`${styles.tdNum} border-l border-slate-200`}>
                  {formatHours(ytd.soll_n)}
                </td>
                <Signed value={ytd.plus} />
                <td />
                <td className={`${styles.tdNum} border-l border-slate-200`}>
                  {formatHours(dueSickAsAbsence(ytd))}
                </td>
                <Signed value={ytd.plus_krank} />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Urlaub und Krankheit werden je Tag als ganzer oder halber Standard-Tag angerechnet (8 h
          bzw. 4 h laut Personio → h/Tag laut Vertrag der Person). Saldo = gearbeitet − zu leisten;
          negativ = Stunden, die die Person dem Unternehmen schuldet.
        </p>
      </section>
    </div>
  );
}

function Balance({
  title,
  subtitle,
  rows,
  balance,
  fulfilment,
  name,
}: {
  title: string;
  subtitle: string;
  rows: [string, string][];
  balance: number;
  fulfilment: string;
  name: string;
}) {
  const owes = balance < -0.004;
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-5 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </header>
      <dl className="divide-y divide-slate-100 px-5 text-sm">
        {rows.map(([label, value]) => (
          <Row key={label} label={label}>
            {value}
          </Row>
        ))}
      </dl>
      <div
        className={`flex items-center justify-between rounded-b-xl px-5 py-3 ${
          owes ? "bg-red-50" : "bg-emerald-50"
        }`}
      >
        <div>
          <p className={`text-xs ${owes ? "text-red-800" : "text-emerald-800"}`}>
            {owes
              ? `${name} schuldet dem Unternehmen`
              : balance > 0.004
                ? `${name} hat Überstunden`
                : "Ausgeglichen"}
          </p>
          <p className={`text-2xl font-semibold tabular-nums ${tone(balance)}`}>
            {formatSignedHours(balance)} h
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Erfüllung</p>
          <p className="text-lg font-semibold tabular-nums">{fulfilment}</p>
        </div>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between py-1.5">
      <dt className={label.startsWith("=") ? "font-medium" : "text-slate-600"}>{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

function Signed({ value, strong }: { value: number; strong?: boolean }) {
  return (
    <td className={`${styles.tdNum} ${tone(value)} ${strong ? "font-medium" : ""}`}>
      {formatSignedHours(Math.round(value * 100) / 100)}
    </td>
  );
}
