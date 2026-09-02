# Podcasts on the skin + MENU-returns-to-origin + notification deep-link

Status: ACTIVE. Split out of `universal-audio.md` SEAM 3 (#3), now its own wave with
Dean's two nav asks folded in. Intake LOCKED (2026-09-02). player.js is BYTE-UNCHANGED
across the whole wave (machine-derived prediction: `git diff main -- public/js/player.js`
= 0 lines, re-verified at every commit).

## The Dean asks (scope LOCKED 2026-09-02, ONE big wave, ONE release)

1. **F1 - Podcasts on the SKIN.** Podcast episodes play through the same iPod/Apple/
   Spotify skin + wheel the music player uses. Podcasts KEEP their own section + data
   (show notes, per-episode resume, seasons). NO merge into the Music library. Podcast
   art in the skin is the SHOW's art (no per-episode image; Dean OK'd).
2. **F2 - MENU returns to ORIGIN = where you launched from.** Track the launch origin
   (the tab you were on). Skin MENU/back DOCKS to the mini-player on that ORIGIN tab
   (dock-to-mini, NOT close), for BOTH music and podcast. Fallbacks: launched from
   SEARCH -> the tab under the search; a NOTIFICATION cold-start -> the content's home
   tab (audio->Music, podcast->Podcasts).
3. **F3 - Open the skin from ANYWHERE, for ALL non-video audio + podcasts.** A tapped
   web-PUSH notification, the lock-screen MediaSession tile, a SEARCH result, and the
   home feed all open the mobile skin for any non-video audio item (music OR any
   audio-only file) and any podcast episode. Books keep their own reader.
4. **F4 - iOS search Enter key.** Pressing return/Search on the iOS keyboard in the
   header search triggers the search (same as tapping the Search button). Tiny.
5. **F5 - Search-launched audio/podcast opens the SKIN.** Playing an audio-only or
   podcast search result currently opens the plain /watch player; it must open the
   mobile skin instead (a subset of F3, called out because Dean hit it directly).

Locked scope answers: MENU=where-you-launched-from; skin scope=ALL non-video audio +
podcasts (books excluded); ONE wave / ONE release; podcast art=show art.

## WAVE STATUS (v1.246 target)

- **F4 - iOS search Enter key: SHIPPED v1.245.0** (standalone, Dean's "pop it out today").
- **F5 - audio-only ALWAYS opens in the skin: DONE** (retired the open-audio-in-music opt-out;
  audio -> /music?play= unconditionally, everywhere; the Settings toggle removed).
- **F3 - audio notifications deep-link the skin: DONE** (pushMusicUrl; podcast push already ->
  /podcasts?play= which the widened gate opens in the skin).
- **F1 - podcasts on the skin: DONE** via a NEW shared engine `public/js/skin-surface.js`
  (faithful port of music.js's proven skin/gesture code; music.js BYTE-UNTOUCHED). Podcast art =
  show art. Deferred podcast-skin follow-ups: the speed/loop sticker menu + hold-to-fast-scan.
- **F2 - MENU returns to origin: DEFERRED to a focused follow-up.** It spans common.js (expose
  the current view), music.js, podcasts.js, and skin-surface.js, and the exact "dock to the
  origin tab" behaviour genuinely needs on-device UX validation (cross-section nav is an SPA
  swap via ensureScriptLoaded, so the player persists - the mechanism is feasible, but the UX is
  a device call). Not rushed un-device-tested at the tail of the wave. Tracked next.
- **tech-debt:** unify music.js onto the shared `skin-surface.js` engine (after Dean device-
  validates the shared engine via podcasts) to retire the temporary two-copies-of-the-engine.

Shipped this wave (one release, v1.246): T1 (gate) + F5 + F3 + F1. player.js 0-byte across all.

## Architecture (from the 2026-09-02 recon; anchors verified)

- **Skin gate.** `music-skins.js:208` `skinActiveFor(meta,mql) = !!(meta && meta.isMusic) && isMobileViewport`. `getCurrentMeta()` (player.js:8413-8429) ALREADY exposes `resumeMode`
  (8425) and `subId` (8426); `isMusic` (8427) is frozen. Widen the gate in music-skins.js
  (NOT player.js) to also accept `meta.resumeMode==='podcast'`. `music.js:612` passes the
  whole meta object, so no call-site change.
- **Skin engine (music.js closures).** Generic already: `reflectSkin` (654), `reflectAllSkins`
  (680), transport proxy hooks (`bindSkinSurface` 1276-1316 -> `#pp-btn`/`#track-prev-btn`/
  `#track-next-btn`/`#seek-bar`, which are GLOBAL shell controls), and the `renderFull`
  registry (music-skins.js). Music-hardcoded: `buildSkinCtx` (614-642) - art
  `/albumart/<playingId>` (636), list `queue[]`, meta `{title,artist,album}`; the
  `data-skin-go`/wheel binding to music's `playAt`; `#music-shuffle-btn`; the `body.mms-on`
  lifecycle in `updateNowPlayingPanel` (1129-1220). Pop-out (`mountPopout`/`repaintPopout`
  1553-1619) is the precedent for mounting the engine on a foreign panel.
- **Podcasts today.** `podcasts.js playAt` (813-866) loads into `#media-player` with
  `resumeMode:'podcast'`, `artUrl:/podcastart/<subId>` (show-level art), `streamSrc:/episode/<id>`,
  `subId`. `nowPlaying={id,title,showName,pubDateMs,durationSec,description,subId}`. The
  episode list is `playable[]` (800). Its now-playing panel `updateNowPlayingPanel`
  (683-736) is a HAND-BUILT DOM panel (`#podcast-nowplaying-panel`) - this is where the
  skin fork lands (mirroring music.js:1162). Prev/next already wired via `setTrackNav`.
- **MENU/dock.** The skin MENU/collapse already DOCKS (music.js:1279 collapse, 1285-1287
  iPod menu) via `player.dock()` (player.js:8106-8161), which reparents the host into the
  GLOBAL `#player-dock` (not per-tab). The router auto-docks on media-view exit
  (`applyPlayerTransition`, common.js:10015). So F2 is a ROUTING add on the existing dock:
  after dock, navigate to the origin tab. Router: `registerView`/`currentViewName`
  (common.js:9866-9917), `navigate()` (~10223), `viewState` back-stack (9466-9490,
  `pushViewState`/`replaceViewState` 9957-9970). `readerHref` (music `/music?nowplaying=1`
  music.js:2274; podcast `/podcasts?nowplaying=1` podcasts.js:841) already encodes the
  media-type view - but NOT the true launch tab (Home vs Music vs Podcasts).
- **Notifications.** Push worker is ALIVE (`public/filetube-worker.js`, push-only, no fetch/
  cache - the v1.27.2 removal was the OFFLINE worker). `notificationclick` (102-116) ->
  `client.navigate(url)`. `lib/push/deliver.js:40,180` ALREADY sends podcasts to
  `/podcasts?play=<id>` (opens+expands, podcasts.js:1031-1074); audio/video -> `/watch`.
  MediaSession (player.js:2535-2822) acts directly on the media element and just foregrounds
  the mounted view - NO app-nav hook, and adding one would touch player.js (avoid).

## Task commits (each green before the next; player.js 0-byte re-checked each time)

- **T1 - widen the skin gate.** `skinActiveFor` accepts `meta.resumeMode==='podcast'`
  alongside `meta.isMusic`. Unit: podcast meta on mobile -> true; desktop -> false; a
  video/non-audio -> false; music unchanged. Groundwork; no visible effect until T4.
- **T2 - MENU returns to origin (F2), MUSIC skin first.** Capture launch origin
  (`currentViewName` at load/`playAt` time) in CLIENT-SIDE module state (never through
  `getCurrentMeta` -> no player.js edit); the skin MENU/collapse handler docks (as today)
  THEN `navigate(originUrl)` to the origin tab's mini-player. Bind BOTH the collapse handle
  and the iPod MENU. Tests: origin captured; MENU from a Home-launched track routes Home,
  from Music routes Music; a normal dock still works; no double-nav. (Podcast origin lands
  in T4 when podcast joins the skin.)
- **T3 - extract `mountSkinSurface(panel, ctxProvider, hooks)`** [BIG/RISKY] from music.js
  into a shared global module (new `public/js/skin-surface.js`, loaded like music-skins.js;
  keeps music-skins.js a pure render registry). `ctxProvider()` supplies
  `{track:{title,artist,album}, artUrl, list[], curNum, total}`; `hooks` supply
  `onSelectIndex(i)`, `onDock()`, `shuffleBtnId|null`, the origin router. music.js refactors
  to call it with a MUSIC ctxProvider. HARD BAR: the full existing music-skin suite
  (126 tests) stays green and `/music` behaves byte-for-byte (no v1.227-244 regression:
  wheel scrub/scan, sticker, chapter loop, album-art fit, straight-to-player). Add a test
  asserting the music path drives the SHARED mount (reachability, not just that the helper exists).
- **T4 - drive the podcast skin (F1).** Fork `podcasts.js updateNowPlayingPanel` to mount
  the skin (gate now true for podcast) with a PODCAST ctxProvider (`playable` list,
  `/podcastart/<subId>` art, `showName` in the album slot, `description` available),
  wheel/select -> podcasts' `playAt`, per-episode resume preserved. OWN the `body.mms-on`
  add/clear + `destroy()` teardown so a podcasts<->music swap never strands the full-screen
  cover (the v1.227 leak lesson). Podcast MENU-origin (F2) wired here too. Tests + shell-
  coverage (no boot error on the podcasts shell).
- **T5 - notification deep-link (F3).** Verify a podcast push (`/podcasts?play=<id>`, already
  minted) opens straight into the skin now that the gate is widened (integration test).
  Add a symmetric `pushMusicUrl` -> `/music?play=<id>` in `lib/push/deliver.js` for
  audio-only items so they open the skin instead of `/watch`; the `?play=` init mounts the
  player and the skin re-checks the gate. MediaSession unchanged (tile foregrounds the
  mounted skin). Tests.
- **T6 - polish + verify.** `lint:css` TOTAL 0 (any podcast-skin styles use tokens);
  full `npm test` on Node 22.23.1 AND 24.14.0; player.js 0-byte final check.

## Predictions (machine-derived, re-verified at every commit)

- `git diff main -- public/js/player.js | wc -l` == 0 (frozen).
- Music-skin suite count never DROPS through T3 (extraction adds, never removes coverage).
- New per-item STORED fields: ZERO (podcast skin reads live `playable`/progress; origin is
  client-side) -> NO persist-gate / backup / stale-snapshot exposure.

## Top risks

- **T3 regression of the music skin** (highest) - the extraction moves ~600 lines of the
  most battle-won feature. Net: the 126-test suite + byte-behavior verification; extract by
  MOVE (not rewrite), keep names, run the suite after each sub-step.
- **`body.mms-on` leak across the podcasts<->music view swap** (v1.227) - each view owns its
  add/clear + destroy teardown; the music-view-local guards (music.js:1519/2333/2357/2490
  synthetic `{isMusic:true}`) stay music-only; podcast needs parallel `resumeMode==='podcast'`
  guards.
- **player.js pressure** - resist adding an origin field or a MediaSession nav hook to
  player.js; keep origin client-side and route deep-links via notificationclick + `?play=`.
- **Show-level art** - all episodes of a show share `/podcastart/<subId>` (no per-episode
  art). Acceptable; a visible difference from music's per-track art (flag to Dean).

## Shipping

Increment as the repo does: T1+T2 can ship as one release (MENU-origin is the visible win);
T3-T5 (the extraction + podcasts-on-skin + deep-link) as the next. If T3 stays clean it may
all land in one wave. Device-pending is disclosed, never merged-but-unreleased. Full
two-reviewer gate (not slim) - this touches navigation/data-adjacent surfaces and a large
refactor.
