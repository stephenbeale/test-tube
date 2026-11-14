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

/** Newest-first video ids from the uploads playlist. 1 quota unit per 50 videos. */
export async function listUploadIds(token: string, playlistId: string, max: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = "";
  while (ids.length < max) {
    const r = await get<{ items: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>(
      `${DATA}/playlistItems?part=contentDetails&maxResults=50&playlistId=${playlistId}${pageToken && `&pageToken=${pageToken}`}`,
      token,
    );
    ids.push(...r.items.map((i) => i.contentDetails.videoId));
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  return ids.slice(0, max);
}

export type VideoState = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string | null;
  privacyStatus: string | null;
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
  status?: { privacyStatus?: string };
};

export async function getVideos(token: string, ids: string[]): Promise<VideoState[]> {
  const out: VideoState[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await get<{ items: ApiVideo[] }>(`${DATA}/videos?part=snippet,status&maxResults=50&id=${ids.slice(i, i + 50).join(",")}`, token);
    for (const v of r.items) {
      out.push({
        id: v.id,
        title: v.snippet.title,
        description: v.snippet.description ?? "",
        tags: v.snippet.tags ?? [],
        categoryId: v.snippet.categoryId ?? null,
        privacyStatus: v.status?.privacyStatus ?? null,
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
  subsGained: number;
  impressions: number | null;
  ctr: number | null;
};

const CORE = ["views", "estimatedMinutesWatched", "averageViewDuration", "subscribersGained"];
// Thumbnail impressions and click-through rate. Reports differ on whether the
// Analytics API accepts these for every channel, so callers fall back to CORE.
const REACH = ["videoThumbnailImpressions", "videoThumbnailImpressionsClickRate"];

async function report(token: string, videoId: string, start: string, end: string, metrics: string[]) {
  const p = new URLSearchParams({
    ids: "channel==MINE",
    startDate: start,
    endDate: end,
    dimensions: "day",
    filters: `video==${videoId}`,
    metrics: metrics.join(","),
    sort: "day",
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
