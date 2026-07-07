# Software Developer inbox — T2 (FR-3 quicker delete flow)

Feature: **v1.17.0 "Polish"** (feature_id `v1.17-polish`), branch
`feature/v1.17-polish` off `main` (v1.16.0). This is **Task T2**. It runs in
**parallel** with T1/T3/T5/T6/T7.

Review tier: **TWO-REVIEWER GATE** — this touches the delete endpoint's contract
(reuse only) and adds a net-new client delete path; it gets adversarial review.
Do NOT change `server.js` or the `DELETE /api/videos/:id` contract.

## Read first

- `.state/feature-state.json` — the `tasks` entry `"id": "T2"` is authoritative;
  also read `hard_constraints` (FR-3 items) and `cross_cutting`.
- `docs/exec-plans/active/2026-07-06-v1.17-polish.md` — read **`## Design` →
  `### FR-3 — Quicker delete`** in full, plus the FR-3 acceptance criteria.
- `docs/CONTRIBUTING.md` (vanilla DOM, `textContent` not `innerHTML`, `node:test`,
  lint 0, no new deps).
- Code: `public/js/watch.js` (the `deleteBtn` handler, ~605-631, incl. the
  pre-delete `showConfirmModal('Confirm Permanent Deletion', ...)` guard and the
  post-success `alert('File deleted successfully.')`); `public/js/common.js`
  (home of `showConfirmModal` and the one-off modal — where `showToast` lands);
  `public/js/main.js` `renderMediaGrid` (~295-339) and its existing AbortSignal
  delegated-listener pattern; `server.js` `DELETE /api/videos/:id` (~1945) and its
  `EROFS`/`EACCES` → `409` + `removeAnyway` contract (READ ONLY — do not change).

## Task — implement THIS ONE task only (FR-3)

**(a) Watch-page success alert → toast.** In `public/js/watch.js` remove
`alert('File deleted successfully.')` from the DELETE-success branch and replace
it with `showToast('File deleted.')`. **Keep** the pre-delete
`showConfirmModal('Confirm Permanent Deletion', ...)` guard exactly as-is (it is
a legitimate are-you-sure step, NOT the friction being removed). Leave the error
branches' `alert(...)` as-is (out of scope).

**New `showToast(msg)` helper in `public/js/common.js`.** Appends a `.toast` node
to `document.body` using **`textContent` only** (no `innerHTML`), auto-dismisses
on a ~2.5s timer with a token-themed fade, then removes the node. Non-blocking,
no user interaction required. Add `.toast` CSS in `public/css/style.css` using
**era tokens only** (e.g. `--bg-sidebar`/`--text-primary`/`--shadow-lg`/
`--radius`) — no hardcoded colors.

**(b) Card trash-can (net-new on home/library cards).** In `public/js/main.js`
`renderMediaGrid`, add a trash affordance to each `.video-card`
(`<button class="card-delete-btn" data-id="..." aria-label="Delete"><i
class="icon-delete"></i></button>`, positioned over the thumbnail via CSS). Wire
a **single delegated** click listener on `#video-grid` (NOT per-card — the grid
re-renders), bound through the file's existing AbortController pattern. Drive
arm/disarm with a **pure, unit-tested reducer**:

- `nextArmState(current, action)` where `current` ∈ `'idle'|'armed'`, `action` ∈
  `'tap'|'disarm'`: `idle+tap -> {state:'armed', deleted:false}`;
  `armed+tap -> {state:'idle', deleted:true}`; `*+disarm -> {state:'idle',
  deleted:false}`.

The DOM layer toggles an `.armed` class (revealing an inline "Sure?" affordance
via CSS/`textContent`), starts a ~3s auto-disarm timer, and disarms on any
document `click`/`scroll` outside the armed button. **Only a `deleted:true`
result fires the network call.**

**Delete call — reuse `DELETE /api/videos/:id` EXACTLY** (no new endpoint, no
contract change): on `{success:true}` remove the card from the DOM (or trigger the
existing SPA library refresh) and `showToast('File deleted.')`; on `409`
(`{readOnly:true}`) surface a toast that the file is on a read-only mount — the
`removeAnyway` follow-up UI stays **out of scope**, so the card path must NEVER
send `removeAnyway` without having first seen a `409`; on other errors, an error
toast.

## Hard constraints (non-negotiable)

- **No change to `server.js` or the delete endpoint's behavior/validation/auth
  posture** (success, 404, 500, and the `409`+`removeAnyway` path stay exactly as
  they are; existing tests for them stay green, never weakened).
- The pre-delete "Confirm Permanent Deletion" modal is unchanged.
- `textContent` (not `innerHTML`) for ALL new dynamic strings (toast text, arm
  labels). No new runtime dependencies. 2-space/semicolons/single-quotes. Lint 0.
- New CSS uses existing **era-theme tokens** only.
- One AbortSignal-bound delegated listener on `#video-grid`; arm state on the DOM
  node + a single timer, reset on re-render (no double-fire / leak across
  re-render).

## Tests

- `node:test` unit test for `nextArmState` covering: `idle→armed` on first tap
  (no delete), `armed→delete` on second tap, and a disarm path (outside tap /
  timeout) that never deletes.
- Keep the existing `DELETE /api/videos/:id` integration tests green (extend, do
  not weaken, if you touch them).

## Toolchain / commands

Node 22 is the standard. Before any npm/node command export the fnm node PATH
(per repo convention), then use the Node 22 test toolchain bin:
`/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`.
Run `npm run lint` (0 warnings) and `npm test`; fix any failure before reporting.

## Git — DO NOT commit

The **coordinator owns ALL git**. Do NOT stage, commit, or push. Report files
changed + full test/lint output; the coordinator commits per task.

## Report back

- Files changed (paths + one-line summary each), calling out the new `showToast`
  helper, the `.toast` CSS, and the card trash affordance + `nextArmState`.
- The `nextArmState` unit test + Node 22 pass/fail output; lint result.
- Confirmation that `server.js` / the delete endpoint contract were NOT touched
  and that the card path never sends `removeAnyway` pre-`409`.
- Any deviation from the design or new fork (with a recommendation).
