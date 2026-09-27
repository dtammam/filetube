---
plan: notify-bell-art-subs-nav
harness: v2 · lean
branch: feat/v1.340-small-fixes
anchor: outcome
status: Building
next: commit, then the gate (adversary + qa + security-brief: lib/ytdlp/client/subscriptions.js matches the forced `**/*client*` rule)
design: n/a (outcome anchor)
gate: pending
---

# v1.340: a steady Notify button with the real bell, smaller Continue-listening art, and the Subscriptions page's full bottom bar

## The ask (Dean, 2026-09-27)

"Can we do notify button and use the same notification glyph versus emoji? Also go ahead
continue row track and the sub pages bottom bar missing things." Intake answers (AskUserQuestion,
same night): the OFF state is a slashed bell + text, the button always as wide as "Notifying";
also swap the Subscriptions page's emoji bells, and hold Subscribe / Pin widths steady too; take it
to a release while he sleeps.

## Acceptance (outcome anchor)

1. **Notify never moves its row.** On the watch page's channel row, Subscribe, Pin channel and
   Notify each keep ONE x and ONE width across every state (subscribed or not, pinned or not,
   notifying or not), in all four eras, at 390px; the buttons stay level (same y, same height).
   The Notify glyph is the header bell (`CHROME_ICON_SVG.bell`) when on and Material's slashed bell
   (`bellOff`) when off, never an emoji. The Subscriptions page's per-row bell draws the same two
   glyphs. Bound by watch-init-behavioral.test.js (labels + slot shape), sub-row-chip-btn-family
   AC3 (the drawn path, executed in JSDOM), chrome-icons.test.js (paths == the asset files), and
   the row probe (below).
2. **The Continue-listening tile asks for the 256px cover**, keyed on the album's `artId`, never the
   full-size file (tech-debt #287 e, the home row half). music-home-row.test.js.
3. **The Subscriptions page's bottom bar is the other shells' bar**: Liked, Podcasts, Music, Books,
   Downloads present; inline SVG glyphs, no `.icon-*` masks (tech-debt #114).
   subscriptions-shell-bottom-nav-parity.test.js (red on the old shell, measured).

## Approach notes

- `stableToggleLabelHtml(current, labels, glyphs)` (common.js): every label in one grid cell,
  the idle ones `visibility:hidden` (out of the accessible name too). The glyph sits INSIDE its
  label's slot: a leading svg flex item set the button's baseline to its bottom edge and dropped the
  neighbours 3-4px (measured). A hidden "Pinned ★" still grew the line box (the star is a taller
  fallback-font glyph) and dropped Pin 2px (measured); `.btn:has(> .btn-label-stack) {
  vertical-align: middle }` levels the row.
- The Subscriptions client keeps its standing rule (never innerHTML): the bell is built with
  `chromeIconEl(name, '', button.ownerDocument)` (the new optional `doc` argument).
- Not done, on purpose: the home TRACK CARDS (search results) keep the full cover. The card is
  ~full phone width (358px at 2x = 716px > the largest 512 rendition), so the sized file would be
  soft on the phone; the gain is desktop-only and small.

## Measurements

Row probe (`scripts/channel-row-probe.js`, static page on this tree's style.css, headless Chromium 1234,
390px, eras 2005/2009/2014/2021, five states each). BEFORE (old labels): distinct x/w per button
across the states = sub 2, pin 3, bell 5. AFTER: sub 1, pin 1, bell 1 in every era; all at y 73,
h 44.

## Deviations

- Scope grew on Dean's answers: Subscribe and Pin widths, and the Subscriptions page bells.
