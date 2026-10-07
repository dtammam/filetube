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

# v1.373.0: "Hide from feed" for a playlist download (and the music switch comes out)

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

## 5. Waves
### W1. Remove the switch
- `ft-home-music` leaves the synced-pref lists (server, client, the triple lock); the Settings row and `wireHomeMusicApply`;
  `homeHidesMusic` and its four filters; main.js `home=1`; `FileTube.forgetHomeView` (its only caller); the tests and the
  census bumps. A stored `ft-home-music` row is inert (the client applies only allowlisted keys; a restore drops it).

### W2. Hide from feed on arrival
- `lib/ytdlp/feedHide.js` (new, waiting.js's posture: `<dataDir>/ytdlp-feed-hide-pending.json`, atomic temp + fsync +
  rename, degrade never throw, bounded MAX entries, TTL 7 days): `addPending({ userId, youtubeId, sinceMs })`,
  `applyArrived(userId, metadata, addFn, nowMs)` - hides every library item whose `youtubeId` matches and whose `addedAt` is
  at or after `sinceMs` (so an older copy someone already had is never hidden), drops what it applied and what expired.
- The playlist job: `hideFromFeed` (boolean) + `userId` (from the SESSION in the route, never the body) are validated,
  persisted (restart) and on the activity row (Retry); each video that ends `done` adds a pending entry (since = when that
  video started, minus a margin).
- Applied where the hidden list is read: `GET /api/home?view=grid` and `GET /api/feed-hidden` (server.js passes one
  `applyArrivedFeedHides(userId)` to both).
- The picker: a "Hide from feed" row (ui.row + the ui-switch), posted as `hideFromFeed: true`; Retry carries it.

## 6. Gate
Seats: adversary (floor) + qa + security-brief (a new persisted carrier holding user ids; a write into a per-user table
from a background path; a removed setting).

## 7. Evidence
(builder fills in)

## 8. Out of scope
- Hiding for every user (Dean chose per user); the row feed / classic home (v1.97 applies to the Modern feed only).
