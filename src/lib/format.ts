import type { MetricKey } from "./impact";
import { METRICS } from "./impact";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export function fmtMetric(key: MetricKey, v: number | null): string {
  if (v == null) return "–";
  switch (METRICS.find((m) => m.key === key)!.unit) {
    case "pct":
      return `${v.toFixed(1)}%`;
    case "duration":
      return `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}`;
    case "minutes":
      return v >= 120 ? `${(v / 60).toFixed(1)} h` : `${plain.format(v)} min`;
    default:
      return v >= 10000 ? compact.format(v) : plain.format(v);
  }
}

export function fmtDelta(pct: number | null): string {
  if (pct == null) return "–";
  const r = Math.abs(pct) >= 10 ? pct.toFixed(0) : pct.toFixed(1);
  return `${pct > 0 ? "+" : ""}${r}%`;
}

const dateFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const dateYearFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const fmtDate = (d: string) => dateFmt.format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
export const fmtDateYear = (d: string) => dateYearFmt.format(new Date(`${d.slice(0, 10)}T00:00:00Z`));

export const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  description: "Description",
  tags: "Tags",
  category: "Category",
  privacy: "Visibility",
  thumbnail: "Thumbnail",
  note: "Note",
};
