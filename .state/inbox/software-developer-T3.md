# Software Developer inbox — T3 (FR-4 watch-page autoplay + refinements)

Feature: **v1.17.0 "Polish"** (feature_id `v1.17-polish`), branch
`feature/v1.17-polish` off `main` (v1.16.0). This is **Task T3**. It runs in
**parallel** with T1/T2/T5/T6/T7. It touches `player.js` — coordinate mentally
with nothing else editing `player.js` right now (T4/FR-5 also lands in
`player.js` but is HELD/not started, so you have it to yourself).

Review tier: **LIGHTER single-QA**; Dean on-device for the resume-overlay-
suppression feel.

## Read first

- `.state/feature-state.json` — the `tasks` entry `"id": "T3"` is authoritative;
  read `hard_constraints` (FR-4 items — note autoplay stays OFF by default and the
  `currentTime=0`-on-`ended` reset applies to EVERY completed video, independent
  of the autoplay setting).
- `docs/exec-plans/active/2026-07-06-v1.17-polish.md` — read **`## Design` →
  `### FR-4 — Watch autoplay toggle + refinements`** in full, plus FR-4 ACs.
- `docs/CONTRIBUTING.md`.
- Code: `public/watch.html` (`.watch-prevnext` region ~56-123 — toggle goes
  here); `public/js/watch.js` (init/shell settings fetch, toggle wiring);
  `public/js/player.js` (`handleResumePlayback` ~412-432; `handleAutoplayNext`
  ~534-551; `wireHostListeners` `'ended'` listener ~577-580); `server.js`
  `GET`/`POST /api/settings` (~1722-1773, partial `KNOWN_KEYS` merge; `autoplayNext`
  already a validated known key — READ ONLY, no server change).

## Task — implement THIS ONE task only (FR-4)

**(a) Visible watch-page toggle.** Add a labelled checkbox/switch to
`public/watch.html` inside/next to `.watch-prevnext`. In `public/js/watch.js`
init, read the shell's already-fetched `GET /api/settings` and set the toggle
from `autoplayNext`; on change `POST /api/settings { autoplayNext: <bool> }`. The
server already does a partial merge of `KNOWN_KEYS`, and `autoplayNext` is the
same validated known key the Settings-page toggle writes — so both surfaces write
the SAME persisted field. Sync is by re-fetch on load (no shared client state);
each surface reflects the other on next load. **No server change.**

**(b) Suppress resume overlay ONLY on an autoplay-advanced load.** Add a
module-level one-shot flag in `player.js` (e.g. `autoplayAdvancePending`), set
`true` in `handleAutoplayNext` immediately before `window.FileTube.navigate(...)`.
Extract the decision as a **pure, unit-tested** helper
`shouldShowResumeOverlay({ savedProgress, autoplayAdvance })` returning
`savedProgress > 5 && !autoplayAdvance`, and consume it in `handleResumePlayback`.
When suppressed: skip the overlay and resume directly (set
`currentTime = savedProgress` if `>5`, then best-effort `play().catch()`), and
**consume/reset the flag** so it never leaks to the next, non-autoplay load. A
normal navigation to a video with saved progress still shows the overlay
unchanged (no regression).

**(c) Reset live position on `'ended'`.** In `wireHostListeners`' existing
`'ended'` listener, after the existing `saveProgressToServer(0)`, add:
`if (!liveMode && mediaPlayer) mediaPlayer.currentTime = 0;` (guarded off
`liveMode` because a live-transcode source is re-`src`'d, not seeked). This
applies to **every** completed video regardless of the autoplay setting.

## Hard constraints (non-negotiable)

- Autoplay stays **OFF by default**; the existing desktop-only initial-load
  autoplay posture (`isMobileViewport()` gate in `handleResumePlayback`) is
  **unchanged** — no mobile initial-load autoplay regression.
- Overlay suppression must be tied to the **autoplay-advanced load specifically**,
  NOT to reading the `autoplayNext` setting inside `handleResumePlayback` (a
  manual navigation while the setting is ON must still show the overlay). The
  one-shot flag set at the advance site is the required mechanism.
- `textContent` (not `innerHTML`) for the new toggle label / any new dynamic
  string. New CSS uses existing **era-theme tokens**. No new deps. 2-space/
  semicolons/single-quotes. Lint 0.
- No server change; reuse `GET`/`POST /api/settings` as-is.

## Tests

- `node:test` unit test for `shouldShowResumeOverlay({savedProgress,
  autoplayAdvance})` (all four combinations of `savedProgress >/<= 5` ×
  `autoplayAdvance true/false`).
- Settings round-trip: cover via the existing `/api/settings` integration test
  surface if practical (watch-page write is the same field as the Settings
  write); the `currentTime=0`-on-`ended` line is code-verified + Dean's [MANUAL]
  poster-frame check.

## Toolchain / commands

Node 22 is the standard. Before any npm/node command export the fnm node PATH,
then use the Node 22 test toolchain bin:
`/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`.
Run `npm run lint` (0 warnings) and `npm test`; fix any failure before reporting.

## Git — DO NOT commit

The **coordinator owns ALL git**. Do NOT stage, commit, or push. Report files
changed + full test/lint output; the coordinator commits per task.

## Report back

- Files changed (paths + one-line summary each), calling out the watch-page
  toggle, the `shouldShowResumeOverlay` helper + one-shot flag, and the
  `currentTime=0`-on-`ended` line.
- The helper unit test + Node 22 pass/fail output; lint result.
- Confirmation autoplay is still OFF by default and no server change was made.
- Any deviation from the design or new fork (with a recommendation).
