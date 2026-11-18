// Professional grouped bar chart: revenue vs. COGS by month.
// Plain SVG + React — no charting library, matches the design-system
// report palette (brand blue = revenue, amber orange = COGS).
//
//   * hairline gridlines, compact y-axis ticks
//   * each month is one hit target: hover/focus shows a tooltip with
//     both series' exact values (a value is never shown on hover only —
//     it is also on the <title> fallback and reachable via the legend)
//   * top-rounded bars (4px), 2px surface gap between the paired bars
//   * crosshair highlights the hovered month across the whole chart

import React from 'react';
import { formatEGP } from '../ui';

export interface MonthlyRevenuePoint {
  key: string;
  label: string;
  revenue: number;
  cogs: number;
}

const VB_W = 640;
const VB_H = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 54 };
const PLOT_W = VB_W - PAD.left - PAD.right;
const PLOT_H = VB_H - PAD.top - PAD.bottom;

/** Round a max value up to a clean axis top (1/2/5 × 10^n). */
function niceMax(value: number): number {
  if (value <= 0) return 10;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const n = value / base;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * base;
}

function compact(value: number): string {
  const v = Math.abs(value);
  if (v >= 1_000_000) return `${(value / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
  if (v >= 1_000) return `${(value / 1_000).toLocaleString('en-US', { maximumFractionDigits: 0 })}K`;
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Path for a bar rounded only at the top (square at the baseline). */
function topRoundedRect(x: number, yTop: number, w: number, yBase: number, r: number): string {
  const rr = Math.min(r, w / 2, Math.max(0, yBase - yTop));
  if (yBase - yTop <= 0) return '';
  return `M ${x} ${yBase}
    L ${x} ${yTop + rr}
    Q ${x} ${yTop} ${x + rr} ${yTop}
    L ${x + w - rr} ${yTop}
    Q ${x + w} ${yTop} ${x + w} ${yTop + rr}
    L ${x + w} ${yBase}
    Z`;
}

export const MonthlyRevenueChart: React.FC<{ data: MonthlyRevenuePoint[] }> = ({ data }) => {
  const [hover, setHover] = React.useState<number | null>(null);
  const max = niceMax(Math.max(1, ...data.map(d => Math.max(d.revenue, d.cogs))));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  const yOf = (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H;

  const groupW = PLOT_W / Math.max(1, data.length);
  const barW = Math.min(24, (groupW - 16) / 2);
  const gap = 2;

  const active = hover !== null ? data[hover] : null;
  const activeX = hover !== null ? PAD.left + hover * groupW + groupW / 2 : 0;
  // Keep the tooltip inside the chart on both edges.
  const tipLeftPct = Math.min(86, Math.max(2, (activeX / VB_W) * 100));

  return (
    <div className="relative" dir="ltr">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-48 select-none" role="img" aria-label="الإيرادات مقابل التكلفة المباشرة شهرياً">
        {/* gridlines + y-axis labels */}
        {ticks.map((t, i) => {
          const y = yOf(t);
          return (
            <g key={i}>
              <line x1={PAD.left} x2={VB_W - PAD.right} y1={y} y2={y} className="stroke-cream-300" strokeWidth={1} />
              <text x={PAD.left - 8} y={y} textAnchor="end" dominantBaseline="middle" className="fill-cream-700 text-[9px] font-semibold font-mono">
                {compact(t)}
              </text>
            </g>
          );
        })}
        {/* baseline (slightly stronger than gridlines) */}
        <line x1={PAD.left} x2={VB_W - PAD.right} y1={yOf(0)} y2={yOf(0)} className="stroke-cream-400" strokeWidth={1} />

        {/* crosshair for the hovered month */}
        {hover !== null && (
          <line
            x1={PAD.left + hover * groupW + groupW / 2}
            x2={PAD.left + hover * groupW + groupW / 2}
            y1={PAD.top}
            y2={yOf(0)}
            className="stroke-brand-300"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {data.map((m, i) => {
          const cx = PAD.left + i * groupW + groupW / 2;
          const revX = cx - barW - gap / 2;
          const cogsX = cx + gap / 2;
          const isHover = hover === i;
          return (
            <g key={m.key} opacity={hover === null || isHover ? 1 : 0.45} style={{ transition: 'opacity 120ms' }}>
              <path d={topRoundedRect(revX, yOf(m.revenue), barW, yOf(0), 4)} className="fill-brand-500">
                <title>{`${m.label} — الإيرادات: ${formatEGP(m.revenue)}`}</title>
              </path>
              <path d={topRoundedRect(cogsX, yOf(m.cogs), barW, yOf(0), 4)} className="fill-amber-500">
                <title>{`${m.label} — التكلفة: ${formatEGP(m.cogs)}`}</title>
              </path>
              <text x={cx} y={VB_H - PAD.bottom + 16} textAnchor="middle" className="fill-cream-700 text-[10px] font-bold">
                {m.label}
              </text>
              {/* hit target: the whole month column, keyboard-focusable */}
              <rect
                x={PAD.left + i * groupW}
                y={PAD.top}
                width={groupW}
                height={PLOT_H}
                fill="transparent"
                tabIndex={0}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onBlur={() => setHover(null)}
                className="cursor-pointer outline-none"
              />
            </g>
          );
        })}
      </svg>

      {active && (
        <div
          className="absolute top-0 -translate-y-[calc(100%+6px)] z-10 rounded-lg bg-ink-900 text-white text-[11px] px-2.5 py-2 shadow-lg pointer-events-none whitespace-nowrap"
          style={{ left: `${tipLeftPct}%` }}
        >
          <div className="font-black mb-1">{active.label}</div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 rounded bg-brand-400 inline-block" />
            <span className="font-mono font-black">{formatEGP(active.revenue)}</span>
            <span className="text-cream-300">الإيرادات</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 rounded bg-amber-400 inline-block" />
            <span className="font-mono font-black">{formatEGP(active.cogs)}</span>
            <span className="text-cream-300">التكلفة</span>
          </div>
        </div>
      )}
    </div>
  );
};
