import type { InStatement } from "@libsql/client";
import { db } from "./db";
import { newId, sha256 } from "./crypto";
import { addDays, ptDate } from "./dates";
import type { RetentionPoint } from "./youtube";

export const DEMO_USER = "demo-user";
export const DEMO_CHANNEL = "demo-channel";

type DemoChange = { day: number; ctr?: number; views?: number; title?: [string, string]; thumb?: boolean; description?: [string, string]; tags?: [string[], string[]]; note?: string };
type DemoVideo = { id: string; title: string; age: number; impressions: number; ctr: number; avd: number; hue: number; label: string; changes: DemoChange[] };

// `day` is days before today (negative). `ctr`/`views` are the lasting multipliers a change causes.
const VIDEOS: DemoVideo[] = [
  { id: "demo-keyboard", title: "I Built a Mechanical Keyboard From Scratch", age: 120, impressions: 5200, ctr: 4.1, avd: 312, hue: 265, label: "KEYBOARD", changes: [
    { day: -40, ctr: 1.42, thumb: true },
    { day: -25, views: 1.0, note: "Mentioned in the newsletter" },
  ] },
  { id: "demo-desk", title: "5 Desk Setup Mistakes Everyone Makes", age: 75, impressions: 6800, ctr: 3.6, avd: 268, hue: 20, label: "DESK", changes: [
    { day: -21, ctr: 1.27, thumb: true, title: ["My Desk Setup Tour 2026", "5 Desk Setup Mistakes Everyone Makes"] },
  ] },
  { id: "demo-webcam", title: "Is the $40 Webcam Actually Good?", age: 60, impressions: 4300, ctr: 5.2, avd: 221, hue: 160, label: "WEBCAM", changes: [
    { day: -30, ctr: 0.81, thumb: true },
    { day: -12, ctr: 1.36, thumb: true },
  ] },
  { id: "demo-cables", title: "Cable Management for People Who Hate It", age: 50, impressions: 3900, ctr: 4.7, avd: 345, hue: 45, label: "CABLES", changes: [
    { day: -16, description: ["Tidy cables, fast.", "Tidy cables, fast.\n\nChapters:\n0:00 The mess\n1:12 Under-desk tray\n4:40 Velcro everything\n\nGear list in the pinned comment."], tags: [["cable management", "desk"], ["cable management", "desk", "desk setup", "home office", "tidy"]] },
  ] },
  { id: "demo-monitor", title: "This Monitor Deserves More Attention", age: 30, impressions: 7400, ctr: 4.4, avd: 290, hue: 210, label: "MONITOR", changes: [
    { day: -4, ctr: 1.1, title: ["The Monitor Nobody Talks About", "This Monitor Deserves More Attention"] },
  ] },
  { id: "demo-studio", title: "Studio Tour: One Year Later", age: 14, impressions: 9100, ctr: 6.1, avd: 402, hue: 330, label: "STUDIO", changes: [] },
];

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function thumbSvg(v: DemoVideo, version: number): string {
  const hue = (v.hue + version * 47) % 360;
  const layouts = [
    `<text x="32" y="150" font-size="64">${v.label}</text><text x="32" y="200" font-size="26" opacity=".8">version ${version + 1}</text>`,
    `<circle cx="370" cy="135" r="80" fill="hsl(${(hue + 180) % 360} 85% 60%)"/><text x="28" y="120" font-size="54">${v.label}</text><text x="28" y="175" font-size="40">?!</text>`,
    `<rect x="24" y="24" width="432" height="222" rx="18" fill="none" stroke="#fff" stroke-width="8"/><text x="240" y="155" font-size="58" text-anchor="middle">${v.label}</text>`,
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270" font-family="Arial, sans-serif" font-weight="800" fill="#fff"><rect width="480" height="270" fill="hsl(${hue} 65% ${38 + version * 6}%)"/>${layouts[version % layouts.length]}</svg>`;
}

/** Rebuild the demo channel with data ending today, so the demo never goes stale. */
export async function seedDemo(): Promise<void> {
  const c = await db();
  const today = ptDate();
  const existing = (await c.execute({ sql: "SELECT last_synced_at FROM channels WHERE id = ?", args: [DEMO_CHANNEL] })).rows[0];
  if (existing && String(existing.last_synced_at).slice(0, 10) === new Date().toISOString().slice(0, 10)) return;

  const now = new Date().toISOString();
  const stmts: InStatement[] = [
    { sql: "DELETE FROM daily_metrics WHERE video_id IN (SELECT id FROM videos WHERE channel_id = ?)", args: [DEMO_CHANNEL] },
    { sql: "DELETE FROM thumbnails WHERE video_id IN (SELECT id FROM videos WHERE channel_id = ?)", args: [DEMO_CHANNEL] },
    { sql: "DELETE FROM changes WHERE channel_id = ?", args: [DEMO_CHANNEL] },
    { sql: "DELETE FROM videos WHERE channel_id = ?", args: [DEMO_CHANNEL] },
    { sql: "INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, 'Demo creator', ?)", args: [DEMO_USER, now] },
    { sql: "INSERT OR REPLACE INTO channels (id, user_id, title, is_demo, reach_metrics, last_synced_at) VALUES (?, ?, 'Deskcraft (demo channel)', 1, 1, ?)", args: [DEMO_CHANNEL, DEMO_USER, now] },
  ];

  VIDEOS.forEach((v, vi) => {
    const rand = rng(1000 + vi);
    const noise = (spread: number) => 1 + (rand() * 2 - 1) * spread;
    const changes = [...v.changes].sort((a, b) => a.day - b.day);

    // Thumbnails: one version per thumbnail change, oldest first.
    const versions = changes.filter((ch) => ch.thumb).length + 1;
    const hashes = Array.from({ length: versions }, (_, n) => {
      const svg = thumbSvg(v, n);
      const hash = sha256(v.id + svg);
      stmts.push({ sql: "INSERT OR REPLACE INTO thumbnails (hash, video_id, content_type, data, created_at) VALUES (?, ?, 'image/svg+xml', ?, ?)", args: [hash, v.id, new TextEncoder().encode(svg), now] });
      return hash;
    });

    stmts.push({
      sql: "INSERT INTO videos (id, channel_id, title, description, tags, category_id, privacy_status, published_at, thumbnail_hash, first_seen_at) VALUES (?, ?, ?, '', '[]', '28', 'public', ?, ?, ?)",
      args: [v.id, DEMO_CHANNEL, v.title, `${addDays(today, -v.age)}T16:00:00Z`, hashes[versions - 1], now],
    });

    let thumbVersion = 0;
    for (const ch of changes) {
      const date = addDays(today, ch.day);
      const detectedAt = `${date}T18:00:00.000Z`;
      const add = (field: string, oldValue: string | null, newValue: string | null) =>
        stmts.push({ sql: "INSERT INTO changes (id, video_id, channel_id, field, old_value, new_value, detected_at, change_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", args: [newId(), v.id, DEMO_CHANNEL, field, oldValue, newValue, detectedAt, date] });
      if (ch.thumb) add("thumbnail", hashes[thumbVersion], hashes[++thumbVersion]);
      if (ch.title) add("title", ch.title[0], ch.title[1]);
      if (ch.description) add("description", ch.description[0], ch.description[1]);
      if (ch.tags) add("tags", JSON.stringify(ch.tags[0]), JSON.stringify(ch.tags[1]));
      if (ch.note) add("note", null, ch.note);
    }

    for (let day = -Math.min(v.age, 92); day <= -2; day++) {
      const date = addDays(today, day);
      const age = v.age + day;
      const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) ? 1.15 : 1;
      const applied = changes.filter((ch) => ch.day < day);
      const ctrMult = applied.reduce((m, ch) => m * (ch.ctr ?? 1), 1);
      const newsletter = changes.some((ch) => ch.note && day >= ch.day && day <= ch.day + 2) ? 1.6 : 1;
      const impressions = Math.round(v.impressions * (0.4 + 0.6 * Math.exp(-age / 30)) * weekend * noise(0.1));
      const ctr = v.ctr * ctrMult * noise(0.06);
      const views = Math.round(((impressions * ctr) / 100) * 1.2 * newsletter);
      const avd = v.avd * noise(0.04);
      // Implied length of avd + 5 minutes, so % viewed tracks duration.
      const avgPct = (avd / (v.avd + 300)) * 100;
      stmts.push({
        sql: "INSERT OR REPLACE INTO daily_metrics (video_id, date, views, watch_minutes, avg_view_duration, avg_view_pct, subs_gained, impressions, ctr) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [v.id, date, views, (views * avd) / 60, avd, avgPct, Math.round(views * 0.004), impressions, ctr],
      });
    }
  });
  await c.batch(stmts, "write");
}

/**
 * A plausible retention curve for a demo video: a sharp drop in the first seconds, a steady decline,
 * then a dip at the end screen. Its mean matches the video's average % viewed, nudged per range so
 * before and after differ. Empty for ranges before the video was published.
 */
export function demoRetention(videoId: string, range: { start: string; end: string }): RetentionPoint[] {
  const v = VIDEOS.find((x) => x.id === videoId);
  if (!v || range.end < addDays(ptDate(), -v.age)) return [];
  const rand = rng([...videoId, ...range.start].reduce((h, ch) => Math.imul(h, 31) + ch.charCodeAt(0), 7));
  // Small nudge only: the demo daily % viewed stays flat across changes, so the curves should too.
  const target = (v.avd / (v.avd + 300)) * (0.98 + rand() * 0.04);
  // Early drop of `hook`, then exponential decay with rate k; find k so the mean hits target.
  const hook = 0.28;
  const mean = (k: number) => (1 - hook) * ((1 - Math.exp(-k)) / k) + hook / 30;
  let lo = 0.01;
  let hi = 20;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (mean(mid) > target) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  const relative = Math.min(0.95, Math.max(0.05, 0.5 + (target - 0.45) * 2.5));
  return Array.from({ length: 100 }, (_, i) => {
    const at = (i + 1) / 100;
    const endScreen = at > 0.94 ? 1 - (at - 0.94) * 6 : 1;
    const watching = ((1 - hook) * Math.exp(-k * at) + hook * Math.exp(-30 * at)) * endScreen * (1 + (rand() - 0.5) * 0.03);
    return { at, watching, relative: Math.min(1, Math.max(0, relative + (rand() - 0.5) * 0.1)) };
  });
}
