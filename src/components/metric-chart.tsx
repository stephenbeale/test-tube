"use client";

import { useEffect, useRef, useState } from "react";
import { fmtDate, fmtMetric } from "@/lib/format";
import type { MetricKey } from "@/lib/impact";

export type Point = { date: string; value: number | null };
export type Marker = { date: string; n: number; label: string; note: boolean };

const H = 280;
const PAD = { top: 34, right: 16, bottom: 28, left: 48 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 4, 8, 10].map((m) => m * p).find((m) => m >= v)!;
}

export function MetricChart({ points, markers, metric, label }: { points: Point[]; markers: Marker[]; metric: MetricKey; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = points.filter((p) => p.value != null);
  if (data.length < 2) {
    return <p className="py-16 text-center text-sm text-muted">No {label.toLowerCase()} data for this video yet.</p>;
  }

  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(...data.map((p) => p.value!)));
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const index = new Map(points.map((p, i) => [p.date, i]));

  let path = "";
  let pen = false;
  points.forEach((p, i) => {
    if (p.value == null) return void (pen = false);
    path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    pen = true;
  });

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const step = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 90))));
  const hp = hover == null ? null : points[hover];
  const hoverMarkers = hp ? markers.filter((m) => m.date === hp.date) : [];

  return (
    <div ref={wrap} className="relative">
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`${label} per day with change markers`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left - PAD.left) / innerW) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="fill-faint text-[11px] tabular-nums">
              {fmtMetric(metric, t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % step === 0 ? (
            <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle" className="fill-faint text-[11px]">
              {fmtDate(p.date)}
            </text>
          ) : null,
        )}
        {markers.map((m) => {
          const i = index.get(m.date);
          if (i == null) return null;
          return (
            <g key={`${m.n}`}>
              <line x1={x(i)} x2={x(i)} y1={PAD.top - 6} y2={PAD.top + innerH} strokeDasharray="3 3" className={m.note ? "stroke-note" : "stroke-ink"} strokeOpacity={0.55} />
              <circle cx={x(i)} cy={PAD.top - 16} r={10} className={m.note ? "fill-note" : "fill-ink"} />
              <text x={x(i)} y={PAD.top - 12} textAnchor="middle" className="fill-surface text-[11px] font-semibold">
                {m.n}
              </text>
            </g>
          );
        })}
        <path d={path} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hp && hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-faint" />
            {hp.value != null && <circle cx={x(hover)} cy={y(hp.value)} r={4.5} className="fill-accent stroke-surface" strokeWidth={2} />}
          </g>
        )}
      </svg>
      {hp && hover != null && (
        <div
          className="pointer-events-none absolute top-10 z-10 w-max max-w-56 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md"
          style={x(hover) > width / 2 ? { right: width - x(hover) + 10 } : { left: x(hover) + 10 }}
        >
          <div className="text-muted">{fmtDate(hp.date)}</div>
          <div className="text-sm font-semibold tabular-nums">{fmtMetric(metric, hp.value)}</div>
          {hoverMarkers.map((m) => (
            <div key={m.n} className="mt-1 text-muted">
              <span className="font-semibold text-ink">{m.n}</span> {m.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
