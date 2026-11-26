import assert from "node:assert/strict";
import { test } from "node:test";
import { diffTags, diffVideo, type Tracked } from "../src/lib/diff";
import { aggregate, computeImpact, type Day } from "../src/lib/impact";
import { addDays, daysBetween } from "../src/lib/dates";
import { getRetention, getVideos, listUploadIds, normaliseCtr } from "../src/lib/youtube";
import { curveMean, retentionRanges, watchingAt } from "../src/lib/retention";
import { demoRetention } from "../src/lib/demo";

const base: Tracked = { title: "A", description: "d", tags: ["x"], categoryId: "28", privacyStatus: "public", thumbnailHash: "h1" };
const day = (date: string, impressions: number | null, ctr: number | null, views = 100): Day => ({ date, views, watchMinutes: views * 2, avgViewDuration: 120, avgViewPct: 40, subsGained: 0, impressions, ctr });

test("diffVideo reports only fields that changed", () => {
  assert.deepEqual(diffVideo(base, base), []);
  const changes = diffVideo(base, { ...base, title: "B", thumbnailHash: "h2", tags: ["x", "y"] });
  assert.deepEqual(changes.map((c) => c.field).sort(), ["tags", "thumbnail", "title"]);
  assert.deepEqual(changes.find((c) => c.field === "title"), { field: "title", oldValue: "A", newValue: "B" });
});

test("a failed thumbnail download is not a change", () => {
  assert.deepEqual(diffVideo(base, { ...base, thumbnailHash: null }), []);
  assert.deepEqual(diffVideo({ ...base, thumbnailHash: null }, base), []);
});

test("diffTags lists added and removed", () => {
  assert.deepEqual(diffTags('["a","b"]', '["b","c"]'), { added: ["c"], removed: ["a"] });
});

test("CTR is weighted by impressions, not averaged per day", () => {
  const ctr = aggregate([day("2026-01-01", 1000, 10), day("2026-01-02", 9000, 2)], "ctr");
  assert.equal(ctr, 2.8);
  assert.equal(aggregate([day("2026-01-01", null, null)], "ctr"), null);
});

test("computeImpact compares the windows either side and skips the change day", () => {
  const days: Day[] = [];
  for (let i = -10; i <= 10; i++) days.push(day(addDays("2026-03-15", i), 1000, i < 0 ? 4 : i === 0 ? 99 : 6, i < 0 ? 100 : 150));
  const impact = computeImpact(days, "2026-03-15", 7);
  assert.equal(impact.daysBefore, 7);
  assert.equal(impact.daysAfter, 7);
  assert.equal(impact.ready, true);
  const ctr = impact.metrics.find((m) => m.key === "ctr")!;
  assert.equal(ctr.before, 4);
  assert.equal(ctr.after, 6);
  assert.equal(Math.round(ctr.deltaPct!), 50);
  assert.equal(Math.round(impact.metrics.find((m) => m.key === "views")!.deltaPct!), 50);
});

test("computeImpact is not ready with too few days after", () => {
  const days = [-5, -4, -3, -2, -1, 1, 2].map((i) => day(addDays("2026-03-15", i), 1000, 5));
  const impact = computeImpact(days, "2026-03-15", 7);
  assert.equal(impact.daysAfter, 2);
  assert.equal(impact.ready, false);
});

test("normaliseCtr converts ratios to percentages and leaves percentages alone", () => {
  assert.equal(normaliseCtr([day("2026-01-01", 100, 0.052)])[0].ctr, 5.2);
  assert.equal(normaliseCtr([day("2026-01-01", 100, 5.2)])[0].ctr, 5.2);
});

test("date helpers cross month boundaries", () => {
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-02-27", "2026-03-02"), 3);
});

test("listUploadIds and getVideos drop videos repeated across playlist pages", async () => {
  // Page 3 repeats a video from page 1, as the real uploads playlist was seen to do.
  const pages = [["a", "b"], ["c", "d"], ["a", "e"]];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/playlistItems")) {
      const n = Number(url.searchParams.get("pageToken") ?? 0);
      const body = { items: pages[n].map((videoId) => ({ contentDetails: { videoId } })), nextPageToken: n + 1 < pages.length ? String(n + 1) : undefined };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    const ids = url.searchParams.get("id")!.split(",");
    // Return each requested id twice to prove getVideos also de-duplicates the response.
    const items = [...ids, ...ids].map((id) => ({ id, snippet: { title: id } }));
    return new Response(JSON.stringify({ items }), { status: 200 });
  }) as typeof fetch;
  try {
    const ids = await listUploadIds("t", "UU1", 5);
    assert.deepEqual(ids, ["a", "b", "c", "d", "e"]);
    const videos = await getVideos("t", ["a", "a", "b"]);
    assert.deepEqual(videos.map((v) => v.id), ["a", "b"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("aggregate weights avg % viewed by views and skips days without it", () => {
  const days = [
    { ...day("2026-01-01", null, null, 100), avgViewPct: 30 },
    { ...day("2026-01-02", null, null, 300), avgViewPct: 50 },
    { ...day("2026-01-03", null, null, 1000), avgViewPct: null },
  ];
  assert.equal(aggregate(days, "avgViewPct"), 45);
  assert.equal(aggregate([{ ...day("2026-01-01", null, null), avgViewPct: null }], "avgViewPct"), null);
});

test("retentionRanges leaves out the change day and waits for enough days after", () => {
  // today 2026-03-20, so the last day with analytics is 2026-03-18.
  const r = retentionRanges("2026-03-10", 7, "2026-03-20");
  assert.deepEqual(r.before, { start: "2026-03-03", end: "2026-03-09" });
  assert.deepEqual(r.after, { start: "2026-03-11", end: "2026-03-17" });
  const clipped = retentionRanges("2026-03-10", 28, "2026-03-20");
  assert.deepEqual(clipped.after, { start: "2026-03-11", end: "2026-03-18" });
  const early = retentionRanges("2026-03-16", 7, "2026-03-20");
  assert.equal(early.after, null);
  assert.equal(early.daysAfter, 2);
});

test("getRetention asks for the elapsed-time curve and falls back without relative performance", async () => {
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    asked.push(url.searchParams.get("metrics")!);
    assert.equal(url.searchParams.get("dimensions"), "elapsedVideoTimeRatio");
    assert.equal(url.searchParams.get("filters"), "video==v1");
    if (url.searchParams.get("metrics")!.includes("relative")) return new Response(JSON.stringify({ error: { message: "bad metric" } }), { status: 400 });
    return new Response(JSON.stringify({ columnHeaders: [{ name: "elapsedVideoTimeRatio" }, { name: "audienceWatchRatio" }], rows: [[0.01, 0.9], [0.02, 0.8]] }), { status: 200 });
  }) as typeof fetch;
  try {
    const pts = await getRetention("t", "v1", "2026-01-01", "2026-01-07");
    assert.deepEqual(pts, [{ at: 0.01, watching: 0.9, relative: null }, { at: 0.02, watching: 0.8, relative: null }]);
    assert.equal(asked.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("demo retention curves start near full, decline, and differ between ranges", () => {
  const today = new Date().toISOString().slice(0, 10);
  const before = demoRetention("demo-keyboard", { start: addDays(today, -30), end: addDays(today, -24) });
  const after = demoRetention("demo-keyboard", { start: addDays(today, -22), end: addDays(today, -16) });
  assert.equal(before.length, 100);
  assert.ok(watchingAt(before, 0)! > 0.85 && watchingAt(before, 0.9)! < watchingAt(before, 0.1)!);
  assert.notEqual(curveMean(before), curveMean(after));
  assert.deepEqual(demoRetention("demo-keyboard", { start: "2000-01-01", end: "2000-01-07" }), []);
});
