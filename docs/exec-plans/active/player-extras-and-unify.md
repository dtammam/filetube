# Player Extras (watch-page action fidelity on the music skin) + engine Unify

Status: ACTIVE. Dean's refinement wave after the podcast mega-wave (v1.245-v1.247). Intake
LOCKED. player.js stays BYTE-UNCHANGED throughout.

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

### F-UNIFY (NEXT WAVE) - the engine gap (recon)
skin-surface.js must ABSORB (self-contained, low risk): marquee, wheel-VOLUME mode, hold-to-fast-
scan, the sticker menu (+ /api/me/sticker + the new Extras page from THIS wave), the multi-surface
reflect registry + `ensureSkinReflect`, the desktop pop-out (Document-PiP) shell. Must EXPOSE AS
HOOKS (do NOT internalize - coupled to the view's queue/nowPlaying/playingId/chapterViewId):
chapters (`effectiveCurrentId`/loop/auto-advance - HIGHEST regression risk), the straight-to-player
cover, `currentSkinIndex`/`hasCurrentMusicTrack`. Net after this wave lands the Extras in music.js's
sticker menu, F-UNIFY carries the whole sticker menu (incl. Extras) into skin-surface.js.

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
