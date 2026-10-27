---
plan: toggle-pills
harness: v2 · standard
branch: feat/v1.396.0-toggle-pills
anchor: outcome
status: Approved - ready to build
next: builder - cut the branch from main @d54d43b5, Step 0 (measure the ON/OFF/hover paints + widths today), then W1
design: Approved 2026-10-27 @d54d43b5 (Dean picked A + C off the rendered candidate sheet)
gate: pending
builder: standard
---

# v1.396.0 - a toggle pill that is ON looks ON

Kickoff 2026-10-27 (Root, Opus). **Builder: Standard (Sonnet).** It's a CSS change plus small markup changes,
and the rulings are concrete. One release, version **1.396.0**.

## Why

Dean, 2026-10-27: on the desktop Music page you can't tell whether Loop (or "Loop chapter"), Autoplay, Shuffle or
Remote control is on. He wants a clear visual difference for an enabled option, on Music and on every other surface
that uses the same toggle pills.

Measured cause: ON is `--fill-selected` (rgba grey at 16% light / 32% dark) LAYERED over the pill's own `--surface-2`
(ui.css `.ui-chip--filter[aria-pressed="true"]`, `.ui-btn--tonal[aria-pressed="true"]`). The guard
(test/unit/ui-chip-selected.test.js) only demands a 12-level channel step. Hover (`--tint-hover`) is the same grey
family, so ON, OFF and hover read as three shades of one grey.

## The ruling (Dean, 2026-10-27, off the rendered sheet: every era, light and dark)

**A + C:**
- **A, inverted:** an ON pill is grounded in `--ink-1` with `--surface-1` ink (black/white in light mode,
  white/black in dark mode; in 2009 it replaces the gloss). It is never red, so the D2.1 role rule (red = brand /
  primary / progress / danger / unread) still holds.
- **C, check mark:** where the pill has an icon, the icon becomes `check` while ON (`icons.js` has `check`).
- **Scope: every toggle pill** (Dean picked "Every toggle pill"). That means:
  - every `.ui-chip--filter` (Music Loop / Shuffle / Autoplay, the Home filter chips in main.js, the Settings sticker
    picker cards in setup.js),
  - the toggle buttons: `#music-remote-btn`, `#music-popout-btn`, `#podcast-popout-btn`.

The reference render is in the Root's scratchpad (`pills/candidates.png`, `pills/mock.html`, shown to Dean). Row
"A + C" = row A's colours with row C's glyph.

## Rulings the Root made (flag any you disagree with in the plan, don't silently change them)

- **R1, buttons opt in by a modifier, not by blanket `[aria-pressed]`.** `.ui-btn--tonal[aria-pressed]` is also used
  for LABEL SWAPS that are not on/off states: feed.js:1652 "Read the opening / Hide the opening", feed.js:1814
  "Fit / Fill" (pressed = fit), and the skin-surface.js:2482 stack tiles. A blanket rule would paint "Fit" black.
  Add a modifier (proposed name `ui-btn--toggle`) to the three toggle buttons above. A `.ui-btn--tonal[aria-pressed]`
  without it keeps today's look. Audit every `ui-btn--tonal` + pressed site (static markup + `ui.button({ variant:
  'tonal', pressed })`) and list each one in the plan with its verdict (toggle or swap).
- **R2, the phone Sticker sheet skin keeps its own ON look.** `.mms-ss-root .ui-chip--filter[aria-pressed="true"]`
  is skin-accent ink (style.css ~11283, v1.388.0). It's a deliberate skin, and it's a phone surface. Exempt it, scoped
  to `.mms-ss-root`, and say so in the release note.
- **R3, hover and press must not undo ON.** `.ui-chip--filter:hover` / `:active` set `background-color` at equal
  specificity, LATER in ui.css. If inverted ON is painted with `background-color`, hover turns it light grey with
  white ink, which is unreadable. Hover / press on an ON pill = the inverted ground with the tint layered over it,
  or an equivalent that keeps the ink readable. Measure it (Step 0 / W3), don't reason about it.
- **R4, no width change.** Pressing must not resize a pill (the v1.349 rule in ui.css: the 2014 Pop out shifted
  3.8px). The check replaces the icon in the same box, and the existing semibold-on-ON rule for chips stays as it is.
  Measure each pill's width OFF vs ON in all 4 eras.
- **R5, icon swap mechanism.** Prefer the existing primitive: `data-icon-off` / `data-icon-on` + `ui.setPressed`
  (ui.js ~173). It only finds `.ui-btn__icon use`, and the Music chips have a bare `<svg>`, so either wrap them or
  widen the selector. One mechanism, not two. Every pressed setter (music.js reflectPlaybackModes ~1687, remote
  ~3445, popout ~3383, podcasts.js ~398) must route through it, or the glyph goes stale while the colour flips
  (the "presence-not-binding" lesson: mutate the setter and watch the test go red).
- **R6, the 2005 bordered pills** keep `--btn-border`; inverted fills inside it.

## Step 0 (builder, before W1)

- Read AGENTS.md, docs/LESSONS.md sections 0, 2 (test binding), 6 (CSS) and 12, then this plan. Read ui.css
  `---- ui-chip` through the era treatments, and the two guards (ui-chip-selected.test.js, ui-btn-selected.test.js).
- Environment: export the fnm Node PATH (AGENTS.md Environment). Playwright is in tools/capture/node_modules. The
  Root's mock is `/tmp/claude-1000/-home-coder-projects-filetube/5bbd7425-6c15-4192-b3fe-0fcca3b631df/scratchpad/pills/mock.html`
  (it renders 4 eras x 2 modes in sections with `data-theme`/`data-mode`). Reuse its approach.
- Git: the branch is cut from main @d54d43b5 with this plan committed. Stage by name. No force-push, no --no-verify.
- **Measure, red first:** in a headless browser, record the ON/OFF/hover background and ink of every in-scope
  pill in 4 eras x 2 modes, plus the OFF/ON widths. Commit the probe numbers into this plan.
- **W1, CSS:** the inverted ON rule for `.ui-chip--filter[aria-pressed="true"]` and `.ui-btn--toggle[aria-pressed="true"]`,
  plus the 2009 override (replaces the gloss), the hover/press rules (R3), and the sticker-sheet exemption (R2).
- **W2, markup + JS:** the `ui-btn--toggle` modifier on the three buttons, the check swap (R5) on every icon pill in scope.
- **W3, guards:** rewrite ui-chip-selected.test.js and ui-btn-selected.test.js to the new contract (ON ground =
  `--ink-1`, a large step from OFF, never red, hover keeps it). Add the ON ink/ground pair to ui-contrast.test.js
  (WCAG AA, every era/mode). Add a binding test: each in-scope setter flips the glyph, and a swap button (feed Fit/Fill)
  does NOT get the inverted look. Update music-playback-modes.test.js and the ui-kit page if they describe the old look.
- **W4, look:** re-shoot the real Music toolbar (desktop) and the Home chips in all 4 eras x 2 modes, before and after,
  side by side. Send the sheet to Dean before the gate.

## Stop rules

- An in-scope pill that turns out to be a label swap, not an on/off state, or a pressed tonal button you can't
  classify: STOP and ask Dean (AskUserQuestion), with a screenshot.
- A width change on press that can't be removed without changing the look Dean picked: STOP and ask.
- The inverted ON pair fails WCAG AA in any era/mode: STOP and show Dean the numbers.

## Gate

Per .harness/scrutiny.toml (UI only, no auth/data/deps): the **adversary** (floor) + **qa**. Brief both with
LESSONS 2 and 6, and R1/R3/R4/R5 as the attack surfaces: the hover regression, width, stale glyph, and swap buttons
painted as toggles.

## Release

Follow docs/RELEASING.md and AGENTS.md: the protected-main PR flow, dual-Node 22.23.1 + 24.20.0, and the plan closed
out with `node scripts/plan-complete.js <this plan> "Shipped v1.396.0" --apply` in the release PR. Add a
docs/releases.json entry, a ROADMAP entry, a LESSONS line if a wave taught one, and the device checks below. Dean
authorizes the merge.

## Not in scope

- The player-chrome pressed buttons (`.pc-btn` theater / CC / mute) and the music skins' own controls.
- Any change to the red role rule, to the OFF look, or to segmented controls / switches.
- Anything else goes to ROADMAP Planned.

## Acceptance

1. On desktop Music, in all 4 eras x light/dark, Loop / Loop chapter, Shuffle, Autoplay and Remote control read
   unmistakably ON (inverted + check) vs OFF, and hover on an ON pill stays readable.
2. Home filter chips, the Settings sticker picker, and the Music + Podcasts Pop out buttons show the same ON look.
3. The Sticker sheet skin and the feed label-swap buttons look exactly as they did before.
4. No pill changes width when toggled (measured).
5. Full dual-Node suite green (22.23.1 + 24.20.0). Visual baselines refresh after merge in the usual chore PR.

## Device checks owed by Dean (add to docs/DEVICE-CHECKS.md)

- (a) Desktop Music: toggle Loop, Shuffle, Autoplay, Remote control. ON is obvious and hover stays readable.
- (b) Play a chapter: "Loop chapter" ON looks the same.
- (c) Home chips, and Settings > sticker picker: the picked one is inverted.
- (d) Phone Sticker sheet skin: unchanged.

## Evidence (builder fills)

- Step 0 numbers (before):
- After numbers + widths:
- Swap/toggle audit (R1):
- Before/after sheet sent to Dean:
- Suites (22.23.1 / 24.20.0):
- Gate verdicts:
