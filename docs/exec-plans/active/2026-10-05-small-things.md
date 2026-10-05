---
plan: small-things
harness: v2 · lean
branch: feat/v1.363.1-small-things
anchor: spec
status: In build
next: build W1 -> W2 -> W3, gate (adversary + qa, full: W2 is a destructive editor), release v1.363.1
design: Dean's three ROADMAP Planned items, 2026-10-05 (main fa21f654, v1.363.0 shipped).
gate: pending
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

(filled in as the waves land)

## 7. Device checks (Dean)

- Pop-out: sticker menu shows Add/Edit chapters and Watch (video file); the editor opens IN the pop-out window.
- Add chapters on a chapterless mp3 on desktop; chapter tracks appear after re-list and the next pick.
- Watch page cog shows Add chapters on a chapterless video.
- Theatre button colour on the device where it looked flipped (state the device, scheme, era).
