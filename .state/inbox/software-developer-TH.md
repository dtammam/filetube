# SDE Task TH — FR-9: Card-level download-to-device (Wave 6)

Feature: **v1.22.0 "Player Parity + Roadmap"** — branch `feature/v1.22-player-parity`.
Exec plan (READ `## Design (FR-2..FR-10)` → the `### FR-9` subsection): `docs/exec-plans/active/2026-07-08-v1.22-player-parity.md`.
Standards: `docs/CONTRIBUTING.md`.

**Wave 6.** You touch `public/js/main.js` + `public/css/style.css`. Do not start
until the coordinator confirms Wave 5 integrated (main.js/style.css serialization).

## Context
The watch-page download-to-device button shipped v1.19.0 (`?download=1` on
`/video/:id`, `Content-Disposition` header-injection-safe). Add the same
affordance on home/library cards, reusing the EXISTING route (no new server route).

## Scope
1. **`main.js` card template (main.js:410):** add a `.card-download-btn` overlay
   anchor as a **SIBLING** of `.thumbnail-container`'s `<a>` (NEVER nested inside
   it, so it cannot trigger watch-page navigation — AC64), mirroring the existing
   `.card-delete-btn` overlay placement + event-isolation pattern:
   `<a class="card-download-btn" href="/video/${encodeURIComponent(item.id)}?download=1"
   download="${escaped title+ext}" aria-label="Save to device">…</a>`. Reuse the
   EXISTING `?download=1` route unchanged (AC63) — source-agnostic, works for
   yt-dlp AND local items (AC66). `href` id via `encodeURIComponent`; the
   `download` filename hint escaped (AC65); `textContent`/`.href`-safe, no `innerHTML`.
2. **`style.css`:** small `.card-download-btn` block mirroring `.card-delete-btn`
   positioning (era tokens only, AC73).

## Tests (unit)
A pure href/filename builder (id `encodeURIComponent`, filename escaping) + the
sibling/isolation structure (not nested in the thumbnail anchor).

## Acceptance criteria owned: AC62, AC63, AC64, AC65, AC66, AC67.

## Gate & reporting
- **Gate:** light.
- Run Node 22 tests + lint; fix failures. **Report:** files changed, confirmation
  the button is a sibling (not nested) of the thumbnail anchor, test output.

---
**Toolchain:** Node 22 at `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin` — prepend to PATH. Test: `npm test`. Lint: `npm run lint`. Absolute paths.
**Git:** COORDINATOR owns ALL git. Do NOT commit. Report files-changed + test/lint output only.
