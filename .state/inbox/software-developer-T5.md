# Software Developer inbox — T5 (FR-6 stuck one-off download modal)

Feature: **v1.17.0 "Polish"** (feature_id `v1.17-polish`), branch
`feature/v1.17-polish` off `main` (v1.16.0). This is **Task T5** (supersedes any
prior v1.16 content in this file). It runs in **parallel** with T1/T2/T3/T6/T7.

Review tier: **TWO-REVIEWER GATE** — the modal-teardown fix must not reintroduce
an `innerHTML`/XSS surface; it gets adversarial review.

## Read first

- `.state/feature-state.json` — the `tasks` entry `"id": "T5"` is authoritative;
  read `hard_constraints` (FR-6 item — preserve DOM-node/`textContent`
  construction, no `innerHTML`).
- `docs/exec-plans/active/2026-07-06-v1.17-polish.md` — read **`## Design` →
  `### FR-6 — Stuck one-off download modal teardown`** in full (the root cause is
  already confirmed there), plus FR-6 ACs.
- `docs/CONTRIBUTING.md`.
- Code: `public/js/common.js` — `buildOneOffModal` (~933), `decideOneOffTerminalAction`
  (~1036), `closeModal` (~1135-1141), and `openModal`/`modalState`/`currentJobId`/
  `stopPolling`/the once-bound `keydown` Esc handler; the `textContent`-not-
  `innerHTML` comment (~844). `public/css/style.css` — `.oneoff-modal-backdrop`
  (`display:flex`, ~1629) and the `.playlists-sheet-backdrop :not([hidden])`
  precedent (~2025).

## Task — implement THIS ONE task only (FR-6)

**Root cause (confirmed in the design):** `.oneoff-modal-backdrop` sets
`display: flex` with **no `[hidden]` override**, so an author `display` rule beats
the UA `[hidden] { display:none }`. `backdrop.hidden = true` (the whole teardown
in `closeModal`) therefore does NOT hide the full-viewport `position:fixed`
`z-index:2100` overlay — it stays painted and eats every touch; the page reads
dimmed and dead.

**Fix (two parts, ONE teardown path):**

1. **CSS source fix** in `public/css/style.css`: add
   `.oneoff-modal-backdrop[hidden] { display: none; }` (or fold the `display:flex`
   into `.oneoff-modal-backdrop:not([hidden])`, matching the
   `.playlists-sheet-backdrop` precedent). The attribute selector out-specifies
   the base rule — **no `!important`**.
2. **Harden `closeModal` into a full teardown** shared by ALL dismiss paths
   (backdrop tap, `[x]`, Esc, and the `done` auto-close): remove the backdrop node
   from the DOM (`backdrop.remove()`), `stopPolling()`, and null `currentJobId`
   **and** `modalState` so `openModal` rebuilds fresh next time (the once-bound
   `keydown` Esc handler already guards on `modalState &&`, so nulling it makes
   that handler an inert no-op). One implementation, not divergent submit-vs-
   dismiss paths.

**Preserve** the existing `createElement`/`textContent` DOM construction — do NOT
introduce any `innerHTML`.

## Hard constraints (non-negotiable)

- **No `innerHTML` introduced** anywhere in changed/new code (XSS surface). No
  `!important` for the `[hidden]` override.
- One teardown code path used by backdrop tap, `[x]`, Esc, and `done` auto-close.
- Do NOT change the one-off download endpoint's validation or the submit-then-
  close happy path (only the dismiss-without-submit teardown + the CSS override).
- No new runtime dependencies. 2-space/semicolons/single-quotes. Lint 0.

## Tests

- `node:test` unit test using the existing fake-`document` / DOM-injectable
  pattern (`buildOneOffModal` is already injectable): assert that after a
  backdrop-dismiss-**without-submit**, the backdrop node is detached from the DOM
  and `modalState` is reset (and no dangling listeners / stuck overlay class). If
  an explicit close affordance exists/added, assert it hits the SAME teardown.

## Toolchain / commands

Node 22 is the standard. Before any npm/node command export the fnm node PATH,
then use the Node 22 test toolchain bin:
`/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`.
Run `npm run lint` (0 warnings) and `npm test`; fix any failure before reporting.

## Git — DO NOT commit

The **coordinator owns ALL git**. Do NOT stage, commit, or push. Report files
changed + full test/lint output; the coordinator commits per task.

## Report back

- Files changed (paths + one-line summary each), calling out the CSS `[hidden]`
  override and the hardened single-path `closeModal` teardown.
- The teardown unit test + Node 22 pass/fail output; lint result.
- Explicit confirmation that NO `innerHTML` was introduced and the DOM-node
  construction is preserved.
- Any deviation from the design or new fork (with a recommendation).
