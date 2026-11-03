import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatDate, formatEuro, formatMonth } from "../../lib/format";
import { SERIES_COLORS } from "./chartColors";
import type { ChartPoint } from "./forecast";

interface Props {
  points: ChartPoint[];
  /** Budget-Betrag (Referenzlinie); `null` = ohne Budget. */
  budget: number | null;
  ariaLabel: string;
}

const H = 300;
const M = { top: 16, right: 132, bottom: 30, left: 76 };
const PLOT_H = H - M.top - M.bottom;

/** Abgerechnet/Prognose (eine Größe) und Richtwert: feste Slots der App-Palette. */
export const CHART_COLORS = { invoiced: SERIES_COLORS[0], target: SERIES_COLORS[1] };

const euro0 = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/** Runde Teilung der y-Achse (1, 2, 2,5, 5 × 10^n) mit etwa vier Schritten. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * power).find((s) => s >= raw)!;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/**
 * Kumuliertes Liniendiagramm (SVG, ohne Bibliothek): Abgerechnet (durchgezogen)
 * geht am Stand der Daten in die Prognose (gestrichelt) über; Richtwert und
 * Budget als Bezug. Fadenkreuz mit Tooltip per Maus oder Pfeiltasten.
 */
export function BudgetChart({ points, budget, ariaLabel }: Props) {
  const [active, setActive] = useState<number | null>(null);
  // In tatsächlicher Breite zeichnen, damit Schrift und Linien nicht mitskalieren.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setW(Math.max(420, Math.round(entry.contentRect.width))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (points.length < 2) return null;
  const PLOT_W = W - M.left - M.right;

  const x0 = day(points[0].date);
  const x1 = day(points[points.length - 1].date);
  const values = points.flatMap((p) => [p.actual, p.forecast, p.target]).filter((v) => v !== null);
  const ticks = niceTicks(Math.max(budget ?? 0, ...(values as number[])));
  const yMax = ticks[ticks.length - 1] || 1;
  const x = (iso: string) => M.left + ((day(iso) - x0) / Math.max(x1 - x0, 1)) * PLOT_W;
  const y = (v: number) => M.top + PLOT_H - (v / yMax) * PLOT_H;

  const path = (key: "actual" | "forecast" | "target") =>
    points
      .filter((p) => p[key] !== null)
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.date).toFixed(1)},${y(p[key]!).toFixed(1)}`)
      .join(" ");

  // Fadenkreuz rastet auf Monatsenden (und den Übergang Ist → Prognose) ein.
  const stops = points.map((p, i) => ({ i, px: x(p.date) })).filter(({ i }) => i > 0);
  const last = [...points].reverse();
  const end = {
    forecast: last.find((p) => p.forecast !== null),
    actual: last.find((p) => p.actual !== null),
  };

  const onPointer = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const nearest = stops.reduce((a, b) => (Math.abs(b.px - px) < Math.abs(a.px - px) ? b : a));
    setActive(nearest.i);
  };
  const onKey = (event: KeyboardEvent) => {
    const index = stops.findIndex((s) => s.i === active);
    if (event.key === "ArrowRight") setActive(stops[Math.min(index + 1, stops.length - 1)].i);
    else if (event.key === "ArrowLeft") setActive(stops[Math.max(index - 1, 0)].i);
    else return;
    event.preventDefault();
  };
  const point = active === null ? null : points[active];

  return (
    <figure className="space-y-2">
      <Legend hasBudget={budget !== null} />
      <div className="relative" ref={box}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onPointerMove={onPointer}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(stops[stops.length - 1].i)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
        >
          {/* Gitter + y-Achse */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + PLOT_W} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-500 text-[11px] tabular-nums">
                {euro0.format(t)}
              </text>
            </g>
          ))}
          {/* Monate an der x-Achse (bei vielen Monaten nur jeder n-te) */}
          {monthLabels(points).map(({ date, label }) => (
            <text key={date} x={x(date)} y={H - 10} textAnchor="middle" className="fill-slate-500 text-[11px]">
              {label}
            </text>
          ))}

          {/* Budget als Referenzlinie */}
          {budget !== null && (
            <g>
              <line x1={M.left} x2={M.left + PLOT_W} y1={y(budget)} y2={y(budget)} stroke="#475569" strokeWidth={1} />
              <text x={M.left + PLOT_W + 8} y={y(budget) + 4} className="fill-slate-700 text-[11px] font-medium">
                Budget {euro0.format(budget)}
              </text>
            </g>
          )}

          <path d={path("target")} fill="none" stroke={CHART_COLORS.target} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={path("forecast")} fill="none" stroke={CHART_COLORS.invoiced} strokeWidth={2} strokeDasharray="6 5" strokeLinejoin="round" strokeLinecap="round" />
          <path d={path("actual")} fill="none" stroke={CHART_COLORS.invoiced} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* Endpunkte mit Beschriftung: Stand der Daten und erwartetes Ende */}
          {end.actual && (
            <circle cx={x(end.actual.date)} cy={y(end.actual.actual!)} r={4} fill={CHART_COLORS.invoiced} stroke="white" strokeWidth={2} />
          )}
          {end.forecast && end.forecast !== end.actual && (
            <g>
              <circle cx={x(end.forecast.date)} cy={y(end.forecast.forecast!)} r={4} fill={CHART_COLORS.invoiced} stroke="white" strokeWidth={2} />
              <text
                x={x(end.forecast.date) + 8}
                y={y(end.forecast.forecast!) + (budget !== null && end.forecast.forecast! >= budget ? -6 : 14)}
                className="fill-slate-900 text-[11px] font-semibold tabular-nums"
              >
                erwartet {euro0.format(end.forecast.forecast!)}
              </text>
            </g>
          )}

          {/* Fadenkreuz */}
          {point && (
            <g pointerEvents="none">
              <line x1={x(point.date)} x2={x(point.date)} y1={M.top} y2={M.top + PLOT_H} stroke="#94a3b8" strokeWidth={1} />
              {(["actual", "forecast", "target"] as const).map(
                (key) =>
                  point[key] !== null && (
                    <circle
                      key={key}
                      cx={x(point.date)}
                      cy={y(point[key]!)}
                      r={4}
                      fill={key === "target" ? CHART_COLORS.target : CHART_COLORS.invoiced}
                      stroke="white"
                      strokeWidth={2}
                    />
                  ),
              )}
            </g>
          )}
        </svg>

        {point && (
          <div
            role="status"
            className="pointer-events-none absolute top-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
            style={
              x(point.date) / W > 0.55
                ? { right: `${(1 - x(point.date) / W) * 100 + 2}%` }
                : { left: `${(x(point.date) / W) * 100 + 2}%` }
            }
          >
            <p className="mb-1 font-medium text-slate-700">
              {point.month ? `Ende ${formatMonth(point.month)}` : `Stand ${formatDate(point.date)}`}
            </p>
            <TipRow label="Abgerechnet" value={point.actual} color={CHART_COLORS.invoiced} />
            {point.actual === null && (
              <TipRow label="Ist + Prognose" value={point.forecast} color={CHART_COLORS.invoiced} dashed />
            )}
            <TipRow label="Richtwert" value={point.target} color={CHART_COLORS.target} />
          </div>
        )}
      </div>
    </figure>
  );
}

/**
 * Monatsbeschriftungen mittig unter dem Monat (Punkte liegen auf den Monatsenden):
 * höchstens zwölf, Jahreszahl beim Januar (mehrjährig).
 */
export function monthLabels(points: ChartPoint[]): { date: string; label: string }[] {
  const months = points.filter((p) => p.month);
  const step = Math.ceil(months.length / 12);
  const years = new Set(months.map((p) => p.month!.slice(0, 4)));
  return months
    .filter((_, i) => i % step === 0)
    .map((p) => {
      const abbr = formatMonth(p.month!).slice(0, 3);
      const january = p.month!.endsWith("-01") && years.size > 1;
      return {
        date: `${p.month}-15`,
        label: january ? `${abbr} ${p.month!.slice(2, 4)}` : abbr,
      };
    });
}

function TipRow({
  label,
  value,
  color,
  dashed,
}: {
  label: string;
  value: number | null;
  color: string;
  dashed?: boolean;
}) {
  if (value === null) return null;
  return (
    <p className="flex items-center gap-2 whitespace-nowrap">
      <LineKey color={color} dashed={dashed} />
      <span className="font-semibold text-slate-900 tabular-nums">{formatEuro(value)}</span>
      <span className="text-slate-500">{label}</span>
    </p>
  );
}

function LineKey({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg width="18" height="6" aria-hidden className="shrink-0">
      <line x1="1" x2="17" y1="3" y2="3" stroke={color} strokeWidth={2} strokeDasharray={dashed ? "4 3" : undefined} strokeLinecap="round" />
    </svg>
  );
}

function Legend({ hasBudget }: { hasBudget: boolean }) {
  return (
    <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      <span className="flex items-center gap-1.5">
        <LineKey color={CHART_COLORS.invoiced} /> Abgerechnet (kumuliert)
      </span>
      <span className="flex items-center gap-1.5">
        <LineKey color={CHART_COLORS.invoiced} dashed /> Prognose
      </span>
      {hasBudget && (
        <>
          <span className="flex items-center gap-1.5">
            <LineKey color={CHART_COLORS.target} /> Richtwert (Budget ÷ Monate)
          </span>
          <span className="flex items-center gap-1.5">
            <LineKey color="#475569" /> Budget
          </span>
        </>
      )}
    </figcaption>
  );
}
