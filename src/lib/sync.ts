import type { InStatement } from "@libsql/client";
import { db } from "./db";
import { decrypt, encrypt, newId, sha256 } from "./crypto";
import { addDays, ptDate } from "./dates";
import { diffVideo, type Tracked } from "./diff";
import { refreshAccessToken } from "./google";
import { getDailyMetrics, getVideos, listUploadIds, type VideoState } from "./youtube";

const MAX_VIDEOS = 200; // newest uploads watched for changes
const MAX_METRIC_VIDEOS = 40; // videos whose daily analytics are pulled per sync
const METRIC_DAYS = 90;
const DATA_LAG_DAYS = 2; // Analytics for the last couple of days is incomplete

async function accessToken(channelId: string): Promise<string> {
  const c = await db();
  const row = (await c.execute({ sql: "SELECT access_token_enc, refresh_token_enc, token_expires_at FROM channels WHERE id = ?", args: [channelId] })).rows[0];
  if (!row?.refresh_token_enc) throw new Error("Channel has no refresh token. Reconnect YouTube.");
  if (row.access_token_enc && Number(row.token_expires_at) > Date.now() + 60_000) return decrypt(String(row.access_token_enc));
  const t = await refreshAccessToken(decrypt(String(row.refresh_token_enc)));
  await c.execute({
    sql: "UPDATE channels SET access_token_enc = ?, token_expires_at = ? WHERE id = ?",
    args: [encrypt(t.access_token), Date.now() + t.expires_in * 1000, channelId],
  });
  return t.access_token;
}

async function fetchThumbnail(url: string | null) {
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    return { hash: sha256(data), data, type };
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export type SyncResult = { videos: number; newChanges: number; metricVideos: number };

// One sync per channel at a time in this process. The sign-in callback starts a sync in the background,
// and pressing "Sync now" while it runs would otherwise diff against the same snapshot twice.
const inFlight = new Map<string, Promise<SyncResult>>();

/** Snapshot the channel's videos, record what changed, and refresh daily analytics. */
export function syncChannel(channelId: string): Promise<SyncResult> {
  const running = inFlight.get(channelId);
  if (running) return running;
  const p = syncOnce(channelId).finally(() => inFlight.delete(channelId));
  inFlight.set(channelId, p);
  return p;
}

async function syncOnce(channelId: string): Promise<SyncResult> {
  const c = await db();
  try {
    const result = await runSync(channelId);
    await c.execute({ sql: "UPDATE channels SET last_synced_at = ?, last_sync_error = NULL WHERE id = ?", args: [new Date().toISOString(), channelId] });
    return result;
  } catch (e) {
    await c.execute({ sql: "UPDATE channels SET last_sync_error = ? WHERE id = ?", args: [e instanceof Error ? e.message : String(e), channelId] });
    throw e;
  }
}

async function runSync(channelId: string): Promise<SyncResult> {
  const c = await db();
  const token = await accessToken(channelId);
  const channel = (await c.execute({ sql: "SELECT uploads_playlist_id FROM channels WHERE id = ?", args: [channelId] })).rows[0];
  const ids = await listUploadIds(token, String(channel.uploads_playlist_id), MAX_VIDEOS);
  const videos = await getVideos(token, ids);
  const thumbs = await mapLimit(videos, 8, (v) => fetchThumbnail(v.thumbnailUrl));

  const existing = new Map(
    (await c.execute({ sql: "SELECT id, title, description, tags, category_id, privacy_status, thumbnail_hash FROM videos WHERE channel_id = ?", args: [channelId] })).rows.map(
      (r) => [String(r.id), r],
    ),
  );

  const now = new Date();
  const nowIso = now.toISOString();
  const today = ptDate(now);
  const stmts: InStatement[] = [];
  let newChanges = 0;

  videos.forEach((v: VideoState, i) => {
    const thumb = thumbs[i];
    const prev = existing.get(v.id);
    if (thumb) {
      stmts.push({
        sql: "INSERT OR IGNORE INTO thumbnails (hash, video_id, content_type, data, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [thumb.hash, v.id, thumb.type, thumb.data, nowIso],
      });
    }
    if (!prev) {
      // First sighting is the baseline, not a change.
      stmts.push({
        sql: "INSERT INTO videos (id, channel_id, title, description, tags, category_id, privacy_status, published_at, thumbnail_hash, first_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
        args: [v.id, channelId, v.title, v.description, JSON.stringify(v.tags), v.categoryId, v.privacyStatus, v.publishedAt, thumb?.hash ?? null, nowIso],
      });
      return;
    }
    const before: Tracked = {
      title: String(prev.title),
      description: String(prev.description),
      tags: JSON.parse(String(prev.tags)),
      categoryId: prev.category_id as string | null,
      privacyStatus: prev.privacy_status as string | null,
      thumbnailHash: prev.thumbnail_hash as string | null,
    };
    const thumbnailHash = thumb?.hash ?? before.thumbnailHash;
    const after: Tracked = { title: v.title, description: v.description, tags: v.tags, categoryId: v.categoryId, privacyStatus: v.privacyStatus, thumbnailHash };
    const changes = diffVideo(before, after);
    newChanges += changes.length;
    for (const ch of changes) {
      stmts.push({
        sql: "INSERT INTO changes (id, video_id, channel_id, field, old_value, new_value, detected_at, change_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [newId(), v.id, channelId, ch.field, ch.oldValue, ch.newValue, nowIso, today],
      });
    }
    if (changes.length > 0) {
      stmts.push({
        sql: "UPDATE videos SET title = ?, description = ?, tags = ?, category_id = ?, privacy_status = ?, thumbnail_hash = ? WHERE id = ?",
        args: [v.title, v.description, JSON.stringify(v.tags), v.categoryId, v.privacyStatus, thumbnailHash, v.id],
      });
    }
  });
  if (stmts.length) await c.batch(stmts, "write");

  // Analytics: every video with a recent change, then the newest uploads.
  const end = addDays(today, -DATA_LAG_DAYS);
  const start = addDays(end, -METRIC_DAYS);
  const changed = (await c.execute({ sql: "SELECT DISTINCT video_id FROM changes WHERE channel_id = ? AND change_date >= ?", args: [channelId, addDays(today, -60)] })).rows.map((r) =>
    String(r.video_id),
  );
  const targets = [...new Set([...changed, ...ids])].slice(0, MAX_METRIC_VIDEOS);

  // Ask for impressions/CTR afresh each sync; one rejected request turns it off for the rest of this run.
  let reach = true;
  for (const videoId of targets) {
    const r = await getDailyMetrics(token, videoId, start, end, reach);
    reach = r.reach;
    if (r.rows.length === 0) continue;
    await c.batch(
      r.rows.map((d) => ({
        sql: "INSERT OR REPLACE INTO daily_metrics (video_id, date, views, watch_minutes, avg_view_duration, subs_gained, impressions, ctr) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [videoId, d.date, d.views, d.watchMinutes, d.avgViewDuration, d.subsGained, d.impressions, d.ctr],
      })),
      "write",
    );
  }
  await c.execute({ sql: "UPDATE channels SET reach_metrics = ? WHERE id = ?", args: [reach ? 1 : 0, channelId] });

  return { videos: videos.length, newChanges, metricVideos: targets.length };
}
