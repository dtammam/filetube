# Roadmap reconcile + a way back from /diag (v1.311.1)

Branch `docs/roadmap-reconcile`, base `eba2ce8f` (main, v1.311.0).

## Intake (Dean, 2026-09-22)

1. Walk ROADMAP.md's Planned list against git; close what is done, talk out the rest.
   Dean's rulings on the talked-out items: mobile `#fs-btn` offset - fixed;
   subscriptions page oversized on mobile - no longer a problem; v1.22.0 FR-2
   folder-match hardening - not a problem; v1.20.0 channel-capture edges #16/#18 -
   not a problem.
2. "For the diag page, there's no way to go back from it."

## Acceptance

- **A1** Planned holds no open item; every former Planned item sits under Resolved
  (in its matching category) with a dated reason: evidence from git for the ones
  found done (favicon `.ico` shipped v1.24.0 `2367c49e`; yt-dlp #12-14 tracker rows
  read "accepted narrow limitation"; channel-capture #17 closed v1.29.0 T3a), and
  "per Dean" for the four he ruled on. The original item text is kept verbatim.
- **A2** The disregarded mini-player item under Resolved is checked (`[x]`); no
  `- [ ]` remains anywhere in ROADMAP.md.
- **A3** `/diag` shows a visible "Back to Settings" link above its heading that
  navigates THIS tab to `/setup.html#experimental`, which opens the Experimental
  section via the v1.305 `#<collapse-key>` handler (`common.js` `selectFromHash`).
  Cause: Settings opens `/diag` with `target="_blank"` and the page has no nav, so
  the installed PWA (no browser chrome) is stranded there.
- **A4** `/diag` links the same icon set as the app shells (svg, 192/512 png,
  multi-res `.ico`, apple-touch-icon); it was the only page with none.
- **A5** `test/unit/diag-page-nav.test.js` binds A3 + A4 (comment-stripped read) and
  the deep-link target's existence; mutants of the link and the `.ico` go red.

## Out of scope

- No change to how Settings opens `/diag` (still a new tab - the in-app REC badge
  workflow depends on the app staying open in the other tab).
- No new text on the diag page beyond the link; no server or route change.

## Attack surfaces for the gate

- ROADMAP claims vs the tree/tracker/git: is each "done/accepted" citation true?
- Does `/setup.html#experimental` actually open the section on a FULL page load
  (the diag link is a cross-page nav, not an SPA nav)? Is the section ever hidden
  for the user who can reach `/diag` (the diag route's gate vs the section's gate)?
- Do the new icon links / link style break any census, CSP, or shell-parity test
  that enumerates `public/*.html` (diag.html is a declared NON-shell page)?
- Is the new test vacuous anywhere (presence-not-binding)?

## Gate

