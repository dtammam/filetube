---
plan: watch-listen-position
harness: v2 · lean
branch: fix/watch-listen-position
anchor: outcome
status: Building
next: implement the handoff in music.js playListenItem/loadTrack, bind it with unit tests, re-run the headless repro
gate: pending
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
