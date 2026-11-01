import { useState, type MouseEvent } from "react";

export interface PieSlice {
  key: string;
  label: string;
  value: number;
  /** Anteil in Prozent (für Beschriftung). */
  share: number;
  color: string;
  /** Tooltip-Text. */
  detail: string;
}

interface Props {
  slices: PieSlice[];
  /** Hervorgehobene Scheibe (geteilt mit der Tabelle). */
  active: string | null;
  onActive: (key: string | null) => void;
  ariaLabel: string;
}

const W = 340;
const H = 280;
const CX = W / 2;
const CY = H / 2;
const R = 100;
const LABEL_R = R + 16;
/** Kleinere Anteile bekommen keine Beschriftung (stehen in der Tabelle). */
const MIN_LABEL_SHARE = 4;

const point = (angle: number, radius: number) => [
  CX + radius * Math.cos(angle),
  CY + radius * Math.sin(angle),
];

const fmtShare = (share: number) =>
  `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(share)} %`;

/** Tortendiagramm (SVG): Start oben, im Uhrzeigersinn, 2 px Lücke zwischen Scheiben. */
export function PieChart({ slices, active, onActive, ariaLabel }: Props) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;

  let angle = -Math.PI / 2;
  const geometry = slices.map((slice) => {
    const start = angle;
    const sweep = (slice.value / total) * Math.PI * 2;
    angle += sweep;
    return { slice, start, end: start + sweep, mid: start + sweep / 2 };
  });

  const showTip = (event: MouseEvent, slice: PieSlice) => {
    const box = (event.currentTarget as SVGElement).ownerSVGElement?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: event.clientX - box.left, y: event.clientY - box.top, text: slice.detail });
  };

  return (
    <div className="relative mx-auto w-full max-w-[340px]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        className="w-full"
        onMouseLeave={() => {
          onActive(null);
          setTip(null);
        }}
      >
        {geometry.map(({ slice, start, end }) => {
          const dimmed = active !== null && active !== slice.key;
          const common = {
            fill: slice.color,
            stroke: "#ffffff",
            strokeWidth: 2,
            strokeLinejoin: "round" as const,
            opacity: dimmed ? 0.35 : 1,
            className: "cursor-pointer transition-opacity",
            onMouseEnter: () => onActive(slice.key),
            onMouseMove: (e: MouseEvent) => showTip(e, slice),
          };
          if (slices.length === 1 || end - start >= Math.PI * 2 - 1e-9) {
            return <circle key={slice.key} cx={CX} cy={CY} r={R} {...common} />;
          }
          const [x0, y0] = point(start, R);
          const [x1, y1] = point(end, R);
          const large = end - start > Math.PI ? 1 : 0;
          return (
            <path
              key={slice.key}
              d={`M ${CX} ${CY} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`}
              {...common}
            />
          );
        })}
        {geometry
          .filter(({ slice }) => slice.share >= MIN_LABEL_SHARE)
          .map(({ slice, mid }) => {
            const [x, y] = point(mid, LABEL_R);
            const anchor = Math.abs(x - CX) < 8 ? "middle" : x > CX ? "start" : "end";
            return (
              <text
                key={slice.key}
                x={x}
                y={y}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="pointer-events-none fill-slate-700 text-[12px] tabular-nums"
                opacity={active !== null && active !== slice.key ? 0.4 : 1}
              >
                {fmtShare(slice.share)}
              </text>
            );
          })}
      </svg>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow"
          style={{ left: tip.x + 12, top: tip.y + 12 }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
