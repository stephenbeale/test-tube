const DATA = "https://www.googleapis.com/youtube/v3";
const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function get<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) {
    let msg = await res.text();
    try {
      msg = JSON.parse(msg).error?.message ?? msg;
    } catch {}
    throw new ApiError(res.status, `YouTube API ${res.status}: ${msg}`);
  }
  return res.json();
}

export type ChannelInfo = { id: string; title: string; uploadsPlaylistId: string };

export async function getMyChannel(token: string): Promise<ChannelInfo | null> {
  const r = await get<{ items?: { id: string; snippet: { title: string }; contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(
    `${DATA}/channels?part=snippet,contentDetails&mine=true`,
    token,
  );
  const c = r.items?.[0];
  return c ? { id: c.id, title: c.snippet.title, uploadsPlaylistId: c.contentDetails.relatedPlaylists.uploads } : null;
}

/**
 * Newest-first, de-duplicated video ids from the uploads playlist. 1 quota unit per 50 videos.
 * Deeper pages of an uploads playlist can repeat videos from earlier pages, so ids are collected
 * into a set and paging continues (up to a fixed page budget) until `max` distinct ids are found.
 */
export async function listUploadIds(token: string, playlistId: string, max: number): Promise<string[]> {
  const ids = new Set<string>();
  const maxPages = Math.max(4, Math.ceil(max / 50) * 2);
  let pageToken = "";
  for (let page = 0; page < maxPages && ids.size < max; page++) {
    const r = await get<{ items: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>(
      `${DATA}/playlistItems?part=contentDetails&maxResults=50&playlistId=${playlistId}${pageToken && `&pageToken=${pageToken}`}`,
      token,
    );
    for (const i of r.items) ids.add(i.contentDetails.videoId);
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return [...ids].slice(0, max);
}

export type VideoState = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string | null;
  privacyStatus: string | null;
  /** Scheduled release time, set while a private video is scheduled to go public. */
  publishAt: string | null;
  publishedAt: string | null;
  thumbnailUrl: string | null;
};

type ApiVideo = {
  id: string;
  snippet: {
    title: string;
    description?: string;
    tags?: string[];
    categoryId?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url: string }>;
  };
  status?: { privacyStatus?: string; publishAt?: string };
};

export async function getVideos(token: string, requested: string[]): Promise<VideoState[]> {
  const ids = [...new Set(requested)];
  const seen = new Set<string>();
  const out: VideoState[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await get<{ items: ApiVideo[] }>(`${DATA}/videos?part=snippet,status&maxResults=50&id=${ids.slice(i, i + 50).join(",")}`, token);
    for (const v of r.items) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      out.push({
        id: v.id,
        title: v.snippet.title,
        description: v.snippet.description ?? "",
        tags: v.snippet.tags ?? [],
        categoryId: v.snippet.categoryId ?? null,
        privacyStatus: v.status?.privacyStatus ?? null,
        publishAt: v.status?.publishAt ?? null,
        publishedAt: v.snippet.publishedAt ?? null,
        // Always the same size: comparing different sizes would look like a change.
        thumbnailUrl: v.snippet.thumbnails?.high?.url ?? v.snippet.thumbnails?.default?.url ?? null,
      });
    }
  }
  return out;
}

export type DailyRow = {
  date: string;
  views: number;
  watchMinutes: number;
  avgViewDuration: number;
  avgViewPct: number | null;
  subsGained: number;
  impressions: number | null;
  ctr: number | null;
};

const CORE = ["views", "estimatedMinutesWatched", "averageViewDuration", "averageViewPercentage", "subscribersGained"];
// Thumbnail impressions and click-through rate. Reports differ on whether the
// Analytics API accepts these for every channel, so callers fall back to CORE.
const REACH = ["videoThumbnailImpressions", "videoThumbnailImpressionsClickRate"];

async function report(token: string, videoId: string, start: string, end: string, metrics: string[], dimension = "day") {
  const p = new URLSearchParams({
    ids: "channel==MINE",
    startDate: start,
    endDate: end,
    dimensions: dimension,
    filters: `video==${videoId}`,
    metrics: metrics.join(","),
    sort: dimension,
  });
  return get<{ columnHeaders: { name: string }[]; rows?: (string | number)[][] }>(`${ANALYTICS}?${p}`, token);
}

/**
 * Daily metrics for one video. `reach` says whether to ask for impressions/CTR;
 * the returned `reach` says whether the API accepted them.
 */
export async function getDailyMetrics(
  token: string,
  videoId: string,
  start: string,
  end: string,
  reach: boolean,
): Promise<{ rows: DailyRow[]; reach: boolean }> {
  let r;
  if (reach) {
    try {
      r = await report(token, videoId, start, end, [...CORE, ...REACH]);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 400) throw e;
      reach = false;
    }
  }
  r ??= await report(token, videoId, start, end, CORE);
  const col = Object.fromEntries(r.columnHeaders.map((h, i) => [h.name, i]));
  const num = (row: (string | number)[], name: string) => (name in col ? Number(row[col[name]]) : null);
  const rows = (r.rows ?? []).map((row) => ({
    date: String(row[col.day]),
    views: num(row, "views") ?? 0,
    watchMinutes: num(row, "estimatedMinutesWatched") ?? 0,
    avgViewDuration: num(row, "averageViewDuration") ?? 0,
    avgViewPct: num(row, "averageViewPercentage"),
    subsGained: num(row, "subscribersGained") ?? 0,
    impressions: num(row, REACH[0]),
    ctr: num(row, REACH[1]),
  }));
  return { rows: normaliseCtr(rows), reach };
}

/** Store CTR as a percentage whether the API reports 0.052 or 5.2. */
export function normaliseCtr(rows: DailyRow[]): DailyRow[] {
  const max = Math.max(0, ...rows.map((r) => r.ctr ?? 0));
  if (max === 0 || max > 1) return rows;
  return rows.map((r) => (r.ctr == null ? r : { ...r, ctr: r.ctr * 100 }));
}

export type RetentionPoint = {
  /** Position in the video, 0 to 1. */
  at: number;
  /** Viewers still watching at this point, relative to views; above 1 means rewatching. */
  watching: number;
  /** 0 to 1 against YouTube videos of similar length; 0.5 is typical. Null if not reported. */
  relative: number | null;
};

/**
 * Audience retention curve for one video over a date range: up to 100 points from start to end.
 * Empty when YouTube has too few views to report it.
 */
export async function getRetention(token: string, videoId: string, start: string, end: string): Promise<RetentionPoint[]> {
  const dim = "elapsedVideoTimeRatio";
  let r;
  try {
    r = await report(token, videoId, start, end, ["audienceWatchRatio", "relativeRetentionPerformance"], dim);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 400) throw e;
    r = await report(token, videoId, start, end, ["audienceWatchRatio"], dim);
  }
  const col = Object.fromEntries(r.columnHeaders.map((h, i) => [h.name, i]));
  return (r.rows ?? []).map((row) => ({
    at: Number(row[col[dim]]),
    watching: Number(row[col.audienceWatchRatio]),
    relative: "relativeRetentionPerformance" in col ? Number(row[col.relativeRetentionPerformance]) : null,
  }));
}
