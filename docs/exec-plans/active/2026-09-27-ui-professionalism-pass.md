---
plan: ui-professionalism-pass
harness: v2 · lean
branch: feat/ui-professionalism
anchor: spec
status: Building
next: sweeps - S2 (cards) and S5 (Subscriptions) in flight; then wave B (S1 chrome, S8 settings) + C (S3 watch, S7 music/pocket), then S4 + S9; the CI visual job needs its first rebaseline run (workflow_dispatch) before it can go green
design: Approved 2026-09-27 @ab31cbdc (Dean: the Design section D0-D13 as written, read against ab31cbdc)
gate: pending
---

# A full UI professionalism pass: audit, a component layer, and guardrails that hold

Captured 2026-09-27 (Dean, after v1.340.0). Design approved 2026-09-27; building on `feat/ui-professionalism`.

## The ask (Dean's words)

"We need a full UI professionalism pass. Something about the full UI feels 'amateurish'. Misaligned
things, certain visual inconsistencies. Conflicting design language implications like the Subscriptions
activities buttons. When you turn the phone and exit a Pocket Classic view, go back and see the visual
resize. Look at the pictures of the notification glyph not being aligned with the text ... and the icon
for the podcasts ... I love the app - use it multiple times daily - but I think about the UX perception
and just feel that it's in part flimsy and not premium. I'd want a full audit to help substantiate my
perceptions within the code, perform research and come up with a plan to standardize and make crisp.
And to make sure our design system doesn't allow for anything imperfect when tweaking in the future."

## Intake rulings (Dean, 2026-09-27)

- **North star: C, Native iOS / Spotify** (Dean, 2026-09-27, picked from three mocks A Modern YouTube /
  B Crisp classic / C Native; `~/filetube-design-refs/ui-direction/` (outside the public repo: it holds real creators' avatars)). Container-less icon buttons, an
  icon-over-label action bar, an outlined Subscribe pill (red filled when not subscribed) with plain
  bell + pin glyphs, inset grouped lists with hairline separators, swipe actions.
- **Notification delete leaves the row:** swipe left for Dismiss/Delete, also in the long-press / kebab
  menu; rows carry one trailing kebab slot so columns always hold.
- **Scope:** the audit and its prioritization cover EVERY surface (Dean's correction, 2026-09-27: "an
  audit and prioritization across the board not just the 2 you mentioned"). Subscriptions/Podcasts and
  Music & Pocket (incl. the rotate/exit resize) are the surfaces that bother him most - an input to the
  ranking, not its boundary.
- **Pocket on rotation:** STAY in Pocket. It is a phone mode, not a width mode (today it is gated on
  width <= 768px, which every non-SE iPhone exceeds in landscape, so rotation tears it down and the
  return rebuilds + replays every reveal). It gets a landscape layout (screen beside the wheel);
  rotation never tears it down.
- **Guardrails:** hard fail in pre-push + CI. Raw values and one-off button classes outside the
  primitives are rejected; screenshot diffs must be re-baselined on purpose. Existing debt lives in an
  exceptions file that may only shrink.
- **Shape (re-ruled 2026-09-27):** ONE mega branch, one release; then a forced one-week feature pause
  living with it (revert the merge if he hates it, or articulate why). The overlay player controls are
  carved out until the fullscreen-black bug is fixed.
- **Eras:** 2005/2009/2014 kept as token skins over the same components.
- **Icon sets:** outlined/rounded/filled kept; emoji dropped (stored emoji -> filled).

## First-pass evidence (read 2026-09-27 at ab31cbdc)

The token layer exists (563 custom properties; font sizes and radii nearly all tokenized). The missing
layer is **components**: every surface composes its own buttons, rows and icons.

- `public/css/style.css`: 15.8K lines, 66 button class names, 54 distinct fixed px heights, 381
  distinct hex colors, 49 distinct z-index values, 38 box-shadows, 31 transitions, 63 `!important`.
- JS: 228 inline `style=` writes, 190 inline `<svg>` sites with no shared icon slot.
- Channel card (watch page): three buttons, three languages - Subscribed (no glyph, grey), Notify
  (glyph sits below the text's centre line), Pin (filled red = the primary-CTA colour on the least
  primary action); taller than the action row above, which does carry glyphs; the subscriber pill
  reads as tappable.
- Notifications sheet: the delete column exists only on media rows (`common.js` ~4275) and the dot
  only on unread rows, so thumbnails and the X do not form columns; the hover tint stops short of the
  X and sticks after a tap on iOS; podcast sources get a generated glyph avatar
  (`common.js` ~4136) instead of their artwork.

## Added 2026-09-27: native interactions (Dean)

"If I hold the screen to have it fast forward in video play, I see an iOS text magnifying glass.
Another level is native interactions and text selections. It shouldn't be so."

Today suppression is per-surface opt-in: 4 `-webkit-touch-callout` sites, 13 `user-select` rules, 4
`-webkit-tap-highlight-color`, no app-wide policy. Any surface nobody remembered (the player's
hold-to-speed zone) leaks the loupe, selection handles, callouts and grey tap flashes. The foundation
inverts it: app chrome defaults to no selection / no callout / no tap highlight / no double-tap zoom,
and (superseded by the tightened ruling below) only editable fields opt back in.
The guardrail enforces it (a new surface inherits the policy; an opt-in is an explicit, listed class).

**Ruling, tightened (Dean, 2026-09-27):** "there's a lot of parts of the page that are still basically
just semi-raw HTML that you can interact with as if it has text on it ... other professional apps like
YouTube, nowhere ... other than the search bar ... or a predetermined location, can I just put my
finger somewhere and drag and select text ... it needs to be more app-like ... too many surface areas
where it's not fully app-contained."

- Selectable: ONLY editable fields (inputs, textareas, contenteditable). No reading-content opt-in -
  titles, descriptions, metadata, comments, paths are NOT selectable. Anything worth copying gets an
  explicit Copy action (file path, description, transcript, error details).
- App-contained also means: no long-press callout / link preview on links, cards, avatars; no image
  save sheet or drag; no grey tap flash (replaced by our own pressed state, so every control needs
  one); no pinch or double-tap zoom; `text-size-adjust: 100%` (no text inflation on rotation); no
  overscroll bounce where a surface must not scroll (Pocket, player).
- LOCKED 2026-09-27 after the YouTube + Spotify research (neither iOS app has any selectable text; Spotify's
  one copy surface is a designed lyrics share card; Spotify web replaces the browser context menu on rows).
- Desktop right-click on cards/rows opens OUR action menu (same as long-press / kebab); fields keep the
  native menu (Dean, 2026-09-27).
- Guardrail: the opt-in set is a short named allowlist; a test fails when a new surface leaks native
  selection/callout.

## Audit decisions (Dean, 2026-09-27 - all 11 ruled)

1. Fake stars/views/subscriber counts/comments: OFF in Modern; kept as a 2005/2009 era flourish.
2. Player: overlay controls that auto-hide (replaces the docked strip under the video).
3. Resume: auto-resume + a fading "Resumed at 12:34 · Start over" chip; no modal.
4. Description: drop the self-hosting paragraph; path/size/type in an "About this file" disclosure with
   a Copy action for the path.
5. Cards: clean thumbnails (duration only); actions in one menu reached by the kebab, long-press and
   desktop right-click.
6. Card titles in Modern: primary text colour; link blue stays in the 2005 era.
7. Avatars: circle for channels/people, rounded square for artwork (albums, podcasts, books).
8. Red: brand, main action, progress and danger only; selected/active uses ink or a tonal fill.
9. Pocket landscape: side by side (screen left, wheel right).
10. Subscription row: one line, new count + last checked; quality/dates/URL move into its sheet.
11. Remove the Subscriptions-only moon toggle.

## Research

**The audit (2026-09-27, at ab31cbdc):** 70 merged, ranked findings (9 at visibility 5, 22 at 4), 8 root
causes, 11 decisions for Dean. Page: https://claude.ai/artifact/GzQqfTTmygF6HqjgUNdjW4 . Data:
`docs/references/ui-audit-2026-09-27.json` (findings, rootCauses, decisions, metrics). Sources: five
read-only code audits, a design-system census, 206 baseline renders (iPhone 15 portrait/landscape,
desktop; dark + light) from a sandboxed seeded instance, and a YouTube/Spotify iOS reference study.

Root causes: no component layer (61 bespoke button families, 43 px heights, `.btn-sm` used 83x with no
rule); five icon systems with per-site vertical-align; rows that do not reserve columns (~25 families);
a desktop hover model on touch (92 of 94 hover rules ungated, 9 `:active` rules); no native-interaction
policy; missing colour roles (red does every job; `--hover-bg`, `--input-bg`, `--btn-primary-text`
undefined); 22 hand-built overlay families; width breakpoints used as modes, with animated layout
properties.

Side bugs found on the way (fold into the sweeps or fix sooner): the queue panel opens invisible under
Reduce Motion; the Podcasts icon keeps one of three paths and a test pins it; the hard-delete dialog's
title and button disagree; admin password reset via `window.prompt` in plain text; the Subscriptions
page's inline `<style>` is lost on in-app navigation.

Reference study: neither the YouTube nor the Spotify iOS app has selectable text; Spotify's lone copy
surface is a designed lyrics share card; Spotify web replaces the browser context menu on rows; Spotify
Now Playing is portrait-locked on iPhone; YouTube's hold-for-2x shows a "2x" pill.

## Design

Self-contained: a fresh session executes this section plus the rulings above. It does not need this
session's transcript. Evidence for every finding id (F01-F70) is in
`docs/references/ui-audit-2026-09-27.json` (fields: cause, fix, evidence file:line, shot). The chosen
direction's mock is `~/filetube-design-refs/ui-direction/mock.html` (column C), with renders
`candidates-{dark,light}.jpg`.

### D0. Overview

One mega branch, `feat/ui-professionalism`, from main, delivers:

1. A **token layer** with semantic roles, in direction C (native iOS / Spotify) for the Modern era.
   The retro eras (2005/2009/2014) are token skins over the same roles.
2. A **component layer** of `ui-*` primitives, with one JS builder module. Every control, row, avatar,
   icon, chip and overlay in the app is migrated onto it.
3. An **app-wide native-interaction policy** (app-contained).
4. The **behavior changes** Dean ruled (D8).
5. **Guardrails that hard-fail** in pre-commit, pre-push and CI: `ui-lint`, geometry checks, a
   shrink-only exceptions file, and a CI screenshot diff.

After the merge, feature work pauses for a week while Dean lives with it. The merge is a single `--no-ff`
merge commit, so a full revert is one `git revert -m 1 <merge>`. Inside the branch, each step (D12) is
its own commit series, so a part Dean dislikes can be reverted alone.

**Explicitly out of the branch:**
- The auto-hiding overlay player controls (F08). They come after the fullscreen-black bug. The docked
  player bar is restyled in C's language here and keeps its structure and behavior.
- Anything in `<video>`, fullscreen or faux-fullscreen code paths.
- The Pocket skins' art (colorway palettes, wheel, LCD rendering) beyond the rotation and interaction fixes.

This is **UI-only**. No API, DB or storage change. The one destructive-UX change (notification delete
moving to swipe/menu, D8.3) forces the **full gate** (scrutiny: destructive). The Adversary is briefed to
make a delete fire by accident, or to lose the confirm step.

### D1. Requirements (acceptance; the gate measures these)

- **AC1 Tokens.** Every colour, size, radius, font size/weight, shadow, duration/easing and z-index in
  `public/css/**` and in JS-written styles resolves to a D2 token.
  - Measure: `npm run lint:ui` exits 0.
  - Measure: `docs/ui-exceptions.json` holds only the carve-outs listed in D10.4.
- **AC2 One button.** Every `<button>`, `[role=button]` and JS-created button carries a `ui-*` primitive
  class.
  - Measure: `ui-lint` rule `no-bespoke-controls`.
  - Measure: 0 remaining `.btn`, `.btn-sm`, `.btn-chip` or `*-btn` style rules, outside the listed
    skin scopes (Pocket, whcal).
- **AC3 Heights.** Controls take only heights 32/36/44 (and 44 hit areas for icon buttons).
  - Measure: geometry check G3 (every `ui-btn` in a row has equal height).
  - Measure: `ui-lint` raw-size rule.
- **AC4 Icons.** No text glyph (`× ✕ ▶ ★ ☆ ← → ‹ › ✓ ⋮ ✎ ♪ ⛶ ⧉ ▴ ▾`) in UI markup outside skin scopes.
  All chrome icons come from the registry. Every icon's vertical centre sits within 0.5px of its label's
  centre.
  - Measure: `ui-lint` rule `icons`.
  - Measure: geometry check G2 on the channel card, the action bar, the Subscriptions row and a
    sheet header.
- **AC5 Columns.** In every list built from `ui-row`, the slot x-offsets are identical across rows,
  whether or not an optional child is present.
  - Measure: geometry check G1 on notifications (mixed media/podcast/engine rows), Subscriptions (pinned
    and unpinned, errored and ok) and a podcast episode list.
- **AC6 Touch states.** Every `:hover` rule is inside `@media (hover: hover)`, and every interactive
  primitive has a `:active` pressed state.
  - Measure: `ui-lint` rule `hover-gated`.
  - Measure: `ui-lint` rule `pressed-state`, which requires every primitive's interactive selector to
    have a `:active` or `[data-pressed]` rule.
- **AC7 App-contained.** Nothing is selectable except `input`, `textarea` and `[contenteditable]`. There
  are no iOS callouts, link previews, image-save sheets, tap flash, double-tap zoom or text inflation.
  Desktop right-click on cards and rows opens FileTube's action menu.
  - Measure: the `native-interaction` lint.
  - Measure: jsdom tests on the policy rule and its position.
  - Measure: a Playwright check that computed `user-select` is `none` on a sample of 20 chrome
    elements and `text` on inputs.
  - Measure: Dean's device pass (loupe on hold-for-2x, long-press on a card).
- **AC8 Colour roles.** Red appears only as brand, primary action, progress, danger and unread
  indicator. Selected state uses ink or a tonal fill. Every text/background token pair used by a
  primitive meets WCAG AA (4.5:1 text, 3:1 non-text).
  - Measure: `test/unit/ui-contrast.test.js` over the D2 pairs, in every era and mode.
- **AC9 Stillness.** No transition on layout properties (width, height, margin, padding,
  top/left/right/bottom, grid-*). The sequence "rotate portrait to landscape, leave Pocket, rotate back"
  produces no frame where a layout box differs from its settled box by more than 1px after the first
  animation frame.
  - Measure: `ui-lint` rule `no-layout-transition`.
  - Measure: geometry check G4 (the frame-sequence capture already in the baseline tooling).
- **AC10 Behaviors.** D8.1-D8.10 each behave as specified. Each item carries its own check (test or
  probe) named in D8.
- **AC11 Era parity.** All four eras render every primitive with no unstyled control.
  - Measure: the visual job's era matrix.
  - Measure: `test/unit/ui-era-roles.test.js`. It requires every role token to be defined in every era
    x mode block, on the Pocket lock-test pattern.
- **AC12 No regressions.** The full dual-Node suite passes (22.23.1 and 24.20.0).
  - Measure: the old source-lock tests that pinned bespoke selectors are **converted** into
    primitive-contract or geometry tests, never deleted without a replacement.
  - Measure: the conversion list is recorded under the plan's `Deviations`/`Build log`.

### D2. Tokens

Everything lives in `public/css/tokens.css`, a new file loaded before `style.css` in every shell (13
shells: books, diag, history, index, login, music, podcasts, read, setup, stats, tv, watch, welcome).
diag.html also gets it (it loads no style.css today). The old names (`--bg-color`, `--text-primary`,
`--btn-bg`...) stay as **aliases** to the new roles until the last sweep removes their consumers. Then
they are deleted, and `ui-lint` bans them.

**D2.1 Surfaces and ink (Modern = 2021 era; C values)**

| Role | Dark | Light | Use |
|---|---|---|---|
| `--surface-0` | `#000000` | `#f2f2f7` | page ground |
| `--surface-1` | `#1c1c1e` | `#ffffff` | grouped lists, cards, sheets |
| `--surface-2` | `#2c2c2e` | `#e5e5ea` | inputs, tonal chips, raised within a group |
| `--surface-overlay` | `#1c1c1e` | `#ffffff` | sheets, popovers, dialogs |
| `--scrim` | `rgba(0,0,0,.5)` | `rgba(0,0,0,.3)` | the one backdrop |
| `--separator` | `#38383a` | `#c6c6c8` | hairlines (0.5px on DPR>=2 via `@media (min-resolution:2dppx)`, else 1px) |
| `--ink-1` | `#ffffff` | `#000000` | primary text and icons |
| `--ink-2` | `#a1a1a6` | `#5e5e63` | secondary text (6.6:1 on surface-1 dark, 6.5:1 on white) |
| `--ink-3` | `#8e8e93` | `#6c6c70` | tertiary text (5.2 / 5.2) |
| `--ink-on-accent` | `#ffffff` | `#ffffff` | text on accent fill |
| `--accent` | `#ff453a` | `#d70015` | red TEXT and icon use (5.0:1 on surface-1 dark, 5.4:1 on white) |
| `--accent-fill` | `#e0190f` | `#e0190f` | primary button / Subscribe fill (white text 4.87:1) |
| `--danger` | = `--accent` | = `--accent` | destructive text; the fill uses `--accent-fill` |
| `--indicator` | = `--accent` | = `--accent` | unread dot, count badge |
| `--progress` | `#ff0033` | `#ff0033` | playback progress (brand, non-text) |
| `--fill-selected` | `rgba(120,120,128,.32)` | `rgba(120,120,128,.16)` | selected chip, tab or segment (ink text on it) |
| `--tint-press` | `rgba(120,120,128,.24)` | `rgba(120,120,128,.14)` | `:active` overlay |
| `--tint-hover` | `rgba(120,120,128,.14)` | `rgba(120,120,128,.08)` | hover (hover-capable devices only) |
| `--focus-ring` | `#0a84ff` | `#007aff` | `:focus-visible` 2px ring, 2px offset (not red: red is reserved) |
| `--outline` | `rgba(255,255,255,.35)` | `rgba(0,0,0,.28)` | outlined (secondary) button border |
| `--thumb-ground` | `#1c1c1e` | `#e5e5ea` | image placeholder |
| `--star` | `#ffcc00` | `#ffcc00` | retro-era stars only |

**D2.2 Type (Geist in Modern; the era overrides the family).** Eight roles only. Rules use the role
tokens, never a raw font size.

| Role | size/line | weight | Use |
|---|---|---|---|
| `--t-caption` | 11/13 | 500 | action-bar labels, tab-bar labels, duration badge |
| `--t-footnote` | 12/16 | 400 | timestamps, tertiary meta |
| `--t-meta` | 13/18 | 400 | secondary lines, channel names in rows |
| `--t-callout` | 14/19 | 500 | dense row titles (notifications), buttons |
| `--t-body` | 15/20 | 400 (titles 600) | row titles, card titles, body copy |
| `--t-title` | 17/22 | 600 | sheet titles, section headers |
| `--t-headline` | 20/25 | 650 | watch video title, page titles on phone |
| `--t-display` | 28/34 | 700 | desktop page titles |

The old `--fs-*` names alias to the nearest role, and the sweeps retire them.

**D2.3 Geometry**

- **Control heights:** `--ctl-sm` 32 (pills: Subscribe, filter chips), `--ctl-md` 36 (default desktop
  button), `--ctl-lg` 44 (phone default; every hit area).
- **Hit area:** `--hit` 44. An icon button is a 44x44 box with a visual glyph of `--icon-md`.
- **Icon sizes:** `--icon-sm` 18 (inside sm buttons, badges), `--icon-md` 22 (rows, header, sheet
  actions), `--icon-lg` 24 (action bar, bottom bar). No other sizes.
- **Radius:**
  - `--r-xs` 4 (badges)
  - `--r-sm` 8 (row thumbnails, artwork in rows)
  - `--r-md` 12 (grouped lists, card thumbnails, inputs, dialogs)
  - `--r-lg` 16 (sheet top corners)
  - `--r-pill` 999
  - avatars are circles (`50%`)
- **Avatar sizes:** `--av-xs` 20, `--av-sm` 28, `--av-md` 36, `--av-lg` 40, `--av-xl` 64, `--av-2xl` 96.
- **Row heights (min):** `--row-compact` 44, `--row-default` 56, `--row-media` 64. Media rows with a
  thumbnail are content-sized with 10px vertical padding.
- **Spacing:** keep `--space-1..16` (2,4,6,8,10,12,16,20,24,32). New rules use the 4-multiples. 6 and 10
  stay legal for existing rhythms.
- **Group inset:** `--inset` 16 (grouped list side margin, page gutter on phone).

**D2.4 Motion and elevation**

- **Durations:** `--dur-press` 90ms, `--dur-fade` 180ms, `--dur-sheet` 280ms.
- **Easing:** `--ease-std` `cubic-bezier(.2,0,0,1)`, `--ease-enter` `cubic-bezier(0,0,0,1)`,
  `--ease-exit` `cubic-bezier(.3,0,1,1)`.
- Transitions may animate only `opacity`, `transform`, `color`, `background-color`, `border-color`,
  `box-shadow` and `filter`.
- `--shadow-overlay`: `0 8px 32px rgba(0,0,0,.45)` dark / `0 8px 32px rgba(0,0,0,.18)` light. Sheets and
  popovers only.
- Flat surfaces have no shadow in Modern.
- **Z:** keep the existing ladder (`--z-nav` ... `--z-top`). Overlays use only ladder tokens.

**D2.5 Era skins.** Each of 2005/2009/2014 x light/dark redefines the D2.1 roles plus these era knobs:

- `--font-ui`, `--font-heading`
- `--btn-radius`, `--btn-fill` (Modern: transparent; 2009: a gloss `linear-gradient`), `--btn-border`,
  `--btn-shadow`, `--btn-weight`
- `--row-divider-style`
- `--thumb-radius`

The starting values are today's era blocks (style.css ~330-578), mapped to roles:
- 2014: flat Material, radius 2, `#e62117`, Roboto.
- 2009: gloss on every `ui-btn`, not only `.btn`; radius 3.
- 2005: radius 0, Verdana, blue links are legitimate here, bordered buttons.

The retro eras keep fabricated stats (D8.1). `ui-era-roles.test.js` fails if any era x mode block is
missing a role.

**D2.6 Icon sets.**
- **Axis:** `data-icons` keeps `outlined | rounded | filled`, and `emoji` is removed.
- **Migration:** a stored `ft-icons` value of `emoji` resolves to `filled`.
- **Auto:** `AUTO_ERA_ICON_MAP` becomes `{2005:'filled', 2009:'filled', 2014:'filled', 2021:'rounded'}`.
- **Settings:** the picker drops the Emoji option.
- **Tests:** `resolve-icon-set.test.js` covers `emoji` resolving to `filled`.
- **Inline bootstrap:** the FOUC bootstraps in index/setup/watch `<head>` mirror the change.

### D3. Architecture and files

```
public/css/tokens.css      NEW  roles (D2), era x mode blocks, aliases for old names
public/css/ui.css          NEW  the primitives (D4), era treatments attached once per primitive
public/css/style.css       SHRINKS  surface layout only; bespoke control/row/overlay rules deleted per sweep
public/js/icons.js         NEW  generated registry {name:{outlined,rounded,filled}} + sprite builder (browser + CommonJS, glyph-pool pattern)
public/js/ui.js            NEW  builders: ui.button, ui.iconButton, ui.icon, ui.row, ui.avatar, ui.thumb, ui.chip, ui.sheet, ui.menu, ui.toast, ui.switch, ui.segmented, ui.field, ui.confirm, ui.copy (browser + CommonJS)
public/js/interaction.js   NEW  native-interaction policy JS half: long-press/contextmenu helper, swipe-row controller
tools/icons/fetch.js       NEW  pulls Material Symbols SVGs (Apache-2.0) for the name list, 3 styles, into public/assets/icons/{outlined,rounded,filled}
tools/icons/build.js       NEW  generates public/js/icons.js from public/assets/icons/**
scripts/ui-lint.js         NEW  one runner (css-tree AST), rules D10.1; replaces css-token-lint (its classifier is reused)
docs/ui-exceptions.json    NEW  shrink-only ratchet D10.3
test/visual/               NEW  scenes (reuse tools/capture scenes/settle/request-policy), baselines/, runner
test/geometry/             NEW  G1-G4 checks (Playwright, seeded DATA_DIR)
```

- **Load order in every shell:** `tokens.css`, `ui.css`, `style.css`. Then `icons.js` synchronously in
  `<head>`, which injects the sprite for the current `data-icons` at the top of `<body>` from the inline
  bootstrap, so there is no pop-in. `ui.js` and `interaction.js` load before any page script.
- **Duplicated shell markup:** the header and bottom-nav copies in 12 shells keep their parity tests, and
  their `<svg>` literals become `<svg class="ui-icon"><use href="#i-home"/></svg>`.
- **Page `<style>` blocks:** `subscriptions.html`'s inline `<style>` (41-175) moves into `style.css`.
  F62: it is dropped on in-app navigation. `ui-lint` bans `<style>` blocks in shells (diag.html excepted
  and listed).

### D4. Components and interfaces

Conventions:
- Class prefix `ui-`, BEM parts `ui-x__part`, modifiers `ui-x--mod`.
- **Every primitive's colours come only from D2 roles.** Era differences arrive through the role tokens.
- JS never sets a visual style inline; it toggles classes, `hidden` or `aria-*`.

**D4.1 `ui-btn`**

```html
<button class="ui-btn ui-btn--{primary|secondary|tonal|plain|danger} ui-btn--{sm|md|lg} [ui-btn--pill] [ui-btn--icon] [ui-btn--stack]"
        type="button" [aria-pressed="true|false"] [aria-busy="true"] [disabled]>
  <span class="ui-btn__icon"><svg class="ui-icon"><use href="#i-NAME"/></svg></span>
  <span class="ui-btn__label">Label</span>
</button>
```

**Variants (Modern):**
- `primary`: `--accent-fill` fill, `--ink-on-accent` text. Used for **one** main action per surface
  (Subscribe, Save, Download now).
- `secondary`: transparent fill, 1px `--outline` border, ink-1 text (Subscribed, Cancel, Retry).
- `tonal`: `--surface-2` fill, no border (filters, toolbars).
- `plain`: no container, ink-1 glyph and label (row actions, header icons).
- `danger`: `--danger` text on plain or secondary. The confirm step uses an `--accent-fill` fill.

**Sizes and shapes:**
- Sizes: `sm` 32, `md` 36, `lg` 44. Under `(max-width: 768px)` an `md` computes to 44.
- `--pill`: radius pill.
- `--icon`: square, glyph only. The hit area is always 44 even when the visual is smaller (a
  pseudo-element extends the hit box).
- `--stack`: icon over label, used by the action bar (D4.9).

**Icon slot and label:**
- The icon slot is `display:grid; place-items:center; width/height = icon size; flex:none`. The label is
  `line-height:1`, and the button is `display:inline-flex; align-items:center`. Centring comes from the
  boxes, never from `vertical-align`.
- Toggles use `aria-pressed`. The label is a **stable-width stack**: all states rendered in one grid cell,
  inactive ones `visibility:hidden`. This generalizes today's `stableToggleLabelHtml` and replaces it.

**States:**
- `:active` / `[data-pressed]` gets a `--tint-press` overlay via `::after` (plain and icon get a
  `--tint-press` circle).
- Hover (inside `@media (hover:hover)` only) gets a `--tint-hover` overlay.
- `:focus-visible` gets the ring.
- `[disabled]` and `[aria-busy=true]` get `opacity:.4` and `pointer-events:none`, with no hover or
  press. Busy never dims a toggle mid-tap (F34): it keeps full opacity and shows a spinner in the icon
  slot.

**Builder:**
- `ui.button({variant, size, icon, label, labels?, pressed?, pill?, shape?, onClick})` returns an
  `HTMLButtonElement`.
- `ui.setPressed(btn, bool)` swaps the visible label within the stack.

**D4.2 `ui-icon` and the registry.**
- `ui.icon(name, {size})` returns `<svg class="ui-icon ui-icon--{sm|md|lg}" aria-hidden="true"><use href="#i-name"/></svg>`.
- **Names (initial list; fetch any missing from Material Symbols):** home, subscriptions, history,
  download, downloads, podcast, music_note, library_books, playlist_play, queue_music, search, close,
  arrow_back, chevron_right, expand_more, more_vert, more_horiz, notifications, notifications_active,
  notifications_off, push_pin, keep (pin-filled via FILL axis), thumb_up, share, headphones, subject
  (transcript), check, delete, refresh, add, edit, settings, dark_mode, light_mode, play_arrow, pause,
  skip_next, skip_previous, fullscreen, fullscreen_exit, picture_in_picture_alt, closed_caption,
  speed, volume_up, volume_off, star, shuffle, repeat, info, content_copy, open_in_new, folder, tv,
  videocam, movie, book, account_circle, logout, warning, error.
- **Filled states** (bell-on, pin-on, thumb-up-on, star-on) use the Material Symbols FILL=1 variant,
  stored as `name.fill`.
- The broken `CHROME_ICON_SVG.podcast` (F29) and the `tv` fallback to `info` (F39) are fixed by
  construction: the registry test asserts every path from the source SVG is kept, and that every
  referenced name exists.

**D4.3 `ui-row`** (a grid with **reserved** slots)

```html
<div class="ui-row ui-row--{compact|default|media} ui-row--divider-{none|inset|full}" role="listitem">
  <span class="ui-row__lead"></span>        <!-- 8px indicator slot; reserved even when empty -->
  <span class="ui-row__media">…</span>      <!-- ui-avatar | ui-thumb; fixed width per row size -->
  <span class="ui-row__body"><span class="ui-row__overline"/><span class="ui-row__title"/><span class="ui-row__meta"/></span>
  <span class="ui-row__aside">…</span>      <!-- optional thumbnail or trailing text; fixed width when declared by the LIST -->
  <span class="ui-row__actions">…</span>    <!-- N fixed ui-btn--icon slots; the LIST declares N; absent actions render an empty slot -->
</div>
```

**Grid contract:**
- The list container (`ui-list`) sets `--row-actions: N` and `--row-aside: <width|0>`. Every row
  therefore gets `grid-template-columns: 8px var(--media-w) minmax(0,1fr) var(--row-aside) calc(var(--row-actions) * 44px)`.
- An optional child can never move a column (AC5).
- Confirmations never grow in place: an armed delete opens a `ui-confirm` (D4.8), not "Sure?" text in
  the row.

**Structure:**
- Rows are `<a>` or `<button>` only when the whole row navigates. Actions inside are separate buttons.
  The row link has `text-decoration:none` in every state (F20); the global `a:hover` underline is scoped
  to `.ui-prose a` only.
- `ui-list--grouped` gets a `--surface-1` inset group with `--r-md`, `--inset` side margins, and inset
  dividers starting at the body column. This is C's grouped list.

**Builder:** `ui.row({size, lead, media, overline, title, meta, aside, actions, href, onClick})`.

**D4.4 `ui-avatar`, `ui-thumb`, `ui-art`**

- **`ui-avatar`** is a circle at a D2.3 size. There is one builder,
  `ui.avatar({name, url, kind: 'channel'|'person'|'podcast'|'album'|'book', size})`, and it resolves in
  this order:
  1. the photo URL;
  2. if `kind` is podcast/album/book, the artwork, which returns a **`ui-art`** (a rounded square,
     `--r-sm`) instead of a circle;
  3. a monogram on a hash-derived tone from a fixed 8-tone palette defined per mode in tokens.css.

  A broken image falls back to step 3, never to the logo or the broken-image glyph. It replaces the 7
  builders (F14, F42): notifications (`common.js` ~4110-4140), watch channel card, comments,
  Subscriptions rows, Podcasts, Music artists and the account menu.
  - yt-dlp podcasts use the show's artwork (the feed image or the channel avatar), **not** a cropped
    video frame (`server.js:6875`, F42). If the server has no art, the monogram is used.
- **`ui-thumb`** takes a fixed aspect (`16x9 | 1x1 | 2x3`), a `--thumb-ground` placeholder with **no
  frame or border** (F53), `--r-sm` in rows and `--r-md` in cards, and an optional
  `ui-thumb__duration` badge (`--t-caption`, tabular numbers, `rgba(0,0,0,.72)` fill, `--r-xs`,
  bottom-right 6px) and progress bar (3px, `--progress`).
- The duration badge is **never larger than the card title** (F04). There is one size everywhere.

**D4.5 `ui-chip`**
- `ui-chip--filter`: a selectable pill, 32h, `--surface-2`. Selected uses ink-1 on `--fill-selected`
  plus weight 600, never red (F13, F19).
- `ui-chip--meta`: non-interactive text with no fill or border, so it can't be mistaken for a button
  (the subscriber count, F43).
- `ui-chip--count`: a badge, 16h pill, `--indicator` fill.
- Home shows **one** chip row (F19). Its type and status filters merge into one scrollable row, or the
  second row becomes a single `ui-segmented`; the sweep chooses by measurement.

**D4.6 `ui-sheet`** (one overlay primitive)
- **Variants:**
  - `bottom`: phone sheet with a grab handle, `--r-lg` top corners, max-height 90dvh.
  - `popover`: anchored menu, `--r-md`.
  - `dialog`: centred, `--r-md`, max-width 420.
  - `panel`: docked side panel.
- **Shared parts:** one surface (`--surface-overlay`), one shadow (`--shadow-overlay`), one backdrop
  (`ui-scrim`, `--scrim`), one motion (bottom: translateY with `--dur-sheet`/`--ease-enter`, exit
  `--ease-exit`; popover/dialog: opacity plus 0.98 scale), and z from the ladder.
- **Header slot:** a title (`--t-title`) plus one `ui-btn--plain ui-btn--icon` close button (F47 bans
  all other close marks).
- **Behavior (in `ui.sheet`):**
  - Esc closes; focus moves in on open and returns to the opener on close.
  - Body scroll is locked (`body-scroll-lock.js`).
  - The swipe-down to dismiss on `bottom` sheets is kept.
  - **Reduced motion:** opacity only, and the open class is **always** applied (fixes F48: the queue
    panel was never given `.queue-open` under reduced motion).
- **Replaces** the 22 families and 8 backdrops: notifications panel, queue panel, playlists sheet,
  sub-sheet, account menu, sort menu, chapters menu, speed menu, choice modal, hard-delete modal,
  download dialog, avatar crop dialog, More-actions dialog, reader drawer, music actions menu, sticker
  menu shell (its rows keep the skin), share sheet, and any others the census lists (census §3.5).
- **`ui.menu(items)`** builds a `popover` or `bottom` sheet (by viewport) of `ui-row--compact` items:
  icon slot, label, trailing check or value. **Selected = a trailing check in ink**, not red text (F46).

**D4.7 `ui-toast`**
- A single queue: one visible at a time, others wait (F56).
- Bottom-centred above the bottom bar and safe area, `--surface-overlay` (it inverts in light mode:
  dark toast on a light app, like iOS), `--t-callout`.
- An optional action is a `ui-btn--plain` in `--accent` sentence case ("Undo"), not caps.
- Variants: neutral, success (a check icon), error (a warning icon). Colour is never the only signal.

**D4.8 `ui-confirm`**
- `ui.confirm({title, body, confirmLabel, danger})` returns a promise. It is a `dialog` sheet, and the
  confirm button is `primary` or `danger` fill.
- It replaces every `window.alert/confirm/prompt` (F55, `setup.js:3193/3272/3300` and the others the
  audit lists) and the in-row "Sure?" arming (F28).
- `ui.prompt({..., type:'password'})` gives password resets a masked field with a show toggle.
- **Copy must agree:** the hard-delete dialog (F44) says "Delete this file permanently?" with the button
  "Delete permanently", **or** "Move to Trash" with the button "Move to Trash". The build reads
  `common.js` ~12940-12995 to see which operation actually runs, and the copy matches it.
- **One destructive rule app-wide (F33):** every destructive action goes through `ui.confirm` with a
  `danger` fill, except dismissing a notification, which is not destructive.

**D4.9 Action bar and channel row (the watch page, C)**
- **Action bar:** a `ui-btn--stack` row of up to 5 equal columns (icon `--icon-lg` over a
  `--t-caption` label): Like, Share, Listen, Transcript, More. Overflow items live in More.
  - Toggles (Like/Liked, Mark watched/Watched) use the stable label stack (F21), and the icon switches
    to `.fill`.
  - "Copied!" feedback is a toast, not a label swap.
- **Channel row:**
  - Structure: `ui-avatar lg`, then the name (`--t-body` 600) over the subscriber count
    (`ui-chip--meta`, `--t-meta`, rendered in the first paint with a reserved line, F43), then trailing
    controls.
  - Not subscribed: a `ui-btn--primary --pill --sm` "Subscribe", then the pin as a
    `ui-btn--plain --icon` toggle. The bell slot stays reserved but its button is `visibility:hidden`,
    because you can't be notified without subscribing, so the pin never moves. If today's code does let
    Pin act when unsubscribed, that stays; otherwise it is hidden the same way.
  - Subscribed: a `ui-btn--secondary --pill --sm` "Subscribed", with bell and pin as plain icon toggles
    (`notifications_active` / `notifications_off`, `keep.fill` / `keep`).
  - Unsubscribing goes through `ui.confirm` (F33).
- **Pin is one concept everywhere (F32):** the icon `keep`/`keep.fill`, the plain icon toggle, and the
  label "Pinned"/"Pin" wherever a label shows.
- **Notify is one concept everywhere:** the bell icon states only, never gold or red.

**D4.10 Forms: `ui-field`, `ui-switch`, `ui-segmented`, `ui-select`**
- `ui-field`: a label above, a `--surface-2` input with `--r-md`, 44h, 16px font (no iOS zoom), a
  `:focus-visible` ring (F36, the Settings inputs had `outline:none`), and help/error text below.
- `ui-switch` is the one toggle (the watch autoplay switch restyled to C: 51x31 iOS proportions,
  `--accent-fill` when on). Settings' 29 native checkboxes become `ui-switch` rows (F09).
- `ui-segmented` replaces the segmented idioms. `ui-select` wraps the native `<select>` with the field
  styling plus a chevron.
- `:root { color-scheme: dark | light }` is set per mode, and `accent-color: var(--accent-fill)` too, so
  any remaining native control matches (F09, F66).
- Settings rows are `ui-list--grouped` sections of `ui-row--default` with a trailing switch, value or
  chevron. The 110 inline styles in `setup.html` go (F54).

### D5. Surface migration map (every finding placed)

Each sweep:
1. migrates the surface's markup and JS builders onto D4;
2. deletes its bespoke CSS;
3. converts its source-lock tests;
4. shrinks `docs/ui-exceptions.json`;
5. re-baselines its visual scenes.

| Sweep | Surfaces | Findings |
|---|---|---|
| S1 Chrome | header, bottom bar, sidebar, search, account menu, playlists sheet, PWA theme-color/status bar | F20 F29 F31 F38 F49 F50 F66 |
| S2 Cards & feeds | Home, channel pages, History, search results, related rail | F03 F04 F05 F15 F18 F19 F53 F61 F63 F67 |
| S3 Watch | action bar, channel row, description, comments, More, resume chip, docked player bar restyle | F06 F07 F16 F17 F21 F22 F25 F43 F45 F51 F52 F68 |
| S4 Notifications & queue | notifications panel, queue panel | F28 F48 |
| S5 Subscriptions | page, rows, row sheet, toolbar, activity | F24 F40 F62 F26(subs half) F32 F33 |
| S6 Podcasts | list, show header, episode rows | F26 F27 F41 F42 |
| S7 Music & Pocket | music pages, mini player, Pocket rotation/landscape, Pocket glyphs, sticker menu rows | F23 F58 F59 F60 F70 |
| S8 Settings & forms | setup.html, login, welcome, downloads dialog | F09 F36 F39 F54 F55 F64 |
| S9 Overlays & feedback | every remaining sheet/menu/dialog, toasts, status chip, empty/loading/error states | F30 F44 F46 F47 F56 F57 F65 |
| S10 Books & reader | books, read toolbar | F69 |

The app-wide findings (F01 F02 F10 F11 F12 F13 F14 F34 F35 F37) are fixed by the foundation steps (D12
steps 1-4) and verified again in every sweep.

### D6. Native-interaction policy (AC7; ruling LOCKED)

At the top of `ui.css` (the CSS half):

```css
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
       -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
img, a, video, svg { -webkit-user-drag: none; user-drag: none; }
input, textarea, select, [contenteditable="true"], [contenteditable=""] {
  -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }
```

- The input rule must come **after** every rule that could set `user-select:none` on an ancestor.
  `ui-lint` asserts it is the last user-select rule in the cascade. iOS WebKit otherwise breaks the
  caret and paste menu in inputs.
- **Pinch zoom:**
  - The viewport meta in all 13 shells gets `maximum-scale=1, user-scalable=no`.
  - Keep `touch-action: manipulation`, which kills double-tap zoom.
  - The **reader** (`read.html`) keeps pinch zoom for accessibility of long-form reading, and is listed.
- **Overscroll:** `overscroll-behavior: none` on Pocket, the player and open sheets. Page lists keep
  native bounce.
- **The JS half** (`interaction.js`):
  - `onLongPress(el, handler)` does the following:
    - It uses a 450ms hold with 8px of movement tolerance.
    - It calls `preventDefault` on `contextmenu`, and on `touchmove` only while armed.
    - It never touches `touchstart`, so taps and scrolls are unaffected.
    - It clears any selection when it fires.
  - The player's hold-for-2x (`player.js:4721-4950`) moves onto it. That fixes F22 at the source: the
    listeners stop being passive during the hold.
  - The 2x indicator becomes a `ui-chip`-styled pill ("2x" plus `fast_forward` icon) at the top centre
    of the video, not the "2× ▶▶" text glyph.
- **The card and row action menu** (D8.5) is reached by the kebab, `onLongPress`, and desktop
  `contextmenu` on cards and rows.
- **Copy actions** (F68) use `ui.copy(text, label)` (clipboard plus a toast "Copied"). They appear in
  "About this file" (the path), the description sheet ("Copy description"), transcript ("Copy
  transcript") and error details ("Copy details").
- **The debug overlay** (`?debugLifecycle=1`) is a diagnostics surface: it keeps text selection via the
  listed `ui-selectable` class. That class is the **only** opt-in besides fields, and `ui-lint` pins its
  allow-list to exactly {debug-lifecycle overlay, `read.html` content}.

### D7. Stillness and rotation (AC9)

- **No layout-property transitions (F37).**
  - The sidebar is a transform-only drawer on phones.
  - `.main-content` stops transitioning `margin-left` (style.css ~1425), and the sidebar's transition
    (~1119) is gated by `.is-animating`, which is set only by the menu toggle.
  - A `resize`/`orientationchange` adds `html.no-motion` for 300ms, which zeroes transitions.
- **Pocket is a phone mode (ruling):**
  - The width gate (`@media (max-width:768px)` at style.css ~11790, `matchMedia` in `music-skins.js:334`)
    becomes a **device gate**: an `html.is-phone` class set once at boot from
    `matchMedia('(pointer:coarse)')` plus the screen's short side
    (`Math.min(screen.width, screen.height)`) of 500px or less. CSS keys on `html.is-phone`, JS reads
    the same class, and rotation never changes it.
  - Landscape layout (ruling: side by side): `@media (orientation: landscape)` inside Pocket arranges
    the LCD (left, height-fitted) and the wheel (right, fitted to the shorter side) in a 2-column grid.
    Safe-area insets go on the sides.
  - No teardown or rebuild on rotate, so no reveal replays (F23).
  - As a guard, the rebuild path skips the art reveal when the art URL is unchanged.
- **Measure after settle (F59):** Pocket's measured sizes (the haptic ghost scale in `skin-surface.js`
  ~2201-2226, the Brick canvas in `ipod-brick.js` 60-70/254) move to a `ResizeObserver`, applied in the
  next `requestAnimationFrame` after two stable frames.
- **Scroll restore anchor (A5 of the music audit):** leaving Pocket restores the Music list by anchor
  row id, not a raw `scrollTop`.
- **Mini player (F58):** the docked mini player reserves its height in the page (a bottom padding
  token) so it never covers the album's Play/Shuffle row.
- **The lifecycle log** (`?debugLifecycle=1`) records `resize`, `orientationchange` and `visualViewport`
  resize, with sizes. This is a device instrument for Dean.

### D8. Behavior changes (Dean's rulings; each has a check)

1. **Fabricated stats** (stars, views, subscriber counts, commenters): hidden in the 2021 era, shown in
   2005/2009/2014. They are gated by an era token (`--show-fabricated: 0|1`) read via a
   `data-era-flourish` attribute, not per-feature ifs.
   - Check: a jsdom test per era.
   - Real counts (for example yt-dlp view counts captured at download time) are **real data** and still
     show in every era; only fabricated values are gated.
   - The build confirms which values are fabricated from the generating code.
2. **Resume:**
   - The modal (F51) is replaced by auto-resume. A `ui-chip`-styled toast "Resumed at 12:34" with a
     "Start over" action appears over the bottom-left of the video for 4s, then fades (`--dur-fade`).
   - It must not touch `<video>` element lifecycle, fullscreen or faux-fullscreen code. It only replaces
     the prompt UI and calls the existing seek.
   - Check: a unit test on the resume decision, plus a probe screenshot.
3. **Notification delete (destructive, full gate):**
   - Rows carry one trailing `more_vert` slot. The menu holds Delete file (media rows only), Dismiss
     and Open channel.
   - **Swipe left** reveals Dismiss (grey) and Delete (danger). A full swipe past 60% dismisses, never
     deletes. **Delete always goes through `ui.confirm`.**
   - The X button is removed; dismiss lives in the swipe and the menu.
   - Check:
     - a jsdom test that no gesture path reaches the delete API without the confirm resolving true;
     - a probe for G1 columns;
     - Adversary brief: attempt accidental delete by fast swipe, double tap, swipe then tap, or tapping
       the confirm backdrop.
4. **About this file:**
   - The description drops the self-hosting paragraph.
   - File Path / Size / Type move into a collapsed `ui-row` "About this file" (`info` icon). It
     expands to key/value rows with a Copy action on the path.
   - No monospace, no bold labels.
   - Check: a DOM test.
5. **Clean cards:**
   - The thumbnail shows only the duration badge and a progress bar.
   - Download/Delete/Like/Queue/Share/Reheat/Transcript move into a card action menu (kebab in the meta
     row, long-press, desktop right-click), built with `ui.menu`. Delete inside it uses `ui.confirm`.
   - The eight `.card-*-btn` families are deleted.
   - Check: a DOM test that no overlay buttons exist on a card; a menu test.
6. **Titles in ink:** card and row titles use `--ink-1` (F03). Link blue exists only as the 2005 era's
   `--ink-link`.
7. **Avatars:** circles for channels and people; `ui-art` rounded squares for albums, podcasts and
   books (D4.4).
8. **Red roles:** the D2.1 roles only. A lint (`colour-roles`) bans `--accent`/`--accent-fill` in
   selected/active/hover/focus selectors.
9. **Subscription row:** one meta line, "`<b>3 new</b> · checked 2h ago`". If the last check errored, it
   reads "Check failed · 2h ago" in `--danger`, with a Retry item in the row menu, not an inline 44px
   button (F40).
   - Quality, dates and URL move into the row sheet.
   - Trailing slots are fixed at three: pin, bell, menu.
10. **Theme toggle:** the Subscriptions-only moon (`subscriptions.html:198`) is removed (F38). The theme
    lives in Settings and the account menu.

### D9. Error handling and edge states

- `ui.avatar`: never shows a broken image (onerror falls back to the monogram).
- `ui.sheet`: a second open request while open replaces the content, never stacks backdrops.
- `ui.toast`: a single queue.
- `ui.confirm`: resolves false on backdrop, Esc or close.
- Empty, loading and error states use one `ui-state` block: icon, title, body and an optional action.
  Loading uses skeletons of the final geometry (the row skeleton equals the row grid), so nothing pops in
  (F63, F65). The Books load failure shows an error state, not "No books yet" (`books.js` 181-185,
  272-276).
- Offline or failed image loads keep the `--thumb-ground` placeholder at its final size, with no shift.

### D10. Guardrails (hard fail: pre-commit, pre-push, CI)

**D10.1 `scripts/ui-lint.js`** (css-tree AST; `css-tree` declared as a devDependency, already present
transitively). It scans `public/css/**`, `<style>` in shells, HTML `style=""`, JS `.style.*`, `cssText`
and `setProperty`, and JS template `style="…"`. Rules:

1. `no-raw-values`: colour, size (now **including** width/height/min/max: allowed are tokens, `%`, `vw`,
   `vh`, `dvh`, `fr`, `auto`, and `min()`/`clamp()`/`calc()` over tokens), radius, font, weight, line
   height, shadow, z-index, duration and easing. It reuses the css-token-lint classifier.
2. `no-legacy-tokens`: the old alias names are banned once their last consumer is gone. The step turns
   on at the end of the sweeps.
3. `no-bespoke-controls`:
   - A rule whose subject has `cursor:pointer`, or `button`/`[role=button]`, or a class matching
     `*-btn|*-button|*-row|*-chip|*-badge|*-pill|*-modal|*-sheet|*-menu|*-avatar|*-thumb|*-toast|*-backdrop|*-scrim`,
     must be a `ui-*` primitive or part, or be listed.
   - In JS/HTML, every `<button`/`createElement('button')` carries a `ui-` class.
4. `hover-gated`: every `:hover` is inside `@media (hover:hover)`.
5. `pressed-state`: every interactive primitive selector has an `:active`/`[data-pressed]` rule.
6. `native-interaction`:
   - the D6 base rule exists;
   - the input re-enable is the last user-select rule;
   - no other `user-select`, `-webkit-touch-callout` or `-webkit-tap-highlight-color` declarations
     exist, except the `ui-selectable` allow-list;
   - `contextmenu` listeners exist only in `interaction.js`.
7. `icons`:
   - no `<svg` literal outside `icons.js`, skin files (music-skins.js, skin-surface.js, ipod-brick.js)
     and the sprite;
   - no D1-AC4 text glyphs in JS/HTML strings outside skin scopes;
   - no `vertical-align` anywhere on `.ui-icon` or in a `ui-btn`.
8. `no-layout-transition`: `transition`/`transition-property` may not name layout properties, and
   `transition: all` is banned.
9. `z-ladder`: `position:fixed|sticky` rules and overlay subjects use ladder tokens only.
10. `display-ownership`: no new `display:…!important`, and no JS `.style.display=`. This is a ratcheted
    count.
11. `colour-roles`: D8.8.
12. `no-shell-style`: no `<style>` in shells except `diag.html`, which is listed.

**Canaries:** every rule has a canary fixture under `test/fixtures/ui-lint/<rule>/{bad,good}.*`, and the
runner exits 2 if a canary does not fire. `css-token-lint.js` is retired, and its tests migrate to
`ui-lint` (its classifier and self-canary pattern are kept).

**D10.2 Geometry checks** (`test/geometry/`: Playwright from `tools/capture/node_modules`, seeded
`DATA_DIR` built by a committed seed script adapted from the baseline `seed.js`):

- **G1** row columns: per list, `getBoundingClientRect().left` of each slot is equal across rows (±0.5px).
- **G2** icon centring: the icon's box centre-y is within 0.5px of the label box centre-y in
  `ui-btn`/`ui-row`.
- **G3** equal heights within any `ui-btn` group (same parent).
- **G4** rotation stillness: the frame sequence around rotate and Pocket exit shows no box moved by more
  than 1px after frame 1.

Pre-push runs G1-G3 on 4 scenes (channel card, notifications, Subscriptions, action bar; about 20s),
only when `public/` changed. CI runs G1-G4 on all scenes.

**D10.3 `docs/ui-exceptions.json`** (shrink-only).
- Shape: `{comment, rules:{<rule>:[{key, count, reason, added}]}}`.
  - Keys are file|selector|property or a class name, never line numbers.
- `ui-lint --enforce` fails when:
  - a live count is above its entry (new debt);
  - a live count is below it (debt was paid but the file was not shrunk);
  - the file is malformed.
- `test/unit/ui-exceptions-ratchet.test.js` compares against the merge-base's version
  (`git show $(git merge-base HEAD origin/main):docs/ui-exceptions.json`). It fails if a key is added or
  a count rises, and skips with a notice if there is no base.
  - It scrubs GIT_* env when shelling out (LESSONS: hook env).
- `--write-baseline` refuses to run if the file exists.
- Every run prints the debt remaining per rule.

**D10.4 Allowed at the end of the branch** (the only entries):
- the Pocket/whcal skin art scopes (listed by class);
- `read.html` pinch zoom and `ui-selectable`;
- `diag.html`'s `<style>`;
- the docked player bar's legacy geometry, because the player rewrite is carved out. Those entries
  carry `reason: "player overlay rewrite (post black-screen fix)"`.

**D10.5 CI visual job** (`.github/workflows/ci.yml`, a new job `visual`, required on main):
- It runs in the pinned `mcr.microsoft.com/playwright:<exact version matching tools/capture>-jammy`
  container, boots the app on the seeded `DATA_DIR` with `FILETUBE_READONLY=1`, and captures the scene
  matrix: scenes 01-30 + 40-42 from the baseline index x 4 eras x 2 modes x phone/desktop (landscape for
  the rotation scenes), with reduced motion, a frozen clock and volatile text masked.
- It diffs with `tools/capture/compare.js` (threshold 16, AA suppression) at **0 changed pixels**.
- Baselines live in `test/visual/baselines/`. They are produced **only** by a `workflow_dispatch`
  "rebaseline" job in the same container, then committed. A re-baseline commit is its own commit, named
  for the step.
- On failure it uploads the report and crops as an artifact.

**Wiring:**
- `npm run lint:ui` runs in `hooks/pre-commit`, `hooks/pre-push` (explicitly, not only via `npm test`)
  and CI next to the old "Token ratchet" step, which it replaces.
- `lint:overlay` stays.

### D11. Testing strategy

- **Per step:** targeted tests while building (see the testing-cadence norm), and the full dual-Node
  suite once or twice per phase, not per commit.
- **Source-lock conversion (AC12):**
  - The 136 tests that read style.css are triaged in step 0 into: (a) still valid, (b) convert to a
    primitive-contract test, (c) convert to a geometry check.
  - The triage table goes in the plan's Build log, and each sweep converts its own.
  - No lock is deleted without its replacement landing in the same commit.
- **New unit tests:**
  - `ui-contrast.test.js` (AC8)
  - `ui-era-roles.test.js` (AC11)
  - `icons-registry.test.js` (every referenced name exists, paths intact, three styles plus fill)
  - `ui-builders.test.js` (jsdom: each builder's DOM contract)
  - `interaction-policy.test.js`
  - `ui-exceptions-ratchet.test.js`
  - `resolve-icon-set.test.js` (emoji to filled)
  - `notif-delete-confirm.test.js` (D8.3)
- **LESSONS to brief** (docs/LESSONS.md): §2 test binding (mutate every new lint rule and watch it go
  red), §6 CSS/layout/stacking (the `[hidden]` vs `display` class, 102 per-class `[hidden]` patches: add
  a global `[hidden]{display:none!important}` in ui.css and delete the patches), §8 iOS facts (emoji
  presentation of U+25B6, input selection under user-select:none), §9 (destructive: D8.3).

### D12. Steps (each ends with a Demo; commit series per step)

0. **Branch and triage.**
   - Branch `feat/ui-professionalism` from main.
   - Commit the seeded fixture script and the baseline capture tooling under `test/visual/`.
   - Triage the 136 locks.
   - *Demo:* the triage table in the plan, and `npm test` green on the untouched tree.
1. **Tokens.**
   - Add `tokens.css` with D2 roles for 4 eras x 2 modes, plus the old names as aliases.
   - Add `ui-contrast` and `ui-era-roles` tests. Set `color-scheme` and `accent-color`.
   - *Demo:* the app renders identically except for colour-role corrections; the contrast test passes.
2. **Icons.**
   - Write `tools/icons/fetch.js` and `build.js`, then `icons.js` and the sprite injection.
   - Move all 13 shells' header/nav SVGs to `<use>`.
   - Drop the emoji set with its migration.
   - *Demo:* the Podcasts tab icon is whole (F29), the Settings "Shows folders" tile shows a TV
     (F39), and the icon-set switch still works in Settings.
3. **Primitives.**
   - Write `ui.css`, `ui.js` and `interaction.js` with every D4 primitive, plus a hidden `/ui-kit`
     route (or `setup.html?kit=1`) rendering every primitive in every variant and state. That page is
     the visual source of truth.
   - *Demo:* the kit page on the phone in 4 eras x 2 modes.
4. **Guardrails.**
   - `ui-lint` with all rules and canaries.
   - `docs/ui-exceptions.json` generated with `--write-baseline` (large at this point).
   - The ratchet test, the G1-G3 geometry checks, the CI visual job and rebaseline job, and the hook
     wiring.
   - The **hover-gated** mechanical wrap of all 92 ungated rules (one commit).
   - The D6 native-interaction base.
   - *Demo:* `npm run lint:ui` prints the debt per rule; a deliberately bad commit is refused by
     pre-commit; the hold-for-2x no longer raises the loupe (device).
5. **Sweeps S1-S10** in D5 order. Each sweep is a commit series that migrates, deletes, converts locks,
   shrinks the exceptions and re-baselines.
   - *Demo per sweep:* that surface on the phone next to its baseline shot, and the exceptions count
     going down.
6. **Behaviors** D8.1-D8.10, landing inside the sweep that owns their surface (D8.3 in S4, D8.5 in S2,
   D8.2/D8.4 in S3, D8.9/D8.10 in S5, D7 Pocket in S7).
7. **Retire.**
   - Delete the alias tokens and turn on `no-legacy-tokens`.
   - Delete `css-token-lint.js`.
   - Delete the dead CSS (style.css should drop by several thousand lines; record the number).
   - The exceptions file equals D10.4.
   - *Demo:* `lint:ui` debt equals only the D10.4 carve-outs; the full dual-Node suite passes; the
     visual job is green.
8. **Gate:** the full gate (destructive, D8.3): Adversary + QA + security-brief, briefed per D11
   LESSONS.
9. **Release** (docs/RELEASING.md): one version, the ROADMAP entry, the releases.json ledger entry, and
   the LESSONS entry ("tokens without components" as a bug class).
   - After release: the one-week live-with-it period with no feature work.
   - Dean's device checklist:
     - hold-for-2x;
     - long-press a card;
     - swipe a notification;
     - rotate in Pocket;
     - Subscriptions rows;
     - Settings switches;
     - the four eras.

### D13. Risks

- **Size.** This is the largest diff in the repo's history. The gate reviews it by step, reading the
  commit series in order, with the kit page and the visual diff as review artifacts.
- **Source locks.** They can mask a regression if converted carelessly. The AC12 "replacement in the
  same commit" rule and the Adversary's mutation pass cover this.
- **iOS policy.** A missed field-selection case breaks typing in an input. The Playwright computed-style
  check plus Dean's device pass cover this.
- **Pocket device gate.** An iPad or a desktop touch screen could misclassify. The rule is coarse pointer
  plus a short side of 500px or less. The build states the iPad result explicitly.
- **Rebaseline discipline.** A sweep could re-baseline away a regression. Re-baseline commits are
  reviewed as images (the diff report), never rubber-stamped.

## Build log

### Step 0 - branch and triage (2026-09-27)

- Branch `feat/ui-professionalism` from main at ab31cbdc; the first commit (0f169c02) carries this plan,
  the audit data and the ROADMAP entry.
- **Seed and capture tooling (c144db52), `test/visual/`.** Deviation from "adapted from the baseline
  `seed.js`": the audit's seed copied the local dev database and its thumbnails (real creators' titles and
  art), which cannot enter the public repo or CI. `seed.js` now builds the DATA_DIR from nothing: fictional
  channels (Harbor Workshop subscribed with notify on, Northbound Field Notes not subscribed, Home Videos
  with no channel), drawn PNG thumbnails and art (`tools/capture/png.js`), silent audio, the same yt-dlp
  subscriptions / music / podcasts / notifications / queue / progress shape. It wipes only a dir it made
  (marker file). `capture.js` is the baseline capture made repo-relative, reading ids and the login from
  `fixtures.json`; `start-server.sh` serves the seed with `FILETUBE_READONLY=1`.
  - Trial run (9 scenes x 6 viewport/mode combos): captured 54, failed 0; every surface populated. Unexpected
    blocked requests: 6, all `POST /api/music/resume` from the Pocket scene (the same benign block the audit
    recorded; fulfilled in the browser, refused by the server).
  - The capture guard's source lock (`capture-request-policy.test.js`, bare `newContext` banned) now also
    covers `test/visual/capture.js`. Mutated: a bare `newContext` appended to it turned the suite 14 pass /
    1 fail; restored, 15 / 0.
  - Open for step 4 (not deterministic across machines yet): ids hash the path, so they change with the data
    dir; the watch page prints the file path; relative dates follow the clock (`SEED_NOW` pins the seed side,
    the browser clock freeze is step 4's).
- **Demo: `npm test` on the untouched app tree (Node 22.23.1, at c144db52 + this log):** tests 10037, pass
  10028, fail 0, cancelled 0, skipped 9; exit 0; 320s. (Node 24 runs with the phase's dual-Node pass.)
- **Source-lock triage (D11).** The audit counted 136 locks (its method is not recorded); the grep below
  finds 141 files that mention style.css, 128 of which actually read and pin it.

Read at 0f169c02. `grep -rlE "style\.css" test/` = 141 files: 128 read and pin style.css, 13 only mention it.

**Totals:** (a) still valid 54 - (b) primitive-contract 62 - (c) geometry 12 - mention only 13.

**Per owner:** step 1: 7, step 2: 11, step 3: 5, step 4: 2, S1: 10, S2: 16, S3: 32, S4: 3, S5: 4, S6: 3, S7: 16, S8: 12, S9: 6, S10: 1 (step 7 owns no lock by itself: see note 3).

Owner = the first D12 step or sweep that deletes, moves or renames the pinned CSS, so the lock goes red there first. A file that is mixed shows its dominant class; the other half is named in the last column.

| Test file | Pins (short) | Class | Owner | Replacement intent (one short clause) |
|---|---|---|---|---|
| test/unit/era-scrollbar-css.test.js | era scrollbar rules, @supports engine partition, no raw colour | a | 1 | keep; retoken --radius-lg at step 7 |
| test/unit/era-typography.test.js | titles read --heading-font; Geist @font-face first | b | 1 | title roles read the --font-heading era knob |
| test/unit/ipad-header-safe-area.test.js | --header-h 56px; header consumes env(safe-area-inset-top) | a | 1 | keep; read --header-h from tokens.css |
| test/unit/modern-theme-geist.test.js | :root Geist default; retro eras no Geist; shells preload geist before style.css | b | 1 | Modern --font-ui = Geist in tokens.css; preload precedes tokens.css |
| test/unit/token-scale-lock.test.js | every token value byte-exact, defined once; every var() defined | b | 1 | value authority moves to tokens.css (+ ui-era-roles) |
| test/unit/type-scale-tokens.test.js | :root --fs-* block; every font-size is var(--fs-*) | b | 1 | --t-* roles in tokens.css; ui-lint no-raw-values (font) |
| test/unit/v1262-pwa-chrome.test.js | @font-face src = shell preload, font-display swap; .toast safe-area bottom | a | 1 | keep (follow @font-face if it moves); toast half -> ui-toast in S9 |
| test/unit/books-router-nav.test.js | reader/books classes live in style.css (SPA); .icon-books mask + emoji entry | b | 2 | icons-registry has books; S10: no-shell-style + class list (.books-shelf-chip -> ui-chip) |
| test/unit/card-like.test.js | .icon-heart mask/fill group; .card-like-btn corner look; .card-media relative flex | b | 2 | registry heart; S2: D8.5 no-overlay-buttons DOM test |
| test/unit/download-icon.test.js | .icon-download mask in every set, fill guard, no ::before glyph | b | 2 | registry entry download x3 styles |
| test/unit/glyph-pool.test.js | 7-site mask/set/emoji enumeration per pool glyph; shared sizing body | b | 2 | icons-registry: every pool name x3 styles, sprite symbol exists |
| test/unit/icon-assets.test.js | every mask icon in the @supports fill list; share fully wired | b | 2 | icons-registry: referenced names exist, paths intact |
| test/unit/icon-attribute-mask.test.js | .icon-attribute mask + 1em block + @supports fill | b | 2 | registry entry drive_file_move |
| test/unit/icon-queue-mask.test.js | .icon-queue mask, sizing, fill, not in emoji set, 14px corner | b | 2 | registry entry queue |
| test/unit/icon-transcript-mask.test.js | .icon-transcript mask + 1em block + fill | b | 2 | registry entry chat |
| test/unit/reheat-button-wiring.test.js | .icon-flame mask/sizing/fill; no \1F525 in CSS (rest is JS) | b | 2 | registry entry flame; no-glyph lint |
| test/unit/shuffle-rescan-icon.test.js | .icon-shuffle mask in 3 sets; emoji U+1F500 only in emoji set | b | 2 | registry entry shuffle (emoji set dropped, D2.6) |
| test/unit/tv-nav.test.js | .icon-tv mask (rest is JS) | b | 2 | registry entry tv |
| test/unit/app-look-l2.test.js | .btn[hidden]/.queue-btn[hidden] !important after base; .skeleton-text line box | b | 3 | global [hidden]{display:none!important} in ui.css; skeleton-text -> ui-state skeleton |
| test/unit/bottom-nav-order-authority.test.js | no CSS order/flow rule on bottom-nav items | a | 3 | keep; widen scan to ui.css |
| test/unit/music-album-view.test.js | #music-view-toggle[hidden] beats .btn inline-flex | b | 3 | global [hidden] contract (ui.css) |
| test/unit/overlay-containment.test.js | lint over style.css: rounded-scroll clip, sticky z-index | a | 3 | keep; widen lint:overlay to ui.css |
| test/unit/touch-eating-overlay-audit.test.js | every attr-hidden overlay has a [hidden] override; oneoff backdrop; ptr pointer-events none | b | 3 | global [hidden] last-wins + keep the negative control |
| test/unit/pinch-zoom-suppression.test.js | body touch-action manipulation; read view opts back; no font-size lock | b | 4 | interaction-policy test on the D6 base; reader listed |
| test/unit/router-helpers.test.js | html overscroll-behavior-x none | a | 4 | keep (follow into ui.css if D6 moves it) |
| test/unit/critter-mode.test.js | .main-content no bg/no stacking ctx; critter layer z 2; arrive/reaction anims + reduced motion | a | S1 | keep; D7 edits .main-content transition only |
| test/unit/header-right-reserve.test.js | .notif-bell-skel 22px round disc (zero-shift reveal) | c | S1 | G: bell placeholder box == bell box |
| test/unit/mobile-header-css-source-lock.test.js | .header-right-scoped mobile overrides: search show, avatar hide, dropdown card, download glyph-only, order | b | S1 | header ui-btn icon + ui-menu; G at 390px |
| test/unit/mobile-wordmark.test.js | no .mobile-logo rule; .logo not hidden on mobile | a | S1 | keep |
| test/unit/pinned-avatar-css.test.js | .pinned-avatar 18px circle, cover, no shrink; .sub-row/.sub-sheet avatar img fill | b | S1 | ui-avatar xs contract (fixed box, cover, monogram fallback); S5 half |
| test/unit/pre-paint-fouc-guard.test.js | .ft-custom-logo .logo hidden, img visible | a | S1 | keep |
| test/unit/reorder-single-mechanism.test.js | every reorder surface styles .dragging + both drop indicators | b | S1 | ui-row drag states in ui.css; widen STYLESHEETS |
| test/unit/search-clear.test.js | search-scoped strip nowrap/scroll, overflow visible with sort menu; clear X | b | S1 | X = ui-btn icon; strip layout stays in style.css |
| test/unit/v1262-sheet-modal-transitions.test.js | modal fade/scale + dvh cap; playlists-sheet slide up; sub-sheet slide right; reduced motion | b | S1 | ui-sheet open/close contract (--dur-sheet); S5/S9 halves |
| test/integration/version-meta.test.js | .account-menu-version text-align left | b | S1 | ui-menu footer row |
| test/unit/art-decode-shimmer.test.js | img.art-shimmer token gradient + sweep keyframes, reduced motion | a | S2 | keep; retoken --bg-secondary at step 7 |
| test/unit/attribution-client.test.js | .section-actions #attribute-folder-btn order-band rule exists | a | S2 | keep (surface order); button -> ui-btn |
| test/unit/card-corner-br-css.test.js | .card-corner-br anchor; duration badge offsets, z over preview, armed hide | b | S2 | D8.5 DOM test: badge + progress only; ui-thumb badge |
| test/unit/card-corner-mobile-size.test.js | 6 corner icons 18px + ::after tap zones on phone; list-view insets; desktop 14px | b | S2 | D8.5 no overlay buttons; kebab = ui-btn icon 44 hit |
| test/unit/folder-music-toggle-lock.test.js | off = line-through; on = --text-link | b | S2 | ui toggle pressed state; no link blue (D8.6) |
| test/unit/home-mobile-scale.test.js | phone grid cols/gaps, section-title wrap, labels hidden, tap widths, title size | c | S2 | G: 2 cols <=480, toolbar on one line, no overflow |
| test/unit/library-toolbar.test.js | .section-actions .btn pill recipe, inverted active; other toolbars pill | b | S2 | ui-btn pill / ui-chip + --fill-selected |
| test/unit/library-toolbar-wiring.test.js | .watch-toggle pills min-width 0; own mobile row (order, flex 70%) | b | S2 | ui-segmented contract |
| test/unit/library-view-prefs.test.js | .video-grid.list-view reflow exists | a | S2 | keep |
| test/unit/modern-css-source-lock.test.js | modern grid 3/4/1-up; chip pills; avatar bar; rounded thumbs; --ch-av mono; sort gate | b | S2 | ui-chip/ui-thumb/ui-avatar; grid columns stay |
| test/unit/pull-to-refresh.test.js | .ptr-indicator states, spin, reduced motion | a | S2 | keep |
| test/unit/reveal-art-together.test.js | img.art-shimmer.art-together hold; no bare .art-together | a | S2 | keep |
| test/unit/shimmer-tranche2.test.js | .related-thumb.skeleton-shimmer fill; avatar-bar name skel 14px | c | S2 | G: skeleton box == final box |
| test/unit/star-ratings-pref.test.js | .ft-hide-stars hides .star-rating + .card-rating; .watch-actions centred on phone | b | S2 | D8.1 era-flourish gate (jsdom per era) |
| test/unit/sticky-filter-bar.test.js | section-heading, count parens, actions wrap, sticky pin offset, bare .section-title not sticky | a | S2 | keep (surface layout) |
| test/unit/v1264-skeleton-states.test.js | .skeleton-shimmer sweep + reduced motion; skeleton card and sub-row box models | c | S2 | G: skeleton row/card == real geometry (D9) |
| test/unit/ambient-glow-engine.test.js | no filter/transform/mask/will-change on stage + glow; layer paint + opacity fade | a | S3 | keep (player carve-out) |
| test/unit/chapter-snap-shift.test.js | .chapter-snap-shift .btn in 44px phone list + desktop control-height list | b | S3 | ui-btn size contract (AC3, G3) |
| test/unit/era-player-skins.test.js | era skin block placement; no geometry; no hex; 2005 bevel | a | S3 | keep; recheck when the docked bar is restyled |
| test/unit/era-row-overflow.test.js | action group wraps phone+desktop, buttons never deform; More word hidden; share mask | c | S3 | G3 + action bar fits (D4.9 5 columns) |
| test/unit/fullscreen-edge-and-video-state.test.js | no fullscreen rule re-adds a host border | a | S3 | keep |
| test/unit/mobile-player-height.test.js | portrait .player-container max-height 40-50vh; base/landscape untouched | a | S3 | keep |
| test/unit/music-theater-toggle.test.js | #theater-btn hidden <1024, in dock, off watch/music; pressed red | a | S3 | keep; pressed colour vs D8.8 |
| test/unit/music-view.test.js | .audio-bg-art contain, never cover | a | S3 | keep |
| test/unit/player-audio-desktop-fs.test.js | staged twin art geometry; single-painter visibility hidden | a | S3 | keep |
| test/unit/player-audio-expand.test.js | expanded bar bottom 0 + safe-area padding | a | S3 | keep |
| test/unit/player-chapters-parity.test.js | pc-range touch-action; chapters-menu[hidden]; faux-fs z/max-height; 44px rows; dock hide; current red | a | S3 | keep; [hidden] half -> global (3) |
| test/unit/player-fullscreen-autohide.test.js | autohide opacity/pointer-events, :fullscreen twins, dvh/dvw, body black | a | S3 | keep |
| test/unit/player-fullscreen-stage.test.js | every host :fullscreen rule has its #fs-stage twin | a | S3 | keep; widen if a rule moves |
| test/unit/player-immersive-lock-grace.test.js | .controls-reveal-grace takes the bar out of hit-testing | a | S3 | keep |
| test/unit/player-media-aspect-css.test.js | --media-aspect 16/9 fallback; portrait clamp; cc-overlay offsets; docked caption | a | S3 | keep |
| test/unit/player-orientation-fs-resume.test.js | phone-landscape media height cap | a | S3 | keep |
| test/unit/player-responsive-controls.test.js | bar hides per mode; gesture-surface user-select; dock hide group; speed/mute; mobile order | a | S3 | keep; user-select rule needs a native-interaction listing (4) |
| test/unit/player-resume-countdown.test.js | .resume-actions .btn.countdown-armed drain + reduced-motion carve-out | b | S3 | D8.2 auto-resume toast; unit test on the resume decision |
| test/unit/player-rotation-cap-nudge.test.js | each vh cap carries its dvh twin after it | a | S3 | keep |
| test/unit/player-settings-cog-parity.test.js | .pc-svg-ico fill; settings-menu rows full width, bevel reset | a | S3 | keep |
| test/unit/player-video-tracknav-and-chapter-wrap.test.js | chapter-now flex-basis 0; prev/play/next order; dock hides; track-nav-btn[hidden] | a | S3 | keep; [hidden] half -> global (3) |
| test/unit/queue-chrome-client.test.js | .track-nav-btn[hidden] !important; dock hides prev/next | a | S3 | keep; [hidden] half -> global (3) |
| test/unit/stable-toggle-label.test.js | stable-width label slot rules, by value | c | S3 | G: toggle width equal across states (F21) |
| test/unit/theatre-mode.test.js | theatre height cap; desktop cap reads --player-cap-h | a | S3 | keep |
| test/unit/uploader-subs-badge.test.js | .uploader-subs token-built badge | b | S3 | ui-chip--meta (D4.9) |
| test/unit/watch-action-bar-container-query.test.js | .watch-action-bar named container; 959px compact; glyph line box | c | S3 | G: action bar one row; G2 icon centring |
| test/unit/watch-action-bar-nowrap.test.js | phone gap/padding; base wraps; buttons never deform; rating count hidden on phone | c | S3 | G1/G3 on the action bar |
| test/unit/watch-action-bar-reveal.test.js | --size-touch-watch-action 39px scoped; data-loading hides + shimmers children | b | S3 | ui-btn--stack height; reveal barrier kept |
| test/unit/watch-action-row-tiers.test.js | CSS compact selector == SECONDARY_ACTION_IDS; fixed order; More hidden | b | S3 | D4.9 5 columns + More; tier list only in JS (DOM test) |
| test/unit/watch-chrome-ambient.test.js | ambient stacking on the stage not #player-slot; phone clip-x; sidebar bg drop | a | S3 | keep |
| test/unit/watch-instant-paint.test.js | #player-slot:empty reserves 16/9 + 16px margin | a | S3 | keep |
| test/integration/watch-like-button.test.js | .btn.liked paints the heart red | b | S3 | toggle icon .fill state (D4.9); red is not a selected role |
| test/unit/mobile-touch-targets-css.test.js | phone block: .btn, .notif-row-dismiss, .queue-row-move 44px; .pc-range touch-action | b | S4 | ui-btn --hit 44 contract + G3; X removed (D8.3) |
| test/unit/notification-bell-client.test.js | .notif-row-thumb-wrap relative; panel duration badge fs-xs | b | S4 | ui-row media slot + badge (G1) |
| test/unit/panel-chrome-mirror.test.js | base select mirrors .setup-select; queue == notif panel decls; sticky z; thumb-wrap isolation | b | S4 | one panel/row primitive + ui-select contract; isolation kept |
| test/unit/reloc-preview-mount.test.js | .reloc-preview-* in style.css, not in subscriptions.html <style> | b | S5 | ui-lint no-shell-style + ui-sheet |
| test/unit/sub-row-chip-btn-family.test.js | chip role classes declare no box props; .btn-chip after .btn; 2009 gloss on .btn | b | S5 | ui-btn era treatment attached once; role classes box-free |
| test/unit/subscriptions-panels.test.js | .sub-sheet-backdrop flex + .sub-panel[hidden] none | b | S5 | ui-sheet + global [hidden] |
| test/unit/v1262-subs-and-rescan-polish.test.js | .sub-row-name/.sub-sheet-name app font; header-status min-height; rescan min-width | c | S5 | G: rows and toolbar do not reflow; --t-* roles |
| test/unit/library-shimmer-skeletons.test.js | grouped art-box .skeleton-shimmer (book/music/podcast) restores the fill | b | S6 | ui-art/ui-thumb skeleton state |
| test/unit/podcasts-nav-client.test.js | every podcasts className has a style.css rule; no shell styles | b | S6 | styling-source law over ui.css + style.css; no-shell-style |
| test/unit/row-glyph-inline-svg.test.js | .podcast-ep-action .chrome-icon 14px | b | S6 | ui-row trailing ui-icon (sprite) |
| test/unit/ipod-brick.test.js | overlay containing block = LCD inner box; wheel outside | a | S7 | keep (skin scope) |
| test/unit/music-actions-desktop.test.js | .mms-sm-act rule above the mobile sticker @media; #music-actions-menu anchored | b | S7 | ui-menu contract; the @media anchor moves (D7 html.is-phone) |
| test/unit/music-ambient.test.js | #ambient-toggle-row per-view hides; stage stacking desktop only; theatre margin | a | S7 | keep |
| test/unit/music-jumpback-reserve.test.js | .music-jump-art 116px + skeleton fill | c | S7 | G: jump strip skeleton == final (no shove) |
| test/unit/music-playback-modes.test.js | Loop/Autoplay ON = red background shorthand, hover-covered | b | S7 | --fill-selected/ink (D8.8) |
| test/unit/music-skin-integration.test.js | Nano tray reshape rules exist | a | S7 | keep (skin scope) |
| test/unit/music-skins.test.js | LCD cap, touch-action locks, art contain, cursor bar, voladj, .mms-rd, :where reset | a | S7 | keep (skin scope) |
| test/unit/music-sticker-menu.test.js | sticker img/size/tilt; menu rows 44px; app font; wheel scrubber | a | S7 | keep; row half converted with F70 |
| test/unit/music-toolbar-slots.test.js | .music-slot-reserved visibility only; sort select 15em; pop-out no box on phone | c | S7 | G: toolbar does not reflow across tabs |
| test/unit/player-tap-to-play.test.js | tap-to-play cue z under the sticker wrap, over skin chrome | a | S7 | keep (skin scope) |
| test/unit/pocket-design-system.test.js | colorway role blocks; structure/type tokens; one text-line rule | a | S7 | keep (skin scope) |
| test/unit/pocket-lighting.test.js | one wheel/dome rule reads the light; no filter; lit sticker keyed .mms-lit | a | S7 | keep (skin scope) |
| test/unit/pocket-original-look.test.js | look rules in the look section; turn transform + reduced motion | a | S7 | keep (skin scope) |
| test/unit/pocket-quick-scroll.test.js | drift animates transform/opacity only; picker safe centre; 6 cols <340px | a | S7 | keep (skin scope) |
| test/unit/skin-scrollbar-hidden.test.js | body.mms-on scrollbar hide, scoped | a | S7 | keep (skin scope) |
| test/unit/skin-status-bar.test.js | no rule undoes the one-line status bar; no writing-mode anywhere | a | S7 | keep; widen census to ui.css |
| test/unit/critter-manager.test.js | critter grid classes have rules; armed state --yt-red | b | S8 | danger role (D8.8); styling-source law |
| test/unit/master-detail.test.js | .md-back pinned left; title centred phone, left desktop | b | S8 | ui nav-header contract |
| test/unit/md-nav-desktop-gap.test.js | .md-nav flex gap is the sole group separator; .md-group | c | S8 | G: group headers do not move on first row click |
| test/unit/mobile-input-zoom-fontsize.test.js | inputs/selects >=16px on phone (oneoff, setup, sub-sheet) + census; desktop 13px | b | S8 | ui-field/ui-select 16px contract + census |
| test/unit/oneoff-modal-mobile-polish.test.js | .oneoff-modal cap/scroll, select min-width, full-width CTA, phone stack, tap heights | b | S8 | ui-sheet + ui-field + ui-btn primary |
| test/unit/settings-mobile-polish.test.js | .setup-box width, form-group/folder-item-row spacing, phone stack, .sub-row excluded | b | S8 | ui-field/ui-row form layout |
| test/unit/setup-automation-reveal.test.js | .reveal-toggle[data-loading] shimmer barrier | a | S8 | keep on the ui-switch rows |
| test/unit/setup-engine-client.test.js | engine channel card classes have rules | b | S8 | styling-source law over ui.css + style.css |
| test/unit/stats-breakdown-table.test.js | .folder-list-builder--fill lifts max-height | a | S8 | keep |
| test/unit/stats-master-detail.test.js | .md-row.md-hide-mobile hidden in the phone block | a | S8 | keep the modifier when .md-row -> ui-row |
| test/unit/trash-toolbar.test.js | .trash-toolbar flex + [hidden]; armed red | b | S8 | ui-btn danger + global [hidden] |
| test/unit/v1262-mobile-input-zoom.test.js | global phone input floor via --fs-input-min; class overrides; folder-name-input | b | S8 | ui-field 16px (D4.10) |
| test/unit/ddr-easter-egg.test.js | DDR arrow glyph neutral; 2-col desktop shortcuts; reduced motion | b | S9 | ui-sheet dialog; arrows via icons (AC4) |
| test/unit/handoff-card-styling.test.js | every card class has a rule; hidden rule; tokens resolve in 4 eras; html text-size-adjust | b | S9 | ui-toast/ui-sheet + ui-era-roles; text-size-adjust -> D6 (4) |
| test/unit/keyboard-shortcuts.test.js | Stats entry never hidden; 768 breakpoint exists | a | S9 | keep |
| test/unit/player-speed-btn-parity.test.js | speed sheet backdrop fixed at --z-modal; panel rule | b | S9 | ui-sheet (z ladder) |
| test/unit/v1264-empty-error-states.test.js | .empty-state/.error-state are real shared classes | b | S9 | ui-state block (D9) |
| test/unit/ytdlp-download-chip.test.js | #dl-status-chip font sizes tokened; summary dimmed, restored on hover/focus/expanded | b | S9 | ui-chip status; hover-gated (AC6) |
| test/unit/reader-immersive.test.js | html.reader-immersive hides the header and zeroes its clearance | a | S10 | keep |

#### Mention only (no content lock; no conversion)

- test/integration/shell-smoke.test.js - comment only
- test/unit/card-download-btn.test.js - comment only
- test/unit/liked-glyph-split.test.js - comment only
- test/unit/player-docked-resume.test.js - comment only
- test/unit/player-form-factor.test.js - comment only
- test/unit/skin-surface.test.js - comments only (cites .mms-haptic-ghost and the 768px block; D7 changes that block)
- test/unit/ytdlp-t6-repull-and-subs-ui.test.js - comment only
- test/integration/auth-flow.test.js - HTTP GET /css/style.css returns 200 (serving, not content)
- test/integration/route-census.test.js - HTTP probe: /css/style.css is not gated
- test/unit/auth-gate.test.js - allowlist path string
- test/unit/ledger-check.test.js - string fixture ("public/css/style.css:10")
- test/unit/comment-debt-census.test.js - witness path in the tracked-file census
- test/unit/css-token-lint.test.js - writes a tmp style.css fixture; owner 7 (css-token-lint retires, its tests migrate to ui-lint canaries)

#### Notes for the sweeps

1. **Whole-file scans go blind when rules leave style.css.** These (a)/(b) tests scan style.css as a whole and prove a negative ("no rule does X"). Once ui.css and tokens.css exist, a violating rule there passes them. Widen each one's file list at step 3 (ui.css) or step 1 (tokens.css): overlay-containment, bottom-nav-order-authority, skin-status-bar, keyboard-shortcuts (no rule hides the Stats entry), ambient-glow-engine, fullscreen-edge-and-video-state, player-fullscreen-stage, touch-eating-overlay-audit, mobile-input-zoom-fontsize (census), reorder-single-mechanism (STYLESHEETS), podcasts-nav-client / setup-engine-client / critter-manager / handoff-card-styling (the styling-source law), token-scale-lock (every var() is defined).
2. **Token relocation breaks step 1 first.** Tests that read :root tokens out of style.css (token-scale-lock, type-scale-tokens, modern-theme-geist, ipad-header-safe-area, and the token halves of sticky-filter-bar, watch-action-bar-reveal, mobile-header-css-source-lock, player-chapters-parity, v1262-mobile-input-zoom) fail when the definitions move into tokens.css. Point them at tokens.css in the step 1 commit.
3. **Step 7 (aliases deleted).** Many (a) locks pin old alias spellings (var(--bg-secondary), var(--yt-red), var(--fs-xs), var(--radius-lg), var(--text-link), var(--space-N)). Step 7 must re-spell each one to its D2 role in the same commit that deletes the alias. It owns no file outright, so it is not a row owner.
4. **The [hidden] family.** app-look-l2, music-album-view, touch-eating-overlay-audit, subscriptions-panels, trash-toolbar and the [hidden] halves of player-chapters-parity, player-video-tracknav-and-chapter-wrap and queue-chrome-client all pin per-class [hidden] patches. D11 replaces the 102 patches with one global rule in ui.css. Each conversion asserts that rule (display:none !important, and nothing later overrides it), and keeps touch-eating-overlay-audit's negative control.
5. **D8.8 conflicts.** music-playback-modes, music-theater-toggle, watch-like-button, player-chapters-parity (current row) and critter-manager/trash-toolbar (armed) pin red on a selected or armed state. The first three are not red roles under D8.8 and change meaning; armed/delete stays red as --danger.
6. **D7 width gate.** music-actions-desktop anchors on the mobile sticker @media block, and skin-surface.test.js (mention only) cites the 768px Pocket block. D7 turns that gate into html.is-phone, so S7 moves the anchor.
7. **Native-interaction lint vs a player rule.** player-responsive-controls (a) pins user-select:none / -webkit-touch-callout on #media-player, #audio-bg-art, .skip-controls, .speed-badge. D10.1 rule 6 bans any other user-select declaration. Step 4 must either delete the rule (the D6 body rule covers it) and convert that one test, or list it as a player carve-out.

#### Risky conversions (each guards a real past bug)

- **ambient-glow-engine** (a, S3): v1.312, Ambient ON blacked out every video on iPhone. The lock bans filter/transform/mask/will-change on the stage and glow. Keep it as it is; any ui.css rule reaching the stage must pass it.
- **fullscreen-edge-and-video-state** (a, S3): v1.336, a thin white border in every fullscreen (24 of 24 combos). A token or ui.css border on the player container would re-add it.
- **touch-eating-overlay-audit** (b, 3): v1.17.0, a hidden overlay kept display:flex and ate touches until a force-close. The global-[hidden] replacement must keep the negative control.
- **player-chapters-parity [hidden] half** (a, S3/3): v1.34.3, display:flex beat [hidden] so the chapters menu could never close.
- **mobile-header-css-source-lock** (b, S1): v1.85 device-pass failure, where later same-specificity base rules defeated the mobile header overrides (search, avatar, account sheet). Convert to a rendered check at phone width, not a selector lock.
- **mobile-input-zoom-fontsize + v1262-mobile-input-zoom** (b, S8): v1.25.4, iOS zooms on focus under 16px. The D6 viewport maximum-scale=1 is not a substitute. ui-field must keep 16px, and the census of every classed input must survive.
- **reloc-preview-mount, books-router-nav, podcasts-nav-client** (b): v1.41.8 and v1.37.1, where page-local styles were dropped on the SPA #view-root swap. Their replacement is ui-lint no-shell-style plus the styling-source law over ui.css.
- **panel-chrome-mirror** (b, S4): v1.68.3, card-corner selects shipped browser-bare (a class with no rule), and the z-index:2 duration badge escaped over the sticky panel header. Keep the isolation assertion.
- **pinned-avatar-css** (b, S1): v1.25.5, real channel avatars rendered unbounded in the pinned lists.
- **md-nav-desktop-gap** (c, S8): v1.157.1, the Settings/Stats group headers shifted up on the first row click and stayed there until a refresh. It was re-root-caused once already.
- **stable-toggle-label** (c, S3): v1.340, Notify shifted the row. Gate r1 W1 found every rule deletable with the suite green, so the geometry check must be mutation-proven.
- **card-corner-mobile-size** (b, S2): gate W3, corner tap zones shadowed sibling pills. D8.5 deletes the family, and the DOM test must prove no overlay buttons remain.
- **glyph-pool / icon-* family** (b, 2): v1.47.6, a mask without its @supports fill painted a blank box on device. icons-registry must prove every referenced name resolves in all three styles.
- **player-rotation-cap-nudge** (a, S3): v1.68.1, rotating landscape and back left the player at 45% height. It is untouched, but S7's rotation work (D7) sits next to it.
- **music-playback-modes** (b, S7): v1.284.1, an invisible ON state (the 2009 gloss painted over a background-color longhand). The ui-btn selected state must still show in 2009.

### Step 1 - tokens (2026-09-27)

- `public/css/tokens.css` (new) holds the D2.1 roles and D2.5 era knobs in all 8 era x mode blocks
  (2021 light = the `:root` safe default, so a missing or invalid era still resolves to Modern light), the
  D2.2 type roles (`font: var(--t-body)`, plus `--t-*-size` twins), the D2.3 geometry and D2.4 motion
  scales, `color-scheme` per mode and `accent-color: var(--accent-fill)`. The Phase-1 mode-invariant layer
  (spacing, sizes, overlay chrome, reader themes, z ladder) and the `--fs-*` scale moved in verbatim.
  style.css keeps only feature-owned families (`--md-*`, `--whcal-*`, `--mms-*`, the mobile header metrics).
- Load order: `tokens.css` directly before `style.css` in all 13 shells and the Subscriptions view, and in
  `diag.html`. `/css/tokens.css` joins the pre-auth allowlist in `lib/auth/gate.js` (login and welcome load
  it; static CSS, same trust level as style.css; `auth-gate.test.js` lists it). **Security seat: note this.**
- **Retro-era values:** each retro role takes that era's existing value (surfaces, ink, separator, outline =
  the old `--border-dark`, accent = `--yt-red`). The dark retro eras get a lighter TEXT red (`--accent`
  #ff4e45 in 2005/2009, #ff5a50 in 2014) because #cc0000 on their grounds is 3.2:1; their fills keep the era
  red. `--ink-3` equals `--ink-2` in the retro eras (they had no tertiary). `--ink-link` is the old link blue
  in 2005 only (D8.6), ink everywhere else.
- **Deviations (decided in the build, recorded here):**
  1. Aliases are limited to the eight old names with an EXACT role equivalent (`--font-family`,
     `--heading-font`, `--bg-color`, `--card-bg`, `--bg-secondary`, `--text-primary`, `--text-secondary`,
     `--border-color`). The rest (`--yt-red`, `--text-link`, `--btn-*`, `--header-bg`, `--bg-sidebar`,
     `--border-dark`, `--star-*`, `--radius*`, `--shadow*`) stay per-era literals: each mixes jobs that D2
     splits (e.g. `--yt-red` is both a text red and a fill red), so the sweep that owns its consumers splits
     it. In Modern, the header, sidebar and neutral-button grounds follow the C surfaces.
  2. The `--fs-*` scale is NOT aliased to the type roles yet: "nearest role" moves 10px to 11px, 16px and 18px
     to 15/17 and so on, i.e. a restyle of every surface at once. Each sweep moves its rules onto roles; step
     7 deletes the scale.
  3. `--r-sm/md/lg` are era knobs (0 in 2005, 2px in 2009/2014), not fixed scale values, so the retro eras
     keep their square corners when primitives adopt the radii.
  4. The old `--scrim` (.55, mode-invariant) was consumed by card corner glyph pills as well as backdrops. It
     is renamed `--scrim-legacy` (18 consumers, same value); `--scrim` is now the D2 backdrop role.
- **Tests (new):** `ui-era-roles.test.js` (36 roles and knobs in all 8 blocks, `color-scheme` per mode, no
  role redefined in style.css, the eight aliases exact, `--fill-selected` neutral) and `ui-contrast.test.js`
  (WCAG AA over 29 pairs per era x mode, var() resolved the way the cascade does, translucent fills
  composited; the excluded pairs and why are in its header). Mutated: a pale 2014 accent, a role dropped
  from 2009 dark, a role shadowed in style.css, an alias bypassed, a dim Modern `--ink-2`: all 5 red;
  restored, green.
- **Locks converted (AC12; none deleted):** `token-scale-lock` (reads tokens.css + style.css; `--scrim` ->
  `--scrim-legacy`; +41 D2 scale tokens, 179 pinned), `era-typography` and `modern-theme-geist` (era blocks
  from tokens.css; the family knobs `--font-ui`/`--font-heading`; the gate C1 lock now asserts each retro
  era sets its OWN stack and the aliases exist; the shells' load order preload -> tokens.css -> style.css),
  `era-row-overflow`, `handoff-card-styling`, the `--fs-*` parsers (`home-mobile-scale`,
  `mobile-input-zoom-fontsize`, `v1262-mobile-input-zoom`, `watch-action-bar-nowrap`, `type-scale-tokens`),
  and the token-definition reads in `ipad-header-safe-area`, `sticky-filter-bar`, `watch-action-bar-reveal`,
  `player-audio-expand`, `player-chapters-parity`, `critter-mode`, `card-corner-br-css`. Shared helper:
  `test/helpers/stylesheets.js`.
- **Demo (measured):** the same 6 scenes (home, Subscriptions, podcast detail, watch channel row,
  notifications, Settings) x phone/landscape/desktop x light/dark, base tree vs branch, all four eras (288
  shots, 0 capture failures), diffed with `tools/capture/compare.js`: **2005, 2009, 2014: 108 of 108 shots
  identical (0 changed pixels).** 2021: 36 of 36 changed, the C palette (black ground with #1c1c1e cards in
  dark; #f2f2f7 ground with white groups in light). Unit suite (Node 22): tests 7725, pass 7725, fail 0 (the
  first rerun had 1 failure, era-row-overflow reading 2021 light as `:root`; fixed); `lint:css` 0,
  `lint:overlay` 0, eslint 0 errors. `test/visual/capture.js` gained `--era`.


### Step 2a - the icon registry and sprite (2026-09-27, f7aa126d)

- `tools/icons/names.js` (65 Material Symbols names, 9 with FILL twins), `fetch.js` (Apache-2.0 sources at
  a pinned google/material-design-icons commit into `tools/icons/src/{outlined,rounded,filled}`; `filled` =
  the Outlined family at FILL=1) and `build.js` (compiles `public/js/icons.js`, 67 KB / 16 KB gzipped; every
  `<path>` kept; `--check` for staleness). **Deviation:** sources live under `tools/icons/src`, not
  `public/assets/icons/`, because the existing public assets still feed the `.icon-*` masks and the glyph
  pool until their sweeps; overwriting them would restyle those now.
- `icons.js` exposes `FTIcons.inject(set)`: a hidden sprite of `<symbol id="i-NAME">` as the first child of
  `<body>`. Each shell with chrome glyphs (10 app shells + the Subscriptions view) loads it in `<head>` and
  calls it from the first script in `<body>`, so glyphs still paint with the text (the v1.87.1 rule);
  `applyIconSet` swaps it when the set changes.
- `chromeIconMarkup` / `chromeIconEl` keep their API over a `CHROME_ICON` name map and emit
  `<svg><use href="#i-NAME"/></svg>`; new `spriteIconEl` for the header bell and queue. The shells' static
  header/nav/sidebar glyphs and both pre-paint reserve blocks draw from the sprite.
- **Visible changes (deliberate):** the chrome glyphs now follow the icon-set picker (they were fixed at
  rounded since v1.87.1 because inline paths could not follow it; a fresh user's default set is outlined);
  the Music tab is `music_note` (was a play arrow); the Subs tab is `subscriptions` (was refresh); the
  Podcasts glyph is whole (F29).
- **Bug caught by the render, fixed:** the UA `[hidden]` rule is scoped to the HTML namespace, so the SVG
  sprite kept a 300x150 box and pushed desktop Home down. Fixed with `#ft-icon-sprite { display: none }`
  (style.css, moves to ui.css in step 3) plus width/height 0; `icons-registry.test.js` pins both.
- Tests: `icons-registry.test.js` (icons.js == build of its sources; every path kept; all names in all
  sets; every referenced `#i-` name exists; inject contract; shell wiring). Converted (none deleted):
  `chrome-icons` (per-path byte binds -> the name-to-registry identity map, pinned whole), `app-look-l2`
  (reserves draw the same registry names; "before the first external script" now means in `<body>`),
  `music-view`, `row-glyph-inline-svg`, `stable-toggle-label`, `sub-row-chip-btn-family`,
  `watch-init-behavioral`.
- Demo (measured): against a server built from the step 1 commit, 18 shots (home, watch channel row,
  notifications x 6 viewport/modes): only glyph pixels change, max 0.10% of a shot, no layout shift. Unit
  suite (Node 22): 7710 pass, 0 fail.

### Step 2c - F39, the Shows tile (2026-09-27, 7125efdd)

- `MD_ICON_PATHS` gains `tv`; `md-icons-resolve.test.js` requires every `data-md-icon` /
  `data-md-hero-icon` a shell names to exist (mutated: removing `tv` fails it naming setup.html). The tiles
  are a fifth icon system (stroke glyphs); S8 moves them onto the registry.

### Step 2b - the emoji icon set removed (2026-09-27)

- Branch `feat/ui-pro-emoji` from 7125efdd; commits cb6afb40 (the removal) and 4255da09 (a lock fix
  mutation found, below).
- **Axis (D2.6):** `ICON_SETS` = outlined | rounded | filled; `AUTO_ERA_ICON_MAP` = 2005/2009/2014 filled,
  2021 rounded; the Settings picker is Auto, Outlined, Rounded, Filled. Deleted: the 74
  `[data-icons="emoji"]` rules in style.css (the neutralize group, the `::before` glyphs, the v1.147 corner
  auto-size exception) and the glyph pool's `emoji` codepoints. The icons README and tech-debt row 113 say
  three sets.
- **Migration:** `migrateIconPref` (common.js, `LEGACY_ICON_SET_MAP = { emoji: 'filled' }`) runs in
  `resolveIconSet`, in the v1.43 mirror seed (`icons: 'emoji'` from /api/auth/me seeds `filled`) and in
  setup.js's picker highlight; all 13 inline bootstraps map `emoji` to `filled` before resolving. A
  prefs-sync row lands in `ft-icons`, so it takes the same path. **Decision:** boot resolves a stored
  `emoji` but never rewrites it - a boot write changes the value, so prefs-sync would stamp and push it and
  beat a newer choice from another device (the last-BOOT-wins class). A picker click replaces it.
- **Tests:** `resolve-icon-set` covers emoji -> filled (every era) and the new auto map, pins the axis
  (ICON_SETS, picker ids, sprite registry sets, no `[data-icons]` rule for any other set) and runs each of
  the 13 bootstraps in a vm over 6 eras x 7 stored values against `resolveIconSet`. New
  `icon-set-migration` (jsdom, real glyph-pool + icons + common, setup.js's real `renderIconPicker`): boot
  paints filled and draws the filled sprite without writing `ft-icons`; the mirror seed; a local choice
  beats a server `emoji`; picker ids and highlight. Shared helper `test/helpers/icon-sets.js`
  (`effectiveMask`: the mask each spelling resolves to per set, scoped rule over bare, last wins).
- **Locks converted (AC12; none deleted):** `books-router-nav` (emoji entry + strip membership -> books.svg
  paints in all 3 sets, both spellings, + @supports fill membership); `card-corner-mobile-size` (the
  emoji auto-size exception -> no `[data-icons]` rule re-sizes a corner icon); `download-icon` (emoji
  neutralize + U+1F4E5 -> each set paints its own download.svg in both spellings, no `::before`);
  `glyph-pool` (seven sites -> five, + every glyph paints its own asset per set; the codepoint-collision
  rule and Dean's Shows/Downloads ruling now bind mask pictures per set, twins favorites+liked and
  shows+tv; registry entries carry no `emoji`); `icon-queue-mask` and `icon-transcript-mask` (out of the
  emoji group -> falls back to the base mask in all 3 sets); `shuffle-rescan-icon` (U+1F500 only under
  emoji -> no `::before`, no U+1F500 escape, own shuffle.svg per set); `icons-registry` (inject of an unknown
  set uses `bogus`); `icon-assets` (comment). Left alone (not the icon set): the Pocket sticker's emoji kind
  (setup-sticker-picker, music-sticker-menu, pocket-lighting, skin-surface.js, pocket-lighting.js), and
  the iOS colour-emoji glyph guards.
- **Mutation (sandbox of the committed tree, 20 mutants, each restored and diffed):** all 20 red. The
  migration: LEGACY map emoji -> outlined (18 red across resolve-icon-set + icon-set-migration), the
  `migrateIconPref` call dropped from `resolveIconSet` (15 red), tv.html's emoji line deleted (1 red, its
  bootstrap test), subscriptions.html emoji -> rounded (1 red), index.html's 2005 auto -> outlined (1 red),
  the mirror seed passing raw `s.icons`, the picker skipping the migration, boot rewriting `emoji` (1 red
  each). Locks: a set-scoped kill on books, books out of the fill list, a -webkit-only download kill, a
  set-scoped corner re-size inside @media, a shuffle `::before`, a queue kill, a transcript override, a
  late filled kill on `.icon-liked`, Downloads on the rounded TV (2 red), an `emoji` field back on a pool
  entry, an emoji-set rule back, the Emoji picker option back (2 red). The corner re-size mutant SURVIVED
  the first cut (a `[^}]*` body swallowed the first rule inside @media); fixed in 4255da09 and re-run red.
- **Counts (Node 22.23.1):** `npm run test:unit` tests 7735, pass 7735, fail 0 (exit 0; the pre-commit run
  of 4255da09 the same). Targeted integration (shell-smoke, star-pref-seed, history-nav-gate,
  folder-glyph-api, library-glyph-api): tests 28, pass 28, fail 0. `npx eslint .` 0 errors, 6 warnings (the
  existing common.js unused-global warnings). `npm run lint:css` TOTAL 0.

### Step 3 - primitives (2026-09-27; 0e267042, b8623da5, cc97cf47, f319c9c6, ea5fac98, ea5b89b2)

- **Built:** `public/css/ui.css` (every D4 primitive; tokens only; hover gated; a pressed state per
  interactive part; no layout transition; the one global `[hidden]{display:none!important}`, which also
  hides the SVG sprite), `public/js/ui.js` (the builders: icon, button + setPressed/setBusy, list, row,
  avatar, thumb, chip, sheet, menu, toast, confirm, prompt, switch, segmented, field, select, state, copy),
  `public/js/interaction.js` (onLongPress, onContextMenu, onActionMenu, swipeRow), and the hidden kit page
  `public/ui-kit.html?era=&mode=&icons=`. ui.js and interaction.js were built in parallel worktrees against a
  fixed DOM contract and cherry-picked. New tokens: the primitives' metrics, 8 monogram tones, the inverted
  toast pair, `--dur-spin` (token-scale-lock 198). Registry gains `visibility`/`visibility_off`.
- **Load order:** `ui.css` between `tokens.css` and `style.css` in 12 shells + the Subscriptions view;
  pre-auth allowlisted like tokens.css (**security seat: note**). ui.js/interaction.js load only on the kit
  page until the sweeps wire them.
- **Interpretations recorded by the builders (for the gate):** each sheet takes its own body-lock owner
  (`ui-sheet:N`) so a menu's exit cannot release the lock under a confirm it opened; confirm/prompt settle
  when dismissal STARTS; popover anchor = the anchor's left/bottom; a sheet with no title gets aria-label.
  swipeRow is stricter than D8.3: an action runs only from a tap that began on its revealed button with the
  row open and idle; every action must declare its kind (setup throws otherwise, and on a danger fullSwipe);
  a full swipe needs max(threshold x width, actions width); the click after a drag or long-press is
  swallowed once (400ms); a script calling `.click()` on an open row's Delete still runs it (jsdom cannot
  make trusted events), so D8.3 keeps Delete behind `ui.confirm` at the wiring.
- **Tests:** ui-builders (39), interaction-policy (38), ui-css-contract (9), plus the contrast/era/token
  additions. Mutation: ui.js 18 mutants, 16 red first pass, 1 survivor exposed a weak test (fixed, red), 1
  masked by the earlier guard (a combined mutant goes red); interaction.js 22 mutants, 20 red + M17 masked
  by the outside-tap close (combined M22 red); ui-css-contract 2/2 red. Unit suite (Node 22): 7814 pass, 0
  fail before the kit commit; each later commit's hook green.
- **Renders:** ui.css + global [hidden] on the existing app, 76 shots vs 0e267042: 0 changed pixels after a
  server restart. **Determinism note for step 4:** a long-running seeded server re-checks the podcast feeds
  and a status line changes; the visual job must boot fresh with feed polling off. Kit in 4 eras x 2 modes
  (phone), desktop, an open menu, a danger confirm: every primitive draws, no page errors. Found and fixed
  by the render: 2005 underlined row links (F20), a focus ring on every sheet's Close (focus now goes to the
  sheet), two look-alike monogram tones.
- **Demo for Dean:** `/ui-kit.html` on the phone (switch era/mode/icons at the top; long-press and swipe the
  two rows under Gestures).


### Step 4 - hover wrap + the D6 native-interaction base (2026-09-27, branch feat/ui-pro-native)

- **Hover wrap (AC6, d6d0b555):** the 92 ungated `:hover` rules of style.css (of 94) each moved inside
  `@media (hover: hover)` in place; 22 mixed selector lists split (the non-hover part keeps the rule, the
  hover part follows it in its own block, same declarations). Scrollbar, Pocket and player hovers wrapped
  too; none needed an exception. Not touched: the Subscriptions view's inline `<style>` (S5) and diag.html.
  Measured on the seeded instance (style.css swapped by route): desktop, 13 hovered targets, computed style
  identical before/after on all 13; phone emulation, 9 tapped targets, sticky tint before 7, after 0.
- **D6 base:** at the top of ui.css exactly as D6 lists it, plus `.ui-selectable` (the reader's
  `#reader-pane` and the `?debugLifecycle=1` overlay, nothing else) before the field re-enable, which is the
  last user-select rule of the three sheets. Deleted from style.css (the base covers them): 14 user-select,
  3 `-webkit-touch-callout`, 2 `-webkit-tap-highlight-color` declarations over 12 rules, including the
  version footer's `user-select: text` (the LOCKED ruling: not a listed opt-in). None stay. html
  `text-size-adjust` and body `touch-action: manipulation` moved into the base (the reader's
  `touch-action: auto` carve-out stays in style.css and wins by specificity). Viewport meta = common.js
  `VIEWPORT_ZOOM_LOCKED` in 13 shells + the Subscriptions view; read.html keeps `VIEWPORT_ZOOM_FREE`;
  diag.html untouched (standalone diagnostics page). Overscroll `none` on the root while Pocket / faux
  fullscreen / expanded audio is up (`html:has(> body.mms-on|ft-css-fullscreen|ft-audio-expanded)`) and on
  those surfaces and `.playlists-sheet`; the pre-primitive sheet/modal scrollers take `contain`, like
  `.ui-sheet__body`.
- **Hold-for-2x: NOT moved onto `FTInteraction.onLongPress` (not a contained change).** What S3 owns:
  1. onLongPress has no release callback; the hold must restore the rate on lift. S3 adds one (an
     `onRelease`/hold variant in interaction.js) with its own tests.
  2. It is pointer-event based and fires at 450ms / 8px; the player's layer is touch-event based at
     `HOLD_MS` 500 / `MOVE_TOL` 16, and 16 is the v1.22.1 device fix for thumb jitter on `#audio-bg-art`.
     Porting needs a ruling on the numbers (or opts `{ ms: 500, tolerance: 16 }`).
  3. The same touchend handler classifies tap / double-tap skip / skip chain / art single-tap and releases
     the hold; onLongPress's swallow-the-next-click after a fire meets the docked tap-to-expand path and
     `scheduleArtSingleTap`. The classifier must stay on its own listener.
  4. The latch reset (`resetTransientPlaybackUi` from dock/close/pagehide/freeze/hidden) must move with it.
  5. F22 (listeners stop being passive during the hold) lands with the move; the 2x pill restyle is S3's.
  - Today the D6 base covers the gesture surfaces (the per-surface rule is gone; player-responsive-controls
    now proves no re-enable rule reaches `#media-player`, `#audio-bg-art`, `.skip-controls`, `.speed-badge`
    or the player mount points in any player shell). **Diagnosis note:** the old per-surface rule already
    covered those four surfaces, yet Dean saw the loupe, so the cause is either selection on a surface it
    missed (overlay text, the page around the player; the body base now covers all of it) or not selection
    at all. **Falsifier:** if the loupe still shows on device with this base, it is not selection; the next
    suspect is iOS's own long-press on the passive touchstart, which S3's non-passive hold addresses.

### Sweep S6 - Podcasts (2026-09-27, branch feat/ui-sweep-s6 from 6b7408d6; 0c55eb5c, 64ccce63)

- **Primitive addition (0c55eb5c, its own commit):** `ui.sheet` / `ui.menu` / `ui.confirm` take a
  `signal`. An abort closes the overlay (a confirm answers false); an already-aborted signal never
  opens one. Why: a view's menus and confirms live on `<body>`, outside `#view-root`, so an SPA nav
  away left them over the next view. `ui.prompt` unchanged. One new ui-builders test.
- **Surface (64ccce63):** the show list is a ui-list of media rows (64px ui-art, "author · N
  episodes"); the header is a 2xl ui-art (144px desktop), title, author, notes, counts, with the crumb
  reduced to Back (F41: no duplicate title) and one action group on its own line: Pin (stable Pin/Pinned
  toggle, BUSY while the pins load, never disabled), Pause/Resume checks, a More overflow holding
  Unsubscribe. Episode rows are ui-rows with two reserved action columns (Add to queue, a kebab) on every
  row (AC5); Played, Queued, In trash and "Xm left" are meta text (F27); Like, Mark played, Save to
  device, Move to Trash and Restore live in the kebab menu. Toolbar: tonal Check feeds, a gear icon
  button, ONE primary Add podcast (F26 podcasts half). Add and settings are ui.sheet dialogs. D9: a
  ui.state zero state; a failed load is an error state with Retry; skeletons are the real ui-list DOM.
  Both lists are pulled flush with the page gutter (a token-built negative margin, token-exempt:
  positional): ui-row's padding + reserved lead column + gaps otherwise start the art and titles
  24-32px right of the page title.
- **Destructive paths (full gate):** Move to Trash and Unsubscribe go through `ui.confirm` (danger)
  and call the same endpoints as before (`DELETE /api/podcasts/episodes/:id`,
  `DELETE /api/podcasts/subscriptions/:id`) only after it resolves true; the in-row two-tap arms are
  gone. `test/unit/podcasts-ui-sweep.test.js` drives the real view with the real ui.js: Cancel, Esc,
  the scrim and Close each fetch nothing (and a late OK on the closing dialog stays false), a confirmed
  double tap sends exactly one DELETE, tapping every row and header control twice deletes nothing, and a
  confirm left open across a view teardown never deletes.
- **F42 (server.js, read-only):** a yt-dlp show's `artUrl` is its channel avatar (the sub's own
  `channelAvatarUrl`, the channelId registry, then the newest visible episode's baked avatar or its
  channelId), every candidate through `sanitizeChannelAvatarUrl` (https only), else null -> the client's
  monogram; never `/thumbnail/<newest item>`. Nothing stored changes.
  `test/integration/podcast-ytdlp-show-art.test.js`: 4 tests (the chain, http:/javascript: refused, null
  for none, the store and items byte-identical after the reads). `podcasts-ytdlp-shows` expected the old
  frame; converted (deliberate).
- **Locks converted (AC12, none deleted):** podcasts-nav-client (styling-source law reads ui.css +
  style.css and now sees BEM `_` parts - the old `[a-z0-9- ]` scan never saw a ui-* part; the heart guard
  follows the like into the menu), row-glyph-inline-svg (ui.button sprite icons + the ui-btn icon slot
  contract), library-shimmer-skeletons (podcast rows placeholder; the `.podcast-card-art` fill entry
  deleted), crispness-p3-skeletons, art-decode-shimmer (one art builder, 10 -> 9 sites), critter-mode
  (the anchor pool names `.ui-art`, its ground read from ui.css), the four podcasts view harnesses (load
  ui.js; `data-show-id` / `data-episode-id` hooks), `lib/media-capabilities.js` markers (the menu
  labels; the census went red on the stale `Move to trash` marker - the inert-sibling-list class, caught).
  capture.js scenes 08/09 wait on `[data-show-id]`.
- **Debt (ui-lint --shrink; the Podcasts-keyed entries before -> after):** no-raw-values 28 -> 2 (the
  2 left are the shared `.icon-*` mask rule, S2's), no-bespoke-controls 55 -> 17 (left: shell chrome S1,
  the player template's `pc-btn`/resume buttons S3, the theatre button), icons 12 -> 9 (left: the player
  template's glyphs, the theatre svg), display-ownership 2 -> 0; legacy-token (OFF) 62 -> 0. Whole file:
  TOTAL 2703 -> 2634.
- **Deferred:** the desktop theatre button stays `.btn` with its drawn popcorn svg (it shares
  `.music-theater-btn` and the glyph with Music; S7 moves both together); the podcast Extras adapter's
  `onDelete` in the player menu still uses `showConfirmModal` (the shared player Extras core is S7's; the
  music adapter uses the same path, r1-extras-podcasts-races pins it).
- **For the primitives (not changed here):** a media-less ui-list still reserves the lead column and
  two gaps (32px) before the title, and a 2005 `ui-btn--icon` is round unless it is also `--pill`
  (the gear takes `--pill` so it squares with its neighbours). The sweeps will keep paying the list
  indent until ui.css collapses it.
- **Measured (seeded instance, Node 22.23.1):** before (6b7408d6) vs after, scenes 08 + 09 x
  phone/land/desktop x dark/light x 4 eras = 48 pairs, captured 48 / failed 0 each side, 48 of 48
  changed (as intended; 3.1% - 21.8% of a shot). Probe (2021, phone 390 / desktop 1440): toolbar one line,
  all three 32px; show art left edge = page title left edge (16 / 254), 64x64, radius 8px; episode
  titles at the page gutter; the kebab and queue x identical on every row (phone 282 / 326); header
  actions one line, equal heights (44 phone, 36 desktop); the kebab glyph's centre 0px from its button's
  centre; 0 page errors; 0 blocked requests. Dialog / menu / confirm shots taken in both.
- **Mutation (a /tmp git-archive sandbox of 64ccce63, each restored and byte-checked):** 14 of 14
  killed - trash and unsubscribe DELETE regardless of the answer, the trash item deleting without a
  confirm, both unsubscribe abort guards dropped (each alone is masked by the other, by design), a yt-dlp
  show guessing the cover route, the kebab appended instead of slotted, Pin disabled instead of busy,
  Played dropped from the meta, a failed load showing the empty state, the server falling back to the
  video frame, the own avatar unsanitized, the registry step skipped, and the two ui.js signal arms.
- **Counts (Node 22.23.1):** `npm run test:unit` (the 64ccce63 pre-commit run): tests 7873, pass 7872,
  fail 0, skipped 1. Targeted integration (podcasts-api, podcasts-feature-atomicity,
  podcasts-restore-race, podcasts-ytdlp-shows, podcast-ytdlp-show-art, rbac-census,
  rbac-podcast-enforcement, rbac-podcast-external-shows, route-census, shell-smoke): 58 tests, 57 pass,
  1 fail before the podcasts-ytdlp-shows conversion; that file 6 / 6 after. `npx eslint .` 0 errors,
  6 warnings; `lint:ui` OK, TOTAL 2634; `lint:css` TOTAL 0; `lint:overlay` 0 violations.

### Step 4 - wiring, the baseline and the ratchet going live (2026-09-27; f6d06b94, e1e9b059, 6b7408d6)

- Merged: ui-lint (ba92db70, 1acdcf72) and the hover wrap + D6 base (6364a00f, 081efd5d). colour-roles also
  bans the legacy `--yt-red`/`--yt-red-dark` in a selected state (44 D8.8 sites now in the baseline instead
  of passing; canary expect 7, reverting the regex fails it 5 of 7).
- `docs/ui-exceptions.json` written with `--write-baseline` on that tree: **2703** items over 11 rules
  (no-raw-values 1297, no-bespoke-controls 1091, icons 163, display-ownership 86, colour-roles 44, z-ladder 11,
  hover-gated 3 (diag.html), native-interaction 3, no-layout-transition 2, no-shell-style 2, pressed-state 1;
  no-legacy-tokens OFF until step 7, 1650 if on).
- `lint:ui --enforce` in hooks/pre-commit, hooks/pre-push and CI (the test job checks out full history so the
  ratchet test diffs against the merge-base). **Demo:** a commit adding `.demo-x:hover { color: var(--ink-1); }`
  to style.css was refused by the pre-commit hook: `[hover-gated] public/css/style.css|.demo-x:hover live 1 >
  allowed 0`; HEAD unchanged. (A raw-hex variant was refused first by the old token ratchet.)
- `ui-lint --shrink` lowers paid entries (deleting zeroes) and refuses, writing nothing, on any new debt; tested
  and mutation-checked. Sweeps shrink with it; on merge conflicts in the exceptions file take either side and
  re-run `--shrink`.
- ui.js + interaction.js load before common.js in every shell (login/welcome too; both pre-auth allowlisted -
  **security seat: note**). Smoke: 46 shots, 0 page errors.
- **Primitive fix from S6's report (after S6 merged):** lists put the text on the row's start edge unless they
  declare a lead or media column. Each declared column carries its own spacing (column-gap 0), the unread-dot
  column is opt-in (`ui.list({lead: true})`), undeclared slots are `visibility: hidden` (they must stay in the
  grid), and only grouped lists get the 16px inner inset. S6's negative-margin workaround is deleted. 2005 icon
  buttons are square. Rendered: podcast art and episode titles flush with the page title; the kit's
  notifications list keeps its dot column.


### Sweep S10 - Books and reader (2026-09-27, branch feat/ui-sweep-s10 from 6b7408d6)

- **Commits:** 5c8f20dc (icon registry gains `toc`, `format_size`, `remove`: the one primitive-side
  addition, its own commit; tokens/ui.css/ui.js/interaction.js untouched), 6d936d2d (synthetic books
  fixture + scenes 50-54), 6fc72af6 (the sweep), c70a9120 (two bindings the mutation pass found
  unbound), then this log.
- **Fixture (seed.js):** `<DATA>/bookslib` holds two shelves, Harbor Library (4 EPUBs) and Night
  Reading (2 EPUBs + a cover-less one-page PDF). The EPUBs are stored zips built in-process
  (`zlib.crc32`; container.xml, an OPF with an EPUB3 cover-image PNG from the same drawn-image
  generator, a nav TOC, 2-3 chapters of fictional prose). They go through the real config route and
  scanner; two are in progress, one is liked, Harbor Library is pinned; `fixtures.json` gains `book`
  and `bookShelf`. capture.js gains 50-books-library, 51-books-shelf, 52-reader, 53-reader-contents,
  54-reader-settings; the capture's request policy lists `POST /api/books/:id/progress` as an expected
  block (the books twin of `/api/progress`).
- **Books library:** Sort is a tonal pill ui-btn opening a ui.menu (check = current order; the pick
  re-fetches and is remembered), Scan a ui-btn that is busy until the refresh; the `.btn.btn-sm`
  select is gone (tech-debt #252's books half; the tracker row is not edited). Shelves are ui-chip
  filter buttons navigating through the router (selected = `--fill-selected`, never red). The
  per-chip star glyph became ONE Pin toggle for the selected shelf (`keep`/`keep.fill`, "Pin shelf" /
  "Pinned", F32); the All view has none. Covers are ui.thumb 2:3 cards (progress as `--p` data) built
  with DOM calls; titles are `--ink-link` (ink, blue only in 2005: 2009/2014 titles change from link
  blue to ink, D8.6). **D9:** a failed load is an error ui-state with Retry, never "No books yet"; an
  empty library says how to add books (Open Settings); an empty shelf/search says so without it.
- **Reader chrome (F69):** one-row toolbar of ui-btn icon buttons (44px hits) with reserved slots:
  Back, title, [Listen, only narrows the title], Contents, Aa, Like, More. Like and More are disabled,
  not hidden, until the detail resolves (no pop-in). Like is an icon toggle (`favorite.fill`), never
  the red btn-primary fill; Finished (now with a result toast), Save to device and Share are in the
  More ui.menu. Contents is a ui.sheet panel of ui-rows (nested entries indented); Aa is a ui.sheet
  (popover on desktop, bottom sheet on a phone) with ui.segmented themes (the active one now shows)
  and a bounded text-size stepper ("Fixed" for PDF). The arrow keys stand down while a reader sheet
  is open; destroy() closes any open sheet (they live on `<body>`). A book that cannot open is an
  error ui-state with Back to books; "Tap to start listening" is a primary ui-btn (no U+25B6); the
  progress bar scales by `--p`; the chassis height is `--reader-h` data; PDF placeholders are a
  class. The narration bar's cover is ui.avatar kind 'book' (ui-art). The page (epub.js iframe,
  PDF canvases) and the `--reader-*` themes are unchanged.
- **Locks converted (AC12, each replacement in 6fc72af6):** books-router-nav's v1.37.1 class list ->
  the styling-source law, derived (every class the two views use has a rule in ui.css or style.css;
  no shell `<style>`; one listed exception, ui.thumb's default `--card` modifier); its T8 string test
  -> buildBookCard on a jsdom document; library-shimmer-skeletons (S6-owned, books line only) -> the
  ui-thumb skeleton fill binding (ui.css before style.css in every shell, nothing re-grounds
  `.ui-thumb`); art-decode-shimmer's books site; library-toolbar (S2-owned, books third only) -> Sort
  and Scan are tonal pill ui-btns and no `.books-toolbar .btn` rule; reader-immersive kept as is
  (class a). `lib/media-capabilities.js` markers follow download/finished/share into the More menu.
  New: `test/unit/books-reader-ui.test.js` (18 tests; both views' real init in jsdom).
- **Mutation (git archive sandbox of c70a9120, pristine copy diffed per mutant):** 13 of 13 red, each
  by the named test: error-state-as-empty, no sheet key guard, Like not reserved, Pin on the All view,
  destroy leaves a reader sheet open, a bare class, empty state hidden, red fill on Like, optimistic
  Like, skeleton re-grounded, inline width, no `--p`, destroy leaves the sort menu open. The first pass
  (on 6fc72af6) had 2 survivors that exposed weak tests, fixed in c70a9120: the destroy checks were
  vacuous (ui.sheet opens on the next frame; they now assert OPEN first) and the inline-style lock
  excused every read.js `.style.width` write (now only `canvas.width`, plus a behavioural `--p` check).
- **ui-lint (6b7408d6 -> this branch):** TOTAL 2703 -> 2660. no-raw-values 1297 -> 1287,
  no-bespoke-controls 1091 -> 1066, icons 163 -> 158, display-ownership 86 -> 84, colour-roles 44 ->
  43; hover-gated 3, pressed-state 1, native-interaction 3, no-layout-transition 2, z-ladder 11,
  no-shell-style 2 unchanged. 28 keys / 43 items shrunk out of `docs/ui-exceptions.json`.
- **Left on this surface (listed debt, not added):** `.books-grid` 140px column and `.reader-chassis`
  320px floor (layout geometry; a token swap moves them); the two invisible page-turn zones
  (`.reader-tap-nav`, no primitive fits); read.html's zoom-free viewport (the D10.4 carve-out). Not
  S10's: the narration bar's prev/next (`pc-btn`, the player mount, S3 / player carve-out), the
  shells' header / nav / player template (S1 / S3), Home's books row (`main.js`, S2).
- **Renders (seeded, :3971, 4 eras x phone/landscape/desktop x light/dark, scenes 50-54):** before 96
  shots, after 96 shots, 0 failed, 0 unexpected blocked requests, no page errors. Looked at: the
  toolbar is one row at 390 (before: two rows of bordered glyph buttons); Like reads as a filled
  heart in ink; Contents and Aa open as sheets with a scrim and a close (before: an unanimated
  drawer); the theme picker shows the active theme; 2005 keeps its square, bordered, underlined-link
  look through the era knobs.
- **Counts (Node 22.23.1):** `npm test` tests 10206, pass 10196, fail 0, cancelled 0, skipped 10
  (exit 0); the pre-commit `npm run test:unit` of c70a9120 tests 7880, pass 7879, fail 0, skipped 1;
  `npx eslint .` 0 errors, 6 warnings (the existing common.js unused globals); `npm run lint:ui` OK
  (2660, equals the file); `npm run lint:css` TOTAL 0; `npm run lint:overlay` clean (0 violations).

### Step 4 - geometry + the deterministic visual job, merged; step 4 closed (2026-09-27; 42f96ad7, 0050e028, fd5fece3)

- From branch feat/ui-pro-geometry (cut before S6/S10): `test/geometry/` (G1 row columns, G2 icon centring, G3
  equal heights per button group, G4 rotation stillness; `npm run test:geometry`, `test:geometry:fast`;
  `expected-failures.json`, shrink-only, XPASS fails), `test/visual/run.js` (seed -> fresh server -> the scene
  matrix -> compare at 0 changed pixels; `--update`, `--idle`), `test/visual/server.js`, `clock-shim.js`, and
  `.github/workflows/visual.yml` (job `visual` in `mcr.microsoft.com/playwright:v1.62.0-jammy`; job
  `rebaseline` on workflow_dispatch uploads baselines as an artifact).
- **Determinism, measured on this box** (760 shots per run, DPR 1): run 1 writes scratch baselines; run 2
  back-to-back 760/760 identical; run 3 after a 5-minute idle server 760/760 identical. Levers: SEED_NOW pinned
  and a clock shim in the seed; server + browser clocks start at the seed's view time; UTC/en-US; Math.random
  seeded per document (the Pocket menu picked a random album); `#file-path-text` masked; the raster flags;
  a fixed data dir (`/tmp/filetube-visual-data`); a fresh server per run waiting for the boot scans; every
  poller off (podcast feed poll - the step 3 drift -, library rescan, yt-dlp). CI pixels will differ from this
  box, so baselines come only from the container.
- Mutation: 7/7 geometry mutants killed; 13/13 unit mutants red.
- **Merge:** capture.js was restructured on that branch while S6 (selectors) and S10 (scenes 50-54) edited it;
  resolved by taking the restructure and replaying both sweeps' edits. The D6 check's inline `/* global */`
  collided with the new eslint globals block for test/geometry (removed).
- **G3 finding fixed:** the kit's channel-card row put sm (32px) pills beside md icon buttons (44 phone / 36
  desktop). The icon buttons are sm now (D4.9: the channel row is sm; the 44px hit area is the pseudo-element),
  and an icon-only sm button keeps the 22px row glyph (`.ui-btn--sm.ui-btn--icon`). Its expected-failure entry
  is deleted. `npm run test:geometry:fast`: 12 checks, 12 ok, 0 XFAIL, 11s.
- Pre-push runs the fast geometry set when public/ changed vs the upstream.
- **Open for Dean / the release:** (1) the visual job is red until someone runs the `rebaseline` workflow and
  commits its artifact (it exits 2 "no baselines" rather than passing vacuously); a workflow_dispatch job must
  exist on the default branch to be runnable, so the first baselines likely land with or right after the merge.
  (2) Baselines at DPR 1 are ~52 MB for 760 PNGs: fewer scenes/modes or Git LFS is a decision for Dean.
  (3) G4 pocket-rotation is XFAIL (F23) until S7 (worst box 457px on rotate).

### Sweep S2 - cards and feeds (2026-09-27, branch feat/ui-sweep-s2 from 6b7408d6)

Commits: d70c6883 (registry: six icons - a PRIMITIVE addition for the Architect: local_fire_department,
playlist_add, grid_view, view_list, sort, music_off), 0ca84f04 (the sweep), and this one (the meta separator
fix found by the render, the History confirm test, this log).

- **What changed.** Home grid, channel/folder pages, search results, History and the watch page's related
  rail moved onto the primitives:
  - **D8.5 clean cards.** `buildVideoCardEl` (main.js module scope, DOM, textContent only): a `ui-thumb`
    (duration badge + progress bar ONLY), the Modern byline `ui-avatar`, and ONE kebab (`ui-btn` plain icon
    `more_vert`) in the meta row. Queue / Like / Share / Save to device / Transcript / Reheat / Hide from feed /
    Move to Trash live in ONE `ui.menu`, reached by the kebab, a long-press and a desktop right-click
    (`FTInteraction.onActionMenu` on the grid, torn down with the view signal). Applicability is the old C4
    rules (`buildCardMenuItems`). A TV card (an empty menu in every capability) renders NO kebab. The eight
    `.card-*-btn` families, the four `.card-corner-*` classes, `.duration-badge--beside-corner`, the v1.17
    inline delete arm and the v1.67 per-user corner layout are deleted; Settings' "Card corners" editor is
    removed with them (it would have been an inert control - an S8 surface, touched only for that).
  - **Delete (destructive).** "Move to Trash" asks `ui.confirm` (`cardDeleteConfirmCopy`): "Move to Trash?" /
    body / "Move to Trash" danger. The copy says what the ONE path does: `DELETE /api/videos/:id` moves the file
    to Trash for every item (lib/media/routes.js, the v1.65 trash move; never a permanent unlink) - the SAME
    route as before, called by `deleteCardById` only after the confirm resolves exactly `true`. A local
    (non-yt-dlp) file's body adds "This local file cannot be re-downloaded." (the watch page's hard-delete
    wording). The yt-dlp-managed case, which deleted with no modal at all (the v1.86.2 two-tap), now confirms too.
  - **D8.1 era flourish (the ONE mechanism S3 reuses).** common.js `ERA_FLOURISH_ERAS` / `eraShowsFabricated` /
    `applyEraFlourish` set `<html data-era-flourish="on|off">` from the era - once at common.js load (before any
    view renders) and in `applyTheme`. ONE style.css rule hides every `.ft-fabricated` node unless "on"
    (2005/2009/2014). Fabricated vs real, read from the generators: `getStarRating` (always mock), `getMockViews`
    (the fallback when no `sourceViewCount` - `isFabricatedViewCount` shares resolveViewCountLabel's own test),
    `getMockSubCount` and the mock comments (watch page: S3 wraps them). Cards and the rail wrap only the mock;
    a captured count shows in every era. `ft-hide-stars` composes (stars show only if the era allows AND the pref
    does). Card stars are drawn registry icons now (no ★☆ glyphs).
  - **D8.6 / F03.** Card and rail titles are `--ink-link` (ink; the 2005 link blue by the era knob); the byline is
    `--ink-2` (2005: link blue).
  - **F19 one chip row.** common.js `buildFilterChipRow`: ONE horizontally scrolling row of `ui-chip` filters -
    a single leading All, then each dimension; a dimension is select-or-none (re-tap = back to all), All resets
    every dimension, ONE onChange (one reload) per tap. Library views: format + watch; a folder/root search adds
    Titles/Channels; a GLOBAL search shows the type dimension only (and hides sort/shuffle - they never applied
    to the ranked stream: a lying control before). **Choice by measurement:** at 390px the six library chips need
    ~464px - neither a merged row nor a segmented second row fits one line, so the merged row SCROLLS inside a
    `min-width:0` host while the tools stay fixed; measured one line on every phone/desktop page
    (geometry check below). The tools are `ui-btn` tonal icons: sort (opens a `ui.menu` with the current sort
    checked), shuffle, rescan (busy = `aria-busy` spinner, no label swap), view (grid_view/view_list), and the
    per-channel Re-pull (common.js, the `subscriptions` glyph; outcome by toast). The Modern chip row is the same
    `ui-chip` component; the Modern avatar bar is `ui.avatar` xl.
  - **F61.** The channel heading's rename / Music controls are `ui-btn` plain icons (`edit`; `music_note` /
    `music_off` via `ui.setPressed`), appended AFTER the count so a late reveal/removal moves nothing; rename uses
    `ui.prompt`, failures toast (no `window.prompt/alert`).
  - **F63.** The related rail is `buildRelatedCardEl` (ui-thumb + ink title), reveals together
    (`revealArtTogether`), `ui.state` empty / error (Retry) replace the italic and red inline text, and the
    skeleton is two title lines + byline + meta of the final geometry. The TV Up-next rail uses the same card.
  - **History** rows are `ui-row` + `ui-thumb` in a `ui-list` (one reserved action slot); Remove and Clear all
    go through `ui.confirm` (they clear resume positions and watched marks - D4.8 F33; the in-row "Remove?" arm is
    retired); the empty and error states are `ui.state`.
  - **Skeletons** (grid, rail, History, avatar bar) are built from the same primitives as the content; the
    unified search skeleton reserves the type line.
  - Also: the Modern card has no tile (F53) - it paints `--surface-0` (the page ground) rather than going
    transparent, so the critter ground contract holds; the welcome box swaps by `hidden` (no inline display).
- **Found by the conversion and fixed:** (1) the v1.94 hover preview keyed on `.thumbnail-container` - a
  rename would have silently killed it; it keys on `.card-media` and a full-chain test now drives it. (2)
  `fetchCardCaps` first awaited `/api/subscriptions/health` inside the grid's `Promise.all` (a hung probe blocked
  the grid - the v1.67 code only probed when a corner held Reheat); the probe now runs in the background and
  upgrades the latched caps object. (3) The render showed "views ·yesterday": a CSS escape ate its space.
- **Findings.** Closed: F03, F04 (one badge size, `--t-caption` <= every card title), F05, F19, F53 (no frame,
  Modern no tile, radii from `ui-thumb`), F63, F67. F15: closed on cards and the rail; the watch page's stats are
  S3's (the mechanism is in place). Partial: F18 (phone card titles 12 -> 13px, rail meta 10 -> 11px; the Home
  feed rows `.book-row-card` / `.music-row-card` / `.video-row-card` and the queue are not migrated), F61 (the
  icon controls; the ChannelHeader - avatar, count, Subscribe on folder views - is NOT built: it needs the
  subscribe flow S3/S5 own).
- **Locks converted (AC12; every removal has its replacement in the same commit):** card-corner-renderer ->
  card-action-menu (C4 applicability over `buildCardMenuItems`, `cardKindPresentation` arms kept, the clean-card
  DOM contract, the delete copy, the per-era flourish over the REAL style.css rules, the no-inert-kebab and
  retirement tests); card-corner-br-css -> card-thumb-badge (one badge size, badge over the preview by paint
  order, no frame); card-corner-mobile-size (risky) -> card-kebab-hit (the 44px `--hit`, no card hit-zone
  pseudo-elements, the kebab out of the thumbnail in grid and list) + the DOM test that no control sits on the
  media; card-corner-editor -> the retirement test; card-corners-fullchain -> card-action-menu-fullchain (menu,
  C4, RBAC, share/reheat/queue endpoints, the hover preview, and the delete-safety suite below); card-like
  (S2 half: the menu Like, driven behaviourally on the chapter/native lanes); folder-music-toggle-lock;
  home-mobile-scale (c) + test/geometry/library-toolbar.check.js; library-toolbar; library-toolbar-wiring;
  library-toolbar-early-render; modern-css-source-lock; shimmer-tranche2 (c) + geometry; star-ratings-pref (+ the
  D8.1 composition); v1264-skeleton-states (c) + geometry; sticky-filter-bar (#3); art-decode-shimmer;
  attribution-client. Kept (a), untouched and green: library-view-prefs, pull-to-refresh, reveal-art-together.
  Touched outside the S2 rows (the shape they read moved): watch-init-behavioral (harness gets `window.ui`),
  critter-mode (anchors `.ui-thumb`, `.video-card .ui-avatar`; the ground contract reads ui.css too and checks
  era overrides keep painting), app-look-l2 (home halves), audio-opens-in-music, channel-name-consistency,
  home-chip-memory, icon-attribute-mask, icon-queue-mask (S2 half), library-shimmer-skeletons (the History row
  only; S6/S10 own the rest), modern-home-layout, row-glyph-inline-svg, search-clear (the v1.150 strip half ->
  the chip row's kind belt), skin-status-bar (census exception), v1262-subs-and-rescan-polish (rescan half),
  v1362-minors-client, history-view, card-download-btn, shuffle-rescan-icon, the two ytdlp repull shims; and
  integration library-pagination, rescan-scan-poll, universal-search-client, home-card-transcript-corner.
- **Delete safety (the full gate; LESSONS 9).** card-action-menu-fullchain drives the real index.html: every
  path into the menu (kebab click, kebab by keyboard - a detail-0 click, long-press through the real
  FTInteraction timer, desktop right-click) and every way out of the confirm without a yes (Cancel, Esc, scrim,
  Close, Enter, a tap on Move to Trash after Cancel) sends NO `DELETE`; only the confirm's own button sends
  exactly one, of that item. history-remove-confirm drives the real history.js the same way for Remove / Clear all.
- **Mutation (a /tmp git-archive sandbox of 0ca84f04, pristine diff after: identical): 15 of 15 killed.**
  M1 the `ok !== true` guard deleted (7 red), M2 the menu Delete calling `deleteCardById` directly (7 red),
  M3 `ok !== true` -> `!ok` (killed only by the source guard - behaviourally equivalent: ui.confirm resolves only
  true/false), M4 the flourish gate inverted in style.css (7 red), M5 2021 in `ERA_FLOURISH_ERAS` (2), M6 a real
  count marked fabricated (1), M7 the kebab on an empty menu (1), M8 the preview host back to
  `.thumbnail-container` (1), M9 All leaving a dimension set (1), M10 a re-tap not toggling off (1), M11 History
  Remove without its confirm (1), M12 Delete offered without the capability (2), M13 the local-file warning
  dropped (1), M14 the transcript busy guard removed (1), M15 the skeleton's second title line dropped (2).
- **Debt paid (`ui-lint --shrink`; no new debt):** no-raw-values 1297 -> 1271, no-bespoke-controls 1091 -> 983,
  icons 163 -> 157, colour-roles 44 -> 41, display-ownership 86 -> 82; TOTAL 2703 -> 2556 (-147).
- **Renders** (seeded instance, `test/visual/capture.js`, scenes 01, 02, 03, 28 + new 31 search, 32 card menu,
  33 related rail; phone / landscape / desktop x light / dark x 4 eras): before 136 captured, 0 failed; after 136
  captured, 0 failed, no page errors (the retro eras recaptured after the separator fix). `compare.js` (threshold
  16): 136 of 136 changed, as designed - home 7.6-69.0%, scrolled 45.1-68.0%, channel 10.1-69.0%, search
  29.8-64.5%, card menu 24.3-77.8%, related rail 1.2-3.6%, History 0.3-1.9% (the seed has no history: that is the
  empty state; a populated History was rendered separately through a routed fixture, 9 shots incl. the Remove
  confirm). `test/geometry/library-toolbar.check.js` PASS: the toolbar one line on every page (top spread 0px),
  no horizontal overflow, 2 phone columns, kebab hit 44x44 off the thumbnail, skeleton thumb and info boxes
  equal to the real card (86.7px; 106.7px with the search type line), rail skeleton thumb 120x67.5 == real,
  menu rows 44px.
- **Interpretations for the gate to attack:** (1) the menu lists every applicable action - the stored
  cornerTL..BR settings are now ignored (the server lane still accepts them); (2) History Remove/Clear were
  given `ui.confirm` (danger) as destructive; (3) on a global search the sort and shuffle tools hide; (4) the
  Like action answers with a toast (no heart on the card any more); (5) a Modern card paints `--surface-0`
  instead of transparent (critter ground contract); (6) the critter pool anchors every `.ui-thumb` (cards, rail,
  History) - `.related-thumb` / `.history-thumb` / `.thumbnail-container` / `.card-channel-avatar` left it;
  (7) the channel heading's controls moved after the item count; (8) the long-press is delegated on the grid, so
  a hold on grid gap (no card) opens nothing but still swallows the release click (FTInteraction's own rule);
  (9) the Modern header sort (`.sort-menu` in the persistent header) is untouched - header chrome, S1's.
- **Counts (Node 22.23.1):** `npm test` before the sweep commit: tests 10161, pass 10151, fail 0, skipped 10.
  The sweep commit's hook: tests 7833, pass 7832, fail 0 (two earlier hook runs failed ONLY critter-mode
  "v1.176 gate W closure" at box load ~7 - the known load flake; it passed standalone, and the retry after the
  load drained passed). Final counts for this commit are in the report.

### Sweep S5 - Subscriptions (2026-09-27, branch feat/ui-sweep-s5 from 871b3920; 7c5f3da2, 41b781c8, + this commit)

- **Seed (7c5f3da2, its own commit):** Harbor Workshop reads "ok: downloaded 3 new video(s)" and is pinned
  (through the real `POST /api/subscriptions/pins`); a fourth subscription, Lantern Street Studio, failed its
  last check two hours before the seed clock (`error: HTTP Error 403: Forbidden`).
- **Surface (41b781c8):**
  - F62: the view's page-local `<style>` is gone (rules moved into style.css or died with their markup);
    no-shell-style debt for the view 1 -> 0. D8.10: the Subscriptions-only moon and the dead `.theme-toggle`
    CSS are gone; the header matches the other shells.
  - Toolbar ("the activities buttons", F26 subs half): tonal Check all / Activity / One-off and ONE primary,
    Add (the Podcasts shape). Only Add carries a glyph; one line at 390px.
  - Rows (D8.9, F24, F40, F32, AC5): per A-Z section a ui-list (avatar column, three action columns) of
    ui-rows: ui.avatar, the name, ONE meta line ("3 new · checked 2h ago"; "Check failed · 2h ago" in
    `--danger`; "Paused" leads; a live download shows its progress), and three fixed trailing slots: pin
    (keep / keep.fill), bell (notifications_active / _off, never gold or red), menu (more_vert). No
    channelDir -> an empty reserved pin slot. The row opens the settings sheet; the menu holds Settings,
    Check now / Retry (Retry exactly while the row reads failed or partial), Pause/Resume, View as playlist,
    Open channel page and Unsubscribe (danger).
  - Row sheet (ui.sheet, auto: bottom on a phone, dialog on desktop): the full last-check line + next
    check, per-video failures with Skip, the cookie warning, the subscribed date and the channel URL (all
    moved off the row), ui-select / ui-field / ui-switch fields, Check now / Pause secondary, ONE primary
    Save, Unsubscribe danger on its own line.
  - Panels: Add / One-off / Activity and the relocation preview are ui.sheets taking the view's signal. Their
    content stays static in the view (a hidden `.subs-panels` holder) and moves into the sheet body on open,
    back on close, so every id and poll binding is wired once. The preview stacks over Activity (Esc closes
    the top one). Activity is one ui.segmented (History / Failures / Maintenance); the failure filter is
    ui-chip filters + a danger Clear all; maintenance is five labelled tool entries (title, what it does, the
    live status line, a tonal Run with its Cancel swapping in place).
  - D9: the loading skeleton is the ui-row grid (same slots, same list modifiers); empty and error states are
    ui.state (Retry on the error).
  - Deleted CSS: the `.sub-row*`, `.sub-sheet*`, `.sub-pill`, `.sub-toolbar`, `.sub-collapsible`,
    `.btn-chip`, `.skeleton-row*` and reloc-preview modal families (style.css: 209 lines added, 878 deleted). Also gone:
    `scripts/sub-row-chip-probe.js` (the dead v1.316 chip instrument), the view's eslint globals block, and
    `.sub-row` in the critter anchor pool (a ui-row paints no ground, like the other rejected rows).
- **Destructive paths (F33, full gate):** Unsubscribe (`DELETE /api/subscriptions/:id`), a failure record
  (`DELETE /api/subscriptions/failures/:id`) and Clear all (`DELETE /api/subscriptions/failures/all`) go
  through ui.confirm with the danger fill; the SAME requests run only after it resolves true, one confirm
  and one request per target at a time. **Interpretation for the gate:** the per-record failure delete used
  to be one tap BY DESIGN (a code comment argued a confirm per row trains the reflex); the brief says "any
  delete/remove", and Dean keeps those records "for posterity", so it confirms now. Skip-this-video stays one
  tap (it is not a delete; it lives in the sheet). `test/unit/subs-destructive-confirm.test.js` (8 tests,
  the real view + real ui.js in jsdom): Cancel, Esc, the scrim and Close send nothing; OK sends exactly one
  DELETE to the same route; a double tap on OK, on the sheet's Unsubscribe, on a record's delete and on
  Clear all still opens one dialog and sends one request; Enter never answers; a late OK on a closing dialog
  stays a cancel; a view teardown with the dialog up closes it (nothing stranded) and a stale OK after it
  sends nothing; a census taps every other control on the page (toolbar, every row control, every menu item
  but Unsubscribe, every sheet button) and sees no DELETE.
- **Locks converted (AC12, replacements in 41b781c8):** the four S5 locks - subscriptions-panels (the toolbar's
  one language, the holder, ui-field/ui-select/ui-switch markup, no inline style), sub-row-chip-btn-family
  (row controls are plain icon ui-btns; no stylesheet rule names a role class; the retired family is gone; the
  era treatment rides the primitive; one bell writer = ui.setPressed), v1262-subs-and-rescan-polish (the type
  roles; no status span in a button row; the reserved status line) and reloc-preview-mount (the panel inside
  #view-root; no `<style>` in the view). The S5 halves of pinned-avatar-css (-> `.ui-avatar__img` + the
  clipping box), v1262-sheet-modal-transitions (-> the ui.sheet slide/scale + reduced-motion contract),
  v1264-skeleton-states (-> the skeleton's slot sequence equals a loaded row's), mobile-input-zoom-fontsize
  (-> ui fields are 16px at every width; all 13 view fields are ui fields), settings-mobile-polish,
  collapsible-sections, critter-mode, reloc-preview-client, ytdlp-failure-section, ytdlp-t6-repull-and-subs-ui,
  sub-bell-in-place and subscriptions-panels-behavior (both on a shared jsdom harness,
  `test/helpers/subs-view-harness.js`), ytdlp-ui-routes (integration). The 100 fake-DOM builder tests in
  ytdlp-subscriptions-client move to jsdom + the real ui.js in `test/unit/subs-sweep-s5.test.js` (24 tests).
  `test/geometry/subscriptions.check.js` (new, the native-interaction.check.js pattern) measures G1 / G2 / G3
  and the SPA round trip in a real engine. capture.js scenes 04-07 follow the new DOM; 06b (the row menu) added.
- **Debt (ui-lint --shrink, whole file, 871b3920 -> 41b781c8):** no-raw-values 1271 -> 1208, no-bespoke-controls
  1053 -> 990, icons 160 -> 150, display-ownership 84 -> 82, colour-roles 44 -> 34, no-shell-style 2 -> 1; the
  rest unchanged; TOTAL 2634 -> 2485 (149 paid). `lib/ytdlp/client/subscriptions.js` now carries 0 entries.
  Left on the view: the shell's header / bottom bar (S1) and player template (S3) keys only.
- **Measured (seeded instance, Node 22.23.1):** `test/geometry/subscriptions.check.js` holds in 2021 dark,
  2005 dark, 2014 light and 2009 light (phone 390 + desktop 1440, hard load and after Home -> Subscriptions ->
  Home -> Subscriptions through the router, which measures identically). 2021 dark: row slots phone media 16 /
  body 64 / actions 242, 286, 330 on all four rows (pinned + unpinned, errored + ok); desktop 254 / 302 /
  1308, 1344, 1380; every row glyph centred dx 0 / dy 0, the Add glyph dy 0 to its label; toolbar one line at
  390 (tops all 211.8, heights all 32, right edge 354 of 390); no horizontal overflow; 0 page errors; 0
  `<style>` in #view-root after the SPA swap.
- **Renders:** before (7c5f3da2) vs after (41b781c8), scenes 04-07 x phone / land / desktop x dark / light x 4
  eras: 96 / 96 captured each side, 0 failed, 0 unexpected blocked; 96 of 96 changed (4.1% - 99.7% of a shot;
  compare.js threshold 16). 06b (the row menu) shot separately in 2021, 6 / 6.
- **Mutation (a git-archive sandbox of 41b781c8 + the tightened tests, each restored and byte-checked):** 20 of
  20 killed - unsubscribe / record delete / Clear all ignoring the answer, no one-at-a-time guard, the confirm
  not the danger fill or not bound to the view signal, the pin slot collapsing, a failed check not in the error
  tone, the bold count, the panel not moving back, the preview closing Activity, the bell writer accepting
  truthy, Unsubscribe not danger in the menu, a 2-slot skeleton, the toolbar / status rules leaving style.css,
  a view field losing ui-field, a role-class paint-over, setFieldError never hiding, the members-only switch
  never reverting. Two first-pass survivors (the signal binding; the members-only revert raced by the initial
  settings load) exposed weak tests, tightened in this commit and then red. Masked by design: dropping the
  post-answer `signal.aborted` re-check alone (the signal-bound confirm already resolves false on teardown).
- **Counts (Node 22.23.1):** `npm run test:unit` (the 41b781c8 pre-commit run): tests 7807, pass 7806, fail 0,
  skipped 1. Targeted integration (ytdlp-ui-routes, shell-smoke, ytdlp-patch-pause, route-census, rbac-census,
  rbac-subscriptions-flag, ytdlp-failure-log-api, ytdlp-crud, ytdlp-pins, ytdlp-disabled-noop,
  ytdlp-delete-stays-gone, route-read-classification, capture-determinism): 101 tests, 100 pass, 1 fail
  (ytdlp-ui-routes AC32, the old checkbox/select markup) before its conversion; that file 13 / 13 after.
  `npx eslint .` 0 errors, 6 warnings; `lint:ui` OK TOTAL 2485; `lint:css` TOTAL 0; `lint:overlay` 0 violations.
- **For the primitives (not changed here):** ui.menu's item icons sit on the sheet's left edge (its compact
  list has no inset); the sheet body has no inline padding, so every sheet content supplies its own (S5's
  `.subs-panel` pads to the title's `--space-8`).
- **Deferred / not mine:** the shell's header, bottom bar and player-template debt on the view (S1, S3);
  `.md-hero` / `.md-tile` (S8's master-detail family, kept as the Dean-requested v1.160.1 hero);
  `.action-status` (shared with Settings); the header's global Download (the S8 one-off dialog) duplicates the
  One-off panel's form - kept, since the panel also lists the running one-off jobs.
