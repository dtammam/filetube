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

Gate: APPROVED r1 @80d012f4 - security-brief
- Gap (said first): the seat has no Bash, so no `git diff`, no test or mutant run; the changed code was read in place at
  the worktree HEAD (arrivals.js, the playlist job + route, the scan seam + post-commit loop, feed-hidden routes, prefs).
- Verified: the route refuses the API token first, then RBAC; `userId` is overwritten from `req.user` after the body is
  spread, so a body `userId` never lands; `hideFromFeed` without a session user is refused; the activity row carries
  `hideFromFeed` only (no caller passes `userId` in a patch). A hide only ever names the job's own user, so no request
  hides anything in ANOTHER user's feed. arrivals.js: fixed filename under dataDir, an array read back through an exact
  validator (no keyed object lookups, so no prototype pollution), capped at 2000, TTL 7 days, temp + fsync + rename.
  The hides fill only past the scan's epoch guard and are written after the commit; a deleted user's id fails the
  `user_feed_hidden` FK (foreign_keys ON) and is caught and logged. A hide of an item the user cannot see is not readable
  back: GET /api/feed-hidden filters through mediaVisibleTo, and the home grid uses the set only to skip items.
  `ft-home-music` is inert: POST and the restore drop it (allowlist), GET may return an old row, but the client's
  applyServer skips keys that are not allowlisted, and nothing in lib/ or public/ reads it.
- LOW (fix or accept): arrivals are keyed by YouTube id for 7 days and not removed when the child fails, is cancelled or
  has been scanned. Example: a member queues video V in a playlist; it fails (a premiere, members-only) or succeeds as
  audio; within 7 days a subscription or another user downloads V (a new item) -> no bell or push for ANYONE, and with
  hide it joins the first member's Modern feed list. Effect: notifications quietly lost, nothing leaks. Only users who
  can already download (admin / canManageSubscriptions) can cause it. Fix: drop the arrival when the child ends not
  `done`, and/or bind it to the job's own bridge entry instead of the bare id.
- LOW (fix or accept): addArrival replaces any live entry for the same id, and the cap drops the oldest. Another
  playlist job that downloads V (after the first finished, before its scan) or a burst of over 2000 videos can overwrite
  or evict a pending hide. Effect: a lost hide or quiet flag, never a cross-user hide.
- INFO: `users.id` is `INTEGER PRIMARY KEY` without AUTOINCREMENT, so deleting the newest user and creating one within 7
  days reuses the id; a pending job or arrival from before could hide items in the new user's Modern feed (they can be
  undone). A restore from another box can remap ids the same way (the arrivals file is not part of a backup and is not
  cleared by a restore). Rare, and only touches feed pruning.
- INFO (not security): findArrival re-reads and re-parses the file once per consumed item inside the scan's DB lock
  (up to 2000 entries each time); read it once per scan if scans with many items show up in profiling.

Gate: CHANGES r1 @80d012f4 - qa
- Ran (Node 22.23.1): `node --test` on ytdlp-arrivals, scan-playlist-arrivals, ytdlp-playlist-job, playlist-picker-client,
  prefs-sync-client, settings-census, settings-forms-sweep: 122 tests, 122 pass, 0 fail. `npm run lint:ui`: OK (debt equals
  docs/ui-exceptions.json). overlay-containment --enforce: clean (0 violations). eslint on the 17 changed lib/public/test
  files: 0 errors, 6 warnings, all pre-existing unused globals in common.js (setTheme, homeFeedEnabled, setIconSet,
  addToQueue, openTranscriptFor, shareExternalUrl). 390px CDP (qa3-on.png): the Hide from feed row sits above the album
  list, its switch at x=271 like the album switch, no overflow (scrollWidth 390), title and meta on one line each.
- Verified: the removal is clean in code (grep of ft-home-music / homeHidesMusic / home-music-check / forgetHomeView /
  wireHomeMusicApply / home=1 in lib, public, test, scripts: only history comments); SYNCED_PREF_KEYS has 22; keepalive
  kept (prefs-sync.js:103, with a new test); ui.js untouched. The route takes the user from the session after the body
  spread; the activity row carries hideFromFeed only. The real-scan test drives server.js scanDirectories with a real file
  and capture (the arrival is seeded directly; the job test binds the job writing it), so the chain is covered in two halves.
- WARNING W1 (lib/ytdlp/arrivals.js:262-282, lib/scan/orchestrator.js:111-120, lib/ytdlp/index.js:4398): an arrival is
  keyed by the bare YouTube id, outlives its job for 7 days, and is never removed (not on a failed or cancelled child, not
  once consumed), and it ignores format. Scenario: Dean downloads a playlist as Audio with Hide from feed; two days later
  he (or another member, or a subscription) downloads video V from it as Video. V.mp4 is a new item, its capture matches
  the arrival, so NO bell or push for anyone and, since addedAt >= sinceMs, the video joins Dean's Hide from feed list:
  the thing he wanted to watch is missing from his feed with no notice. Same for a playlist child that failed (premiere,
  members-only) and is later downloaded one-off or by a subscription: that download is silenced library-wide. Same
  finding as security-brief's first LOW, scored WARNING here because it silently regresses the v1.51 notification for
  downloads that are not playlist downloads. Fix: store the job's format in the arrival and match only item.type ===
  arrival.format; remove the arrival when the child ends not done (and on cancel); optionally drop it after the post-commit
  hide/quiet. Bind each with a test (a Video one-off after an Audio playlist arrival notifies and is not hidden; a failed
  child leaves no arrival).
- WARNING W2 (test/integration/ytdlp-playlist-job.test.js, test "Hide from feed is persisted (restart) with its user; a
  video another job is downloading gets no arrival of ours"): the second half of the title is never exercised or asserted
  (one job, nothing joins). Mutant (in /tmp/qa3-mut1373, from git archive 80d012f4): move addArrival above
  `if (joinId !== null)` so a joined video gets an arrival too -> ytdlp-playlist-job.test.js 28 pass, 0 fail (survives).
  The plan's rule "only for a video it downloads itself, not one it waits on" is unbound and the title lies. Fix: start a
  one-off for V, then a playlist containing V, and assert findArrival(V) is null (or rename the test and drop the claim).
- WARNING W3 (docs/DEVICE-CHECKS.md:182, docs/exec-plans/tech-debt-tracker.md:422 #293 (f)): an OPEN device check asks
  Dean to test "Settings > Show music in the home feed OFF", a switch this diff deletes; tracker #293 (f) ("?browse=1 counts
  as the home page, so it hides songs too") describes removed code. LESSONS 12: deleting a control deletes its whole trail,
  docs included. Scenario: Dean's next device pass looks for a switch that is gone. Fix: close/strike the check (removed in
  v1.373.0) and close #293 (f).
- SUGGESTION S1 (public/js/common.js:7557): the row's meta says "Keep these out of your home feed", but v1.97's list
  applies to the Modern feed only (plan section 8); a user on the classic home or the row feed ticks it and sees every
  track. Consider "Keep these out of your Modern feed" or accept and note it.
- SUGGESTION S2 (plan section 5 W2): names the API `add(...)` / `find(...)`; the code is addArrival / findArrival.
- Security surface: covered with security-brief's notes (agree with its LOWs and INFOs). Nothing new: the file is a fixed
  name under dataDir, read back through an exact validator into an array (no keyed lookups), user ids are integers from
  the session only, writes are post-commit and FK-guarded; no shell, no path built from input.

Gate: CHANGES r1 @80d012f4 - adversary
Instruments: targeted node --test (Node 22.23.1) on a git-archive sandbox of 80d012f4: 122 tests, 122 pass, 0 fail. eslint on the
14 touched files: 0 errors, 6 warnings (base 6846aec5: the same 6). 33 mutants, 7 survivors (below). Scratch repros were run in
the sandbox only (test/adv, not committed).
- W1 (blocks) A stale arrival silences and hides downloads it never started. The arrival is keyed by YouTube id for 7 days and
  never consumed, so ANY later download of that id (a one-off in the other format, a re-download after Trash, a subscription, a
  yewtu.be paste, by ANY user) raises no notification for anyone, and with Hide from feed joins the playlist downloader's hidden
  list. Measured through the real scan: arrival(hide, Dean) -> `Song [bbbbbbbbbb1].mp3` scanned (hidden, quiet: intended) -> a
  one-off `Song MV [bbbbbbbbbb1].mp4` + its capture -> scan: hidden=true, notified=false. Same for the D1a bracket
  `[Youtube=bbbbbbbbbb2]`. Fix: bind the arrival to the child's OWN download (the capture the child writes is consumed exactly
  once), or at least delete it at its first consume and when the child fails; add the repro above as a test.
- W2 (blocks) "A copy someone already had is never hidden" does not hold in the real kept-file lane, and test 4 uses a lookalike
  fixture (sinceMs an hour in the future). yt-dlp 2026.08.19 (primary source, YoutubeDL.py ~3666) runs post_process on an
  already-downloaded file; FFmpegMetadataPP.run (postprocessor/ffmpeg.py 702-708, our argv passes --embed-metadata, args.js:1315)
  writes `<name>.temp.<ext>` and os.replace()s it -> a new inode, a new birthtime -> the scan re-inits addedAt from it
  (orchestrator.js:1066 / 2259) -> addedAt >= sinceMs. Simulated with the real scan (index the file, arrival, replace via
  rename + capture, rescan): addedAt 1791408606422 -> 1791408606559, hidden=true. Fix: decide the hide when the arrival is
  written: hide only if `!youtubeIdInLibrary(deps, videoId)` (already there, fails closed, v1.371 R3's rule); bind it with a
  test that replaces the inode, not one that moves sinceMs.
- W3 (blocks) Lying test title + unbound invariant: ytdlp-playlist-job "...a video another job is downloading gets no arrival of
  ours" never tests that. Mutant j3 (addArrival also in the `joinId !== null` branch) survives: 0 failures. With it a user's
  own one-off that a playlist joins is silenced. Drive a join and assert findArrival is null, or retitle.
- W4 (blocks, cheap) docs/DEVICE-CHECKS.md:182-184 still asks Dean to check "Settings > Show music in the home feed OFF", a
  switch this diff deletes (LESSONS 12). Strike it (and mark tech-debt #293 (f) moot) in this round or the release commit.
- S1 The D1a site (orchestrator site 2) is reachable by noteDownloaded (W1 repro) but unbound: mutant m4 (site 2 back to
  collectDownloadNotification) survives; m5 (site 1) too (not reachable by a playlist child: its watchUrl is always youtube.com).
- S2 Survivors by construction: m3 (drop `arrival.hide &&`: addArrival never stores a user without a hide), a3 (userId > 0 at
  rest: the FK fails closed - measured: a user 9999 arrival logs "FOREIGN KEY constraint failed", the scan continues and indexes
  the item), a7 (fsync).
- S3 Mutant c7 (`feedList.hidden = false`) survives: nothing binds "hidden until the list is read".
- S4 The row says "Keep these out of your home feed", but only the Modern grid reads user_feed_hidden (routes.js grid
  short-circuit); the classic home and the row feed still show them (R3). Say "your Modern feed" or similar.
- S5 (reasoned, not run) Retry on the SHARED status row: another user's Retry posts hideFromFeed under THEIR session and hides the
  videos from their feed although they never ticked it.
- S6 (reasoned, not run) Two playlist jobs on one id before the first's scan: the second addArrival replaces the first (hide lost,
  or a no-hide job's arrival turned into a hide).
- S7 findArrival re-reads and parses the whole file (up to 2000 entries) per consumed item inside the serialized mutator: read
  it once per scan.
Verified fine: the route takes the user from the session (j1 red with the override removed); the status row never carries
userId (j8 red); persisted + rewritten pending entries keep hide/user (j4, j5 red); TTL boundary, cap, dedupe, at-rest
validation red (a1, a2, a4, a5, a6); picker guard, refusal, post, Retry, any-format red (c1-c6, c8); scan silence, sinceMs,
the hide write, the server.js wiring red (m1, m2, m6, m7, m8). W1 sweep: zero hits for homeHidesMusic, forgetHomeView,
wireHomeMusicApply, home-music-check, home=1 in lib, public, test, scripts, server.js. A stored ft-home-music row is still
returned by GET /api/prefs (getPrefs is unfiltered; read, not run) and the client's applyServer skips it (prefs-sync.js:165).

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
