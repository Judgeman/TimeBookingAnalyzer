import { useEffect, useRef, useState } from "react";
import { formatEuro, formatMonth } from "../../lib/format";
import { niceTicks } from "./BudgetChart";
import type { BudgetMonth } from "./insights";

interface Props {
  months: BudgetMonth[];
  ariaLabel: string;
}

/** Gegensatzpaar der Palette: unter Richtwert (liegen gelassen) / darüber (mehr abgerufen). */
export const DEVIATION_COLORS = { below: "#2a78d6", above: "#e34948" };

const H = 220;
const M = { top: 22, right: 16, bottom: 28, left: 76 };
const PLOT_H = H - M.top - M.bottom;
const BAR = 24;

const euro0 = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});

/**
 * Säulen „abgerechnet − Richtwert“ je Monat, von einer Nulllinie aus: nach oben
 * mehr abgerufen, nach unten liegen gelassen. Beschriftet sind nur die beiden
 * Extreme; jede Säule zeigt ihre Werte bei Hover und Fokus.
 */
export function DeviationChart({ months, ariaLabel }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setW(Math.max(360, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (months.length === 0) return null;

  const maxAbs = Math.max(...months.map((m) => Math.abs(m.diff)), 1);
  const ticks = niceTicks(maxAbs);
  const top = ticks[ticks.length - 1];
  const plotW = W - M.left - M.right;
  const slot = plotW / months.length;
  const barW = Math.min(BAR, slot * 0.6);
  const y = (v: number) => M.top + PLOT_H / 2 - (v / top) * (PLOT_H / 2);
  const cx = (i: number) => M.left + slot * (i + 0.5);
  const extremes = new Set([
    months.reduce((a, b) => (b.diff > a.diff ? b : a)).month,
    months.reduce((a, b) => (b.diff < a.diff ? b : a)).month,
  ]);
  const current = active === null ? null : months[active];

  return (
    <figure className="space-y-2">
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DEVIATION_COLORS.above }} /> mehr abgerufen als Richtwert
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DEVIATION_COLORS.below }} /> liegen gelassen
        </span>
      </figcaption>
      <div className="relative" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
          {[...ticks.slice(1).reverse().map((t) => -t), ...ticks].map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#94a3b8" : "#e2e8f0"} strokeWidth={1} />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-500 text-[11px] tabular-nums">
                {euro0.format(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) => {
            const above = m.diff >= 0;
            const height = Math.max(Math.abs(y(m.diff) - y(0)), 1);
            const r = Math.min(4, height / 2, barW / 2);
            const x0 = cx(i) - barW / 2;
            const y0 = y(0);
            // abgerundetes Ende außen, gerade an der Nulllinie
            const d = above
              ? `M${x0},${y0} V${y0 - height + r} Q${x0},${y0 - height} ${x0 + r},${y0 - height} H${x0 + barW - r} Q${x0 + barW},${y0 - height} ${x0 + barW},${y0 - height + r} V${y0} Z`
              : `M${x0},${y0} V${y0 + height - r} Q${x0},${y0 + height} ${x0 + r},${y0 + height} H${x0 + barW - r} Q${x0 + barW},${y0 + height} ${x0 + barW},${y0 + height - r} V${y0} Z`;
            return (
              <g
                key={m.month}
                tabIndex={0}
                role="button"
                aria-label={`${formatMonth(m.month)}: ${euro0.format(m.diff)} zum Richtwert`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="outline-none"
              >
                {/* Trefferfläche: ganze Spalte */}
                <rect x={cx(i) - slot / 2} y={M.top} width={slot} height={PLOT_H} fill="transparent" />
                <path
                  d={d}
                  fill={above ? DEVIATION_COLORS.above : DEVIATION_COLORS.below}
                  opacity={active === null || active === i ? 1 : 0.55}
                />
                {extremes.has(m.month) && (
                  <text
                    x={cx(i)}
                    y={above ? y(m.diff) - 6 : y(m.diff) + 14}
                    textAnchor="middle"
                    className="fill-slate-900 text-[11px] font-semibold tabular-nums"
                  >
                    {euro0.format(m.diff)}
                  </text>
                )}
                <text x={cx(i)} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[11px]">
                  {formatMonth(m.month).slice(0, 3)}
                </text>
              </g>
            );
          })}
        </svg>
        {current && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
            style={
              cx(active!) / W > 0.55
                ? { right: `${(1 - cx(active!) / W) * 100 + 2}%` }
                : { left: `${(cx(active!) / W) * 100 + 2}%` }
            }
          >
            <p className="mb-1 font-medium text-slate-700">{formatMonth(current.month)}</p>
            <p className="tabular-nums">
              <span className="font-semibold text-slate-900">{formatEuro(current.actual)}</span>{" "}
              <span className="text-slate-500">abgerechnet</span>
            </p>
            <p className="tabular-nums">
              <span className="font-semibold text-slate-900">{formatEuro(current.target)}</span>{" "}
              <span className="text-slate-500">Richtwert</span>
            </p>
            <p className="tabular-nums">
              <span className="font-semibold text-slate-900">{euro0.format(current.diff)}</span>{" "}
              <span className="text-slate-500">{current.diff >= 0 ? "mehr abgerufen" : "liegen gelassen"}</span>
            </p>
          </div>
        )}
      </div>
    </figure>
  );
}
