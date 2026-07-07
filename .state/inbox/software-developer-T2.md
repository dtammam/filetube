# SDE Task T2 — FR-1: Responsive-controls CSS + text-selection fix + mute-slash nit

Feature: **v1.22.0 "Player Parity + Roadmap"** — branch `feature/v1.22-player-parity`.
Exec plan (READ `## Design (FR-1)`, esp. "The `.ff-mobile` class is the single source of truth", and the "Mute '/' slash mis-position nit" note): `docs/exec-plans/active/2026-07-08-v1.22-player-parity.md`.
Standards: `docs/CONTRIBUTING.md`.

**HEAVIEST-gated** (Dean iOS arbiter). Pairs with T1 (player.js). This task is the
CSS half of FR-1 and touches **ONLY `public/css/style.css`**.

## Contract from T1 (frozen in the design)
T1 sets `.ff-mobile` on the player host (`#player-wrapper` in the design; if T1
reports a different host id, use that) from the SAME `isMobileFormFactor()` call
that toggles the native `controls` attribute. Your CSS is purely REACTIVE to that
class + the existing `.audio-mode` class. Do NOT add a second "is-mobile" media
query for bar visibility — the `.ff-mobile` class is the single source of truth.

## Scope — add ONE new section to `style.css`, plus the mute-slash tweak

Add a `/* === v1.22 FR-1: responsive controls === */` section:

```css
/* AC6 — press-hold-2x must not select text / raise the iOS callout.
   Applied to the gesture surfaces, NOT the native control strip. */
#media-player,
#audio-bg-art,
.skip-controls,
.speed-badge {
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

/* AC4 — mobile VIDEO: native controls own the strip; hide the custom bar.
   :not(.audio-mode) keeps the bar for mobile AUDIO. */
#player-wrapper.ff-mobile:not(.audio-mode) .player-controls {
  display: none;
}

/* AC3 — mobile AUDIO: keep the custom bar, drop volume + mute
   (hardware buttons make them redundant; matches today's iOS degrade). */
#player-wrapper.ff-mobile.audio-mode #vol-bar,
#player-wrapper.ff-mobile.audio-mode #mute-btn {
  display: none;
}
```
Verify the actual selector names in `style.css` (`.player-controls` / `#player-controls`,
`#vol-bar`, `#mute-btn`, `#audio-bg-art`, `.skip-controls`, `.speed-badge`) and
match them exactly. Do NOT modify the v1.21 FR-2 section. Do NOT touch the
existing `@media (max-width: 768px)` block (it now governs the mobile-audio bar).

**Folded-in mute-slash nit:** the muted-state diagonal slash is
`.mute-icon-off::after` (~style.css:2940) — currently `left: 1px; top: 0;
transform-origin: top left; transform: rotate(45deg)`, which places the slash too
far left of the speaker glyph's optical center (Dean's report). Shift it right
and/or re-anchor (`transform-origin`/small `translate`) so the diagonal crosses
the speaker center — a 1–3 line VALUE tweak, `currentColor` only. Exact pixel
value is Dean's visual arbiter; make a reasonable centered value and report it.

## Constraints
- **No color tokens touched, no new hardcoded colors** (AC12) — display/`user-select`/
  transform values only; era-theme token system preserved.

## Acceptance criteria owned: AC3, AC4, AC6, AC12, mute-slash nit. (Feel = Dean iOS arbiter.)

## Gate & reporting
- **Gate:** HEAVIEST two-reviewer/adversarial + Dean iOS arbiter.
- Run Node 22 lint before reporting done. **Report:** files changed + the exact
  mute-slash values you chose (Dean will confirm on-device).

---
**Toolchain:** Node 22 at `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin` — on PATH before `npm`/`node`. Lint: `npm run lint`. Absolute paths (cwd resets between bash calls).
**Git:** COORDINATOR owns ALL git. Do NOT commit. Report files-changed + lint output only.
