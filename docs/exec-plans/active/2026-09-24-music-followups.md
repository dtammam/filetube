---
plan: music-followups
harness: v2 · lean
branch: fix/music-followups
anchor: spec
status: Building
next: gate r1 - the FULL gate (adversary + qa + security-brief): item 2 touches how chapter likes are counted, the data class. Brief the adversary to DESTROY a chapter like through any chapter edit and to break the Autoplay-off retract.
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
  bound by a mutant (M-4g below); no edit.

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
  (+1, "#235"); `test/unit/music-chapter-reflect.test.js` (+4, the toolbar button added to its
  HTML); `test/unit/music-skin-integration.test.js` (+2: the sticker retract, item 4f);
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

## Instruments (Node v22.23.1, this tree before the commit)

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

(Pending: run in a /tmp sandbox built from the committed sha after the build commit; recorded
in the next commit.)

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
