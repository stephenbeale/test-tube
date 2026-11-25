# Test Tube

Next.js 16 app: a change log and impact tracker for YouTube channels. See README.md and AGENTS.md.

## Session Notes

### 2026-11-25 - Channel switcher

**Work completed:**
- Channel switcher on branch `feature/channel-switcher` (branched from `fix/duplicate-upload-ids`, b2c5b12, pushed but not merged to main).
  - `src/lib/session.ts`: `tt_channel` cookie, `setActiveChannel()`, `requireChannel()` picks the selected channel (ownership checked, falls back to first) and returns `channels: {id,title}[]`; `destroySession` clears `tt_channel`.
  - `src/app/actions.ts`: `switchChannel` server action (ownership check, set cookie, redirect to /dashboard).
  - `src/components/ui.tsx`: no-JS `ChannelSwitcher` (`<details>`) in Header for non-demo channels, with "+ Add another channel" -> `/api/auth/google?add=1`.
  - `src/app/api/auth/google/route.ts`: `?add=1` sets `tt_add` cookie.
  - `src/app/api/auth/callback/route.ts`: add mode attaches channel to the signed-in non-demo user; otherwise existing channel keeps its owner, else goes to the Google user. Sets active channel.
  - `src/lib/google.ts`: prompt is now `select_account consent`.
- Verified: typecheck, eslint, `npm test` (9/9), dropdown renders with no console errors.

**Not verified:** switching between two channels; add-channel OAuth flow end to end.

**Work in progress / open items:**
1. Real channel "Appliance Steve (Home Helper)" is connected; baseline sync ran 2026-11-24.
2. YouTube returned no impressions/CTR for it, so the app falls back to views and watch time. Possible next step: YouTube Reporting API channel reach report.
3. Adding a second channel failed with "Access blocked: Test Tube has not completed the Google verification process". Cause: OAuth consent screen is in Testing mode and the second account is not a test user. Fix (user action, pending): add it under Google Auth Platform -> Audience -> Test users, or Publish the app (unverified, 100-user cap, also removes the 7-day refresh-token expiry).
4. UI nit: the channel switcher dropdown chevron renders slightly oddly.
5. A dev server (`npm run dev`) may still be running on port 3000 from this session; stop it before starting a new one.

**Git state:**
- PR for `fix/duplicate-upload-ids` into main is not merged; `feature/channel-switcher` is stacked on it. Merge the fix first (or include it), then target main.

**Next steps:**
1. Add the second Google account as a test user, then test add-channel and switching end to end.
2. Open/merge the PRs in order (fix/duplicate-upload-ids, then feature/channel-switcher).
3. Fix the chevron styling.
4. Investigate the Reporting API for impressions/CTR.

**Technical notes:**
- `.playwright-mcp/` is now gitignored; `.env*` and `*.db` were already ignored.
