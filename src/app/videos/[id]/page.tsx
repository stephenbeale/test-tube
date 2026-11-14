import Link from "next/link";
import { notFound } from "next/navigation";
import { addNote, deleteNote } from "@/app/actions";
import { MetricChart, type Marker } from "@/components/metric-chart";
import { Collecting, Delta, FieldChips, Header, parseWindow, Thumb, WindowPicker } from "@/components/ui";
import { addDays, daysBetween, ptDate } from "@/lib/dates";
import { diffTags } from "@/lib/diff";
import { FIELD_LABEL, fmtDateYear, fmtMetric } from "@/lib/format";
import { computeImpact, METRICS, type Impact, type MetricKey } from "@/lib/impact";
import { getDays, getVideo, listChangeGroups, type ChangeItem } from "@/lib/queries";
import { requireChannel } from "@/lib/session";

function ChangeDetail({ item }: { item: ChangeItem }) {
  const arrow = <span className="text-faint">→</span>;
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
    default:
      return (
        <p className="text-sm">
          <span className="text-muted line-through decoration-faint">{item.oldValue}</span> {arrow} <span className="font-medium">{item.newValue}</span>
        </p>
      );
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

export default async function VideoPage({ params, searchParams }: PageProps<"/videos/[id]">) {
  const channel = await requireChannel();
  const { id } = await params;
  const sp = await searchParams;
  const video = await getVideo(channel.id, id);
  if (!video) notFound();

  const window = parseWindow(sp.w);
  const days = (await getDays([id])).get(id) ?? [];
  const hasReach = days.some((d) => d.ctr != null);
  const available = METRICS.filter((m) => hasReach || (m.key !== "ctr" && m.key !== "impressions"));
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
  const href = (m: string, w: number) => `/videos/${id}?m=${m}&w=${w}`;

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
          <MetricChart points={points} markers={markers} metric={metric} label={metricLabel} />
          <p className="mt-1 text-xs text-faint">Numbered markers are the changes listed below. YouTube analytics arrive about two days behind.</p>
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
              return (
                <li key={g.key} className="flex gap-3 rounded-lg border border-line bg-surface p-4">
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-surface ${isNote ? "bg-note" : "bg-ink"}`}>{g.n}</span>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <FieldChips fields={g.items.map((i) => i.field)} />
                      <span className="text-xs text-faint">{fmtDateYear(g.changeDate)}</span>
                      {isNote && (
                        <form action={deleteNote} className="ml-auto">
                          <input type="hidden" name="id" value={g.items[0].id} />
                          <button className="text-xs text-muted underline hover:text-ink">Delete note</button>
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
          <h2 className="font-semibold">Add a note</h2>
          <p className="mt-1 text-sm text-muted">Mark things YouTube can&apos;t see, such as a newsletter mention or a pinned comment, so they show on the chart too.</p>
          <form action={addNote} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="videoId" value={id} />
            <input type="date" name="date" required defaultValue={ptDate()} max={ptDate()} aria-label="Date" className="rounded-md border border-line bg-page px-2 py-1.5 text-sm" />
            <input name="text" required maxLength={200} placeholder="What happened?" aria-label="Note" className="min-w-0 flex-1 basis-60 rounded-md border border-line bg-page px-2 py-1.5 text-sm" />
            <button className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-surface">Add note</button>
          </form>
        </section>

        <p className="mt-8 max-w-2xl text-xs text-faint">
          Before-and-after comparisons show what happened next, not proof of cause. Views usually fall as a video ages and seasonality, other uploads and outside traffic all move the numbers.
          Click-through rate is the fairest signal for a title or thumbnail change. Changes made close together share the same window.
        </p>
      </main>
    </>
  );
}
