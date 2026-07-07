# Software Developer inbox — T8 (v1.21 FR-9: theatre mode)

Feature: **v1.21.0 "The Polish Release"** (feature_id `v1.21-polish-release`),
branch `feature/v1.21-polish-release` (off `main` at v1.20.0). This file
**supersedes any prior-feature content.** This is **Task T8**, **Wave 7** (final)
— runs ALONE. **Depends on T6** (shares `watch.js`) and shares `watch.html` with
T2 and `style.css` with the CSS chain. **Start only after the coordinator confirms
T6 and T7 are integrated.**

**Review tier: LIGHT.** Mostly desktop; Dean's on-device pass is the arbiter,
especially for mobile behavior.

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
  section **"FR-9 — theatre mode (LIGHT)"** plus **AC60–AC65**.
- `docs/CONTRIBUTING.md` (vanilla DOM, lint 0, no new deps).
- Live code: `public/watch.html` (the watch view / prev-next bar; T2's
  `#player-host-template` block is already integrated — DO NOT touch it),
  `public/js/watch.js` (watch `init()`; T6's delete-confirm branch is already
  landed — keep your edits additive), `public/css/style.css` (the
  `.watch-container`/`.watch-main`/`.watch-sidebar` rules and the existing
  `@media (max-width:1024px)` sidebar-stacking rule).

## Task — implement THIS ONE task only (FR-9)

1. **Toggle button (`watch.html`).** A "Theatre" button in the watch view (near
   the prev/next bar). Do NOT touch the `#player-host-template` block.
2. **Toggle logic (`watch.js`).** Clicking adds/removes a `theater-mode` class on
   `.watch-container` (inside `#view-root`). WATCH-VIEW layout class ONLY — the
   DOCKED mini-player (`#player-dock`, a separate host) is never affected (AC61).
   Optional persistence in `localStorage['ft-theater']`, applied on `init()`
   (AC63; no server setting).
3. **Layout (`style.css`, one labeled block `/* v1.21 FR-9: theatre mode */`).**
   At DESKTOP widths only, `theater-mode` widens `.watch-main`/player to the
   majority of page width and stacks `.watch-sidebar` below (AC60). Apply the
   theatre rules ABOVE the `@media (max-width:1024px)` breakpoint so the existing
   sidebar-stacking is untouched and mobile layout is unchanged; hide the toggle
   on phones (AC62/AC64). Era CSS vars only (AC70).

## Tests

None strictly required (layout/CSS + a small toggle). Run `npm run lint`
(0 warnings) and confirm the full `npm test` suite still passes on Node 22. If you
extract any pure helper (e.g. a persisted-preference read), add a `node:test`.

## File-ownership / serialization contract (STRICT — shared tree)

Sole running editor of `public/watch.html` (theatre button region), `public/js/watch.js`,
`public/css/style.css` this wave. Leave T2's `#player-host-template` and T6's
delete-branch code intact. Do NOT touch `common.js`, `main.js`, `player.js`,
`lib/ytdlp/**`, or any other shell.

## Report back

Files changed (path + one-line each); confirmation the DOCKED mini-player is
never affected and the `@media (max-width:1024px)` sidebar-stacking is untouched;
the mobile toggle-hidden/no-op treatment and the persistence behavior for Dean's
on-device pass; lint + Node 22 test result; any deviation/fork. Signal when T8 is
done/verified — this is the final implementation task.
