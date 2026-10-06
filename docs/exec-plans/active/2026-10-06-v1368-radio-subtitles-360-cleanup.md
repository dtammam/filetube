---
plan: v1368-radio-subtitles-360-cleanup
harness: v2 · lean
branch: feat/v1.368.0-bundle
anchor: outcome
status: Kickoff
next: the Opus session runs the intake (section 3) with Dean, then writes sections 4-7 and hands the builds out
design: Dean's bundle pick 2026-10-06 (main d7b871cd, v1.367.0 shipped). No rulings yet except the three scopes.
gate: pending
---

# v1.368.0 bundle: old-Settings cleanup, music radio, desktop subtitles, 360 on the phone's own controls

This is a KICKOFF brief, not a build plan. Nothing here is ruled except the scope. The Opus session's job is the intake: ask
Dean the questions in section 3 (outcomes before solutions; try to make each problem not worth solving), measure what section 3
says to measure, then write the build waves, rulings table and gate into sections 4-7. Dean's norms: autonomous to done once
ruled, honest assessment, his device pass is the arbiter, no step-by-step ceremony narration, no em dashes in docs or user prose.

## 1. The four pieces, and the order proposed

1. **Remove the old Settings names and ids** (tech debt, small, no product question). Spec is already in ROADMAP Planned
   ("Remove the old Settings names and ids"). Needs one ruling: an old Settings bookmark lands on the menu's first page (Dean
   said keeping it is debt for no reason; confirm that is his ruling, then it is a plain delete).
2. **Desktop subtitles you can move and resize** (ROADMAP Planned, Dean 2026-10-05). Desktop only. Client work in player.js.
3. **360 view with the phone's own controls** + the v1.366.0 follow-ups (a)-(g) (ROADMAP Planned, Dean 2026-10-06: "it must work
   with phone controls too"). Device-bound: iOS facts only an iPhone settles.
4. **Music radio: less simple, less repetitive** (ROADMAP Planned, Dean 2026-10-06). Design first; the largest piece.

Proposed release shape (Dean may change it): one branch, waves in this order (1, 2, 3, 4 behind a measurement), one release
v1.368.0, or split radio into v1.369.0 if its design is big. Ask.

## 2. What exists (verified 2026-10-06; re-verify before building)

- Settings compatibility layer: `data-md-aliases` on the `.md-root` in `public/setup.html`; `resolveKey` + the stored `ft-md:setup`
  rewrite + the `pending` key in `wireMasterDetail` (`public/js/common.js`). KEEP `pending` (it also serves a plain `#users` link
  while an admin page is hidden); remove the alias map. Tests that pin the old ids: `test/unit/setup-master-detail.test.js`
  (OLD_TO_NEW, the stored-old-selection case, the 18-pages table). Live text with old names: grep "Automation & Storage", "Resume
  rows", "Critter sound check", "Video folders", "Music folders", "Book folders", "Shows folders"; `public/assets/icons/README.md:201`;
  DEVICE-CHECKS/doc paths saying "Settings > Mobile player" for the custom-controls switch (it lives in Experimental).
- Subtitles: desktop video uses the browser's own `<track>` rendering (stylable with `::cue`, not draggable or resizable). The
  custom caption overlay (player.js ~1716, built from `cuechange`) exists only for audio / cover art. `lib/subtitles.js` is the
  server side (sidecar discovery/conversion). Must not break: the native-cue path on iPhone, caption timing, current caption
  styling, clicks on the picture (a drag must never pause or seek).
- 360: `public/js/vr-view.js` draws the sphere in a WebGL canvas over FileTube's own player; shown on a phone only with Settings >
  Experimental > "Use custom player controls on touch devices" ON. With native controls the video element owns picture and gestures,
  so the 360 row is hidden. v1.366.0 follow-ups (a)-(g) are in ROADMAP "360 view follow-ups (v1.366.0 gate r2)".
- Radio (called Autoplay in the UI): `public/js/music.js` ~1144 (the per-device switch `ft-music-autoplay`, default on), ~4099-4230
  (`fetchAutoplayPicks`, `maybeExtendQueueForAutoplay`, `primeSoloExitStation`). When the LAST queued track starts it appends 5
  picks: up to 3 random same-artist tracks, then a random library page (60 fetched, 5 kept); excludes the queue and this page
  session's played ids (in memory); a recycle arm relaxes that so it never ends in silence; Autoplay off retracts unplayed picks;
  never in Listen mode. Seeded random (`Date.now() % 100000`) via `/api/music?...&sort=random&seed=` (`lib/music/query.js`).
  History: v1.254.0 endless autoplay, v1.284 desktop button, v1.311 chapter-album exit station. No named stations, no "start radio
  from this", nothing steers the picks (no likes, plays, skips, genre, year, recency). Open taste question from v1.254: a lone
  chapter of a DJ-set album can be picked.

## 3. Intake: ask Dean, measure first

**Cleanup:** confirm the bookmark ruling (above). Nothing else.

**Subtitles (ask):** drag on the captions themselves, or an edit mode? Where does size live: a corner handle, Settings, or both?
Per device or synced to the account? Does the position carry into full screen, theatre and the pop-out? Phones untouched (the
ROADMAP says so; confirm). A "reset position" control? **Measure:** how the overlay for audio is built and whether video can reuse
it unchanged; what the browser's `::cue` can already do (size via Settings alone may be a cheaper answer to "resize").

**360 on native controls (ask):** the ROADMAP's own three questions, all device facts: can a canvas sit over a native-controls
video on iOS and still let its controls work; does iOS take the video to its own full screen on play; would a "360 view" button
switch that one video into FileTube's player. Dean has the iPhone; the Opus session may need to build a tiny probe page and ask
Dean to run it before choosing (LESSONS 8, 12). Also ask which of follow-ups (a)-(g) he wants in this release (a and c are cheap
hardening; d is a UX ruling; e, f, g are server/scan edges).

**Radio (ask, outcomes first):** what does "too simple and repetitive" sound like in a real session (an album coming back, the
same artist, the same few songs)? Which of these matters most: start a station from a song / artist / album / genre; weight toward
likes and finishes and away from skips; a longer memory (persist the played list, cool-downs per artist and per album); mix of
familiar and new; named stations (Favorites, Genre, Throwback); a radio row in the pocket skins and the speaker's now-playing.
Try to make it not worth solving: is a cooler-down memory plus a like-weighted draw enough, with no new UI? **Measure before
design:** (1) which signals the library stores per track (likes, history, genres, play counts, skips) and their cost to read;
(2) simulate a 1-hour session with today's picker over the real library and report artist and album repeat counts and how often
a just-played album returns. That number is the baseline any change must beat.

## 4. Rulings (Dean's answers; empty until the intake)

## 5. Waves (the Opus session writes these; one wave per piece, a falsifier each)

## 6. Gate

Not set. Default for this repo: adversary + qa (UI on every changed surface, security brief as a section). A destructive or
data-losing change would force the full gate; none is expected (radio reads the library; settings cleanup deletes UI plumbing).

## 7. Release and evidence

Release per `docs/RELEASING.md` and AGENTS.md: protected main, tag the local no-ff merge on a throwaway branch, push branch + tag
in ONE push, `gh pr create`, required checks (ci 22, ci 24, audit, secret-scan) green, `gh pr merge --merge`, the tag's "Publish
Docker Image" green in every job. Evidence the builder fills: census/measurement outputs, suite counts on Node 22.23.1 and
24.20.0, mutants by name, device checks Dean owes.

## 8. Out of scope

Everything else on the ROADMAP (queue editing from the phone, search outside Music, skins keyboard search, onboarding, speakers,
download-row follow-ups). Anything found goes to ROADMAP Planned.
