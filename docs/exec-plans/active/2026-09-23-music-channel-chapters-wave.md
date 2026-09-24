---
plan: music-channel-chapters-wave
harness: v2 · lean
branch: feat/music-channel-chapters
anchor: spec
status: Building
next: M1+M2 gate CLOSED r3 @8aa22622 (adversary + qa; round 3 by Dean's call, with his two rulings: pop-out listen artist line is plain text, Nordic rows blank for an unknown length). Merge to main; this umbrella closes at the wave release v1.317.0 (M4 has its own plan). Owed (r3 qa SUGGESTIONs): record that the chapter-aware watchBackVisible also changes dockToOrigin after a chapter cross + Songs browse (docks in place per the v1.283 listen rule instead of bouncing to the source video; correct, unbound) and the desktop menu Watch entry likewise; the sameMusicItem comment should name buildSkinCtx as a second caller. Device check owed (adversary S5): the marquee on a button in Firefox/iOS
design: Approved 2026-09-23 @ef42a6d4 (Dean: "GO." on the whole register D1-D15 as recommended, D15 as adjusted by the intake finding below)
gate: APPROVED r3 @8aa22622 — adversary, qa (M1+M2)
---

# Music wave: channel access, chapter length, chapter likes, desktop ambient, and the bell polish

Prepared 2026-09-23 at v1.314.0 (main f689eb45) from two read-only surveys (file:line verified
by reading; re-verify before building). Dean's asks, in his words:

1. "The ability to go to an 'artist' from the music view for YouTube/chaptered content" (M1).
2. "The length of a given section in the right-hand view section" (M2).
3. "The ability to Like a given chapter as a 'song'" (M3).
4. "Ambient mode in the music player in desktop" (M4). Also: "I have ambient mode selected in
   this player but I don't see any ambience for the music. Maybe because the album art is a
   still image." Verified: NOT the art. music.js / skin-surface.js / music-skins.js / player.js
   carry zero ambient code; the engine and its toggle live only in watch.js, so the preference
   is honoured on watch pages only. The engine already samples still images.
5. Theatre button (Dean, later the same day): "the player has a built-in theatre mode button
   but it doesn't work. There's one higher. Idk why we are not using the standard one. It
   doesn't always show." (T1)
6. Bell polish (from v1.314.0): "make sure the notification bell we picked not only doesn't
   refresh the subscription page on toggle but is styled appropriately with the design language
   per theme" (B1, B2).

## Architect's challenge (read before the decision register)

- **This is FOUR features and a polish pair; it should be two or three branches, not one.**
  B1+B2 are a slim, self-contained fix on v1.314.0's surface and should ship FIRST as their own
  small branch (a user-visible refresh flicker on every toggle is a defect). M1+M2 are
  read-only UI additions over data the client already has (folderName, durationSec) and can share
  a branch. M3 touches storage, three routes, cleanup and the Liked surfaces: data-loss class,
  full gate, its own branch. M4 depends on the ambient mobile branch landing (v1.315.0) and
  shares the watch.js engine: its own branch. Recommendation: three branches (bell polish;
  M1+M2; then M3 and M4 as separate follow-ons), each with its own plan doc cloned from this one.
- **M1 "artist" for YouTube content = the CHANNEL, and the only channel handle the music
  client gets is `folderName`.** `projectAudioItem` folds channelName into `artist` and never
  emits channelId/channelUrl/filePath; `publicTrackListItem` serializes `folderName` only. So the
  cheapest correct target is the existing home grid filtered by folder (`/?folder=<folderName>`,
  which already carries the "Showing in Music" toggle), plus the in-Music artist drill for the
  same-view case. A dedicated channel page is out of scope (new route + census churn).
- **M3 is the one that can lose data.** Two like stores exist (media `user_liked`, music
  `user_music_liked`), both existence-gated, cleanup is exact-id, and the row heart in music.js
  flips WITHOUT checking `r.ok` (a silent 404 today for every projected row). A chapter like
  keyed `<mediaId>::c<n>` orphans on file delete/move unless cleanup becomes prefix-aware.
  Force the full gate; brief the Adversary to destroy the data.

## Survey anchors (v1.314.0)

### B1 - no page refresh on the row bell toggle
- `lib/ytdlp/client/subscriptions.js` `toggleBell` (~4190): PATCH then `loadSubscriptions()`,
  which shows skeleton rows and re-renders the whole list (`renderSubscriptions`) - that IS the
  refresh Dean sees. `togglePause` has the same shape (not in scope; note it).
- The ~2.5s poll already updates rows IN PLACE: `applyStatusUpdatesInPlace(rowElementsById,
  subs, ...)` (:3068), keyed by `data-sub-id` (:2538); `rowElementsById` is rebuilt after each
  render (:3229/:3297). The row's bell is the `.sub-row-bell` child (:2766-2781).
- The watch page bell (`ensureBell`/`handleToggleBell`, public/js/watch.js ~2659-2708) already
  updates in place from the PATCH response; the /subscriptions side must match it.

### B2 - the bell styled per theme
- Themes: `[data-theme="2005"|"2009"|"2014"|"2021"]` x `[data-mode="light"|"dark"]`
  (public/css/style.css; counts 19/26/22/13 rules). `.btn` (:977) is the era control; 2009 adds
  glossy gradients (:556 light, :567 dark) as a `background-image` on `.btn` ONLY.
- `.sub-row-pin, .sub-row-bell` (:8362-8395) is ONE token-driven chip rule (`--bg-color`,
  `--border-dark`, `--radius`, gold `#e0a800` when active). It inherits tokens, so it themes in
  COLOUR only; it never receives an era's control TREATMENT (2009 gloss, 2005 flat bevel, 2021
  pill). The kebab (:3955) is the same chip family. The watch page bell is a `.btn` and already
  takes every era treatment.
- Norm: "make it look like X" = build from the reference's REAL css and compare SIDE BY SIDE by
  sampling pixels (match-reference-component-norm); button changes are MEASURED with
  `scripts/action-row-probe.js` before/after (rows wrap, buttons never shrink).

### M1 - artist / channel from the music view (YouTube + chaptered)
- No music surface links to a channel; the artist line is plain text everywhere. Renderers (the
  every-writer list): `public/js/music-skins.js:111` / `:122` (`.mms-sub`, `a.artist`), `:152`
  (`.ip-artist`); `public/js/skin-surface.js:1544` (`.mnp-sub` = np.subline built at
  `music.js:230`), the marquee query at `skin-surface.js:836`; `music.js` song rows
  `.music-song-sub` ~163-200, drill header `.music-drill-artist` ~378; player.js
  `#audio-visual-folder` (~8179). The desktop pop-out reuses the skin renderers.
- The model for a tappable line: "Playing from <Album>" handler `music.js:1677-1681` (label set
  :1450-1457 with `data-album-key`, opens `openDrill({type:'album'})`). Artist drill:
  `openDrill` :2139, artist call :2273 (`.music-artist-card` / `.music-artist-row`
  `data-artist`), another scope :2615.
- Menus: `createExtrasMenu` `skin-surface.js:104` (rows :165-199, like row :177; Watch via
  cfg.hasWatchBack/onWatch); `buildStickerMenuHtml` :584-690 (injected :687, refreshed :697),
  page 1 has the conditional Watch row.
- Channel target: the home grid filtered by folder - `/?folder=<folderName>` (cards/history) or
  `/?root=<dir>` (watch page `resolveUploaderLinkHref` watch.js:363-368 from filePath, which the
  music client does NOT have). `main.js` `folderFilter` ~1283 renders it with the
  `#folder-music-toggle` (~2066-2130).
- Data: `projectAudioItem` lib/music/libraryAudio.js:124-166 keeps `folderName` (:139), folds
  channelName into `artist` (:132), drops channel ids/urls/filePath; `publicTrackListItem`
  server.js:4027 serializes `folderName` (:4051). `nowPlaying` is rebuilt at music.js
  ~1092/2382/2589/2761 WITHOUT folderName (queue entries keep the full item); listen tracks
  (`buildListenChapterTracks` :301) fold channelName into artist and keep no folderName.
- Tests that lock the artist line: music-view, music-nowplaying-view (shares buildPanelHtml with
  podcast-nowplaying-view), music-skins, music-skin-integration, music-sticker-extras,
  music-actions-desktop, music-library-audio, music-home-row, music-album-view, music-nav,
  music-back-stack; watch side uploader-channel-link.test.js.

### M2 - chapter length in the right-hand panel
- `skin-surface.js:1540-1565` `buildPanelHtml(np, rows)`: rows are `{id, artUrl, title, artist,
  index, state}` -> `.mnp-queue-row` (thumb, `.mnp-queue-title`, `.mnp-queue-sub`); renders NO
  duration. Podcasts share the builder (comment :1527-1534) so a duration field must be optional.
- Music drops the duration TWICE before the builder: `music.js:1518-1531` (`updateNowPlayingPanel`)
  and `music.js:221-235` (`buildNowPlayingPanelHtml`, re-map at :232). Both need `durLabel`.
- Durations exist: library chapters from `expandAudioToTracks` lib/music/libraryAudio.js:182-209
  carry `durationSec` = the chapter's own span (id `<itemId>::c<i>`, `chapterStartSec`); listen
  chapters `buildListenChapterTracks` music.js:296-328 same shape; `publicTrackListItem`
  serializes `durationSec` (:4046) and `chapterStartSec` (:4080), no chapterEndSec (end derived
  client-side at music.js:1045-1060). Helpers: `formatTrackDuration` music.js:20 ('' for 0, used
  by `.music-song-duration` :170/:190 - the album drill already shows chapter lengths),
  `mmssMusic` :847. Mobile skins already pass `durLabel` (music.js:859-861 -> music-skins.js:92
  `.mms-rd`, list variant only; the thumb variant :83-87 omits it).

### M3 - like a chapter as a song
- Media likes: `user_liked(user_id, media_id)` lib/db/sqlite.js:469 (no FK). `POST/DELETE
  /api/liked/:id` lib/media/user-routes.js:174-194, POST gated by `restrictedVideoMutation`
  (server.js:1234) and REQUIRES own-property `db.metadata[id]` (else 404). `GET /api/liked`
  :341 builds from `Object.values(db.metadata)` filtered by likedIds + `shapedLikedTrackItems`
  (:257) + podcast/book arms.
- Music likes: `user_music_liked(user_id, track_id)` sqlite.js:505; lib/music/routes.js:298-315;
  POST requires `ownTrack(ns.tracks, id)` (server.js:4020) = native music-store tracks ONLY.
  Read by `/api/music?filter=liked` (:208-209), the `liked` flag in `publicTrackListItem`,
  `shapedLikedTrackItems` (drops ids missing from ns.tracks).
- Clients: row heart `music.js:197` `data-like-id=item.id`, `toggleLike` :2304-2322 POSTs
  `/api/music/liked/<id>` and FLIPS WITHOUT `r.ok` (trap: every projected `library` / `::c` row
  404s silently and shows liked). Extras "Like" `skin-surface.js:177` + `defaultLikeRequest`
  :266 -> `/api/liked/<id>` on 2xx only; music feeds it `extrasBaseId()` (music.js:1358-1362,
  strips `::c`) so a chapter Like today likes the WHOLE file. Watch Like watch.js:1253-1260 /
  :3299; grid main.js:3221-3241; Liked page `/?liked=1` (main.js:1968, common.js:3009, count
  common.js:12988).
- Would `::c` break things: no id regex; both POSTs existence-gated (404); `GET /api/liked`
  never lists a stored `::c` id; cleanup exact-id only (`delLikedByMedia` / `rekeyLiked`
  lib/auth/store.js:72/77 via `removeMediaState` :610 / rekey :645) -> a chapter like ORPHANS
  on delete/move unless cleanup matches `id || '::c%'`. Backup bundle carries the like tables.

### T1 - the music view's theatre button
- Two theatre controls exist. The IN-PLAYER one: watch.js builds `#theater-btn`
  (`.pc-btn.theater-btn`, watch.js:2276) into the player chrome and wires it in
  `setupTheatreToggle` (watch.js:2320, called :1650/:4429) - the wiring is INSIDE the watch view,
  so if the same chrome template renders in the music view the button is inert there (Dean:
  "doesn't work"). The HIGHER one: `#music-theater-btn` in music.html:119 (`.btn.btn-sm
  .music-theater-btn`, born `hidden`, desktop-only, revealed by music.js:768 `v1.222 desktop
  THEATRE toggle`) is the one that works, and its desktop-only reveal is why "it doesn't always
  show". common.js:11100/15397 carry the theatre-toggle layout re-place logic.
- Builder must first ANSWER: where does the in-player button in the music view come from
  (player.js's shared controls template, or watch.js's injection leaking through a soft-nav -
  SPA swaps only #view-root; grep player.js for the control set), and what "standard" means to
  Dean (the in-player pc-btn, like YouTube's). Then ONE control: wire the in-player button to the
  music theatre toggle (the same `.is-theater` layout) with the same gating as today's desktop
  reveal, and remove/hide the higher duplicate - or the reverse, if the in-player chrome is not
  present on every music shell (SHELL PARITY: enumerate public/*.html). Tests: music-nav /
  music-theatre tests (grep "theater" in test/unit), watch's theatre test for non-regression.

### M4 - desktop music ambient
- Engine `createAmbientEngine(opts)` watch.js:219 (opts: glow, video [currentTime only],
  getMediaData, mediaId, storyboard, loadImage, makeCanvas, setTimeout/clearTimeout, clockMs,
  onHardFail). `ambientSourceFor` :121-139: sprite rung only for `type:'video'` + storyboard,
  else `{kind:'image', url: mediaData.artUrl || '/thumbnail/<mediaId>'}`. For music pass
  `getMediaData` -> `{type:'audio', artUrl: musicArtUrl(id, artUrl)}` (music.js ~210-219:
  `/albumart/<id>` native, `/thumbnail/<id>` library/listen) and the BASE media id (never `::c`).
  Same-origin images only (tainted canvas breaks toDataURL).
- Wiring `setupAmbientMode` watch.js:2373-2465 is INSIDE the watch view IIFE (930-4458): NOT
  reusable; a music host needs its own copy (pref `ft-ambient` via `isAmbientEnabled` :58, gate
  `ambientShouldRun` :69 + `isDarkMode` :73 = `html[data-mode=dark]`, sets `html[data-ambient-on]`
  for the sidebar bleed style.css:1096, re-evaluates on visibilitychange + media play/playing/
  pause/ended/emptied + a theme observer). `createAmbientEngine`/`isDarkMode`/`isAmbientEnabled`/
  `ambientShouldRun` are top-level (implicit window globals) + module.exports :891-910, NOT on
  `window.FileTube`; watch.js loads before the lazy music.js on both shells (index.html:356,
  music.html:365-368, music.js at common.js:10516). Expose them on `window.FileTube` explicitly
  (SHELL PARITY class: a global a soft-nav'd view depends on must ship on every shell).
- Toggle UI: watch.html `#watch-ambient-check` / `#ambient-toggle-row`; music has none.
- Host: music.html:176-184 `#music-stage.music-stage` wraps `#player-slot` +
  `#music-nowplaying-panel`; desktop art is player.js `#audio-bg-art` inside `#player-slot`
  (:2492, art :8169). `.music-stage` display:block (style.css:10848), flex in theatre
  (:10869-10879). Builder: wrap `#player-slot` in a stage (position:relative; z-index:0) + the
  glow div pair (watch.html:155-161 markup; CSS :9054-9133 incl. the fullscreen/audio-expanded
  z-index drop whose comment says only watch.html has a stage - extend it for
  `body.ft-audio-expanded` / `ft-css-fullscreen`). Reach tied to `AMBIENT_REACH_X/Y` by test.
- Depends on v1.315.0 (mobile spread + pace) landing first; all v1.312 constraints apply (no
  filter/transform/mask/etc. on glow or stage rules; PNG data-URL background only; the locks in
  test/unit/ambient-glow-engine.test.js must extend to the new stage).

## Decision register (spec anchor; Dean approves or overrides each)

| ID | Decision | Recommendation | Why |
|----|----------|----------------|-----|
| D1 | Branch split | Three branches: (1) `fix/sub-bell-polish` = B1+B2 (slim gate: lib/ytdlp/client = security seat forced by the client glob); (2) `feat/music-channel-chapters` = M1+M2; (3) M3 and M4 each their own | Blast radius and gate cost differ by an order of magnitude |
| D2 | B1 mechanism | After the PATCH resolves, update the clicked row IN PLACE from the response (glyph, `-active`, aria) and patch `currentSubs[i].pushBell`; no `loadSubscriptions()`. A non-2xx logs and leaves the row. Add the same in-place shape for the bell only (Pause keeps its reload; out of scope) | The poll's in-place updater is the precedent; the reload is the flicker |
| D3 | B2 mechanism | Give `.sub-row-bell` (and `.sub-row-pin`, `.sub-row-kebab` for consistency) the era CONTROL treatment by sharing the `.btn` rule family (a `btn btn-chip` variant) rather than a hand-copied per-era override | One rule family = no drift (INERT SIBLING lesson); 2009 gloss/2005 bevel/2014/2021 pill arrive for free |
| D4 | B2 proof | Side-by-side pixel sampling of the chip vs the era's `.btn` per theme x mode (8 shots) with the action-row probe; the plan records the numbers | The match-reference norm; a "looks right" claim is not evidence |
| D5 | M1 target | The channel page = the home grid filtered by folder `/?folder=<folderName>` (with "Showing in Music"); no new route | folderName is the only handle the music client has; the page already exists |
| D6 | M1 entry points | (a) a "Go to channel" row in BOTH menus (Extras + sticker page 1, beside Watch), shown when the item has a folderName that is a yt-dlp channel dir (else hidden); (b) the now-playing artist line tappable in every renderer -> the in-Music artist drill (model: the Playing-from handler). AMENDED at gate r1 W2 / r2 (Dean's rulings): a LISTEN video's line goes to the channel grid instead (its artist drill is always empty), is plain text when the video has no channel folder, and is plain text in the desktop pop-out (the pop-out never navigates the window behind it) | Two axes: leave the music view (channel grid) or stay in it (artist drill) |
| D7 | M1 data | Keep `folderName` on `nowPlaying` and listen tracks (client-only); no server change; optional later: folderName in `groupArtists` for a "View channel" button on the drill header | Zero API churn; the pop-out and skins read nowPlaying |
| D8 | M2 | Add optional `durLabel` to panel rows (both music writers), render `.mnp-queue-dur` after the title, blank when 0; also fill the mobile thumb variant's missing durLabel | Data already there; the podcast DESKTOP panel is unaffected (optional field). AMENDED at gate r2 (qa W3): the Nordic thumb rows are shared with podcasts, so a podcast episode now shows its length there too (the iPod list already did); Dean's ruling: a 0/unknown length is BLANK there (no `0:00`), music and podcasts alike |
| D9 | M3 store | Chapter likes go in the MEDIA like store keyed `<mediaId>::c<n>` (not the music-native store, whose `ownTrack` gate excludes projected rows) | One store for yt-dlp content; the Liked page already reads media likes |
| D10 | M3 existence check | POST accepts `<id>::c<n>` iff `db.metadata[id]` exists AND `n` is a valid chapter index of that item | Closes the 404 without opening a free-text key |
| D11 | M3 readers + cleanup | `GET /api/liked` gains a chapter arm (expand the base item's chapter n into a track-shaped entry); `delLikedByMedia`/`rekeyLiked` match `id` OR `id::c%`; the backup bundle round-trips; the row heart checks `r.ok` (fix the silent flip) and the Extras Like on a chapter row likes the CHAPTER, not the base | Access-control completeness + the data-loss class: every reader, every cleanup, the bundle |
| D12 | M3 gate | FULL gate (adversary + qa + security-brief), Adversary briefed to orphan/duplicate/leak likes across delete, move, rekey, restore | Destructive class, never dialed down |
| D15 | T1 | One theatre control in the music view: the in-player standard button (`#theater-btn`), INJECTED by music.js into the persistent control bar when absent (same markup as watch.js's `ensureCogControlsInjected`, factored so there is one writer of the SVG) and bound on the music view's own abort signal to the music `.is-theater` toggle; the header duplicate `#music-theater-btn` removed; below the desktop breakpoint the button is hidden (theatre has no meaning there) rather than inert; watch's wiring unchanged | Intake finding: the in-player button is a watch.js injection into the PERSISTENT player host, its listener dies with the watch view's abort signal (so it is inert after a soft-nav into Music and ABSENT on a cold-load of /music). An inert visible control is a defect; one control = one writer |
| D13 | M4 shape | A music-host copy of the wiring (or factor `setupAmbientMode` into a shared `createAmbientHost(opts)` in a new public/js/ambient.js loaded on EVERY shell) driving the SAME engine with the album art as the image rung; a toggle row in the desktop skin's settings; dark mode only (the engine's rule) | Shared factoring beats a second hand-copy; shell parity guard needed |
| D14 | M4 order | After v1.315.0 lands; measure with the ambient probe scripts; Dean's device check before tag | The engine is mid-change on the other branch |

## Intake record (2026-09-23, at ef42a6d4 = main 8536f399 v1.315.0 + this doc)

- Presented D1-D15 with recommendations; Dean: "GO." (the whole register as recommended).
- The T1 question answered BEFORE the register (read, not theorised): watch.js
  `ensureCogControlsInjected` (watch.js:2350-2390) inserts `#theater-btn` before the cog in
  `#player-controls`, which is the PERSISTENT player host (parity-locked across the nine shells,
  survives SPA navigation); `setupTheatreToggle` (:2405) binds its click via the watch view's
  AbortController signal. Consequences: after any watch visit + a soft-nav into Music the popcorn
  button is present but DEAD ("doesn't work"); on a cold-load of /music it does not exist
  ("doesn't always show", together with the header duplicate's desktop-only + track-expanded
  reveal at music.js:759-786). D15 adjusted accordingly.
- Branch plan (D1): B1+B2 get their own plan doc `2026-09-23-sub-bell-polish.md` on
  `fix/sub-bell-polish` (off main); T1, M3, M4 each clone their sections from here when opened;
  M1+M2 build on this branch under this doc. This doc keeps the register as the wave's source of
  truth; per-branch docs carry their own bound gate markers (one piece, one plan).
- Out of scope confirmed: a dedicated channel page/route, per-user bells, Pause's reload, podcast
  chapter likes, mobile music ambient.

## Acceptance (draft; each names its binding test once designed)

- B1: toggling a row bell issues exactly one PATCH and NO `/api/subscriptions` list fetch; the
  row element identity is unchanged after the toggle; the glyph/class/aria reflect the response;
  a 403 leaves the row and logs. (ytdlp-subscriptions-client: a driven `toggleBell` with a
  routed fetch spy + `rowElementsById` identity check)
- B2: for each theme x mode the bell chip's computed background/border/radius equals the era
  `.btn`'s (sampled), and the row still does not wrap at 390px (action-row probe numbers in
  the plan). (a CSS lock that the chip and `.btn` share one rule family; the probe report)
- M1: every artist-line renderer (skins x pop-out x listen x desktop panel) is tappable and opens
  the artist drill for the current item; "Go to channel" appears in both menus for a channel
  item, navigates to `/?folder=<folderName>`, and the player keeps playing across the nav (SPA
  swaps only #view-root). (music-skins, music-nowplaying-view, music-sticker-extras,
  music-actions-desktop, music-nav) AMENDED (gate r1 W2 / r2, Dean's rulings, see D6): a
  listen video's line opens the channel grid, not the (always empty) drill; with no channel
  folder, or in the desktop pop-out, it is plain text.
- M2: a chaptered album's panel rows show each chapter's own length; a podcast panel is
  byte-identical to today. (music-nowplaying-view + podcast-nowplaying-view) AMENDED (gate
  r2, see D8): the podcast DESKTOP panel is byte-identical; the shared Nordic skin rows show
  a podcast episode's length, and a 0/unknown length is blank there.
- M3: like chapter 2 of a 5-chapter file -> stored `<id>::c2`, listed by `GET /api/liked` as a
  track-shaped entry, shown liked in the row heart and Extras, NOT liking the base file; delete
  the file -> the like is gone; rekey/move -> it follows; restore a bundle -> it survives; a
  chapter index out of range -> 404; a non-manager on a restricted item -> 403; the row heart
  no longer flips on a 404. (user-routes + music routes integration, backup-restore, music-view)
- T1: on a desktop-width music view the in-player theatre button toggles `.is-theater` (album
  beside the player) and reflects aria-pressed; no second theatre control is in the DOM; below
  the breakpoint the button is hidden; the watch page's theatre toggle is unchanged. (a music
  theatre test driving the real button + the shell-parity census)
- M4: ambient on + dark + playing in the desktop music view paints the glow from the album art
  (PNG data URL on the layer); every v1.312 lock holds for the music stage; ambient off or
  light mode paints nothing; the pref key is shared with watch. (ambient-glow-engine + a new
  music-ambient test + the shell-parity test)

## Build record (M1+M2)

Built 2026-09-23/24 on `feat/music-channel-chapters` (main v1.316.0 `6ea45237` merged in as
`14088c92`). Every survey anchor above was re-verified against the merged source before
editing; the only drift was watch.js (`resolveUploaderLinkHref` is at :442, not :363, and it
links `/?root=` from `filePath`, which the music client never has - D5's `/?folder=` stands).
Findings that changed the build, then what each file got, then the bindings.

### Findings at re-verification

- **`#audio-visual-folder` (player.js :8179) is DEAD for music.** It is written only in the
  `AUDIO_PLAYER_MODE === 'visualizer'` branch and `AUDIO_PLAYER_MODE` is the constant
  `'background'` (player.js :2030, never reassigned), so the line never renders. It is NOT
  wired (an INERT FEATURE test of a branch that never runs is worthless); disclosed here and
  in the report. The umbrella's every-writer list is otherwise exact.
- **The client cannot tell a yt-dlp channel dir from a plain media folder.**
  `publicTrackListItem` (server.js :4027) serializes `folderName` and no channel identity;
  `projectAudioItem` folds channelName into `artist`. What it CAN tell is library-backed vs
  native: the Wave G `source` marker (`'library'` / `'library-chapter'`) or the client-only
  `listen` flag. FileTube's home grid treats EVERY media folder as a channel (`/?folder=`, the
  "Playlist:" header, the music mark keyed by folderName), so the gate is **library-backed +
  a non-empty folderName** (`channelFolderOf`, music.js). A native music-store track's
  folderName is a music-root directory with no home grid: never a row. Dean's D6 fallback
  ("show it whenever folderName exists and say so") is refined by that one exclusion.
- **The dock-return re-init rebuilds `queue` without the item** (the v1.252 W1 shape), so the
  channel folder must survive on the player: `loadTrack` puts `channelFolder` on the load
  data and `player.js getCurrentMeta` returns it (the `albumKey` precedent);
  `seedNowPlayingFromPlayer` reads it back into `nowPlaying.folderName`. player.js is a
  3-line change; there is no jsdom harness for the real facade (the repo's stated posture),
  so that line is source-locked and the seam is driven with a mirror mock.
- **The podcast seam**: podcasts.js :961 calls `buildPanelHtml` with `{title, subline}` and
  rows without `durLabel`; both new fields are optional and gated on a non-empty string, so
  the podcast bytes cannot move (proof below).

### The every-writer list for the artist line (D6b) and what each got

| Writer | Element | What it got | Binding (driven click) |
|--------|---------|-------------|------------------------|
| music-skins.js `renderApple` | `.mms-sub` | `artistLine()`: `<button data-skin-artist>` when the artist is non-empty, else the plain `<div>` | music-skins (every skin id), music-skin-integration in-tab apple |
| music-skins.js `renderSpotify` | `.mms-sub` | same writer | music-skin-integration in-tab spotify |
| music-skins.js `ipScreen` (Click, Click Black, Click Matte, Seattle) | `.ip-artist` | same writer | music-skin-integration in-tab ipod + zune-classic |
| the desktop pop-out (both skin families) | same elements | the same engine `onArtist` hook runs in the pop-out's engine instance; the drill opens in the MAIN document. Gate r2 (Dean): a LISTEN track's line there is plain text (its channel mode would navigate the window behind the pop-out) | music-skin-integration pop-out; "gate r2 qa W2" (the listen line) |
| skin-surface.js `buildPanelHtml` | `.mnp-sub` | a `data-artist` button when `np.subArtist` is non-empty (music passes `np.artist`); the div otherwise | music-nowplaying-view (driven `.mnp-sub[data-artist]` click), music-view (builder), podcast-nowplaying-view (stays a div) |
| skin-surface.js `applyMarquee` (:836) | reader | unchanged: it wraps whatever element the query finds, buttons included | - |
| music.js `buildSongRowHtml` | `.music-song-sub` | the artist name as `button.music-song-artist[data-artist]` (album stays plain) through the existing card `data-artist` dispatch | music-view (builder), music-nowplaying-view (driven row-artist click: drill opens, the row does NOT play) |
| music.js `buildDrillHeaderHtml` | `.music-drill-artist` | `button[data-artist]`, same dispatch | music-view (builder), music-nowplaying-view (driven from inside an album drill) |
| player.js `#audio-visual-folder` | dead branch | NOT wired (see findings) | - |

The engine hook is one line in the delegated `onClick` (`[data-skin-artist]` -> `onArtist`),
the view hook `openArtistDrill(name?)` opens `openDrill({type:'artist', key})` - the
"Playing from <Album>" handler's model. The CSS is ONE `:where()` reset (zero specificity)
over `button.mnp-sub, button.mms-sub, button.ip-artist, button.music-drill-artist` plus an
inline variant for `button.music-song-artist`, so every existing per-skin line rule keeps
winning at any order (no per-skin hand copy to drift; locked in music-skins).

### "Go to channel" (D6a) - gating chosen and why

`channelVisible()` = `channelFolderCurrent() !== ''`: `nowPlaying.folderName` when the
record's id is the effective current id (gate r1 W3 removed the queue-entry lookup that once
ran first; gate r2 made the id compare exact). The record is written by `nowPlayingFrom` at
every seam (a load derives it with `channelFolderOf`: library-backed + folderName; a re-init
seeds it from the player's `getCurrentMeta().channelFolder`, which an adopting same-id load
refreshes through `applyAdoptFlavor` since gate r2).
`channelTap()` -> `FileTube.navigate('/?folder=' + encodeURIComponent(folder))` (D5), a
cross-route SPA nav (pathname differs from /music), so the same-route no-op cannot swallow it
and only `#view-root` swaps - the persistent player host keeps playing. Rendered in BOTH
menus from the same pair: the sticker's page 1 (`stickerCfg.channel`, main-document only,
the Watch posture: a pop-out row must not navigate the window behind it) and the desktop
actions menu (`createExtrasMenu` `hasChannel`/`onChannel`, right after Watch). The mobile
Extras page 2 is byte-unchanged (its cfg passes neither).

### M2 (D8)

`updateNowPlayingPanel` rows carry `durLabel: formatTrackDuration(queue[j].durationSec)`;
`buildNowPlayingPanelHtml` re-maps `durLabel` (explicit wins, else derived from the row's
`durationSec`); `buildPanelHtml` renders `<span class="mnp-queue-dur">` after the title
block only for a non-empty label (a chapter track's `durationSec` is its own span; 0 = no
span). The Nordic thumb rows gain the `.mms-rd` length the iPod list already had
(`buildSkinCtx` already passed `durLabel`); since gate r2 a 0/unknown length (an all-zero
label) renders no span there, for music and podcasts alike (Dean's ruling). CSS: `.mnp-queue-dur` (trailing column, the
`.music-song-duration` pattern) and `.mms-spotify .mms-rd`.

### Per-file changes

- `public/js/music-skins.js`: `artistLine()` (one writer, 3 call sites), the thumb-row `.mms-rd`, the hook comment.
- `public/js/skin-surface.js`: engine `onArtist` + the `[data-skin-artist]` branch; sticker page-1 `channelRow` + `[data-skin-channel]` dispatch; `createExtrasMenu` `hasChannel`/`onChannel` row + `'channel'` action; `buildPanelHtml` optional `subArtist` button + optional `durLabel` span; cfg docs.
- `public/js/music.js`: `channelFolderOf` (exported); `buildSongRowHtml` / `buildDrillHeaderHtml` artist buttons; `buildNowPlayingPanelHtml` `subArtist` + `durLabel`; `buildListenChapterTracks` + the single listen track carry `folderName`; `nowPlaying.folderName` at all four seams (reflectChapter, loadTrack, seedNowPlayingFromPlayer, restoreListenChapterQueue); `loadTrack` `channelFolder` on the load data; `updateNowPlayingPanel` `durLabel`; the data-artist dispatch widened to `.music-song-artist` / `.music-drill-artist`; the panel `.mnp-sub[data-artist]` branch; `channelFolderCurrent` / `channelVisible` / `channelTap` / `openArtistDrill`; `onArtist` + `channel` in the engine/sticker config; `hasChannel`/`onChannel` on the desktop menu.
- `public/js/player.js`: `getCurrentMeta` returns `channelFolder` (3 lines).
- `public/css/style.css`: the `:where()` resets + hover underline, `.mnp-queue-dur`, `.mms-spotify .mms-rd`. Token census stays 0; overlay containment clean.
- Tests: `music-view` (1 adapted + 5 new), `music-nowplaying-view` (1 adapted + 5 new), `music-skins` (3 new), `music-skin-integration` (10 new: 6 top-level + the 4-skin loop; counts corrected at the r1 fix per qa finding 4), `music-actions-desktop` (harness extended + 3 new), `podcast-nowplaying-view` (2 new: the byte-identity lock + the driven no-dur/no-button check), `skin-surface` (1 extended: the pop-out never offers the channel row).

### Podcast byte-identity proof

`buildPanelHtml` on a podcast-shaped fixture (`{title, subline}`, rows without `durLabel`)
run against main's `skin-surface.js` (v1.316.0, `git show main:public/js/skin-surface.js`)
produced the string now frozen as `EXPECTED` in `podcast-nowplaying-view.test.js`
("v1.317 (seam): ... byte-identical"); the same call on the branch's builder equals it
(`assert.strictEqual`). The driven podcast panel additionally asserts no `.mnp-queue-dur`
and a `DIV` `.mnp-sub` with no `data-artist`. Mutants F1/F2 (render the span/the button
unconditionally) go red on exactly those tests.

### Acceptance (M1/M2) with binding tests

- M1a every artist-line renderer is tappable and opens the artist drill for the current item
  (AMENDED: a listen video's line goes to the channel grid, is plain without a channel folder
  and plain in the pop-out; bindings in the r1 and r2 fix records below):
  music-skins ("every skin renders ... data-skin-artist BUTTON"), music-skin-integration
  ("in-tab apple/spotify/ipod/zune-classic: tapping the artist line opens the ARTIST drill",
  "pop-out: the artist line ... drills the MAIN document"), music-nowplaying-view ("tapping
  the panel's artist · album line opens the ARTIST drill", the song-row and drill-header
  driven clicks), music-view (the builders).
- M1b "Go to channel" appears in both menus for a channel item, navigates to
  `/?folder=<folderName>`, and the player keeps playing across the nav:
  music-skin-integration ("a LIBRARY-backed track with a channel folder gets Go to channel ...
  leaves the player alone": navigate called once with the exact URL, loads/docks/closes
  unchanged; the negative axes; the listen track; the dock-return re-init survive),
  music-actions-desktop (the factory renders/dispatches it beside Watch; the music.js wiring
  lock), skin-surface (the pop-out never offers it).
- M2 a chaptered album's panel rows show each chapter's own length; a podcast DESKTOP panel is
  byte-identical (the Nordic rows: see the r2 fix record): music-nowplaying-view ("a CHAPTERED album's rows show each chapter's own
  span" = 2:00 / 1:02:05 / none), music-view (the builder's explicit/derived/blank axes),
  music-skins (the Nordic rows), podcast-nowplaying-view (the byte lock + the driven check).

### Mutation results

Run in a sandbox from `git archive 0246e988` (the round-1 commit; that commit carried the
wrong message through a shared scratchpad file and was soft-reset into the final commit
with the same tree plus the two tests noted under D), each mutant ONE exact-string edit on
the committed source, verified to land exactly once, then the named suites
(`m1m2-mutants.js`). 19 mutants, 19 killed:

| # | Mutant | Result (pass/fail) | Killed by |
|---|--------|--------------------|-----------|
| A | music-skins `artistLine` drops `data-skin-artist` | 132/6 | music-skins every-skin test; music-skin-integration in-tab apple/spotify/ipod/zune + pop-out |
| B | engine: the `[data-skin-artist]` click branch removed | 95/5 | music-skin-integration in-tab x4 + pop-out |
| C | music: the panel `.mnp-sub[data-artist]` branch removed | 18/1 | music-nowplaying-view "tapping the panel's artist · album line" |
| D | music: `.music-song-artist` / `.music-drill-artist` unwired from the data-artist dispatch | 19/2 | music-nowplaying-view "tapping the artist NAME inside a song row" + "inside an album drill, the header's artist line" (these two tests were written after the round-1 archive, so D was re-run against the archived code with the working-tree copy of that ONE test file; it survived the first pass for exactly that reason) |
| E | music: `updateNowPlayingPanel` drops `durLabel` | 17/2 | music-nowplaying-view both M2 tests |
| F1 | builder: `.mnp-queue-dur` rendered unconditionally | 65/3 | music-view builder axes; podcast byte lock; podcast driven |
| F2 | builder: the sub-line is ALWAYS the button | 65/3 | music-view "keeps the plain sub-line"; podcast byte lock; podcast driven |
| G | sticker: `channelRow` dropped from page 1 | 97/3 | music-skin-integration positive, listen, re-init |
| H | sticker: the `[data-skin-channel]` dispatch removed | 97/3 | the same three (row present, navigate never called) |
| I | music: the re-init seed drops the meta carry | 98/2 | re-init survive + the source lock |
| J | music: `loadTrack` drops `channelFolder` | 96/4 | positive (`data.channelFolder`), negative axes, re-init, source lock |
| K | music: `channelFolderOf` loses its library gate | 142/2 | negative axes (native track) + the pure unit |
| L | extras: the desktop channel row dropped | 12/1 | music-actions-desktop factory |
| M | skins: the thumb row drops `.mms-rd` | 37/1 | music-skins Nordic rows |
| N | music: `buildNowPlayingPanelHtml` drops `subArtist` | 60/3 | music-view + music-nowplaying-view (adapted v1.104 locks + the driven tap) |
| O | music: `onArtist` unwired from the engine config | 95/5 | in-tab x4 + pop-out |
| P | css: the `:where()` reset removed | 37/1 | music-skins CSS lock |
| Q | player: `getCurrentMeta` drops `channelFolder` | 99/1 | the source lock only (no jsdom harness for the real facade - disclosed) |
| R | sticker: the channel row ignores `inMainDoc` | 69/1 | skin-surface U2 pop-out exclusion |

Instruments at the final commit: `npm run lint` 0 errors (7 pre-existing warnings in
common.js), `npm run lint:css` TOTAL 0, `overlay-containment-lint --enforce` clean,
`check-markers.sh` flags only the stale design approval `@ef42a6d4` (the known, tolerated
shape while Building; the gate re-binds it).

## Out of scope (say so at intake)
A dedicated channel page/route; per-user bells; Pause's page reload (same shape as B1, later);
podcast chapter likes; mobile music ambient (desktop first per Dean).

## Gate r1 - qa (@35a3bb1d)

Reviewed `git diff main...HEAD` at 35a3bb1d (13 files, +1043/-21) against the register (D5-D8),
"### M1"/"### M2", the acceptance lines and the build record. Everything below marked
VERIFIED was run in the worktree (or a `git archive 35a3bb1d` sandbox, `/tmp/qa-m1m2-UQw6`);
nothing here is "should work" unless it says so.

### Instruments (verbatim)

- `npm run lint`: `✖ 7 problems (0 errors, 7 warnings)` - the 7 pre-existing `no-unused-vars`
  warnings in common.js (setTheme, homeFeedEnabled, setIconSet, addToQueue, openTranscriptFor,
  showChaptersEditor, shareExternalUrl). 0 errors.
- `npm run lint:css`: `TOTAL 0  (the token census; ceiling ZERO since v1.61.0)`.
- `node scripts/overlay-containment-lint.js --enforce`: `overlay-containment: clean (0 violations)`.
- `bash .harness/lib/check-markers.sh`: `✗ docs/exec-plans/active/2026-09-23-music-channel-chapters-wave.md:
  stale approval @ef42a6d4 - reviewed code changed since; re-gate` / `check-markers: 1 issue(s)
  found` (the tolerated Building shape: the design line is bound to the pre-build sha; the
  gate close re-binds it). Frontmatter otherwise valid: `status: Building`, `gate: pending`.
- Suites (`node --test test/unit/<file>`, Node v22.23.1), tests/pass/fail:
  music-view 44/44/0 · music-nowplaying-view 21/21/0 · music-skins 38/38/0 ·
  music-skin-integration 100/100/0 · music-actions-desktop 13/13/0 ·
  podcast-nowplaying-view 24/24/0 · skin-surface 70/70/0 · uploader-channel-link 9/9/0 ·
  music-nav 6/6/0 · music-home-row 12/12/0 · music-album-view 19/19/0 · music-back-stack 7/7/0 ·
  music-library-audio 19/19/0. (Full `npm test` NOT run - the box is loaded, per the brief.)

### Re-verified claims (VERIFIED unless noted)

- Podcast byte-identity: ran `git show main:public/js/skin-surface.js`'s `buildPanelHtml` on
  the test's exact fixture in the sandbox: `main builder === test EXPECTED: true`;
  `branch builder === main builder: true`. The frozen string is main's real output.
- Mutants re-run myself (one exact-string edit each, landed exactly once, source restored
  and `diff -q` clean after each): **D** (song-row/drill artist unwired from the data-artist
  dispatch) -> music-nowplaying-view 21 tests, 19 pass, 2 fail: "tapping the artist NAME inside
  a song row" + "inside an album drill, the header's artist line". **I** (re-init seed drops the
  meta carry) -> music-skin-integration 100, 98 pass, 2 fail: the "SURVIVES the dock-return
  re-init" test + the source lock. **K** (`channelFolderOf` gate -> `var lib = true`) ->
  music-view 44/43/1 (the pure unit) + music-skin-integration 100/99/1 (the negative axes).
  All three match the build record's table (19/2, 98/2, 142/2).
- `AUDIO_PLAYER_MODE` is `var AUDIO_PLAYER_MODE = 'background'` (player.js:2030), referenced
  once more at :8166 (the branch) and never reassigned; `audioVisualFolder` is written only at
  :8179 inside the `else` (visualizer) arm. The "dead branch" disclosure is true.
- player.js `load` does `currentData = data || {}` (:8626) - the whole load object is kept, so
  `channelFolder` reaches `getCurrentMeta` (:8687) without a whitelist dropping it.
- `expandAudioToTracks` spreads `base` (the projected item, folderName included) into every
  chapter track with `source: 'library-chapter'` - Dean's chaptered case reaches the gate.
- `/api/music?artist=` (lib/music/routes.js:196-205) filters `ns.tracks` + the Wave G
  projection, so the artist drill for a projected YouTube channel is reachable (see S3 for
  the listen exception).
- The sticker's own `createExtrasMenu` cfg (skin-surface.js:753-772) passes neither
  `hasChannel` nor `onChannel`: the mobile Extras page 2 is byte-unchanged as claimed.
- Every-writer table vs the tree: exact (3 `artistLine` call sites, `.mnp-sub`, `.music-song-
  artist`, `.music-drill-artist`, applyMarquee untouched at :861-879 - it re-parents
  `textContent` into `.mms-mq` inside whatever element it finds, the button's `data-skin-
  artist` survives).
- `.icon-folder` has a rule (style.css:4776/4852 + rounded/filled variants); `.mnp-queue-dur`,
  `.mms-spotify .mms-rd`, and the `:where()` resets all bind their classNames. No bare className.
- Delegated click order (music.js:2338-2377): the widened artistCard branch runs before the
  download/queue/like branches and the `.music-song-row` play fall-through; the mutant-D run
  proves the row does not play. The panel's `.mnp-sub[data-artist]` branch (:1642-1645) returns
  before the `.mnp-queue-row` lookup.
- No em dashes in any added line (`git diff main...HEAD | grep '^+' | grep '—'` = empty). No
  "Safari" claim exists in the diff (the brief's example does not apply).
- Settle loops are fixed-count `await settle()` runs followed by hard asserts - none can time
  out green. The pop-out test goes through `documentPictureInPicture.requestWindow` ->
  `clickPopout` -> the real `createPopoutShell` engine and clicks the pip panel's
  `[data-skin-artist]` with the pip window's MouseEvent.

### Findings

1. **WARNING** - `public/js/music-skins.js:88-92` (`artistLine`) + `public/js/skin-surface.js:1017`
   + `public/js/podcasts.js:201`. **The podcast mobile skin's show line is now an INERT
   control on every skin.** `podcastSkinCtx` passes `track: { artist: showName, ... }` and the
   podcast engine config passes no `onArtist`; `artistLine` keys only on a non-empty artist, so
   the show name renders as `<button class="mms-sub"|"ip-artist" data-skin-artist title="Go to
   artist">` with `cursor: pointer` from the `:where()` reset, and the engine's branch
   `if (onArtist) onArtist(); return;` swallows the tap. VERIFIED by driving the real renderer
   with the podcast ctx shape in the sandbox: `apple/spotify/ipod/zune-classic podcast show
   line is the data-skin-artist button: true` (all four). Scenario: phone, podcast playing,
   mobile skin on -> the show name is a focusable pointer-cursor button whose tooltip says
   "Go to artist" and which does nothing (Tab reaches it too). This is the exact class D15
   rules a defect ("an inert visible control"), and it is a regression on a surface the build
   record never mentions (its "podcast byte-identical" proof covers only the DESKTOP
   `buildPanelHtml`, not the skin). The `onArtist` cfg doc ("Without it the line's tap does
   nothing (podcasts pass nothing)") describes the mechanism accurately and thereby documents
   the defect. No podcast test drives the mobile skin's show line, so nothing caught it.
   Prescription: make the hook's PRESENCE gate the control - the engine hands the renderer
   `Object.assign({}, getCtx(), { artistTap: !!onArtist })` at skin-surface.js:969 (the pop-out
   shell instantiates the same engine, so it follows) and `artistLine(cls, artist, on)` renders
   the button only when `on` is truthy, else the plain div (extend the "no focusable nothing"
   rule to "no hook = no control"). Bind it on BOTH axes: a podcast-nowplaying-view driven test
   (mobile skin on, `.mms-sub`/`.ip-artist` is a DIV with no `[data-skin-artist]`) and the
   existing music-skins every-skin test gaining `artistTap: true` in its ctx (so the music
   side still goes red when the button is dropped). Alternative (Dean's call): podcasts pass
   an `onArtist` that opens the show - then the tooltip must not say "artist".
2. **SUGGESTION** - `public/js/music.js:1310-1316` (`channelFolderCurrent`). After a re-init the
   `nowPlaying` carry is keyed by the LOADED id, but `effectiveCurrentId()` follows the
   watcher-advanced `::c` chapter; with an EMPTY queue at a chapter boundary (a grid tab after
   the drill closes) `reflectChapter` finds no queue entry, `nowPlaying.id` stays at the earlier
   chapter, and the row disappears for the rest of the file. This is parity with the panel's
   pre-existing posture (`deriveNowPlayingLabel` blanks on the same id mismatch, v1.237) and
   `watchBackVisible` has the same shape via `activeListenId`, so not a regression - but the
   folder is per-FILE, so comparing base ids (`String(id).replace(/::c\d+$/, '')`) in the
   nowPlaying fallback would make "Go to channel" robust where the label cannot be. Suspicion
   only for reachability (I did not drive it); no scenario built, so not a blocking finding.
3. **SUGGESTION** - reachability of the artist drill for a LISTEN track. `buildListenChapter
   Tracks`/the single listen track set `artist = channelName || folderName`; the projection is
   audio-only ("a VIDEO item is NEVER eligible", music-library-audio), so a video played via
   `?listen=1` from a channel with no projected audio opens an artist drill whose
   `/api/music?artist=<channel>` returns nothing: header + empty list. The "Go to channel" row
   is the right escape for that item and IS offered (D7 listen carry, driven test), so this is
   a UX rough edge, not a broken ask; consider hiding the artist line's hook when
   `item.listen` and no projected artist exists, or say so in the report.
4. **SUGGESTION** - plan doc counts (`Per-file changes`, Tests line): music-view is 1 adapted +
   5 new (the record says 2 adapted; only the v1.104 hunk changed); music-skin-integration is
   10 new (6 top-level + the 4-skin loop = 100 - 90; the record says 11). The `next:`
   frontmatter still reads "Next: commit, mutation-test ... then the gate" - stale now that all
   three are done; refresh it with the gate close. The design line `@ef42a6d4` is the stale
   tolerated shape (reported above, not a finding).
5. **SUGGESTION** - `public/js/skin-surface.js:45-47`: the new `onArtist()` cfg doc line is a
   TOP-LEVEL engine key but was inserted in the middle of the `sticker` sub-key list (between
   `channel` and `tray`, at the top-level indent). Move it up beside `onShuffle()` so the
   sticker block reads as one list.

### Security-brief (standing section)

No new network surface: no new fetch, route, header or endpoint. Data reaching the DOM: the
artist reaches `data-artist`/text through `escapeMusicHtml` (song rows, drill header),
`panelEscape` (desktop panel) and the skins' `esc` (all three escape `"`, and every attribute
is double-quoted); `durLabel` is derived from a Number; the `title` attributes are static
strings. Data reaching a URL: `folderName` -> `'/?folder=' + encodeURIComponent(folder)`, a
fixed same-origin path prefix handed to `FileTube.navigate` (fallback `location.href` with the
same encoded string) - no open-redirect shape. No shell, no eval, no temp files. The gating
disclosure ("cannot distinguish yt-dlp from local folders") is an authorization non-issue: the
target grid applies its own visibility rules server-side. Nothing here needs the security-brief
seat.

Gate: CHANGES r1 @35a3bb1d — qa (see findings)

## Gate r1 - adversary (@35a3bb1d)

Reviewed `feat/music-channel-chapters` HEAD 35a3bb1d against main 6ea45237, in the worktree
only. Instruments run by me (never restated): the seven touched suites at HEAD = 310 tests,
310 pass, 0 fail (music-actions-desktop 13, music-nowplaying-view 21, music-skin-integration
100, music-skins 38, music-view 44, podcast-nowplaying-view 24, skin-surface 70); `npm run
lint:css` TOTAL 0; `overlay-containment-lint --enforce` 0 violations; eslint 0 on the 11
touched files. Mutants ran in a `git archive HEAD` sandbox (removed after), one exact-string
edit each, landing verified exactly once. Verdict rests on the findings, not the tables.

### Verified (measured)

- Podcast byte-identity recomputed independently: `git show main:public/js/skin-surface.js`
  builder vs the branch builder on the test's fixture = identical (771 bytes) = the frozen
  EXPECTED; a no-subline fixture is identical too.
- `#audio-visual-folder` dead-branch claim holds: `AUDIO_PLAYER_MODE` has exactly two
  references in player.js (:2030 `var` literal, :8166 the read) - never reassigned, no pref.
- No nested interactive: the song row is a `div` (music.js:188); `.mms-head`/`.mms-meta`
  (music-skins.js:126/:137), `.ip-meta` (:165), `.mnp-meta` (skin-surface.js:1586) and
  `.music-drill-info` (music.js:400) are all `div`s around the new buttons.
- Escaping: every new interpolation goes through `esc` / `escapeMusicHtml` / `panelEscape`
  (`data-artist`, the button text); `data-skin-channel` and the `title` attrs are static.
  `encodeURIComponent` round-trips `A & B`, `#1 / two`, `x?y=z`, `Émilie ünicode` through
  `URLSearchParams.get('folder')` (main.js:1263 is the reader). Mutant R1 (drop the encoder)
  reds 3 tests.
- Cross-route: `isSameLocationNav` compares pathname+search (common.js:10769), so
  `/music...` -> `/?folder=` is never swallowed. `destroy()` (music.js:3099) never touches the
  player. NOTE: the "player keeps playing across the nav" acceptance is REASONED from those two
  reads - the test stubs `FileTube.navigate`, so the real router swap is not driven.
- CSS: the `:where()` reset is zero-specificity; every consumer line rule (style.css :10923
  `.mnp-sub`, :10549, :11321, :11342, :11418, :11558) outranks it, so per-skin font/colour/
  margin win. The only two `outline: none` rules (:925, :3389) are input rules, not these
  buttons; `.mms-sticker-menu ... :focus-visible` adds an outline. Keyboard Enter/Space is the
  native `<button>` activation (reasoned, jsdom does not synthesise it).
- Mutants killed by DISTINCT tests (label: suite pass/fail, killer): S3 seedNowPlayingFromPlayer
  carry 98/2 (re-init survive + source lock); S5 drop the nowPlaying fallback 99/1 (re-init);
  S7 listen single-track carry 99/1 (listen row); K2 drop `.trim()` 43/1 (pure unit); J1 the
  artist dispatch no longer `return`s (falls into row-play) 20/1 ("does NOT play the row");
  P1 `openArtistDrill` no-op body 95/5 + 20/1; E2 every panel row shows the CURRENT track's
  length 19/2; N1 `subArtist` -> '' 43/1 + 19/2; Q1 `onArtist` unwired 95/5; O1 engine
  `[data-skin-artist]` branch removed 95/5; F3 dur span for '' 43/1; R2 sticker row ignores
  `inMainDoc` 69/1; G1 channel row before Watch 99/1; L1 desktop row after Download 12/1; A1
  `artistLine` renders a div hook 37/1 (music-skins only - integration 100/0, a div still
  clicks in jsdom); M1 thumb `.mms-rd` dropped 37/1; Z1 `getCurrentMeta` drops `channelFolder`
  99/1 (the source lock only, as the builder disclosed).

### Findings

1. **WARNING - the PODCAST mobile skin ships an inert control.** `artistLine()`
   (public/js/music-skins.js:76-80) renders `<button data-skin-artist title="Go to artist">`
   for ANY non-empty artist, and podcasts render through the same `FileTubeMusicSkins`
   (public/js/podcasts.js:161, `track.artist = showName` :201) while passing no `onArtist`
   (skin-surface.js:1015 then does nothing). Measured by a driven podcast-skin boot
   (`/podcasts?show=s1`, narrow, play episode 0): the show line is
   `BUTTON class=mms-sub title="Go to artist" text="The Show"`; a bubbling click -> no
   navigation, zero DOM change. The repo's own standard (D15: "an inert visible control is a
   defect") applies; it is `cursor:pointer`, focusable, announced as a button, titled "Go to
   artist" - and the seam test only checks the DESKTOP podcast panel (`.mnp-sub` is a div), not
   the skin. Prescription: gate the button on a ctx flag the VIEW sets (music's buildSkinCtx
   `artistTap: true`; podcasts never), else the plain div; add a driven podcast-skin assertion
   that `.mms-sub`/`.ip-artist` is a DIV with no `data-skin-artist`.
2. **WARNING - a LISTEN VIDEO's artist line opens an empty drill that says "No music yet. Add
   a music folder in Settings".** Measured (integration harness, `?play=vid1&listen=1`,
   LISTEN_VIDEO, in-tab skin): tapping `[data-skin-artist]` fetches
   `/api/music?sort=release-newest&artist=The+Channel&limit=1000`, renders the artist drill with
   0 song rows, un-hides `#music-empty` (renderDrillView: `emptyNote.hidden = queue.length > 0`;
   the production copy is public/music.html:211-213), and paints the header + sticky thumb with
   `src="/albumart/"` (empty id: `first.id || ''`, music.js:383/:428 - a request the
   `/albumart/:id` route cannot match). A listen VIDEO is never in the music projection, so this
   is the outcome for every yt-dlp video whose channel has no projected audio - Dean's named
   "YouTube" case - on the skins, the pop-out AND the desktop panel `.mnp-sub` (same
   `openArtistDrill`). The diff implements D6b faithfully; the plan is what is wrong for
   listen tracks. Prescription (pick one, test it driven): for a `listen` track route the artist
   line to `channelTap()` (for a video the channel IS the artist), or hide the hook when
   `channelFolderOf(track)` is set and the track is a listen video; at minimum an artist-scoped
   empty state and no empty-id art request. Shippable-disclosed only if Dean accepts that the
   line tells him to add a music folder.
3. **WARNING - two D7 carry seams are LIVE and UNBOUND (the plan's "all four seams" claim
   overstates its bindings).** Against the committed suite: S1 reflectChapter `folderName ->
   ''` 100/0 + 21/0; S2 loadTrack `nowPlaying.folderName -> ''` 100/0 + 21/0; S4
   restoreListenChapterQueue 100/0 + 21/0; S8 buildListenChapterTracks `folderName -> ''`
   100/0 + 21/0; S6 drop the queue lookup in channelFolderCurrent 100/0 (every scenario is
   served by the OTHER source). They are not dead: `loadSongs` (music.js:1980) replaces `queue`
   on every in-Music drill load, so after the feature's OWN flow (tap the artist line -> drill)
   `channelFolderCurrent` misses the queue and reads `nowPlaying.folderName`. Repro ADV-A
   (`?play=c1`, tap `[data-skin-artist]`, settle, open the sticker): pristine = row present and
   navigates to `/?folder=The%20Channel%20Dir`; under S2 = 102/1 red (no row). Repro ADV-B
   (`?play=vid1&listen=1` with 3 `chapters`, loads `vid1::c0`, open the sticker): pristine =
   row present; under S8 = 102/1 red. S1 and S4 survived even those drives - they need a
   chapter advance / a listen re-init followed by a browse-away; live by the same mechanism,
   REASONED not measured. Prescription: add the two drives above; and collapse the four
   hand-copied `nowPlaying = { id, title, artist, album, albumKey, folderName }` literals into
   ONE `nowPlayingFrom(t)` writer (the INERT SIBLING class) so a seam cannot drop the field.
4. SUGGESTION - `channelFolderOf`'s `listen === true` arm and `'library-chapter'` arm are
   mutually redundant in every driven scenario (K1 and K3 each survive music-skin-integration
   100/0; only the pure unit kills them) because listen chapters carry both. No driven test
   plays a NON-listen `::c` chapter of a projected file (the chaptered album Dean named) and
   asserts the row - add one (CH_TRACK-shaped `::c` rows, `source: 'library-chapter'`).
5. SUGGESTION (suspicion, not measured - no browser here) - `applyMarquee`
   (skin-surface.js:861-877) now measures `scrollWidth - clientWidth` on a `<button>`; engines
   differ on overflow/scroll metrics for button elements (Firefox historically ignores
   `overflow` on buttons). Check on device that a long channel name still ellipsizes/marquees
   on the Apple and iPod lines.
6. SUGGESTION - the desktop actions-menu wiring (`hasChannel: channelVisible` /
   `onChannel: channelTap`, music.js:1364-1365) is bound only by a source regex; the factory is
   driven with a stub cfg. Same posture as the existing Watch wiring, so not blocking.

Tree after review: byte-identical to 35a3bb1d apart from this plan doc (the qa seat's section
above and this one); sandbox `/tmp/adv-m1m2-SF70` removed; no untracked files added.

Gate: CHANGES r1 @35a3bb1d — adversary (see findings)

## r1 fix record (M1+M2)

Fixes against both r1 sections (@35a3bb1d). Each line: finding -> change -> binding test ->
mutant result (the mutants ran after the fix commit, in a sandbox from `git archive` of that
committed sha; results in the table below).

### MUST

1. **The podcast skin's inert "Go to artist" button (qa 1 + adversary 1).** Change: the
   engine (`public/js/skin-surface.js` `paint`) hands the renderer
   `artistTap: !!onArtist && ctx.artistTap !== false`; `artistLine(cls, artist, on)`
   (`public/js/music-skins.js`) renders the button only when `on`, else the plain div with the
   name. Podcasts pass no `onArtist`, so their show line is a div on every skin (the pop-out
   shell instantiates the same engine, so it follows). Cfg doc moved beside `onShuffle()` and
   states the presence rule + the per-track veto. Bindings: podcast-nowplaying-view "gate r1
   W1 (apple / spotify / ipod / zune-classic)" (driven podcast boot per skin: the show line is a
   DIV, no `[data-skin-artist]`, no "Go to artist", a click changes nothing / fetches nothing /
   loads nothing); music-skins "WITHOUT artistTap ... plain div" (every skin, no flag and
   `false`); the music axis keeps the existing driven in-tab x4 + pop-out artist-drill taps
   (music's engine has `onArtist`, so the button renders and calls it) and the every-skin
   render test now passes `artistTap: true`.
2. **A listen video's artist tap opened an EMPTY drill (adversary 2, qa 3).** Architect
   decision applied: the view decides per track (`artistTapMode()` in `public/js/music.js`):
   a normal track -> the artist drill; a LISTEN track with a channel folder -> `channelTap()`
   (the channel grid); a listen track without one -> not a control (`artistTapAvailable()`
   false: the skin ctx carries `artistTap: false`, the desktop panel builder gets
   `artistTap: false` and renders the plain `.mnp-sub` div). `buildDrillHeaderHtml` /
   `buildStickyBarHtml` never emit `/albumart/` with an empty id (a srcless, unshimmered slot).
   Bindings (driven through the REAL listen path: `?play=vid1&listen=1` -> `playListenItem`
   -> the `/api/videos` body, never a hand-typed id): music-skin-integration "gate r1 W2
   in-tab: a LISTEN video's artist line navigates to /?folder=" (navigate once, no
   `artist=` fetch, no `/albumart/` empty-id request, no drill, `#music-empty` stays hidden),
   "gate r1 W2 in-tab: ... NO channel folder renders ... a plain div", "gate r1 W2 desktop
   panel" (both arms on `.mnp-sub`); music-view "an EMPTY drill never requests /albumart/"
   and "honours the view's veto".
3. **Four hand-copied `nowPlaying` literals; D7 carry seams live and unbound (adversary 3).**
   Change: ONE writer `nowPlayingFrom(t, id)` (exported) builds the record at all four seams
   (loadTrack, reflectChapter, restoreListenChapterQueue, seedNowPlayingFromPlayer - the seed
   passes the player meta, whose string `channelFolder` wins over re-deriving). And
   `channelFolderCurrent()` now reads the nowPlaying record ALONE: the queue-entry lookup that
   ran first answered identically on every production path (the only music loader is
   loadTrack, which writes the record from the same item it loads; that is why S6 survived
   every drive), so it is removed rather than kept as a second source that could drift.
   Bindings: music-view "nowPlayingFrom is the ONE writer" (queue entry derives, meta carries,
   explicit '' honoured, id override, null-safe) and the census "music.js builds nowPlaying
   ONLY through nowPlayingFrom" (comments stripped once at read; no `nowPlaying = {` literal,
   no Object.assign-built record, every assignment is `null` or `nowPlayingFrom(...)`, exactly
   4 writer sites, ONE function); music-skin-integration drives per seam: ADV-A (load seam:
   artist drill replaces the queue, the row survives), ADV-B (buildListenChapterTracks carry:
   `vid1::c0` load data + row), S1 (chapter-cross seam: a chaptered listen video rolls into
   chapter two via timeupdate, a Songs-tab browse replaces the queue, the row survives), S4
   (restore seam: dock-return re-init with a meta that carries NO folder, so only the restore
   can serve it; Songs browse; the row survives), and the existing re-init test (seed seam).
   The seed source lock now asserts `nowPlaying = nowPlayingFrom(meta);` inside the seed
   function (tempered span) plus the writer's `channelFolder` precedence.

### SHOULD

- **Driven non-listen `::c` chapter row (adversary 4, qa).** music-skin-integration "gate r1
  adversary finding 4 (+ qa): a NON-listen ::c chapter of a projected file (source
  library-chapter)" - `?play=f9::c1`, no listen flag, the row navigates to `/?folder=Chan%20Dir`.
- **Base-id compare in channelFolderCurrent (qa 2).** Done as `sameMusicItem(a, b)`: exact id,
  or two `::c` CHAPTER ids of the same base. A non-chapter live id must match exactly, so the
  same file live as a RAW video beside a `::c` record never borrows the music row (the
  effectiveCurrentId W2 posture). DISCLOSED: not reachable by any drive I could build -
  currentChapterId only advances to chapters present in `queue`, and reflectChapter then
  rewrites the record from that same entry, so the record and the effective id stay equal on
  every path found; the chapter-base arm is defensive (its mutant is recorded below).
- **Desktop actions-menu wiring (adversary 6).** music-skin-integration "gate r1 adversary
  finding 6": the real music.js wiring renders `[data-skin-x="channel"]` in
  `#music-actions-menu` for a library track and its click navigates + closes the menu.
- **Cfg doc placement (qa 5).** Moved beside `onShuffle()` (top-level keys), with the veto line.
- **Build-record counts (qa 4).** Corrected above (music-view 1 adapted + 5 new;
  music-skin-integration 10 new). `next:` refreshed.
- Not changed: adversary 5 (marquee on a `<button>` in Firefox/iOS) is a device check, owed to
  Dean with the release; the listen artist line on a channel-folder video is now a channel
  link, so a long channel name there rides the same marquee.

### Targeted suites at the fix commit (Node v22.23.1, tests/pass/fail)

music-view 48/48/0 · music-nowplaying-view 21/21/0 · music-skins 39/39/0 ·
music-skin-integration 109/109/0 · music-actions-desktop 13/13/0 ·
podcast-nowplaying-view 28/28/0 · skin-surface 70/70/0. Every test file that reads
music.js / music-skins.js / skin-surface.js (42 files) in one run: `# tests 732`,
`# pass 732`, `# fail 0`. eslint on the 7 touched files: 0 problems. Full `npm test` not run
(the pre-commit hook runs the unit suite).

### Mutation results (r1 fix)

Run in a sandbox from `git archive 850f4e4a` (the fix commit; node_modules symlinked, the
live tree never edited), unmutated baseline first: 9 suites (music-view,
music-nowplaying-view, music-skins, music-skin-integration, music-actions-desktop,
podcast-nowplaying-view, skin-surface, listen-chapter-dock-return, music-chapter-reflect)
= 364 tests, 364 pass, 0 fail. Each mutant is ONE exact-string edit verified to land exactly
once, the same 9 suites, then the file restored and compared byte-for-byte to the archive
(`restored=True` on all 20). The seam mutants S1-S4 are written CENSUS-INVISIBLE (the record
is still built by `nowPlayingFrom`, then its folder is blanked) so only the driven test can
kill them; S1-lit / W3-census show the census on its own. The adversary's old S6 (drop the
queue lookup) no longer exists - the lookup is gone; S6 here is its inverse (the record
replaced by a queue-only lookup), which proves the record is the load-bearing source.

| # | Mutant | tests/pass/fail | Killed by |
|---|--------|-----------------|-----------|
| S1 | reflectChapter seam blanks the folder | 364/363/1 | integration "gate r1 S1 (the reflectChapter seam)" |
| S1-lit | reflectChapter seam back to a literal without the folder | 364/362/2 | music-view census; integration S1 |
| S2 | loadTrack seam blanks the folder | 364/356/8 | integration: M1 positive, D7 listen, W2 in-tab, W2 desktop, ADV-A, ADV-B, finding 4, finding 6 |
| S3 | seed seam blanks the folder | 364/363/1 | integration D7 "SURVIVES the dock-return re-init" |
| S4 | restoreListenChapterQueue seam blanks the folder | 364/363/1 | integration "gate r1 S4 (the restoreListenChapterQueue seam)" |
| S6 | channelFolderCurrent reads a queue-only lookup instead of the record | 364/360/4 | integration: D7 re-init, ADV-A, S1, S4 |
| S8 | buildListenChapterTracks drops folderName | 364/361/3 | integration: ADV-B, S1, S4 |
| W3-carry | nowPlayingFrom ignores the meta `channelFolder` | 364/361/3 | music-view nowPlayingFrom unit; integration D7 re-init + source lock |
| W3-census | seed back to an EQUIVALENT hand-copied literal | 364/362/2 | music-view census; integration seed source lock |
| W1-presence | engine drops the `!!onArtist` gate | 364/360/4 | podcast-nowplaying-view W1 x4 skins |
| W1-render | `artistLine` ignores `on` | 364/358/6 | music-skins "WITHOUT artistTap"; integration W2 no-folder; podcast W1 x4 |
| W1-veto | engine drops the view veto | 364/363/1 | integration W2 in-tab no-folder |
| W2-mode | a listen track drills again | 364/361/3 | integration W2 in-tab (both arms) + W2 desktop |
| W2-avail | `artistTapAvailable` always true | 364/362/2 | integration W2 in-tab no-folder + W2 desktop |
| W2-builder | the panel builder ignores the veto | 364/362/2 | music-view veto unit; integration W2 desktop |
| W2-panel | updateNowPlayingPanel passes no veto | 364/363/1 | integration W2 desktop |
| W2-hdr-art | the drill header requests `/albumart/` with an empty id | 364/363/1 | music-view empty-drill unit |
| W2-sticky-art | the sticky bar requests `/albumart/` with an empty id | 364/363/1 | music-view empty-drill unit |
| QA2-base | `sameMusicItem` loses the chapter-base arm | 364/364/0 SURVIVED | none - disclosed above: no production path found where the record and the effective id differ by chapter |
| QA2-raw | `sameMusicItem` lets a raw id match a `::c` record | 364/364/0 SURVIVED | none - defensive (a raw non-music load unmounts the music skin); not driven |

18 of 20 killed; the 2 survivors are the two arms of the qa-2 SHOULD, both disclosed as
defensive / not reachable by any drive found. Sandbox removed after the run.

## Gate r2 - qa M1+M2 (@1ac34548)

Delta re-confirmation of `git diff 35a3bb1d 1ac34548` (fix commits 850f4e4a + 1ac34548; code:
music.js, music-skins.js, skin-surface.js) against both r1 sections and "## r1 fix record
(M1+M2)". VERIFIED = I ran it at 1ac34548 in the worktree (Node v22.23.1); probes ran from a
copy of music-skin-integration.test.js in the session scratchpad (the tree never edited).

### Instruments (verbatim)

- `node --test test/unit/<f>.test.js`: music-view `# tests 48 # pass 48 # fail 0` ·
  music-nowplaying-view `21/21/0` · music-skins `39/39/0` · music-skin-integration `109/109/0` ·
  music-actions-desktop `13/13/0` · podcast-nowplaying-view `28/28/0` · skin-surface `70/70/0`.
- Every test/unit file naming music.js / music-skins.js / skin-surface.js (49 files, one run):
  `# tests 827`, `# pass 827`, `# fail 0`, `# cancelled 0`, `# skipped 0`, exit 0.
- eslint on the 11 touched js/test files: no output, exit 0. `npm run lint:css`: `TOTAL 0`.
  `overlay-containment-lint --enforce`: `clean (0 violations)`.
- `bash .harness/lib/check-markers.sh`: `✗ ...music-channel-chapters-wave.md: stale approval
  @ef42a6d4 - reviewed code changed since; re-gate` / `check-markers: 1 issue(s) found`, exit 1
  (the tolerated Building shape, unchanged from r1).
- Docs censuses (comment-debt, docs-link, docs-status, tech-debt, dockerfile-ships-scripts):
  `12/12/0`; docs-diagrams-census `5/5/0`. Full `npm test` NOT run.
- Mutants NOT re-run by me (the Adversary's seat); the fix record's table is taken as reported.

### r1 findings - status at 1ac34548

- qa 1 / adversary 1 (podcast inert artist button): FIXED as prescribed. VERIFIED: main's
  (14088c92) `renderFull` vs the branch's on a podcast ctx (engine gives `artistTap:false`):
  apple, ipod, ipod-black, ipod-matte, zune-classic byte-identical; the show line is the plain
  div. Driven podcast W1 x4 tests pass.
- qa 2 (base-id compare): done as `sameMusicItem`; see the QA2 call below.
- qa 3 / adversary 2 (listen video -> empty drill): FIXED on the direct path (W2 tests pass),
  NOT closed on the chaptered path - finding W1 below.
- qa 4 (counts, `next:`), qa 5 (cfg doc placement): FIXED.
- adversary 3 (seams + one writer): FIXED. `nowPlayingFrom` is the only writer (census reads
  4 writer sites; I grepped: loadTrack :2518, reflectChapter :1151, seed :2728, restore :2900).
  The queue-lookup removal in `channelFolderCurrent`: REASONED equivalent - every
  `nowPlaying = null` site (afterExtrasMutation, the emptied listener, a restore miss) is one
  where the old lookup also returned '' (player closed / id not in queue), and the seed's meta
  `channelFolder` is the same `channelFolderOf(item)` loadTrack derived. Accepted.
- adversary 4 (non-listen `::c` drive), 6 (desktop menu drive): FIXED (tests present, green).
  adversary 5 (marquee on a button): device check owed, disclosed. Accepted.
- Podcast desktop panel byte lock: holds (podcast-nowplaying-view green; rows carry no durLabel).

### Findings

1. **WARNING - r1 W2 re-struck: a CHAPTERED listen video still opens the empty "No music yet"
   drill after a chapter cross + a browse.** `public/js/music.js:1391-1394` (`artistTapMode`
   decides "listen" via `watchBackVisible()`) + `:1322-1328` (its fallback is
   `id === activeListenId`, and `activeListenId` holds the LOADED chapter, `vid1::c0`, while
   `effectiveCurrentId()` is the crossed chapter). VERIFIED (probe, the S1 test's own shape:
   `?play=vid1&listen=1` with CHAPTERED_LISTEN, `currentTime=350` + timeupdate, Songs tab, tap
   `[data-skin-artist]`): `navs: []`, fetch `/api/music?sort=release-newest&artist=The+Channel
   &limit=1000`, drill header rendered, `#music-empty hidden: false`; the same probe shows the
   sticker has `watch row: false channel row: true` (the Watch row loss is PRE-EXISTING, same
   root). Scenario: Dean listens to a chaptered YouTube mix, it rolls into chapter 2, he browses
   Songs, taps the channel name -> an empty artist drill telling him to add a music folder.
   Prescription: make the listen test chapter-aware, e.g. the watchBackVisible fallback
   `activeListenId && sameMusicItem(id, activeListenId)` (fixes the tap, the panel `.mnp-sub`
   and the Watch row together, and gives sameMusicItem's chapter arm a REAL caller); bind with
   the probe's drive (tap navigates `/?folder=The%20Channel`, no `artist=` fetch, Watch row
   present) and a mutant back to `===`.
2. **WARNING - NEW in the fix: in the desktop POP-OUT, a listen video's artist line navigates
   the main window and the pop-out closes.** `public/js/music.js:998` (`onArtist: artistTap`,
   "both surfaces") routes the listen `channel` mode through `channelTap()` from the pip
   engine; the router's cross-view swap calls `destroy()` (common.js :10573), which tears the
   pop-out down (music.js destroy, `activePopoutTeardown`). VERIFIED (probe: desktop,
   `?play=vid1&listen=1`, ipod pop-out via documentPictureInPicture, navigate stubbed to record
   + call `mod.destroy()` as the router does): the pip line is `<button class="ip-artist"
   data-skin-artist title="Go to artist">The Channel</button>`, the pip sticker shows
   `channel row: false watch row: false` (the main-document-only posture), and the artist tap
   gives `navs ["/?folder=The%20Channel"]`, `pip.closed= true`. This contradicts the plan's own
   rule for the channel/Watch rows ("a pop-out row must not navigate the window behind it") via
   a side door, and the r1 pop-out test's "the pop-out stays open" holds only for the drill
   mode. Prescription: in the pop-out instance (`winRef !== window`) the `channel` mode is not
   a control (artistTap false there; drill mode unchanged), bound by a pop-out listen test; or
   Dean explicitly accepts navigate-and-close and the plan says so.
3. **WARNING (safe to ship DISCLOSED, r1-era, missed by both r1 seats incl. me) - the podcast
   Nordic skin render changed.** `public/js/music-skins.js:104-107` adds `.mms-rd` to every
   thumb row, and podcasts' ctx rows carry `durLabel: skinDur(...)` (podcasts.js:191).
   VERIFIED: main vs branch `renderFull('spotify', podcastCtx)` differ (2289 vs 2354 bytes):
   `...The Show</span></span><span class="mms-rd">41:05</span></button>`; an episode with no
   duration shows `0:00` (skinDur(0)); music's Nordic rows likewise show `0:00` for a 0-length
   row (mmssMusic), unlike M2's desktop "0 = no span" rule. D8 says "podcasts unaffected" and the
   byte proof covers only the desktop panel. My argument for shipping it disclosed: the lengths
   are real, the iPod list already shows the same labels for podcasts. Required either way:
   the plan records it (D8 / the proof paragraph) and a podcast test pins the chosen bytes.
4. SUGGESTION - stale/lying comments: `music.js:1351-1355` states the chapter arm keeps the row
   "after a re-init with an empty queue (the watcher advances effectiveCurrentId...)" - it
   cannot: `currentChapterId` returns `chapterViewId` when the queue holds no chapters
   (:1095), which is exactly why QA2-base survives; `music.js:1705-1706` and
   `music-skins.js:24` ("the in-Music artist drill") and skin-surface's buildPanelHtml doc
   ("opens the artist drill") predate the listen->channel routing; the plan's build record
   (the "Go to channel" gating paragraph) still describes the removed queue-entry lookup, and
   D6b / acceptance M1a are not amended for the listen decision.
5. SUGGESTION (suspicion, not browser-measured) - the srcless empty-drill slot keeps
   `alt="<title>"` (`music.js:426`), and browsers paint an img's alt text when it has no src:
   the artist name would print inside the art box. `alt=""` avoids it. And the button's
   `title="Go to artist"` now leads to the channel grid for a listen track.

### QA2-base / QA2-raw call

Not acceptable as shipped: an arm with no reachable caller plus a comment claiming a
mechanism that does not occur is the INERT FEATURE shape. Either (a) take finding 1's fix,
which gives the chapter arm a real, driven caller (then QA2-base must go red), or (b) revert
`channelFolderCurrent` to the exact-id compare and delete the comment. QA2-raw ("a raw id
must not match a `::c` record") is the original exact-match behaviour and is fine as a guard
once (a) or (b) lands.

### Security (standing)

No new surface in the delta: no fetch, route or header added; `channelTap` still builds
`'/?folder=' + encodeURIComponent(folder)`, a fixed same-origin prefix (no open redirect, no
injection into the path; the reader is URLSearchParams). DOM: the new div branch of
`artistLine` escapes through `esc`, the srcless img's alt through `escapeMusicHtml`,
`data-artist` through `panelEscape`; `artistTap` is a boolean. Finding 2 is a UX/posture
issue, not a security one (same-origin SPA nav).

Tree: byte-identical to 1ac34548 apart from this section; no untracked files added.

Gate: CHANGES r2 @1ac34548 — qa

## Gate r2 - adversary M1+M2 (@1ac34548)

Fresh instance, delta `35a3bb1d..1ac34548`, the worktree read-only. Instruments run by me: the
builder's 9 suites at 1ac34548 in a sandbox from `git archive 1ac34548` (node_modules
symlinked) = 364 tests, 364 pass, 0 fail (Node v22.23.1); eslint on the 3 touched sources + 4
touched tests = 0 problems. 37 mutants, one exact-string edit each, landing verified exactly
once, restored and sha-compared after each (all restored); the sandbox was diffed against a
fresh archive (identical) and removed.

### r1 findings at 1ac34548

- W1 (podcast skin inert button): FIXED as prescribed. W1-presence 360/4 (podcast W1 x4, a real
  `/podcasts?show=s1` boot per skin), W1-render 358/6, W1-veto 363/1, and my own X-div-noname
  (the div drops the name) 357/7.
- W2 (listen video empty drill): FIXED DIFFERENTLY (listen + folder -> `channelTap`, listen
  without -> plain div, no empty-id `/albumart/`). Deviation evaluated: better than my
  prescription. Driven through the real `?play=vid1&listen=1` -> `/api/videos` shape. W2-mode
  361/3, W2-avail 362/2, W2-builder 362/2, W2-panel 363/1, W2-hdr-art 363/1, W2-sticky-art
  363/1; mine: X-tap-channel-drills 362/2, X-onArtist-drill 363/1, X-panel-drill 363/1,
  X-ctx-veto-view 363/1, X-hdr-art-empty-shimmer 363/1.
- W3 (four literals, unbound seams): FIXED as prescribed. S1 363/1, S1-lit 362/2, S2 356/8,
  S3 363/1, S4 363/1, S6 (inverse) 360/4, S8 361/3, W3-carry 361/3, W3-census 362/2; my r1 S7
  (single listen track carry) 361/3. ADV-A and ADV-B are driven (killed under S2 / S8).
- r1 finding 4: FIXED (K3 now 362/2 incl. the driven non-listen `::c` test). K1 (`listen ===
  true` arm) still unit-only 363/1: every production listen track also carries `source`, so
  the arm is redundant, as disclosed at r1. Finding 6: FIXED (F6 `hasChannel` stub 362/2, F6b
  `onChannel` no-op 362/2, both via the real music.js wiring). Finding 5: device check, owed.
- The builder's 20-mutant table reproduces EXACTLY (every count identical, QA2-base and QA2-raw
  364/0 survivors).

### Findings

1. **WARNING (new; the (a) claim is refuted) - a player ADOPT never receives
   `channelFolder`, so after any re-init "Go to channel" vanishes and the Listen artist line
   goes dead for the organic Watch -> Listen path.** Primary source: player.js `isAdoptLoad`
   (:115) is true when the requested id equals the loaded one and the state is not closed;
   `load()`'s adopt branch (:8575-8603) keeps `currentData` and refreshes only `browseCtx` +
   `applyAdoptFlavor` (readerHref/resumeMode); `nextPlayerState` (:183-188) docks, never closes,
   on watch -> music. So the watch page's Listen button (watch.js :3682, `?play=<id>&listen=1`
   for the SAME id the player holds) ADOPTS: `getCurrentMeta().channelFolder` stays `''`
   (watch.js :1702 never declares it) while `isMusic` flips true. In-session the loadTrack
   record is right; the first re-init seeds from the meta and the folder is gone. The fix
   record's premise ("loadTrack ... writes nowPlaying from the same item it loads") is false for
   the player side of that pair, and every existing test uses a mock whose `load` always
   replaces the meta (never adopts). Repro (a scratch copy of music-skin-integration with a
   player mock driving the REAL `isAdoptLoad`/`applyAdoptFlavor` exported by player.js,
   pre-loaded with the watch.js :1702 data for `vid1`): boot `?play=vid1&listen=1` (adopt=true,
   row + `[data-skin-artist]` present) -> destroy -> init at `/music?nowplaying=1` (the dock
   return) or `/music` (a soft nav back): meta `channelFolder:""`, Watch row present, NO "Go to
   channel" row, artist line `<div class="mms-sub">The Channel</div>` (artistTapMode 'none').
   Red at 1ac34548 AND at 35a3bb1d (missed by both r1 seats); control with no pre-load (a
   genuine load) green. A second drive shows the queue-lookup REMOVAL regressed a sibling: the
   player holding audio `c1` from a watch load, `/music?play=c1` adopts, re-init on the Songs
   tab (queue re-fetched WITH `c1`): r1 music.js GREEN (the queue lookup served it), 1ac34548
   RED. So the record and the queue entry DO diverge (an adopted meta). Prescription (one carry
   fixes both): make the adopt honour the carry under the declared-field contract
   (`applyAdoptFlavor` also refreshes `channelFolder` when the load data declares it; music
   always declares it, watch.js never does), bind it with a player-state unit on
   `applyAdoptFlavor` AND a music-skin-integration drive with an adopting mock built on the real
   exported pair (Watch -> Listen -> dock-return: the row and the control survive). Note
   `albumKey` has the same adopt blind spot (pre-existing, out of scope).
2. **SUGGESTION - (b) `sameMusicItem`'s chapter-base arm is dead code under a false comment;
   remove it.** QA2-base / QA2-raw 364/0 reproduce, and my X-noid (drop the whole
   `sameMusicItem` check) and X-np-id-guard also survive 364/0. Reasoned unreachability
   (not measured): every write of `chapterViewId` pairs with a `nowPlaying` write of the same id
   or null (loadTrack, seed, restore, emptied, afterExtrasMutation), and `reflectChapter` always
   finds `t` because `currentChapterId` draws from the same `queue` synchronously; with no
   chapters in `queue` it returns `chapterViewId` unchanged. The comment's mechanism ("the
   watcher advances effectiveCurrentId while nowPlaying stays at the loaded chapter" on an empty
   queue) does not exist. The only `::c` loads in the client are music's (common.js :4226 is a
   URL into music). Replace with an exact `nowPlaying.id === id` compare (the raw-vs-`::c` case
   is then false for free) and drop the comment, or drive a path; an unbound id guard is at
   least honest if it is the simplest one.
3. **SUGGESTION - `nowPlayingFrom`'s `id` override is a dead parameter.** Both callers pass an
   id equal to `t.id` (reflectChapter and restore find `t` BY that id); X-idoverride is killed
   only by the pure unit (363/1). Drop it or keep it disclosed.
4. **SUGGESTION - the Listen artist button is titled "Go to artist" but navigates to the
   channel grid** (measured on the listen skin line: `title="Go to artist"`). Title it per mode.
5. (d) census, measured: it catches a reassigned literal, `nowPlaying = Object.assign(...)`
   (X-census-spread 361/3) and a 5th writer (X-census-5th 363/1); it does NOT catch property
   writes (S1-S4 are written that way) or `Object.assign(nowPlaying, {...})` (X-census-assign:
   census green, killed only by the driven re-init test 363/1). The driven seam tests are the
   binding; the census is a literal-shape tripwire. Acceptable as is; no finding.

Shell parity: no `public/*.html` change in the delta; the only new top-level name is
`nowPlayingFrom` (music.js, unique across public/). No parity exposure.

Tree: byte-identical to 1ac34548 apart from this plan doc (the qa r2 section above, not mine,
and this section); sandboxes removed; no untracked files.

Gate: CHANGES r2 @1ac34548 — adversary

## r2 fix record (M1+M2)

Fixes against both r2 sections (@1ac34548), round 3 approved by Dean with two product rulings
(the pop-out listen line is plain text; a 0/unknown Nordic length is blank). Each item:
finding -> change -> binding test -> mutant result (table below). The mutants ran BEFORE the
commit on the STAGED tree (`git write-tree` = f11d989d, extracted with `git archive` into the
session scratchpad, node_modules symlinked); the plan doc was re-staged afterwards and
`git diff --cached f11d989d -- public test lib` is empty, so the committed code and tests are
byte-identical to the mutated snapshot.

### WARNINGS

1. **qa W1 - a chaptered listen video opened the EMPTY drill after a chapter cross + a browse.**
   Change (`public/js/music.js`): `watchBackVisible`'s marker fallback is
   `!!activeListenId && sameMusicItem(id, activeListenId)` (any chapter of the listen file
   matches the LOADED-chapter marker), which fixes the artist tap, the desktop `.mnp-sub` and the
   Watch row together. The one other reader of the marker, the skin cover's listen-art fallback
   in `buildSkinCtx`, had the same exact compare and also built `/thumbnail/<vid>::c<n>` (no
   media id, the placeholder SVG): it now uses `sameMusicItem` and the BASE video id. With that,
   `sameMusicItem`'s chapter arm has a real driven caller; `channelFolderCurrent` no longer uses
   it (adversary S2): its compare is the exact `nowPlaying.id !== id`, since every seam that
   moves the effective id rewrites the record with that same id. Stale comments fixed: the
   channelFolderCurrent / sameMusicItem block, the panel click comment, the music-skins header
   hook line and the artistLine note, the skin-surface `onArtist` cfg doc and the
   `buildPanelHtml` doc; the build record's "Go to channel" gating paragraph (it described the
   removed queue lookup), D6b and acceptance M1/M1a are amended for the listen decision.
   Bindings (music-skin-integration, qa's drive: the REAL `?play=vid1&listen=1` -> `/api/videos`
   path with CHAPTERED_LISTEN, `currentTime=350` + timeupdate, then the Songs tab): "gate r2 qa
   W1: a CHAPTERED listen video rolled into chapter two, then a Songs browse" (tap navigates
   `/?folder=The%20Channel`, no `artist=` fetch, no drill header, `#music-empty` untouched; the
   Watch row renders; a skin pick repaints and the cover is `/thumbnail/vid1`; Watch goes to
   `/watch.html?v=vid1`) and "gate r2 qa W1: the DESKTOP panel line ..." (the `.mnp-sub` tap
   navigates to the channel grid). Mutants R2-W1 (back to `===`) and R2-W1-base (the chapter arm
   removed, the old QA2-base) are now KILLED.
2. **qa W2 - the desktop pop-out's listen artist line navigated the main window and closed the
   pop-out.** Dean's ruling applied: in the pop-out instance (`winRef !== window` in
   `skinEngineConfig`) a listen track's line is plain text. `artistTapMode(popout)` returns
   'none' for a listen track there (a normal track keeps its pop-out drill, which renders in the
   main document and leaves the pop-out open); `buildSkinCtx(ci, popout)` carries the veto, and
   the pop-out's `onArtist` re-checks with the same flag. Binding: music-skin-integration "gate
   r2 qa W2: in the desktop POP-OUT a LISTEN video's artist line is plain text" (desktop,
   `?play=vid1&listen=1`, ipod pop-out through documentPictureInPicture, navigate stubbed to
   record AND call `destroy()` as the router does: the main panel line is the channel control,
   the pop-out `.ip-artist` is a DIV with no `[data-skin-artist]`, a click navigates nothing, no
   drill, the pop-out stays open). Mutants R2-W2 / R2-W2-flag KILLED; R2-W2-order (the pop-out
   veto ahead of the drill check) KILLED by the existing pop-out drill test.
3. **adversary W1 - a player ADOPT never received `channelFolder`.** Change
   (`public/js/player.js`): `applyAdoptFlavor` also refreshes `channelFolder` under the same
   declared-field contract (music's `loadTrack` always declares it as a string, `''` = no
   channel; watch.js never declares it, so a Listen -> Watch adopt leaves it and its
   `resumeMode: null` ends `isMusic`). Bindings: player-state "applyAdoptFlavor (v1.317 gate r2,
   adversary W1): a declared channelFolder REPLACES the watch load's absent one" (the watch-shaped
   current data + music's declared folder; a declared `''` clears; omitted leaves; a non-string
   clears), and two music-skin-integration drives on an `adoptingPlayer` mock whose `load` runs
   the REAL exported `isAdoptLoad` and `applyAdoptFlavor` (the adopt branch's two calls; genuine
   loads replace the held data like the facade): "gate r2 adversary W1: Watch -> Listen ADOPTS
   ..." (pre-loaded with watch.js's load shape for `vid1`, boot `?play=vid1&listen=1` asserts the
   load ADOPTED, then re-inits at `/music?nowplaying=1` and `/music`: Watch row, "Go to channel"
   and the artist-line channel control all present and navigating) and "(second drive)" (the
   watch page's audio `c1`, `/music?play=c1` adopts, re-init, Songs re-fetches the queue WITH
   `c1`, the row survives). Mutant R2-adopt (drop the refresh) KILLED by all three;
   R2-adopt-clear (a declared `''` keeps the stale folder) KILLED by the unit.
4. **qa W3 - the podcast Nordic rows changed.** Dean's ruling applied: a 0/unknown length is
   BLANK on the Nordic thumb rows (no span), for podcasts and music alike, matching M2's desktop
   rule. Change (`public/js/music-skins.js`): `knownDurLabel` treats an all-zero label as
   unknown (both producers format 0 s as `0:00`: podcasts `skinDur`, music `mmssMusic`), and the
   thumb row renders `.mms-rd` only for a known length. The iPod list rows are unchanged
   (out of scope; the unit pins that). D8 and acceptance M2 are amended: the podcast DESKTOP
   panel is byte-identical (the r1 lock stands), the shared Nordic rows now show a podcast
   episode's length. Bindings: podcast-nowplaying-view "gate r2 qa W3: the podcast Nordic skin
   rows show an episode's length, and NO length span for an episode without one" (a driven
   podcast boot on the Nordic skin: `41:05` for 2465 s; no span for a missing and for a 0
   duration); music-skins "gate r2 (qa W3, Dean's ruling)" (known, `0:00`, `''`, absent,
   `1:02:05`); music-skin-integration "gate r2 qa W3: a chaptered listen video with an UNKNOWN
   file duration" (the last chapter's 0 span renders no span). Mutants R2-W3 and R2-W3-span
   KILLED.

### SUGGESTIONS taken

- adversary S3: `nowPlayingFrom(t)` lost its dead `id` parameter (both callers passed `t.id`);
  the music-view unit now asserts a second argument is ignored.
- adversary S4 / qa S5 (title): the artist control's tooltip names its target. The view passes
  `artistTitle` ("Go to channel" in channel mode, else the renderers' "Go to artist") to the
  skins (`artistLine` gained a `title` argument) and `subArtistTitle` to `buildPanelHtml`
  (optional, so the podcast desktop panel stays byte-identical). Bindings: music-skins "gate r2
  S4" (every skin, title and default), music-view "gate r2 S4" (the panel wrapper), and the
  title assertions in both qa W1 drives. Mutants S4-skin, S4-view, S4-panel, S4-wrapper KILLED.
- qa S5 (alt): the srcless empty-drill slot is `alt=""` (a srcless img paints its alt text); the
  drill title still carries the name. music-view's empty-drill unit pins it; mutant S5 KILLED.

### Known seams (disclosed)

- `albumKey` has the same adopt blind spot as `channelFolder` had (pre-existing, out of scope):
  tracked as tech-debt #237.
- `sameMusicItem`'s raw-vs-`::c` restriction (R2-W1-raw) survives: a raw live id beside a `::c`
  listen marker needs the watch page to have loaded the raw video, and music's surfaces that
  read the listen test (the skin, the desktop panel, the expanded actions menu) do not render
  for a non-music item. Kept as the conservative direction (qa r2 accepted it as a guard).
- `channelFolderCurrent`'s exact id compare (R2-cfc-exact) survives for the same reason the
  adversary's r2 X-noid did: a record whose id differs from the effective id needs a non-music
  load, whose surfaces never render the row. Kept as the one-line honest guard.
- R2-W1-null (`!!activeListenId &&` dropped) is EQUIVALENT: `sameMusicItem(id, null)` is false
  for every real id. R2-W2-tap (the pop-out `onArtist` without the pop-out flag) survives
  because the pop-out never renders a listen track's line as a control, so no click reaches it;
  the flag is a click-time re-check of the render's own rule.

### Targeted suites (Node v22.23.1, tests/pass/fail)

Every test/unit file naming music.js / music-skins.js / skin-surface.js / podcasts.js /
player.js or the adopt helpers (112 files) in one run: `# tests 1834`, `# pass 1834`,
`# fail 0`. The 10 mutant suites (music-view, music-nowplaying-view, music-skins,
music-skin-integration, music-actions-desktop, podcast-nowplaying-view, skin-surface,
listen-chapter-dock-return, music-chapter-reflect, player-state) unmutated: 405/405/0. eslint
on the 4 touched sources + 5 touched tests: 0 problems. No CSS change.

### Mutation results (r2 fix)

Each mutant is ONE exact-string edit verified to land exactly once in the sandbox, the 10
suites run, then the file restored and sha-compared (`restored=true` on all 20).

| # | Mutant | tests/pass/fail | Killed by |
|---|--------|-----------------|-----------|
| R2-W1 | watchBackVisible's fallback back to `id === activeListenId` | 405/403/2 | integration qa W1 (in-tab + desktop) |
| R2-W1-base | `sameMusicItem` loses the chapter arm (the old QA2-base) | 405/403/2 | integration qa W1 (in-tab + desktop) |
| R2-W1-raw | `sameMusicItem` lets a raw id match a `::c` id (the old QA2-raw) | 405/405/0 SURVIVED | none - disclosed above (unreachable raw-live state) |
| R2-W1-null | the `!!activeListenId &&` short-circuit dropped | 405/405/0 SURVIVED | none - EQUIVALENT (see above) |
| R2-art | the cover's listen-art fallback back to the exact compare | 405/404/1 | integration qa W1 in-tab (the repainted cover) |
| R2-art-base | the fallback keeps the `::c` id in the thumbnail route | 405/404/1 | integration qa W1 in-tab |
| R2-cfc-exact | channelFolderCurrent's id compare removed | 405/405/0 SURVIVED | none - disclosed above (the adversary's r2 X-noid) |
| R2-W2 | the pop-out veto removed from artistTapMode | 405/404/1 | integration qa W2 pop-out |
| R2-W2-flag | `popout` always false | 405/404/1 | integration qa W2 pop-out |
| R2-W2-order | the pop-out veto ahead of the drill check | 405/404/1 | integration "(M1) pop-out: ... drills the MAIN document" |
| R2-W2-tap | the pop-out `onArtist` ignores the flag | 405/405/0 SURVIVED | none - disclosed above (no control is rendered to click) |
| R2-adopt | applyAdoptFlavor drops the channelFolder refresh | 405/402/3 | player-state unit; integration adversary W1 (both drives) |
| R2-adopt-clear | a declared `''` keeps the stale folder | 405/404/1 | player-state unit |
| R2-W3 | `knownDurLabel` passes `0:00` through | 405/402/3 | music-skins unit; integration qa W3; podcast qa W3 |
| R2-W3-span | the thumb row always renders `.mms-rd` | 405/402/3 | the same three |
| S4-skin | `artistLine` ignores the title | 405/403/2 | music-skins S4; integration qa W1 in-tab |
| S4-view | `artistTapTitle` always `''` | 405/403/2 | integration qa W1 (in-tab + desktop) |
| S4-panel | `buildPanelHtml` ignores `subArtistTitle` | 405/403/2 | music-view S4; integration qa W1 desktop |
| S4-wrapper | `buildNowPlayingPanelHtml` drops `artistTitle` | 405/403/2 | music-view S4; integration qa W1 desktop |
| S5 | the srcless drill img's alt back to the title | 405/404/1 | music-view empty-drill unit |

16 of 20 killed; the 4 survivors are disclosed above (1 equivalent, 3 unreachable-state guards).
Sandbox removed after the run.

## Gate r3 - qa M1+M2 (@8aa22622)

Delta re-confirmation of `git diff 1ac34548 8aa22622` (music.js, music-skins.js,
skin-surface.js, player.js, 5 test files, tech-debt-tracker.md, this doc) against my r2
findings, the adversary's r2 findings and "## r2 fix record (M1+M2)". VERIFIED = run by me at
8aa22622 (Node v22.23.1); probes ran from a copy of music-skin-integration.test.js in the
session scratchpad, and against `git show 1ac34548:` copies for the before/after.

### Instruments (verbatim)

- `node --test test/unit/<f>.test.js`, tests/pass/fail: music-view 49/49/0 ·
  music-nowplaying-view 21/21/0 · music-skins 41/41/0 · music-skin-integration 115/115/0 ·
  music-actions-desktop 13/13/0 · podcast-nowplaying-view 29/29/0 · skin-surface 70/70/0 ·
  player-state 31/31/0 · listen-chapter-dock-return 2/2/0 · music-chapter-reflect 34/34/0.
- music-*, podcast-*, skin-surface*, player-state plus every unit file naming music.js /
  music-skins.js / skin-surface.js (55 files, one run): `# tests 861`, `# pass 861`,
  `# fail 0`, `# cancelled 0`, `# skipped 0`, exit 0.
- eslint on the 4 touched sources + 5 touched tests: no output, exit 0. No CSS in the delta.
- `bash .harness/lib/check-markers.sh`: `✗ ...music-channel-chapters-wave.md: stale approval
  @ef42a6d4 - reviewed code changed since; re-gate` / `check-markers: 1 issue(s) found`, exit 1
  (the tolerated Building shape; the gate close re-binds it).
- Docs censuses (comment-debt, docs-link, docs-status, tech-debt, docs-diagrams,
  dockerfile-ships-scripts): `# tests 17 # pass 17 # fail 0` (the #237 row is census-clean).
- Mutants not re-run by me (the Adversary's seat).

### My r2 findings at 8aa22622

- **W1 (chaptered listen, cross -> Songs -> artist tap): FIXED as prescribed.** My r2 probe,
  re-driven: after the cross + Songs browse the line is `<button class="mms-sub"
  data-skin-artist title="Go to channel">The Channel</button>`, the tap gives
  `navs ["/?folder=The%20Channel"]`, no fetch, no drill header; the Watch row is back
  (`watch row: true`). `sameMusicItem` now has real callers (watchBackVisible, the listen-art
  fallback), bound by the qa W1 drives (R2-W1 / R2-W1-base killed per the record).
- **W2 (pop-out listen tap): FIXED per Dean's ruling.** Re-driven (navigate stubbed to record
  and call `destroy()` as the router does): the pip `[data-skin-artist]` is `null`, a tap
  navigates nothing, `pip.closed= false`. `popout = winRef !== window`: the in-tab engine
  passes `window` (music.js :1544), the pop-out shell passes its own window (:1776), so both
  the PiP and the window.open fallback are covered.
- **W3 (podcast Nordic): FIXED per Dean's ruling and pinned.** Main (14088c92) vs 8aa22622
  `renderFull` on a podcast ctx (a 41:05 row + a `0:00` row): apple / ipod / ipod-black /
  ipod-matte / zune-classic byte-identical; spotify 2289 -> 2322 bytes, i.e. exactly one
  `<span class="mms-rd">41:05</span>` (33 bytes), no span for the zero row. The driven
  podcast test pins known / missing / 0 durations. The iPod list still prints `0:00` (out of
  scope, pinned by the music-skins unit, and the amended D8 scopes the ruling to the Nordic rows).
- **Podcast DESKTOP panel: still byte-identical.** Main vs branch `buildPanelHtml` on a
  podcast fixture: `identical= true 746 746`; the r1 EXPECTED lock is unmodified in the delta.
- **S4 (tooltip): FIXED** ("Go to channel" in channel mode on skins + desktop panel; the
  default "Go to artist" otherwise; the podcast panel passes no title, so its bytes hold).
  **S5 (alt): FIXED** (`alt=""` on the srcless slot, :428).
- **QA2 call: satisfied.** Both of my options landed: the chapter arm has a driven caller, and
  `channelFolderCurrent` is back to the exact compare with a truthful comment.

### Adversary r2 findings at 8aa22622

- **W1 (adopt drops `channelFolder`): FIXED.** `applyAdoptFlavor` refreshes it under the
  declared-field contract; watch.js declares `resumeMode: null` but never `channelFolder`
  (watch.js :1505, :1702), and no server payload carries a `channelFolder` key (grep of lib/ +
  server.js: none), so the `{...mediaData}` spread cannot smuggle one in. The player.js comment
  is accurate (`isMusic` is `resumeMode === 'music'`, player.js :8706). #237 (albumKey) is
  tracked, a pre-existing out-of-scope seam.
- **S2 (exact compare), S3 (`nowPlayingFrom` id param), S4 (title): FIXED.** Dropping the id
  override is safe: both former callers found `t` by that same id.

### Also checked

- The listen-art fallback change: re-driven, the chaptered listen cover after cross + Songs is
  `/thumbnail/vid1` at 8aa22622 vs `/albumart/vid1%3A%3Ac1` (the placeholder) at 1ac34548.
- Plan wording vs the tree: D6 (b) amendment, D8 amendment, acceptance M1, M1a and M2, the
  "Go to channel" gating paragraph and the pop-out row of the every-writer table all describe
  the code as it now stands.

### Findings

1. SUGGESTION - an undisclosed (beneficial) third effect of the watchBackVisible widening:
   `dockToOrigin` (music.js :986) reads it too. Re-driven (chaptered listen, cross, Songs, tap
   `[data-skin-collapse]`): at 1ac34548 `returnToPlayerOrigin= 1 clearPlayerLaunchOrigin= 0`
   (the v1.283 bounce back to the source video), at 8aa22622 `returnToPlayerOrigin= 0
   clearPlayerLaunchOrigin= 1` (dock in place, the v1.283 listen rule); the desktop actions
   menu's `hasWatchBack` follows too. Correct direction, but the fix record says only "the
   artist tap, the desktop .mnp-sub and the Watch row". Record it (and a drive, if cheap).
2. SUGGESTION - `sameMusicItem`'s comment (music.js :1372-1374) says "Caller:
   watchBackVisible"; `buildSkinCtx`'s listen-art fallback (:941) calls it too.

Neither blocks. No security surface in the delta: no new fetch/route/header; the thumbnail
route takes an `encodeURIComponent`'d base id; the new `title` values are static strings
escaped through `esc` / `panelEscape`; `channelTap`'s `'/?folder=' + encodeURIComponent(...)`
is unchanged.

Tree: byte-identical to 8aa22622 apart from this section (and any concurrent adversary
section); no untracked files added.

Gate: APPROVED r3 @8aa22622 — qa

## Gate r3 - adversary M1+M2 (@8aa22622)

Delta `1ac34548..8aa22622`, the worktree read-only. I measured all of this in a /tmp sandbox
built from `git archive 8aa22622` (node_modules symlinked). After the mutants ran, the sandbox
was diffed against a fresh archive (identical) and then removed. Unmutated, the 10 suites
(music-view, music-nowplaying-view, music-skins, music-skin-integration,
music-actions-desktop, podcast-nowplaying-view, skin-surface, listen-chapter-dock-return,
music-chapter-reflect, player-state) = 405 tests, 405 pass, 0 fail. tech-debt-census 1/1/0.
eslint on the 4 touched sources + 5 touched tests: 0 problems. No em dash in any added code or
test line. No `public/*.html` change and no new global (player.js changes only inside
`applyAdoptFlavor`), so shell parity is not exposed. check-markers still reports only the
tolerated stale design approval `@ef42a6d4`.

### r2 findings at 8aa22622

- **adversary W1 (an adopt never carried `channelFolder`): FIXED as prescribed.** I re-ran the
  r2 drive myself with my own adopting player mock, independent of the committed
  `adoptingPlayer`. Its `load` calls the REAL `isAdoptLoad`/`applyAdoptFlavor` exported by
  player.js. It is pre-loaded with the watch.js :1702 data for `vid1`, boots
  `?play=vid1&listen=1` (the load adopts), then re-inits at `/music?nowplaying=1` and at
  `/music`. Result: the Watch row, "Go to channel" (navigates `/?folder=The%20Channel`) and the
  artist line `<button ... title="Go to channel">` are all present (3/3 pass). With player.js
  swapped back to 1ac34548 the two adopt drives go red (1/2 fail; the genuine-load control
  stays green), so the drive binds the fix. The committed `adoptingPlayer` also routes through
  the real exported pair. R2-adopt 402/3, R2-adopt-clear 404/1, and my X-adopt-type (a
  non-string declared value carried through) 404/1.
- **adversary S2 (the dead chapter arm):** FIXED by qa W1's route. `channelFolderCurrent` is
  now an exact compare, and `sameMusicItem`'s chapter arm has a real, driven caller in
  `watchBackVisible` (R2-W1-base 403/2 - the old QA2-base is now killed). The false comment is
  gone.
- **adversary S3:** FIXED (the dead `id` parameter was dropped; my X-np-arg, which re-honours a
  second argument, 404/1).
- **adversary S4 (tooltip):** FIXED (S4-skin/view/panel/wrapper each 403/2; my X-panel-title
  404/1 and X-skin-title-ctx 404/1).
- **qa W1 (chaptered listen, empty drill):** FIXED (R2-W1 403/2). Also fixed: the sibling art
  fallback that built `/thumbnail/<vid>::c<n>` (R2-art 404/1, R2-art-base 404/1).
- **qa W2 (pop-out navigated the main window):** FIXED per Dean's ruling (R2-W2 404/1,
  R2-W2-flag 404/1, R2-W2-order 404/1, and my X-render-popout - the pop-out render loses the
  flag - 404/1).
- **qa W3 (Nordic 0:00):** FIXED per Dean's ruling (R2-W3 402/3, R2-W3-span 402/3; my
  X-dur-broad - every label blanked - 401/4, so the known-length axis is bound too). The
  producers were checked at source: `skinDur(0)` = `0:00` (podcasts.js :180).
- **qa S5 (alt):** FIXED (S5 404/1).

The builder's 20-mutant table reproduces EXACTLY: every count is identical, including the four
survivors at 405/0. I added 6 mutants of my own, and all 6 were killed.

### Rulings on the four survivors

None is on a reachable path; none blocks.

- **R2-W1-null: EQUIVALENT.** `sameMusicItem(id, null)` compares against the string `'null'`,
  which no media id is.
- **R2-W1-raw: unreachable (reasoned, not measured). Keep.** A raw live id beside a `::c`
  listen marker with a MUSIC meta needs a music load of the raw id. Every non-listen
  `loadTrack` rewrites `activeListenId` to `item.listen ? item.id : null`, and `playListenItem`
  (called only from init) re-stamps it. A watch-page load of the raw id leaves `isMusic`
  false, so the skin, the panel and the actions menu (which needs `full` + music) never render
  it. The shipped exact direction is the conservative one.
- **R2-cfc-exact: unreachable (reasoned). Keep.** A stale record does survive a re-init: the
  seed returns early for a non-music meta, and nothing in init nulls `nowPlaying`. But every
  surface that reads `channelVisible` needs a music meta, and with a music meta the seed has
  just rewritten the record with the live id. The exact compare is the natural predicate (the
  record must be the live item), not a speculative branch.
- **R2-W2-tap: unreachable (reasoned). KEEP rather than delete.** A listen track starts only
  in `playListenItem`, which is called only from init. `destroy()` tears the pop-out down
  (music.js :3204 `activePopoutTeardown`). Any non-listen load clears the marker. So the
  pop-out can never hold a stale button while the mode is 'channel'. It is not a separate
  feature branch. It is the same `popout` flag the render uses, passed at click time so that
  the click and the render compute the mode by ONE rule. Deleting it would leave the pop-out
  click computing the in-tab rule, and a future path that made a listen transition reachable
  would then navigate the window behind the pop-out and close it. It is disclosed in the fix
  record; no test claims to bind it.

### Findings

None blocking. The tech-debt #237 row (the `albumKey` adopt blind spot) is the correct
disclosure for the pre-existing sibling I named at r2.

Tree: byte-identical to 8aa22622 apart from this plan doc (qa's r3 section above and this
section); sandboxes removed; no untracked files.

Gate: APPROVED r3 @8aa22622 — adversary
