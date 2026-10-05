---
plan: small-things
harness: v2 · lean
branch: feat/v1.363.1-small-things
anchor: spec
status: Shipped v1.363.1
next: build W1 -> W2 -> W3, gate (adversary + qa, full: W2 is a destructive editor), release v1.363.1
design: Dean's three ROADMAP Planned items, 2026-10-05 (main fa21f654, v1.363.0 shipped).
gate: APPROVED
---

# v1.363.1: small things - theatre button colours, the chapter editor from audio and the pop-out, Watch in the pop-out

## 1. The outcome (what Dean will see)

W1. The music player's theatre button shows the right colour for each state (off grey, on red), in light and dark and every era.
W2. A chapterless mp3 (a 47 minute mix) can get its chapters: **Add chapters** / **Edit chapters** in the music player's Extras
    (mobile sticker page and desktop actions menu), as a row in the pop-out's sticker menu, and as a row in the watch page's
    settings cog. It is the SAME editor the watch page has; saved chapters are the file's chapters (chapter list, chapter tracks,
    resume) exactly like embedded ones.
W3. The pop-out has the Watch row the main player has (a video file only; an audio-only file shows no row, never a dead button).

## 2. Root causes (by reading code)

W1. Not reproduced yet (see section 6): the state-to-colour pairs are right in jsdom's resolved cascade in all 18 cells; no swap made.
W2. `#chapter-now` (the watch page's only path to the editor) is hidden for an item with fewer than 2 chapters, and no other
    entry exists. A chapterless file can never get its first list. Same gate stranded chapterless videos.
W3. `watchBack` was gated `inMainDoc &&` because its tap navigates the window behind the pop-out. The view's tap now focuses the
    main window first.

## 3. Design notes

- No new editor: `showChaptersEditor(baseId, lines, onSaved, doc, {version})` in common.js; POST /api/videos/:id/chapters replaces
  the manual list wholesale and 409s on a stale version.
- DATA LOSS rule: the editor seed is fetched from STORAGE at tap time (`/api/videos/<base>`: resolved chapters + version token),
  never the queue / a menu-captured item / a searched subset. The `::c<n>` suffix is stripped to the file id.
- The playing raw track keeps playing untouched after a save; new chapter tracks appear on re-list and the next pick.

## 4. Waves

W1 probe + binding test. W2 chapters entry points. W3 pop-out Watch. One commit per wave group; mutants on committed work.

## 5. Gate brief

Full gate, never slimmed. Adversary: DESTROY the chapter data (stale seed, searched subset, a `::c` id, a version conflict, clear to
empty, save while the song changes, the pop-out document). QA + security brief: write-RBAC gate (fail closed), the pop-out
document handoff, no new route.

## 6. Build log

- W1: probe tools/theatre-proof/probe-theatre-colour.js (scheme x era x scenario) and test/unit/theatre-button-paint.test.js (18 cells
  plus its mutants). Not reproduced; no swap. The adversary measured 2009/2014/2021 light and dark, cold and SPA, real click: ON red,
  OFF ink everywhere; hidden at 1024 px and below. The committed probe covers era 2021 at 1440 only (its "each era" comment is loose).
- W2+W3 failing-first: skin-surface U2 assertion inverted (pop-out now HAS the Watch row) and three new skin-surface tests, two
  music-skin-integration tests, three player cog-row tests, all written with the code (passing on first run, so binding is proven by
  mutants below, not by a red-first run).
- Mutants on COMMITTED 12ee6b2c in a /tmp git-archive sandbox, all red: version token dropped; music capability dropped; cog
  capability dropped; cog view gate dropped; pop-out `!inMainDoc` dropped; Watch visible() ignored; Extras label swapped; Extras
  canModify dropped; onTap(doc) -> onTap(). Round 1 gate found seven more unbound guards (adversary); d20a470c binds them: song-change
  guard, aborted guard, whole afterChaptersTextSave (re-list behavioural, invalidate+patch source-ordered), cog sync call site,
  desktop and phone onChapters, the [hidden] rule. Builder re-run: all red except the invalidate/patch deletion (source-order only);
  adversary r2 re-ran its nine: all red.
- Lint hook deviations: probe lint (`localStorage` global), ui-lint (new bespoke buttons: fixed with `ui-btn ui-btn--plain` on the three
  new controls; the sticker rows lose to the menu's more specific rules, adversary measured no regression in 3 eras).
- Suites verbatim: Node 22.23.1 `tests 11029 / pass 11017 / fail 0 / skipped 12`; Node 24.20.0 identical. (Run at 12ee6b2c; d20a470c
  adds tests only and ran under its own pre-commit unit suite.)
- Gate: QA APPROVED r1 @12ee6b2c; adversary r1 CHANGES @12ee6b2c, r2 APPROVED @d20a470c.

## 7. Device checks (Dean)

- Pop-out: sticker menu shows Add/Edit chapters and Watch (video file); the editor opens IN the pop-out window.
- Add chapters on a chapterless mp3 on desktop; chapter tracks appear after re-list and the next pick.
- Watch page cog shows Add chapters on a chapterless video.
- Theatre button colour on the device where it looked flipped (state the device, scheme, era).

## QA gate

Reviewed 12ee6b2c vs fa21f654. Verified: eslint 0 errors (6 pre-existing warnings, none in changed lines), lint:ui OK, lint:overlay clean, 237/237 targeted tests pass (Node 22.23.1). Server POST /api/videos/:id/chapters already fails closed (requireModifyLibrary + restrictedVideoMutation); no new route. Seed is fetched from storage at tap time with version token, sub-second-lossless stamp. Mutants (11, /tmp archive): RBAC drops (cog, Extras, music), watch-view gate, pop-out-only gate, id mismatch check, row render all caught.
- CRITICAL: none.
- WARNING: none.
- NOTE 1: dropping the `extrasBaseId() !== baseId` song-moved guard (music.js openChaptersEditorForPlaying) survives all tests; consequence is only an editor opening for the previous file (self-consistent id+seed, no data loss), but it is unbound.
- NOTE 2: `escapeHtml(chLbl)` and the `window.focus()` in watchBackTap and the `#chapters-edit-btn[hidden]` CSS rule have no binding test (jsdom has no cascade/focus); labels are code-controlled so no injection. Device check covers them.
- NOTE 3: pop-out row label uses the `::c` id heuristic ("Add" for a raw track that has embedded chapters); label only, seed is from storage.

Gate: APPROVED r1 @12ee6b2cfd26a194835a0763c6d32a774fd6c666 - qa

## 8c. Adversary gate r1 (measured; mutants in a /tmp git-archive sandbox, real-browser probes against the real server)

Verified LIVE (headless Chromium, real server, real shapes): pop-out row renders the editor IN the pop-out document (not the main one),
seed = storage (3-chapter `song1::c1` file, seed "0:00 Alpha\n0:20 Beta\n0:40 Gamma"), 409 on a stale version (stored list untouched),
clear-to-empty keeps the track playing, song change / SPA view swap mid-fetch opens no editor, desktop actions menu, phone Extras page,
pop-out and watch cog all REACHABLE, write is fail-closed in the unit stubs, audio-only pop-out shows NO Watch row, listen video Watch
from the pop-out navigates the main window, closes the pop-out and resumes at the live position. W1: theatre colour re-measured in 3 eras x
light/dark x cold/SPA round trip + real mouse hover/click + 1180px touch: ON red, OFF ink, icon fill follows; NOT reproduced (honest). No CRITICAL.

WARNING W-A (presence-not-binding, 7 surviving mutants; behaviour is correct today, nothing binds it): all of these pass 225/225 with the guard deleted:
 (1) music.js `extrasBaseId() !== baseId` (song changed mid-fetch) and (2) `signal.aborted` in openChaptersEditorForPlaying;
 (3) the whole `afterChaptersTextSave` body (invalidateMenuData, applySnappedChapterTimes, the render guards) has NO test;
 (4) player.js `syncChaptersEditRow()` CALL SITE in the cog click (the test lifts only the block, so the row can never appear and stay green);
 (5) music.js desktop `onChapters:` (ensureDesktopExtras) and (6) the sticker `extras.onChapters:` (phone Extras) hooks, each deleted = green;
 (7) `#settings-menu #chapters-edit-btn[hidden]` CSS rule (jsdom cannot see it). Also unbound: `window.focus()` in watchBackTap, `eligible` in chaptersEditable.
 Prescription: tests that fire a song change / abort between tap and fetch resolution and assert showChaptersEditor NOT called; drive
 afterChaptersTextSave via the onSaved callback and assert the queue patch + invalidate; assert the cog row exists after a real settingsBtn click
 in a player.js harness (or a source-binding check on the call); assert cfg.extras.onChapters and the desktop createExtrasMenu opts carry the hook.
NOTE: notifyLibraryChanged fires on the POP-OUT document, so main-document library-changed listeners do not hear a pop-out save (afterChaptersTextSave
 covers the music view itself; harmless today). NOTE: if the pop-out closes during the save request the sheet's teardown is best-effort and onSaved
 still runs (measured only for the open case; suspicion for the closed case). NOTE (suspicion, not measured): a real small PiP window may clip the
 now-taller sticker menu. NOTE: W1's committed probe only covers era 2021 desktop (comment says "each era"); I measured 2009/2014 myself.

Gate: CHANGES r1 @12ee6b2cfd26a194835a0763c6d32a774fd6c666 - adversary

## 8d. Adversary gate r2 (delta, tests only; mutants re-run in a /tmp git-archive sandbox of d20a470c)

Baseline 230/230. Every r1 W-A mutant now RED (229/1): song-change guard, signal.aborted (both openChaptersEditorForPlaying and
afterChaptersTextSave), invalidate deletion, queue-patch deletion, cog sync call site, desktop onChapters, phone extras.onChapters,
[hidden] CSS rule. Item (3): the source-order witness is ACCEPTABLE (the invalidate+patch pair is the only half with no behavioural
witness; the re-list half is behavioural). Its known weakness: `if (false) invalidateMenuData();` survives (230/230) - contrived, not
a regression a real edit produces; no further witness demanded. Still unbound, accepted as NOTE: `window.focus()` in watchBackTap
(device-only effect) and the `extrasEligibleView()` term in chaptersEditable (native-track case; the server 404 path toasts).
Pop-out closing mid-save and small-PiP clipping go to device checks. No production change since 12ee6b2c (diff is tests + plan doc only).

Gate: APPROVED r2 @d20a470c251ddcf99f01e3ef4132f8ddb9193eaf - adversary
