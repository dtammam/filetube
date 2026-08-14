# Wave 2: reliability hazards + desktop-player features (v1.124.0)

Status: IN PROGRESS (2026-08-14). Grounded at `a4f1f24` (v1.123.0 shipped).
Branch `feat/v1.124-reliability-player`. R1 done (`88ec97a`), R2 done (`e658b69`).

Scope = the two reliability findings from the external review's item 4 (R1, R2)
PLUS two desktop-player features Dean asked for with this wave (F1, F2). Both
reliability claims were RE-VERIFIED against the current tree and BOTH are
narrower than the review stated - corrections recorded below. The player
features were mapped against the live DOM/CSS/JS before planning; anchors below.

## Verified findings (and corrections to the review)

- **R1 - podcast enclosure download has no backpressure.**
  `lib/podcasts/fetchGuard.js` `downloadEnclosure` handles `res.on('data')` by
  calling `out.write(c)` unconditionally (around `:246`) and NEVER checks the
  write stream's return value or waits for `'drain'`. A fast feed origin over a
  slow disk (NAS/SMB - Dean's actual storage) lets Node buffer unbounded in
  memory up to the `ENCLOSURE_MAX_BYTES` cap (`2 * 1024^3` = 2 GB, `:45`). This
  is a memory-pressure hazard, not a correctness bug - the file still lands
  correctly - but on a Pi/small box a few concurrent large enclosures can OOM.
  CORRECTION to the review: the fix is a standard write/drain pause-resume on
  ONE data handler, not a re-architecture. The existing idle/deadline ticker,
  size cap, fsync-then-rename, and .ptpart cleanup all stay exactly as they are.

- **R2 - book prune lacks the errored-subtree guard that music already has.**
  `lib/books/store.js selectPrunableBookIds` (`:88`) guards against WHOLE-ROOT
  mount loss (`missingRoots`) but has NO per-subtree errored-dir guard. The
  music scan solved this exact class: `walkMusicRoot` collects `erroredDirs`
  (`lib/music/scan.js:45,55`) and `selectPrunableTrackIds` refuses to prune any
  track whose `filePath` sits under an errored dir (`lib/music/store.js:72,88`).
  `walkBookRoot` (`lib/books/scan.js:44`) already `console.warn`s on an
  unreadable dir and `continue`s - but DISCARDS which dir failed, so a transient
  EACCES on a book subtree (root still has survivors elsewhere) prunes those
  books AND their per-user reading positions (`server.js:6752
  userStore.removeBookState`). This is a DATA-LOSS class (per-user progress is
  destroyed on a transient permission blip), so this wave takes the FULL gate.
  CORRECTION to the review: this is not "add pruning safety" in the abstract -
  it is "port the music `erroredDirs` guard to books", a mechanical parallel
  with a proven reference implementation and an existing test shape to copy.

## Tasks (each its own commit, each green before the next)

- **T1 - enclosure backpressure.** In `downloadEnclosure`, honor `out.write`'s
  backpressure: on a `false` return, `res.pause()`; resume on the write stream's
  `'drain'`. Preserve every existing guard (size cap checked BEFORE the write,
  idle/deadline ticker, error/end paths). Test with a fake `res`/`out` whose
  `write` returns `false` and asserts `res.pause()` was called and that
  `'drain'` resumes it - deterministic, no real timers.
- **T2 - port the errored-subtree guard to books.** Thread an `erroredDirs`
  out-param through `walkBookRoot` (mirror `walkMusicRoot` byte-for-byte in
  shape), and teach `selectPrunableBookIds` to skip any item under an errored
  dir (copy `selectPrunableTrackIds`'s `fp.startsWith(\`${d}/\`)` predicate, both
  path separators). Wire `erroredDirs` through the book scan caller
  (`server.js` ~`:6700`) exactly as the music caller does (~`:7701`).
  Test: an item under an errored subtree survives a prune even when its file is
  absent from the walk; mutation-verify by deleting the guard and watching a
  per-user reading position get destroyed.

## Desktop-player features (Dean, added to this wave 2026-08-14)

Mapped against the live tree: DOM in `public/watch.html`, behavior in
`public/js/player.js`, layout in `public/css/style.css` (NOT public/style.css).

- **F1 - video captions render BEHIND the media-controls bar.** Mechanism (mapped):
  video captions use the browser's NATIVE `<track>` rendering painted inside
  `<video id="media-player">`; the controls bar `.player-controls` is
  `position:absolute; bottom:0; z-index:8; height:40px`. The UA lifts native cues
  above NATIVE controls but knows nothing of FileTube's CUSTOM bar, so cues in the
  video's bottom band are occluded (worst in fullscreen, where the 40px bar-reserve
  padding is dropped). The tree ALREADY has the correctly-layered model: the custom
  `.cc-overlay > .cc-overlay-text` (`z-index:9`, above the bar, with per-view bottom
  offsets) at `style.css:6740`, built in player.js `ensureHost()` (`~:2048`) and fed
  by `renderActiveCueOverlay`/`buildCaptionOverlayText` - but it is AUDIO-ONLY (the
  `cuechange` handler is gated `type==='audio'` at `player.js:~5591/6078`; the CC
  click sets video `track.mode='showing'` at `~5549`).
  FIX (reuse, don't rebuild - the battle-won-overlay rule): route VIDEO captions
  through the SAME custom overlay - set the video track `mode='hidden'` (fires
  cuechange, suppresses native paint) and let the overlay render them, so they sit
  in the z-index-9 layer above the bar with the existing offsets. Add a fullscreen
  bottom-offset rule so the overlay clears the fullscreen bar height. Unifies
  audio+video caption rendering; the pure `buildCaptionOverlayText` stays
  node-tested.
- **F2 - auto-hide the controls bar on DESKTOP in the immersive views (iOS/YouTube
  style).** The machinery EXISTS (`armControlsAutoHide`/`clearControlsAutoHide`/
  `showControlsBar`/`revealControlsAndReArm`, the `controls-autohidden` host class,
  `player.js:~1765-1829`) but is gated to immersive (`inImmersiveMode()`) AND
  touch-only (`!isMobileFormFactor()` bail) - so it never runs on desktop.
  IMPORTANT SCOPING (decided during implementation, contra an earlier draft of
  this line): auto-hide applies ONLY to the IMMERSIVE views (video faux-fullscreen
  + the audio-expanded overlay), where the bar OVERLAYS the picture. The desktop
  INLINE bar is a reserved 40px strip BELOW the video, so fading it there would
  leave an empty band - inline must STAY always-visible. So the fix keeps the
  `!inImmersiveMode()` early return (inline untouched, no new non-immersive CSS)
  and only lifts the `!isMobileFormFactor()` bail so DESKTOP immersive auto-hides.
  FIX: remove the mobile-only bail (keep the paused/ended/scrubbing guards + the
  re-check on fire); add a host `mousemove` reveal-and-re-arm guarded by
  `inImmersiveMode()` (desktop has no touch, so the existing touchstart/pointerdown
  reveal is not enough); add `cursor:none` on `.css-fullscreen.controls-autohidden`
  (YouTube convention). The existing `controls-autohidden` immersive CSS rule
  already covers desktop (same selectors). MOBILE behavior is byte-identical (the
  removed bail only affected desktop). Hide delay ~3000ms (existing constant).
  Captions (F1) are a separate z-index-9 layer, so hiding the bar never hides them.

## Machine-derived predictions (re-verified at every commit)

- The music reference the books fix mirrors is three sites:
  `grep -n "erroredDirs" lib/music/scan.js lib/music/store.js server.js`
  (expect walk push, store predicate, scan caller wiring). Books must end with
  the SAME three-site shape. If music's shape has changed by implementation
  time, re-read it first - this plan assumes the `aa06fa2` version.
- No other media walk is affected: `grep -rn "readdirSync" lib/*/scan.js`
  confirms only books + music use the shared walk shape; the main media scan
  (`server.js`) already has `unreadablePaths` in `selectPrunableIds` (`:1552`).

## Gate

FULL gate (R2 destroys per-user data on a transient FS blip - the never-slim
trigger; R1 is a memory-safety fix). Adversarial seat briefed to: simulate a
mid-scan EACCES on a book subtree and prove reading positions survive; drive a
slow-consumer enclosure and prove memory stays bounded and the file still
finalizes byte-correct; for F1/F2, confirm the player changes are DESKTOP-scoped
and mobile/immersive behavior is byte-identical (the battle-won iOS path must not
regress), captions are not hidden with the bar, and the auto-hide never hides
controls while paused/scrubbing.

## Stop condition

Both seats APPROVE; dual-Node suites green and reported verbatim; the book prune
guard and the backpressure guard fail their own mutants; F1/F2 have unit coverage
where node-testable (the pure caption-text join; the mobile-vs-desktop gate
decision) and the mobile path is proven untouched. Then release ceremony (v1.124.0),
device-probe list to Dean (he verifies F1/F2 on his devices), plan to `completed/`.
