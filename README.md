# Test Tube

A change log for a YouTube channel. Test Tube snapshots your videos through the YouTube API, records every
change to a title, thumbnail, description, tags, category or visibility, and lines each change up against
click-through rate, views, impressions and watch time for the days before and after.

Access is read-only: Test Tube never edits a channel.

## Try it

```bash
npm install
npm run dev
```

Open http://localhost:3000 and choose **Explore the demo**. The demo channel is generated locally and needs
no Google credentials.

## Connect a real channel

1. In Google Cloud Console create a project and enable **YouTube Data API v3** and **YouTube Analytics API**.
2. Configure the OAuth consent screen and add the scopes `youtube.readonly` and `yt-analytics.readonly`.
3. Create an OAuth client of type *Web application* with the redirect URI
   `http://localhost:3000/api/auth/callback` (add the production URL later).
4. Copy `.env.example` to `.env.local` and fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `APP_SECRET`.

While the consent screen is in *Testing* mode only listed test users can sign in and Google expires refresh
tokens after 7 days. Opening the app to other creators requires Google's OAuth verification, because both
scopes are classed as sensitive, plus a YouTube API compliance audit if you need more than the default quota.

## How it works

| Step | What happens |
| --- | --- |
| Sync | `src/lib/sync.ts` lists the newest 200 uploads, fetches their metadata and thumbnail image, and compares them with the last snapshot. |
| Detect | `src/lib/diff.ts` turns differences into change records. Thumbnails are compared by image hash, because the thumbnail URL does not change when the image does. Both versions are kept. |
| Measure | Daily analytics for the 40 most relevant videos (recently changed first) are stored for 90 days. |
| Compare | `src/lib/impact.ts` compares N days before a change with N days after, leaving out the day of the change. Rates are weighted, so CTR is clicks over impressions rather than an average of daily percentages. |

The first sync is a baseline: changes are detected from then on, not retroactively. A change is dated to
the sync that noticed it, so sync frequency sets the precision. `vercel.json` schedules one sync a day
(`/api/cron/sync`, protected by `CRON_SECRET`); use **Sync now** after editing a video for an exact timestamp.

## Known limits

- **Impressions and CTR are not verified against the live API.** They are requested as
  `videoThumbnailImpressions` and `videoThumbnailImpressionsClickRate`. If YouTube rejects them, the sync
  falls back to views and watch time and the dashboard says so. If that happens, the Reporting API's
  channel reach report is the alternative source.
- The Google sign-in and sync path has not been exercised with real credentials yet; the demo, the change
  detection and the impact maths are covered by tests and a browser run.
- Before/after is correlation, not proof. Views fall as videos age, and overlapping changes share a window.
- YouTube Analytics data arrives about two days late, so a change needs a few days before it has a result.

## Deploying

Any Node host works. On Vercel, set the environment variables from `.env.example` and point `DATABASE_URL`
at a libSQL/Turso database, since the default local SQLite file does not persist on serverless hosts.

## Scripts

`npm run dev`, `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`

Test Tube is an independent project and is not affiliated with or endorsed by YouTube or Google.
