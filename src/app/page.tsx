import { redirect } from "next/navigation";
import { Logo } from "@/components/ui";
import { googleConfigured } from "@/lib/google";
import { getUserId } from "@/lib/session";

const ERRORS: Record<string, string> = {
  not_configured: "Google sign-in isn't configured on this server yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or try the demo.",
  oauth: "Google sign-in didn't complete. Please try again.",
  no_channel: "That Google account doesn't have a YouTube channel.",
};

const STEPS = [
  ["Connect your channel", "Read-only access. Test Tube can never edit, upload or delete anything."],
  ["Change things as usual", "Edit titles, thumbnails, descriptions and tags in YouTube Studio. Each sync snapshots your videos and logs what changed, with before and after."],
  ["See what it did", "Every change is lined up against click-through rate, views, impressions and watch time for the days before and after."],
];

export default async function Home({ searchParams }: PageProps<"/">) {
  if (await getUserId()) redirect("/dashboard");
  const error = ERRORS[String((await searchParams).error ?? "")];
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-10 sm:py-16">
      <Logo />
      <h1 className="mt-12 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Know which changes actually moved your numbers.</h1>
      <p className="mt-5 max-w-xl text-lg text-muted">
        Test Tube keeps a change log for your channel. Swap a thumbnail or rewrite a title, and it shows you what happened to click-through rate and views afterwards.
      </p>
      {error && (
        <p role="alert" className="mt-6 rounded-md border border-bad/40 px-3 py-2 text-sm">
          {error}
        </p>
      )}
      <div className="mt-8 flex flex-wrap gap-3">
        <a href="/api/auth/google" className="rounded-md bg-ink px-4 py-2.5 font-medium text-surface hover:opacity-90">
          Connect your channel
        </a>
        <a href="/api/auth/demo" className="rounded-md border border-line bg-surface px-4 py-2.5 font-medium hover:bg-page">
          Explore the demo
        </a>
      </div>
      {!googleConfigured() && <p className="mt-3 text-sm text-faint">Google sign-in is not configured on this server; the demo works without it.</p>}
      <ol className="mt-14 grid gap-4 sm:grid-cols-3">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="rounded-lg border border-line bg-surface p-4">
            <div className="font-mono text-xs text-faint">0{i + 1}</div>
            <h2 className="mt-2 font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-auto pt-12 text-xs text-faint">Test Tube is an independent tool for YouTube creators. It is not affiliated with or endorsed by YouTube or Google.</p>
    </main>
  );
}
