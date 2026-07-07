# SDE Task T1 — FR-1: Player controls-mode logic + shared form-factor helper

Feature: **v1.22.0 "Player Parity + Roadmap"** — branch `feature/v1.22-player-parity` (off `main` at v1.21.0).
Exec plan (READ the `## Design (FR-1)` section in full first): `docs/exec-plans/active/2026-07-08-v1.22-player-parity.md`.
Coding standards (READ): `docs/CONTRIBUTING.md`.

This is the **TOP-PRIORITY** regression fix and the **HEAVIEST-gated** item of the round.
It is the client **foundation**: FR-7 (T-F) and FR-8 (T-G) depend on the helpers you add here.

## Context / root cause

v1.21.0 removed the native `controls` attribute from the single shared
`<video id="media-player">` app-wide and replaced it with the custom
`#player-controls` bar for every viewport + media type. On **mobile VIDEO**
that is a regression (tap-unfriendly bar, unreliable fullscreen, no
speed/download/AirPlay/PiP, and a press-and-hold-2x text-selection glitch).
Fix = a responsive control-surface split: **mobile video → native `controls`**,
everything else keeps the v1.21 custom bar. Only `public/js/player.js` changes
in THIS task (the CSS half is task T2 — do NOT touch `style.css`).

## Scope — ONLY `public/js/player.js` + a new unit test

Implement exactly the mechanism in the exec plan's `## Design (FR-1)` → "Component changes":

1. **Pure form-factor helper (new, exported):** `resolveMobileFormFactor(signals)`
   returns a boolean from EXPLICIT signals (no DOM), so it is `node:test`-able:
   - Primary: `signals.coarsePointer && signals.noHover` → mobile.
   - Fallback (ONLY when `coarsePointer`/`noHover` are `undefined`, i.e. old
     browsers): use `signals.narrowViewport` (width).
   - Browser wrapper `isMobileFormFactor()` reads `window.matchMedia`
     `(pointer: coarse)`, `(hover: none)`, `(max-width: 768px)`; detect an
     unsupported query via `mql.media === 'not all'` → pass `undefined`; delegate
     to the pure helper.
2. **Pure control-surface helper (new, exported):** `resolveControlsMode(mediaType, isMobile)`
   → `'native'` iff `mediaType === 'video' && isMobile`, else `'custom'`.
   State-independent (two-argument lookup — keep it clean for the AC10 table test).
3. **Impure applier (new):** `applyControlsMode()` reads `isMobileFormFactor()` +
   `currentData.type`, then `host.classList.toggle('ff-mobile', mobile)` and sets
   the `controls` attribute iff `resolveControlsMode(...) === 'native'` **AND**
   `state === STATE_FULL` (the `&& FULL` clause is the AC9 dock-suppression).
   Call `applyControlsMode()` from **`mountInSlot()`** and **`dock()`** (the
   synchronous reparent/state-transition points — no src/currentTime change, no
   restart). Add `mediaPlayer.removeAttribute('controls')` to
   `teardownMediaState()` (belt-and-suspenders).
4. **Exports:** add `resolveMobileFormFactor` and `resolveControlsMode` to the
   existing `module.exports` block.

**LEAVE UNTOUCHED:** `wireSkipHoldGestures(mediaPlayer)` (already correctly wired,
coexists with native controls) and `isMobileViewport()` (its two callers gate
desktop live-transcode + desktop autoplay — a different question). Do NOT modify
`wireHostListeners()`. Do NOT touch the `.audio-mode #media-player { pointer-events: none }`
rule's scope. Do NOT edit any HTML shell (no `controls` in markup).

## `.ff-mobile` contract you must honor (T2's CSS depends on it EXACTLY)

- Class `ff-mobile` toggled on the element the design calls `#player-wrapper`
  (the host). Confirm the host element whose `classList` you toggle; keep it
  consistent with the CSS selectors T2 will write:
  `#player-wrapper.ff-mobile:not(.audio-mode) .player-controls` and
  `#player-wrapper.ff-mobile.audio-mode #vol-bar/#mute-btn`. If the host id
  differs in the actual code, **report the exact id** so T2's selectors match.

## Tests (`test/unit/player-form-factor.test.js`, new)

- **AC1:** `resolveMobileFormFactor` — coarse+noHover → true; fine/hover → false;
  width fallback used ONLY when coarse/hover are `undefined`.
- **AC10:** `resolveControlsMode` four-way regression lock — `('video', true) → 'native'`;
  `('video', false)`, `('audio', true)`, `('audio', false)` → `'custom'`. This
  locks the byte-identical cases so a future edit cannot silently flip one to native.

## Acceptance criteria owned: AC1, AC7, AC8, AC9, AC10, AC11 (js side)
Manual/on-device ACs (AC2–AC9 feel, AC11 CSS side, AC13) are Dean's iOS arbiter — out of your unit scope, but do not break them.

## Gate & reporting
- **Gate:** HEAVIEST two-reviewer/adversarial + Dean iOS on-device arbiter.
- Run Node 22 lint + tests and fix failures before reporting done.
- **Report back:** files changed, the exact host element id you toggled
  `.ff-mobile` on (T2 needs this), new helper signatures/exports, test output.

---
**Toolchain:** Node 22 at `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin` — prepend to PATH before any `npm`/`node`. Build: `npm ci`. Test: `npm test` (or `npm run test:unit`). Lint: `npm run lint` (0 warnings). Use absolute paths (cwd resets between bash calls).
**Git:** the COORDINATOR owns ALL git. Do NOT stage, commit, push, branch, or stash. Report files-changed + full lint/test output only.
