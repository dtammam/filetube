# Software Developer inbox — T7 (v1.21 FR-8: download retry + status chip)

Feature: **v1.21.0 "The Polish Release"** (feature_id `v1.21-polish-release`),
branch `feature/v1.21-polish-release` (off `main` at v1.20.0). This file
**supersedes any prior-feature content.** This is **Task T7**, **Wave 6** — runs
ALONE. **Depends on T3** (retry attaches to the rearchitected rows), **T5**
(shares `subscriptions.js`/`index.js`/`common.js`), and **T6** (shares
`common.js`). **Start only after the coordinator confirms T3, T5, T6 are
integrated.**

**Review tier: LIGHT-TO-MEDIUM** — reuses the existing
`GET /api/subscriptions/status` polling data (no new backend polling primitive);
one small additive server change for one-shot retry params.

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
  section **"FR-8 — download retry + status chip (LIGHT-TO-MEDIUM)"** plus
  **AC52–AC59** and the "Coordination with FR-2 dock (AC57)" note.
- `docs/ui-research-2026-07.md` §5 (unobtrusive persistent chip → expandable
  panel; completion auto-dismiss; errors sticky; retro beveled/segmented; on
  mobile coordinate with the audio mini-player so they don't overlap).
- `docs/CONTRIBUTING.md` (vanilla DOM, `textContent`, `node:test`, lint 0, no new
  deps).
- Live code: `lib/ytdlp/activity.js` (`getSnapshot`, the one-shot `LiveEntry`
  shape — currently `label`/`url` only), `lib/ytdlp/index.js` (`runOneShot`, the
  `POST /api/ytdlp/download` route, `classifySingleVideo`/validation path,
  `runSubscriptionCycle`'s `/repull`), T3's `createOneShotRow`/row rendering and
  the `nextPollDelay` backoff pattern in `lib/ytdlp/client/subscriptions.js`,
  `public/js/common.js` (the subscriptions-nav capability probe — mount the chip
  only when the module is enabled), `public/css/style.css` (T2's `#player-dock`
  positioning so the chip clears it).

## Task — implement THIS ONE task only (FR-8)

1. **Retry (AC52/AC53).** Subscription failure: contextual "Retry" on an errored
   row (or its settings sheet) calling the existing
   `POST /api/subscriptions/:id/repull` — no new endpoint. One-shot failure (the
   real gap): re-invoke by re-POSTing the SAME `POST /api/ytdlp/download` with the
   failed job's original `url/format/quality/filetype/folder`. Add
   `format`/`quality`/`filetype` to the ephemeral one-shot activity `LiveEntry`
   (written by the download route + `runOneShot`, small `index.js`/`activity.js`
   change) so the client can reconstruct the request. Retry is a NORMAL new
   one-shot through the SAME `classifySingleVideo`/validation path — no bypass, no
   new persisted retry endpoint.
2. **App-wide status chip (`common.js` component, AC54–AC58).** Fixed bottom-LEFT
   corner chip, mounted only when the module is enabled. Polls the existing
   `GET /api/subscriptions/status` at a slow app-wide cadence (reuse
   `nextPollDelay` backoff), hides when the snapshot is empty. Collapsed =
   "N downloading · X%"; tap expands to a per-item panel (name/%/state) with Retry
   on errored one-shots and Dismiss. Completed items auto-dismiss; errored stay
   sticky until acknowledged. Suppress the chip on `/subscriptions` (that page owns
   its inline status). All chip text via `textContent`.
3. **Coordination with FR-2 dock (AC57).** The chip is bottom-LEFT and clears both
   `#player-dock` (T2, lower-right) and the mobile bottom-nav so they never overlap
   on mobile. Styling in one labeled block `/* v1.21 FR-8: status chip */`, era
   tokens, beveled/segmented/striped progress, 1px borders.

## Tests to add

Unit (`test/unit/`): the one-shot retry payload reconstruction from the activity
entry (correct `url/format/quality/filetype/folder`); a pure chip-summary reducer
("N downloading · X%", auto-dismiss-completed vs. sticky-error). Integration where
practical for the additive activity fields + the retry re-POST path (stub the
spawn as the existing harness does; no real FFmpeg/network).

## File-ownership / serialization contract (STRICT — shared tree)

Sole running editor of `lib/ytdlp/client/subscriptions.js`, `lib/ytdlp/index.js`
(+ `activity.js`), `public/js/common.js`, `public/css/style.css` this wave. Keep
edits additive over T3/T5/T6's landed code. Do NOT touch `watch.js`, `main.js`,
`store.js`'s pin code, `player.js`, or the HTML shells. Label your `style.css`
block `/* v1.21 FR-8 */`.

## Report back

Files changed (path + one-line each); the one-shot activity fields added + the
retry re-POST mechanism (same validation path, no bypass); the chip's mount gate,
poll cadence, auto-dismiss/sticky rules, and dock-clearance positioning;
confirmation all chip text is `textContent` and no new backend polling primitive
was added; lint + Node 22 test result; any deviation/fork. Signal when T7 is
done/verified.
