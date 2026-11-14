import Link from "next/link";
import { FieldChips, Header, ImpactSummary, parseWindow, Thumb, WindowPicker } from "@/components/ui";
import { addDays, ptDate } from "@/lib/dates";
import { fmtDateYear, fmtMetric } from "@/lib/format";
import { computeImpact } from "@/lib/impact";
import { getDays, listChangeGroups, listVideos } from "@/lib/queries";
import { requireChannel } from "@/lib/session";

export default async function Dashboard({ searchParams }: PageProps<"/dashboard">) {
  const channel = await requireChannel();
  const window = parseWindow((await searchParams).w);
  const [videos, groups] = await Promise.all([listVideos(channel.id, addDays(ptDate(), -30)), listChangeGroups(channel.id, { limit: 30 })]);
  const days = await getDays([...new Set(groups.map((g) => g.videoId))]);

  return (
    <>
      <Header channel={channel} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {channel.lastSyncError && (
          <p role="alert" className="mb-6 rounded-md border border-bad/40 bg-surface px-3 py-2 text-sm">
            Last sync failed: {channel.lastSyncError}
          </p>
        )}
        {channel.reachMetrics === false && (
          <p className="mb-6 rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted">
            YouTube didn&apos;t return impressions or click-through rate for this channel, so comparisons use views and watch time only.
          </p>
        )}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Change log</h1>
            <p className="mt-1 text-sm text-muted">
              Each change compared {window} days before and after.
              {channel.lastSyncedAt && !channel.isDemo && <> Last synced {new Date(channel.lastSyncedAt).toUTCString().slice(5, 22)} UTC.</>}
            </p>
          </div>
          <WindowPicker current={window} href={(w) => `/dashboard?w=${w}`} />
        </div>

        {groups.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
            {videos.length === 0 ? (
              <>The first sync is running. It takes a minute or two; refresh this page to see your videos.</>
            ) : (
              <>
                No changes recorded yet. Test Tube has a baseline of {videos.length} videos. Edit a title or thumbnail in YouTube Studio and it will show up here after the next sync.
              </>
            )}
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {groups.map((g) => (
              <li key={g.key}>
                <Link href={`/videos/${g.videoId}?w=${window}`} className="flex gap-4 rounded-lg border border-line bg-surface p-4 hover:border-faint">
                  <Thumb hash={g.thumbnailHash} className="hidden w-32 shrink-0 self-start sm:block" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <FieldChips fields={g.items.map((i) => i.field)} />
                      <span className="text-xs text-faint">{fmtDateYear(g.changeDate)}</span>
                    </div>
                    <div className="truncate font-medium">{g.videoTitle}</div>
                    {g.items[0].field === "note" && <div className="text-sm text-muted">“{g.items[0].newValue}”</div>}
                    <ImpactSummary impact={computeImpact(days.get(g.videoId) ?? [], g.changeDate, window)} keys={["ctr", "views", "avgViewDuration"]} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {videos.length > 0 && (
          <section className="mt-12">
            <h2 className="text-lg font-semibold tracking-tight">Videos</h2>
            <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 font-medium">Video</th>
                    <th className="px-4 py-2 font-medium whitespace-nowrap">Published</th>
                    <th className="px-4 py-2 text-right font-medium">Changes</th>
                    <th className="px-4 py-2 text-right font-medium whitespace-nowrap">Views, 28 days</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((v) => (
                    <tr key={v.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">
                        <Link href={`/videos/${v.id}`} className="flex items-center gap-3 hover:underline">
                          <Thumb hash={v.thumbnailHash} className="w-16 shrink-0" />
                          <span className="line-clamp-2 min-w-40">{v.title}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-muted">{v.publishedAt ? fmtDateYear(v.publishedAt) : "–"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{v.changeCount || <span className="text-faint">0</span>}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtMetric("views", v.views28)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
