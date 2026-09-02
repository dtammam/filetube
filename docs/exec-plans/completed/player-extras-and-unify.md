# Player Extras (watch-page action fidelity on the music skin) + engine Unify

Status: SHIPPED (all three asks) - F-CRITTERS v1.248.0, F-EXTRAS v1.249.0 (Dean device-passed:
"It's PERFECT"), F-UNIFY v1.250.0 (2026-09-02, full gate SERIALIZED seats, both APPROVE,
dual-Node 8174/8174, DEVICE-PENDING). This plan moves to completed/ once v1.250 gets Dean's
device pass; the QUEUE section below carries the follow-on waves (LISTEN-MODE next, its
intake locked). v1.249 notes kept for the record: queue uses the MEDIA kind (a projected id
is not in ns.tracks - kind 'track' would 404); Extras is in-tab + library-backed tracks only;
the record correction for commit 804b238f's message - Move closes the player AFTER
requestMoveItem succeeds (watch.js parity), not before; gate residuals in tech-debt #191/#192.
player.js stayed BYTE-UNCHANGED through all three waves.

## THE QUEUE AFTER F-UNIFY (Dean, rolling adds 2026-09-02)
1. LISTEN-MODE (locked intake below).
2. PLAYER-MENU COMPLETION (proposed bundle, both are sticker-menu work on the unified engine):
   (a) CHAPTER RENAME from the music player view - the video watch view has the chapters
   editor (common.js showChaptersEditor); the player view needs a way into it for the playing
   file's base id. (b) EXTRAS IN THE DESKTOP POP-OUT - Dean expects the Extras menu there
   (2026-09-02). v1.249 deliberately excluded it because every shared dialog (move/confirm/
   hard-delete/choice/transcript/toast) renders in the MAIN document, i.e. BEHIND the
   always-on-top pop-out. The real fix is doc-aware shared dialogs (showMoveModal/
   showHardDeleteModal already take a `doc` param; showConfirmModal/showChoiceModal/
   openTranscriptFor/showToast need one), then lift the engine's inMainDoc gate.
3. PINNED-CHANNEL AUDIO ROUTING BUG (Dean: bottom of the list, low): on desktop, opening an
   audio item from a PINNED CHANNEL in the left sidebar does not open as Music, while the
   main feed path does - almost certainly a card-click call site that bypasses the v1.246
   open-audio-in-music routing. Likely tiny; could ride the Listen-mode wave (same routing
   surface) if convenient, else stays at the bottom per Dean.
4. CROSS-DEVICE NOW-PLAYING SYNC (the big one - needs its own intake).

## QUEUED AFTER F-UNIFY: LISTEN-MODE (intake LOCKED 2026-09-02, Dean inline)
"Play as audio" for videos. Locked: (1) the itch is mostly PRESENTATION (the skin experience
while listening) - the bg-audio machinery is reused untouched; (2) a "Listen" button on the
watch page's action row; (3) PER-PLAY, no remembered flag, NO new db.metadata field ever;
(4) NO Music-library membership - pure presentation mode, the video stays a video everywhere;
(5) the toggle pair: watch page "Listen" <-> a "Watch" way back (sticker page 1 entry) landing
on the watch page at the exact position, ONE progress store both directions; (6) single track,
no prev/next in v1; (7) ordering: AFTER F-UNIFY, built on the unified engine.

## Dean's three asks + the locked answers
1. **F-EXTRAS (main):** the music/skin player is missing the video watch-page actions Dean relies
   on (Share the original YouTube link, Download, Like, Delete, Move, Reheat, Transcript/CC...).
   Bring FULL watch-page fidelity to music/YouTube-audio items. Podcasts keep their own actions.
   Surface (LOCKED): fold into the EXISTING sticker menu (no second button) as a TWO-PAGE menu -
   the compact quick controls (speed/loop/skin) with an "Extras >" entry sliding to a second page
   holding the full action set.
2. **F-UNIFY:** merge the music player onto the ONE shared skin engine (skin-surface.js), retiring
   music.js's duplicate engine. Trigger MET: Dean device-validated the shared engine via podcasts.
3. **F-CRITTERS (small, split):** on the music page critters land in weird spots / don't persist /
   overlay. Fix or pull them from that page.

## WAVE SPLIT (engineering call, disclosed)
Dean asked for F-EXTRAS + F-UNIFY "in one big wave." Splitting them, because the recon confirms
F-UNIFY is a large, HIGH-REGRESSION-RISK refactor (chapters/audiobooks, the desktop pop-out, the
straight-to-player cover are tightly coupled to music.js's private queue/nowPlaying state), whereas
F-EXTRAS is the user-facing value and is mostly REUSE of already-shared helpers. Bundling the risky
internal refactor with the value delivery would risk the beloved music player for a release whose
visible payload is the Extras. So:
- **v1.248 (SHIPPED) = F-CRITTERS** - shipped STANDALONE (Dean called it "split"; complete + gated,
  don't hold it behind the big Extras build).
- **NEXT WAVE = F-EXTRAS** (the sticker-menu two-page Extras; FULL gate - it touches delete/move).
- **AFTER = F-UNIFY** (its own dedicated, carefully-gated engine merge; recon captured below).

## Recon anchors (2026-09-02)

### F-EXTRAS - the watch.js action set (all id-parametric; a music track id drops in)
Shared logic already in common.js (REUSE directly): `shareExternalUrl` (12809), `withShareStartTime`
(12797), `showMoveModal` (12300) + `requestMoveItem` (12528), `showConfirmModal` (11682),
`showChoiceModal` (11772), `showHardDeleteModal` (12153), `openTranscriptFor` (11884), `addToQueue`
(4180), `deleteResultToast` (12721), `showToast` (12855). watch.js-local wiring to MIRROR (button +
one fetch each): Share->`shareExternalUrl(mediaData.watchUrl)`; Download-><a `/video/:id?download=1`>;
Like->`POST|DELETE /api/liked/:id`; Watched->`POST|DELETE /api/watched/:id`; Delete->`DELETE
/api/videos/:id` (yt-dlp item = trash confirm, local = hard-delete checkbox modal); Move->
`showMoveModal`->`/api/videos/:id/move`; Reheat->`POST /api/ytdlp/repull-metadata/item/:id` (202 +
poll `/api/subscriptions/status`); Transcript->`openTranscriptFor(id)` (needs `hasSubtitles`).
DEPENDENCY: Share needs the track to carry `watchUrl` (server buildWatchUrl from youtubeId),
Transcript needs `hasSubtitles`, Like needs `liked` - `/api/videos/:id` emits all of these, so the
Extras page FETCHES `/api/videos/:id` for the playing track id on open and gates each action on its
field (Share only if watchUrl; Transcript only if hasSubtitles; Move/Delete on canModifyLibrary RBAC).
Star rating is a read-only deterministic mock (getStarRating) - not an action.

### F-CRITTERS - root cause + fix
No position store exists (never did). `scheduleCritterScatter` (common.js:8998, exported :10748) is
called ONLY on router `#view-root` swaps (+ watch.js:2066 after its own furniture change); music.js
NEVER calls it. So on music's IN-VIEW swaps (songs/albums/artists tabs, album/artist drills, search -
all swap `#music-content` with no router nav) critters stay glued to stale/removed furniture ->
"weird spots". And `renderNowPlayingSkin` turns the EXCLUDED `.music-nowplaying-panel` into a
full-screen `mms-full` cover under `body.mms-on`; the planner then measures a viewport-sized
exclusion and drops/re-rolls placements -> "don't save / overlay". FIX (hybrid): (a) an `mms-on`
guard in `scheduleCritterScatter`/`scatterCritters` - clear-and-skip while the full-screen cover is
up, re-scatter on dock-return; (b) music.js calls `window.FileTube.scheduleCritterScatter()` after
its in-view content re-renders (the watch.js precedent) so the browse grids re-anchor.

### F-UNIFY (ACTIVE WAVE, branch feat/skin-engine-unify) - full decomposition (2026-09-02)

MACHINE-DERIVED BASELINE (re-verified at every commit): music.js 3027 lines, skin-surface.js 260,
podcasts.js 1311. music.js engine-block call sites: reflectSkin 4, reflectAllSkins 1 (+8 mp-event
bindings via ensureSkinReflect), setWheelCursor 3, setIpodListMode 5, applySkinMarquee 2,
ensureSkinReflect 3, paintSkin 4, bindSkinSurface 3, injectSticker 2, refreshStickerMenu 5,
adjustVolume 2, showVolume 2. THE REGRESSION NET = 207 green tests across 11 suites that drive the
REAL behavior (music-sticker-menu 13, music-sticker-extras 24, music-skin-integration 64,
music-skins 32, era-player-skins 10, skin-surface 12, music-chapter-playback 6, music-chapter-
reflect 13, music-nowplaying-view 16, music-nowplaying-return 5, audio-opens-in-music 12); the
wave's core CLAIM is that all 207 stay green UNCHANGED through the swap (they bind behavior, not
internals). player.js 0-byte, every commit.

TARGET SHAPE: skin-surface.js `create(config)` stays the ONE per-panel engine; it GAINS optional
capabilities, each inert unless configured, so podcasts' current usage is untouched by default:
- marquee: paint() gains the rAF applySkinMarquee epilogue (default ON - CSS-driven, inert
  without overflow; delivers marquee to podcasts as a ride-along).
- WHEEL-VOLUME RETIRED (Dean, 2026-09-02, mid-wave ruling): "make the classic wheel scrub like
  it does on mobile instead of volume, consistent UI and useful." So v1.235's pop-out
  wheel-volume is NOT ported - the engine has exactly ONE Now-Playing wheel behavior (scrub),
  and U3 DELETES music.js's adjustVolume/showVolume/volume-mode with the rest. The iPod skin's
  .ip-vol-fill markup + .mms-voladj CSS stay DORMANT (music-skins.js/style.css untouched -
  zero-risk; removable whenever those files are next edited).
- `fastScan`: the v1.242 hold-prev/next scan (scanTimer/scanInterval on the PANEL's window,
  scan-owns-the-gesture, pointerup-commits-via-seek-bar, dual-arm teardown).
- `onShuffle` hook: [data-skin-shuffle] -> the view's control (music: #music-shuffle-btn).
- `sticker`: the WHOLE v1.238-249 sticker menu (speed/loop/skin quick menu - view-independent,
  talks to #media-player + FileTube.player + SKINS) plus, ONLY when `extras` hooks are supplied,
  the v1.249 Extras page. Extras hooks (music supplies; podcasts omits - locked v1.249 intake:
  podcasts keep their own actions): { getBaseId, isEligible, onMutated, signal, fmt }. The engine
  keeps the in-main-document check internally (it knows its own doc).
STAYS IN music.js AS THE VIEW (hooks/config, never internalized): buildSkinCtx/getCtx,
chapters (effectiveCurrentId/currentChapterId/bounds/reflectChapter/enforceChapterLoop/
ensureChapterReflect - HIGHEST regression risk, untouched), straight-to-player cover,
currentSkinIndex/hasCurrentMusicTrack, queue/playAt/updateNowPlayingPanel/renderNowPlayingSkin,
the v1.247 dock-to-origin (rides onDock), ensureSkinReflect's event binding (now fanning to the
engine instances' reflect()).
DEVIATION from the earlier absorb sketch (disclosed): the desktop POP-OUT SHELL (window
open/mount/teardown/clock, ~170 lines) and the multi-surface REGISTRY are NOT absorbed this wave.
The shell is single-consumer (music only; podcasts has no pop-out) - moving it adds risk with zero
dedup payoff; instead the pop-out panel becomes a SECOND engine instance (its own win; it
SCRUBS like every surface - wheel-volume is retired per the ruling above) and the registry
collapses to "call both instances' reflect()". Extraction can ride the
LISTEN-MODE wave if that needs the shell.

TASK COMMITS (each with its tests, each green before the next):
- U1: engine capabilities - marquee epilogue, fastScan, onShuffle (wheel-volume retired per the
  ruling above, bound by a scrub-never-volume test). Behavioral tests in skin-surface.test.js
  (ported from the music suites' harness patterns). podcasts.js untouched; music.js untouched.
- U2: the sticker menu + Extras move INTO the engine behind config (code ported verbatim where
  possible, closure deps -> the hooks above). Engine-level tests with a fake view. music.js still
  on its own copy (both implementations coexist one commit - the engine's is the tested target).
- U3: THE SWAP - music.js creates two engine instances (in-tab; pop-out, both scrub) and
  DELETES its duplicated block (reflect/wheel/cursor/listmode/marquee/volume/sticker/extras/
  gesture dispatch; the pop-out's wheel-volume goes per the ruling). PREDICTION: music.js
  shrinks >= 600 lines; the 207-test net green with the ONLY allowed edits being the wheel-
  volume tests that bound the retired behavior (each edit DISCLOSED).
- U4: podcasts ride-along polish (the DEFERRED v1.246 items, delivered by the shared engine):
  podcasts.js enables `sticker` (speed/loop/skin, NO extras) + fastScan. Tests bind both on the
  podcast surface.
- U5: FULL gate (the moved Extras carries delete/move = data-adjacent), dual-Node, release.

## Predictions (F-UNIFY, re-verified each commit)
- `git diff main -- public/js/player.js | wc -l` == 0 at every commit.
- The 207-test regression net green UNCHANGED at U3 (no test-file edits in the U3 commit beyond
  none-at-all; any needed edit is a DISCLOSED finding about a test binding internals).
- No new stored per-item field anywhere in the wave.

## Task commits (THIS wave)
- **T1 F-EXTRAS:** the "Extras >" second page in music.js's sticker menu, full action set for the
  playing music track, reusing the shared helpers + id-parametric endpoints; fetch `/api/videos/:id`
  on open, gate each action on availability + RBAC. Tests (the actions fire the right endpoint /
  open the right modal; availability gating; the two-page menu nav). player.js 0-byte.
- **T2 F-CRITTERS:** the `mms-on` scatter guard + music in-view re-scatter. Tests (guard skips while
  mms-on; re-scatter fires on the music render path). lint:css 0.
- **T3:** full gate (this touches delete/move = data-adjacent -> FULL gate, both seats), dual-Node,
  release.

## Predictions (re-verified each commit)
- `git diff main -- public/js/player.js | wc -l` == 0.
- No new STORED per-item field (Extras reads live /api/videos/:id; critters add no position store).
