import { addDays } from "./dates";

export type Day = {
  date: string;
  views: number;
  watchMinutes: number;
  avgViewDuration: number;
  /** Average percentage of the video watched per view. */
  avgViewPct: number | null;
  subsGained: number;
  impressions: number | null;
  ctr: number | null;
};

export type MetricKey = "ctr" | "views" | "impressions" | "avgViewDuration" | "avgViewPct" | "watchMinutes";

export const METRICS: { key: MetricKey; label: string; unit: "pct" | "count" | "duration" | "minutes" }[] = [
  { key: "ctr", label: "Click-through rate", unit: "pct" },
  { key: "views", label: "Views / day", unit: "count" },
  { key: "impressions", label: "Impressions / day", unit: "count" },
  { key: "avgViewDuration", label: "Avg view duration", unit: "duration" },
  { key: "avgViewPct", label: "Avg % viewed", unit: "pct" },
  { key: "watchMinutes", label: "Watch time / day", unit: "minutes" },
];

/** One number for a metric over a set of days; rates are weighted, not averaged. */
export function aggregate(days: Day[], key: MetricKey): number | null {
  if (days.length === 0) return null;
  const sum = (f: (d: Day) => number) => days.reduce((s, d) => s + f(d), 0);
  switch (key) {
    case "ctr": {
      const withData = days.filter((d) => d.impressions != null && d.ctr != null);
      const imp = withData.reduce((s, d) => s + d.impressions!, 0);
      return imp > 0 ? withData.reduce((s, d) => s + d.impressions! * d.ctr!, 0) / imp : null;
    }
    case "impressions": {
      const withData = days.filter((d) => d.impressions != null);
      return withData.length ? withData.reduce((s, d) => s + d.impressions!, 0) / withData.length : null;
    }
    case "avgViewDuration": {
      const v = sum((d) => d.views);
      return v > 0 ? sum((d) => d.views * d.avgViewDuration) / v : null;
    }
    case "avgViewPct": {
      const withData = days.filter((d) => d.avgViewPct != null);
      const v = withData.reduce((s, d) => s + d.views, 0);
      return v > 0 ? withData.reduce((s, d) => s + d.views * d.avgViewPct!, 0) / v : null;
    }
    case "views":
      return sum((d) => d.views) / days.length;
    case "watchMinutes":
      return sum((d) => d.watchMinutes) / days.length;
  }
}

export type MetricImpact = { key: MetricKey; before: number | null; after: number | null; deltaPct: number | null };
export type Impact = {
  window: number;
  daysBefore: number;
  daysAfter: number;
  /** Enough days on both sides to say anything at all. */
  ready: boolean;
  metrics: MetricImpact[];
};

export const MIN_DAYS = 3;

/**
 * Compare the `window` days before a change with the `window` days after it.
 * The change day itself is left out: it is part old version, part new.
 */
export function computeImpact(days: Day[], changeDate: string, window: number): Impact {
  const before = days.filter((d) => d.date >= addDays(changeDate, -window) && d.date < changeDate);
  const after = days.filter((d) => d.date > changeDate && d.date <= addDays(changeDate, window));
  const metrics = METRICS.map(({ key }) => {
    const b = aggregate(before, key);
    const a = aggregate(after, key);
    return { key, before: b, after: a, deltaPct: a != null && b != null && b !== 0 ? ((a - b) / b) * 100 : null };
  });
  return {
    window,
    daysBefore: before.length,
    daysAfter: after.length,
    ready: before.length >= MIN_DAYS && after.length >= MIN_DAYS,
    metrics,
  };
}
