---
plan: v1373-hide-from-feed
harness: v2 · lean
branch: feat/v1.373.0-hide-from-feed
anchor: outcome
status: Building
next: W1-W2, then the gate (section 6) and the release as v1.373.0
design: Dean's device pass on v1.372.0 and his rulings 2026-10-07 (R1-R4). Base main 6846aec5. The subtitles + 360 + cleanup wave renumbers to v1.374.0.
gate: pending
---

# v1.373.0: "Hide from feed" for a playlist download, no notification per playlist video (and the music switch comes out)

Dean, 2026-10-07, after v1.372.0 on his device ("Song name worked, enter key fix worked. Music in home key worked but
wasn't what I intended"): "if I download an album I'd like to have the optionality of not having it show in the feed. I
download some things that are ~1hr videos as audio that are 'albums'... split by chapter and I like those showing as audio.
I just don't want to pollute my feed necessarily with dozens of individual tracks. I think we remove the new setting we
added ... and add a box to make it so that you can opt out of adding the music to the feed (Basically the hide modal - we
can hide from feed) - why not wire that in?"

Read first: AGENTS.md, docs/LESSONS.md sections 0, 2, 4, 9 (a new persisted carrier), 10 (a user id at rest; the hidden
list is per user), 12 (removing a shipped setting: sweep every trace).

## 1. Outcomes
1. The playlist picker has a "Hide from feed" row (off by default) for every playlist download, audio or video.
2. Ticked, each video the job downloads joins THE DOWNLOADER's existing Hide from feed list (v1.97, `user_feed_hidden`) as
   soon as it is in the library: out of their Modern feed, still in Music, folders and search, and undone from the
   existing "Hidden from feed" list. Other users are unaffected.
3. Settings > "Show music in the home feed" (v1.372.0) is gone, with its server filters and the `home=1` plumbing.
4. Dean, mid-build: "Can we also make it so that notifications don't pop for these. for playlists. It's just obnoxious."
   A video downloaded by a playlist job raises no download notification (bell or push); the job's own row in the
   download indicator still shows its progress and result.

## 2. What exists
- v1.97 Hide from feed: `userStore.addFeedHidden(userId, mediaId, at)` / `getFeedHidden`; applied ONLY in the modern grid of
  `GET /api/home?view=grid` (lib/media/routes.js); the restore list `GET /api/feed-hidden` (lib/user/routes.js); the backup
  carries it.
- A one-off's library item appears only when the post-download scan runs, fire-and-forget (lib/ytdlp/index.js runOneShot),
  so the media id does not exist when the download finishes: the hide waits for the item.

## 4. Rulings (Dean, 2026-10-07)
- R1 Remove "Show music in the home feed" (v1.372.0).
- R2 A "Hide from feed" box for every playlist download (audio or video, album or not), off by default.
- R3 Reuse the existing Hide from feed exactly: per user, the Modern feed only, undone from Settings' hidden list.
- R4 (builder) The `keepalive` on the synced-pref POST and the ui.js focus fix stay (they serve every pref and every sheet).
- R5 (Dean, mid-build) No notification for a playlist job's videos (always; no switch).

## 5. Waves
### W1. Remove the switch
- `ft-home-music` leaves the synced-pref lists (server, client, the triple lock); the Settings row and `wireHomeMusicApply`;
  `homeHidesMusic` and its four filters; main.js `home=1`; `FileTube.forgetHomeView` (its only caller); the tests and the
  census bumps. A stored `ft-home-music` row is inert (the client applies only allowlisted keys; a restore drops it).

### W2. Arrivals: quiet, and hidden from the downloader's feed
- `lib/ytdlp/arrivals.js` (new, waiting.js's posture: `<dataDir>/ytdlp-playlist-arrivals.json`, atomic temp + fsync +
  rename, degrade never throw, bounded MAX entries, TTL 7 days): `add({ youtubeId, userId|null, hide, sinceMs })` and
  `find(youtubeId, nowMs)`. The playlist job records one per video BEFORE it starts (only for a video it downloads itself,
  not one it waits on), with `userId` / `hide` when "Hide from feed" was ticked.
- The scan (lib/scan/orchestrator.js): ONE wrapper replaces the three `collectDownloadNotification` calls - an item whose
  `youtubeId` has an arrival raises no notification, and when the arrival asks to hide and the item was added at or after
  `sinceMs`, it joins that user's Hide from feed list (`userStore.addFeedHidden`). server.js passes the arrival lookup.
- The playlist job: `hideFromFeed` (boolean) and `userId` (from the SESSION in the route, never the body) are validated and
  persisted (restart); `hideFromFeed` rides the activity row for Retry (the user id never does: the status snapshot is
  shared).
- The picker: a "Hide from feed" row (ui.row + the ui-switch), posted as `hideFromFeed: true`; Retry carries it.

## 6. Gate
Seats: adversary (floor) + qa + security-brief (a new persisted carrier holding user ids; a write into a per-user table
from a background path; a removed setting).

## 7. Evidence
- Recon (builder): `users.id` is an INTEGER key (lib/db/sqlite.js `CREATE TABLE users`), so the job and the arrivals store
  validate a positive safe integer (the first draft checked for a string and would have refused every real user).
- The scan records notifications AFTER its doc commit (lib/scan/orchestrator.js); the hides ride the same post-commit
  seam (a rolled-back save never hides).
- Tests: test/unit/ytdlp-arrivals.test.js (the store: shape at rest, TTL, cap, integer user); the real-scan
  test/integration/scan-playlist-arrivals.test.js (control: a plain one-off notifies; a playlist video is quiet; with
  hide it joins its downloader's list; an item added before the job is never hidden); the job (the session's user, never
  the body's; persisted, also after the first video; a tampered user at rest drops the job); the picker (any format, the
  guard, posted, Retry). Mutants: 20 of 20 red by name (mut-1373 + mut-1373b).

## 8. Out of scope
- Hiding for every user (Dean chose per user); the row feed / classic home (v1.97 applies to the Modern feed only).
