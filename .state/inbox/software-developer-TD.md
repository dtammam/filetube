# SDE Task TD — FR-3: Creator name → /subscriptions SPA link (Wave 3)

Feature: **v1.22.0 "Player Parity + Roadmap"** — branch `feature/v1.22-player-parity`.
Exec plan (READ `## Design (FR-2..FR-10)` → the `### FR-3` subsection): `docs/exec-plans/active/2026-07-08-v1.22-player-parity.md`.
Standards: `docs/CONTRIBUTING.md`.

**Wave 3** — runs in PARALLEL with TE (FR-4, style.css only). You touch ONLY
`public/watch.html` + `public/js/watch.js`; TE touches only `style.css` — disjoint.
Do not start until the coordinator confirms Wave 2 integrated.

## Coordinator decision (do not reopen)
Ship the **general `/subscriptions` fallback link ONLY** — NO channel deep-link
this round (the standalone subscriptions page has no anchor support today).

## Scope
1. **`watch.html`:** change `#uploader-channel-name` from `<div>` to
   `<a id="uploader-channel-name" class="uploader-channel-link">` (no default
   `href`, so with the module off / no identity it renders as inert plain text —
   never a dead link, AC25).
2. **`watch.js`:** `populateMetadata` keeps setting `.textContent = channelName`
   (unchanged, XSS-safe). In `setupSubscribeButton` (which already computes
   `moduleEnabled` via the `/api/subscriptions/health` probe — no extra fetch),
   set `link.href = '/subscriptions'` when module enabled; leave href unset when
   disabled / no identity. The shell's global anchor handler routes `/subscriptions`
   exactly like today's `[data-nav="subscriptions"]` link (no new routing code, AC23).
3. Add a pure `resolveUploaderLinkHref({ moduleEnabled })` → `'/subscriptions' | null`
   as the unit-test target.

## Tests (unit)
`resolveUploaderLinkHref` (enabled → `/subscriptions`; disabled → `null`);
`textContent`/`.href`-only construction, never `innerHTML` (AC26).

## Acceptance criteria owned: AC23, AC24 (general-fallback form), AC25, AC26, AC27.

## Gate & reporting
- **Gate:** light single-QA.
- Run Node 22 tests + lint; fix failures. **Report:** files changed, test output.

---
**Toolchain:** Node 22 at `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin` — prepend to PATH. Test: `npm test`. Lint: `npm run lint`. Absolute paths.
**Git:** COORDINATOR owns ALL git. Do NOT commit. Report files-changed + test/lint output only.
