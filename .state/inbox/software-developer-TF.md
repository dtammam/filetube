# SDE Task TF — FR-7: Loop / repeat toggle (Wave 4 — AFTER FR-1)

Feature: **v1.22.0 "Player Parity + Roadmap"** — branch `feature/v1.22-player-parity`.
Exec plan (READ `## Design (FR-2..FR-10)` → the `### FR-7` subsection): `docs/exec-plans/active/2026-07-08-v1.22-player-parity.md`.
Standards: `docs/CONTRIBUTING.md`.

**Wave 4. DEPENDS ON FR-1 (T1) being integrated** — you edit `player.js` after
T1, and BEFORE T-G. You touch `public/js/player.js`, `public/watch.html`,
`public/js/watch.js`, `public/css/style.css`. Do not start until the coordinator
confirms Wave 3 integrated.

## Coordinator decision (do not reopen)
Persist via **`localStorage`** (theatre-mode pattern), NOT a server `db.settings`
setting — loop is a watch-page-local preference.

## Scope
1. **Pure decision helper (AC49, exported for unit test):**
   `resolveEndedAction({ loop, autoplayNext, hasNext })` → `'repeat' | 'advance' | 'stop'`;
   `loop === true` ALWAYS yields `'repeat'` regardless of `autoplayNext` (loop
   takes precedence).
2. **Storage:** `isLoopEnabled()` reads `localStorage['ft-loop'] === '1'` (guarded
   try/catch, like the existing `ft-volume`/`ft-theater` reads); `setLoop(on)` writes it.
3. **Behavior in `player.js`'s `'ended'` cluster:** add a loop listener that
   replays THIS item when loop is on — `if (liveMode) startLiveStream(0, true);
   else { mediaPlayer.currentTime = 0; mediaPlayer.play(); }` (mirrors
   `resumeNoBtn`'s restart, AC51). Gate the existing `handleAutoplayNext`
   (player.js:996) with an early `if (isLoopEnabled()) return;` so loop
   short-circuits BEFORE autoplay-advance (AC49 precedence). Loop OFF → existing
   `handleAutoplayNext` + reset-to-0 behave EXACTLY as today (AC50).
   State-independent of FULL/DOCKED (AC53).
4. **Toggle UI:** a watch-page button near the v1.17 autoplay toggle / prev-next
   (`watch.html`), wired by a new `setupLoopToggle()` in `watch.js` mirroring
   `setupAutoplayToggle` but writing `localStorage` (not `/api/settings`). Reuse
   the autoplay-toggle CSS class (era tokens; likely NO new CSS — only add a
   `style.css` rule if genuinely needed).
5. Export `resolveEndedAction` from `player.js`.

## Tests (unit)
`resolveEndedAction`: `loop:true` → `'repeat'` (both autoplay values, both hasNext
values); `loop:false, autoplayNext:true, hasNext:true` → `'advance'`;
`loop:false, autoplayNext:false` → `'stop'`; etc.

## Acceptance criteria owned: AC48, AC49, AC50, AC51, AC52, AC53, AC54.

## Gate & reporting
- **Gate:** light.
- Run Node 22 tests + lint; fix failures. **Report:** files changed, the
  `resolveEndedAction` table, test output.

---
**Toolchain:** Node 22 at `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin` — prepend to PATH. Test: `npm test`. Lint: `npm run lint`. Absolute paths.
**Git:** COORDINATOR owns ALL git. Do NOT commit. Report files-changed + test/lint output only.
