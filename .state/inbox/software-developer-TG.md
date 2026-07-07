# SDE Task TG — FR-8: Desktop cross-tab video + native Picture-in-Picture (Wave 5 — AFTER FR-1 & TF)

Feature: **v1.22.0 "Player Parity + Roadmap"** — branch `feature/v1.22-player-parity`.
Exec plan (READ `## Design (FR-2..FR-10)` → the `### FR-8` subsection): `docs/exec-plans/active/2026-07-08-v1.22-player-parity.md`.
Standards: `docs/CONTRIBUTING.md`.

**Wave 5. DEPENDS ON FR-1 (T1) and TF being integrated** (you edit `player.js`,
`watch.html`, `style.css` after both). You touch `public/js/player.js`, ALL FOUR
shells' `#player-host-template` (`public/index.html`, `public/setup.html`,
`public/watch.html`, `lib/ytdlp/views/subscriptions.html`), and
`public/css/style.css`. Do not start until the coordinator confirms Wave 4 integrated.

## Scope

**(a) Scope pause-on-hidden to mobile (AC55–AC57).** In
`shouldPauseForLifecycleEvent` (player.js:153) add `isMobile` to its `ctx` and
change the video branch so its terminal `return true;` becomes
`return !!ctx.isMobile;` (audio stays exempt via the earlier
`if (ctx.isAudio) return false;`). The call site `handleBackgroundLifecycle`
(player.js:552) adds `isMobile: isMobileFormFactor()` to `ctx` — **REUSE FR-1's
`isMobileFormFactor` helper (AC78), do NOT introduce a second signal.** Desktop
video now keeps playing across tab switches (AC56); mobile "smart" behavior is
byte-identical (AC57). Unit-test the new `shouldPauseForLifecycleEvent` signature
(desktop-video → false; mobile-video → true; audio → false either way).

**(b) Native PiP (AC58–AC60).** Add `<button id="pip-btn" class="pc-btn pip-btn">`
to `#player-controls` in the `#player-host-template`, placed after `#fs-btn`.
**The `#player-host-template` is byte-identical across ALL FOUR shells — the button
MUST be added identically to all four** (a byte-identical-sync checklist item;
this is the ONE FR this round that re-opens the shells). Wire ONCE in
`wireHostListeners()` (rides the persistent host across FULL/DOCKED/CLOSED).
Feature-detect via `document.pictureInPictureEnabled`: hide the button when false
or when in `.audio-mode` — no dead/inert button (AC58). Handler toggles
`mediaPlayer.requestPictureInPicture()` / `document.exitPictureInPicture()`. PiP
is independent of the in-app dock (AC60). Small `.pip-btn` CSS (era tokens).

## Tests (unit)
The new `shouldPauseForLifecycleEvent` signature (desktop-video false / mobile-video
true / audio false). Optionally a shell-parity assertion that `#pip-btn` exists
identically in all four `#player-host-template`s (mirror the existing shell-parity
test posture).

## Acceptance criteria owned: AC55, AC56, AC57, AC58, AC59, AC60, AC61, AC78.
PiP feel (AC59/AC60/AC61) = Dean's desktop-browser on-device arbiter.

## Gate & reporting
- **Gate:** light-to-medium + Dean desktop on-device arbiter.
- Run Node 22 tests + lint; fix failures. **Report:** files changed, an explicit
  four-shell byte-identical-sync confirmation for `#pip-btn`, test output.

---
**Toolchain:** Node 22 at `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin` — prepend to PATH. Test: `npm test`. Lint: `npm run lint`. Absolute paths.
**Git:** COORDINATOR owns ALL git. Do NOT commit. Report files-changed + test/lint output only.
