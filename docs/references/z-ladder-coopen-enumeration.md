# Z-ladder co-open enumeration (Tier 3 Step 1 - analysis only, gates the Tier 4 re-ladder)

Method: every stacked surface's OPEN trigger was traced to its code path
(not imagined), each backdrop's coverage read from CSS (position:fixed +
full-inset), and each pair classified: can the second surface's opener
fire while the first is open? Async surfaces (toast, chip, notification
badge) can appear WITHOUT user input, so they co-open with everything.
Verified facts: full-viewport blocking backdrops exist on modal (2000),
oneoff-modal (2100), sub-sheet (1600), hard-delete (2250), reloc-preview
(1000); the playlists-sheet/notif-panel backdrops are their
:not([hidden]) variants (1500/1599). Toast (2200), chip (940), dock
(950), bottom-nav (900), header (1000) are non-blocking chrome.

## Current deployed ladder (selector-attributed, re-verified this tier)

900 bottom-nav | 940 chip + reader-nowplaying | 950 dock | 99 sidebar |
1000 header, reloc-preview-backdrop | 1100 audio-expanded |
1500/1501 playlists sheet pair, css-fullscreen | 1599/1600 notif pair |
1600 sub-sheet | 2000 confirm modal | 2100 oneoff modal | 2200 toast |
2250 hard-delete. (A first-pass scan misread hard-delete as 1100 - that
was comment prose + the audio-expanded rule; the rule value is 2250.
Recorded because it is exactly the mistake a re-ladder must not make.)

## Pair matrix (P = possible co-open, I = impossible by code path, A = async-possible)

| pair | poss. | how | current outcome | proposed-ladder outcome |
|---|---|---|---|---|
| toast x ANY blocking surface | A | showToast fires from 44 sites incl. poll/async completions | toast (2200) above everything except hard-delete (2250) - toast UNDER hard-delete | --z-top for toast; hard-delete at calc(--z-top)+1 keeps warning primacy: UNCHANGED behavior |
| chip x sheets/modals/reloc | A | chip repaints on its own poll | chip (940) under all of them - correct (background status) | --z-chip: unchanged |
| notif badge/panel x sub-sheet | I | both openers live on /subscriptions chrome, but sub-sheet backdrop (1600, full-cover) blocks the header bell; bell first: panel (1600) vs kebab row UNDER its own backdrop... kebab unreachable behind panel backdrop (1599) | ties at 1600 never render together (openers mutually blocked) | distinct --z-panel vs --z-sheet removes the accidental tie anyway |
| notif panel x playlists sheet | I | different pages' chrome? both global: bell (header) + bottom-nav Playlists. Sheet backdrop 1500 full-cover? playlists backdrop is fixed full-cover at 1500: blocks bell (1000). Bell first: notif backdrop 1599 blocks bottom-nav (900) | whichever opens first blocks the other | same, made explicit by ladder names |
| dock x every sheet/modal | P | dock persists across nav; sheets/modals open above it | dock 950 under all overlays - correct | --z-dock: unchanged |
| reloc-preview x toast | A | subscription poll toasts while preview open | toast 2200 over reloc 1000 - correct | unchanged |
| reloc-preview x confirm modal | P | bulk-attribution confirm and preview both live on folder/subs flows; preview open blocks page (backdrop 1000) BUT header z1000 ties: later-DOM backdrop wins, header buried incl. its controls | modal openers unreachable -> effectively I today; the TIE is the fragile part | reloc joins --z-modal band: tie eliminated, header cleanly under |
| reloc-preview x chip | A | chip poll continues | chip 940 UNDER reloc backdrop 1000: chip invisible while preview open (status hidden during a long-running reheat preview - arguably wrong today) | reloc at --z-modal keeps chip under; if chip-visibility-during-preview is wanted, that is a UX decision, not a ladder one - flagged |
| oneoff modal x confirm modal | I | oneoff opens from header button; confirm backdrops (2000) block it; oneoff backdrop (2100) blocks confirm openers | one at a time | ordering preserved via --z-modal + offset |
| hard-delete x toast | A | delete outcome toasts | toast 2200 UNDER hard-delete 2250: a toast firing during the confirm is buried until dismissal - intentional per the 5619 comment (warning primacy) | preserved by design: hard-delete = calc(--z-top) + 1, documented |
| css-fullscreen x chapters/cc/toast | P | chapters menu + cc live INSIDE the player stacking context (local band); toast is outside | fullscreen 1500 under toast 2200 - correct; internals unaffected | --z-sheet for fullscreen; local band untouched |
| audio-expanded (1100) x hard-delete/toast | A | per the 5619 comment, deliberately below modals/toasts | correct | --z-player-max: unchanged |
| sidebar (99) x everything | P | persistent chrome under header | correct | stays literal (local band ruling, amendment d) |

## Conclusions for the Tier 4 re-ladder

1. NO pair renders differently under the proposed named ladder in any
   reachable state - the re-ladder is behavior-preserving for every P/A
   pair, and removes two fragile TIES (notif/sub-sheet at 1600;
   reloc/header at 1000) that today depend on DOM order.
2. Two deliberate inversions must be PRESERVED and documented, not
   "fixed": hard-delete above toast (warning primacy), audio-expanded
   below modals/toasts.
3. One UX question surfaced (not a ladder bug): the chip is invisible
   behind the reloc-preview backdrop while a preview is open - flag for
   Dean at Tier 4, default keep.
4. The re-ladder itself remains Tier 4 work behind this document plus
   Dean's baselines; nothing changed in this tranche.

## Amendment (Tier 4 adversarial gate, 2026-07-31): "impossible" means POINTER-impossible

The I-classifications above rest on full-cover backdrops blocking the
other surface's opener CLICK. No overlay in this app traps keyboard
focus or sets `inert` (verified at gate: zero focus-management code on
the five global overlays; the bell/kebab/bottom-nav are plain focusable
buttons), so Tab-behind-the-scrim + Enter can co-open any "I" pair.
Every I above should be read as pointer-impossible. Consequence for the
executed re-ladder: under a keyboard co-open the Tier 4 ladder paints
the modal-grade surface (reloc preview) on top and sub-sheet above
notif - both acceptable orderings; the pre-Tier-4 stack was the
opposite and equally unplanned. Focus containment is tech-debt #67;
this doc's matrix is otherwise unchanged.
