---
plan: v1373-hide-from-feed
harness: v2 · lean
branch: feat/v1.373.0-hide-from-feed
anchor: outcome
status: Shipped v1.373.0
next: the release as v1.373.0
design: Dean's device pass on v1.372.0 and his rulings 2026-10-07 (R1-R4). Base main 6846aec5. The subtitles + 360 + cleanup wave renumbers to v1.374.0.
gate: APPROVED - security-brief + qa r2 @eb93798e, adversary r4 @911e9002 (Dean ruled quick delta re-checks by the adversary at rounds 3 and 4)
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
- R6 (Dean, round 3) The album sort stays ONE remembered setting (the friction-pass design the v1.331 play-through tests
  rely on); not "every album opens in track order".
- R7 (Dean, round 3) Opus downloads never appearing in the library (the scan's AUDIO_EXTENSIONS lacks .opus) is an older
  bug: its own release right after this one.

## 5. Waves
### W1. Remove the switch
- `ft-home-music` leaves the synced-pref lists (server, client, the triple lock); the Settings row and `wireHomeMusicApply`;
  `homeHidesMusic` and its four filters; main.js `home=1`; `FileTube.forgetHomeView` (its only caller); the tests and the
  census bumps. A stored `ft-home-music` row is inert (the client applies only allowlisted keys; a restore drops it).

### W2. Arrivals: quiet, and hidden from the downloader's feed
- `lib/ytdlp/arrivals.js` (new, waiting.js's posture: `<dataDir>/ytdlp-playlist-arrivals.json`, atomic temp + fsync +
  rename, degrade never throw, bounded MAX entries, TTL 7 days): `addArrival({ youtubeId, type, userId|null, hide,
  sinceMs })`, `listArrivals`, `findArrival(list, youtubeId, type)`, `removeArrivals(keys)`. An arrival is ONE download's
  (gate r1): the YouTube id AND the type (the job's format), used up by the first scan that matches it, removed when that
  video does not finish.
- The playlist job records one per video BEFORE it starts (only for a video it downloads itself, not one it waits on),
  hiding only when "Hide from feed" was ticked AND no library already has that video (`youtubeIdInLibrary`, failing
  closed - yt-dlp re-muxes a kept file, so its fresh birthtime defeats the `sinceMs` guard alone: gate r1 adversary W2).
- The scan (lib/scan/orchestrator.js): ONE wrapper (`noteDownloaded`) replaces the three `collectDownloadNotification`
  calls; it reads the arrivals once per scan; a matched item raises no notification and, when the arrival hides and the
  item was added at or after `sinceMs`, joins that user's Hide from feed list (`userStore.addFeedHidden`) - both written,
  and the used arrivals removed, after the doc commit. server.js passes the list / remove functions.
- The playlist job: `hideFromFeed` (boolean) and `userId` (from the SESSION in the route, never the body) are validated and
  persisted (restart); `hideFromFeed` rides the activity row for Retry (the user id never does: the status snapshot is
  shared).
- The picker: a "Hide from feed" row ("Out of your feed in Modern mode": v1.97's list applies to the Modern feed), posted
  as `hideFromFeed: true`; Retry carries it.

### W3. The album track listing (Dean: "let's do it all together")
- From a read-only exploration of "should an 'album' I download have a track listing and be sorted by 'track'": the
  track number reached the client but no surface showed it; every album opened in ONE saved sort; the iPod's Artists >
  artist > album played newest upload first. Now: "Track N" (or "Disc D · Track N") in the row's overline on an album page
  in album order (the slot TV episode rows use); the iPod's artist > album level lists and queues in the ALBUM sort through
  the same server request as Albums > album. The album sort stays ONE remembered setting (track order by default): Dean
  ruled to keep the friction-pass design at round 3 (R6), so "always open in track order" was dropped.

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

### Gate round 1 fixes (builder, 2026-10-07)
- adversary W1 / qa W1 / security LOW (a stale arrival silenced and hid other downloads): an arrival is now ONE download's -
  keyed by YouTube id AND type (the job's format), used up by the first scan that matches it (removed after the commit),
  and removed by the job when that video does not finish. Bound: the adversary's repro (the playlist's audio hidden, a
  later one-off video of the same id notifies and stays visible), a re-download after use notifies, a video-type arrival,
  a failed video's arrival removed.
- adversary W2 (a kept file is re-muxed, so its birthtime defeats `sinceMs`): the job hides only when no library already
  has the video (`youtubeIdInLibrary`, failing closed); still quiet.
- adversary W3 / qa W2 (a test claimed the join rule untested): a real join (a one-off in flight, then the playlist) leaves
  no arrival; the over-claiming title was corrected.
- adversary W4 / qa W3 (docs of the removed switch): the v1.372.0 device checks are marked confirmed (Dean, 2026-10-07; the
  switch one noted as removed); tracker #293 (f) is moot.
- Suggestions taken: the arrivals file is read once per scan (S7); the D1a [Youtube=id] site is bound (S1); the row stays
  hidden until the list is read (S3); the row says "Out of your feed in Modern mode" (S4 / qa S1); the plan names the real
  functions (qa S2). Disclosed, not fixed: a Retry tapped by ANOTHER user (the status row is shared) hides the retried videos
  from that user's feed (adversary S5); two playlist jobs racing for the same download share one arrival (S6).
- Mutants on the fixes: 8 of 8 red by name (mut-1373r1 + r1b).
- Final suites @911e9002: Node 22.23.1 `# tests 11519 / # pass 11506 / # fail 0 / # skipped 13`; Node 24.20.0 `tests 11519 /
  pass 11506 / fail 0 / skipped 13`.
- The album track listing (W3, merged from feat/v1.373.0-album-order @b56a7394): 9 album mutants, 8 red, 1 equivalent (a
  redundant stable tie-break, removed).

Gate: APPROVED r2 @eb93798e - security-brief
- Gap (said first): no Bash, so no `git diff 80d012f4..eb93798e` and no runs; I read the files in place at the worktree
  HEAD (arrivals.js, index.js 4384-4413, orchestrator.js 1355-1372 and 2123-2126, server.js 2999-3000, music.js 219-257).
- r1 LOW (a stale arrival silences or hides other downloads): fixed as prescribed. An arrival now matches id AND type,
  the scan removes it after the commit (`usedArrivals` fills only inside the mutator past the restore guard), and the job
  removes it when the child ends in any state other than `done` (error and cancel included). A hide is decided when the
  arrival is written (`!youtubeIdInLibrary`, failing closed). The hide still names only the job's session user.
- r1 LOW (overwrite / eviction): partly fixed. Replacement is now limited to the same id + type. Racing jobs and the
  2000 cap can still lose a quiet or hide flag (disclosed as S6). The worst case is a lost flag, never a cross-user hide.
  Accepted as INFO.
- New, INFO: `removeArrivals` matches by {youtubeId, type}, not by entry. A same-key arrival written after the scan read
  the file (a second job re-downloading the same video) is removed with the used one, and that download then notifies.
  The flag is lost and it fails open (back to the normal bell); no security effect.
- New, INFO (adversary S5, disclosed): another user's Retry on the shared status row posts `hideFromFeed` under THEIR
  session, so the hides land only in the retrier's own Modern feed, can be undone, and need the playlist RBAC. Not a
  cross-user write.
- Album UI: `songTrackLabel` builds text only from `Number.isInteger` trackNo / discNo plus fixed strings, and it reaches
  the HTML through `escapeMusicHtml` (music.js:257). The sort uses the data in memory and makes no request. No injection
  surface.

Gate: APPROVED r2 @eb93798e - qa
- Ran (Node 22.23.1): `node --test` on ytdlp-arrivals, scan-playlist-arrivals, ytdlp-playlist-job, playlist-picker-client,
  music-sort-behaviour, music-album-order, music-pocket-menus: 137 tests, 137 pass, 0 fail. `npm run lint:ui`: OK (debt
  equals docs/ui-exceptions.json). overlay-containment --enforce: clean (0 violations). eslint on the 13 changed lib/public/
  test files: 0 errors, 6 warnings (the same pre-existing unused globals in common.js).
- Mutants (/tmp/qa3-r2-m1..m7, git archive eb93798e): all 7 red. m1 match by id only (no type): scan-playlist-arrivals
  1 fail; m2 no removal on a failed child: playlist-job 1 fail; m3 hide without the in-library check: 1 fail; m4 the scan
  never removes used arrivals: 1 fail; m5 the iPod artist > album without sortAlbumOrder: 1 fail; m6 the per-album sort
  carried to every album: music-sort-behaviour 1 fail; m7 (my r1 W2 mutant) addArrival above the join: "a video ANOTHER
  job is downloading ... gets NO arrival of ours" fails.
- r1 W1 FIXED as prescribed (id + type, removed when the child ends not done, used once and removed after the commit),
  plus the in-library rule for the re-mux birthtime. r1 W2 FIXED: a real join test that binds (m7). r1 W3 FIXED:
  DEVICE-CHECKS v1.372.0 marked confirmed, the switch noted as removed; #293 (f) MOOT. r1 S1 FIXED ("Out of your feed in
  Modern mode", asserted in the picker test). r1 S2 FIXED.
- Album listing: the overline is the kit's `ui-row__overline` (ui.css:404, var(--t-footnote) / var(--ink-2): tokens
  only), as tv.js:86 uses for episode codes. Measured at 390px (qa3-album.png, standalone rows from buildSongRowHtml): one
  line, 12/16 px, ink-2, row 64 -> 78 px, no overflow from the overline. There is no viewport rule for the overline, so
  desktop gets the same CSS (reasoned, not shot). The progressive chunked builder (music.js:5023) never numbers rows, but
  it only builds the flat Songs list; every album page goes through renderDrillView. Screen reader: the label is plain
  text in the row body, before the title button, so a list walk reads "Track 3" then the title. The play button's name is
  the title only, the same as a TV episode row. "·" is the separator the meta line already uses.
- WARNING (safe to ship disclosed; my call, not a blocker) N1 (lib/ytdlp/index.js:4400, youtubeIdInLibrary): the new
  in-library rule ignores type. Scenario: Dean already has video V as a VIDEO, then downloads the playlist as AUDIO with
  Hide from feed on. V's audio is a new file, but youtubeIdInLibrary(V) is true, so hide=false and the song shows in his
  Modern feed though he ticked the box. It fails toward visible: no data loss, no cross-user effect, undo is one tap.
  Fix later: check the library for the same id AND the job's type (the same key the arrival now uses). Track it.
- SUGGESTION N2: a child that ends done without making a new item (yt-dlp kept an existing same-type file) leaves its
  arrival for up to 7 days. If that file is deleted and the same type re-downloaded in the window, the re-download is
  quiet. Narrow.
- SUGGESTION N3 (test/unit/music-album-order.test.js, last test): the iPod artist > album order is bound by a source regex,
  not by behaviour. m5 is also red through it, but a rewrite that keeps the order and changes the spelling would fail.
- Security: no new surface. removeArrivals keys on the validated (id, type) of entries already read; the music changes
  are client-only; the overline text goes through escapeMusicHtml.

Gate: CHANGES r2 @eb93798e - adversary
Instruments: targeted node --test (Node 22.23.1) on a git-archive sandbox of eb93798e: 102 tests, 102 pass, 0 fail. eslint on the
13 touched files: 0 errors, 6 warnings (unchanged). 23 mutants: 13 on the r1 fixes and r1 survivors (12 red, 1 perf-only
survivor), 10 on the album listing (6 red, 4 survivors, below).
r1 findings, verified against eb93798e:
- W1 FIXED as prescribed (mostly): my r1 repro now notifies and stays visible (bound by name). Red: r1 (no removal of used
  arrivals), r2 (type ignored), r3 (scan type always audio), r4/r7 (no or wrong-type removal on failure), r6 (job type always
  audio), r9 (removeArrivals no-op). One residual lane, NEW W1 below.
- W2 FIXED differently (the job decides with youtubeIdInLibrary rather than the scan): r5 (drop `!youtubeIdInLibrary`) red.
  The re-muxed kept file through the real scan: the job now writes hide=false for it, so the scan cannot hide it; the
  scan's own sinceMs check (r10) is still bound by test 4. Over-protects (a video someone has only as an MP4 is not hidden as
  the new MP3): the safe direction, the #292 (a) class.
- W3 FIXED: a real join; r12 (an arrival in the join branch) red by name.
- W4 FIXED: DEVICE-CHECKS marks v1.372.0 confirmed (Dean's quote in section 1 supports it); #293 (f) moot.
- S1 bound (r11 red), S3 bound (r13 red), S4 copy changed, S7 read once per scan (r8, re-reading every time, survives:
  perf only, fine), S5/S6 disclosed.
NEW:
- W1 (blocks, cheap) An Opus playlist download's arrival is never used, so the r1 class lives on for Opus. `.opus` is not in
  the scan's AUDIO_EXTENSIONS (server.js:1301), the picker allows Opus for a playlist without an album, the child ends 'done'
  so its arrival stays for 7 days, and a later MP3/M4A one-off of the same id (type audio) is matched. Measured through the
  real scan: arrival(audio, hide, Dean) + `Song [cccccccccc1].opus` + capture -> scan: not indexed, arrival still live; then a
  one-off `Song [cccccccccc1].mp3` + capture -> scan: hidden=true, notified=false. Fix: write no arrival when
  job.filetype === 'opus' (nothing the scan can index arrives), or remove it after the child for that filetype; add the
  repro. Safe to ship disclosed only if Dean rules so; the fix is one line.
- S1 sortAlbumOrder is not the server's album-order for disc 0. Server albumSortValue (lib/music/query.js:27) takes ANY
  integer disc; the client maps disc <= 0 to 1, and tags.js parseTrackNumber returns 0 for a "0" or "0/1" disc tag. Measured:
  [d1t1, d1t2, d0t5, nod(t3)] -> server `d0t5 d1t1 d1t2 nod`, client `d1t1 d1t2 nod d0t5`. So the iPod's artist > album order
  differs from Albums > album for such a file, and the comment "The album sort the server's album-order uses" is false there.
  Use `Number.isInteger` alone, as the server does.
- S2 Lying comment: music.js sortForTab says a pick holds "(in memory, until another album opens)", but nothing clears it.
  Measured in jsdom (music-sort-behaviour harness): album 1 -> Title -> album 2 opens in album-order -> album 1 again opens in
  title-asc. The plan's "an album opens in album order every time" is not literally true either. Either clear albumDrillSort
  when a different album opens or reword both.
- S3 Album survivors: al2 (writeSortForTab persisting the drill-album pick again) survives because the test's pick equals the
  old saved value ('release-newest' both), so "the stored map is untouched" cannot fail (pick a different value). al9 (disc
  weight 1000 -> 10) survives: no fixture has a track >= 10. al6 (no escape on the label) is equivalent (digits only).
- S4 (reasoned, not run) The iPod's artist > album level always queues album-order, but the drill it opens reads the
  in-memory pick: after a Title pick on that album's page, the iPod's pick shows rows in album order with the sort menu saying
  Title and no track numbers.
Album surfaces (read, not run unless stated): every album drill paints through renderDrillView (album card, Recent Albums,
Playing from at 4702/5469, the iPod's album levels at 4984, deep links via applyMusicLink); renderSongList and the progressive
renderer serve only non-drill lists, so no album page skips the numbers. A queue whose sort was only in memory keeps it
across a reload: the encoded browseCtx carries `sort`, and the ctx rebuild passes ctx.sort (music.js ~4606). The old saved
`drill-album` value is ignored on read (al3 red) and nothing else reads it (grep: music.js only).

### Gate round 2 and the round 3 changes (builder, 2026-10-07)
- r2: security-brief + qa APPROVED @eb93798e; adversary CHANGES (W1: an Opus playlist's arrival is never used - the scan
  never indexes .opus). The full Node 22 suite @eb93798e FAILED 2 of 11519 (verbatim: "not ok 720 - v1.331 gate r1 W1:
  Albums > album sorted Title Z-A - a pick plays the rest of the album in LIST order, then the station (never a loop)" and
  "not ok 721 - v1.331 gate r1 W1: Artists > artist > album sorted Longest first (Dean's artist path) - the same
  list-order play-through"): the album change dropped the remembered album sort those tests set. Dean ruled (R6) to keep
  the remembered sort; round 3 is a quick delta re-check by the adversary (his ruling).
- Changes: no arrival for an Opus job; the remembered album sort restored; the iPod's artist > album level fetches with
  the album sort (`/api/music?album=...&sort=<drill-album>`, the Albums > album request - the client sort and its disc-0
  mismatch, adversary r2 S1, are gone); test 721 now sets the ALBUM sort with a DIVERGENT artist sort (Longest first and
  Title Z-A ordered the three chapters alike, so a mutant to the artist sort survived). Mutants: 4 of 4 red.
- Disclosed (tracker): QA r2 N1 (the "already in library" rule ignores audio vs video - a song you have only as a video is
  not hidden when its audio lands); N2 (a done video that created no item keeps its arrival up to 7 days); security INFO
  (id reuse, restore remapping, removeArrivals by key); adversary S5 (a Retry by another user), S6 (racing jobs).

Gate: APPROVED r3 @e067dbe2 - adversary
Instruments: targeted node --test (Node 22.23.1) on a git-archive sandbox of e067dbe2 (arrivals scan, playlist job, arrivals
unit, album order, sort behaviour, music-pocket-menus): 76 tests, 76 pass, 0 fail. eslint on the 7 touched code/test files:
no problems. Sweep: zero hits for sortAlbumOrder / albumDrillSort in public, lib, test. 8 mutants, 8 red.
- r2 W1 FIXED as prescribed: an Opus job writes no arrival. o1 (guard removed) red by name (test 32); o2 (no arrival for any
  filetype) and o3 (guard on format instead of filetype) red via tests 25/29/30. With no arrival, my r2 scan repro's later
  MP3 one-off takes the plain path, which the control test binds (notifies, not hidden).
- r2 S1, S2, S4 moot by R6 (sortAlbumOrder and the in-memory album sort are gone). S3's al2/al9 survivors went with them.
- The artistAlbum level: `n.key` is the row's `albumKey` (music-skins menuArtistAlbumItems), which the server mints with
  store.albumKeyFor (server.js:4148), the same function `?album=` filters by (query.js matchesAlbum). It now follows the
  remembered drill-album sort: p1 (the artist sort), p3 (a fixed URL sort) red in the v1.331 play-through with divergent
  sorts; p2 (a fixed ctx sort) red by the source lock only.
- Numbering under the remembered sort: rows are numbered only when the remembered drill-album sort is album-order (p4
  always / p5 never red).
- S1 (disclose) The artistAlbum level changed SCOPE, not just order. It used to list the artist's own songs on that album
  (tracksOfAlbum over `?artist=`); `?album=` alone lists the whole album. Measured with the route's own predicates
  (routes.js:226-227 compose album AND artist): artist A on a "Various Artists" compilation -> before `c1`, now `c1 c2 c3`.
  This matches Albums > album and the desktop, but a real iPod's Artists > artist > album shows that artist's songs. If
  wanted, add `&artist=` to the request (the route already ANDs them), knowing the ctx rebuild scopes by album only.
- S2 (disclose) Under R6 a device whose remembered album sort is not Album order shows no track numbers on any album until
  Album order is picked once. Worth a line in the v1.373.0 device check.

### After round 3 (builder, 2026-10-07)
- The full suite @e067dbe2 FAILED 1 of 11518 on both Nodes (verbatim: "not ok 772 - W1 paths: an artist drill pages the
  artist route; its albums come from the whole list"): the round-3 artist > album level always fetched, against the W1
  paging design (a big library's album level is served from the artist's cached whole list, no second read). Fix: in
  track order (the default) the level is built off the cached list with `sortAlbumOrder`, an EXACT mirror of the server's
  albumSortValue (any integer disc, so the r2 disc-0 mismatch does not return - a test compares it with
  lib/music/query.js sortTracks on one album); any other album sort asks the server. Mutants 4 of 4 red.

Gate: APPROVED r4 @911e9002 - adversary
Instruments: targeted node --test (Node 22.23.1) on a git-archive sandbox of 911e9002. pocket-library-paging-paths,
music-pocket-menus (integration), music-album-order, music-sort-behaviour: 48 tests, 48 pass, 0 fail (the r3 failure, W1 paths
"an artist drill pages the artist route; its albums come from the whole list", now passes). Siblings: pocket-library-paging +
music-pocket-menus-r1: 32 tests, 32 pass, 0 fail; unit music-pocket-menus, music-skins, music-skin-integration,
pocket-quick-scroll, pocket-skins-menu: 248 tests, 248 pass, 0 fail. 9 mutants: 8 red, 1 survivor.
- The fix holds. q1 (never the cached list) turns the paging test red (the r3 failure); q2 (always the cached list) turns the
  divergent-sort play-through red; q3 (no sortAlbumOrder) red by the source lock only; q4 (disc > 0, the old client rule), q6
  (a missing track last), q9 (a missing disc 0) red against the server comparison; q7 (descending) red in 4 play-through
  tests; q8 (an unstable tie-break) red in the paging test and the mirror test.
- S1 Survivor q5 (disc weight 1000 -> 10): the fixture's highest disc-1 track is 10, which still sorts before disc 2 track 1
  at weight 10. Add a disc-1 track 12 to the mirror test.
- S2 (reasoned, not run) "Mirrored EXACTLY" holds for the comparator. Ties (tracks without numbers, e.g. an untagged
  downloaded "album") keep each side's INPUT order: the server's library order for Albums > album, the artist sort for the
  iPod's artist > album. So an unnumbered album can list differently on the two paths.
- S3 (disclose, as the brief notes) The level's scope now depends on the album sort: in track order it is the artist's own
  songs on that album; under any other album sort it is the whole album (r3 S1, compilations only).

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
