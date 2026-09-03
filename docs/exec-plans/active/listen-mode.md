# Listen-mode (videos play-as-audio) + the sticker-menu ergonomics fix (v1.252 wave)

Status: ACTIVE. Dean 2026-09-03: "start immediately... I think you have the brief."
Intake LOCKED 2026-09-02 (recorded in completed/player-extras-and-unify.md): (1) the itch is
PRESENTATION (the skin experience while listening; bg-audio machinery reused untouched);
(2) a "Listen" button on the watch page's action row; (3) PER-PLAY, no remembered flag, NO
new db.metadata field; (4) NO Music-library membership - the video stays a video everywhere;
(5) the toggle pair: watch "Listen" <-> a "Watch" way back on the sticker menu's page 1,
landing at the exact position, ONE progress store both directions; (6) single track, no
prev/next in v1; (7) built on the unified engine (done: v1.250-251).

FOLDED IN (Dean 2026-09-03, same surface): the STICKER-MENU FRICTION fix - "the buttons are
too small... too hard to tap the extra button and then pick another thing." He offered two
shapes and is "open minded": port the watch action-row chassis, or enlarge in place.
ENGINEERING CALL (disclosed, his device feel-pass arbitrates): ENLARGE IN PLACE - >=44px row
heights (the Apple HIG floor), larger fonts, fatter padding/gaps, a wider menu, full-width
hit areas on Extras/Back - keeping the sticker-menu identity; the fallback if the feel-pass
disagrees is the action-row chassis port.

player.js stays BYTE-UNCHANGED (0-line diff verified every commit).

## Mechanism recon (2026-09-03, at v1.251.0)

THE TRICK: #media-player is a <video>; a projected library track already streams the media
byte route with media-store progress. So a LISTEN track is the SAME shape music already
plays - `{ id, title, artist: channelName, durationSec, source: 'library', streamSrc:
'/video/<id>', artUrl: '/thumbnail/<id>', progressEndpoint: '/api/progress' }` - plus a
CLIENT-ONLY `listen: true` flag. loadTrack's isLib arm (music.js:1699+) then honors the
routes verbatim; the skin gates on the load data's type:'audio'/resumeMode:'music' exactly
as for projected tracks; the wheel/scrub/sticker/Extras all just work (the track IS
library-backed, so v1.249 Extras eligibility holds by construction).

The `listen` flag drives EXACTLY TWO deltas:
1. loadTrack SKIPS the POST /api/music/resume (music.js ~1869) - the Continue-listening
   pointer is Music membership, and the intake says none. Media-store progress (the
   periodic save + seek pipeline) still writes - that is the ONE shared store, and it is
   what makes the position carry watch->listen->watch. The video-side Continue-watching
   reflecting a listened video is CORRECT (one truth); Music's surfaces never see it (the
   projection filters type audio - no new suppression needed).
2. The sticker menu's page 1 gains a "Watch" entry (engine hook `sticker.watchBack`,
   supplied by music.js only when the playing queue item carries `listen`) navigating to
   /watch.html?v=<id> - the resume ladder reads the same media progress, so it lands at the
   live position.

ENTRY: the watch page's action row gains a "Listen" button (the setupShareButton chassis)
-> navigate('/music?play=<id>&listen=1'). music.js's ?play= dispatch branches on listen=1
into playListenItem(id): the same early-cover, fetch /api/videos/:id, build the single
listen track, `queue = [t]; playAt(0)` (registerTrackNav at i=0 of a 1-track queue
registers NEITHER prev NOR next - the single-track intake for free). A miss (deleted id)
location-replaces back to /watch.html?v=<id> (the id came FROM a watch page - belt only).
The ao=1 bounce path is untouched; listen=1 never consults the music API at all.
Chapters: v1 ignores ::c routing for listen (base id, whole file) - the chapter experience
stays a MUSIC feature; disclosed.

## Task commits
- L1 ERGONOMICS: the sticker-menu size pass (style.css only; census 0; the
  action-row-probe norm does not apply - no .btn row is touched - but before/after
  measurements of the menu row heights go in the commit).
- L2 LISTEN CORE: the watch "Listen" button + music.js playListenItem + the loadTrack
  listen deltas. Tests: the button navigates with listen=1; the listen arm builds the right
  track shape and plays it (real /api/videos payload - the anti-INERT lesson); the
  music-resume POST is SKIPPED for listen and STILL FIRES for normal tracks (both axes);
  single-track = no prev/next registered; the miss bounce.
- L3 WATCH-BACK: the engine `sticker.watchBack` hook + music.js supplying it for listen
  tracks only. Tests: the entry renders on page 1 for a listen track, absent for a normal
  track AND for podcasts (no hook); the tap navigates to /watch.html?v=<id>; Extras still
  works on the listen track.
- L4: FULL gate (SERIALIZED seats; settled fixtures; runner-hygiene finallys), dual-Node,
  release v1.252.0. Then Dean's AUTOPLAY intake conversation (his queued idea: a single
  song ends and playback stops - "some kind of music autoplay element"; own wave).

## Gate round 1 dispositions (QA, 2026-09-03)
- W1 FIXED: the dock-return re-init rebuilt `queue` from the audio-only projection and lost
  the Watch row - a MODULE-SCOPED activeListenId (set by playListenItem, cleared by any
  non-listen loadTrack, consulted when the queue lookup misses) survives the re-init; the
  full round trip is behaviorally bound.
- W2 DISPOSITIONED + DISCLOSED (explicit call, not silence): watch->listen position carry
  rides the player's music smart-resume, which only resumes MID-TRACK when duration > 600s
  (player.js:455 - a BYTE-FROZEN file). Consequence: a <= 10-minute video restarts at 0:00
  when you tap Listen; listen->watch carries at ANY duration (the watch ladder has no
  threshold). The freeze stays (lifting it is a Dean-level decision); the listen use-case
  is long videos; DISCLOSED in ROADMAP, the release ledger, and Dean's probe list. A future
  player.js wave can thread a per-call threshold through shouldResumeMidTrack if it stings.
- W3 FIXED: mountEarlyCover is genuinely shared by BOTH ?play= arms now (the comment had
  claimed a factoring that did not exist - corrected by making it true).
- S4 FIXED (watchBack shares extras' in-main-document guard), S5 FIXED (the listen arm
  browses the ALBUMS grid behind the skin - a grid tab, so `queue` stays the single listen
  track - and a refresh/deep-link dock lands on real content), S7 comment sharpened.
- S6 ACCEPTED RESIDUAL: the watch-side Listen entry is source-locked, not behavior-booted
  (the call sits unconditionally in the media-load sequence beside setupShareButton; a
  behavioral watch-boot harness is disproportionate for it) - the adversarial seat may
  re-litigate.

## Gate round 2 dispositions (adversarial, 2026-09-03)
- W1 BOUND: the engine-level pop-out test now carries a visible()-true watchBack hook, so
  the in-main-document gate is the ONLY rejector - its removal mutant reds (was surviving
  vacuously via a normal-track fixture).
- W2 BOUND on BOTH lifecycle axes: the round-trip test gained phase 3 (a normal play ends
  the session - no stale Watch row) and phase 4 (the adversarial's constructed harm: the
  old listen id playing via a NON-listen path with a queue miss - the cleared marker cannot
  resurrect the row; phase 3 alone could not kill the never-cleared mutant because its
  track HITS the rebuilt queue and short-circuits).
- W2-disclosure addendum for the probe list: an UNSIZED video (scan never captured a
  duration -> the listen track carries 0) also restarts at 0:00 regardless of real length -
  the same disclosed smart-resume consequence.
- Suggestions: the playListenItem marker-set is a redundant belt over loadTrack's (noted,
  kept); deriveNowPlayingLabel's id-equality guard annotated (listen-mode is the first
  music/video id collision - the album:'' gate is what saves it today).
- Re-litigated and STANDING: the W2 short-video disposition, the S6 source-locked entry
  (the repo's own watch-wiring posture - Share's is source-locked too).

## Predictions (re-verified each commit)
- `git diff main -- public/js/player.js | wc -l` == 0 at every commit.
- No new stored per-item field; no server changes at all in this wave (the listen track is
  assembled client-side from the EXISTING /api/videos/:id payload).
- The 207+-test skin/panel regression net stays green unchanged through L1-L3.
