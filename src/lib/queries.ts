import { db } from "./db";
import type { Day } from "./impact";

export type Visibility = "public" | "scheduled" | "unlisted" | "private";

/** A private video with a release time is scheduled. Unknown status counts as public. */
export function visibilityOf(privacyStatus: string | null, publishAt: string | null): Visibility {
  if (privacyStatus === "private") return publishAt ? "scheduled" : "private";
  if (privacyStatus === "unlisted") return "unlisted";
  return "public";
}

/** SQL condition for videos shown in the main change log and video list. */
const IS_PUBLIC = "(v.privacy_status IS NULL OR v.privacy_status = 'public')";

export type VideoRow = {
  id: string;
  title: string;
  publishedAt: string | null;
  publishAt: string | null;
  visibility: Visibility;
  thumbnailHash: string | null;
  changeCount: number;
  views28: number;
};

/** `manual` items were recorded by the creator rather than detected by a sync, so they can be deleted. */
export type ChangeItem = { id: string; field: string; oldValue: string | null; newValue: string | null; manual: boolean };
/** Everything detected on one video in one sync: the unit creators think of as "a change". */
export type ChangeGroup = {
  key: string;
  videoId: string;
  videoTitle: string;
  thumbnailHash: string | null;
  changeDate: string;
  detectedAt: string;
  items: ChangeItem[];
};

export async function listVideos(channelId: string, since28: string): Promise<VideoRow[]> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT v.id, v.title, v.published_at, v.publish_at, v.privacy_status, v.thumbnail_hash,
            (SELECT COUNT(DISTINCT detected_at) FROM changes ch WHERE ch.video_id = v.id AND ch.field != 'note') AS change_count,
            (SELECT COALESCE(SUM(views), 0) FROM daily_metrics m WHERE m.video_id = v.id AND m.date >= ?) AS views28
          FROM videos v WHERE v.channel_id = ? ORDER BY v.published_at DESC`,
    args: [since28, channelId],
  });
  return r.rows.map((x) => ({
    id: String(x.id),
    title: String(x.title),
    publishedAt: x.published_at as string | null,
    publishAt: x.publish_at as string | null,
    visibility: visibilityOf(x.privacy_status as string | null, x.publish_at as string | null),
    thumbnailHash: x.thumbnail_hash as string | null,
    changeCount: Number(x.change_count),
    views28: Number(x.views28),
  }));
}

export async function listChangeGroups(
  channelId: string,
  opts: { videoId?: string; limit?: number; publicOnly?: boolean } = {},
): Promise<ChangeGroup[]> {
  const c = await db();
  const r = await c.execute({
    sql: `SELECT ch.id, ch.video_id, ch.field, ch.old_value, ch.new_value, ch.source, ch.detected_at, ch.change_date, v.title, v.thumbnail_hash
          FROM changes ch JOIN videos v ON v.id = ch.video_id
          WHERE ch.channel_id = ? ${opts.videoId ? "AND ch.video_id = ?" : ""} ${opts.publicOnly ? `AND ${IS_PUBLIC}` : ""}
          ORDER BY ch.detected_at DESC, ch.field`,
    args: opts.videoId ? [channelId, opts.videoId] : [channelId],
  });
  const groups = new Map<string, ChangeGroup>();
  for (const x of r.rows) {
    const key = `${x.video_id}|${x.detected_at}`;
    let g = groups.get(key);
    if (!g) {
      if (opts.limit && groups.size >= opts.limit) break;
      g = {
        key,
        videoId: String(x.video_id),
        videoTitle: String(x.title),
        thumbnailHash: x.thumbnail_hash as string | null,
        changeDate: String(x.change_date),
        detectedAt: String(x.detected_at),
        items: [],
      };
      groups.set(key, g);
    }
    g.items.push({
      id: String(x.id),
      field: String(x.field),
      oldValue: x.old_value as string | null,
      newValue: x.new_value as string | null,
      manual: x.source === "manual" || x.field === "note",
    });
  }
  return [...groups.values()];
}

export async function getVideo(channelId: string, id: string) {
  const c = await db();
  const x = (await c.execute({ sql: "SELECT id, title, published_at, thumbnail_hash FROM videos WHERE id = ? AND channel_id = ?", args: [id, channelId] })).rows[0];
  return x ? { id: String(x.id), title: String(x.title), publishedAt: x.published_at as string | null, thumbnailHash: x.thumbnail_hash as string | null } : null;
}

export async function getDays(videoIds: string[]): Promise<Map<string, Day[]>> {
  const out = new Map<string, Day[]>();
  if (videoIds.length === 0) return out;
  const c = await db();
  const r = await c.execute({
    sql: `SELECT video_id, date, views, watch_minutes, avg_view_duration, avg_view_pct, subs_gained, impressions, ctr
          FROM daily_metrics WHERE video_id IN (${videoIds.map(() => "?").join(",")}) ORDER BY date`,
    args: videoIds,
  });
  for (const x of r.rows) {
    const id = String(x.video_id);
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push({
      date: String(x.date),
      views: Number(x.views),
      watchMinutes: Number(x.watch_minutes),
      avgViewDuration: Number(x.avg_view_duration),
      avgViewPct: x.avg_view_pct == null ? null : Number(x.avg_view_pct),
      subsGained: Number(x.subs_gained),
      impressions: x.impressions == null ? null : Number(x.impressions),
      ctr: x.ctr == null ? null : Number(x.ctr),
    });
  }
  return out;
}
