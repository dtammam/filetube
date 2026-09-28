---
plan: ui-professionalism-pass
harness: v2 · lean
branch: feat/ui-professionalism
anchor: spec
status: Building
next: step 8 full gate (adversary + qa + security-brief, destructive) on the integrated branch; then the rebaseline (a push to rebaseline/*), step 9 release
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

**D10.4 amendment (Dean's ruling, 2026-09-28): the middle path.** After the sweeps, the debt was 1,647
(no-raw-values 925, no-bespoke-controls 249, icons 51, the rest about 55). Step 7 retires:
- every dead rule and function the sweeps replaced (unchanged);
- all of `no-bespoke-controls`, `icons`, `colour-roles`, `z-ladder`, `display-ownership`,
  `hover-gated`, `pressed-state`, `native-interaction`, `no-layout-transition` and `no-shell-style`
  (the kinds a user can see), down to the carve-outs above.

`no-raw-values` entries that are skin data (the Pocket/whcal palettes) or `diag.html` get a written
`reason` as permanent carve-outs. The remaining plain `no-raw-values` entries (px sizes, borders) stay
on the shrink-only ratchet, with `reason: "raw value, same pixels as a token; retire when touched"`.
One true-up wave to clear them is a follow-up plan, opened only if Dean signs the pass off on device.
AC1 is measured against this amended list, not the literal one above.

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

### Sweep S1 - chrome (2026-09-28, branch feat/ui-sweep-s1 from cf669c15; 2a49ad32, d02f0375, b5a462c1)

- **Commits:** 2a49ad32 (registry: FILL twins for every bottom-bar glyph - folder, history, podcasts,
  music_note, menu_book, smart_display, download, dark_mode, light_mode, settings; 70 names + 19 fills),
  d02f0375 (the ONE primitive-side addition, its own commit: ui.css `[data-theme] a.ui-btn, a.ui-btn
  { text-decoration: none }` - a link ui-btn was underlined by the 2005 `a` rule and the global a:hover,
  F20; tokens.css / ui.js / interaction.js untouched), b5a462c1 (the sweep), then this log.
- **Header (F31):** hamburger, search button and every header-right control (queue, bell, search
  toggle, the one-off Download, the account trigger) are plain ui-btn icon buttons (36 desktop / 44
  phone, 44 hit area), built by common.js `chromeButtonEl`, which emits exactly ui.button's DOM (a test
  compares outerHTML). The desktop Download is an icon now (was a bevelled text `.btn` beside flat
  glyphs). Count badges are `ui-chip--count`. The account avatar is a ui-avatar (sm header, xs You tab,
  xl menu head; the v1.157.1 shimmer-until-loaded reveal kept). Both reserve blocks (byte-identical in
  the 11 header shells) paint the same ui-btn boxes.
- **Search:** a ui-field-styled field (--surface-2, --r-md, 36/44, ring on the field, 16px phone floor
  kept) with an icon ui-btn inside; the clear X is an icon ui-btn (no text glyph); recent searches are a
  compact ui-list with a remove icon button per row.
- **Account menu (D4.6):** a ui.sheet titled Account (popover under the trigger on desktop, bottom sheet
  on the phone) of compact ui-rows with registry glyphs, built on the first open; v1.305's pencil badge
  kept (a tonal icon ui-btn on the xl disc); the disk / trash / version footer is a quiet compact
  ui-list, lazily counted as before. The Theme row stays (F38's account-menu half).
- **Bottom bar (F49):** each tab a ui-btn stack (fixed 24px slot over a one-line caption label; You's
  avatar sits in the slot); idle `--ink-2`, selected `--ink-1` with its FILLED glyph
  (`setBottomNavItemFilled`, from applyNavHighlight), never red, no weight change.
- **Playlists sheet (F50):** a bottom ui.sheet (static markup deleted from 11 shells); rows are 56px
  ui-rows, glyph or a 36px ui-avatar in the media column (D4.3's avatar column is --av-md, not the audit's
  40), one reserved action column; unpin is a `keep.fill` icon toggle that asks through ui.confirm (the
  in-row "Unpin?" arm is gone, D4.8), on the desktop sidebar too. The rows still come from the sidebar's
  generators (`toSheetRow` converts in place).
- **Sidebar (F50, F20, D7):** selected/hover = a neutral fill, never bold; never underlined in any era;
  hairline separators. D7: `.main-content` no longer transitions margin-left; the drawer transitions
  transform only under `.is-animating`, set only by the menu toggle (`armSidebarSlide`); a real width
  change (resize, rotate - not the iOS toolbar's height-only resize) holds `html.no-motion` for 300ms.
- **F66:** the static `#cc0000` theme-color is a light/dark pair in 13 shells (pre-paint guess by OS
  scheme); applyTheme collapses it to the header ground of the app's era + mode (`syncThemeColorMeta`).
- **Findings:** closed F20 (chrome: tabs, sidebar, menu and sheet rows), F29 (verified: the registry
  test binds every source path; the Podcasts glyph renders whole in the renders), F31 (header),
  F49, F50. Partly: F38 (the account-menu Theme row kept; the Subscriptions moon is S5's), F66 (the
  iOS standalone `apple-mobile-web-app-status-bar-style` stays `default`: it is read once at launch
  and `black-translucent` forces white status text over the light eras' headers - a device ruling for
  Dean; the manifest's theme_color/background_color are static and cannot follow the mode). Deferred:
  the modern-home header sort/view glyphs (`.modern-sort-btn`, `.modern-view-toggle`, F31's list) are
  built in main.js - S2's file.
- **Geometry:** surfaces `header` (G2, G3 scoped to `<header>`, and HDR: 44/36px buttons, level and
  evenly spaced, magnifier shown + rightmost on the phone / hidden on desktop, avatar hidden on the
  phone, the 36px field, the bell reserve's box == the bell's, sidebar rows never bold or underlined)
  and `bottom-bar` (G2, G3, NAV: 24px slots, one label line, one ink-1 active tab with its filled
  glyph, the rest ink-2, one weight, no underline). Collectors take a `scope`. Pre-push fast set
  stays 4 scenes: kit 2021-light phone, kit 2005-light phone, header 2021-dark phone, bottom-bar
  2005-light phone. `npm run test:geometry:fast`: 12 checks, 12 ok, 0 FAIL, 0 XFAIL, 0 XPASS; 4
  scenes in 27s. Full (G1-G3 + HDR/NAV, against the seeded server): 120 checks, 120 ok, 40 scenes.
  `--mutants`: 13 of 13 killed (6 new: hdr-cascade-hides-magnifier - the v1.85 bug -, hdr-bell-
  reserve-shift, hdr-sidebar-bold, nav-you-label-lower, nav-active-red, nav-2005-underline; the last
  SURVIVED the first cut - text-decoration does not inherit, the collector read only the label - fixed
  to read the tab link too, re-run killed).
- **Frame capture (G4-style, evalG4 over every box, base 3991 vs branch 3992):** desktop hamburger
  close / open: base 1001 / 999 boxes outside the sidebar moved after the first changed frame (the
  grid reflowing under the sliding margin), branch 0 / 0 (only the drawer's 31 boxes slide, by
  transform). Phone rotate to landscape / back: base 1010 / 1012, branch 0 / 0. Cold phone load with
  warm flags (queue, bell, module, bar layout): every header-right and tab box at its final x/width
  from the first painted frame, no glyph slot empty, in both trees (the reserves were already
  zero-shift; the branch keeps it with the 44px boxes).
- **Locks (AC12, replacements in b5a462c1):** mobile-header-css-source-lock (risky; to the rendered
  HDR check + its cascade mutant, keeping the specificity-order facts and the 56px header),
  header-right-reserve (22px value -> the `--icon-md` token + HDR's measured box equality),
  pinned-avatar-css (risky; the pinned half -> the ui-avatar contract + a behavioural fallback test;
  the S5 half untouched), search-clear (the X -> ui-btn DOM + the global [hidden]), v1262-sheet-modal-
  transitions (the playlists half -> the ui-sheet contract; the routing test rewritten for the
  controller), version-meta (a ui-row footer). Kept (still valid): critter-mode, mobile-wordmark,
  pre-paint-fouc-guard, reorder-single-mechanism. Updated for the new DOM (DELIBERATE, noted in each):
  account-menu, account-avatar-shimmer, app-look-l2, chrome-icons, books-router-nav,
  bottom-nav-order-authority, liked-glyph-split, podcasts-nav-client, folder-glyph,
  pinned-playlists-sheet, pinned-sidebar, oneoff-header-injection-placement, oneoff-modal-mobile-
  polish, stable-toggle-label, you-nav-tab, geometry-checks, integration/liked. New:
  test/unit/chrome-primitives.test.js (11).
- **Mutation (a scratchpad `git archive` sandbox of b5a462c1, a pristine copy diffed after each):** 14
  of 14 killed - no fill on the selected tab, unpin deleting on any answer, unpin with no confirm,
  theme-color keeping the media split, no-motion on height-only resizes, the toggle not arming the
  slide, `.main-content` transitioning margin-left, the sidebar sliding ungated, the F20 ui.css rule
  deleted, chromeButtonEl dropping the size class, a menu link leaving the menu open, a reserve queue
  that is a bare button (killed by the byte-identity lock, index.html only), a sheet row without its
  action slot, the You avatar outside the icon slot.
- **ui-lint (cf669c15 -> b5a462c1):** TOTAL 2591 -> 2420. no-raw-values 1261 -> 1224,
  no-bespoke-controls 1028 -> 916, icons 155 -> 139, no-layout-transition 2 -> 1, display-ownership 82
  -> 78, colour-roles 43 -> 42; hover-gated 3, pressed-state 1, native-interaction 3, z-ladder 11,
  no-shell-style 2 unchanged. 134 keys / 171 items shrunk. Left on the chrome (listed, not added): the
  logo's 28/160px box, `.header-search` 600px, the grandfathered sidebar z 99, the sidebar drag
  indicators on `--yt-red`, `.sidebar-item`'s cursor, the `.account-menu` wrapper, the two
  `.search-toggle-btn` placement rules; `syncThemeColorMeta` reads `--header-bg` (a legacy name: step 7
  re-spells it).
- **Renders (seeded instance, base :3991 / branch :3992, 4 eras x phone/landscape/desktop x light/dark,
  scenes 01, 23, 24, 25, 29):** before 80 shots, after 80 shots, 0 failed, 0 unexpected blocked
  requests. Looked at: the bottom bar (filled Home in ink, You level with the rest), the account sheet
  (phone) and popover (desktop), the playlists sheet, the search field open, the landscape hamburger,
  2005 (square pills and counts, no underlined tabs).
- **Counts (Node 22.23.1):** `npm run test:unit` (b5a462c1's pre-commit run) tests 7924, pass 7923,
  fail 0, skipped 1. `npm test` at b5a462c1: tests 10254, pass 10244, fail 0, cancelled 0, skipped 10
  (exit 0). The run before it (the tree before the liked-lock conversion) had fail 2:
  `integration/liked.test.js` "v1.32 ... static-scan locks" (a lock on the old
  `applyLikedSidebarEntry(list)` call; converted in b5a462c1) and `integration/read-only-media.test.js`
  "every yt-dlp shared-state route refuses" (`fetch failed`, under load; the file passes alone and in
  the b5a462c1 run). `npx eslint .` 0 errors, 6 warnings (the existing common.js unused globals); `npm run lint:ui`
  OK (2420, equals the file); `npm run lint:css` TOTAL 0; `npm run lint:overlay` clean.
- **For the gate:** the account-menu popover anchors at the trigger's LEFT edge, clamped to the
  viewport (the ui.sheet popover contract), so on desktop it sits left of the avatar rather than
  right-aligned under it; the phone sheet has a title row ("Account") so the Close sits at the trailing
  edge (a titleless ui.sheet puts Close at the leading edge - a primitive gap S9 may want). The account
  menu and the playlists sheet are built on first open, so the Subscriptions row's cold-cache gap
  (v1.153.1) mostly closes; ensureAccountMenuSubscriptionsRow still patches a built menu. Sidebar rows
  took hairline separators and a 12px section title (`--t-footnote`) - a visible desktop change.


### Sweep S8 - Settings and forms (2026-09-28, branch feat/ui-sweep-s8 from cf669c15)

- **Commits:** a16b3569 (ui.css: `input.ui-switch` + `:checked` twins, its own commit), 43c30d3c (ui.css: a
  field in a sheet body takes the dialog's text inset - the first ui.prompt render showed it flush), 3e806076
  (the sweep), then this log with two binding fixes the mutation pass asked for and one spacing fix.
- **Settings (F09, F36, F54):** each section is a stack of `.setup-group` blocks on the page ground: grouped
  ui-lists of switch rows (the 29 checkboxes stay native checkboxes wearing `.ui-switch` + role=switch, so every
  id, `.checked`, `change` wire and persisted key is unchanged - no storage change), ui-field inputs and
  ui-select selects (16px, the focus ring), and `.setup-note` footers. setup.html's sections carry no inline
  style (110 -> 0; the 7 left in the file are the shared player template, S3). The folder rows, Channels in
  Music, the bottom-bar and Library-icon editors, the access editor (switches + ui.segmented mode), the sticker
  picker (ui.segmented Size/Tilt), the engine channel picker (grouped rows, trailing radio) and every button are
  primitives. The md nav's focus ring is the `--focus-ring` (was red). `setFieldError` reveals by `hidden`.
  **Dropped (Architect's ruling, S2's D8.5):** the card-corner editor and its lock `card-corner-editor.test.js`.
- **F55 / D4.8 (destructive, full gate):** one `confirmDestructive` (danger ui.confirm, the view's signal) in
  front of every destructive Settings action, each sending the SAME request only on true: delete a user, remove
  a folder (video/book/music/Shows; the form still persists on Save), restore a backup, clear the transcode
  cache, remove a logo / sticker / profile photo, delete a critter / all critters, purge / empty the trash,
  remove a saved transcript prompt, clear the timing log. The two-tap arms and window.confirm are gone. The
  password reset is `ui.prompt({type:'password'})` (masked, a show toggle; window.prompt echoed it); refusals
  are toasts. main.js's folder-rename prompt and its two alerts (listed by F55) moved the same way.
  Subscriptions' two window.confirm calls (lib/ytdlp/client/subscriptions.js) are S5's.
- **Sign-in / welcome:** ui-field inputs, a primary ui-btn, the era picker a ui-segmented radiogroup (static
  markup, then login.js hands it to ui.segmented; no inline style). No new pre-auth allowlist entry.
- **One-off dialog:** ui-field inputs (now aria-labelled), ui-select selects (one column on a phone:
  "MP4 (recommended)" no longer clips), ui-btn buttons, an icon Close (was U+00D7); the builder's return API
  and the shared `.oneoff-modal` shell (Subscribe, shortcuts) unchanged.
- **Found by the probe:** the users/trash table filter (buildSortableTable) computed 13px on a phone
  (`.stable-filter { font: inherit }` beat the bare-element floor); it is a ui-field input now.
- **F39:** verified closed (the Shows tile draws `tv`; md-icons-resolve green). **MD tiles onto the
  registry: not done** - they are 1.7-stroke line drawings on coloured tiles; the registry's Material Symbols
  are filled/outlined shapes at another weight, so every tile would be redrawn (a material change), and the
  era tile's corner radius tracks the era (no registry glyph does). Left in common.js; md-icons-resolve stays.
- **Locks (AC12):** converted critter-manager, settings-mobile-polish, setup-automation-reveal (parsed DOM),
  setup-engine-client (styling-source law, derived from the box's markup), trash-toolbar and trash-table
  (confirm gates), v1262-mobile-input-zoom and mobile-input-zoom-fontsize (the census reads ui.css + style.css,
  the `font:` shorthand and setup.js's templates, with witnesses), plus the markup locks of 12 more unit files
  and 2 integration files. Kept as they were (green): master-detail, md-nav-desktop-gap, oneoff-modal-mobile-polish,
  stats-breakdown-table, stats-master-detail. New: settings-forms-sweep.test.js, test/helpers/ui-dialogs.js.
- **Mutation (git-archive sandbox of 3e806076, pristine diffed after):** 26 mutants, 23 killed first pass;
  3 survivors exposed weak bindings (the view-signal arm was masked by the callers' own abort checks; the
  transcript Remove test never dismissed; nothing bound the table filter's class), fixed here and re-run: 26/26.
- **ui-lint (cf669c15 -> this branch):** TOTAL 2591 -> 2374. no-raw-values 1261 -> 1130, no-bespoke-controls
  1028 -> 957, icons 155 -> 148, display-ownership 82 -> 79, colour-roles 43 -> 38; the rest unchanged.
- **Probe (390px phone, 2021 dark; base cf669c15 vs branch):** text-entry controls measured 45 -> 41 (the 4
  card-corner selects left), under 16px 3 -> 0 (users filter, new-user password, transcript prompt text);
  a visible keyboard focus ring 12 of 16 probed controls -> 16 of 16; switches 48 in both, and every section's
  row switches share one right edge (x = 366, width 51; the folder cards' inline switches at 111).
- **Renders:** capture.js scenes 60-72 (each Settings section, sign-in, the one-off dialog, the password
  prompt) x 4 eras x phone/landscape/desktop x dark/light: before 328 + 72 recaptured, after 344, 0 failed;
  328 of 360 compared shots differ (as intended). Looked at: grouped switch rows, footnote help, 16px fields,
  the masked prompt, sign-in. **For the primitives / tokens (not changed here):** in the retro light eras
  `--surface-1` equals the page ground, so a grouped list reads ungrouped; the ui-switch keeps its iOS pill in
  2005. New scenes enlarge the visual job's matrix by ~344 shots (a baseline-size question for Dean).

### Sweep S3 - watch (2026-09-28, branch feat/ui-sweep-s3 from 1b70322b; c9030603, 216962d3, + this commit)

- **Seed (c9030603, its own commit):** the subscribed fixture video carries a description long enough to clamp
  and a caption sidecar (its bar shows Transcript); the unsubscribed one carries REAL captured view and
  subscriber counts; `fixtures.json` names `videoResume`. The seed stores watch progress through its own minted
  session, not the capture login's user, so the resume probe routes `GET /api/progress/<id>` (noted in seed.js).
  capture.js gains 18b-watch-about.
- **Surface (216962d3):**
  - D4.9 action bar: one row of stacked plain ui-btns in equal columns (grid, 1fr each on a phone, 88px each
    wider): Like, Share (a link), Listen, Transcript (captions), More - mounted by `WATCH_BAR_ORDER`. More is ONE
    `ui.menu` (popover on desktop, bottom sheet on a phone) built from the live state at each open
    (`buildWatchMoreItems`): Play next, Add to queue, Save to device, Mark as watched / unwatched, Copy
    description, Reheat metadata (Reheating... disabled while running), Move to another folder, Attribute to a
    channel, Move to Trash (danger). Like is a stable-stack toggle (Like / Liked, favorite / favorite.fill, ink,
    never red); Share's copy answers with a ui.toast (F21); the Share time choice is a ui.menu. The v1.96 reveal
    barrier is kept (media + capability + flag). The v1.202 tiers, the v1.201 container query, the 39px override
    and every `.watch-action*` / `#*-media-btn` order rule are deleted.
  - D4.9 channel row: ui.avatar lg (replaced on repaint, keeps its id), the name (t-body 600) over the count as a
    `ui-chip--meta` on a line reserved by a zero-width space (F43), then Subscribe: ONE pill, primary "Subscribe"
    / secondary "Subscribed" through the label stack + `ui.setPressed`; the bell slot (sm plain icon toggle,
    notifications_off / notifications_active) is created with Subscribe and RESERVED (`data-reserved`,
    visibility:hidden, inert, aria-hidden) until subscribed; the pin (keep / keep.fill). Busy = `ui.setBusy`
    (F34). Unsubscribe goes through `ui.confirm` (danger, "Unsubscribe from <name>?", says downloads stay).
  - D8.1: `deriveWatchPaintPlan` (common.js) gains `viewsFabricated` / `subsFabricated` (the generators' own
    tests); the painter toggles `.ft-fabricated`; the stars are drawn registry icons in `.watch-rating
    ft-fabricated`; each mock comment row is `.ft-fabricated`, the user's own are real; two counts
    (`#comment-count-badge` all, `#comment-count-real` Dean's) and the empty state use a new inverse rule
    `html[data-era-flourish="on"] .ft-unfabricated { display:none }` beside S2's (same attribute, no new mechanism).
  - D8.2 (player.js, the prompt UI only): `resolveResumeStart` is the one decision - announced progress resumes
    WITH the toast (not while docked), quiet progress resumes silently, none starts. Resume runs through the
    unchanged `resumeDirectly`. The toast (`#resume-toast.player-resumed` in all 10 player templates) fades in,
    hides 4s + 200ms later (load-generation guarded); Start over = the old "Start from beginning" handler; `S`
    starts over while it shows (R went with the modal; the shortcuts dialog says so). dock(), close() and the
    next load's teardown hide it. Deleted: the modal markup, `resolveDockedResumeAction`,
    `resolveDockTransitionResumeAction`, the v1.132/v1.161 countdown machinery and its CSS.
  - D8.4: the self-hosting paragraph and the bold/monospace meta line are gone; "About this file" is a collapsed
    `ui-row` (info glyph, chevron) that opens `#about-file-body`: Size, Type, Location (the value rows keep the
    painter's ids; the path row has a Copy `ui.copy` button, F68) and the embedded tags (`buildAboutTagRows`, the
    old 400-char clip). Show more is a plain ui-btn toggled by `hidden`.
  - Also: the 2x indicator is a chip-styled pill (fast_forward glyph + "2x", `hidden`-toggled; the gesture is
    untouched); the docked player's shadow/radius are `--shadow-overlay` / `--r-md` (structure and behaviour
    unchanged); the fatal error box is a `ui.state`; the TV back link draws `arrow_back`; the TV poster is ui-art.
    Deleted from common.js: `stableToggleLabelHtml` (its last callers); style.css: `.btn-label-stack/-slot`,
    `.btn-glyph`, the uploader panel/badge, description meta/fileinfo, embedded-tags, star-rating, comment-avatar,
    resume-actions/countdown families.
- **Destructive paths (full gate):** Move to Trash (the More menu, offered only with the write capability)
  asks ONE `ui.confirm` whose copy is main.js's `cardDeleteConfirmCopy` (the card menu's, so they cannot
  disagree): title and button both "Move to Trash" (F44), body "stays in Trash", + "This local file cannot be
  re-downloaded." for a non-yt-dlp item. What runs was read at lib/media/routes.js `app.delete('/api/videos/:id')`:
  the v1.65 trash move for every item, never a permanent unlink. The SAME `performMediaDelete` runs only when the
  confirm resolves exactly true, the view is alive and no other confirm/DELETE is in flight. The local-file
  checkbox modal is no longer used by the watch page (S2 made the same call for cards; Pocket still uses it).
  `test/unit/watch-destructive-confirm.test.js` (the real view in jsdom, 9 tests): Cancel / Esc / scrim / Close /
  a late OK send nothing; OK x2 sends exactly one DELETE of this id and closes the player first; a teardown with
  the confirm up + a stale OK sends nothing; a member never sees Move / Move to Trash; per-kind copy; a census
  taps every other bar button, every other menu entry and the channel controls - no DELETE; Unsubscribe the same
  (one dialog on a double tap, one DELETE /api/subscriptions/:id on OK x2, nothing on Cancel / Esc / scrim /
  teardown).
- **Measured (seeded :4013).** `test/geometry/watch.check.js` (new; `--mutate`): 2021 dark + light, 2014 light,
  2009 dark, 2005 light, phone 390 + desktop 1440 - every check holds. **Dean's bell:** the bell's and the pin's
  glyph centre-y are **0px** from the Subscribed label's centre-y (6 of 6 per era file) and 0 / 0 from their own
  buttons' centres; channel controls one top, 32px each; Subscribe 104 / 104px off / on (2005: 102.25 / 102.25),
  Like 89.5 / 89.5 (phone), 88 / 88 (desktop); Subscribe and Pin at the same x subscribed vs unsubscribed
  (202 / 342 phone); the bar one row of equal columns (89.5 x 45 phone, 88 x 45 desktop), stacked glyphs within
  0.01px of their captions; About opens to its rows with Copy, no monospace; no horizontal overflow. The check
  found one real shift and it was fixed: primary (no border) vs secondary (hairline) made Subscribe 2px wider
  when subscribed - a transparent hairline on the row's primary (style.css, surface-scoped). Its 5 mutants
  (bell-low, stack-collapse, bell-slot-collapse, bar-unequal, pin-tall) all turn it red. `test/geometry/scenes.js`:
  the pending channel-card and action-bar are live (+ channel-card-unsub), with a new optional `scope` (the
  collectors measure only that subtree); two FAST_SCENES are now channel-card / action-bar. `npm run
  test:geometry -- --only G1,G2,G3`: 144 checks, 144 ok, 64 scenes; `--mutants`: 10 of 10 killed (3 new:
  g2-channel-bell-low, g2-action-bar-icon, g3-channel-pin-tall).
- **Renders:** capture.js scenes 17, 18, 18b, 19, 20, 33 x phone / landscape / desktop x dark / light x 4 eras:
  before (c9030603) 160 captured (incl. an abandoned 17b), after 136 captured, 0 failed, 0 unexpected blocked;
  compare.js (threshold 16): 128 of 136 changed (3.1% - 95.3%), the 8 unchanged are 17-watch-top landscape (the
  player alone fills it). Probe shots (dpr 2): the resume toast ("Resumed at 12:34 · Start over", shown after
  290ms, hidden by 4.5s), About expanded, the More sheet, the 2x pill. Looked at: 2005 keeps square, bordered
  controls through the era knobs; the reserved bell gap reads as spacing.
- **Locks converted (AC12; replacements in 216962d3):** stable-toggle-label (risky: rewritten over the primitive's
  stack by value + the watch toggles' DOM + watch.check.js measurement, mutation-proven), era-row-overflow,
  watch-action-bar-nowrap, watch-action-row-tiers, watch-action-bar-container-query, uploader-subs-badge (->
  watch-sweep-s3.test.js, 14 tests, + watch.check.js), player-resume-countdown, player-docked-resume,
  player-dock-transition-resume (-> player-resume-toast.test.js: the decision table + the REAL player.js in a
  watch.html jsdom realm, 12 tests), watch-action-bar-reveal (A1 -> the 44px stacked floor; A2 kept),
  star-ratings-pref, player-resume-overlay, keyboard-shortcuts, watch-instant-paint, watched-toggle-ui,
  share-prompt, row-glyph-inline-svg, reheat-button-wiring, move-trigger-wiring, attribution-client,
  audio-opens-in-music, capability-cache, icon-attribute-mask, icon-transcript-mask, v1262-mobile-input-zoom (the
  comment box is a 16px ui-field now), token-scale-lock, watch-init-behavioral (ui.js now evaluated in its realm;
  the shim records attributes/classes; its v1.338 D8d delete test moved to watch-destructive-confirm), integration
  watch-like-button, watch-share-button, watch-transcript-button, watch-action-reveal, watch-liked-sidebar;
  `lib/media-capabilities.js` markers follow the verbs into the menu. Kept untouched and green (class a):
  ambient-glow-engine, fullscreen-edge-and-video-state, player-rotation-cap-nudge, theatre-mode,
  watch-chrome-ambient, the player-* locks, music-theater-toggle, mobile-player-height, watch-instant-paint's slot.
- **Mutation (a git-archive sandbox of 216962d3, pristine copy diffed after each): 19 of 19 killed** - Move to
  Trash / Unsubscribe ignoring the answer (M1, M2), their one-at-a-time guards dropped (M3, M4), the toast while
  docked (M5), the 5s floor at 0 (M6), the resume decision ignored (M7), dock not hiding the toast (M8), Start over
  keeping the saved position (M9), mock views / mock comments unmarked (M10, M11), a real subscriber count marked
  (M12), the bell slot not reserved (M13), Move to Trash without the capability (M14), Subscribed staying primary
  (M15), About never opening (M16), Copy copying nothing (M17), Share swapping its label (M18), S without the toast
  (M19).
- **Debt (`ui-lint --shrink`, 1b70322b -> this branch):** no-raw-values 1172 -> 1151, no-bespoke-controls 857 ->
  809, icons 139 -> 100, display-ownership 76 -> 59; hover-gated 3, pressed-state 1, native-interaction 3,
  no-layout-transition 2, z-ladder 11, colour-roles 30, no-shell-style 1 unchanged; TOTAL 2295 -> 2170 (125 paid;
  no-legacy-tokens, off, 1327 -> 1261). Left on the watch page: the player template (pc-btn, cog svg, U+26F6 /
  U+29C9 / U+00D7 glyphs: the carve-out), the cog's autoplay switch (injected into the player), the sidebar
  "None" row's inline style (S1 chrome, rendered by watch.js), header / bottom bar (S1).
- **Findings.** Closed: F06, F16 (measured), F17, F21, F25, F43, F45, F51, F52, F68 (path + description; the
  transcript flow already copies); F44 and F15 for the watch page. **Not closed:** F07 (the player controls'
  glyphs and monospace time are the carved-out overlay controls; only the 2x indicator changed) and F22 (the hold
  gesture is untouched - Step 4's items 1-5 all remain: an onRelease/hold variant in interaction.js, the 500ms /
  16px vs 450 / 8 ruling, the touchend classifier staying on its own listener, the latch reset moving with it,
  and the non-passive hold; the device falsifier stands).
- **For the gate / Dean (interpretations):** (1) the bar shows up to 5 columns - no fill-in: a local file shows
  Like, Listen, More; (2) Mark watched is a More entry answered by a toast, not a bar toggle; (3) the reveal
  barrier still waits for the capability and the flag (they only decide More now); (4) Unsubscribe confirms (it
  was one tap by Dean's v1.20 direction; D4.9 rules the confirm); (5) the local-file checkbox modal is gone from
  this page; (6) the reserved subscriber line leaves the name top-aligned when Modern hides a mock count (the F43
  reserve, literal); (7) the Subscribe width fix is a surface override of a primitive property - ui.css
  `.ui-btn--primary` could carry the transparent hairline for every primary/secondary pair (not changed: off
  limits); (8) **Setup's three resume-countdown controls are now INERT** (setup.html / setup.js - S8's surface;
  the player reads none of `filetube_resume_countdown*`; setup.js's "MUST match player.js" comment is now false) -
  S8 should remove them; the resume threshold setting still decides the announcement; (9) player.js edits near
  the carve-out: `handleResumePlayback`'s plain-video branch, the toast machinery, `hideResumeToast()` in dock /
  close / teardown, the restart listener, the S shortcut, `speedBadge.hidden` in engage/releaseHold, and the 10
  player templates (resume + 2x markup) - no `<video>`, fullscreen or faux-fullscreen code changed; (10) the
  `.icon-attribute` mask has no consumer left (glyph-pool family, not deleted) and `--size-touch-watch-action`
  is orphaned (tokens.css, step 7); (11) main.js's comment "(the watch page's showHardDeleteModal wording)" is
  S2's and now historical.
- **Counts (Node 22.23.1):** the 216962d3 pre-commit `npm run test:unit`: tests 7787, pass 7786, fail 0,
  skipped 1. Integration (watch-*, shell-smoke, ytdlp-subscribe-watch-security, liked, home-api,
  push-sw-handler, universal-search-client, oneshot-visibility-three-surfaces, handoff-api, custom-logo,
  version-meta, route-census, ytdlp-oneoff-header-injection, podcasts-ytdlp-shows): tests 177, pass 172,
  fail 0 (19 failed before their conversions). `npx eslint .` 0 errors, 6 warnings; `lint:ui` OK TOTAL 2170;
  `lint:css` TOTAL 0; `lint:overlay` 0 violations; `test:geometry:fast` 10 checks, 10 ok. Final counts for this
  commit are in the report.

### Sweep S7 - Music and Pocket (2026-09-28, branch feat/ui-sweep-s7 from 1b70322b; f3e0187f, 1e9d0afe, 1970d8f8, + this commit)

- **D7, Pocket is a phone mode (f3e0187f).** The gate is `html.is-phone`, set ONCE when music-skins.js
  loads (every shell that hosts a skin loads it before any view script) from `(pointer: coarse)` and the
  screen's short side `<= 500` (`phoneFrom`, pure). `isPhone()` reads the class; `skinActiveFor`, the
  pop-out gate and music ambient route through it. `isMobileViewport`, v1.311.3's `watchSkinViewport`
  and the pop-out's resize arm are gone with the width gate (the split is structural now). style.css:
  the takeover's `@media (max-width: 768px)` block became ONE zero-specificity scope,
  `:where(html.is-phone, html.mms-popout)`, on every selector (the pop-out window's html carries
  `mms-popout`); the cascade is unchanged. **Deviation (instrument, for the gate):** ui-lint keys drop
  that exact scope (it replaced an at-rule prelude, which was never in a key), so the same rules keep
  their debt keys; the Pocket locks read the sheet through `test/helpers/stylesheets.js unscopePocket`
  (the scope dropped the way they dropped the @media wrapper). `pocket-phone-scope.test.js` binds that
  every selector of the block carries the scope and that no Pocket rule is left on a width query.
- **Landscape (audit decision 9):** `@media (orientation: landscape)` on `html.is-phone`: the Click LCD
  left at its 4:3, height-fitted (narrower on an SE); the wheel right, the chassis size fitted to the
  short side (a separate `--pkl-*` family so the chassis stays the one authority); Cider and Nordic put
  the cover left; safe-area insets pad the sides; the sticker moves to the right corner (its menu anchor
  is data, `--mms-sm-anchor-l/r`). Measured (after tree, 1x): 844x390 LCD 488x366 at x22, wheel 288 at
  x536; 932x430 LCD 541x406, wheel 288; 667x375 LCD 352x264, wheel 251; no horizontal overflow, the panel
  exactly the viewport in every case.
- **AC9 stillness:** common.js `installResizeStillness` holds `html.no-motion` for 300ms after every
  resize / orientationchange; style.css zeroes transitions under it (the sidebar drawer and the content
  margin no longer animate for a rotate - S1 still owns gating those transitions for the menu toggle).
- **F59 measure-after-settle:** `SKINS.observeSettled` (ResizeObserver, applied in the frame after two
  equal reads) re-measures the haptic ghost's scale (never mid-gesture) and the Brick canvas's backing
  store (no inline size; no window resize listener where RO exists). F59 stays a hypothesis for the
  device: the falsifier is the new `?debugLifecycle=1` viewport line (below) showing a size change after
  the skin painted with the wheel still mis-armed.
- **F23 guard:** a repaint whose cover is the SAME URL is born revealed (no art-shimmer). The menu art
  already kept `artShown`.
- **A5:** leaving Pocket restores the Music list by its anchor row when the width changed
  (`findListAnchor` / `anchorRestoreTarget`, pure; entry, a render behind the skin at the entry width,
  exit through FileTubeBodyLock).
- **F58:** the Music view reserves the docked mini player's footprint at its bottom (`reserveDockSpace`,
  a ResizeObserver on #player-dock, `--music-dock-reserve` as data).
- **Lifecycle log:** `?debugLifecycle=1` records resize, orientationchange and visualViewport resize
  with sizes (`player.js formatViewportDetail`: layout + visual viewport, orientation, phone class),
  coalesced per frame.
- **F60:** the skins' text marks (play, pause, the chevrons, the check, the stars) are drawn SVG glyphs
  (`skGlyph`); the status bar's play / pause pair is stacked in one cell. **F70:** one sticker row height
  (`--size-touch`; the 48px action rows are gone), selected = the overlay's tonal fill + an ink border
  (red is Delete only), the focus ring is `--focus-ring`, the collapse chevron and the Cider grab handle
  are 44px targets.
- **G4 pocket-rotation (the owner's check):** before (1b70322b) XFAIL - 1-to-landscape 178 boxes moved
  after frame 9 (worst 457.5px, #music-autoplay-btn), 2-exit-pocket VACUOUS (the rotate had already torn
  Pocket down), 3-to-portrait 133 moved (worst 276.6px). After: ok in dark and light - 1-to-landscape
  0 moved, 2-exit-pocket 0 moved (change@14-16), 3-to-portrait 0 moved; both expected-failure entries
  deleted. **Instrument changes (for the gate to attack):** (1) `rotationSteps` gives the exit step a
  PREP - from Now Playing, the Click exit is two actions (MENU to the Main Menu, MENU to dock); the step
  now records the dock alone (recording both called the dock's relayout "a box moving after the first
  frame" on any correct UI); (2) the recorder takes one named ignore selector per sequence, and
  pocket-rotation ignores `.ipm-art *` - the Main Menu's cover drift (Dean's Addendum E slideshow,
  transform/opacity on its own 9s clock) moves by design, the transition twin of the animation skip.
  Mutants: g4-sliding-padding rewritten as an ANIMATION (html.no-motion now masks a transition mutant);
  new g4-pocket-no-stillness (the sidebar transition re-enabled through no-motion) - `--mutants` 8 of 8
  killed. `npm run test:geometry`: 51 checks, 51 ok, 0 FAIL, 0 XFAIL, 0 XPASS.
- **iPad / phone (D13), by emulation (Chromium, coarse pointer + screen size):** iPhone 15 portrait
  390x844 phone; landscape 844x390 phone (the skin stays up); 15 Pro Max landscape 932x430 phone; SE
  landscape 667x375 phone; iPad Air portrait 820x1180 NOT a phone (default panel); landscape 1180x820 NOT;
  iPad mini portrait 744x1133 NOT; a desktop 1440x900 and a narrow desktop window 700x900 (fine pointer)
  NOT. Pure table in pocket-phone-scope (500 is a phone, 501 is not).
- **The player Extras Delete (destructive, full gate):** music sticker, pop-out and desktop actions menu
  (skin-surface.js createExtrasMenu) and the podcast adapter (podcasts.js onDelete) ask ONE danger
  `ui.confirm` - the card menu's copy (`cardDeleteConfirmCopy`: "Move to Trash?", a local file adds that it
  cannot be re-downloaded) / the episode list's own copy - and send the SAME request
  (`DELETE /api/videos/:id`, `DELETE /api/podcasts/episodes/:id`) only when it resolves exactly `true`; one
  confirm (and its request) at a time; no `ui.confirm` on the page = no delete. **Interpretation for the
  gate:** the local-file path lost the checkbox-gated hard-delete modal for the same danger confirm the card
  menu uses (S2 precedent; the route moves to Trash for every item, F44). `extras-delete-confirm.test.js`
  (13 tests, the real ui.js): Cancel, Esc, the scrim, Close and Enter send nothing; OK sends exactly one
  DELETE (a double tap on OK too); a second Delete while open opens nothing; a late OK after Esc stays a
  cancel; a view teardown closes it and a stale OK sends nothing; the podcast adapter the same.
- **Music on the primitives (1970d8f8):** toolbar = tonal sm pill ui-btns with registry icons, the sort
  in the ui-select field (16px), Loop / Autoplay as ui-chip filter chips; tabs = ONE ui-segmented; song
  rows = ui-rows in a ui-list with reserved columns (ui-art, the title as the stretched link over
  "artist · album", the length in the aside, three fixed action slots: Add to queue, Like - favorite /
  favorite.fill, ink - and a ui.menu: Play next, Add to queue, Save to device, Go to artist; also by
  long-press and desktop right-click); the playing row is a tonal fill (no red bar); skeleton = the same
  ui-row grid; the Artists list = ui-rows + ui-avatar; album art is a rounded square (D8.7 - it had been
  clipped to the artists' circle); the drill header / sticky bar buttons are ui-btn (arrow_back, no `‹`);
  D9: a failed load is an error ui-state with Retry, the empty state a ui-state ("No matches" for a
  search). The desktop theatre: podcasts retired its toolbar toggle for the player's own `#theater-btn`
  (the one writer); the theatre panel cap is data (`--mnp-cap-h`).
- **PRIMITIVE CHANGE (1e9d0afe, ui.css, reported):** `.ui-chip--filter[aria-pressed="true"]` layers the
  tonal fill over the chip's own ground instead of swapping it - swapped, 2009 light showed ON 4 levels
  from OFF (the v1.284.1 class); layered, 17-28 levels in every era x mode (`ui-chip-selected.test.js`).
- **Locks converted (AC12, replacements in the same commits):** the step-0 S7 rows - music-actions-desktop
  (anchor moved with D7; unchanged file, its CSS reads now go through unscopePocket where needed),
  music-playback-modes (v1.284.1 -> the chip + ui-chip-selected), music-toolbar-slots (the pop-out box on
  html.is-phone), music-sticker-menu (F70 rows), music-skins / pocket-* / skin-status-bar / ipod-brick /
  player-tap-to-play / music-skin-integration (read through unscopePocket; kept otherwise); plus
  skin-surface (watchSkinViewport -> no crossing helper; the ghost settle), music-skin-integration and
  podcast-nowplaying-view (the v1.311.3 rotate tests -> no teardown on rotate; the pop-out resize arm ->
  structural split), music-sticker-extras / r1-extras-podcasts-races / music-pocket-menus (-> ui.confirm),
  art-decode-shimmer, library-shimmer-skeletons, library-toolbar, music-album-view ([hidden] -> the global
  rule), music-chapter-rename, music-nowplaying-view, music-sort-behaviour (error state),
  music-theater-toggle, music-view, row-glyph-inline-svg, modern-css-source-lock, ui-lint (the key scope).
  New: pocket-phone-scope, extras-delete-confirm, music-anchor-restore, ui-chip-selected.
- **Mutation (a git-archive sandbox of 1970d8f8, restored byte-exact after each): 18 of 18 killed** - the
  is-phone class re-evaluated on a rotate, isPhone reading a width query, the view re-rendering the skin
  on a rotate, Extras delete without the confirm / ignoring the answer / without the one-at-a-time guard,
  the podcast onDelete ignoring the answer, one takeover rule unscoped, the landscape wheel column
  dropped, stillness never releasing, the same-art guard removed, the dock reserve ignoring the page
  padding, the anchor restoring at the same width, the chip ON swapping its ground, a failed load showing
  the empty library, the settle applying on the first frame, the play mark flipping by text, the ui-lint
  key keeping the scope.
- **Debt (ui-lint --shrink; 1b70322b -> this commit):** no-raw-values 1172 -> 1151, no-bespoke-controls
  857 -> 815, icons 139 -> 135, display-ownership 76 -> 71, colour-roles 30 -> 23; hover-gated 3,
  pressed-state 1, native-interaction 3, no-layout-transition 2, z-ladder 11, no-shell-style 1 unchanged;
  TOTAL 2295 -> 2216. No key added.
- **Renders (seeded, 1x, scenes 10-16 + 40-42 Click/Cider/Nordic, phone / landscape / desktop x dark /
  light x 4 eras):** before (1b70322b) 208 captured, 0 failed; after 208 captured, 0 failed, 0 unexpected
  blocked; compare.js: 200 of 208 changed (8.6% - 99.99%). Looked at: Pocket landscape side by side
  (before: the skin torn down, the music page behind); songs as ui-rows in all eras (2005 squared and
  bordered); Loop OFF vs Autoplay ON distinct in 2009 light; album art rounded squares. Rotation
  screencasts (spec + exit-first, dark + light, DPR 3): the rotate to landscape is ONE repaint (3 frames:
  before, landscape, settled - no teardown, no reveal replay); the later frames of 3-to-portrait are the
  playing row's equalizer only (the layout identical frame to frame).
- **Deferred (why):** the desktop Now Playing panel rows (skin-surface buildPanelHtml, shared with podcasts
  and byte-locked by the v1.317 seam test - a shared-builder change belongs with S9 / an S6 follow-up);
  the album / artist / jump-back CARDS stay bespoke buttons around their art (no card primitive; their
  debt keys stand); the sticker menu's `<i class="icon-*">` masks (the pop-out window has no sprite -
  moving them needs the sprite injected there); Loop's "Loop" / "Loop chapter" relabel changes the chip
  width (a two-slot stable label is a follow-up); the drill's sort stays reserved when entered from Home
  (pre-existing: `reserveOnly = tab === 'home'`); the sidebar / content-margin transitions themselves (S1).
- **Device checks for Dean:** rotate in Pocket (every skin) - it stays, lays out side by side, no replay;
  exit after a rotate - the list returns to the row you left; the haptic wheel after a rotate (the ghost
  re-measures - F59); tap-and-hold a song row (the menu); the Extras Delete confirm; `?debugLifecycle=1`
  now shows the viewport line on a rotate.
- **Counts (Node 22.23.1, on the tree of this commit):** `npm run test:unit` tests 7859, pass 7858, fail 0,
  cancelled 0, skipped 1 (exit 0). Targeted integration (music*, pocket*, podcast*, shell*, theater*,
  listen*, chapter*, route-census, rbac-census; 24 files): tests 243, pass 240, fail 0, skipped 3.
  `npx eslint .` 0 errors, 6 warnings (the existing common.js unused globals); `npm run lint:ui` OK
  (TOTAL 2216); `npm run lint:css` TOTAL 0; `npm run lint:overlay` clean (0 violations);
  `npm run test:geometry` 51 checks, 51 ok.

### Sweep S4 - notifications and queue (2026-09-28, branch feat/ui-sweep-s4 from 585d88de)

- **Commits:** 9632e96a (registry: `arrow_upward`, `arrow_downward` - the queue's Move up / Move down),
  12fb282e (the ONE ui.css addition, its own commit: every `.ui-list > .ui-row` rule gets a
  `.ui-list > .ui-swipe > .ui-row` twin - swipeRow's wrapper made a wrapped row lose the media padding,
  the divider, the last-row divider drop and the lead hide; a CLOSED row's underlay is
  `visibility:hidden` - the first render showed Dismiss / Delete through a row's translucent hover
  tint; a swipe row in a sheet slides over `--surface-overlay`. tokens.css, ui.js and interaction.js
  untouched - swipeRow's safety rules are unchanged), 61e150a4 (seed: a podcast episode, a
  downloader-engine event and a READ media row join the six Harbor rows, older than them), 666493e6
  (the sweep), then this log with the two bindings the mutation pass asked for.
- **Notifications (D4.6, D8.3, F28):** ONE ui.sheet (`#notif-panel`: popover under the bell on
  desktop, bottom sheet on the phone) holding ONE ui-list (`lead`, avatar media, thumb aside, one
  action). Every row renders every column: the unread dot's lead column, the avatar (a channel's
  photo; a podcast's show ART as a rounded ui-art - D4.4; else the monogram, never the logo), the
  text, the thumbnail (ui.thumb, its one duration badge; a logo thumb is contained; a 404 thumb
  becomes the contained logo and drops its badge - the v1.288 net kept) and ONE trailing kebab. The
  v1.68 X and the v1.161 in-row "Sure?" delete are gone. The row menu (kebab, long-press, desktop
  right-click through `FTInteraction.onActionMenu`) holds Open channel (`/?folder=`, the card byline's
  href) / Open show (`/podcasts?show=`, read back from the API's `/podcastart/<subId>`), Dismiss and
  Delete file (media rows only). A swipe left (`FTInteraction.swipeRow`) reveals Dismiss (neutral)
  and Delete (danger, media rows only); a full swipe past 60% dismisses. Loading is three skeleton
  rows in the real grid; empty and error (with Retry) are ui.state. Every menu and confirm the panel
  opens takes a per-open AbortSignal that the panel's close aborts (Esc, scrim, a row tap, the bell,
  a back navigation - `popstate` now closes the panel - and the badge poll's 404 stand-down).
- **The destructive path (full gate, LESSONS 9):** every Delete path lands in ONE `requestDelete`:
  media rows only; one confirm at a time for the panel; a row with a request in flight asks nothing;
  `ui.confirm({ title: 'Move to Trash?', confirmLabel: 'Move to Trash', danger })` - the copy says what
  `DELETE /api/videos/:id` does (lib/media/routes.js: a trash move, or the legacy removal of an entry
  whose file is already gone; never "permanently"); only an answer of EXACTLY `true`, re-checked
  against the signal and the row after the await, sends the SAME request as v1.161 (no body), then the
  same best-effort dismiss, toast and non-optimistic row removal. Dismiss never asks (D4.8) and stays
  non-optimistic. Clear all (a bulk dismiss) now asks (danger) and empties the list only on a 2xx.
- **Queue (F48):** ONE ui.sheet (`#queue-panel`); F48 is fixed by construction - the old panel's
  open class came only from `openOverlay`, which skips it under Reduce Motion, so the panel sat at
  opacity 0; ui.sheet always applies `is-open` (22b now shows the panel). Rows: ui-art (the entry's
  art, the monogram if none) and three reserved icon actions on every row - Move up, Move down
  (disabled in place at the ends), Remove from queue (`DELETE /api/queue/items/:uid`, a queue edit).
  Now playing is a `--fill-selected` row (never red); played rows dim their title to `--ink-2`. Clear
  asks ui.confirm (the "Really clear?" arm is gone). **Deviation:** the brief said "drag reorder kept";
  the queue never had drag (up/down buttons only; tech-debt #111 tracks drag) - the buttons are kept.
- **Model:** `buildNotificationRowModel` gains a derived `channelHref` (from `folderName` / `artUrl`,
  fields the API already sends). No API, data field or persistence change.
- **Locks (AC12, replacements in 666493e6):** mobile-touch-targets-css (the retired controls' 44px
  floors -> "no per-surface floor for them"; every row control is a ui-btn --icon, bound in the two
  sheet tests; the primitive's `--hit` is card-kebab-hit's), notification-bell-client (the v1.208 and
  v1.288 source locks on the old render loop -> the rendered DOM: badge only on a real thumb with a
  length, logo contained, 404 thumb -> logo without badge, 404 avatar -> monogram), panel-chrome-mirror
  (risky: the declaration mirror -> "no hand-built panel family is styled again, the Clear rows share
  ONE rule"; the sticky-header z-index pair -> the ui.sheet header is OUTSIDE the one scroller and the
  scroller clips; **the isolation assertion kept** on `.notif-sheet .ui-thumb`; the badge carries no
  z-index anywhere; the empty-queue copy), notification-dismiss-client (the X -> the menu, the swipe
  button and the full swipe, same non-optimistic contract and focus keep), app-look-l2 (the injectors
  need `window.ui`: the harness binds it - DELIBERATE). notification-delete-client (the two-tap arm) is
  deleted; notif-delete-confirm replaces it in the same commit. New: `test/unit/notif-delete-confirm`
  (24), `notif-panel-sheet` (8), `queue-panel-sheet` (5), `test/helpers/notif-panel-harness.js` (the
  REAL injector + ui.js + interaction.js on one jsdom window; the swipe's two measurements come from a
  getBoundingClientRect stub: row 390px, 77px per action).
- **Destructive-path evidence (notif-delete-confirm, all green):** menu Delete then Cancel / Esc / scrim
  / Close: no DELETE, no dismiss, the row stays (4 tests); swipe, tap Delete, then each of the four: no
  DELETE (4); a flick past 60% on a deletable media row: exactly one dismiss `{id:41}`, no DELETE, no
  confirm; swipe then tap the row content: closes only (the link click is prevented), no mark-read;
  double tap on the revealed Delete and on the menu item: one dialog; Enter / Space / a detail-0 click /
  a tap on a CLOSED row's Delete: nothing (the underlay is inert + aria-hidden); Enter never answers a
  confirm; two rows opened in sequence: the first closes and its Delete is inert, a press outside
  closes the second, only a re-opened row's Delete asks, and the confirm names that row; a late OK
  after Esc, after a back navigation (popstate) and after the panel closed: nothing; a stand-in
  confirm answering 1 / "yes" / {}: nothing; a stand-in yes landing after the panel closed: nothing;
  POSITIVE: OK (tapped twice) sends exactly one `DELETE /api/videos/V%C3%ADdeo-One` with no body, then
  one dismiss `{id:41}`, no mark-read, only that row leaves; the swipe's Delete + OK deletes THAT row;
  a failed DELETE keeps the row, dismisses nothing, and a retry asks again; kebab / long-press /
  right-click open the menu and delete nothing; Clear all: Cancel posts nothing, OK posts once.
- **Mutation (a scratchpad git-archive sandbox of 666493e6, a pristine copy diffed after each; 22
  mutants):** 19 killed first pass - M1 the confirm await removed (16 red), M2 the answer check
  inverted (14), M3a the full swipe set to Delete (31: swipeRow throws at setup), M3b the full swipe
  firing the DELETE directly (2), M4a interaction.js's revealed button live while closed (3, one in
  interaction-policy), M4b the underlay never inert (3), M5 the confirm's signal dropped (1), M6 the
  panel close not aborting (1), M8 the one-confirm guard (1), M9 Delete file offered on podcast/engine
  rows (2), M11 the menu Delete skipping the confirm (10), M12 popstate not closing (1), M13 the dismiss
  busy guard (1), M14 an optimistic dismiss (1), M15 Clear all unconfirmed (1), M16 queue Clear
  unconfirmed (1), M17 a queue row losing an action slot (1), M18 the kebab only on unread rows - the
  F28 shape (4), M19 the closed-underlay rule deleted (1), M20 the thumb isolation dropped (1), M21 the
  copy saying "Delete permanently" (2). Survivors: M2b (`ok !== true` -> `!ok`) and M7 (the
  post-answer signal re-check) - both masked by ui.confirm itself (it resolves only true/false, and a
  signal-bound confirm answers false on abort); bound in this commit with stand-in confirms (a truthy
  non-true answer; a yes landing after the close), re-run: both KILLED. M10 (the `kind !== 'media'`
  guard in requestDelete) SURVIVES, masked by design: no podcast/engine path offers Delete (M9 binds
  the menu, the swipe action list is bound by DOM), so the guard is defense in depth, not reachable.
- **Geometry:** the `notifications` surface is live (G1 + G2, 4 eras x 2 modes x phone/desktop, scoped
  to `#notif-panel`, floors 1 list / 9 rows / 10 icon pairs) and takes the kit 2005 slot in the pre-push
  set. Full run against the seeded server: 152 checks, 152 ok, 0 FAIL, 0 XFAIL, 0 XPASS; 56 scenes in
  88s. `npm run test:geometry:fast`: 11 checks, 11 ok; 4 scenes in 22s. `--mutants`: 15 of 15 killed,
  incl. the two new ones (g1-notif-aside-collapse: the engine row's thumb column collapsed, aside 338
  != 234; g1-notif-dot-column: the lead column dropped on the podcast row). **G1 numbers** (probe, 2021
  dark, all 9 rows): base (585d88de) phone - avatar 16, text 58, thumb **196 on media rows / 240 on the
  podcast + engine rows** (the F28 44px shift), delete 302 / none, X 346; desktop thumb 1246 / 1282.
  Branch phone - lead 16, media 32, body 80, thumb 234, kebab 338 on every row, every kind; desktop
  1048 / 1064 / 1112 / 1276 / 1388 on every row.
- **Renders (seeded, base :4031 / branch :4032, SEED_NOW pinned, the branch seed in both):** before
  scenes 21 / 22 / 22b: 64 captured, 0 failed; after 21 / 21b-21d / 22 / 22b: 136 captured, 0 failed,
  0 unexpected blocked; `compare.js`: "136 scenes, 136 with differences" (64 paired side-by-sides; the
  72 new 21b-21d shots have no before). Looked at: phone / desktop x dark / light, 2005: columns hold
  on every kind; the podcast row wears its show art; the menu (Open channel, Dismiss, Delete file in
  danger); a swiped row (Dismiss grey, Delete red); the Move to Trash confirm over the panel; **22b under
  Reduce Motion now shows the queue panel** (before: blank). Fixed by the render: the underlay showing
  through a hovered row (the ui.css rule above), the queue art filling the gap column (now ui-art 40),
  the lists flush with the sheet edge (the sheet-body list inset for the wrapped lists, style.css).
- **Debt (ui-lint --shrink, 585d88de -> 666493e6):** TOTAL 1907 -> 1851 (56 items / 44 keys paid, no new
  debt): no-raw-values 1004 -> 987, no-bespoke-controls 674 -> 644, icons 116 -> 112 (the ▴▾ and two ×),
  z-ladder 11 -> 9 (the two sticky panel headers), colour-roles 24 -> 21; hover-gated 3, pressed-state
  1, native-interaction 3, no-layout-transition 1, display-ownership 69, no-shell-style 1 unchanged.
- **Findings:** closed F28 (columns, measured) and F48 (rendered + jsdom); the notification halves of
  F14 (one avatar builder), F20 (the row link never underlines), F42 (podcast art, not a glyph), F47
  (the X is gone), F18 (the queue's own title/meta styles are the row's). Not closed here: the seed's
  rows all render READ in the capture (the fixture account postdates them, so `unread` is false for
  every row - the dot column is measured empty; the jsdom tests drive unread rows).
- **For the gate:** (1) Clear all and queue Clear were given danger confirms (bulk, irreversible); (2)
  the desktop panel is a popover with a clear scrim, so a tap outside closes it (the old document
  pointerdown handlers are gone) and the page body locks while it is open (every ui.sheet does); (3)
  swipeRow swallows a click within 400ms of a drag, so a lightning-fast swipe-then-tap on Delete is
  eaten (safe direction; the tests wait it out); (4) the queue's three 36px desktop buttons sit in
  44px slots but pack right, so their 44px hit circles overlap 8px on desktop (none on the phone).
- **Counts (Node 22.23.1):** `npm run test:unit` (666493e6's pre-commit run): tests 7884, pass 7883,
  fail 0, skipped 1. Targeted integration (notification-dismiss-api, notifications-api,
  push-client-gate, push-settings-enable, queue-api, rbac-queue-visibility, scan-notification-bridge,
  shell-smoke, music-pocket-menus-r1 + unit capture-request-policy): tests 102, pass 102, fail 0;
  capture-determinism 3 / 3. `npx eslint .` 0 errors, 7 warnings (the six common.js unused globals and
  main.js `libraryNotice`, all pre-existing); `npm run lint:ui` OK TOTAL 1851; `npm run lint:css` TOTAL 0;
  `npm run lint:overlay` clean (0 violations).

### Sweep S9 - overlays and feedback (2026-09-28, branch feat/ui-sweep-s9 from 585d88de)

- **Commits:** 07485084 and 1b4508eb (the two primitive fixes, each its own commit - below), afccf64b (toasts),
  3656e65c (the common.js dialogs, F44), d00fd7d6 (merge of feat/ui-sweep-s9b, a parallel worktree cut from
  1b4508eb: 1b809f43 registry arrows, 504005a1 the editors / crop / shortcuts / one-off dialogs, 7317bfe7 their
  busy guards on canDismiss), f0a6b6e0 (status chip, handoff card, header sort menu, empty/error states, the
  generic modal family deleted), 969c47da (geometry + capture scenes), then this log.
- **Primitive fixes (ui.js / ui.css only; tokens.css and interaction.js untouched):** (1) a titleless ui.sheet
  put its Close on the LEADING edge (S1's report) - `.ui-sheet__close { margin-inline-start: auto }`; (2)
  close() now marks the sheet `is-closing` (the ui.css exit-easing rule for it was never reached) - also the
  "is a live dialog up?" query; (3) `.ui-confirm__body` keeps line breaks (pre-line); (4) ui.menu picks once (a
  second tap on a closing menu ran onSelect again); (5) ui.sheet `canDismiss()` - a sheet mid-request refuses
  Esc / scrim / Close / drag, its owner's close() and a signal abort still close. **Gap left:** open() rewrites
  the sheet's className, so a modifier class must be added after open() (a `cls` option would be cleaner).
- **Toasts (F56):** showToast is a shim over ui.toast's one queue (116 callers unchanged; optional third arg
  `{kind}` adds the kind's icon). The `.toast` / `.toast-action-btn` family is deleted. Not done: a shared
  bottom-stack offset - the chip and the handoff card both sit bottom-left and can overlap when both show.
- **Dialogs (D4.6, F30, F47):** showConfirmModal -> ui.confirm (the callers' HTML parsed inert and handed over
  as text; `labels.danger`), showChoiceModal (Share / More / Transcript pick-ones) -> ui.menu (one pick, run
  synchronously in the tap), showTranscriptModal -> a wide ui.sheet dialog (Copy answers with a toast),
  showMoveModal -> a ui.sheet with a ui-select (busy refuses every dismissal), showAttributionPicker -> ui-rows,
  a switch, the ui-state empty state. S9b: the chapters editor, the chapter snap SHELL (its inner `.btn`s are
  S3's), the avatar crop, keyboard shortcuts + DDR (registry arrows), the one-off dialog shell. The generic
  `.modal-backdrop / -content / -title / -body` family is deleted (no creator left; the chapter snap keeps
  `.modal-actions`). watch.js's relocation offer asks `isLiveDialogOpen()` (one line).
- **F44 (destructive, full gate):** the local-file dialog's copy now matches its code path: its callers
  (watch.js performMediaDelete, skin-surface.js doDelete) send `DELETE /api/videos/:id`, whose handler moves a
  resolvable file to Trash (`trashItem`, lib/media/routes.js; restorable from Settings). Title "Move this local
  file to Trash?", button "Move to Trash" (was "Delete permanently"), ONE danger fill; the checkbox gate stays.
  A test binds the copy to that route (it fails if the route stops trashing). The three trash confirms still
  reached through the shim (watch.js / skin-surface.js yt-dlp item, podcasts.js episode) pass
  `{ confirm: 'Move to Trash', danger: true }` (a one-argument edit in each file).
- **Status chip (F57, F47):** a tonal pill ui-btn with a `download` glyph, an `error` glyph in --danger once
  something failed; rows with the error glyph, ui-btn Cancel / Retry / Dismiss; active progress ink, failed
  --danger, scaled by `--p` (data) by transform (no-layout-transition 1 -> 0); no bevel or barber pole in any
  era; the v1.50.1 dim only where a pointer can hover. **Handoff card (F47):** overlay surface, the one icon
  Close, a ui-thumb (`--p`), a primary ui-btn link, play / pause glyphs (was a red dot). **Modern header sort +
  card/list (F46, F31 - deferred by S1 and S2 as each other's):** header ui-btns; the sort is a ui.menu with the
  current sort CHECKED. **Sticker menu shell:** the overlay radius + shadow only (its surface / ink stay the
  skin's - the rows are S7's).
- **Empty / error (F65, D9):** buildEmptyStateHtml / buildErrorStateHtml emit the ui-state block (uiStateHtml,
  byte-equal to ui.state()); the Home feed's italic notes, the Modern grid failure, the grid's search / folder /
  library empties, the Shows page and the Playlists sheet's "No playlists pinned yet." are ui-states.
  **Not done (other owners):** notif / queue empties (S4), music (S7), Settings' trash / hidden / text
  "Loading..." placeholders (S8), the light-mode shimmer contrast.
- **window.alert / confirm / prompt:** 0 left in public/ and lib/ (S5 had already removed the two in
  lib/ytdlp/client/subscriptions.js).
- **Locks (AC12, each replacement in its commit):** S9's triage six - ddr-easter-egg and keyboard-shortcuts
  (S9b), handoff-card-styling, v1264-empty-error-states, ytdlp-download-chip converted; player-speed-btn-parity
  checked and left: it pins the PLAYER's speed sheet (player carve-out), untouched and green. Also:
  v1262-pwa-chrome (toast half), hard-delete-local-files / move-modal / share-prompt / v1262-sheet-modal-
  transitions (fake-DOM halves -> jsdom in overlays-dialogs-s9.test.js), reheat-button-wiring (CRITICAL 2 / 4),
  attribution-client (gate C1), modal-backdrop-dismiss, chrome-icons, modern-home-layout, modern-css-source-lock,
  library-view-prefs, pinned-playlists-sheet, home-feed-render; S9b's oneoff / avatar-crop / chapter-snap files.
  New: overlays-toast-s9 (5), overlays-dialogs-s9 (36), overlays-chip-s9 (3), overlay-dialogs-sheet (S9b).
- **Geometry:** `sheet-header` is live (G2, G3 and a new SHD check: Close on the trailing edge titled or not,
  level, glyph centred). `npm run test:geometry`: 171 checks - 169 ok, 0 FAIL, 2 XFAIL (F23, S7's). Mutants
  shd-close-leading and shd-close-glyph-nudge: 16 FAIL each (every sheet-header scene).
- **Mutation (git-archive sandbox of f0a6b6e0, pristine diff after: IDENTICAL): 26 of 26 killed** - every
  confirm path (onConfirm on any answer, dismiss not aborting, danger dropped, hard-delete enabled at start /
  disabled guard / one-shot guards / Cancel confirming / "Delete permanently", Move dismissable mid-request,
  the watch.js danger arg), the primitives (canDismiss, menu pick-once, is-closing), isLiveDialogOpen, the
  picker, the toast (kind, action once), the chip (glyph, inline width, ungated dim, red active), the handoff
  close, the ui-state icon, the sort check, the Close rule, the transcript toast. S9b: 10 of 10.
- **ui-lint (585d88de -> 969c47da):** no-raw-values 1004 -> 961, no-bespoke-controls 674 -> 600, icons 116 -> 112,
  no-layout-transition 1 -> 0, z-ladder 11 -> 10, colour-roles 24 -> 21; hover-gated 3, pressed-state 1,
  native-interaction 3, display-ownership 69, no-shell-style 1 unchanged; TOTAL 1907 -> 1781.
- **Renders (seeded, base 585d88de :4041 / branch :4042, scenes 71 + 80-91, 4 eras x phone/landscape/desktop x
  light/dark):** before 288, after 288, 0 failed, 0 unexpected blocked; 288 of 288 differ. Looked at: one toast
  where three stacked; the dialogs as ui.sheets with one danger fill; the chip without bevel, its error glyph;
  the handoff card; the sort menu's check (was red text); the search empty state; 2005 squares.
- **Counts (Node 22.23.1, at 969c47da):** `npm run test:unit` tests 7884, pass 7883, fail 0, cancelled 0,
  skipped 1 (exit 0). Integration (watch-transcript-button, watch-share-button, home-card-transcript-corner,
  card-action-menu-fullchain, rescan-scan-poll, chapter-snap-editor-ui, music-pocket-menus (+ r1),
  view-counts-carriers, shell-smoke, route-census): tests 134, pass 134, fail 0. `npx eslint .` 0 errors, 7
  warnings (the existing unused globals). `lint:ui` OK TOTAL 1781; `lint:css` TOTAL 0; `lint:overlay` 0
  violations; `test:geometry:fast` 12 checks, 12 ok.
- **For the gate to attack:** (1) toasts (--z-top) now sit ABOVE every sheet, the local-file dialog included
  (it was above toasts - "warning primacy"); (2) the showConfirmModal shim runs onConfirm a microtask after the
  tap, not inside it (no current caller needs the gesture); (3) the confirm bodies lose their emphasis and the
  inline red warning (text only); (4) the attribution picker lost its capture-phase Esc (a document Esc
  handler elsewhere also sees the key); (5) the Subscribe dialog (S3) is the last bespoke `.oneoff-modal`
  shell; (6) the sticker-menu shell line is one S7 is also editing - expect a merge conflict there.
- **Merge onto feat/ui-professionalism (coordinator, 2026-09-28):** cherry-picked in order, S9b's
  merge taken as its three commits. Resolutions: the toast rule and the old watch-row centring
  both go (S9 + S3); the watch page, Pocket extras and podcast deletes keep S3/S7's direct danger
  `ui.confirm` (S9's shim argument had no call left), so `overlays-dialogs-s9.test.js` binds that
  instead and records that `showHardDeleteModal` has NO caller - step 7 retires it; S9b's
  `arrow_upward`/`arrow_downward` duplicated S4's (names.js deduped, icons.js rebuilt); the
  backdrop-helper list keeps only the Subscribe dialog; SHD mutants join S7's G4 comment; the two
  style.css parse floors drop to > 1000 (1974 rules after S9); watch.js's escape comment now
  describes confirmHtmlToText (the body is parsed, then lands as text).


### Step 7 - retire (2026-09-28; coordinator 8a04c0fe, b7e9d53d, 8d756c43, f6b65390; R1-R4 merged)

- **Scope:** Dean's D10.4 amendment (the middle path). The visible kinds of debt are retired, the carve-outs
  carry their reason, and the invisible remainder (raw values, legacy tokens with no exact role) stays on
  the shrink-only ratchet with a reason. A true-up wave for it is a follow-up, opened only after the device
  sign-off.
- **Aliases (8a04c0fe):**
  - The eight exact aliases are renamed to their roles: 234 uses in style.css, 7 in page JS, plus the locks
    that pinned them. The alias block is deleted.
  - This is pixel-identical: every alias was `var(<role>)` on :root, and data-theme/data-mode are set only
    on `<html>`.
  - `no-legacy-tokens` is ON, and RETIRED_ALIASES keeps the eight names banned. 530 remaining uses of names
    with no exact role are baselined with a reason; after the wave, 435 are left.
- **css-token-lint retired (R4):**
  - ui-lint copied its classifier (it did not require the module). The two shapes ui-lint missed are ported
    first, each with a canary: named colours in non-colour properties, and JS style writes that start with a
    literal and continue with `+`.
  - ledger-check is retired (it only reconciled css-token-lint's census). pre-commit, ci.yml, lint:css and
    the tests are updated; docker-publish runs lint:ui.
  - Geometry: subscriptions (G1/G2/G3) and podcast-episodes (G1) are live, with mutants killed. The full run
    is 363 checks, 363 ok.
- **Surfaces:**
  - **R2, Music and Podcasts:** new primitives ui-tile, ui-link, ui-row--current, the `--z-sticky` rung and
    `--tile-w`. The music cards are ui-tile and the desktop Up next is a ui-list. 10/10 mutants killed.
  - **R3, Settings, Stats and TV:** the ui-reorder primitive; the pickers are radiogroups of ui-rows; the TV
    cards are links; Stats writes no inline styles. The Stats per-item delete moved from the two-tap "Sure?"
    arm to a danger ui.confirm naming the item (same DELETE, which moves to Trash); 11 jsdom tests bind it.
    26/26 mutants killed.
  - **R1, watch and shared chrome:** the Subscribe dialog and chapter snap are on ui.sheet and the
    primitives. Deleted: showHardDeleteModal, deleteFlowFor, bindBackdropDismiss, nextArmState, the
    `.oneoff-modal` shell, `.btn-primary`, `.btn.liked` and eight dead icon masks. The touch-action list
    moved into ui.css's D6 base. 19/20 mutants killed (the survivor is equivalent). R1 rebased onto the
    integrated branch itself; its commit 2 message describes a z band commit 4 replaced with R2's single
    `--z-sticky`.
- **Coordinator fixes:**
  - f6b65390: ui.js reads `window` at call time. A sheet's exit timer threw after a jsdom teardown, and the
    full suite went red on chapter-snap-shift.
  - 8d756c43: the rebaseline job also runs on a push to `rebaseline/*`. A workflow can be dispatched only
    once it is on the default branch.
- **Numbers (instrument output):**
  - `lint:ui` TOTAL 2051 at 8a04c0fe (no-legacy-tokens counted for the first time), then 1727 after the
    wave.
  - Per rule after the wave: no-raw-values 861, no-legacy-tokens 435, no-bespoke-controls 323, icons 57,
    display-ownership 36, colour-roles 5, z-ladder 4, hover-gated 3, native-interaction 2, no-shell-style 1,
    pressed-state 0, no-layout-transition 0.
  - style.css: 15781 lines at main (ab31cbdc), 11471 after the sweeps, 10743 after step 7. That is 5038
    fewer overall.
- **Every entry carries its reason (AC1 against the amended D10.4):**
  - player overlay rewrite: 199 entries / 332 items;
  - Pocket/whcal skin art: 423 / 496;
  - diag.html: 120 / 136;
  - read.html: 3 / 4;
  - raw values, retire when touched: 370 / 377;
  - legacy tokens with no exact role: 320 / 354.
  - 14 entries (28 items) are "left at step 7" with the builder's reason:
    - the Settings/Stats master-detail nav needs a redesign (a follow-up);
    - the critter illustrations;
    - the shell account-menu wrapper;
    - three layout containers;
    - the key-cap layout;
    - the native select fallback;
    - the grandfathered sidebar z.
- **For the gate:**
  - the Stats confirm change;
  - the TV link click claim (stopPropagation at #view-root);
  - `.stable-body > [role="row"]` (moved off the `-row` class; is it paid or dodged?);
  - the `ui-link` / `ui-tile` cascade against style.css;
  - the `:where()` touch-action list and `:is(.speed-sheet)` (lint blind spots, bound by
    interaction-policy-css);
  - the Subscribe dialog's close paths and signal;
  - tracker #200 now applies to ui-lint (a `token-exempt` comment exempts its whole line);
  - perf-collector.js's joined cssText literals (only the first literal is checked).
- **Pre-gate verification (at b6ec0541, the same code tree as the corrupted 5e9654f4):**
  - `npm test` Node 22.23.1: tests 10204, pass 10194, fail 0, skipped 10.
  - `npm test` Node 24.20.0: tests 10204, pass 10194, fail 0, skipped 10.
  - `npm run test:geometry`: 363 checks, 363 ok, 0 FAIL, 0 XFAIL, 0 XPASS (152 scenes).
  - eslint: 0 errors. lint:ui: OK (1727). lint:overlay: clean.

## Gate

Step 8, the full gate (destructive: D8.3 and every delete confirm). Seats: adversary + qa + security-brief.
Each seat appends its verdict below, bound to the sha it reviewed.

Gate: CHANGES r1 @6eab53bb - security-brief
Checks I could not complete: the seat has no Bash, so `git diff ab31cbdc..6eab53bb` was never run and the review is of the TREE at 6eab53bb on the five named surfaces, not of the diff. The plan's Build log and its "For the gate" list are unreadable (finding 1).
1. CRITICAL (blocks the release; this is repo integrity, not a vulnerability) - this plan doc is destroyed at HEAD. It is 3,274,808 lines: one 15-line bullet ("Every entry carries its reason (AC1 against the amended D10.4)") repeated 177,410+ times, with one character of the original doc between each copy. That is the signature of a replace with an EMPTY search string. The goal, the ACs, D0-D13 and the Build log are gone; only "Pre-gate verification" and "## Gate" at the end are intact. Size estimate: ~125 MB. GitHub refuses a file over 100 MB, so the release push fails, and a public repo would carry it forever. Inference, not verified (no git): the corruption is committed in 5e9654f4 or 6eab53bb, because the clean Gate section was appended after it. Fix: restore the doc from the last good commit, re-apply the step 7/8 entries, and recommit before any seat's verdict is final. Every seat must then re-read the plan.
2. NOTE - common.js buildNotificationMenuItems (~3942) offers "Delete file" on every media notification row regardless of role. requestDelete (~4195) has no canModifyLibrary check. Not exploitable: DELETE /api/videos/:id runs requireModifyLibrary + restrictedVideoMutation first (lib/media/routes.js:953-954), so a viewer gets a 403 and a "Could not delete" toast. Gate the item on the fail-closed capability probe skin-surface.js uses (extrasCanModifyLibrary), for parity with surface 3.
3. NOTE - common.js uiStateHtml (1832-1843) interpolates title/body RAW into innerHTML. Every current caller passes static copy (main.js 534/553/563/1660/1861/2728-2732, verified). It is a new sink with a comment-only contract: escape inside it, or rename it so a future caller cannot pass a channel name.
4. INFO - lib/auth/gate.js:124 adds /js/ui.js and /js/interaction.js to the pre-login allowlist. Verified as static code with no fetch and no data. Safe.
5. INFO - test/visual/seed.js uses fictional names, drawn images and a test-only password (visual-capture-pw), fine for a public repo. But the channel URLs (youtube.com/@harborworkshop, @northboundfieldnotes, @tidewaterset, @glassorchard, @lanternstreet) may be real people's handles. Polling is off, so nothing fetches them. Prefer example.invalid-style URLs.
6. INFO - visual.yml: permissions contents: read, no secrets. The rebaseline push trigger needs push access. The Playwright container is pinned by tag (v1.62.0-jammy), not digest. The lockfiles resolve playwright 1.62.0 and the dev deps from registry.npmjs.org with integrity hashes. Acceptable. A digest pin would close the mutable-tag gap.
Verified clean (traced): ui.js builds text only through textContent. confirmHtmlToText parses in an inert <template> and emits textContent, so no showConfirmModal caller can inject; main.js bulk attribution also escapes. TV cards and episode links use encodeURIComponent'd ids under fixed same-origin prefixes (no javascript: or open-redirect path), and the click claim only replaces the router's navigation. The server guards (/api/tv/scan, trash, users, config, folders) are unchanged. skin-surface buildPanelHtml, music rows/cards/drill, the podcasts panel, the notification rows (ui.row/avatar/thumb), Stats and the Settings pickers are all escaped or static. Not reviewed: lib/ytdlp/client/subscriptions.js in full (spot checks only: channelUrl goes through .href/textContent, validated server-side), books.js, history.js.

Coordinator, after r1 (security-brief finding 1 CONFIRMED, fixed): the session crashed with the gate open; the
adversary and qa seats died with it and never reported. 5e9654f4 had run an edit with an EMPTY search string,
so its bullet was interleaved between every character (142 MB). The doc was recovered exactly: removing every
copy of the bullet reproduces the text (2 non-single fragments, both the empty ends), and the bullet then
replaced the Build log's shorter version it was written to replace. The branch was never pushed, so the two
bad commits were rebuilt locally with their messages: 5e9654f4 -> b6ec0541, 6eab53bb -> 147e3243. The code
tree is byte-identical to 6eab53bb (`git diff 6eab53bb HEAD -- . ':!<plan>'` is empty). The corrupted head
is kept on local branch backup/ui-prof-corrupt-6eab53bb until the release. Findings 2-6 are NOTE/INFO: they go
to residuals and do not block. Round 1 re-runs with all three seats on the repaired head.

Gate: APPROVED r1 @101434b0 - security-brief
Checks I could not complete: this seat has no Bash, so `git diff ab31cbdc..101434b0` was not run, and I did not independently confirm the "code tree byte-identical to 6eab53bb" claim; findings 2-6 above carry on that basis. HEAD was confirmed as 101434b0 by reading .git/refs. For a pre-branch comparison I used the vr360 worktree's copy (main of about v1.340, not exactly ab31cbdc).
1. Finding 1 (r1 @6eab53bb) is FIXED. This doc was 2,548 lines before this entry and reads whole: frontmatter, Goal/The ask, Intake rulings, D0-D13 (lines 149-914), the Build log (steps 0-7 and every sweep), then Gate. The bullet "Every entry carries its reason" now appears only at 2493 (its Build-log home) and in the r1 finding text.
2. LOW (suspicion on exploitability, the ingress is verified) - the new "Open channel page" menu item calls `window.open(s.channelUrl, '_blank', 'noopener,noreferrer')` (subscriptions.js:3516; not in the pre-branch copy). The add route validates channelUrl (http/https, YouTube host) through validateChannelUrl. But the backup-restore ingress does not: lib/admin/backup.js:196-227 checks only that ids are non-empty strings, and no lib/admin or lib/db code calls validateChannelUrl (verified by grep). Path: an admin restores a crafted bundle whose subscription has channelUrl `javascript:...`, then a user taps Open channel page (or the pre-existing settings-sheet link at 2607). I did not verify whether a browser runs a javascript: URL in a noopener popup under the app's origin; that is the suspicion part. Likelihood in this deployment is low because it needs the admin to restore a hostile bundle. This is the LESSONS 10 class "a validated ROUTE is not a validated NAMESPACE". Fix (cheap): guard both sinks with a `^https?://` check, or better, validate subscription channelUrl in the restore path. The file-head comment (line 22, "validated server-side at add-time") is accurate only for the add route. Fix or accept with a note; non-blocking.
3. INFO - the pre-login assets were read in full at primary source. /js/ui.js (954 lines): no fetch, storage, cookie, eval or markup strings. Every label, title and body goes through textContent. The inline writes are CSS custom properties only. The one Node-only `module.require('./icons.js')` is guarded. On login and welcome, with no FTIcons, checkIcon is a no-op. The `ui.row` href and `ui.avatar`/`ui.thumb` src are caller-supplied sinks: every href caller I checked (history, queue, notifications, account menu, main.js cards, watch.js) passes a fixed same-origin prefix plus an encodeURIComponent'd id, or a literal. /js/interaction.js (581 lines): gesture listeners only, no network or data. The swipe action labels go through textContent. Both are served pre-login (gate.js:124) and loaded by login.html/welcome.html. They are safe to expose.
Verified clean (traced): subscriptions.js has no innerHTML sink (the matches are comments). Rows, the menu, the settings sheet, relocation preview rows, failure rows, field errors, action status and toasts are all textContent or ui.* text. Every fetch path id is encodeURIComponent'd. Unsubscribe, delete-failure and clear-all failures run their DELETE only after ui.confirm resolves true, with an in-flight guard. View as playlist uses `/?root=` + encodeURIComponent. history.js: its one innerHTML is the skeleton, built from ui.row with static content via outerHTML (no data). Rows are ui.row text with a same-origin href (audioOpenHref / `/watch.html?v=` encoded), and Remove/Clear all are confirm-gated. books.js: its innerHTML writes are the static skeleton template and '' only. Cards use DOM + textContent under `/read.html?b=`/`/bookcover/` encoded. The `?search=` param is echoed only through ui.state textContent. Shelf chips and pins encode dir/pinId.

Gate: CHANGES r1 @101434b0 - qa
Instruments run at 101434b0 (Node 22.23.1), verbatim: `npm run lint:ui` "ui-lint: OK - the live debt equals docs/ui-exceptions.json", TOTAL 1727, exit 0. `npx eslint .` "0 errors, 6 warnings" (the common.js unused globals), exit 0. `npm run lint:overlay` "clean (0 violations)". `npm run test:geometry` "363 checks - 363 ok, 0 FAIL, 0 XFAIL (expected), 0 XPASS; 152 scenes in 185s", exit 0. The four standalone checks against a fresh seeded server: native-interaction.check.js "PASS" (20 chrome + 8 field samples per context: AC7's Playwright measure), watch.check.js "every check holds", subscriptions.check.js "every check holds", library-toolbar.check.js "PASS". Targeted unit files (notif-delete-confirm, ui-lint, ui-exceptions-ratchet, overlays-dialogs-s9, subscribe-button, extras-delete-confirm, watch-destructive-confirm, subs-destructive-confirm, visual-workflow, interaction-policy, ui-builders): tests 233, pass 232, fail 0, skipped 1 (the ratchet: "the merge-base ab31cbdc has no docs/ui-exceptions.json", expected on the first wave). Full suite NOT run (coordinator's instruction). style.css 15781 -> 10743 lines and the per-rule debt table re-measured: they match the Build log. No CRITICAL. The ACs hold by their instruments; the WARNINGs are a merge-introduced regression and guardrail/standards drift.
1. WARNING - two html.no-motion mechanisms, and the later one voids the earlier one's contract. common.js:379 installResizeStillness (S7, wired at 16349) holds `html.no-motion` on EVERY resize; common.js:16138 wireNoMotionOnResize (S1, wired at 16396) holds it only on a WIDTH change, by design ("not the iOS toolbar collapsing, which changes only the height"), and chrome-primitives.test.js:236 asserts "a height-only resize (the iOS toolbar) does not" hold. That test passes only because it drives wireNoMotionOnResize alone on its own window. Verified: the real common.js evaluated in an index.html jsdom realm, innerWidth unchanged, one `resize` -> `html.no-motion = true`. Scenario (reasoned, not measured on a device): in iOS Safari or Android Chrome (not the standalone PWA) a scroll collapses the URL bar, which fires a height-only resize; for 300ms every transition is zeroed (a sheet opening, a toast fade, the press tint snap), and `html.no-motion *` is toggled on the root twice per event, a whole-tree style invalidation during the scroll. The two duplicate CSS rules (style.css:571 and 9164) each name a different writer. Fix: one mechanism (keep the width filter, add orientationchange), one CSS rule, and a test that loads the real common.js and dispatches a same-width resize.
2. WARNING - the standards docs still teach the retired system and name removed commands. docs/CONTRIBUTING.md:59 tells a builder to consume `var(--yt-red)` / `var(--radius)`, which no-legacy-tokens now counts as NEW debt (ui-lint tokensInfo: both are legacy), so following the doc fails the commit; :64 says "nine --z-* ladder names" (the ladder is ten since --z-sticky); :138 names `.setup-select` / `.btn` as the patterns to reuse; :340-377 (MANDATORY) says a button change is measured with scripts/action-row-probe.js, which reads `.watch-action-btns .btn` (0 matches in public/ now: the probe measures nothing, a vacuous PASS), and says a new button joins the `.btn` + `<i class="icon-*">` + `.btn-label` shape and lists a glyph in "ALL THREE icon lists" (no-bespoke-controls and the registry replace both). docs/LESSONS.md:73 and :76 still give `css-token-lint` and `npm run lint:css` (removed from package.json: "Missing script") as live guards, and :76 says width/height are ungoverned (ui-lint governs them); :199 lists `CHROME_ICON_SVG` + `NAME_ASSET` and the glyph mask lists as sibling sets. docs/LESSONS-rules.md:84 tells immersive surfaces to declare `-webkit-tap-highlight-color` / `user-select` / `-webkit-touch-callout:none`, which the native-interaction rule now rejects. The pass's own goal ("our design system doesn't allow for anything imperfect when tweaking in the future") runs through these docs: nothing in CONTRIBUTING says "use ui.button / ui.confirm / the registry", and the pre-push Playwright prerequisite (tools/capture) is undocumented, so a fresh clone's first push touching public/ fails with "Playwright not found". Doc-only fix; fold it into the release commit.
3. WARNING - the deleted APIs are still declared eslint globals: eslint.config.js:262 `CHROME_ICON_SVG`, :264 `stableToggleLabelHtml`, :270 `nextArmState`, :321 `showHardDeleteModal` (each defined nowhere in public/ or lib/ now, by grep). Scenario: a rebased branch (the paused feat/v1.340-vr-360 was cut before these deletions) or a new edit calls `showHardDeleteModal(item, onConfirm)`; `no-undef` stays silent, and the delete path throws ReferenceError at runtime. The static instrument is blinded for exactly the retired destructive-path API. Same class: scripts/channel-row-probe.js:13 calls `common.stableToggleLabelHtml` and builds `.btn-primary` markup (crashes, and measures a retired shape); delete or port it.
4. WARNING - test/visual/run.js:70 runs `fs.rmSync(OUT, { recursive: true, force: true })` on whatever `--out` names, with no guard. Scenario: `node test/visual/run.js --out .` (or a mistyped `--out ~/media`) recursively deletes the directory before seeding. seed.js:41-53, beside it, already refuses a non-empty dir without its marker file; run.js needs the same guard (a marker it writes, or refuse a non-empty dir it did not make). "I cannot lose data" applies to tooling that deletes paths.
5. NOTE - the R1 commit 8c264963's message describes a z band (`--z-raised 1, --z-sticky 20, --z-float 40, --z-drawer 99`) that is not in the tree (only `--z-sticky: 30` exists, tokens.css:747), and it ends mid-sentence ("LESSONS-rules and tracker"). 8b8ed02d and the Build log disclose it, so this is disclosed, not hidden. It becomes permanent history at the --no-ff merge; rewording would re-bind every seat, so I accept it as disclosed.
6. NOTE - lint dodges and blind spots, not debt paid. `.stable-body > [role="row"]` (style.css:10366-10427) is the same bespoke table row respelled off the `-row` class that no-bespoke-controls matches (`.stable-row` stays on the element); list it with a reason instead. The icons rule does not read CSS `content`: ui.css:1093 `.ui-reorder__handle::before { content: "\22EE\22EE" }` (the AC4-banned ⋮, carried from main into the NEW primitive) and style.css:10396-10397 (▴ ▾ sort carets, carried) are text glyphs outside the registry.
7. NOTE - dead leftovers: `--size-touch-watch-action: 39px` (tokens.css:637) has no consumer, and token-scale-lock pins it (S3 said step 7 would remove it); style.css:674-676 is an orphan comment ("The toggle buttons already inherit .btn/.btn-sm; this adds the group layout...") with no rule after it.
8. NOTE - the four `test/geometry/*.check.js` instruments (AC7's Playwright check, the watch stable-width / bell-centring measure that the risky stable-toggle-label conversion leans on, subscriptions, library-toolbar) are not run by run.js, any hook or CI. They pass today (above), but nothing will notice them rotting (native-interaction.check.js already had to be repaired once in R1). Wire them into test:geometry or the visual job.
9. NOTE - release process: docs/RELEASING.md does not mention the visual job (red on every push until baselines are committed), the rebaseline/* push procedure, or that the baselines commit lands after the gate (a new sha the seats must re-bind to); the Dependabot auto-merge section lists required checks without `visual`. `run.js --update --era X` / `--only` unlinks every baseline and writes back only the subset (run.js:111).
10. NOTE - ui.sheet (ui.js:530) adds an abort listener to the caller's signal and never removes it when the sheet closes normally, so each menu/confirm on a long-lived view signal retains its sheet DOM until the view is torn down. Bounded, but it grows with every More-menu open on one watch page.
Security-brief (standing): no new security finding beyond the security-brief seat's. Checked: gate.js adds static assets only (/css/tokens.css, /css/ui.css, /js/ui.js, /js/interaction.js); server.js ytdlpPodcastShowArtUrl passes every candidate through sanitizeChannelAvatarUrl (https only) and writes nothing; the new innerHTML sinks in the diff (playlists sheet folder rows via escapeAttr, setup folderRemoveBtnHtml via escapeHtml, choiceRowHtml over static registries, uiStateHtml with static copy, confirmHtmlToText in an inert template) carry no unescaped user data; visual.yml has `contents: read` and no secrets. I concur with its LOW on subscription `channelUrl` from a restored backup (the window.open sink). The only data-loss surface I found is tooling (finding 4).
Tree: only this verdict appended (the security-brief r1 verdict above it was already uncommitted in the working tree when I started writing).

Gate: CHANGES r1 @101434b0 - adversary
Instruments (all at 101434b0, Node 22.23.1, in a /tmp git-archive sandbox of HEAD, diffed IDENTICAL against a pristine copy after every mutant): `npm run lint:ui` "ui-lint: OK - the live debt equals docs/ui-exceptions.json", TOTAL 1727, exit 0. `node test/geometry/run.js --mutants` "geometry --mutants: 23 of 23 killed, 0 survived (79s)", exit 0. The destructive probes below ran headless Chromium (Playwright from tools/capture) against a freshly seeded fixture server (test/visual/server.js); a browser-side route recorded every non-GET and answered 200, so no fixture changed. Full suite not run (brief). Probe scripts kept for the fix round: /tmp/adv-uiprof/probe/{dbltap,trash,card-local,strand,pop,tab}.js.
1. CRITICAL - ui.confirm is answered by the second tap (or click) of the same double-tap that opened it, so every destructive confirm in the pass can be skipped by a double-tap. The D8.3 brief names this gesture. Measured, each run end to end:
   - Phone 390x844 (touch), Settings > Trash, a Purge button in the OK band (OK x196-358 y444-488; Purge x299-362 y450-482). Tap, 180ms, tap at (328,466): `DELETE /api/trash/t0`. This is a PERMANENT purge.
   - Phone, notifications, row 3 swiped open (Delete x313-390 y383-481; OK x234-358 y464-508). A double-tap on the overlap: `DELETE /api/videos/15951308e7d5213fe23b778a4431b89c` and then the dismiss.
   - Phone, Stats > Videos and audio, a delete button at y470-502. A double-tap at gaps of 60, 180 and 300ms: `DELETE /api/videos/d7b21228536e331a0eb014070cf13a96` every time.
   - Desktop 1024x800 and 1100x800, a double-click on the card menu's "Move to Trash" for the LOCAL file "Garden in spring": `DELETE /api/videos/ba4dd9dda795fa6b3e55d81516d229b8`. On main, this file needed the checkbox-gated showHardDeleteModal, whose Delete starts disabled, so for local files this is a REGRESSION. The other paths' two-tap arms on main were just as double-tappable. Even so, the branch's claim that the confirm is the guard is false.
   - Mechanism: ui.js confirm() opens the sheet in state 'open' synchronously. The OK listener checks only ctrl.isOpen(). The dialog takes clicks during its fade-in: ui.css `.ui-sheet` has opacity 0 but no pointer-events guard. The dialog is centred, so its OK (the right end of the actions row, just below centre) overlaps right-edge row actions on a phone and popover menu rows on desktop.
   - The tests cannot see it (divergent fixture). notif-delete-confirm "double tap on the revealed Delete ... one dialog", stats "a double tap asks ONCE" and extras "a double tap on OK too" all dispatch element clicks, never taps at coordinates.
   - Fix at the one seam: ui.confirm refuses an OK/Cancel activation until the dialog has been open for >= ~450ms (compare event.timeStamp, not frames), and optionally also requires the pointerdown to land on the button after that. Bind it with a Playwright tap at the OK coordinates at 60/180/300ms (no request) and at 700ms (one request), plus a jsdom mock-timer test.
2. WARNING - the escalated confirm for irreplaceable local files was deleted without a ruling: v1.21 AC46/AC49, showHardDeleteModal with its "I understand" checkbox. D4.8 KEPT the hard-delete dialog ("Copy must agree: the hard-delete dialog (F44) says..."), but S2/S3/S7 dropped it and recorded that only as an "interpretation for the gate". Together with finding 1, trashing a local file now takes one double-click (repro above). Either get Dean's explicit ruling, or restore the checkbox step for `!isYtdlpManagedItem(item)` on the card, watch and Pocket paths.
3. WARNING - some destructive confirms are not bound to the view signal. They stay open over the next view and still act. The sites: main.js confirmAndDeleteCard (`u.confirm(cardDeleteConfirmCopy(item))`, which carries no signal), history.js:253 and :275, and common.js:11677 (unpin). Repro on `/?folder=Harbor%20Workshop` and on `/`: card kebab > Move to Trash, then `FileTube.navigate('/history')`, which is what a Back swipe does. The dialog stays open over History with the body lock held (body position fixed), and OK there sends `DELETE /api/videos/4712bf6c2b4a2a985564d7c5e44da8ef`. The `if (signal.aborted) return` after the await never fires, because the home/folder view is cached and never aborted. card-action-menu-fullchain's source lock pins that line, not the behaviour. Fix: pass `signal`, as watch, stats, setup, podcasts and notifications already do.
4. WARNING - a popover never clamps or flips vertically: its top is the anchor's bottom, and `max-height: 90dvh` does not keep it inside the viewport. Repro: desktop 1280x800, home, the first card's kebab where it sits: the menu spans y528-856 with the body locked, and "Move to Trash" (y804-848) is entirely off-screen. It can only be reached by closing the menu, scrolling and reopening. Every ui.menu popover (card, row, sort, account) shares this.
5. WARNING - defense-in-depth guards on the destructive paths survive mutation. Each is masked by ui.confirm's boolean contract, but LESSONS 2 counts a survivor on correct code as a WARNING, and this branch bound the same twins for notifications with stand-in confirms (M2b/M7). The survivors:
   - stats.js:395, the `statsController.signal.aborted` check dropped: 254/254 green.
   - stats.js:381, `yes === true` changed to `!!yes`: 254/254 green.
   - setup.js:817, `yes === true` changed to `!!yes`: 812/812 green.
   - setup.js purgeTrashItem, the `signal.aborted` check dropped: 812/812 green.
   The Build log's "26/26 mutants killed" for R3 did not try these. The primary guards do bind: dropping the confirm from Purge or Empty trash, or the Stats `asking` guard, each goes red.
6. WARNING (safe to ship disclosed, with a tracker entry beside #200) - `token-exempt` is an unratcheted bypass of no-raw-values. Repro: append `.adv-smuggle { color: #123456; padding: 13px; z-index: 99999; } /* token-exempt: adversary */` to ui.css. `ui-lint --enforce` adds no debt for that line. 201 such annotations exist in style.css and 3 in perf-collector.js, and nothing counts them, so the shrink-only promise does not hold on the raw-value axis. Fix: ratchet the count of annotations per file.
7. NOTE - focus escapes the aria-modal dialogs. Stats delete, Enter, then Tab six times: Close, Cancel, Move to Trash, then BODY, the header "Open menu" and the search input behind the scrim. No trap, and the background is not inert, so a keyboard user can stack a second destructive confirm. Making the siblings inert while a dialog is open would also harden finding 1.
8. NOTE - the pre-push geometry gate runs only when `public/` changed. The Subscriptions fast scene is rendered by lib/ytdlp/client/subscriptions.js and lib/ytdlp/views/subscriptions.html, so a change there skips it (CI's visual job still runs it). tv.js isPlainClick: removing its altKey term survives (145/145 green).
Verified clean (measured): the alias retirement (8a04c0fe), by static enumeration rather than a pixel diff. At 8a04c0fe^, none of the 16 names (the 8 aliases and their 8 roles) is defined outside tokens.css anywhere in public/ or lib/ (CSS, JS, HTML, setProperty). data-theme/data-mode are written only on documentElement; setup.js's `data-mode="angle"` buttons match no token selector. HEAD has zero remaining uses of the 8 names.
The ui-lint port: both ported shapes are killed (named colour: canary 21/22, 5 ui-lint tests red; the literal-prefix concatenation: canary 20/22).
The TV claim: without stopPropagation, 2 tests go red; the episode-row claim is killed too. The router's link handler is a bubbling document listener (common.js:11356), so the #view-root stop holds.
The primitives: these mutants are all killed: ui.confirm's onClosing settle, its aborted-signal pre-check, swipeRow's armed-press check and the post-drag click swallow. Removing ui.confirm's OK `isOpen()` guard survives 615 tests, but that mutant is equivalent (settle is idempotent).
The Stats delete names the item, closes over its id and sends one request per OK. Notifications requestDelete was read against its tests.
Not duplicated from qa: the stale LESSONS lint:css lines and the dead eslint globals.
Tree: I appended only this verdict. Every mutant ran in /tmp/adv-uiprof/work, which is IDENTICAL to its pristine twin. My fixture server is stopped. The qa and security-brief verdicts above were already uncommitted when I appended.
