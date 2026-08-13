# Exec plan: Settings cog + persistent chapter-name label

- Owner: main session (lean mode)
- Opened: 2026-08-13
- Status: ACTIVE (intake locked; design done; implementation pending)
- Device pass: PENDING (Dean) - the final arbiter
- Verification ceiling: this dev env has no browser and no iOS; every visual /
  layout / touch claim in this plan is Dean's on-device arbiter, not mine.

## Goal (Dean's two wishes, from intake)

1. **Centralize the menu-ish controls into a Settings cog** (like YouTube's gear),
   decluttering the control bar.
2. **Keep the current chapter name visible on the bar** - persistent, not the
   flash-then-fade overlay that steals the video (v1.109.1 `.chapter-now`).

## Locked scope (intake, Dean agreed per-number + added PiP)

- **Cog (gear) holds: Playback speed + CC + Picture-in-Picture.** Three controls
  come OFF the bar into one `#settings-menu` popup.
- **Chapter name = a persistent label ON the bar**, click opens the chapter list.
  Replaces the floating flash chip. A subtle highlight on chapter CHANGE is kept
  so the transition is still noticeable.
- **Chapters are NOT in the cog** (the intake framing split): on real YouTube the
  gear holds speed/subtitles/quality, and chapters live inline on the bar as the
  current-chapter name. So the name label - not a separate `Ch` button - is the
  affordance that opens the list. `#chapters-btn` leaves the bar entirely.
- Fullscreen (`#fs-btn`) STAYS on the bar (YouTube keeps it out of the gear).
- Big wave: exec plan -> task commits -> FULL two-reviewer gate -> dual-Node ->
  release with device pass pending.

## Design (reuse posture: relocate elements, do NOT rebuild handlers)

The control bar's speed/CC/PiP machinery is battle-won and iOS-scarred (desktop
inline `#speed-menu` popup AND a mobile body-level bottom sheet; CC's audio-vs-
video dual path + the iOS cuechange freeze fix; PiP's support-gated visibility).
The lean, low-risk move is to **relocate the existing `#speed-btn`, `#cc-btn`,
`#pip-btn` ELEMENTS from the flex bar into the `#settings-menu` popup and leave
their IDs + wired handlers 100% untouched.** They are queried by ID from the
reparented host, so relocation does not change what fires; only their CSS role
(full-width menu rows with text labels) and their container change.

### The cog

- New `#settings-btn` on the bar: an inline `<svg>` gear (matches the nav chrome
  glyphs; inline SVG dodges the iOS CSS-mask decode-lag scar - blank-until-decode).
  Always visible (there is always at least Speed).
- New `#settings-menu` popup, built on the EXISTING `.chapters-menu` popup
  pattern (same open/close/clamp/outside-close lifecycle). Contains the three
  relocated controls as menu rows:
  - **Speed row** (`#speed-btn`): its existing click still opens the speed picker
    (desktop inline popup / mobile sheet). Opening the picker CLOSES the settings
    menu (the picker replaces it - no nested-popup stacking). Row label shows the
    current rate.
  - **CC row** (`#cc-btn`): existing toggle; its own `display:none`-until-captions
    logic (driven by `setupForMedia`, gated on `data.hasSubtitles`) naturally
    hides the ROW when the item has no captions. Settings menu stays open after
    toggle so the on/off state is visible.
  - **PiP row** (`#pip-btn`): existing toggle; its own
    `document.pictureInPictureEnabled` gate hides the row where unsupported.
- The settings menu joins the shared close lifecycle: `closeSettingsMenu()` added
  to the `closeChaptersMenu()` "change one, change both" chain, to `dock()`'s
  inlined popup-teardown, and a `closeSettingsMenuOnOutside` (click+pointerdown,
  the iOS pair) in the same wiring block as the chapters/speed outside-close.

### The persistent chapter-name label

- Repurpose `.chapter-now`: instead of an above-the-bar overlay at `bottom:100%`
  that flashes then fades (v1.109.1), it becomes a **persistent element on the
  bar**, shown whenever the item is chaptered (>1 chapter) and the playhead is in
  a resolved chapter; truncated with ellipsis; clicking it opens `#chapters-menu`.
- `updateChapterNowChip()` (rename to `updateChapterNowLabel`) sets its text on
  every resolved chapter and KEEPS it visible; on a genuine change it adds a
  brief `.changed` highlight class (the "subtle highlight" Dean agreed to) instead
  of fading the whole element out. Hidden (`[hidden]`) only for chapter-less items
  / pre-first-chapter / reset. `[hidden] { display: none !important }` retained
  (the `[hidden]`-loses-to-author-display scar).
- The label becomes the chapters trigger: its click runs the same
  open-buildChaptersMenu-toggle-clamp-aria logic `#chapters-btn` ran. `#chapters-
  menu` re-anchors near the label (bottom-left) instead of the removed button.

### RESOLVED - label placement (Dean, 2026-08-13, off the mock)

Dean picked a THIRD option neither mock panel showed: the label sits **IN LINE
with the transport controls** (in-flow on the bar, same level as
play/settings/fullscreen), not a floating pill (mock-A) and not a dedicated line
(mock-B). This works because **mute/volume are hidden on mobile** (iOS ignores
volume), freeing the button row. Implementation: the label is inserted in the DOM
just before the cog (desktop single row shows it inline near the gear/fullscreen);
the mobile block gives it `order: 4; flex: 1 1 auto` so it drops onto the button
row and fills the freed space, truncating before the cog. Plain text at rest; a
chapter change briefly turns the text `--yt-red`. Desktop caveat (accepted): the
single row is tighter, so the name truncates harder there; fallback if it bites
on-device is mock-B. His words: "sits in line with play/settings/full screen. Yes
in sync. I like it."

### (superseded) prototype note - mobile placement of the label

The narrow **two-row mobile bar** is the one real layout risk. It is a battle-won
flex-`order` layout: a zero-height `::after` (order -1, flex-basis 100%) forces the
row break; `margin-left:auto` on the right cluster pushes settings to the corner.
NEVER wrap `#seek-bar` (its `order` as a DIRECT `.player-controls` child is load-
bearing). Candidate placements, to be prototyped and screenshotted for Dean's pick
BEFORE committing the mobile CSS:

- **A - absolute pin on the bar** (lowest risk): label is out-of-flow, pinned
  top-left inside the positioned `.player-controls` (like the current chip but on
  the bar, not over the video, and persistent). Never joins the flex flow, so the
  two-row order stays byte-identical.
- **B - in-flow slot**: label as a real flex child with its own `order` on the
  scrub row or button row. More "on the bar" but must earn a slot on the crowded
  narrow bar without forcing a third row (the v1.34.1 three-row-clip scar).

Desktop (single row) is low-risk either way: bottom-left near the time, YouTube-
style. Decision recorded here once Dean picks from the screenshots.

## Machine-derived facts (predictions the tools re-verify every commit)

- **9 shells** carry `#player-host-template` and must be edited byte-identically:
  `lib/ytdlp/views/subscriptions.html` + `public/{history,index,music,podcasts,
  read,setup,stats,watch}.html`.
  Re-derive: `grep -rl 'id="player-host-template"' --include=*.html . | grep -vE 'node_modules|.claude/worktrees' | wc -l` == 9
- **3** bar buttons relocate into the cog: `#speed-btn`, `#cc-btn`, `#pip-btn`.
- **1** bar button removed: `#chapters-btn`.
- **2** new elements: `#settings-btn`, `#settings-menu`.
- **4** per-element parity tests currently cover only a 4-5 shell SUBSET each and
  assert byte-identical markup + relative position; they get rewritten to the new
  structure AND widened to all 9 shells (closing a latent shell-drift gap):
  `player-speed-btn-parity`, `player-cc-btn-parity`, `player-pip-parity`,
  `player-chapters-parity`.
- CSS mobile `order` rules (`player-responsive-controls.test.js`) change: drop
  chapters/pip/cc/speed order lines, add `#settings-btn`.

## Task commits (each green before the next; tests with each)

1. **T1 - shell markup: cog + settings menu + relocated rows (all 9 shells).**
   Add `#settings-btn` + `#settings-menu`; move `#speed-btn`/`#cc-btn`/`#pip-btn`
   inside `#settings-menu`; remove `#chapters-btn`. Rewrite the 4 parity tests to
   the new markup/positions across ALL 9 shells. No JS behavior change yet beyond
   the cog open/close.
2. **T2 - cog open/close wiring + lifecycle.** `#settings-btn` toggles
   `#settings-menu` (buildless - static rows); speed-open closes settings; add
   `closeSettingsMenu()` to the shared close chain + `dock()` inline + outside-
   close pair. Verify speed/CC/PiP still fire from inside the menu.
3. **T3 - persistent chapter label.** Repurpose `.chapter-now` to persistent +
   `.changed` highlight; rename updater; wire label click -> `#chapters-menu`;
   re-anchor the menu. Update the chapter follow-along tests + any `.chapter-now`
   source-lock.
4. **T4 - CSS (tokenized).** Cog glyph, `#settings-menu` rows, chapter label
   (desktop). Mobile placement CSS lands here AFTER Dean picks A/B from the
   screenshots. `npm run lint:css` + `ledger:check` clean (design-token census is
   MANDATORY - no raw values).

## Named attack surfaces for the adversarial seat (full gate - UI, not data-loss)

- A relocated button whose handler silently no-ops because a query/listener
  assumed the old parent or the old sibling order.
- The speed picker (desktop popup vs mobile sheet) opening from inside the
  settings menu: stacking, z-index, outside-close eating the first tap, or the
  stale-`speedSheet`-handle-after-dock class (v1.90 scar).
- `#settings-menu` left open across a dock/close/teardown (the popup-not-dismissed
  class) - mutation-test the `closeSettingsMenu()` bindings on every axis.
- CC row visibility: an item with NO captions must hide the CC row but keep the
  cog usable (speed/PiP still there); an item WITH captions must show + toggle it.
- The two-row mobile bar: prove the chosen placement never forces a third row and
  never disturbs `#seek-bar`'s order (screenshot at 2-3 widths).
- Chapter label as the ONLY chapters affordance: an item with chapters but the
  label somehow hidden = a stranded chapter list (no button fallback anymore).
- Shell parity: all 9 shells byte-identical; the widened parity tests actually
  fail when one shell is mutated (delete a shell's block, watch it go red).

## Stop condition

Both seats APPROVE across the full gate; dual-Node suites green (v22.23.1 +
v24.14.0, sequential, counts reported verbatim); Dean's mobile-placement pick
incorporated; released with device pass PENDING and disclosed. Move this plan to
`completed/` at release.
