---
plan: music-channel-chapters-wave
harness: v2 · lean
branch: feat/music-channel-chapters
anchor: spec
status: Building
next: M1+M2 BUILT on feat/music-channel-chapters (main v1.316.0 merged, anchors re-verified; see "## Build record (M1+M2)"). Next: commit, mutation-test the bindings in a git-archive sandbox, then the gate (adversary floor + qa per scrutiny; brief the seats on the every-writer list + the podcast byte-identity). Wave order per D1 after this ships: T1 own slim branch, M3 own branch full gate, M4 own branch last.
design: Approved 2026-09-23 @ef42a6d4 (Dean: "GO." on the whole register D1-D15 as recommended, D15 as adjusted by the intake finding below)
gate: pending
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
| D6 | M1 entry points | (a) a "Go to channel" row in BOTH menus (Extras + sticker page 1, beside Watch), shown when the item has a folderName that is a yt-dlp channel dir (else hidden); (b) the now-playing artist line tappable in every renderer -> the in-Music artist drill (model: the Playing-from handler) | Two axes: leave the music view (channel grid) or stay in it (artist drill) |
| D7 | M1 data | Keep `folderName` on `nowPlaying` and listen tracks (client-only); no server change; optional later: folderName in `groupArtists` for a "View channel" button on the drill header | Zero API churn; the pop-out and skins read nowPlaying |
| D8 | M2 | Add optional `durLabel` to panel rows (both music writers), render `.mnp-queue-dur` after the title, blank when 0; also fill the mobile thumb variant's missing durLabel | Data already there; podcasts unaffected (optional field) |
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
  music-actions-desktop, music-nav)
- M2: a chaptered album's panel rows show each chapter's own length; a podcast panel is
  byte-identical to today. (music-nowplaying-view + podcast-nowplaying-view)
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
| the desktop pop-out (both skin families) | same elements | the same engine `onArtist` hook runs in the pop-out's engine instance; the drill opens in the MAIN document | music-skin-integration pop-out |
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

`channelVisible()` = `channelFolderCurrent() !== ''`: the queue entry's `channelFolderOf`
(library-backed + folderName), else `nowPlaying.folderName` (the meta carry after a re-init).
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
(`buildSkinCtx` already passed `durLabel`). CSS: `.mnp-queue-dur` (trailing column, the
`.music-song-duration` pattern) and `.mms-spotify .mms-rd`.

### Per-file changes

- `public/js/music-skins.js`: `artistLine()` (one writer, 3 call sites), the thumb-row `.mms-rd`, the hook comment.
- `public/js/skin-surface.js`: engine `onArtist` + the `[data-skin-artist]` branch; sticker page-1 `channelRow` + `[data-skin-channel]` dispatch; `createExtrasMenu` `hasChannel`/`onChannel` row + `'channel'` action; `buildPanelHtml` optional `subArtist` button + optional `durLabel` span; cfg docs.
- `public/js/music.js`: `channelFolderOf` (exported); `buildSongRowHtml` / `buildDrillHeaderHtml` artist buttons; `buildNowPlayingPanelHtml` `subArtist` + `durLabel`; `buildListenChapterTracks` + the single listen track carry `folderName`; `nowPlaying.folderName` at all four seams (reflectChapter, loadTrack, seedNowPlayingFromPlayer, restoreListenChapterQueue); `loadTrack` `channelFolder` on the load data; `updateNowPlayingPanel` `durLabel`; the data-artist dispatch widened to `.music-song-artist` / `.music-drill-artist`; the panel `.mnp-sub[data-artist]` branch; `channelFolderCurrent` / `channelVisible` / `channelTap` / `openArtistDrill`; `onArtist` + `channel` in the engine/sticker config; `hasChannel`/`onChannel` on the desktop menu.
- `public/js/player.js`: `getCurrentMeta` returns `channelFolder` (3 lines).
- `public/css/style.css`: the `:where()` resets + hover underline, `.mnp-queue-dur`, `.mms-spotify .mms-rd`. Token census stays 0; overlay containment clean.
- Tests: `music-view` (2 adapted + 5 new), `music-nowplaying-view` (1 adapted + 5 new), `music-skins` (3 new), `music-skin-integration` (11 new), `music-actions-desktop` (harness extended + 3 new), `podcast-nowplaying-view` (2 new: the byte-identity lock + the driven no-dur/no-button check), `skin-surface` (1 extended: the pop-out never offers the channel row).

### Podcast byte-identity proof

`buildPanelHtml` on a podcast-shaped fixture (`{title, subline}`, rows without `durLabel`)
run against main's `skin-surface.js` (v1.316.0, `git show main:public/js/skin-surface.js`)
produced the string now frozen as `EXPECTED` in `podcast-nowplaying-view.test.js`
("v1.317 (seam): ... byte-identical"); the same call on the branch's builder equals it
(`assert.strictEqual`). The driven podcast panel additionally asserts no `.mnp-queue-dur`
and a `DIV` `.mnp-sub` with no `data-artist`. Mutants F1/F2 (render the span/the button
unconditionally) go red on exactly those tests.

### Acceptance (M1/M2) with binding tests

- M1a every artist-line renderer is tappable and opens the artist drill for the current item:
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
- M2 a chaptered album's panel rows show each chapter's own length; a podcast panel is
  byte-identical: music-nowplaying-view ("a CHAPTERED album's rows show each chapter's own
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
