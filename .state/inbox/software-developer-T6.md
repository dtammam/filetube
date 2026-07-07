# Software Developer inbox — T6 (v1.21 FR-7: deliberate delete for local files)

Feature: **v1.21.0 "The Polish Release"** (feature_id `v1.21-polish-release`),
branch `feature/v1.21-polish-release` (off `main` at v1.20.0). This file
**supersedes any prior-feature content.** This is **Task T6**, **Wave 5** — runs
ALONE. No logical dependency, but you share `common.js` with T5 and `style.css`
with the CSS chain, so **start only after the coordinator confirms T5 is
integrated.** **T6 blocks T8** (shares `watch.js`).

**Review tier: HEAVY two-reviewer gate (destructive-action class).** Adversarial
review must confirm the yt-dlp-vs-local detection signal can NEVER fail toward
LESS delete friction than today.

## Environment

- **Node 22 toolchain bin** (prepend to PATH before any npm/node command):
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- Use absolute paths (cwd resets between bash calls).

## Git — DO NOT commit

The **coordinator (EM) owns ALL git.** Do NOT `git add`/`commit`/`branch`/
`stash`/`push`. Report exact files changed + full `npm run lint` (0 warnings) and
`npm test` (Node 22) output. Fix any failure before reporting done.

## Read first (you share NO memory with the EM)

- `docs/exec-plans/active/2026-07-08-v1.21-polish-release.md` — the **## Design**
  section **"FR-7 — extra-deliberate delete for local files (HEAVY, destructive)"**
  plus **AC45–AC51**.
- `docs/CONTRIBUTING.md` (`textContent` over `innerHTML` — LOAD-BEARING here; the
  new modal must use `textContent`, not the existing modal's `innerHTML`; `node:test`,
  lint 0, no new deps).
- Live code: `public/js/common.js` (the existing `showConfirmModal`; where helpers
  are exported for `node:test`), `public/js/watch.js` (the `deleteBtn` handler and
  `mediaData` from `GET /api/videos/:id`), `public/js/main.js` (the v1.17.0 two-tap
  card-arm delete and its item from `GET /api/videos`). Confirm both surfaces
  already carry `channelUrl`/`channelId`/`channelName` (v1.20 FR-2, spread via
  `...item`) and that `DELETE /api/videos/:id` (+ `removeAnyway`/409) is unchanged.

## Task — implement THIS ONE task only (FR-7)

1. **Pure fail-safe predicate (`common.js`, exported for tests).**
   `isYtdlpManagedItem(item)` → `true` ONLY when a non-empty
   `item.channelUrl` (or `channelId`/`channelName`) string is present; every
   absence/ambiguity (incl. every pre-v1.20 local file) → `false` → treated as
   LOCAL/irreplaceable (AC45/AC50). Never throws on missing/malformed item.
2. **Shared escalated confirm (`common.js`).** `showHardDeleteModal(item,
   onConfirm)` — visually/interactionally DISTINCT from `showConfirmModal`: a
   red hard-warning modal whose Delete button is DISABLED until an "I understand
   this file cannot be recovered" checkbox is ticked (a conscious extra action,
   AC46). Build all text via `textContent` (path/title XSS-safe).
3. **Watch page (`watch.js`).** Branch on `isYtdlpManagedItem(mediaData)`:
   yt-dlp → existing `showConfirmModal` (UNCHANGED, AC47); local →
   `showHardDeleteModal` (AC49).
4. **Card (`main.js`).** Two-tap arm stays the yt-dlp path (UNCHANGED); for a
   local file the confirming second tap opens `showHardDeleteModal` instead of
   deleting immediately (tap → arm → tap → hard-confirm = conscious 3rd action,
   AC49).
5. **Styling (`style.css`)** — one labeled block `/* v1.21 FR-7: hard-delete
   modal */`, era tokens, distinct (red) hard-warning treatment.

`DELETE /api/videos/:id` and its `removeAnyway`/409 read-only path stay unchanged
(AC48) — this is a client confirm-flow escalation ONLY.

## Tests to add

Unit (`test/unit/`): `isYtdlpManagedItem` — true on non-empty channelUrl/channelId/
channelName; false on all-absent (pre-v1.20 local), empty strings, null/malformed,
no throw; assert it can only ADD friction (absence → local). Integration where
practical for the branch wiring.

## File-ownership / serialization contract (STRICT — shared tree)

Sole running editor of `public/js/common.js`, `public/js/watch.js`,
`public/js/main.js`, `public/css/style.css` this wave. Keep `common.js` and
`watch.js` edits additive (T7 serializes after you on `common.js`; T8 after you on
`watch.js`). Do NOT touch `lib/ytdlp/**`, `player.js`, or the HTML shells.

## Report back

Files changed (path + one-line each); `isYtdlpManagedItem` signature + the
fail-safe truth table; confirmation the modal uses `textContent` (not `innerHTML`),
yt-dlp flows are byte-unchanged, and `DELETE /api/videos/:id` is untouched; the
"predicate can only add friction, never remove it" adversarial note; lint + Node
22 test result; any deviation/fork. Signal when T6 is done/verified so the
coordinator can schedule Wave 6 (T7) and Wave 7 (T8).
