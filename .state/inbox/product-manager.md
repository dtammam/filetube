# Product Manager — Discovery: v1.22.2 (three small FRs)

You are the **product-manager** agent. This is the **Discovery** stage for
`v1.22.2` — a TINY polish round after Dean's on-device iPhone pass of v1.22.1
(everything working). Produce the exec plan with tight, verifiable acceptance
criteria. You write requirements only — no code, no design mechanism, no git.

## First, read (ground yourself in the LIVE code — do not take my word for it)

- `.state/feature-state.json` — full grounded brief (`grounded_diagnosis`,
  `hard_constraints`, `review_tier_proposed`, `dean_speed_directive`).
- `docs/CONTRIBUTING.md`, `docs/RELIABILITY.md` — standards + the "Dean's
  on-device pass is the arbiter" testing reality (no headless/E2E).
- `docs/exec-plans/completed/2026-07-07-v1.22.1-mobile-player-fixes.md` — the
  round that REMOVED the mobile-audio `#fs-btn` (its FR-2). Read its FR-2 to
  understand exactly what was removed and why, so FR-1 here reconciles cleanly.
- FR-1 live code:
  - `public/js/player.js`: `enterFullscreen()` (~1500-1511), the `#fs-btn`
    click handler (~1707-1721), `inNativeFullscreen()`, `#audio-bg-art` +
    `.audio-mode` wiring (~1770-1824, ~1937-1985).
  - `public/css/style.css`: `#audio-bg-art`/`.audio-mode` (~909-931), the
    custom control bar `.player-controls` (z-index 8, ~2903-2912), the v1.22.1
    mobile-audio `#fs-btn` HIDE (~3226-3233), the v1.21 THEATRE mode
    (~3920-3965, on `.watch-container` — a page layout, separate from the
    player-wrapper dock model).
- FR-2 live code: the icon `<link>` tags (lines 7-9) in all FOUR shells —
  `public/index.html`, `public/watch.html`, `public/setup.html`,
  `lib/ytdlp/views/subscriptions.html` — plus `public/manifest.webmanifest`
  and the icon assets in `public/` (`favicon.svg`, `icons/icon-192.png`,
  `icons/icon-512.png`; note there is NO `.ico` and NO PNG `rel="icon"`).
- FR-3 live code: `public/watch.html` (~166-172, the `.star-rating` /
  `#rating-text` markup), `public/css/style.css` (~1348-1369, `.star-rating` +
  `.rating-count`), `public/js/watch.js` (~779, sets `#rating-text` to
  `${rating} / 5`), and `public/js/main.js` (~468, the home-card `.card-rating`
  glyph variant — confirm it is NOT the wrapping element).

## Scope — THREE small FRs (one bug/feature each). Resist scope creep.

### FR-1 — Working AUDIO "fullscreen" (CSS-expanded now-playing view)
- **Problem:** v1.22.1 removed the mobile-audio `#fs-btn` because the native
  Fullscreen API is a no-op for an audio-only element on iPhone
  (`webkitEnterFullscreen()` needs a `<video>` surface). Dean still wants a
  fullscreen option for audio. His final word: *"if we add the fullscreen
  button i just want it to work."*
- **Approach (settled with Dean — write ACs around this, not the dead native
  API):** a CSS full-viewport "expanded now-playing" view — `position:fixed`,
  `inset:0`, high z-index, driven by a class toggle — that enlarges the audio
  cover art (`#audio-bg-art`) + the custom control bar to fill the screen.
  Works on iPhone, desktop, everywhere. This is NOT the browser Fullscreen API.
- **Outcome ACs to cover:** the audio fullscreen affordance is present and
  visible for audio playback; tapping it ENTERS the expanded view (art + custom
  controls fill the viewport); an exit affordance (a close/exit control and/or
  tap and/or the same toggle) cleanly EXITS and restores the prior layout;
  scoped to audio-mode; must NOT regress VIDEO fullscreen (which stays on the
  real Fullscreen API / `webkitEnterFullscreen`); no stuck-expanded state if
  the player docks/closes/navigates while expanded; nothing persisted
  server-side. Leave the fullscreen MECHANISM to the Principal Engineer — write
  ACs about observable behavior, and surface (do not resolve) these design
  questions for PE:
  - Reuse the existing `#fs-btn` (re-show it for audio + branch its handler to
    the CSS-expand path instead of `enterFullscreen()` when in `.audio-mode`)
    vs a distinct new control? (Recommend reusing `#fs-btn` to avoid four-shell
    markup churn — PE's call. A new control id would need four-shell parity.)
  - Coexistence with the dock FULL/DOCKED/CLOSED model, `#audio-bg-art`,
    Media Session, progress saving, loop, and THEATRE mode (confirm no conflict).
  - Exit affordance discoverability + clean restore.
  - FULL-only vs also DOCKED (likely FULL-only).
- **Gate:** FOCUSED two-reviewer pass on the overlay/dock interaction +
  video-fullscreen non-regression. **Dean's iPhone on-device pass is the
  arbiter** that the button truly works — enter AND exit, cleanly restores.

### FR-2 — Favicon displays consistently (tab vs bookmark / across browsers)
- **Problem (Dean verbatim):** *"on certain browsers the favicon doesn't
  display, can we make it display consistently? it does in a new tab section
  but not if a bookmark?"* — the tab/new-tab favicon shows but the BOOKMARK
  icon (and some browsers) fall back to a default.
- **Grounded cause to confirm:** the only tab favicon is SVG-only
  (`rel="icon" type="image/svg+xml" href="/favicon.svg"`) with no `.ico` /
  PNG `rel="icon"` fallback; many browsers + bookmark bars don't consume an SVG
  favicon.
- **Outcome ACs to cover:** the favicon renders consistently across browsers
  AND in bookmarks; any icon-link change is byte-identical across all FOUR
  shells (four-shell parity); no new runtime dependency; existing SVG behavior
  where it already works is not regressed. Leave the exact asset/link mechanism
  (add a `favicon.ico` and/or PNG `rel="icon"` with explicit `sizes`/`type`,
  derived from the existing 192/512 PNGs; verify static route + cache headers)
  to PE. **Gate:** LIGHT single-QA + four-shell parity check + Dean's
  cross-browser/bookmark on-device check.

### FR-3 — Star-rating "N / 5" stays on one line
- **Problem (Dean verbatim):** *"the x/5 star thing is now compressed so it
  looks like 3/ and then on a line under, the 5."* — the `#rating-text`
  (`.rating-count`) "N / 5" wraps under a width squeeze.
- **Outcome ACs to cover:** the "N / 5" rating text renders on a single line
  (no wrap) at the watch-page metadata row across viewport widths; the
  home-card `.card-rating` glyph variant is unaffected; era tokens preserved.
  Mechanism (trivial CSS: `white-space:nowrap` / `flex-shrink:0`) is PE/SDE's.
  **Gate:** LIGHT single-QA + Dean's on-device check.

## Explicit NON-ASK (do NOT scope, do NOT write ACs for)
- **Audio press-and-hold-2x.** Dean explicitly said he is OK with it not
  working since the persistent `#speed-btn` covers speed. Do NOT touch it or add
  any work for it. Leave it exactly as shipped in v1.22.1.

## Constraints (see `hard_constraints` in state for the full list)
- No Fullscreen API for audio (iPhone refuses it on non-video elements) — CSS
  overlay only. Do NOT regress VIDEO fullscreen or any v1.16/v1.21/v1.22.x
  player feature (persistent single `<video>`, one-time `wireHostListeners`,
  dock FULL/DOCKED/CLOSED, Media Session, progress saving, loop, PiP, THEATRE,
  the v1.22.1 custom-bar-everywhere + `#speed-btn` + desktop click-to-pause).
- Four-shell byte-identical parity for any shell markup change (FR-1 new
  control id, if any; FR-2 icon links).
- Era-theme tokens for all new/changed CSS; ≥44px mobile touch targets. Reuse
  the single shared `isMobileFormFactor()` signal for any JS gating. Vanilla
  DOM, `node:test` for any new pure helper + a regression lock, lint 0 warnings,
  no new runtime deps (`docs/CONTRIBUTING.md`).

## Deliverable
Write the exec plan to `docs/exec-plans/active/2026-07-07-v1.22.2-audio-fullscreen.md`:
- The three FRs above, one section each, with tight verifiable ACs
  (outcome-focused for FR-1; behavior-focused for FR-2/FR-3).
- Per-FR review tiers as noted (FR-1 focused two-reviewer + Dean iOS arbiter;
  FR-2/FR-3 light single-QA).
- Surface the FR-1 design questions for PE without resolving them.
- Check for overlap with any active exec plan and `docs/exec-plans/tech-debt-tracker.md`.
- Update `.state/feature-state.json`: set `artifacts.requirements` and
  `artifacts.exec_plan` to the exec plan path.

Do NOT write application/test code. Do NOT touch git. When done, report a
summary back to the EM/coordinator, who will run `/prep-pe-design`.
