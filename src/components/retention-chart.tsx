"use client";

import { useEffect, useRef, useState } from "react";
import type { RetentionPoint } from "@/lib/youtube";

export type RetentionSeries = { label: string; points: RetentionPoint[]; tone: "before" | "after" };

const H = 240;
const PAD = { top: 12, right: 16, bottom: 28, left: 48 };
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Audience retention curves on one chart: share of viewers still watching across the video. */
export function RetentionChart({ series }: { series: RetentionSeries[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = series.filter((s) => s.points.length >= 2);
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  // Rewatching can push the curve above 100%; round the top up to a quarter.
  const max = Math.max(1, Math.ceil(Math.max(0, ...shown.flatMap((s) => s.points.map((p) => p.watching))) * 4) / 4);
  const x = (at: number) => PAD.left + at * innerW;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const yTicks = Array.from({ length: Math.round(max * 4) + 1 }, (_, i) => i / 4);
  const nearest = (pts: RetentionPoint[], at: number) => pts.reduce((b, p) => (Math.abs(p.at - at) < Math.abs(b.at - at) ? p : b));

  return (
    <div ref={wrap} className="relative">
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`Audience retention: ${shown.map((s) => s.label).join(" vs ")}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(1, (e.clientX - r.left - PAD.left) / innerW)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="fill-faint text-[11px] tabular-nums">
              {pct(t)}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor={t === 0 ? "start" : t === 1 ? "end" : "middle"} className="fill-faint text-[11px] tabular-nums">
            {t === 0 ? "Start" : t === 1 ? "End" : pct(t)}
          </text>
        ))}
        {shown.map((s) => (
          <path
            key={s.label}
            d={s.points.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.watching).toFixed(1)}`).join("")}
            fill="none"
            className={s.tone === "after" ? "stroke-accent" : "stroke-faint"}
            strokeDasharray={s.tone === "before" ? "5 4" : undefined}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-faint" />
            {shown.map((s) => {
              const p = nearest(s.points, hover);
              return <circle key={s.label} cx={x(p.at)} cy={y(p.watching)} r={4} className={`${s.tone === "after" ? "fill-accent" : "fill-faint"} stroke-surface`} strokeWidth={2} />;
            })}
          </g>
        )}
      </svg>
      {hover != null && shown.length > 0 && (
        <div
          className="pointer-events-none absolute top-4 z-10 w-max rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md"
          style={x(hover) > width / 2 ? { right: width - x(hover) + 10 } : { left: x(hover) + 10 }}
        >
          <div className="text-muted">{pct(hover)} into the video</div>
          {shown.map((s) => (
            <div key={s.label} className="tabular-nums">
              <span className="text-muted">{s.label}:</span> <span className="font-semibold">{pct(nearest(s.points, hover).watching)}</span> still watching
            </div>
          ))}
        </div>
      )}
      {shown.length > 1 && (
        <div className="mt-1 flex gap-4 text-xs text-muted">
          {shown.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <svg width="18" height="4" aria-hidden>
                <line x1="0" x2="18" y1="2" y2="2" strokeWidth="2" className={s.tone === "after" ? "stroke-accent" : "stroke-faint"} strokeDasharray={s.tone === "before" ? "5 4" : undefined} />
              </svg>
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
