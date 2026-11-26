import { addDays, daysBetween, ptDate } from "./dates";
import { db } from "./db";
import { demoRetention } from "./demo";
import { MIN_DAYS } from "./impact";
import { accessToken, DATA_LAG_DAYS } from "./sync";
import { getRetention, type RetentionPoint } from "./youtube";

export type Range = { start: string; end: string };

/**
 * Before and after ranges around a change, matching computeImpact: the change day is left out.
 * The after range stops at the last day with analytics and is null until it has MIN_DAYS days.
 */
export function retentionRanges(changeDate: string, window: number, today: string): { before: Range; after: Range | null; daysAfter: number } {
  const lastDay = addDays(today, -DATA_LAG_DAYS);
  const afterStart = addDays(changeDate, 1);
  const wanted = addDays(changeDate, window);
  const afterEnd = wanted < lastDay ? wanted : lastDay;
  const daysAfter = Math.max(0, daysBetween(afterStart, afterEnd) + 1);
  return {
    before: { start: addDays(changeDate, -window), end: addDays(changeDate, -1) },
    after: daysAfter >= MIN_DAYS ? { start: afterStart, end: afterEnd } : null,
    daysAfter,
  };
}

/** The most recent `days` days with analytics. */
export const recentRange = (days: number, today: string): Range => {
  const end = addDays(today, -DATA_LAG_DAYS);
  return { start: addDays(end, -(days - 1)), end };
};

// A range's numbers keep settling for a few days after it ends; after that the cached curve is final.
const SETTLE_DAYS = 3;
const REFRESH_MS = 12 * 60 * 60 * 1000;

/**
 * Retention curve for a video over a range, cached in retention_curves. Settled ranges are never
 * fetched again; recent ones are refreshed at most every 12 hours. Falls back to a stale cached
 * curve if YouTube can't be reached.
 */
export async function retentionCurve(channel: { id: string; isDemo: boolean }, videoId: string, range: Range): Promise<RetentionPoint[]> {
  if (channel.isDemo) return demoRetention(videoId, range);
  const c = await db();
  const key = [videoId, range.start, range.end];
  const row = (await c.execute({ sql: "SELECT points, fetched_at FROM retention_curves WHERE video_id = ? AND start_date = ? AND end_date = ?", args: key })).rows[0];
  const cached = row ? (JSON.parse(String(row.points)) as RetentionPoint[]) : null;
  if (row) {
    const fetchedAt = String(row.fetched_at);
    const settled = ptDate(new Date(fetchedAt)) >= addDays(range.end, SETTLE_DAYS);
    if (settled || Date.now() - Date.parse(fetchedAt) < REFRESH_MS) return cached!;
  }
  try {
    const points = await getRetention(await accessToken(channel.id), videoId, range.start, range.end);
    await c.execute({
      sql: "INSERT OR REPLACE INTO retention_curves (video_id, start_date, end_date, points, fetched_at) VALUES (?, ?, ?, ?, ?)",
      args: [...key, JSON.stringify(points), new Date().toISOString()],
    });
    return points;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

/** Share of viewers still watching at a position (0 to 1), from the nearest point. */
export function watchingAt(points: RetentionPoint[], at: number): number | null {
  if (points.length === 0) return null;
  return points.reduce((best, p) => (Math.abs(p.at - at) < Math.abs(best.at - at) ? p : best)).watching;
}

/** Mean of the curve: roughly the average share of the video watched. */
export const curveMean = (points: RetentionPoint[]) => (points.length ? points.reduce((s, p) => s + p.watching, 0) / points.length : null);

/** Mean relative retention, 0 to 1 with 0.5 typical for videos of similar length. */
export function relativeMean(points: RetentionPoint[]): number | null {
  const r = points.filter((p) => p.relative != null);
  return r.length ? r.reduce((s, p) => s + p.relative!, 0) / r.length : null;
}
