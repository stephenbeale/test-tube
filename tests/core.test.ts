import assert from "node:assert/strict";
import { test } from "node:test";
import { diffTags, diffVideo, type Tracked } from "../src/lib/diff";
import { aggregate, computeImpact, type Day } from "../src/lib/impact";
import { addDays, daysBetween } from "../src/lib/dates";
import { normaliseCtr } from "../src/lib/youtube";

const base: Tracked = { title: "A", description: "d", tags: ["x"], categoryId: "28", privacyStatus: "public", thumbnailHash: "h1" };
const day = (date: string, impressions: number | null, ctr: number | null, views = 100): Day => ({ date, views, watchMinutes: views * 2, avgViewDuration: 120, subsGained: 0, impressions, ctr });

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
