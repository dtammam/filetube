---
plan: remove-from-start
harness: v2 · full
branch: feat/v1.410.0-remove-from-start
anchor: outcome
status: Building
next: gate r2 (same seats)
design: Dean 2026-11-25 (below); rulings R1-R2 from AskUserQuestion
gate: none yet
builder: standard
---

# v1.410.0 - Remove from start: drop the text every song name shares

Kickoff 2026-11-25 (FileTube Root, Opus). **Builder: Standard (Sonnet).** Why the tier: a client-only change inside
one existing sheet (the playlist picker), no server, no files touched on disk, a pattern already in place
(`stripArtistPrefix`, `albumTouched`).

## Why

Dean, 2026-11-25: a playlist he downloaded as an album had every song named "<Something> Original Soundtrack - <song>".
Clean up titles took the noise off the end but not that shared start. He wants to "somewhat flexibly" remove the
beginning when everything in the playlist starts with the same text.

## Rulings (Dean, AskUserQuestion 2026-11-25)

- **R1 - a prefilled field.** A "Remove from start" field under Save as an album, prefilled with the text every song
  shares (cut at a separator or word boundary), editable, clearable. The rows show the result live.
- **R2 - new downloads only.** Songs already in Music are out of scope (no bulk rename, no tag rewrites).

## Where it lives (read first)

- `public/js/common.js`: `openPlaylistPicker` (~8221), `stripArtistPrefix` (~8185), `songName` (~8432),
  `albumTouched` (~8298), the `load()` defaults (~8508), the POST body `titles` map (~8550).
- The server writes the picker's names as they are (`lib/ytdlp/album.js` `albumTagArgs`, the `title` branch). **No
  server change.**
- Tests: `test/unit/playlist-picker-client.test.js` (the jsdom picker harness, Dean's real Kyle Gordon fixture).

## Acceptance (outcome anchor)

1. With Save as an album on, a **Remove from start** field shows in the album's fields (after Album artist). It is
   prefilled with the shared start of the loaded songs' names, computed AFTER the noise cleanup and the artist prefix
   (i.e. over what the rows would show without it), when Clean up titles is on. With Clean up titles off it is hidden
   and removes nothing (it is part of the cleanup).
2. **Detection** (export a pure helper, e.g. `sharedTitlePrefix(names)`): over the loaded rows that have a title and are
   not unavailable, at least 2 of them. Take the longest common prefix (case-insensitive compare, the first row's
   spelling), then cut it back to the last **separator** boundary: a run of `-`, `–`, `—`, `:`, `|`, `~`, `·`, `/`
   with its surrounding spaces (so "Game OST - " is kept whole, including the trailing space). No separator in it ->
   cut back to a word boundary only when what remains is **3 or more words**; else no suggestion (empty field). So
   "The Battle" / "The End" suggests nothing. A prefix that would empty any song's name is not suggested.
3. **Removal** (`songName`): when the field is non-empty and the name starts with it (case-insensitive), the start is
   removed, then any leading separators and spaces left over (Dean may type "Game OST" without the " - "). A name that
   would become empty is kept whole (same rule as `stripArtistPrefix`). A song that does not start with it is
   unchanged. A rename the user typed wins, untouched.
4. The field follows the loaded rows until the user types in it (the `albumTouched` pattern; Load more recomputes
   the suggestion), then keeps what was typed. Clearing it = nothing removed. Max 200 characters. Every row, the Cover
   row's line and the POST `titles` map follow it live (they all go through `songName`).
5. Video playlists and Save as an album off: no field, nothing changes. The POST body shape is unchanged (names go in
   `titles` as today); no new server field.
6. UI is the existing kit (`U.field`, the same as Album / Album artist); measured at 320 px and desktop, no overflow
   (button-layout measurement norm: probe before/after).

## Waves

- **W1 - helper + tests.** `sharedTitlePrefix` and the removal, unit-tested on: Dean's case ("Some Game Original
  Soundtrack - Opening", "... - Battle", "... - Ending" -> "Some Game Original Soundtrack - "); en/em dash and colon
  separators; mixed case; one row (none); "The ..." titles (none); a 3-word shared start with no separator (cut at the
  word); a prefix equal to one whole name (none); typed text without the separator (leftover " - " trimmed).
- **W2 - picker wiring + jsdom test.** Extend `playlist-picker-client.test.js`: the field shows/hides with the two
  switches, is prefilled, the rows show the stripped names, typing changes them, clearing restores them, a custom
  rename wins, Load more re-suggests until touched, and the POST `titles` carries the stripped names. Mutate the
  removal call and watch the test go red (LESSONS: presence-not-binding).
- **Docs in the release commit:** ROADMAP entry, `docs/releases.json`, a DEVICE-CHECKS section "Remove from start
  (v1.410.0)": (a) the soundtrack playlist suggests the shared start, (b) the rows show clean names, (c) editing and
  clearing the field, (d) the downloaded songs carry the clean names in Music. A LESSONS line only if the gate finds a
  new bug class.

## Release

v1.410.0 per docs/RELEASING.md + AGENTS.md: the protected-main flow (tag the local no-ff merge, push the release
branch + tag in one push, `gh pr create`, CI green). Merge on Dean's word. Close the plan out in the same PR
(`node scripts/plan-complete.js` ... `"Shipped v1.410.0" --apply`). Shipped = the tag's Publish Docker Image run green.

## Out of scope

Songs already in Music (R2: no bulk rename, no tag rewrites); removing text from the END or the middle; video
playlists (no song names there); any server change. Ideas go to ROADMAP.md Planned.

## Step 0

Read AGENTS.md, docs/LESSONS.md (2 reachability, presence-not-binding, lying comment), docs/CONTRIBUTING.md.
Environment per AGENTS.md (fnm PATH). Worktree `.claude/worktrees/feat-v1.410.0-remove-from-start`; stage by name, no
force-push, no --no-verify. Targeted tests while building; the full dual-Node suite once before the gate. Stop rule
(ask Dean): the detection rule in 2 suggests something wrong on Dean's real playlist shape, or the field cannot fit the
album fields at 320 px without a layout change.

## Evidence

Build: W1 e0a7d4bf, W2 45cfc6b9, base 810940ce.

- Full suite at 45cfc6b9 (`npm test`): Node 22.23.1 and 24.20.0 each 13529 tests, 13516 pass, 0 fail, 0 cancelled, 13 skipped.
- Targeted: playlist-picker-client + shared-title-prefix, 70 pass. 13 mutants of the helper and wiring, each red (removal call 6,
  hide with clean off 1, touched guard 2, touched set 2, live re-render 1, unavailable filter 3, syncStart call 4, maxLength 1,
  inside-word guard 1, 3 words 4, empty-name guard 1, empty start guard 1, min two 1).
- Real Chromium, 320 and 1280 wide: no horizontal overflow (sheet and document 0), the new field the same box as Album artist
  (224x64 at 320, 356x64 at 1280), not displayed with Clean up titles off, no page errors.
- Seen while measuring, NOT this change (same on base 810940ce): at 320 px the picker song rows squeeze a name to a few letters
  per line. Goes to ROADMAP Planned.

Builder calls beyond the letter of the acceptance:

1. A `-`, `:`, `·` or `/` run tight between two letters or digits ("Spider-Man", "AC/DC", "Re:Zero") is part of the word, not
   a separator (R1: "cut at a separator or word boundary"). The literal rule would suggest "Spider-".
2. The suggestion is read from the cleaned names, never from a typed rename (a rename is not removed from either).
3. With the album artist left at its default for a "<name> - <song>" list, that name IS the artist and Clean up titles already
   drops it, so the field is empty; it fills once the artist is changed.

Gate r1 (both CHANGES, no CRITICAL) and what was done:

- adversary W1: the leftover trim ate a song's own opening mark ("~Reprise~" -> "Reprise~", written to the tags). Fixed:
  this narrows acceptance 3's "then any leading separators": a start that ends in its own separator takes nothing more;
  a mark after a space and glued to the next character stays; detection does not cut after such a mark.
- adversary W2 (stated behaviour unbound): tests added; its survivors re-run, 17 mutants each red.
- qa W1 (the video test could not fail): rewritten to switch a shortened album to Video. qa W2 (stale comments): fixed.
- qa S5: that assertion's message reworded. Not taken, to ROADMAP Planned: a cut inside an open bracket; a video listed
  twice and nothing else suggests from its own name; non-BMP letters and combining marks beside a tight hyphen.
- Disclosed to Dean: the plan's own rules can shorten to a fragment ("My Great Game Part 1/2" -> "1"/"2"; "The Legend of
  Zelda"/"... of Mana" -> "Zelda"/"Mana"), and unspaced "...Soundtrack-Opening" suggests "Some Game Original ".

## Gate

(seats write verdicts here)

Gate: CHANGES r1 @83be892f — qa
Gate: CHANGES r1 @83be892f — adversary
