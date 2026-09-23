---
plan: sub-bell-polish
harness: v2 · lean
branch: fix/sub-bell-polish
anchor: spec
status: Building
next: build B1 (in-place row bell) + B2 (the chip joins the .btn family) with their tests; measure per theme x mode with scripts/sub-row-chip-probe.js and the action-row probe; dual-Node suites; gate (adversary + qa + security-brief, forced by the lib/ytdlp/client glob); release v1.316.0 per docs/RELEASING.md
design: Approved 2026-09-23 @8536f399 (Dean: "GO." on the wave register D1-D4, recorded on feat/music-channel-chapters at 10c3be1e; this branch is the first slice of docs/exec-plans/active/2026-09-23-music-channel-chapters-wave.md)
gate: pending
---

# Subscription bell polish: no page refresh on toggle, the chip styled per era

Dean (from v1.314.0): "make sure the notification bell we picked not only doesn't refresh the
subscription page on toggle but is styled appropriately with the design language per theme."

Base: main 8536f399 (v1.315.0). The wave umbrella (register D1-D15, intake record, survey
anchors at v1.314.0) lives on `feat/music-channel-chapters`; this doc carries only the two bell
items and their bound markers (one piece, one plan).

## Decisions (from the wave register, Dean's go 2026-09-23)

| ID | Decision |
|----|----------|
| D2 | B1: after the PATCH resolves, update the clicked row IN PLACE from the response (glyph, `-active`, aria) and patch the record in `currentSubs`; no `loadSubscriptions()`. A non-2xx logs and leaves the row. Pause keeps its reload (out of scope). |
| D3 | B2: the row's bell, pin and kebab chips share the `.btn` rule family (a `btn btn-chip` variant) rather than a hand-copied per-era override. |
| D4 | B2 proof: computed-style + pixel sampling of the chip vs the era's `.btn`, side by side on one page, per theme x mode (2005/2009/2014/2021 x light/dark), plus the action-row probe before/after. The numbers are recorded below. |

## Diagnosis (read, not theorised)

- **B1 - the refresh.** `toggleBell` (lib/ytdlp/client/subscriptions.js) did `PATCH` then
  `loadSubscriptions()`, which clears the list, paints five skeleton rows, re-fetches
  `/api/subscriptions` and rebuilds every row. That IS the refresh Dean sees. The ~2.5s poll
  already updates rows in place (`applyStatusUpdatesInPlace`, keyed by `data-sub-id` through
  `rowElementsById`), and the watch page bell (`handleToggleBell`) already updates in place from
  the PATCH response. The PATCH route returns the updated record (`res.json(updated)`), so the
  response carries `pushBell`.
- **B2 - the styling.** `.sub-row-pin, .sub-row-bell` (and `.sub-row-kebab`) were ONE
  token-driven chip rule: `--bg-color` fill, a two-tone bevel border, `--radius`. That inherits
  each era's COLOUR tokens but never its control TREATMENT: the 2009 gloss is a
  `background-image` declared on `.btn` only (style.css :556/:567), the 2005 flat look, 2014
  flat and 2021 shadow all ride `.btn`'s `--btn-bg` + `--shadow`. The watch page bell is a
  `.btn` and already takes every era treatment; the row chips did not.

## Design

- **B1.** One writer of the bell's rendered state: `applyBellState(bellBtn, on)` (module
  level) sets class / aria-label / aria-pressed / glyph; `createSubscriptionRow` calls it at
  build time and `applyBellUpdateInPlace(rowElementsById, subId, on)` calls it after a PATCH
  (it finds the row's bell by class token, so it works on the real DOM and the unit fake).
  `toggleBell` disables the bell for the flight, PATCHes, and on 2xx reads `data.pushBell`
  from the RESPONSE (never the request), patches `sub.pushBell` + the `currentSubs` entry by
  id (the next tap reads it; a search-keystroke re-render rebuilds from it), then updates the
  row in place. A non-2xx logs `data.error || status` and leaves the row. `rowElementsById`
  is read at RESPONSE time, so a re-render mid-flight still lands on the live row.
- **B2.** A `.btn-chip` variant right after `.btn:active`: squares the box
  (`--size-control-sm`), drops the text padding, centres the glyph, rest colour
  `--text-secondary`. It declares NO background, border, radius or shadow of its own, so those
  can only come from `.btn` (locked by test). The three chip builders write
  `btn btn-chip sub-row-<x>`; the old chip rules keep only their state colours (hover red,
  active gold, the kebab's larger glyph).

## Acceptance (each names its binding test)

- AC1 (B1): toggling a row bell issues exactly one PATCH and NO `/api/subscriptions` list
  fetch after the initial load; the row element identity is unchanged after the toggle; the
  glyph/class/aria follow the RESPONSE (a response that differs from the request wins); the
  second tap sends the flipped value (the record was patched). `test/unit/sub-bell-in-place.test.js`
  (the real view mounted in jsdom, a routed fetch spy, driven clicks).
- AC2 (B1): a 403 leaves the row byte-identical (class/aria/glyph/identity), logs once, and
  still issues no list fetch. Same file.
- AC3 (B1): one writer - the source carries the bell glyphs exactly once (inside
  `applyBellState`), the row builder calls it, `toggleBell` no longer calls
  `loadSubscriptions`. `test/unit/sub-row-chip-btn-family.test.js`.
- AC4 (B2): every chip (pin, bell, kebab) is built with `btn btn-chip`; no rule targeting a
  chip class declares background / border / radius / shadow / size (vendor + case variants
  included); `.btn-chip` declares none of those either; the 2009 gloss still targets `.btn`.
  `test/unit/sub-row-chip-btn-family.test.js`.
- AC5 (B2, measured): for each theme x mode the chip's computed background-color,
  background-image, border colours, border-radius and box-shadow equal the era `.btn`'s on the
  same page, and the sampled top/bottom band pixels match the reference button's
  (`scripts/sub-row-chip-probe.js`, numbers below). The watch action row's `.btn` geometry is
  byte-identical before/after (`scripts/action-row-probe.js` at 390 and 1280).
- AC6: the existing v1.314 row tests keep passing with the new class shape (bell before the
  kebab, after the pin; off/on/junk/no-id arms; click never opens the settings sheet).

## Out of scope
Pause's page reload (same shape as B1, later); per-user bells; #233's in-flight race across an
unsubscribe on the WATCH page (this branch only disables the ROW bell for its own flight).

## Build record

- B1: `applyBellState` / `findBellButton` / `applyBellUpdateInPlace` (module level, exported);
  `createSubscriptionRow` routes its bell through the writer; `toggleBell` disables the bell for
  the flight, PATCHes, and on 2xx patches `sub.pushBell` + the `currentSubs` entry and updates
  the row in place from `data.pushBell`; a non-2xx logs and leaves the row.
- B2: `.btn-chip` after `.btn:active`; pin/bell/kebab built as `btn btn-chip <role>`; the two
  old chip rule blocks keep only their state colours; one phone-block exemption
  `.btn-chip { min-height: var(--size-control-sm) }` because the v1.95 `.btn { min-height: 44px }`
  touch floor otherwise stretched the square chip to 32x44 (measured at 390px, first cut).
- Tests: `test/unit/sub-bell-in-place.test.js` (4, the real view in jsdom),
  `test/unit/sub-row-chip-btn-family.test.js` (5), the v1.314 lock in
  `ytdlp-subscriptions-client.test.js` rewritten to the in-place shape, its chip-class
  assertions moved to a role-token helper.
- Instrument: `scripts/sub-row-chip-probe.js` (new; raw CDP, the tree's real row builder, a
  `.btn` reference on the same page, computed styles + 1x1 pixel bands, 2 widths x 4 themes x
  2 modes, a theme read-back guard). Its first cut was VACUOUS twice - common.js re-applied the
  saved theme over the query's, then the phone emulation laid out at 980px without a viewport
  meta - both caught by adding the read-back guard, both fixed in the instrument.

### Mutation check (committed tree 26cd0906, `git archive` sandbox, the three binding files)

Baseline green. 13/13 mutants killed: M1 re-fetch the list after the PATCH (AC1 x2 + the lock);
M2 glyph follows the REQUEST (anti-echo + lock); M3 record not patched (AC1 + lock); M4 row
rebuilt instead of updated (AC1 + lock); M5 a non-2xx flips the row (AC2); M6 the builder writes
the bell class itself / drops btn-chip (AC1, AC4, AC3 + 2 more); M7 the kebab leaves the .btn
family (AC4 + the anatomy test); M8 applyBellState forgets aria-pressed (5 tests); M9 a chip role
rule paints `-WEBKIT-BACKGROUND-IMAGE` (AC4 vendor+case); M10 `.btn-chip` declares `Border:`
(AC4); M11 the 2009 gloss moves onto a per-chip copy (AC4 x2); M12 the phone floor exemption
dropped (AC4); M13 `.btn-chip` moved before `.btn` (AC4 source order).

## Measurements (D4 / AC5)

`scripts/sub-row-chip-probe.js`, BEFORE = `git archive main` (8536f399), AFTER = this branch.
Per width x theme x mode: the bell chip's computed background-color / background-image /
border colours / border-width / border-radius / box-shadow vs the reference `.btn` on the same
page, and the top/bottom band pixels (x = left+6, y = top+3 / bottom-4).

| Run | Combos | Style diffs (bell vs `.btn`) | Chip box | Pixel bands |
|-----|--------|-------------------------------|----------|-------------|
| BEFORE | 16/16 | every combo differs: bg-color + bottom border on all; + bg-image (the gloss) and box-shadow on 2009; + box-shadow on 2021 | 32x32 | all three chips FLAT on 2009 (255,255,255 / 255,255,255 light; 20,18,16 dark) while the `.btn` is glossy (222 -> 198 light; 51,47,41 -> 35,31,26 dark) |
| AFTER | 16/16 | NONE on any combo (2005/2009/2014/2021 x light/dark x 390/1280) | 32x32 at both widths (the phone floor exemption holds) | 2005/2014/2021: chip pixels == `.btn` pixels top and bottom, all 3 chips. 2009: all 3 chips GLOSSY with the `.btn`'s own band colours within 1/255 (light 222->198 vs 222->198 at 390, 222->199 vs 221->199 at 1280; dark 51,47,41->34,30,26 vs 51,47,41->35,31,26) - the residual is the gradient sampled at a different relative height (32px chip vs 28/44px button), not a style difference (computed background-image is identical) |

Computed per era (AFTER, 1280 light, the bell): 2005 no gradient, radius 0, no shadow (flat
bevel); 2009 `linear-gradient(#e0e0e0, #c4c4c4)`, radius 2px, the 0.15 shadow; 2014 flat,
radius 2px, no shadow; 2021 radius 4px, the 0.1 shadow. All three chips sit on one row line
(`sameRowY`) at both widths.

`scripts/action-row-probe.js` at 390 and 1280 (BEFORE = the main archive via `FT_ROOT`,
AFTER = this tree): rows 1/1, column 358/358 (390) and 598/598 (1280), button geometry diffs
NONE - the `.btn` rule itself is untouched, only the `.btn-chip` variant was added.
