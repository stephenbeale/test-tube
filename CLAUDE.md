# Test Tube

Next.js 16 app: a change log and impact tracker for YouTube channels. See README.md and AGENTS.md.

## Session Notes

### 2026-11-26 - Retention metrics + group videos by visibility

**Work completed (all in one commit on `feature/group-videos-by-visibility`):**
- Retention metrics (this session):
  - Avg % viewed: `averageViewPercentage` in `CORE` (`src/lib/youtube.ts`); nullable `daily_metrics.avg_view_pct` via a MIGRATIONS entry in `src/lib/db.ts`; stored in `sync.ts`, read in `queries.ts` `getDays`; MetricKey `avgViewPct` in `src/lib/impact.ts` (weighted by views, null days skipped); demo seed generates it. Video-page chart tab hidden until a video has data.
  - Audience retention curve: `getRetention()` in `youtube.ts` (dimension `elapsedVideoTimeRatio`, metrics `audienceWatchRatio` + `relativeRetentionPerformance`, falls back to `audienceWatchRatio` alone on a 400). `src/lib/retention.ts`: `retentionRanges`, `recentRange`, `retentionCurve` with a `retention_curves` cache table (settled ranges never refetched, recent ones refresh after 12h, stale cache used if YouTube fails). `demoRetention()` in `demo.ts`. New `src/components/retention-chart.tsx`. Video page has an "Audience retention" section (picker per change plus "Last 28 days", `?r=` param, Suspense, stats table, similar-length comparison). `accessToken` and `DATA_LAG_DAYS` now exported from `sync.ts`.
  - 4 new tests in `tests/core.test.ts` (13/13 pass); typecheck and eslint clean; verified visually on the demo channel.
- Group videos by visibility (from an earlier session; state not fully known): changes in `actions.ts`, `dashboard/page.tsx`, `metric-chart.tsx`, `queries.ts`, `db.ts`, `sync.ts`, `youtube.ts`, `videos/[id]/page.tsx`, plus new `src/components/event-form.tsx` (manual change/note recording, click a day on the chart). These are interleaved with the retention work in shared files, so they were committed together. Re-verify this feature before relying on it.

**Not verified:** retention/avg % viewed against the real channel ("Appliance Steve (Home Helper)"). Needs Sync now to backfill `avg_view_pct`; retention may come back empty for low-view videos (impressions/CTR already did). Also not verified: switching between two channels, add-channel OAuth flow end to end.

**Git state:**
- Stack, all pushed, none merged to main: `fix/duplicate-upload-ids` (b2c5b12, PR #1 open) -> `feature/channel-switcher` (b544ed4, no PR) -> `feature/group-videos-by-visibility` (now also holds the retention work). Merge in that order.

**Next steps:**
1. Run Sync now on the real channel; confirm avg % viewed and retention curves return.
2. Merge the stack in order (fix/duplicate-upload-ids, feature/channel-switcher, feature/group-videos-by-visibility).
3. Add the second Google account as an OAuth test user (Google Auth Platform -> Audience -> Test users), or Publish the app (unverified, 100-user cap, removes the 7-day refresh-token expiry); then test add-channel and switching end to end. The earlier attempt failed with "Access blocked: Test Tube has not completed the Google verification process".
4. Fix the channel switcher dropdown chevron styling.
5. Investigate the YouTube Reporting API channel reach report for impressions/CTR (the Analytics API returns none for this channel, so the app falls back to views and watch time).
6. A dev server (`npm run dev`) may still be running on port 3000; stop it before starting a new one.

**Technical notes:**
- Channel switcher (2026-11-25): `tt_channel` cookie, `setActiveChannel()`/`requireChannel()` in `src/lib/session.ts`; `switchChannel` server action; no-JS `ChannelSwitcher` in `ui.tsx`; `?add=1` OAuth add mode via `tt_add` cookie; Google prompt is `select_account consent`.
- `.playwright-mcp/`, `.env*` and `*.db` are gitignored. Real channel baseline sync ran 2026-11-24.
