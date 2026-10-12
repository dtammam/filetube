---
plan: header-popovers
harness: v2 · full
branch: fix/v1.387.3-header-popovers
anchor: spec
status: Shipped v1.387.3
next: shipped - confirm the tag publish, then Dean's device checks (docs/DEVICE-CHECKS.md Header panels)
design: Dean's desktop report with screenshots, 2026-10-12 ("I'd like it to be consistent"). Seams verified by the FileTube Root the same day. Base = main f72e4f9f (v1.387.2).
builder: standard (one shared component, ui.sheet's popover placement, plus one CSS padding; every seam named below)
gate: APPROVED r2 @8f86ff39 (adversary + qa)
---

# v1.387.3: desktop header panels open under their button, the same way every time

Norms: no em dashes; stage by name; `git commit -F <file>`; never pipe a commit or push; fnm Node 22.23.1 PATH before any
node/npm/git command; never `--no-verify`; never self-merge. A status report NEVER ends your turn.

Read first: AGENTS.md (the CSS / SPA traps and the UI ratchet); docs/LESSONS.md 0, 2, 3, 4, 6; public/js/ui.js (sheet,
`resolveVariant` ~:442, `placePopover` ~:414, `open()` ~:579-600, the ResizeObserver ~:511, the inline-style allow-list
header ~:8-18); public/css/ui.css (`.ui-sheet` ~:745, `.ui-sheet--popover` ~:762-773, `.ui-sheet__body` ~:831-837,
`.ui-sheet__body > .ui-field` ~:854); the memory norm "measure UI changes: probe before / after; rows wrap, buttons never shrink".

## Step 0 (builder)
- Work ONLY in `.claude/worktrees/fix-v1.387.3-header-popovers` (its node_modules is a hard-link copy; if you need a clean
  install, `rm -rf node_modules && npm ci` there, never anything that touches the main checkout).
- Stop and ask Dean (AskUserQuestion) when: a phone layout would change; a panel would need to look different beyond position
  and the open motion; the gate reaches round 3.
- Merges: when the gate is closed and the PR's required checks are green, SendMessage "FileTube Root" (it may be listed as
  "FileTube Server/Web Root Session") the PR number and sha; the Root merges. Close-out after approval: bookkeeping-only needs
  no seat re-check (docs/RELEASING.md step 1); verdict lines ride the commit already happening.

## 1. Outcome (Dean, 2026-10-12, desktop)
1. The Account panel opens directly under the avatar, its right edge lined up with the avatar's right edge (today it lands
   well to the left: screenshot 1).
2. The Notifications panel opens under the bell in its final place and stays there while its rows load: no jump about a
   quarter second after opening (today it is placed while empty, then re-placed up over the bell when the rows arrive).
3. The One-off download dialog's first box shows its whole focus ring (today the top is cut: screenshot 2).
4. Consistency: every desktop header panel (Account, Notifications, Queue, and Home's Sort menu) behaves the same: right edge
   lined up with its button's right edge (left-aligned instead when the button sits in the left half of the window), opens
   downward, grows from the button's corner, and scrolls inside when it is taller than the space below. Phone (bottom sheet)
   behaviour: no change.

## 2. Root causes (from code, 2026-10-12)
- **Account / Sort left of their button**: ui.js:579-584 passes only `--ui-anchor-x` (= `rect.left`) and `--ui-anchor-y`;
  ui.css:762-773 sets `left: clamp(var(--space-4), var(--ui-anchor-x, 50vw), calc(100vw - var(--panel-w) - var(--space-4)))`
  with `min-width: calc(var(--panel-w) * 0.6)`, `max-width: var(--panel-w)` and no width / right. Every header button sits
  right of the clamp, so every header popover starts near vw-416 and a narrow one (Account, Sort) ends short of its button.
  `100vw` also includes a classic scrollbar.
- **Bell / Queue jump**: `openPanel` (common.js:4655-4663) opens the sheet, then `loadRows` (4639-4653) adds a skeleton and,
  when `/api/notifications` answers, the rows. `place()` ran once in `open()` (ui.js:591) against the empty body; the
  ResizeObserver (ui.js:511-515) re-runs it on each change, and `placePopover` (ui.js:414-420) moves a tall panel UP ("shifted",
  `top = hi - h`) or pins it with a height cap. `top` jumps with no transition (and ui-lint rule 8 forbids animating layout).
  The Queue panel (common.js:5002, loadQueue ~5141) has the same open-then-load shape.
- **One-off clip**: `.ui-sheet__body` scrolls (`overflow-y: auto`, which clips x too) with no top padding (ui.css:831-837);
  `.oneoff-form` (style.css:3066-3070) pads only the sides; the URL input is focused on open (common.js:6547 `initialFocus`),
  and its 2px outline (`outline-offset: 0`, ui.css:927-931) is cut at the top.

## 3. Design
- **D1 Right-aligned anchoring** (ui.js + ui.css, the shared component, so every header panel gets it):
  - `open()` also passes the anchor's right edge as a new custom property `--ui-anchor-r` (px from the viewport's LEFT, i.e.
    `rect.right`, measured against `document.documentElement.clientWidth` so a scrollbar does not count). Add it to the inline
    allow-list in all three places (ui.js header comment ~:8-18, test/unit/ui-builders.test.js `ALLOWED_PROPS` ~:41 and the
    enforcement ~:1123).
  - `.ui-sheet--popover`: when the anchor's centre is in the right half of the window (JS sets a modifier class, e.g.
    `ui-sheet--popover-end`; a class, not a style), the panel's right edge sits at `--ui-anchor-r`, clamped so it never leaves
    the window by less than `--space-4`; otherwise the existing left-anchored rule stands. Width rules unchanged (min 0.6 x
    `--panel-w`, max `--panel-w`).
  - `transform-origin` at the anchored top corner (top right for `-end`, top left otherwise), so the existing
    `scale(0.98) -> none` open motion grows from the button.
- **D2 No jump while loading** (ui.js placement): a popover keeps the vertical side it was first placed on (below its anchor)
  for its whole open life; when its content grows past the space below, it caps its height there and scrolls inside, never moves
  up over its anchor. The ResizeObserver may still update the height cap, never `top`. Applies to every popover (Notifications,
  Queue, Account, Sort). A popover that genuinely has no room below at open time (a card menu near the bottom of the window)
  keeps today's below / above choice at OPEN time only: measure that the card-menu geometry checks (POP) stay green.
- **D3 One-off focus ring** (style.css): give `.oneoff-form` top (and bottom) padding of at least the focus ring's width plus
  a step (a `--space-*` token, e.g. `padding: var(--space-2) var(--space-8)`), matching how `ui.prompt` avoids it
  (`.ui-sheet__body > .ui-field`, ui.css:854). Check the Subscribe dialog (it also uses `.oneoff-form`) still looks right.
- **D4 Phones unchanged**: the `(max-width: 768px)` bottom-sheet path (`.ui-sheet--bottom`, ui.css:748) is untouched; prove it
  with the existing phone tests and one measurement at 390.

## 4. Waves
- **W1 Measure before** (no fixes): a headless Chromium + WebKit probe at 1280x800 and 1920x1080 (and 390 for phones), reusing
  tools/capture or the geometry harness: for Account, Notifications (with 12 seeded notifications), Queue (with items) and Sort,
  record the panel's right edge minus the button's right edge, its top at open and 500 ms later, and for One-off the URL
  input's outline box vs the body's clip box. Numbers into the evidence section.
- **W2 Fix** D1-D3 with tests: extend the geometry checks (test/geometry scenes.js / checks.js, `npm run test:geometry`) with
  a horizontal-alignment check for header popovers (|panel right - button right| <= 1 px for Account, Notifications, Queue,
  Sort) and a no-jump check (top at open == top after the rows load); add the account menu and the one-off dialog as scenes if
  missing; mutation-bind each (break the new rule, watch it red; mutations.js has the POP pattern). Keep the class contracts
  (notif-panel-sheet.test.js:25, queue-panel-sheet.test.js:24) and v1262-sheet-modal-transitions.test.js:87-104 green; update
  ui-builders.test.js:597-609 for the new property. `npm run lint:ui` and `npm run lint:overlay` clean (no new debt in
  docs/ui-exceptions.json; tokens only; no layout properties in transitions; never combine a radius with overflow:auto on one
  rule). Re-run the W1 probe: after numbers.
- **W3 Close-out**: ledger (user language: "On a computer, the Account, Notifications and Queue panels open right under their
  button and stay put while they load; the download box's first field is no longer cut off"), ROADMAP Shipped, LESSONS only if
  the gate finds a new class, docs/DEVICE-CHECKS.md "Header panels (v1.387.3)" (desktop Chrome and Safari: click the avatar,
  the bell, the queue icon, Home's sort: each opens under its button, right edges lined up, no jump; open One-off download: the
  first box's focus ring is whole; phone: the You tab and the bell's sheets look as before). Visual baselines refresh by the bot
  after merge (a report, never a gate; docs/RELEASING.md).

## 5. Gate
adversary + qa (the scrutiny table; client UI and CSS only). Brief: a header panel still left of its button at 1280 or 1920 or
with a scrollbar; a panel that jumps when its rows load; a tall panel pushed off the bottom of the window instead of scrolling;
a card menu near the window's bottom now opening off-screen; any phone (390) change; new ui-lint debt; the allow-list not
updated in all three places.

## 6. Release
docs/RELEASING.md + AGENTS.md; close the plan in the same PR (`node scripts/plan-complete.js
docs/exec-plans/active/2026-10-12-header-popovers.md "Shipped v1.387.3" --apply`); the Root merges on green (Dean's go for
this plan, 2026-10-12); shipped = the tag's "Publish Docker Image" green; then SendMessage the Root the result and run
claude-close.sh.

## 7. Evidence (builder fills)
Probe: headless Chromium and WebKit (Playwright), rows delayed 400 ms, 12 notifications. Panel right edge minus button right edge, px
(Chromium; WebKit differs by 12 px before, 0 after):

| Panel | Before (1280 / 1920 wide) | After |
|---|---|---|
| Account | -152 / -152 | 0 / 0 |
| Notifications | +88 / +88 | 0 / 0 |
| Queue | +128 / +128 | 0 / 0 |
| Sort | -68 / -68 | 0 / 0 |

Notifications jump (top at open -> after rows, 1280x500): before 45.5 -> 42 px (3.5 px up over the bell, `shifted`); after 45.5 -> 45.5,
`below`, capped at 446.5 px and scrolling inside. At 1280x800 and 1920x1080 the panels fit below and did not jump before either.
One-off focus ring, input outline top minus body top (desktop): before -2 px (cut), after +2 px; at 390: -2 before and -2 after
(phone unchanged, by decision after gate r1). Phone bottom sheets (bell, queue, sort) heights identical before and after (759.6 / 335 / 427).
Geometry: `npm run test:geometry` 476/476 ok (224 scenes, before the gate fixes); after gate r1 `--only HPOP,POP` 56/56 ok; mutants
`hpop-left-anchored` and `hpop-jump-on-load` killed. Node 22 `npm test` before the gate fixes: 12431 tests, 12417 pass, 1 fail (the
geometry mutation-census test, fixed), 13 skipped; the pre-commit runs of both commits were green. lint:ui OK (3172, no new debt),
lint:overlay clean. Gate: qa APPROVED r1 @c9d208ca, adversary CHANGES r1 (W1: One-off padding reached phone sheets), both APPROVED r2 @8f86ff39.

## 8. Out of scope
The panels' contents and look beyond position and the open motion; the phone bottom sheets; the offline-UI roadmap item.

Gate: APPROVED r1 @c9d208ca6b025ac98694243c7d9b3f8a24f5b35f — qa
Gate: APPROVED r2 @8f86ff39a17e8ef6a5307ebe7560dfe3431573be — qa
Gate: APPROVED r2 @8f86ff39a17e8ef6a5307ebe7560dfe3431573be — adversary
