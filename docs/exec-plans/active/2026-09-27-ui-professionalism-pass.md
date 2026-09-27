---
plan: ui-professionalism-pass
harness: v2 · lean
branch: feat/ui-professionalism
anchor: spec
status: Building
next: D12 step 3 (Primitives) - public/css/ui.css, public/js/ui.js, public/js/interaction.js with every D4 primitive, loaded in every shell, plus the hidden kit page rendering every primitive in every variant and state; ui-builders.test.js
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
