# T4 — G1 Zak Goldin + F1 avatars on the watch page (v1.24, Wave 1)

**Cluster G/F · FR G1, F1 · Gate: light · Depends on: T3 (deriveAvatar export)**

Context + design: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` "Clusters E/F/G" G1 + F1; `## Task breakdown` T4).

## Files you own (edit ONLY this)
- `public/js/watch.js` — SOLE `watch.js` owner in Wave 1.

## Scope
- **G1 Zak Goldin:** a pure weighted-selection helper picking Zak Goldin
  comments at **87% polite / 10% unhinged / 3% conspiracy-about-the-video**,
  layered over the existing `getMockInitialComments()` `commentBank` (~L864–995)
  deterministic per-`mediaId` pick (`seed + i*7 % length`). Preserve the
  existing deterministic selection guarantee for the REST of `commentBank` over
  a large deterministic sample. Tasteful/funny, not mean-spirited, consistent
  with the retro-comment tone.
- **F1 avatars:** replace the first-letter uppercased avatar
  (`#uploader-avatar-letter` ~L143 and `.comment-avatar` ~L828) with a
  generated avatar via **`common.js`'s `deriveAvatar`**, applying the
  precedence: use `item.channelAvatarUrl` when present, else `deriveAvatar`.
  Building the precedence now means C6 (T11, Wave 3) only POPULATES
  `channelAvatarUrl` later and never re-touches `watch.js`.

## Frozen cross-file contracts
- Call `deriveAvatar(name)` from `common.js` (T3 exports it — confirm the exact
  name with the coordinator; do NOT redefine it in `watch.js`).
- `channelAvatarUrl` (string URL or null) is null until T11 (Wave 3); the
  precedence must gracefully fall back to `deriveAvatar` when it is absent.

## Acceptance criteria (exec-plan G1, F1)
- [UNIT][G] weighted helper hits the 87/10/3 distribution over a large
  deterministic sample AND preserves the existing per-`mediaId` determinism for
  the rest of `commentBank`.
- [PROCESS][G] `common.js`'s `getMockViews`/`getMockSubCount`/`getCommentCount`
  are untouched (confirmed seam).
- [UNIT][F] `deriveAvatar` usage is deterministic (same name → same avatar).
- [MANUAL][G/F] Zak Goldin reads tasteful/funny; the same channel shows the same
  generated avatar on the watch page + comments (real captured avatar, when C6
  lands, overrides it).

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). New pure helpers get
  `node:test` coverage + a regression lock.
- **Standards:** CommonJS, 2-space/semicolons/single-quotes, vanilla DOM,
  `textContent` over `innerHTML`, no new runtime deps.
- **Ownership:** edit ONLY `public/js/watch.js`. Need another file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
