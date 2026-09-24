---
plan: music-followups
harness: v2 · lean
branch: fix/music-followups
anchor: spec
status: Building
next: built at d95d42ec (+ the docs commit recording the mutants); gate r1 - the FULL gate (adversary + qa + security-brief): item 2 touches how chapter likes are counted, the data class. Brief the adversary to DESTROY a chapter like through any chapter edit and to break the Autoplay-off retract.
design: Approved 2026-09-24 (Dean's intake, recorded in memory wave-2026-09-24-intake)
gate: pending
---

# Music follow-ups (the wave's slim branch)

Base: main @ecb61e1d (= tag v1.318.0). One slim branch for the music wave's leftovers: the M4
adversary's unverified autoplay observation, the persistent-cog rows, two tracker rows (#235,
#237) and seven test-quality items the v1.316-v1.318 gates left as suggestions. Item 2 changes
how chapter likes are COUNTED, so this branch takes the FULL gate.

## The ask

Dean's list (wave intake, memory `wave-2026-09-24-intake`, item 2: "Music follow-ups (one slim
branch): Autoplay/Loop cog rows inert in Music; #235 stranded chapter like; #237 stale albumKey
on same-id adopt; test-quality items; VERIFY autoplay-pref-0 still advancing the queue").

| # | Item | Source |
|---|---|---|
| 0 | VERIFY FIRST: with the music autoplay pref at 0 the queue still advanced at a natural end. Reproduce with the real wiring; fix if real, decide what "autoplay off" means for an explicit queue vs an album. | M4 r3 adversary "Probe caveat" (completed/2026-09-24-music-desktop-ambient.md) |
| 1 | Autoplay + Loop cog rows are visible but inert in Music after a watch visit. Decide per row: Music drives it, or hides it. | M4 Known seams |
| 2 | Tracker #235: a re-chapter can strand a chapter like. Count through the listing's expansion OR sweep only GONE indexes; never delete on a re-point. | chapter-likes gate r1 W3 |
| 3 | Tracker #237: the same-id adopt keeps a stale albumKey. | M1+M2 gate r2 W1 |
| 4a | A second GIT_* filter layer in CLEAN_ENV. | docs fast-path r3 S4 |
| 4b | The chapter-likes `overlayFail` fixture answers `liked:true` for the base file. | chapter-likes r2 S1 |
| 4c | `unref()` the bootLikedGrid 5 s fallback timer. | chapter-likes r2 S4 |
| 4d | The watch-init harness keeps every listener, not the last per type. | M1+M2 / T1 gate |
| 4e | The `sameMusicItem` comment names both callers. | M1+M2 r3 qa S2 |
| 4f | Record (and bind) that the chapter-aware `watchBackVisible` changes `dockToOrigin` after a chapter cross. | M1+M2 r3 qa S1 |
| 4g | The `-active` modifier tokens in ROLES (sub-row-chip-btn-family.test.js). | v1.316 qa r2 |

## Decisions (recorded, with the reasoning)

- **D-0 What "Autoplay off" means in Music.** Autoplay (the `ft-music-autoplay` switch) is the
  STATION: the tracks FileTube lines up when YOUR queue runs out (the v1.254 contract, its
  ledger entry: "When your queue runs out ... FileTube quietly lines up a few more ... a new
  Autoplay switch ... turns it off"). YOUR queue - an album, a Songs / Recently played list, a
  listen video's chapters - always plays through, as it did before the switch existed (player.js
  `handleAutoplayNext`: "Music autoplays through its queue by default"; v1.63 "the queue owns
  up-next"). So OFF stops playback where your queue ends and never enters a station pick. It
  does NOT stop an album mid-way: that would make Music's Autoplay mean something no ledger entry
  promised, and the album Play button would stop after one song.
- **D-0b The observation was REAL** (measured below, S4/S5): the station is appended EARLY
  (when the last track starts, the v1.254 "append early so it is visible" rule), so switching
  Autoplay off during that last track left the picks in the queue and the natural end played on
  into them - the M4 adversary's "aud4 to aud1::c1" was one of those picks. Fix: every appended
  pick is remembered (a WeakSet, by identity - they are fresh objects from the picker's fetch);
  the ONE toggle seam (`applyAutoplayToggle`, used by the desktop toolbar button and the skin
  sticker row) retracts the picks not yet reached; the advance seams (`registerTrackNav`'s
  onNext, and both arms of the solo-chapter exit) refuse to step into a pick while Autoplay is
  off (a pref flipped from another device arrives in storage through prefs-sync with no toggle
  in this view). Switching it ON while on the last track lines the station up at once (the
  symmetric axis: before, it only armed at the next load).
- **D-1 The cog rows: Music HIDES both** (the M4 one-rule shape, keyed on new row ids).
  Autoplay in the cog is the server `autoplayNext` ("Autoplay next video", the video end path);
  Music's queue never reads it, and Music already shows an Autoplay switch with a DIFFERENT
  meaning (the station) in its toolbar and sticker - two switches named Autoplay meaning two
  things in one view would mislead. Loop in the cog writes the same `ft-loop` Music's own Loop
  (toolbar + sticker, relabelled "Loop chapter" for a chapter) writes; driving it would be a
  second copy of an existing control that must mirror the label and the pressed state. The rows
  stay where they are wired: the watch view (phone and desktop). Dean can overrule (driving
  Loop is a small follow-up if he wants it in the cog too).
- **D-2 #235: count through the expansion; never sweep.** Both readers of chapter-like
  membership - the Liked listing (GET /api/liked) and the member's Stats count (GET /api/stats)
  - and the like POST now route through ONE rule, `chapterLikeTrack(item, likeId)` (server.js).
  No chapter edit deletes a like. The sweep alternative was rejected: it is irreversible (an
  accidental clear of the chapter text, or a temporary fall-back to embedded chapters, would
  lose the likes forever), and it would cover only the editor route - a rescan or a description
  change that re-chapters a file would still strand. Counting at the reader covers every writer.
  The request validation and the route are untouched (the sibling feat/chapter-snap saves
  through the same route).
- **D-3 #237: the adopt carries album, albumKey AND autoAdvanceViaTrackNav.** The first two are
  the tracker's ask (music's dock-return re-init reads both). The third is the same class, found
  by driving the real adopt: the watch load never declares it, so after Watch -> Music the
  track's natural end took the VIDEO autoplay path and the album queue never advanced
  (measured). Watch declares none of the three, so a Listen -> Watch adopt keeps them - measured
  harmless (that end still stops: music's track nav is gone with its view). Not changed here.
- **D-4g ROLES already carries the `-active` tokens**: landed with T1 in v1.317 (the
  `// v1.317 (QA r2 suggestion on v1.316.0)` line in sub-row-chip-btn-family.test.js). Verified
  bound by a mutant (M4g below); no edit.

## Re-verified survey (every anchor re-read at ecb61e1d before editing; line numbers are the tree AFTER this branch unless noted)

| Claim | Where | Verdict |
|---|---|---|
| The music autoplay pref is `ft-music-autoplay`, default ON (only '0' disables) | public/js/music.js:752-759 | verified |
| The station is appended EARLY, from `registerTrackNav` on the last index | music.js:2791 (registerTrackNav) -> maybeExtendQueueForAutoplay :2940 | verified |
| The toolbar Autoplay click and the sticker `autoplay.onToggle` only flipped the pref | ecb61e1d music.js:1001-1004, :1151 | verified (now both call `applyAutoplayToggle`, :2873) |
| Music's natural end: player.js `handleAutoplayNext` takes the `autoAdvanceViaTrackNav` branch (GET /api/queue, then trackNav onNext) | public/js/player.js:4879 | verified; the video branch fetches /api/settings |
| The solo-chapter exit appends `soloExitPicks` or lands on an existing station row | music.js:1373 enforceChapterExit | verified; both arms now re-check Autoplay |
| watch.js injects Autoplay + Loop into the persistent `#settings-menu`, id-guarded, bound on the watch signal only | public/js/watch.js:1973 ensureCogControlsInjected; setupAutoplayToggle :1941; setupLoopToggle :2107 | verified |
| The M4 row scoping rule (Ambient) | public/css/style.css `body:not([data-view="watch"]):not([data-view="music"]) #ambient-toggle-row` | verified; the new rule sits beside it (:9218) |
| `applyAdoptFlavor` carried readerHref / resumeMode / channelFolder only | ecb61e1d player.js:140 | verified (now :149, three more fields) |
| `getCurrentMeta` returns album / albumKey from currentData | player.js:8748 | verified |
| The chapters editor route writes `chaptersManual` and returns the resolved chapters | lib/media/routes.js:1854 | verified, NOT edited |
| The Liked listing's chapter arm drops an index not in the expansion | lib/media/user-routes.js:367 (now `chapterLikeTrack`, :376) | verified |
| The member's `/api/stats` liked count filtered by base visibility only | ecb61e1d lib/media/routes.js:1660 | verified (now `likeCounts`, :1638) |
| The ADMIN inventory's liked count is `likedStore.list()` | lib/media/routes.js (admin arm); lib/media/liked.js (`media_liked`, the frozen pre-auth likes, lib/stats.js:273) | verified - a different namespace; filed as #243, not changed |
| `itemChapterTracks` is the ONE music expansion | server.js:4115 | verified; `chapterLikeTrack` beside it (:4125) |
| CLEAN_ENV had one GIT_* layer (the process scrub) | test/unit/precommit-docs-fast-path.test.js | verified |
| overlayFail boots answer `liked:false` for the base | test/unit/music-chapter-likes-client.test.js fixture | verified |
| bootLikedGrid's 5 s fallback is a live timer | test/unit/card-like.test.js | verified (7.6 s wall, below) |
| the watch-init shim kept the LAST listener per type | test/unit/watch-init-behavioral.test.js makeEl | verified |
| `sameMusicItem`'s comment named one caller; buildSkinCtx is the second | music.js:1496 and the listen-art fallback in buildSkinCtx | verified |
| dockToOrigin reads watchBackVisible | music.js:1080 | verified |
| ROLES already carries the `-active` tokens | test/unit/sub-row-chip-btn-family.test.js:35 | verified (D-4g) |

## Acceptance criteria

- **AC0 (item 0).** With Autoplay OFF: (a) your own queue (album, list) still advances; (b) the
  station is never entered - switched off by the toolbar button or the sticker row after the
  early append, the unplayed picks are retracted (the up-next shows the truth, the ended-advance
  has no Next); (c) a pref flipped in storage only (prefs-sync) is honoured at the advance seam
  (the pick is refused and retracted); (d) both solo-chapter exit arms refuse a station primed
  or appended while it was on. With Autoplay switched ON on the last track the station is lined
  up at once. Bound: music-chapter-reflect.test.js "item 0" x4; music-skin-integration.test.js
  "item 0: the sticker Autoplay row". Measured: the autoplay probe S1-S7.
- **AC1 (item 1).** The cog's Autoplay + Loop rows show only on the watch view (desktop and
  phone), work there after a music visit, are absent on a cold /music, and are hidden in Music,
  podcasts and home after a watch visit. Bound: music-ambient.test.js "item 1" (the real
  injector writes the ids; ONE rule names them). Measured: the cog-row probe at 1600 and 390.
- **AC2 (item 2, #235).** The member's Stats count equals their Liked listing through a
  re-chapter to fewer, to more, and a times-only edit; no edit deletes a like; a restored index
  revives. Bound: chapter-likes.test.js "#235" (plus the existing W1).
- **AC3 (item 3, #237).** A Watch -> Music same-id adopt leaves the player's meta with the music
  load's album / albumKey, and the natural end advances through music's queue. Bound:
  player-adopt-flavor.test.js (the REAL player.js adopt branch and ended cascade in jsdom).
  Measured: the adopt probe.
- **AC4 (items 4a-4g).** Each as listed; bound where cheap (4a a `cleanEnv` table test, 4b the
  divergent fixture, 4c a wall-time measurement, 4d a harness self-test, 4f a behavioural drive,
  4g a mutant).

## Build record

Files:

- `public/js/music.js` - item 0: `autoplayPicks` (WeakSet), `navIndex`, `isAutoplayPick`,
  `markAutoplayPicks`, `retractAutoplayPicks`, `autoplayHoldsAt`, `applyAutoplayToggle`; the
  toolbar click and the sticker `onToggle` call `applyAutoplayToggle`; `registerTrackNav`
  records `navIndex` and its onNext asks `autoplayHoldsAt(i + 1)`; `maybeExtendQueueForAutoplay`
  and the solo exit mark their picks; the solo exit's existing-row arm asks `autoplayHoldsAt`,
  its append arm re-checks `autoplayEnabled()`. Item 4e: the `sameMusicItem` comment.
- `public/js/player.js` - item 3: `applyAdoptFlavor` carries `album`, `albumKey`,
  `autoAdvanceViaTrackNav`.
- `public/js/watch.js` - item 1: `id="watch-autoplay-row"` / `id="watch-loop-row"` on the two
  injected labels.
- `public/css/style.css` - item 1: `body:not([data-view="watch"]) #watch-autoplay-row,
  body:not([data-view="watch"]) #watch-loop-row { display: none; }`.
- `server.js` - item 2: `chapterLikeTrack`, passed to both route registrations.
- `lib/media/user-routes.js` - item 2: the like POST and the Liked chapter arm call it.
- `lib/media/routes.js` - item 2: the member's Stats count routes through `likeCounts`.
- `docs/exec-plans/tech-debt-tracker.md` - #235 and #237 CLOSED; #243 filed (the admin Stats
  "Liked items" counts the frozen pre-auth store - pre-existing, display only).
- Tests: new `test/unit/player-adopt-flavor.test.js` (4); `test/integration/chapter-likes.test.js`
  (+1, "#235"); `test/unit/music-chapter-reflect.test.js` (+6, the toolbar button added to its
  HTML; two of them landed after the build commit - c7b81efb binds M0h, d95d42ec binds M0l); `test/unit/music-skin-integration.test.js` (+2: the sticker retract, item 4f);
  `test/unit/music-ambient.test.js` (+1, item 1); `test/unit/watch-init-behavioral.test.js`
  (the shim keeps every listener, +1 self-test, the theatre-signal test checks every
  registration); `test/unit/precommit-docs-fast-path.test.js` (`cleanEnv` + 1 test);
  `test/unit/music-chapter-likes-client.test.js` (`baseLiked`); `test/unit/card-like.test.js`
  (`unref`).

Item 4d check - "no existing test was silently relying on the overwrite": with every listener
kept, a temporary probe in the shim printed any `_l[type]()` call that fired more than one
listener; across the whole file it printed none (0 driven multi-listener events), and all 21
pre-existing tests stayed green. The only change a test needed was the options shape
(`_lo.click` is now a list; the theatre-signal test asserts every registration).

## Measurements

All probes: headless Chromium chromium-1234 over raw CDP (the scripts/action-row-probe.js
boot shape), a scratch DATA_DIR, real PCM WAV audio items served through /video/<id>, this
tree vs a `git archive ecb61e1d` sandbox. Probe scripts in the session scratchpad
(`music-followups-probe-*.js`, `music-followups-cdp.js`).

### Item 0 - the natural end with Autoplay off (desktop 1600x1000; album "Record" a1-a3 + o1, o2; 4 s tracks; the end driven by a seek to duration-0.5)

| Scenario | ecb61e1d (before) | this branch |
|---|---|---|
| S1 album mid-track, pref 0 | a1 -> a2 -> a3 (your queue) | a1 -> a2 -> a3 (unchanged) |
| S2 album LAST track, pref 0 | a3, stops (no append) | a3, stops |
| S3 LAST track, pref 1 | appended [o1, o2], a3 -> o1 -> o2 | appended, a3 -> o2 -> o1 (random order) |
| S3b LAST track, pref unset | appended, advances | appended, advances |
| S4 LAST track, pref 1, then storage '0' after the append (the prefs-sync shape) | **a3 -> o1 -> o2: played the station** | picks still shown until the end, then a3 stops; the rows after: [a1, a2, *a3] |
| S5 LAST track, pref 1, then the REAL toolbar button OFF | **a3 -> o1 -> o2: played the station** | the rows retract at the click ([a1, a2, *a3]); a3 stops |
| S6 single non-album track, pref 0 (the Recently played list is the queue) | o1 -> o2 | o1 -> o2 (your queue) |
| S7 LAST track, pref 0, then the toolbar button ON | (not run on the base) | appended at the click; a3 -> o2 -> o1 |

No page errors in any scenario.

### Item 1 - the cog rows (computed `display` of each row label)

| Step | ecb61e1d 1600 / 390 | this branch 1600 / 390 |
|---|---|---|
| 1 cold /music | Autoplay + Loop absent | absent |
| 2 then /watch | flex / flex; a Loop tap: `ft-loop` '1', player loop on; again: off | same |
| 3 then /music | **flex / flex, and a Loop tap flips the checkbox with no effect (`ft-loop` stays '0')** | none / none |
| 4 then /podcasts | **flex** | none |
| 5 then home | **flex** | none |
| 6 back to /watch | flex; a Loop tap works (the new view signal) | flex; works |

The Ambient row reads as before at every step (flex on desktop watch and music; none on the
phone music view, podcasts, home). No page errors.

### Item 3 - Watch -> Music same-id adopt (20 s tracks)

| Reading | ecb61e1d | this branch | control (a cold /music, no watch visit) |
|---|---|---|---|
| meta after the adopt | album '', albumKey '' | album 'Record', albumKey 'Band␟Record' | same as this branch |
| natural end (still on /music?play=a1) | **a1 stops (paused at 0)** | a1 -> a2 | a1 -> a2 |
| dock-return re-init (/music?nowplaying=1) | **no album drill, no up-next rows** | the album drill and [*a1, a2, a3] | same |
| natural end after the re-init | **a1 stops** | a1 -> a2 | a1 -> a2 |
| reverse: Music -> Watch adopt, natural end on /watch (server autoplayNext off) | stops | (unchanged code path) | - |

### Item 4c - card-like.test.js wall time

ecb61e1d: 7637 ms, 7678 ms. This branch: 3478 ms, 3103 ms (8 / 8 pass each).

### Phone (390x844)

Item 1 is the only user-facing layout change: measured at 390 above (the rows hide in music,
podcasts and home; the watch view keeps them). Items 0 and 3 change no layout.

## Instruments (Node v22.23.1)

Commits (each through the pre-commit hook, the whole unit suite): a28f8b32 the build (hook:
tests 7114, pass 7114, fail 0); c7b81efb the M0h test (7115 / 7115 / 0); d95d42ec the M0l test
(7116 / 7116 / 0). Before the build commit:

- Targeted suites, one run, 144 files (every test/unit file matching music*, player*, watch*,
  ambient*, shell-*, docs-*, exec-plans*, tech-debt*, sub-row-chip*, comment-debt*, card-like,
  precommit*, stats*, prefs-sync*, skin-surface*, queue-chrome*, menu-returns*, theatre* /
  theater*, sidebar-nav-parity, media-routes*, podcast-nowplaying*; plus the integration files
  api, chapter-likes, chapters-editor, liked-mixed-kind, liked, music-library-projection,
  rbac-census, rbac-video-enforcement, rbac-write-enforcement, stats-and-view,
  watch-like-button, watch-liked-sidebar, shell-smoke, route-read/write-classification,
  read-only-media, library-items, storage-summary, feed-hidden-api, watch-filter): tests 1976,
  pass 1976, fail 0, cancelled 0, skipped 0.
- eslint (music.js, player.js, watch.js, server.js, lib/media/routes.js,
  lib/media/user-routes.js and the nine touched test files): exit 0.
- `npm run lint:css`: TOTAL 0. `node scripts/overlay-containment-lint.js --enforce`: clean (0
  violations).
- No new global script, no new shell, no new registry entry (nothing for the parity censuses).
- Doc censuses (comment-debt, docs-diagrams, docs-link, docs-status, exec-plans, tech-debt) with
  this plan in place: tests 17, pass 17, fail 0.
- `.harness/lib/check-markers.sh`: 1 issue, this doc's `design:` line has no `@<sha>` (the
  brief's wording: the approval is Dean's intake, recorded in memory, not a commit; bound to
  the base it reads "stale approval" instead - the same shape the M4 qa noted on its plan).

## Mutant table

Sandbox: `git archive c7b81efb` into /tmp (node_modules symlinked); each mutant replaces EXACTLY
one occurrence (the runner refuses 0 or 2+ matches and an empty diff), runs the named files,
restores the file and byte-compares it. Runner: session scratchpad
`music-followups-mutants.js`. "First red" is the first failing test.

| # | Mutant | Result | First red |
|---|---|---|---|
| M0a | music: registerTrackNav onNext never asks autoplayHoldsAt | KILLED 1 fail | item 0: a pref that reaches storage with NO toggle |
| M0b | music: the toggle OFF never retracts | KILLED 3 fail | item 0: Autoplay turned OFF (the REAL toolbar button) |
| M0c | music: the toggle ON never re-arms the last track | KILLED 1 fail | item 0: Autoplay turned OFF (the REAL toolbar button) ... ON again |
| M0d | music: markAutoplayPicks remembers nothing | KILLED 5 fail | item 0: Autoplay turned OFF (the REAL toolbar button) |
| M0e | music: autoplayHoldsAt holds ANY next entry when off (your queue too) | KILLED 1 fail | item 0: ... YOUR queue still plays through |
| M0f | music: the solo-exit append arm skips the Autoplay re-check | KILLED 1 fail | item 0: the solo-chapter exit re-checks Autoplay at the hand-off |
| M0g | music: the solo-exit existing-row arm skips autoplayHoldsAt | KILLED 1 fail | item 0: the solo-chapter exit onto an EXISTING station row |
| M0h | music: retract also drops the PLAYING pick (`k >= navIndex`) | KILLED 1 fail | item 0: switched OFF while a station pick is PLAYING |
| M0i | music: the sticker onToggle bypasses the seam (the old setter) | KILLED 1 fail | item 0: the sticker Autoplay row switched OFF |
| M0j | music: the toolbar click bypasses the seam (the old setter) | KILLED 2 fail | item 0: Autoplay turned OFF (the REAL toolbar button) |
| M0k | music: the maybeExtend append does not mark its picks | KILLED 5 fail | item 0: Autoplay turned OFF (the REAL toolbar button) |
| M0l | music: the solo-exit append does not mark its picks | run 1 at c7b81efb SURVIVED (39 pass / 0 fail): no test drove a toggle AFTER a solo-exit append; test added (d95d42ec, "a station the solo-chapter exit appended is a station too"); re-run at d95d42ec KILLED 1 fail | item 0: a station the solo-chapter exit appended is a station too |
| M1a | css: the watch-only row rule removed | KILLED 1 fail | item 1: the cog Autoplay + Loop rows ... show only on the WATCH view |
| M1b | watch: the Autoplay row label loses its id | KILLED 1 fail | item 1 |
| M1c | watch: the Loop row label loses its id | KILLED 1 fail | item 1 |
| M1d | css: the rule unscoped (hides the rows on watch too) | KILLED 1 fail | item 1 |
| M2a | stats: the member count back to base visibility only (the pre-#235 line) | KILLED 1 fail | #235: through every re-chapter the member's Stats count equals their Liked listing |
| M2b | stats: likeCounts counts any chapter of a visible base | KILLED 1 fail | #235 |
| M2c | server: chapterLikeTrack drops the audio-only rule | KILLED 1 fail | AC4: out-of-range, skipped-invalid, non-chaptered, video, ... all 404 |
| M2d | liked listing: the chapter arm without its `!track` guard | KILLED 2 fail | W1: a chapter like whose index a re-chapter removed is dropped from the read |
| M2e | stats: likeCounts counts a plain like without the visibility check | KILLED 1 fail | rbac-census LIST SWEEP: a member blocked from all libraries sees NO seeded content |
| M3a | player: the adopt does not carry album | KILLED 2 fail | #237: Watch -> Music on the SAME id ADOPTS through the real load() |
| M3b | player: the adopt does not carry albumKey | KILLED 2 fail | #237: Watch -> Music on the SAME id ADOPTS |
| M3c | player: the adopt does not carry autoAdvanceViaTrackNav | KILLED 2 fail | #237: after that adopt, the track's natural END advances through music's queue |
| M3d | player: autoAdvanceViaTrackNav carried as truthy | KILLED 1 fail | applyAdoptFlavor (#237): ... declared-field contract |
| M4a | test: cleanEnv without its GIT_* layer | KILLED 1 fail | CLEAN_ENV is its own GIT_* filter (the second layer) |
| M4b | music: a failed overlay inherits the base file's liked (the chapter-likes r2 survivor) | KILLED 2 fail | sticker Extras page: a FAILED chapter-flag overlay ... reads as "Like" |
| M4d | test: the watch-init shim keeps only the LAST listener | KILLED 1 fail | harness (item 4d): the element shim keeps EVERY listener |
| M4f | music: watchBackVisible fallback back to an exact compare | KILLED 3 fail | v1.317 gate r2 qa W1 (and item 4f's collapse drive) |
| M4g | css: a box property on `.sub-row-bell-active` | KILLED 1 fail | AC4: no rule targeting a chip role class declares a box property |

31 mutants, 31 killed (M0l after a test, re-run recorded; the item-0 set M0a/b/d/f/g/h/k/l
re-run together at d95d42ec: all KILLED). Item 4c (`unref`) has no behavioural mutant: it is
bound by the wall-time measurement above. Item 4e is a comment.

## Disclosed gaps

- **A reorder still re-points a chapter like** (index-keyed; by ruling a moved or retimed
  chapter keeps its like). A stranded row stays in storage by design (it revives when an edit
  restores the index); no UI removes it. Unchanged from the v1.317 disclosure.
- **The admin Stats "Liked items" is a different namespace** (the frozen pre-auth store); it
  does not count anyone's likes. Pre-existing, filed as #243, not changed here.
- **A pref flipped from another device** (prefs-sync writes storage with no toggle in this view)
  keeps the already-appended picks VISIBLE in the up-next until the advance, which then refuses
  them and retracts (S4). The toggle in this view retracts at once.
- **The cog Loop row is hidden in Music, not driven** (D-1). Music keeps its toolbar / sticker
  Loop. Dean's call if he wants a cog Loop there too.
- **Listen -> Watch adopt keeps music's `autoAdvanceViaTrackNav`** (D-3): measured harmless
  (the natural end on the watch page stops). The v1.2xx ledger's "a finished video may jump to
  the next one even if autoplay is off right after switching from Listen back to Watch" is the
  documented shape of this; not reproduced here and not changed.

## Gate r1 - security-brief (@020bec0a)

**Check I could NOT complete:** this seat has no Bash, so `git diff ecb61e1d..020bec0a`, `git
status` and every test run were NOT executed. The sha binding was read from
`.git/refs/heads/fix/music-followups` (= 020bec0a0465b0870d2a4bf4dd65504f8f0eb047) with the
worktree HEAD pointing at that branch; the checkout's cleanliness was not machine-checked. The
before-state was read from the main checkout (clean, at ecb61e1d) file by file instead of a
diff. Nothing below is a test result; "verified" means I traced the code path by reading it.

Scope: the named surfaces (`chapterLikeTrack` and its three consumers, likeId parsing, the
gate kind, admin #243), then a sweep of the rest of the branch (music.js item 0, player.js
`applyAdoptFlavor`, watch.js row ids, css, the CLEAN_ENV test).

**Verified (traced):**

- **Like POST** (lib/media/user-routes.js:187-206). The RBAC gate runs on the parsed BASE id
  through `restrictedVideoMutation` -> `mediaVisibleTo` before any existence check; an unknown
  base, a restricted base, a non-audio base and a visible audio base without that chapter all
  answer the SAME `404 {error:'Media file not found'}`, so no existence/restriction oracle. The
  stored key is `track.id` from the expansion, never `req.params.id`. Behaviour is identical to
  ecb61e1d (the old inline `item.type === 'audio' ? itemChapterTracks(item).find(...) : null`
  moved into `chapterLikeTrack`, server.js:4125, unchanged in meaning).
- **likeId parsing.** `parseChapterTrackId` (`/^(.+)::c(\d+)$/`) only splits; membership is
  EXACT string equality against `chapterTrackId(item.id, i)` minted by `expandAudioToTracks`.
  NUL / newline, a negative (`\d` excludes `-`), a non-integer, leading zeros (`::c01`) and a
  huge n (the parsed `index` is never used by `chapterLikeTrack`) all fail that equality -> 404
  or dropped. A doubled suffix (`X::c1::c2`) parses to base `X::c1`, which is not an own key of
  `db.metadata` (own-property check) -> 404. Prefix confusion between ids sharing a prefix
  cannot occur: the base is looked up exactly and the full id compared exactly.
- **Liked listing chapter arm** (user-routes.js:369-408). Gate order unchanged: own-property
  base, `type === 'audio'`, `mediaVisibleTo(req, item)` BEFORE `chapterLikeTrack`, so a chapter
  title or album of a hidden file never reaches the response. Same predicate as ecb61e1d.
- **Member Stats count** (lib/media/routes.js:1638-1672). `likeCounts` requires the base in
  `visibleMetadata` (built by `mediaVisibleTo`, :1606-1609) and, for a chapter like, a chapter
  the file still has. This is a strict NARROWING of the ecb61e1d rule (base visibility only),
  so it can only count fewer rows; it counts only the caller's own `user_liked` rows and emits a
  number, no titles. `withEffectiveViewCounts` items are shallow copies, so `type`,
  `chaptersManual`, `chapters`, `tags.description` and `id` all reach `resolveItemChapters`
  (pure, no I/O: server.js:2386).
- **Gate KIND.** All three consumers use the MEDIA gate (`mediaVisibleTo`), matching
  `projectedLibraryTracks` (server.js:4144) that mints these ids; none uses `trackVisibleTo`.
  Consistent with the rest of the like surface.
- **Admin #243.** The `likedStore.list()` read is only in the `isAdmin` arm (routes.js:1649-1656),
  unchanged by this branch; admin already sees the whole library. Nothing new is exposed.
- **Not touched:** DELETE /api/liked/:id (own rows only), the backup bundle, any other
  mutating or list route. `server.js` wires `chapterLikeTrack` into exactly the two
  registrations that consume it (:5277, :6191).

**Sweep, no security surface:** music.js item 0 (WeakSet of picks, queue retraction, no new
fetch or DOM sink), player.js `applyAdoptFlavor` (copies `album`/`albumKey` strings and a
strict-`=== true` boolean from the player's own load data; no new source of untrusted input),
watch.js static ids, the css rule, and the CLEAN_ENV test (a second GIT_* filter; tightens the
child env, no secret handling).

**Findings:** none at CRITICAL / HIGH / MEDIUM / LOW.

- INFO: `/api/stats` now runs the chapter expansion once per chapter like per request (pure,
  in-memory; the Liked listing already does the same). Not a security concern at this
  deployment's scale.

Gate: APPROVED r1 @020bec0a — security-brief

## Gate r1 - qa (@020bec0a)

Instruments (Node v22.23.1, run by this seat at 020bec0a):

- Targeted: chapter-likes, liked*, stats-and-view, rbac-census, chapters-editor (integration) +
  player-adopt-flavor, music*, watch-init*, card-like, precommit-docs-fast-path,
  sub-row-chip-btn-family, every *census* and *parity* unit file: tests 775, pass 775, fail 0.
- `npm run test:unit`: tests 7116, pass 7116, fail 0, cancelled 0, skipped 0.
- `npm run lint:css`: TOTAL 0. `node scripts/overlay-containment-lint.js --enforce`: clean (0
  violations). eslint on the 6 source + 9 test files: exit 0.
- `.harness/lib/check-markers.sh`: 1 issue (this doc's `design:` line has no `@<sha>`; the
  disclosed one).

Findings:

1. **WARNING - regression (verified): turning Autoplay OFF then ON during a solo chapter drops
   its exit station.** public/js/music.js:2850 (`retractAutoplayPicks` nulls `soloExitPicks`)
   with :2873-2878 (`applyAutoplayToggle(true)` only re-arms the last-track case, never
   re-primes). Scenario: tap chapter two of a chaptered album (solo; the station is primed),
   click the toolbar Autoplay off, then on again, let the segment reach its end. At ecb61e1d it
   stations on (`station-track`); at 020bec0a the hand-off finds no picks and the file plays
   straight on into chapter three (currentId stays `film::c1`). Driven in /tmp sandboxes of both
   shas with the music-chapter-reflect harness (control without the toggles: `station-track`).
   The null is redundant: the append arm already re-checks `autoplayEnabled()` at :1415. Fix:
   drop `soloExitPicks = null` from the retract (or re-prime on ON), and bind OFF -> ON with
   that drive.
2. **WARNING - a false mechanism stated as measured (comment, test message, plan D-3).**
   public/js/player.js:146-148 ("a Listen -> Watch adopt keeps them (measured: that end still
   stops - the music view's track nav is gone with its view)"), the same claim in
   test/unit/player-adopt-flavor.test.js's last test, and the plan's D-3 and disclosed gap.
   Music's `destroy()` never clears the track nav, and watch.js's `registerTrackNav` replaces it
   whenever the watch context has a neighbor. The kept `autoAdvanceViaTrackNav: true` then sends
   the natural end down `fallbackToTrackNav` into watch's `effNext`, IGNORING the server
   autoplayNext setting. Driven on the real player.js in jsdom (a listen load of `a1`, then the
   watch-shaped adopt, then a watch `setTrackNav({ onNext })`, then `ended` with
   `/api/settings` answering `autoplayNext: false`): fetches `['GET /api/queue']`, and watch's
   onNext fired 1 time. So the video advances with Autoplay off. That is the v1.253 ledger's
   known quirk ("a finished video may jump to the next one even if autoplay is off right after
   switching from Listen back to Watch"). It is pre-existing, NOT a regression. But the new
   comment calls it harmless for a reason that does not exist, and the unit test pins the flag
   staying `true` as intended. Fix, preferred: watch.js's adopt-capable loads (:1128, :1325)
   declare `autoAdvanceViaTrackNav: false`, the same "claim the plain-video flavor" posture as
   their `readerHref: null` / `resumeMode: null`. That closes the ledger quirk; then flip the
   test to bind it. Minimum: reword the comment, the test message and D-3 to the true behavior,
   and file a tracker row.
3. **WARNING - AC0(b) "the up-next shows the truth" is unbound.** public/js/music.js:2860.
   Mutant (in /tmp, `git archive 020bec0a`): delete `updateNowPlayingPanel();` from
   `retractAutoplayPicks`. It SURVIVED all music* units (555 pass / 0 fail). Every item-0 test
   asserts the nav (`onNext === undefined`), never the rendered up-next. Scenario the suite would
   miss: Autoplay off after the early append leaves the station rows on screen. A tap on one
   runs `playAt(k)` with k past the shrunken queue. Fix: after the toolbar click (and the
   sticker click), assert that the panel's up-next rows no longer list the picks.
4. **SUGGESTION - the server.js:4118-4125 comment overstates "Every reader of chapter-like
   membership routes through it".** `musicLikedSets` / `trackIsLiked` (server.js:4033) and the
   per-item `liked` flags read the raw set. They agree only because they look up ids of rows the
   expansion itself minted. Say "every reader that ENUMERATES a user's chapter likes (the POST,
   the Liked listing, the Stats count)".
5. **SUGGESTION - the Stats count re-expands the file once per chapter like** (lib/media/routes.js
   `likeCounts`), with no per-base memo. The Liked listing already pays the same cost, and it is
   pure and in memory, so there is no regression at this scale. A `Map` keyed by base inside the
   request would make it O(files).
6. **SUGGESTION - the sticker test's title claims "the row reads Off"**
   (test/unit/music-skin-integration.test.js, item 0). Nothing asserts the row's `aria-checked`
   after the click, only the pref and the nav.
7. **SUGGESTION - the watch-init shim now fires every kept listener, but ignores `{ signal }`
   aborts** (test/unit/watch-init-behavioral.test.js `makeEl`). A test that destroys and
   re-inits a view would see the dead view's listener fire, which the DOM would have dropped.
   Skip entries whose `opts.signal.aborted`.

Checked and clean: the D-0 own-queue semantics. No `queue` writer mutates in place, so picks
are always the tail and the retract moves no earlier index. The var-hoist of
`autoplayPicks` / `navIndex` runs before any `registerTrackNav` in the synchronous `init`. The
in-flight extend re-checks `autoplayEnabled()` after its await. `chapterLikeTrack` is
byte-equivalent to the old POST check, and both readers agree (#235 test re-run green).
`applyAdoptFlavor`: media items carry no top-level `album` field, so watch's spread cannot
declare one. CSS: specificity (1,1,1) beats `#settings-menu .settings-menu-toggle`, the rule sits
outside any media query, `body[data-view]` comes from `applyZoomPolicy` (`/watch.html` ->
`watch`), no `[hidden]` interplay and no raw literal. Tracker: #235 and #237 are CLOSED with
their binding named, and #243 is filed OPEN with a trigger. The id range does not collide
(chapter-snap holds 239-241, desktop-theatre 247, this branch 243). Expect a textual conflict
at the table tail on merge: keep every row. Plan anchors spot-checked (15 of them): accurate.

Security (standing section): no new surface. The Stats change can only LOWER a member's own
count, and base visibility (`has(visMap, base)`, built through `mediaVisibleTo`) is checked
before the expansion, so no title or count of a restricted item is reachable. The like id is
matched by `===` against minted ids after an anchored-regex parse. No injection path: the CSS
and HTML are static strings, and music.js writes no untrusted input to the DOM. The POST's
`restrictedVideoMutation` still runs first.

Gate: CHANGES r1 @020bec0a — qa

## Gate r1 - adversary (@020bec0a)

Instruments (Node v22.23.1, sandbox `git archive 020bec0a` in /tmp, node_modules symlinked; base
sandbox `git archive ecb61e1d`): the 10 touched/related test files 251 pass / 0 fail; the related
set (music-playback-modes, prefs-sync-client, rbac-census, stats-and-view, liked,
liked-mixed-kind, chapters-editor, music-actions-desktop + the doc censuses) 89 tests, 87 pass,
2 fail: both `comment-debt-census` TIER 1/2 with `EISDIR` in the SANDBOX (not a git repo, the
walk reads the node_modules symlink); the same file in the worktree: 5 pass / 0 fail. eslint
(6 source + 9 test files) exit 0; `npm run lint:css` TOTAL 0. Headless Chromium chromium-1234
over CDP (the builder's harness, copied). Mutants: 10 of the builder's re-run (M2a, M2c, M2e,
M3c, M4a, M4b, M4d, M4f, M4g, M1a): all KILLED. 4c: card-like 6006 / 6398 ms with `unref`,
9495 / 9532 ms without (8/8 pass each): verified.

**Surfaces that held (verified):**
- #235: `/api/stats` inventory.liked equals the Liked listing through fewer / more / retime
  (the test; M2a, M2b killed). Folder-kind RBAC on a chapter like in Stats is bound (AC5/AC12
  test). Every other reader of `user_liked` (`/api/videos`, `/api/home`, `/api/feed-hidden`,
  `/api/history`, the watch route, music `trackIsLiked`) is a per-item `likedSet.has(item.id)`
  flag, never an aggregate of `::c` rows; admin inventory is `likedStore` (#243). No new
  deletion path (the only `user_liked` deletes remain `removeLiked` on DELETE and
  `delLikedByMedia` on remove/prune; restore re-inserts every row). Revive holds (the test).
- Item 0 on a ONE-FILE chaptered album, real Chromium, 40 s file, chapters 0/10/20: C1 ON, last
  chapter, toolbar OFF -> up-next retracts to the 3 chapters, the end stops; C2 OFF throughout
  -> stops; C3 OFF then ON on the last chapter -> station appended at the click, end plays it;
  C4 ON, OFF, ON -> re-appended, end plays it; C5 storage-only '0' -> end refused, retracted.
  0 page errors.
- Item 1: cold /watch.html rows `flex` at 1600 and 390, the Autoplay row writes
  `autoplayNext` (false -> true -> false) on a cold watch AND after a music visit; SPA
  watch -> stats / history / music / tv all `none`; cold stats / history / tv / podcasts / home
  `absent`. Extra CSS mutants (rule hides only Autoplay; scoped to music only;
  `visibility:hidden`) all KILLED.
- Unclaimed item-0 mutants KILLED: retract never re-arms nav (U1), holds without retracting
  (U3), toggle skips reflectPlaybackModes (U4), navIndex never written (U7), onNext holds ANY
  entry when off (U8), retract drops only the next pick (U9); adopt writes an UNDECLARED
  autoAdvanceViaTrackNav / album (U10, U11). U5 (ON re-registers at any index) survives:
  equivalent, not a finding.

**Findings:**

1. **WARNING (regression vs ecb61e1d, verified) - Autoplay OFF then ON during a solo-chapter
   selection kills the solo exit's station.** `retractAutoplayPicks` nulls `soloExitPicks`, and
   `applyAutoplayToggle(true)` only re-arms the end-of-queue extension (`navIndex ===
   queue.length - 1`), never re-primes. Repro (jsdom, the reflect harness): solo-select
   chapter two (`.music-song-row[data-index="1"]`), drain, click the toolbar button twice
   (pref back to '1'), cross the segment end (130 -> 240). This branch: `film::c1` keeps playing
   (straight-through listen with Autoplay ON). ecb61e1d, same test: `sx1` (stations on). Mutant
   U6 (drop the nulling line) SURVIVES all 163 item-0 tests - the line is unbound AND it is the
   bug. Prescription, verified: delete `soloExitPicks = null;` from `retractAutoplayPicks` (the
   hand-off's own `if (!autoplayEnabled()) return;` already refuses an OFF exit): with it,
   OFF-then-ON stations on (`sx1`), OFF alone still refuses (`film::c1`), and
   music-chapter-reflect + music-skin-integration are 159 / 159. Bind both with a test.
2. **WARNING (test gap, verified) - the retract's up-next repaint is unbound.** AC0(b) claims
   "the up-next shows the truth" as bound. Mutant U2 (drop `updateNowPlayingPanel()` from
   `retractAutoplayPicks`) SURVIVES (163 pass / 0 fail). In Chromium under U2, C1 after the
   toolbar OFF still lists `Other One / Other Two / Other Three` below the last chapter (and
   C5 after the refused end the same), while HEAD shows the 3 chapters only. Add an assertion
   on the rendered up-next rows after OFF.
3. **WARNING (false plan claim, verified; the bug is pre-existing) - "Listen -> Watch adopt
   keeps autoAdvanceViaTrackNav ... measured harmless (the natural end on the watch page
   stops)" is wrong.** The builder's reverse probe drove only `a1`. Same probe per album
   position (server `autoplayNext` false, measured): `a1` stops; `a2` -> `a1`; `a3` -> `a2` -
   the watch page advanced to another video with autoplay OFF (the ledger's "a finished video
   may jump to the next one even if autoplay is off" bug, reproduced). ecb61e1d: identical.
   Prescription, verified in Chromium: add `autoAdvanceViaTrackNav: false` to watch.js's two
   `player.load` data objects (`mountedEarly`, `mounted`); this branch's own `applyAdoptFlavor`
   arm then clears it on the adopt, and `a1`, `a2`, `a3` all stop. Fix it (one field per call
   site, plus a player-adopt-flavor test) or, at minimum, correct D-3 and the disclosed gap
   to say it reproduces and file it.
4. **WARNING (enumeration gap in the #237 class, verified; safe to ship if disclosed) - the
   same-id adopt still keeps the watch load's `title` and `channelName`.** Divergent fixture
   (file title `file-a1`, channel `Uploader`, tags `Alpha One` / `Band`): Watch -> Music adopt,
   then the dock-return re-init. `getCurrentMeta` = `{title:'file-a1', artist:'Uploader'}` and
   the now-playing panel reads "file-a1 Uploader · Record"; the control (cold /music) reads
   "Alpha One Band · Record". Display only, pre-existing, no data at risk, so I do not block
   on it IF the tracker says so: #237 is marked CLOSED while its class is still open - file a
   row (or carry the two fields in `applyAdoptFlavor` when declared).
5. **SUGGESTION (verified in jsdom) - Autoplay OFF during a station pick's ALAC prewarm still
   starts that pick.** Picks with `needsTranscode: true`, the natural-end advance into the
   first (prewarm fetch held), toolbar OFF, release the fetch: `currentId` = `al1`, the nav has
   only `onPrev` (the retract dropped the pick from the queue because `navIndex` was still the
   previous track). The advance was committed while ON, so it is arguably "reached"; the
   visible cost is a playing track missing from the up-next. Cheap fix: re-check
   `autoplayEnabled()` / `isAutoplayPick(item)` in the prewarm ready arm.
6. **Suspicion (reasoned, not driven) - `immersiveCarryPending` stays armed when
   `autoplayHoldsAt` refuses.** player.js `fallbackToTrackNav` sets it BEFORE calling
   `onNext`, which now returns without loading (reachable via the storage-only flip). It is
   consumed only if the host is still immersive at the next load, so the effect is small.
7. **Suspicion (reasoned) - a dock-return re-init while a station pick plays (Autoplay OFF)
   rebuilds that pick's ALBUM as the queue** (the `?nowplaying=1` album restore), so its end
   plays on into an album the user never queued. Pre-existing re-init semantics; Dean's call.
   Also noted: after a storage-only flip the toolbar still reads `aria-pressed="true"` (C5)
   until the next reflect - pre-existing, adjacent to the disclosed prefs-sync gap.

Verdict: 1 blocks (a regression with a verified one-line fix); 2 and 3 block (an AC claimed
bound that is not; a plan claim measured false in the seam this branch edits); 4 can ship
disclosed. 5-7 are advisory.

Gate: CHANGES r1 @020bec0a — adversary
