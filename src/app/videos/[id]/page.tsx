import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { addEvent, deleteManualChange } from "@/app/actions";
import { EventForm } from "@/components/event-form";
import { MetricChart, type Marker } from "@/components/metric-chart";
import { RetentionChart, type RetentionSeries } from "@/components/retention-chart";
import { Collecting, Delta, FieldChips, Header, parseWindow, Thumb, WindowPicker } from "@/components/ui";
import { addDays, daysBetween, ptDate } from "@/lib/dates";
import { diffTags } from "@/lib/diff";
import { FIELD_LABEL, fmtDate, fmtDateYear, fmtMetric } from "@/lib/format";
import { computeImpact, METRICS, type Impact, type MetricKey } from "@/lib/impact";
import { getDays, getVideo, listChangeGroups, type ChangeItem } from "@/lib/queries";
import { curveMean, recentRange, relativeMean, retentionCurve, retentionRanges, watchingAt, type Range } from "@/lib/retention";
import type { RetentionPoint } from "@/lib/youtube";
import { requireChannel } from "@/lib/session";

function ChangeDetail({ item }: { item: ChangeItem }) {
  const arrow = <span className="text-faint">→</span>;
  // Edits recorded by hand have no before/after snapshot, just an optional detail.
  if (item.manual && item.field !== "note" && item.field !== "privacy") {
    return item.newValue ? <p className="text-sm">“{item.newValue}”</p> : <p className="text-sm text-muted">Changed</p>;
  }
  switch (item.field) {
    case "thumbnail":
      return (
        <div className="flex items-center gap-3">
          <Thumb hash={item.oldValue} className="w-36 min-w-0 shrink" />
          {arrow}
          <Thumb hash={item.newValue} className="w-36 min-w-0 shrink" />
        </div>
      );
    case "tags": {
      const { added, removed } = diffTags(item.oldValue, item.newValue);
      return (
        <p className="text-sm">
          {added.length > 0 && <span>Added: {added.join(", ")}. </span>}
          {removed.length > 0 && <span className="text-muted">Removed: {removed.join(", ")}.</span>}
          {added.length + removed.length === 0 && <span className="text-muted">Tags reordered.</span>}
        </p>
      );
    }
    case "description":
      return (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">
            Description edited ({item.oldValue?.length ?? 0} → {item.newValue?.length ?? 0} characters)
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <pre className="rounded-md border border-line p-2 font-sans whitespace-pre-wrap text-muted">{item.oldValue || "(empty)"}</pre>
            <pre className="rounded-md border border-line p-2 font-sans whitespace-pre-wrap">{item.newValue || "(empty)"}</pre>
          </div>
        </details>
      );
    case "note":
      return <p className="text-sm">“{item.newValue}”</p>;
    default: {
      // Visibility is stored as YouTube's lowercase status.
      const show = (v: string | null) => (item.field === "privacy" && v ? v[0].toUpperCase() + v.slice(1) : v);
      return (
        <p className="text-sm">
          {item.oldValue != null && (
            <>
              <span className="text-muted line-through decoration-faint">{show(item.oldValue)}</span> {arrow}{" "}
            </>
          )}
          <span className="font-medium">{show(item.newValue)}</span>
        </p>
      );
    }
  }
}

function ImpactTable({ impact }: { impact: Impact }) {
  if (!impact.ready) return <Collecting impact={impact} />;
  const rows = impact.metrics.filter((m) => m.before != null && m.after != null);
  return (
    <table className="w-full max-w-lg text-sm">
      <thead className="text-left text-xs text-muted">
        <tr>
          <th className="py-1 font-medium">
            {impact.daysBefore} days before vs {impact.daysAfter} days after
          </th>
          <th className="py-1 pl-3 text-right font-medium">Before</th>
          <th className="py-1 pl-3 text-right font-medium">After</th>
          <th className="py-1 pl-3 text-right font-medium">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.key} className="border-t border-line">
            <td className="py-1.5">{METRICS.find((x) => x.key === m.key)!.label}</td>
            <td className="py-1.5 pl-3 text-right whitespace-nowrap tabular-nums text-muted">{fmtMetric(m.key, m.before)}</td>
            <td className="py-1.5 pl-3 text-right whitespace-nowrap tabular-nums">{fmtMetric(m.key, m.after)}</td>
            <td className="py-1.5 pl-3 text-right whitespace-nowrap">
              <Delta pct={m.deltaPct} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const RECENT_DAYS = 28;
const rangeLabel = (r: Range) => `${fmtDate(r.start)}–${fmtDate(r.end)}`;
const pts = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);

function RetentionStats({ series }: { series: RetentionSeries[] }) {
  const rows: [string, (s: RetentionSeries) => number | null][] = [
    ["Average across the video", (s) => curveMean(s.points)],
    ["Still watching at 25%", (s) => watchingAt(s.points, 0.25)],
    ["Still watching at 50%", (s) => watchingAt(s.points, 0.5)],
    ["Still watching at 75%", (s) => watchingAt(s.points, 0.75)],
  ];
  const compare = series.length === 2;
  const rel = relativeMean(series[series.length - 1].points);
  return (
    <>
      <table className="mt-4 w-full max-w-lg text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-1 font-medium" />
            {series.map((s) => (
              <th key={s.label} className="py-1 pl-3 text-right font-medium">
                {s.label}
              </th>
            ))}
            {compare && <th className="py-1 pl-3 text-right font-medium">Change</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => {
            const [b, a] = series.map(f);
            const d = compare && a != null && b != null ? (a - b) * 100 : null;
            return (
              <tr key={label} className="border-t border-line">
                <td className="py-1.5">{label}</td>
                {series.map((s, i) => (
                  <td key={s.label} className={`py-1.5 pl-3 text-right tabular-nums ${compare && i === 0 ? "text-muted" : ""}`}>
                    {pts(f(s))}
                  </td>
                ))}
                {compare && <td className="py-1.5 pl-3 text-right whitespace-nowrap tabular-nums">{d == null ? "–" : `${d > 0 ? "+" : ""}${d.toFixed(1)} pts`}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rel != null && (
        <p className="mt-2 text-xs text-muted">
          Against YouTube videos of similar length{compare ? ", after the change" : ""}: {rel >= 0.6 ? "above typical" : rel <= 0.4 ? "below typical" : "about typical"} (
          {Math.round(rel * 100)} of 100, where 50 is typical).
        </p>
      )}
    </>
  );
}

type RetentionData =
  | { kind: "recent"; range: Range; points: RetentionPoint[] }
  | { kind: "change"; before: Range; after: Range | null; daysAfter: number; b: RetentionPoint[]; a: RetentionPoint[] | null }
  | { kind: "error"; message: string };

async function loadRetention(channel: { id: string; isDemo: boolean }, videoId: string, change: { changeDate: string } | null, window: number): Promise<RetentionData> {
  const today = ptDate();
  try {
    if (!change) {
      const range = recentRange(RECENT_DAYS, today);
      return { kind: "recent", range, points: await retentionCurve(channel, videoId, range) };
    }
    const { before, after, daysAfter } = retentionRanges(change.changeDate, window, today);
    const [b, a] = await Promise.all([retentionCurve(channel, videoId, before), after ? retentionCurve(channel, videoId, after) : null]);
    return { kind: "change", before, after, daysAfter, b, a };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

async function Retention({ channel, videoId, change, window }: { channel: { id: string; isDemo: boolean }; videoId: string; change: { changeDate: string } | null; window: number }) {
  const data = await loadRetention(channel, videoId, change, window);
  const none = <p className="py-10 text-center text-sm text-muted">YouTube has no retention data for this period, which usually means too few views.</p>;
  if (data.kind === "error") return <p className="py-10 text-center text-sm text-muted">Couldn&apos;t load retention from YouTube. {data.message}</p>;
  if (data.kind === "recent") {
    if (data.points.length === 0) return none;
    const series: RetentionSeries[] = [{ label: rangeLabel(data.range), points: data.points, tone: "after" }];
    return (
      <>
        <RetentionChart series={series} />
        <RetentionStats series={series} />
      </>
    );
  }
  const { before, after, daysAfter, b, a } = data;
  const series: RetentionSeries[] = [];
  if (b.length) series.push({ label: `Before (${rangeLabel(before)})`, points: b, tone: "before" });
  if (after && a?.length) series.push({ label: `After (${rangeLabel(after)})`, points: a, tone: "after" });
  return (
    <>
      {series.length > 0 ? <RetentionChart series={series} /> : none}
      {!after && (
        <p className="mt-2 text-sm text-muted">
          Collecting data: {daysAfter} of {window} days after the change so far.
        </p>
      )}
      {after && a?.length === 0 && series.length > 0 && <p className="mt-2 text-sm text-muted">No retention data after the change yet.</p>}
      {b.length === 0 && series.length > 0 && <p className="mt-2 text-sm text-muted">No retention data before the change.</p>}
      {series.length > 0 && <RetentionStats series={series} />}
    </>
  );
}
export default async function VideoPage({ params, searchParams }: PageProps<"/videos/[id]">) {
  const channel = await requireChannel();
  const { id } = await params;
  const sp = await searchParams;
  const video = await getVideo(channel.id, id);
  if (!video) notFound();

  const window = parseWindow(sp.w);
  const days = (await getDays([id])).get(id) ?? [];
  const hasReach = days.some((d) => d.ctr != null);
  const hasPct = days.some((d) => d.avgViewPct != null);
  const available = METRICS.filter((m) => (hasReach || (m.key !== "ctr" && m.key !== "impressions")) && (hasPct || m.key !== "avgViewPct"));
  const metric = (available.find((m) => m.key === sp.m) ?? available[0]).key as MetricKey;
  const metricLabel = METRICS.find((m) => m.key === metric)!.label;

  // Oldest first, so marker numbers read left to right on the chart.
  const groups = (await listChangeGroups(channel.id, { videoId: id })).reverse();
  const numbered = groups.map((g, i) => ({ ...g, n: i + 1 }));

  const byDate = new Map(days.map((d) => [d.date, d]));
  const points =
    days.length === 0
      ? []
      : Array.from({ length: daysBetween(days[0].date, days[days.length - 1].date) + 1 }, (_, i) => {
          const date = addDays(days[0].date, i);
          const d = byDate.get(date);
          return { date, value: d ? d[metric] : null };
        });
  const markers: Marker[] = numbered.map((g) => ({
    date: g.changeDate,
    n: g.n,
    label: g.items.map((i) => (i.field === "note" ? `Note: ${i.newValue}` : FIELD_LABEL[i.field])).join(", "),
    note: g.items[0].field === "note",
  }));
  // Retention compares before and after one change (latest by default), or shows recent days.
  const retentionChange = sp.r === "recent" ? null : (numbered.find((g) => String(g.n) === sp.r) ?? numbered.at(-1) ?? null);
  const r = retentionChange ? String(retentionChange.n) : "recent";
  const href = (m: string, w: number, rv = r) => `/videos/${id}?m=${m}&w=${w}&r=${rv}`;

  return (
    <>
      <Header channel={channel} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Link href={`/dashboard?w=${window}`} className="text-sm text-muted hover:text-ink">
          ← Change log
        </Link>
        <div className="mt-4 flex items-start gap-4">
          <Thumb hash={video.thumbnailHash} className="w-28 shrink-0 sm:w-40" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{video.title}</h1>
            <p className="mt-1 text-sm text-muted">
              {video.publishedAt && <>Published {fmtDateYear(video.publishedAt)}</>}
              {!channel.isDemo && (
                <>
                  {" · "}
                  <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" className="underline">
                    Watch on YouTube
                  </a>
                </>
              )}
            </p>
          </div>
        </div>

        <section className="mt-8 rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Metric">
            {available.map((m) => (
              <Link
                key={m.key}
                href={href(m.key, window)}
                scroll={false}
                className={`rounded-md px-2.5 py-1 text-sm ${m.key === metric ? "bg-ink text-surface" : "border border-line text-muted hover:text-ink"}`}
              >
                {m.label}
              </Link>
            ))}
          </div>
          <h2 className="mt-4 text-sm font-medium">{metricLabel}, daily</h2>
          <MetricChart points={points} markers={markers} metric={metric} label={metricLabel} record={{ action: addEvent, videoId: id, today: ptDate() }} />
          <p className="mt-1 text-xs text-faint">
            Numbered markers are the changes listed below. Click a day to record a change, such as making the video private. YouTube analytics arrive about two days behind.
          </p>
        </section>

        <section className="mt-8 rounded-lg border border-line bg-surface p-4">
          <h2 className="font-semibold">Audience retention</h2>
          <p className="mt-1 text-sm text-muted">
            Share of viewers still watching at each point in the video, {retentionChange ? `${window} days before and after a change` : `over the last ${RECENT_DAYS} days`}.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Retention period">
            {[...numbered.map((g) => ({ key: String(g.n), label: `Change ${g.n} · ${fmtDate(g.changeDate)}` })), { key: "recent", label: `Last ${RECENT_DAYS} days` }].map((o) => (
              <Link
                key={o.key}
                href={href(metric, window, o.key)}
                scroll={false}
                className={`rounded-md px-2.5 py-1 text-sm ${o.key === r ? "bg-ink text-surface" : "border border-line text-muted hover:text-ink"}`}
              >
                {o.label}
              </Link>
            ))}
          </div>
          <div className="mt-4">
            <Suspense key={`${r}-${window}`} fallback={<p className="py-10 text-center text-sm text-muted">Loading retention…</p>}>
              <Retention channel={channel} videoId={id} change={retentionChange} window={window} />
            </Suspense>
          </div>
          <p className="mt-3 text-xs text-faint">Above 100% means viewers rewound or rewatched. The window follows the 7/14/28 day picker under Changes.</p>
        </section>

        <section className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Changes</h2>
            <WindowPicker current={window} href={(w) => href(metric, w)} />
          </div>
          {numbered.length === 0 && <p className="mt-3 text-sm text-muted">No changes recorded for this video yet.</p>}
          <ol className="mt-3 space-y-3">
            {[...numbered].reverse().map((g) => {
              const isNote = g.items[0].field === "note";
              const manual = g.items.every((i) => i.manual);
              return (
                <li key={g.key} className="flex gap-3 rounded-lg border border-line bg-surface p-4">
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-surface ${isNote ? "bg-note" : "bg-ink"}`}>{g.n}</span>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <FieldChips fields={g.items.map((i) => i.field)} />
                      <span className="text-xs text-faint">{fmtDateYear(g.changeDate)}</span>
                      {manual && !isNote && <span className="text-xs text-faint">Added by you</span>}
                      {manual && (
                        <form action={deleteManualChange} className="ml-auto">
                          <input type="hidden" name="id" value={g.items[0].id} />
                          <button className="text-xs text-muted underline hover:text-ink">Delete</button>
                        </form>
                      )}
                    </div>
                    {g.items.map((item) => (
                      <ChangeDetail key={item.id} item={item} />
                    ))}
                    <ImpactTable impact={computeImpact(days, g.changeDate, window)} />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="mt-10 rounded-lg border border-line bg-surface p-4">
          <h2 className="font-semibold">Record a change or note</h2>
          <p className="mt-1 text-sm text-muted">
            Log a change Test Tube missed, such as one made before you connected, or something YouTube can&apos;t see, such as a newsletter mention. It shows on the chart
            too. You can also click a day on the chart.
          </p>
          <div className="mt-3">
            <EventForm action={addEvent} videoId={id} today={ptDate()} />
          </div>
        </section>

        <p className="mt-8 max-w-2xl text-xs text-faint">
          Before-and-after comparisons show what happened next, not proof of cause. Views usually fall as a video ages and seasonality, other uploads and outside traffic all move the numbers.
          Click-through rate is the fairest signal for a title or thumbnail change. Changes made close together share the same window.
        </p>
      </main>
    </>
  );
}
