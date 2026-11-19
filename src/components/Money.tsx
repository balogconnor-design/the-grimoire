import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { formatUSD } from '../lib/rules';
import { moveClass } from '../lib/collection';

const fmtPct = (p: number) => `${p >= 0 ? '+' : '−'}${Math.abs(p) >= 100 ? Math.abs(p).toFixed(0) : Math.abs(p).toFixed(1)}%`;
const fmtDiff = (d: number) => `${d >= 0 ? '+' : '−'}${formatUSD(Math.abs(d))}`;

/** Gain/loss vs purchase: always arrow + sign + number, so meaning never rests on color alone. */
export function PLBadge({ diff, pct, compact }: { diff: number | null; pct: number | null; compact?: boolean }) {
  if (diff == null) return <span className="muted">—</span>;
  const cls = moveClass(pct ?? (diff === 0 ? 0 : diff > 0 ? 3 : -3));
  const arrow = cls === 'flat' ? '•' : diff > 0 ? '▲' : '▼';
  return (
    <span className={`pl ${cls}`} title={cls.endsWith('strong') ? 'Strong move (≥25%)' : undefined}>
      <span aria-hidden>{arrow}</span> {fmtDiff(diff)}
      {!compact && pct != null && <span className="pl-pct"> {fmtPct(pct)}</span>}
    </span>
  );
}

/**
 * Change vs an earlier date: green ▲ / red ▼ for any move (no neutral band), with $ and %.
 * Shows a muted placeholder until there's history to compare against.
 */
export function DeltaBadge({ diff, pct, label = '7d', emptyTitle = 'Needs a week of price history' }: { diff: number | null | undefined; pct: number | null | undefined; label?: string; emptyTitle?: string }) {
  if (diff == null) return <span className="delta none" title={emptyTitle}>{label} —</span>;
  const cents = Math.round(diff * 100);
  const cls = cents === 0 ? 'flat' : cents > 0 ? 'gain' : 'loss';
  return (
    <span className={`delta ${cls}`} title={`Change over ${label === '7d' ? '7 days' : label}`}>
      <span aria-hidden>{cls === 'flat' ? '•' : cls === 'gain' ? '▲' : '▼'}</span>
      {pct != null && <span>{fmtPct(pct)}</span>}
      <span>{fmtDiff(diff)}</span>
      <span className="delta-label">{label}</span>
    </span>
  );
}

export function PctBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="muted">—</span>;
  const cls = moveClass(pct);
  return <span className={`pl ${cls}`}><span aria-hidden>{cls === 'flat' ? '•' : pct > 0 ? '▲' : '▼'}</span> {fmtPct(pct)}</span>;
}

/** Market trend from our own daily snapshots (e.g. 7-day change). */
export function Trend({ pct, days = 7 }: { pct: number | null; days?: number }) {
  if (pct == null) return <span className="trend none" title="Not enough price history yet">·</span>;
  const cls = moveClass(pct);
  const spike = Math.abs(pct) >= 15;
  return (
    <span className={`trend ${cls} ${spike ? 'spike' : ''}`} title={`${fmtPct(pct)} over ${days} days${spike ? ' — big move' : ''}`}>
      {cls === 'flat' ? '→' : pct > 0 ? '↗' : '↘'}{spike && <span className="sr-only"> big move</span>} {fmtPct(pct)}
    </span>
  );
}

export function Sparkline({ points, width = 90, height = 24 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <span className="muted tiny-label">no history yet</span>;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(height - 2 - ((p - min) / span) * (height - 4)).toFixed(1)}`).join(' ');
  const up = points[points.length - 1] >= points[0];
  return (
    <svg className={`sparkline ${up ? 'up' : 'down'}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`Price trend from ${formatUSD(points[0])} to ${formatUSD(points[points.length - 1])}`}>
      <path d={d} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Single-series value-over-time chart with a hover crosshair + tooltip. */
export function ValueChart({ series, height = 160, label = 'Value' }: { series: { date: string; price: number }[]; height?: number; label?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(600);
  // Draw at the container's real pixel width so axis text keeps its size in narrow panels.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [series.length >= 2]);
  if (series.length < 2) {
    return (
      <div className="value-chart-empty muted small">
        Price history builds up from daily snapshots. Come back after a few days of opening the app to see a trend.
      </div>
    );
  }
  const W = width, H = height, padL = 52, padR = 10, padT = 10, padB = 22;
  const vals = series.map((s) => s.price);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min *= 0.95; max *= 1.05; }
  const pad = (max - min) * 0.08;
  min = Math.max(0, min - pad); max += pad;
  const x = (i: number) => padL + (i / (series.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const d = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.price).toFixed(1)}`).join(' ');
  const ticks = [min, (min + max) / 2, max];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - padL) / (W - padL - padR)) * (series.length - 1));
    setHover(Math.max(0, Math.min(series.length - 1, i)));
  };
  const h = hover != null ? series[hover] : null;

  return (
    <div className="value-chart" ref={box}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width={W} height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)}
        role="img" aria-label={`${label} over time, ${series[0].date} to ${series[series.length - 1].date}`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line className="vc-grid" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
            <text className="vc-axis" x={padL - 6} y={y(t) + 4} textAnchor="end">{formatUSD(t).replace(/\.\d\d$/, '')}</text>
          </g>
        ))}
        <text className="vc-axis" x={padL} y={H - 4}>{series[0].date}</text>
        <text className="vc-axis" x={W - padR} y={H - 4} textAnchor="end">{series[series.length - 1].date}</text>
        <path className="vc-line" d={d} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {h && hover != null && (
          <line className="vc-cross" x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {h && hover != null && (
        <>
          {/* HTML marker so it stays round while the SVG stretches to the container. */}
          <span className="vc-dot" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(h.price) / H) * 100}%` }} />
          <div className="chart-tip vc-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <b>{formatUSD(h.price)}</b> <span className="muted">{h.date}</span>
          </div>
        </>
      )}
    </div>
  );
}
