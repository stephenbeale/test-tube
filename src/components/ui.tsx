import Link from "next/link";
import { signOut } from "@/app/actions";
import { FIELD_LABEL, fmtDelta, fmtMetric } from "@/lib/format";
import { METRICS, MIN_DAYS, type Impact, type MetricKey } from "@/lib/impact";
import type { Channel } from "@/lib/session";
import { SyncButton } from "./sync-button";

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
        <rect width="32" height="32" rx="7" className="fill-ink" />
        <path d="M12 6h8M13.5 6v15a2.5 2.5 0 0 0 5 0V6" fill="none" className="stroke-surface" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M13.5 15h5v6a2.5 2.5 0 0 1-5 0z" className="fill-accent" />
      </svg>
      Test Tube
    </span>
  );
}

export function Header({ channel }: { channel: Channel }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/dashboard">
          <Logo />
        </Link>
        <span className="min-w-0 flex-1 truncate text-sm text-muted">{channel.title}</span>
        {!channel.isDemo && <SyncButton />}
        <form action={signOut}>
          <button className="text-sm text-muted hover:text-ink">{channel.isDemo ? "Exit demo" : "Sign out"}</button>
        </form>
      </div>
    </header>
  );
}

export function Thumb({ hash, className = "" }: { hash: string | null; className?: string }) {
  const cls = `aspect-video rounded-md border border-line bg-line object-cover ${className}`;
  // Plain <img>: thumbnails are served from our own authenticated route.
  // eslint-disable-next-line @next/next/no-img-element
  return hash ? <img src={`/api/thumb/${hash}`} alt="" className={cls} loading="lazy" /> : <div className={cls} />;
}

export function FieldChips({ fields }: { fields: string[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {fields.map((f) => (
        <span key={f} className={`rounded-full border px-2 py-0.5 text-xs font-medium ${f === "note" ? "border-note/40 text-note" : "border-line text-muted"}`}>
          {FIELD_LABEL[f] ?? f}
        </span>
      ))}
    </span>
  );
}

/** Direction is carried by the arrow and sign, not by colour alone. */
export function Delta({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-faint">–</span>;
  const flat = Math.abs(pct) < 2;
  return (
    <span className="inline-flex items-center gap-1 font-medium tabular-nums">
      {flat ? (
        <span className="text-faint" aria-hidden>
          ●
        </span>
      ) : (
        <svg viewBox="0 0 10 10" className={`size-2.5 ${pct > 0 ? "fill-good" : "rotate-180 fill-bad"}`} aria-hidden>
          <path d="M5 1 9.5 9h-9z" />
        </svg>
      )}
      {fmtDelta(pct)}
    </span>
  );
}

export function Collecting({ impact }: { impact: Impact }) {
  if (impact.daysBefore < MIN_DAYS) return <span className="text-sm text-faint">Not enough history before this change to compare.</span>;
  return (
    <span className="text-sm text-muted">
      Collecting data: {impact.daysAfter} of {impact.window} days after the change so far.
    </span>
  );
}

export function ImpactSummary({ impact, keys }: { impact: Impact; keys: MetricKey[] }) {
  if (!impact.ready) return <Collecting impact={impact} />;
  const shown = impact.metrics.filter((m) => keys.includes(m.key) && m.before != null && m.after != null);
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {shown.map((m) => (
        <div key={m.key}>
          <dt className="text-xs text-muted">{METRICS.find((x) => x.key === m.key)!.label}</dt>
          <dd className="flex items-baseline gap-2">
            <span className="tabular-nums text-muted">
              {fmtMetric(m.key, m.before)} → <span className="text-ink">{fmtMetric(m.key, m.after)}</span>
            </span>
            <Delta pct={m.deltaPct} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function WindowPicker({ current, href }: { current: number; href: (w: number) => string }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface p-0.5 text-sm" role="group" aria-label="Comparison window">
      {[7, 14, 28].map((w) => (
        <Link key={w} href={href(w)} scroll={false} className={`rounded px-2.5 py-1 ${w === current ? "bg-ink text-surface" : "text-muted hover:text-ink"}`}>
          {w} days
        </Link>
      ))}
    </div>
  );
}

export const parseWindow = (w: string | string[] | undefined) => ([7, 14, 28].includes(Number(w)) ? Number(w) : 7);
