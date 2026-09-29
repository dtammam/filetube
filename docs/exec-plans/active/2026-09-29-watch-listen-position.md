---
plan: watch-listen-position
harness: v2 · lean
branch: fix/watch-listen-position
anchor: outcome
status: Gate:APPROVED r1 @148fcd03
next: adversary delta re-confirm of the r1 follow-ups commit, then push, PR, merge on green CI, tag v1.344.2 by API
gate: APPROVED r1 @148fcd03 (adversary, qa, security-brief); r1 follow-ups await the adversary delta
---

# Watch -> Listen keeps its place on a chaptered video

Dean, 2026-09-29: "if I transition from watch to listen for a given piece of content, it like loses its
place and starts from the beginning... I would like to maintain the fidelity of the time, the position."

## Acceptance (outcome)

1. **Watch -> Listen on a chaptered video continues where Watch was.** The Listen player starts in the
   chapter that holds the playhead, at the playhead (within 1 s of the moment of the tap, allowing for
   the time the page switch takes), not at chapter 1. Measured in the real app (headless Chromium, the
   repro below), before and after.
2. **Nothing that already keeps its place changes:** Watch -> Listen on a video without chapters, and
   Listen -> Watch for both kinds, still continue (same repro).
3. **No live position, no change:** when the player is not holding that video (or cannot report a
   seekable time, a desktop live transcode), Listen starts as today (chapter 1). Unit tests execute the
   real `init()` and bind the chapter pick, the load-time read and the fallback.

## Research (measured 2026-09-29, before any code)

Repro: the visual seed (`test/visual/seed.js`) plus two REAL playable 300 s H.264/AAC MP4s planted at
two fixture videos' paths, one given 5 chapters (0/60/120/180/240), served by `server.js` (writable),
driven by Playwright Chromium: play the watch page, seek to 130 s, tap `#listen-media-btn`, read
`#media-player.currentTime` 4 s later; then on Listen seek to 200 s and take the Watch way back
(`watchBackTap`'s navigate), read again 4 s later.

| video | Watch | -> Listen | Listen seeked | -> Watch |
|---|---|---|---|---|
| no chapters | 132.43 | 136.50 (kept) | 202.43 | 206.46 (kept) |
| 5 chapters | 132.42 | **3.84 (restarted)** | 202.42 | 206.31 (kept) |
| 5 chapters, AFTER the fix (148fcd03) | 132.42 | **136.34 (kept)** | 202.43 | 206.30 (kept) |
| no chapters, AFTER the fix | 132.43 | 136.49 (kept) | 202.43 | 206.44 (kept) |

**Cause:** `playListenItem` (`public/js/music.js`) expands a chaptered video into `<id>::c<n>` rows and
always calls `playAt(0)`. The player holds `<id>`, so `<id>::c0` is not a same-id adopt
(`isAdoptLoad`, `public/js/player.js`): it is a fresh load, and `handleResumePlayback` seeks to chapter
0's `chapterStartSec`. A video without chapters plays as the single row `<id>`, which IS an adopt, so it
keeps the element untouched. Listen -> Watch strips `::c` and the watch load resumes from the media
progress store, which a chapter play writes under the base id.

## Approach

- `playListenItem`: for a chaptered video whose base id the player holds with a live position, start
  the queue at the chapter holding that position (`listenHandoffChapterIndex`, pure: the last chapter
  begun by `t`, else 0) and pass `{ handoffFrom: <base id> }` to `playAt`.
- `loadTrack`: a chapter row loaded with `handoffFrom` re-reads the live position AT LOAD TIME
  (`liveListenPosition`) and uses it as `chapterResumeSec` (the existing chapter-resume seek), falling
  back to `chapterResumeSecFor(item)` when there is none. Read at load, not at the tap, because a
  chapter pick can wait up to `CHAPTER_VERIFY.timeoutMs` for the file check while the old audio plays
  on; a tap-time read would rewind by that wait. Bypassing `chapterResumeSecFor` is deliberate: its
  5-second tail rule (restart a chapter heard to its end) is for a saved place, not a live handoff.
- The handoff is still a reload of the same file (a short gap while it rebuffers). A seamless adopt
  across `<id>` and `<id>::c<n>` would change the player's id semantics (progress ids, the chapter
  watcher, the queue pointer): out of scope; logged if Dean wants it.

## Out of scope (noted, not built)

- Arriving at `/music?play=<id>&listen=1` with no live player (a reload, a bookmark): a chaptered video
  still starts at chapter 1 and a plain one follows music's smart-resume (mid-track only over 10 min).
  Dean's report is the live transition.

## Gate

Gate: APPROVED r1 @148fcd03 - security-brief (no CRITICAL/WARNING; SUGGESTION: the mp3-seek-lab server.js binds :8801/:8802 on all interfaces, bind 127.0.0.1)
Gate: APPROVED r1 @148fcd03 - qa (no CRITICAL/WARNING; eslint 0 errors/6 pre-existing warnings, lint:ui OK, overlay clean, npm test 10352 pass/0 fail/12 skip on Node 22.23.1 AND 24.20.0; check-markers 7 issues, all pre-existing in 2026-09-29-next-waves.md)
- SUGGESTION: music.js loadTrack's `chapterResumeSec` trailing comment ("v1.311.3: near its end -> the chapter head") and the data-block comment ("the saved absolute file position") no longer cover the handoff, which is a live second that bypasses the tail rule.
- SUGGESTION: this plan's frontmatter still reads status Building / next "implement the handoff" / gate pending, and the AC1-AC2 "after" numbers live only in the commit message and ROADMAP; add the after row to the Research table at closeout.
- SUGGESTION: no test covers a handoff that goes through the verify waiter (returnEpoch > 0: the pick waits, and playWaiter re-plays with Object.assign(w.opts, skipVerify)); if that stopped carrying opts, the handoff would silently land on the chapter head after the app had been backgrounded.
- SUGGESTION: tapping Listen on a watch video left at its end now loads the last chapter at the file end (it ends at once and stations on) instead of chapter 1; this matches the plain-video adopt, so it is a ruling for Dean, not a bug.
Gate: APPROVED r1 @148fcd03 - adversary (no CRITICAL/WARNING. Real app, headless Chromium, base c3d76282 vs head: chaptered Watch 132.44 -> Listen 3.81 on base / 136.38 on head; plain 132.44 -> 136.6 both; Listen -> Watch kept on both. Head also kept: Watch paused at 132.4, 177.5 (lands 180.4 in c3), 180.0 boundary (c3), 250 past the last start (c4), Listen tapped 0 s after the seek (130.0 -> 130.4), phone viewport 390x844 (132.5 -> 132.8, 63.5 -> 63.8 in c1), dock-return then Next (c2 -> c3 at 180). No progress POST at a chapter head: the saves ran 132.61 (watch) -> 136.45 -> 140.45 (listen). The verify-wait path is reachable (a visibilitychange during the /api/videos fetch plus a 3.5 s check): head lands at 181.19 seamlessly; the tap-time-read mutant, run in the real app, lands at 177.57 (a 3.5 s rewind), so the load-time read binds. Mutants vs listen-handoff-position.test.js: 10 of 11 killed (the three claimed plus zero-is-live, no id check, s<t boundary, tail rule re-applied, first-match, base-or-chapter id, no opts); activeListenId=queue[0] survives but is equivalent (every reader strips ::c). Node 22 unit: 8002 tests, 7993 pass, 8 fail, 1 skip; all 8 were sandbox artifacts (not a git repo / a symlinked node_modules), and those 69 tests pass once the sandbox is a git repo. Node 24: the new test, dock-return and release-ledger/date tests, 70/70. Lab spot check (build-album.sh, mp3-seek-probe.js, server.js + run.js chromium): mp3 fresh-seek error -1.68..+1.49 s, m4a -0.03..-0.02 s, matching the doc)
- SUGGESTION: Watch PAUSED -> Listen on a chaptered video starts playing (132.44 paused -> 136.21 playing) while a plain one stays paused (132.45P throughout). Base did the same for chaptered (it played from chapter 1), so this is not a regression; it is a ruling for Dean.
- SUGGESTION: the unit test's fixture ([130, 131.5]: "the audio played on through the fetches") does not match the default real flow. There, both reads happen in the same synchronous turn after the fetch, and the tap-time mutant is equivalent (132.43 -> 132.86 on the mutant). The load-time read only matters on the verify-wait path I measured above. Reword the comment; a waiter-path unit (returnEpoch > 0) would bind it directly (qa's suggestion 3 holds).
- SUGGESTION (refutes qa's suggestion 4 by measurement): a Watch video left to its end is rewound to 0 by the player before Listen (POST 300.00 paused, then 0.00; element t=0), so Listen loads c0 at the head on head and base alike, not the last chapter at the file end.

### r1 follow-ups (the seats' SUGGESTIONs, applied after the r1 approvals)

- Comments: loadTrack's `chapterResumeSec` comments now name the handoff (qa 1).
- Tests: the main wiring test no longer claims a later load-time reading on the normal path (both reads
  happen together there; adversary 2). A new test drives the WAITING path through the real `init()`: a
  return to the app during the listen fetch arms the file check, the pick parks, the playhead moves on,
  and the load must seek to the later second (qa 3). Mutants: a tap-time read and a waiter that drops
  `handoffFrom` each fail it.
- `docs/references/mp3-seek-lab/server.js` binds 127.0.0.1 (security-brief).
- The research table carries the after rows (qa 2).
- For Dean, not changed: Watch PAUSED -> Listen on a chaptered video starts playing (it did before too,
  from chapter 1); a plain video stays paused (adversary 1). qa 4 was refuted by measurement (a finished
  video is rewound to 0 before Listen).
