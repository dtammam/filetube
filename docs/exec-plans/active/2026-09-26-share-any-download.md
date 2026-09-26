---
plan: share-any-download
harness: v2 · lean
branch: feat/v1.337-share-any-download
anchor: outcome
status: Gate:APPROVED r2 @98801b94
next: release v1.337.0 (docs/RELEASING.md).
gate: APPROVED r2 @98801b94 (adversary, qa)
---

# v1.337.0: Share for non-YouTube downloads, and no swipe-back in fullscreen video

## The ask (Dean, 2026-09-25, verbatim, ROADMAP Planned)

"I want us to make it so that we can share content that is not YouTube downloads. So for example, I'm
downloading some things supported by YTDLP, like Facebook and Reddit ... it's watching them as like a
95% first class experience ... There's no share button ... a share button that basically just shares
the logged URL of whatever it is that we captured. I'm not really asking for anything else."

### Dean's ruling at intake (AskUserQuestion, 2026-09-26)

- **Watch page only**: the video page's Share button reads the URL from the file itself; works for
  every past and future download; nothing new stored in the library; card Share corners stay
  YouTube-only. (Declined: storing the URL in the library for cards and search.)

## Acceptance (outcome anchor)

1. A yt-dlp download from any non-YouTube site (an item the scan gave a `sourceExtractor` and that has
   no YouTube link) shows the Share button on its watch page, and it shares the page URL yt-dlp
   recorded for that download - in every container yt-dlp writes (MP4, MKV, WebM, MP3, M4A, Opus).
2. It works for downloads made BEFORE this release (the URL comes from the file's own tags).
3. Everything else is unchanged: YouTube items share exactly as before (incl. "Share at current time"
   and the chapter share icons); a plain local file (not a yt-dlp download) gets no Share; card
   corners, search and the music skins are untouched; the watch route's response is byte-identical
   for every item that is not a non-YouTube yt-dlp download.
4. (Item 2) In fullscreen video a swipe in any direction leaves fullscreen and the page as they were;
   outside fullscreen the swipe-back behaves as before.

## Research

- The client already shows Share whenever the watch route sends `mediaData.watchUrl`
  (public/js/watch.js setupShareButton). The server derives `watchUrl` ONLY from a safe `youtubeId`
  (`buildWatchUrl`, lib/ytdlp/url.js) at four serve sites (lib/media/routes.js x2, server.js, the
  search registry).
- `watchUrl` is NOT only the Share button's: watch.js spreads mediaData into `player.load`, and the
  player's chapter rows share `currentData.watchUrl` with a `?t=` start (player.js ~7571); the music
  skins' share reads `item.watchUrl` (skin-surface.js). A Reddit / Facebook link must reach neither,
  so the non-YouTube link is a NEW field, `sourceShareUrl`, read only by the watch page's Share.
- The library does not persist a non-YouTube download's URL: the scan writes `sourceExtractor` /
  `sourceId` (lib/scan/orchestrator.js, from the universal download meta, which carries no URL).
- Every download runs with `--embed-metadata` (lib/ytdlp/args.js:1219), and yt-dlp's metadata
  post-processor writes the page URL (`webpage_url`) into the file's `purl` and `comment` tags.
  server.js already reads it: `probeEmbeddedTags` -> `parseEmbeddedSourceUrl` (purl, then comment,
  any http(s) URL).
- The local dev library has 284 items, 0 with `sourceExtractor` (read-only query on a copy), so the
  real distribution cannot be measured here; the build is measured on a real tagged file instead.
- Verified at primary source (yt-dlp master, yt_dlp/postprocessor/ffmpeg.py:749):
  `add(('purl', 'comment'), 'webpage_url')`; with `--compat-options embed-metadata` the `comment`
  becomes the description instead (FileTube passes no compat options: lib/ytdlp/args.js). yt-dlp
  passes no `-movflags +use_metadata_tags`, and the MP4 muxer drops the non-standard `purl` without
  it - measured with the box's ffmpeg: an MP4 written with both keys reads back `comment` only; with
  `+use_metadata_tags` both. So an MP4 download's URL lives in `comment`, which the parser reads
  after `purl` (MKV / WebM keep both).

## Design

- `lib/media/source-share.js` (new): `sanitizeSourceShareUrl(raw)` (pure: http(s) only, parses as a
  URL, no credentials, no whitespace or control characters, at most 2048 characters) and
  `createSourceShareResolver({ probe, stat })`: resolves an item's share URL from its file's tags,
  cached per file path and keyed by size + mtime (a replaced file is re-read), a bounded cache, a
  time limit on the probe, and never rejects.
- `GET /api/videos/:id`: only when the item has no YouTube `watchUrl` AND carries a `sourceExtractor`
  does the route await the resolver and add `sourceShareUrl`; every other item keeps the synchronous
  path and a byte-identical response.
- watch.js: the Share button mounts for `watchUrl || sourceShareUrl`; the "Share at current time"
  choice stays YouTube-only (a `?t=` means nothing to another site); the label says "the original
  link" for a non-YouTube item.

## What was built

- `lib/media/source-share.js` (new): `sanitizeSourceShareUrl`, `wantsSourceShareUrl`,
  `createSourceShareResolver` (cache per file path keyed by size + mtime, at most 500 files, least
  recently used evicted; a 1.5s probe limit; a failed or timed-out probe is not cached; never rejects).
- server.js: the resolver on `probeEmbeddedTags` + `fs.promises.stat`, handed to the browse routes.
- lib/media/routes.js `GET /api/videos/:id`: the response object is built as before; only an item the
  resolver `wants` (a `sourceExtractor`, a file path, no YouTube `watchUrl`) awaits it and gains
  `sourceShareUrl`; the RBAC 404 still runs first.
- public/js/watch.js: `shareLinkOf` (watchUrl, else sourceShareUrl); the time choice only for the
  YouTube link; the button's title and aria-label follow the link kind and are set on every item.

### Measured (copied from the runs)

- `node --test test/unit/source-share.test.js`: `# tests 12`, `# pass 12`, `# fail 0`.
- `FILETUBE_TEST_FFMPEG=$HOME/.local/bin/ffmpeg-static/ffmpeg node --test
  test/integration/watch-source-share.test.js` (the real app, a real ffprobe, an MP4 in yt-dlp's
  real shape): `# tests 4`, `# pass 4`, `# fail 0`, `# skipped 0`; without ffmpeg: `# skipped 4`.
- `node --test test/integration/watch-share-button.test.js` (the real watch.js in jsdom, 6 new):
  `# tests 10`, `# pass 10`, `# fail 0`.
- `npx eslint` over the changed files: exit 0.

## Item 2: a right swipe exits fullscreen video (Dean, 2026-09-26, added to this branch)

- Dean: "I noticed a bug can we resolve with this branch. In full screen video view if I swipe right
  anywhere that isn't the scrub bar it exits full screen on mobile." His answers: what happens
  "depends it seems"; a right swipe should do **nothing in fullscreen video**; **one release** with
  Share.
- Research contradicted his earlier ruling, so it was surfaced (flow.md invalidation rule): v1.311.3
  ("scrubbers only") made the document-wide swipe-back (common.js `wireSwipeBackGesture`, 90px
  rightward, 1.5x dominance) fire from anywhere but a scrubber, INCLUDING faux fullscreen (its own
  comment said so). The back is `history.back()`, which leaves the watch page and drops fullscreen.
- Hypothesis: that one gesture is both of his outcomes (where you land is the previous history entry:
  another page, or a previous watch page that looks like "still on the video page"). Falsifier: a
  right swipe that still ends fullscreen after the stand-down = a second mechanism, re-root-caused.
- Fix: `swipeBackStandDownReason` returns 'fullscreen' while `body.ft-css-fullscreen` (the faux
  overlay) or a Fullscreen API element is up. The expanded audio view and the full-screen skins keep
  their swipe-back (the v1.311.3 escape); the scrubber owners are unchanged.
- Measured: `node scripts/faux-fullscreen-probe.js` (home, an in-app navigation into the video, the
  real `#fs-btn`, a real touch swipe right across the picture):
  - base cbe0d880 (v1.336.0), exit 1: `SWIPE depth=1 fullscreen true->false url
    /watch.html?v=v1->/ FAIL` (Dean's bug, reproduced headless);
  - branch, exit 0: `SWIPE depth=1 fullscreen true->true url /watch.html?v=v1->/watch.html?v=v1 ok`.
- `node --test test/unit/swipe-back-owners.test.js test/unit/router-helpers.test.js`: `# tests 87`,
  `# pass 87`, `# fail 0`. The v1.311.3 test that asserted a swipe on the video in faux fullscreen
  goes back was the old ruling, rewritten to the new one (the audio view's half kept as it was).

## ROADMAP

- Dean (2026-09-26) added an idea, not built: lock the hold-to-speed-up by dragging down.

## Gate

Gate: CHANGES r1 @4a039ff4 - qa

Instruments (Node 22.23.1, run by QA at 4a039ff4): `npm run test:unit` `# tests 7483` `# pass 7483` `# fail 0`;
`npm run lint` `0 errors, 6 warnings` (the same 6 as base cbe0d880, common.js browser globals); `npm run lint:css`
`TOTAL 0`; `npm run lint:overlay` `clean (0 violations)`; check-markers `clean`; the two integration files
(FILETUBE_TEST_FFMPEG set) `# tests 14` `# pass 14` `# fail 0` `# skipped 0`; faux-fullscreen-probe branch exit 0
`SWIPE depth=1 fullscreen true->true url /watch.html?v=v1->/watch.html?v=v1 ok`, same probe with FT_ROOT=base
archive exit 1 `SWIPE depth=1 fullscreen true->false url /watch.html?v=v1->/ FAIL` (binds). Acceptance 3 measured:
GET /api/videos/:id raw bodies base vs branch, same seed, 9 shapes (plain, plain+tagged file, YouTube, proxy
YouTube, unsafe youtubeId, Reddit untagged, Reddit missing file, 404): all sha-identical; only Reddit+tagged differs,
by the one appended `sourceShareUrl`. route-order-signature: 211 lines, identical unsorted.

1. WARNING - lib/media/source-share.js:22-37 (and its comment :19-20, the plan's Design): the sanitizer claims "no
   whitespace or control characters" but checks only C0 + DEL, and returns the RAW string, not the parsed URL.
   Measured: `https://www.reddit.com/r/x\u0085y` (C1 NEL) and `\u009b` pass; `https://www.reddit.com/r/‮gpj.exe`
   (RLO) passes and is shared as is (renders ".../exe.jpg" in a chat app); U+2066 and U+200B pass;
   `https://www.reddit.com\@evil.example/` passes raw (WHATWG host reddit.com, an RFC 3986 parser reads host
   evil.example). Any file in the yt-dlp root with a `[Extractor=id]` bracket (the scan gap-fills sourceExtractor from
   the name) or a site's webpage_url (yt-dlp strips only NUL) reaches navigator.share / the clipboard with it.
   Fix: return `u.href` (measured: identical for all 4 pass-through URLs in the test, percent-encodes the C1/bidi/
   zero-width cases, normalizes the backslash), or refuse /[\p{Cc}\p{Cf}]/u; add C1, RLO and the backslash case to
   the unit table.
2. WARNING - lib/media/source-share.js:60-64, 78-80: a probe that overruns the 1.5s limit is thrown away, and
   there is no in-flight dedupe. Measured (injected 2s probe): 20 concurrent cold resolves = 20 probe spawns, all
   null; after all 20 finished `cacheSize=0`; the next resolve is null again and spawns #21. So on storage where
   ffprobe of a file takes over 1.5s (a cold SMB/NAS mount - Dean's library is SMB, LESSONS 11), every watch load
   waits 1.5s, spawns another ffprobe, and never shows Share: it never converges (LESSONS 2, a result committed only
   inside a deadline prod never meets is dead). The transcode poll (player.js:4978, GET /api/videos/:id every 2s)
   re-enters it too. Not measured on Dean's storage (should-happen, by construction). Fix: keep a per-filePath
   in-flight promise; the route still races the limit, but the probe's late answer fills the cache (keyed by the
   stat taken before it); test: slow probe -> first resolve null at the limit -> after it lands the next resolve
   returns the URL with exactly 1 probe.
3. SUGGESTION - lying comments: source-share.js:40-41 "the scan writes `sourceExtractor` only for those" is false
   (orchestrator.js:1617-1627 writes 'Youtube' for a proxy-host download; the unsafe-youtubeId shape is probed);
   watch.js:3366 "set on EVERY item (the button survives an SPA item change)": setupShareButton's only call is
   watch.js:1384 inside initWatch, once per open (watch.js:1297-1299), so that mechanism does not exist; watch.js:3263
   still heads the share code as "the item's ORIGINAL YouTube link". Plan acceptance 1 "(an item carrying
   `sourceExtractor`)" has the same imprecision.
4. SUGGESTION - test/unit/swipe-back-owners.test.js:213-222 binds only `doc.fullscreenElement`; the
   `|| doc.webkitFullscreenElement` arm (common.js:9980) is unbound (reasoned: deleting it leaves every test green).
   Add a case that defines only webkitFullscreenElement.
5. SUGGESTION - plan: acceptance 3 "byte-identical" had no measurement in the plan (the integration tests assert key
   absence only); copy a measurement in. Item 2 has no acceptance bullet; add one (fullscreen, faux or API: a right
   swipe from anywhere neither leaves the page nor exits; the audio view and the skins keep the swipe-back).
6. SUGGESTION - ROADMAP.md:94-96 "The ask: ... then a way to unlock (a tap on a speed pill, or holding again)":
   Dean's words (session transcript, verbatim in the entry) ask only for the lock by dragging down; the unlock
   options are the builder's. Put them under the entry's own "First questions".

Security surface (standing brief): RBAC 404 runs before wants/stat/probe (routes.js:740 before :829, source-locked
and ordered); filePath comes from the DB, never the request, into execFile with an args array (no shell, absolute
path, no option injection); no server-side fetch of the URL (no SSRF); the URL never reaches the DOM as markup
(title / aria-label are fixed strings; it goes only to navigator.share / clipboard.writeText); javascript:, data:,
file:, credentials and over-length are refused (unit + measured). Open: finding 1. Cache bounded at 500 small
entries; the probe spawn is finding 2.

Gate: CHANGES r1 @4a039ff4 - adversary

Instruments (Node 22.23.1, /tmp git-archive sandboxes of 4a039ff4 and cbe0d880, pristine copy diffed after every
mutant): the diff's 6 test files `# tests 117` `# pass 117` `# fail 0`; the plan's counts reproduced (12/12, 10/10,
87/87, 4/4 with ffmpeg, `# skipped 4` without); eslint on the 11 changed files exit 0 (6 warnings, common.js, none
new). Full `npm test` in the sandbox `# tests 9679` `# pass 9668` `# fail 8` `# skipped 3`: the 8 are git-backed
source locks (app-settings-store, comment-debt-census x2, dbjson-never-read, media-items-store, media-record-stores,
media-trash-store, media-view-counts-store) that fail identically in the base sandbox (`# fail 8`) and pass in the
real worktree at 4a039ff4 (`# pass 69` `# fail 0`) - a no-.git sandbox artifact, not the diff. Probe:
branch exit 0 `SWIPE depth=1 fullscreen true->true url /watch.html?v=v1->/watch.html?v=v1 ok`; FT_ROOT=base exit 1
`SWIPE depth=1 fullscreen true->false url /watch.html?v=v1->/ FAIL`; `SUMMARY combos=24 edge-painted=0` both.
Byte identity (real app, real ffprobe, same seed, base vs branch): p1 plain, y1 YouTube, y2 proxy YouTube, rgone
(missing file), r_opus: identical bytes; y3 (unsafe youtubeId + 'Youtube'), r_mp4/mkv/webm/mp3/m4a differ ONLY by a
trailing `,"sourceShareUrl":"https://www.reddit.com/r/videos/comments/abc123/a_clip/"` (sed-stripped: IDENTICAL).
RBAC: a member with folder 'Secret' restricted -> `404 {"error":"Media file not found"}` and no ffprobe spawned on the
item's file. yt-dlp primary source (gh api, master ffmpeg.py): :749 `add(('purl', 'comment'), 'webpage_url')`,
:761-763 compat `add('comment', 'description')` - the plan's citation is exact. Mutants: 42 run, 36 killed by name;
survivors below.

1. WARNING - acceptance 1 fails for Opus audio downloads. Opus is an offered one-off filetype (common.js:5012,
   args.js:102). Ogg keeps tags at the STREAM level; buildFfprobeArgs (server.js:2629) asks only `format_tags`, and
   parseEmbeddedSourceUrl reads only `format.tags`. Measured with the box ffmpeg 7.0.2 in yt-dlp's metadata argv shape
   (`-c copy -write_id3v1 1 -metadata purl=.. comment=.. description=.. synopsis=..`): ffprobe of the .opus gives
   `"format":{}` and `"streams":[{"tags":{..,"purl":"https://www.reddit.com/.."}}]`; through the real app r_opus
   answers with no sourceShareUrl while mp4/mkv/webm/mp3/m4a all carry it. Fix: read stream tags too (a
   share-specific probe with `format_tags:stream_tags`, purl/comment from format then streams), or amend acceptance
   1 to name the containers and disclose Opus.
2. WARNING - (extends QA 2 with a real process count) a timed-out ffprobe is orphaned, never killed, one per load.
   probeEmbeddedTags' execFile has no timeout/kill; withTimeout only stops waiting. Measured: an item whose file
   ffprobe blocks on (a FIFO) - 5 GETs each answered at 1506-1512ms, then `ps` showed 5 live `ffprobe .. hang.mp4`
   processes, and the test process could not exit until I killed them. Before this diff only the admin reheat batch
   (sequential) spawned this probe; now any member's page load (and the transcode poll, player.js:4978) does, with no
   in-flight dedupe. Fix with QA 2's in-flight promise plus a hard kill (execFile `timeout`, or an AbortSignal) on a
   longer cap; test: a hanging probe, N loads -> 1 spawn.
3. WARNING - three guard arms no test binds (LESSONS 2, "bind each arm of an OR match"); each mutant survived the
   diff's own tests: (a) common.js:9980 drop `|| doc.webkitFullscreenElement` -> swipe-back-owners 14/14 green (QA 4
   reasoned it; measured here); (b) source-share.js:35 `u.username || u.password` -> `u.username` -> 12/12 green, and
   `https://:secret@host.example/x` then passes (head: null); (c) delete the `^https?://` regex (:31) -> 12/12 green,
   and `https:www.reddit.com/x` then passes raw (head: null). Add the three inputs to the tables.
4. SUGGESTION - common.js:9978 and the plan's Item 2 say "The expanded audio view ... keep their swipe-back"
   unqualified, but the Fullscreen API arm also stands it down wherever audio expand rides real fullscreen:
   resolveFsButtonAction returns 'audio-expand-fullscreen' when !mobile (player.js:1512; a Surface / an iPad with a
   trackpad, player.js:1226), and toggleAudioExpandFullscreen calls enterFullscreen (player.js:6596). Reasoned from
   code, not run on a device. Scope the arm to video or say "the in-window (mobile) expanded audio view".
5. SUGGESTION - the resolver's `stat` is outside the time limit (source-share.js:72). The route never touched disk
   before; on a hung network mount the watch fetch would now never answer (initWatch awaits it). Suspicion: no hung
   mount can be built on this box. Put the stat inside withTimeout.
6. SUGGESTION - dead or equivalent guards: `if (!u.hostname)` (special schemes cannot parse with an empty host;
   mutant survives, equivalent) and `if (res.headersSent) return;` in the fulfil arm (nothing else responds; mutant
   survives). Also the `.then(ok, err)` shape leaves a throw inside res.json in the fulfil arm as an unhandled
   rejection (logged, socket hangs) where the sync path got Express's 500 - suspicion only, no JSON-derived item can
   make JSON.stringify throw. A terminal `.catch` covers both.
7. Concur with QA 1 (independently measured: `\u0085`, `\u009b`, U+202E, U+2066, U+200B, `https://evil.example\@good.example/`,
   `https:///x` and `https://@a.example/` all come back RAW) and QA 3 (watch.js "the button survives an SPA item
   change": my mutant moving the title/aria-label back inside the create branch survives, consistent with one
   setupShareButton call per view instance, watch.js:4283).

Held: every other watchUrl consumer (player chapter share, skin-surface.js:155 shareLinkUrl/watchUrl, podcasts,
card corners, search) never reads sourceShareUrl (whole-tree grep: only routes.js and watch.js name it); a
YouTube/proxy item never gets it; the time choice is YouTube-only (mutants WJ1/WJ2 red); the swipe stand-down is
re-read per touchstart (not latched: the control drag after removing the class goes back), and the probe's base FAIL
-> branch ok binds the fix end to end; cache size+mtime key, LRU, eviction, failed/timed-out-not-cached all bind
(mutants R1-R11 red).

Gate: APPROVED r2 @98801b94 - qa

Delta re-review of 4a039ff4..98801b94. Instruments run by QA at 98801b94 (Node 22.23.1): `npm run test:unit`
`# tests 7488` `# pass 7488` `# fail 0`; `npm run lint` `0 errors, 6 warnings` (the same 6 common.js names as base);
`lint:css` `TOTAL 0`; `lint:overlay` `clean (0 violations)`; check-markers `clean`; the two integration files
(FILETUBE_TEST_FFMPEG set) `# tests 15` `# pass 15` `# fail 0` `# skipped 0`; faux-fullscreen-probe exit 0: `SWIPE
depth=1 fullscreen true->true url /watch.html?v=v1->/watch.html?v=v1 ok`, `SWIPE-left|up|down fullscreen true url
/watch.html?v=v1 ok`, `SUMMARY combos=24 edge-painted=0`. No em dashes added.

r1 findings against 98801b94:
1. (WARNING, sanitizer) FIXED as prescribed. Re-measured: C1 U+0085 / U+009B, RLO, LRI, ZWSP, ZWJ, BOM, U+2028,
   NBSP, U+00AD, U+FFF9, a tag char, backslash-@ (both orders), backslash host, `https:///`, every userinfo form
   (`user:pass@`, `:secret@`, `@host`, `%40`, `%2F@`), `https:host`, javascript:, data: all return null.
   Legitimate URLs are not refused: ports, IPv4/IPv6, percent-encoded path and query, `@` in a path (TikTok) or
   query, a 2000-char query, fragments, x.com, bilibili pass unchanged; a unicode path is percent-encoded, an IDN
   host becomes punycode, `:443`, case and a bare host normalize (URL.href, the intended form).
2. (WARNING, probe) FIXED. My r1 measurement re-run (20 concurrent cold loads, a 2s probe, the default 1.5s wait):
   `spawns=1 stats=1`, all 20 answer null at 1507 ms; a 21st load during the probe joins it and gets the URL; after
   it lands `cacheSize=1 inFlight=0`, the next load hits the cache with `spawns=1`. A failed probe is still not
   cached; a hung stat answers at the wait with one stat call; sync throws from stat or probe resolve null with
   `inFlight=0` (no stuck entries). The server's own probe: execFile with an args array, the absolute DB path last,
   `timeout 15000` + SIGKILL, maxBuffer 4 MB. Measured `format_tags:stream_tags` + sourceUrlFromProbeJson on real
   files from the box's ffmpeg: MP4, M4A, MKV, WebM, MP3, Opus, Ogg Vorbis, FLAC all yield the URL.
3. (SUGGESTION, comments) FIXED for the three named. See new note A.
4. (SUGGESTION, webkitFullscreenElement) FIXED: bound with its own on/off case (fsEl already null).
5. (SUGGESTION, plan) FIXED: acceptance 4 added. Byte identity re-measured at r2 by QA (the plan's copy is the r1
   run): the same 9 shapes vs base cbe0d880, 8 sha-identical, the tagged Reddit item differs only by the trailing
   `sourceShareUrl`.
6. (SUGGESTION, ROADMAP) FIXED: the unlock ideas now sit under "First questions (ours, not his words)".

New in the fix round (non-blocking, SUGGESTIONS):
A. source-share.js header and server.js probeSourceShareUrl comment list M4A with the containers that keep `purl`
   at the file level. Measured: the M4A (an MP4 container) keeps only `comment`, like MP4. The URL still resolves
   (the comment arm), so only the stated mechanism is wrong; move M4A next to MP4.
B. routes.js final `.catch` says "the sync path's 500": same status, but the sync path's throw reaches Express's
   default handler (an HTML body), while this one answers JSON. Reword or leave; nothing reaches it in practice.
No blocking findings.

Gate: APPROVED r2 @98801b94 - adversary

Delta re-review of 4a039ff4..98801b94. Instruments (Node 22.23.1, /tmp git-archive sandboxes of 98801b94, a pristine
copy compared after every mutant): the diff's test files `# tests 123` `# pass 123` `# fail 0`; the plan's r2 counts
reproduced (`# tests 31` `# pass 31`; integration `# tests 15` `# pass 15` `# fail 0` `# skipped 0`); eslint on the
changed files exit 0 (the same 6 common.js warnings). Full `npm test` in the sandbox `# tests 9685` `# pass 9674`
`# fail 8` `# skipped 3`: the same 8 git-backed source locks as r1, which need a .git; in the real worktree at
98801b94 they are `# pass 69` `# fail 0`. Probe on 98801b94, exit 0: `SWIPE depth=1 fullscreen true->true url
/watch.html?v=v1->/watch.html?v=v1 ok`, `SWIPE-left|up|down fullscreen true url /watch.html?v=v1 ok`, `SUMMARY
combos=24 edge-painted=0`. Byte identity re-measured at r2 (my r1 scratch, real app, real ffprobe, vs the r1 base
dump): plain, YouTube, proxy YouTube and missing-file bodies are byte-identical; the 7 tagged non-YouTube items
differ only by the trailing `sourceShareUrl` (sed-stripped: IDENTICAL). RBAC: a restricted member gets
`404 {"error":"Media file not found"}` and no ffprobe runs on that file.

r1 findings against 98801b94 (all three WARNINGs closed):
1. WARNING (Opus): FIXED. The same measurement: files written with yt-dlp's full metadata argv (description
   included, so the Ogg stream's `comment` is the description and only `purl` holds the link). Through the real
   app `r_opus` now answers `sourceShareUrl=https://www.reddit.com/r/videos/comments/abc123/a_clip/`, as do
   mp4/mkv/webm/mp3/m4a.
2. WARNING (orphaned ffprobe): FIXED. The same FIFO measurement: 5 GETs answered in 1504-1517 ms, then exactly 1 live
   `ffprobe .. hang.mp4` (single-flight), and 0 16s later (SIGKILL at 15s). The test process exited by itself;
   r1 needed a manual kill.
3. WARNING (unbound arms): FIXED. The three r1 survivors are now killed by name: webkitFullscreenElement (the
   swipe-back-owners Fullscreen API test), the `@` authority rule and the scheme/authority check (the sanitizer
   refusal table).
4. S4 (Fullscreen API stands down the audio view on desktop-class devices): kept on purpose and documented; accepted.
   S5 (stat outside the limit): FIXED; mutant "stat not within" reds the hung-stat test. S6: the dead guards are gone.
   I drove the route chain with a patched resolver: a rejecting resolve gives 200 with the body, a synchronous
   throw gives 200 with the body, and an unserializable result (a BigInt) gives `500 {"error":"Internal server error"}`.
Mutants: 50 run on 98801b94. 47 were killed. The 2 survivors are N8 and N10 (see S3 below). My own R16 is withdrawn:
it was equivalent by construction.

New in the fix round. No blocking findings; these are SUGGESTIONS:
S1. The raw `\p{Cf}` refusal also refuses legitimate IRIs: `https://example.com/zwj/<family emoji with ZWJ>` and a
    Persian slug with ZWNJ (`https://fa.wikipedia.org/wiki/<text with U+200C>`) both return null, while their
    percent-encoded forms pass. Failing means no Share, which is safe, and it is rare (yt-dlp page URLs are ASCII in
    every canonical form I tried: reddit, facebook watch/reel, x, instagram, tiktok `@`, mastodon `@`, vimeo,
    soundcloud, twitch, bilibili, niconico, dailymotion, archive, streamable, bitchute, rumble all pass unchanged).
    Since URL.href already percent-encodes Cf/Cc in the path, query and fragment, the raw check could be limited to
    the authority. The other changes URL.href makes are equivalent normalizations: `:443` dropped, punycode host,
    lower-cased host, `'` in the query, `{}`, dot segments.
S2. A stale join for a file replaced mid-probe: the in-flight map is keyed by path only. In a harness, load 1 probes
    the old file; the file is then replaced; load 2 stats the NEW key but joins the old probe and returns the OLD
    URL; load 3 re-probes and returns the new one (2 probes). This heals itself after one load. Keying the in-flight
    probe by path+size+mtime would close it.
S3. The two length caps mask each other: mutants N8 (drop the href cap) and N10 (drop the raw cap) each survive. The
    input that binds the href cap is a raw URL of 2048 characters or fewer whose percent-encoding pushes it over 2048.
S4. The probe's direction lines are chained. I planted a second mechanism in a copy of the tree (player.js host
    listeners: a left swipe calls history.back, a down swipe calls setCssFullscreen(false)). The run printed
    `SWIPE-left fullscreen false url / FAIL`, and up and down then FAILed only as a CASCADE (they started off the
    page). With only the down mechanism planted: left ok, up ok, `SWIPE-down fullscreen false url /watch.html?v=v1
    FAIL`. So the instrument does reach the player's own touch handlers and catches a second mechanism, but after
    the first failure the later lines are not independent. Re-entering fullscreen before each direction would fix it.
S5. I concur with QA's note A (M4A keeps only `comment`, as in my r1 ffprobe: `"major_brand":"M4A",..,"comment":..`
    with no `purl`) and QA's note B.
Notes, not findings: the route has no time limit of its own. A stubbed never-settling resolve gives no answer in 3s,
but the real resolver is bounded (both waits; FIFO measured at about 1.5s), so this is a contract the unit tests
enforce, not a live path. The new probe's 4 MB maxBuffer fails on a 5 MB tag (measured: `ffprobe .. | wc -c` 5000587),
which yt-dlp never writes; the failure is not cached and is retried single-flight.

## Fix round r1 -> r2

Both seats CHANGES r1 @4a039ff4 (findings in the Gate section). What changed:

| Finding | Fix |
|---|---|
| qa 1 / adv 7 (WARNING): hidden characters and parser-confusing URLs passed unchanged | `sanitizeSourceShareUrl` rejects `\p{Cc}` (C0 + C1), `\p{Cf}` (bidi overrides / isolates, zero-width, BOM), any whitespace and a backslash; the authority must be non-empty with NO `@`; it returns `URL.href` (punycode host). Every input either seat named is in the refusal list. |
| qa 2 / adv 2 (WARNING): a probe past the wait was thrown away, and every timed-out ffprobe kept running (5 left alive per 5 loads) | One stat and one probe per file in flight (a second load joins it); a probe that outlives the wait still fills the cache; the server's probe is its OWN `probeSourceShareUrl`, hard-killed (SIGKILL) at 15s. |
| adv 1 (WARNING): Opus downloads never got Share (Ogg keeps tags per stream; the reheat probe read only file-level tags) | `probeSourceShareUrl` reads `format_tags:stream_tags`; `sourceUrlFromProbeJson` checks the file level, then each stream. The reheat's `probeEmbeddedTags` is untouched. A real Opus file through the real app is now a test. |
| adv 3 / qa S4 (WARNING): three unbound guards | Tests for `webkitFullscreenElement`, `https://:secret@host/x` (and every userinfo form), `https:www.reddit.com/x`. |
| adv S5: the stat sat outside the time limit | The stat is inside the wait too (and single-flight). |
| adv S6: dead guards, a throw inside the success branch could hang the request | `!u.hostname`, the credential check and the success-branch `headersSent` removed (the authority rule covers them); the route chains `.catch(() => null)` then a final `.catch` that answers 500. |
| adv S4: on a desktop-class device the Fullscreen API check also stands down the audio view in real fullscreen | Kept (a fullscreen is a fullscreen); the comment and this plan now say so. |
| qa S3: stale comments | source-share.js (a proxy-host YouTube download has a sourceExtractor too), watch.js (the button is named once per view; the share code shares either link). |
| qa S5: byte-identity unmeasured, no Item 2 acceptance | Acceptance 4 added; byte-identity is the seats' measurement (below). |
| qa S6: the ROADMAP entry mixed our unlock ideas into Dean's ask | Moved under "First questions (ours, not his words)". |
| Dean's question (any other swipe direction?) | The probe now swipes left, up and down too. |

### r2 measurements (copied from the runs)

- Byte identity (both seats, r1, base cbe0d880 vs 4a039ff4, the real app, raw GET /api/videos/:id
  bodies): identical for a plain file, a plain file carrying the tag, YouTube, proxy-host YouTube, a
  missing file and a 404; the tagged non-YouTube items differ ONLY by a trailing `sourceShareUrl`.
- `node --test test/unit/source-share.test.js test/unit/swipe-back-owners.test.js`: `# tests 31`,
  `# pass 31`, `# fail 0`.
- `FILETUBE_TEST_FFMPEG=... node --test test/integration/watch-source-share.test.js
  test/integration/watch-share-button.test.js`: `# tests 15`, `# pass 15`, `# fail 0`, `# skipped 0`
  (incl. the real Opus file).
- `node scripts/faux-fullscreen-probe.js` on the r2 tree, exit 0: `SWIPE depth=1 fullscreen
  true->true url /watch.html?v=v1->/watch.html?v=v1 ok`, `SWIPE-left fullscreen true url
  /watch.html?v=v1 ok`, `SWIPE-up ... ok`, `SWIPE-down ... ok`, `SUMMARY combos=24 edge-painted=0`.
  Base cbe0d880: `SWIPE depth=1 fullscreen true->false url /watch.html?v=v1->/ FAIL` (its later
  direction lines start already out of fullscreen).

## Carried to the next touch (gate r2, disclosed as tech-debt #285; none blocking)

- qa A / adv S5: the source-share.js header and the probeSourceShareUrl comment group M4A with the
  containers that keep `purl`; an M4A keeps only `comment` (measured by both seats). The URL is still
  found through `comment`: a comment fix.
- qa B: the route's final `.catch` calls itself "the sync path's 500"; the sync path's 500 is
  Express's HTML default, this one answers JSON.
- adv S1: the `\p{Cf}` check refuses a RAW zero-width joiner / non-joiner (a family emoji, a Persian
  slug) anywhere in the URL; the percent-encoded forms pass; 19 real sites' standard URLs pass. Only
  effect: no Share for such a link. Could be limited to the host.
- adv S2: in-flight probes are keyed by path only: a file replaced mid-probe can share the OLD link
  once (the next load corrects it). Key by path + size + mtime.
- adv S3: the raw and the parsed length caps mask each other (either can go, tests stay green).
- adv S4: the probe's SWIPE-left/up/down lines depend on the one before (after a failure the later
  lines start outside fullscreen); re-enter fullscreen before each direction.
