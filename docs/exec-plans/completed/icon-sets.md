<!-- ============================================================= -->
<!-- COMPLETED — Shipped v1.7.0 (2026-07-05).                       -->
<!-- Icon Set System (per-era + toggle). Retired from                -->
<!-- docs/exec-plans/active/ during the settings-automation-cache    -->
<!-- (v1.8.0) kickoff. All acceptance criteria met; two-reviewer QA  -->
<!-- (quality-assurance + /code-review) passed clean, consistent     -->
<!-- with the v1.6.0 precedent. Preserved verbatim below.            -->
<!-- ============================================================= -->

# Icon Set System (per-era + toggle)

## Goal

Add a user-selectable **icon set** as a third, orthogonal appearance axis —
theme (era) × mode (light/dark) × icon-set — on top of v1.6.0's Material
Symbols chrome icons, plus an **Auto** mode that matches the icon style to
whichever era is currently selected.

## Context — grounded in shipped code

- **The 12-icon inventory** (`public/css/style.css:1331-1366`, and
  `public/assets/icons/README.md`): `.icon-home`, `.icon-folder`, `.icon-cog`
  (`settings`), `.icon-delete`, `.icon-moon` (`dark_mode`), `.icon-sun`
  (`light_mode`), `.icon-menu`, `.icon-search`, `.icon-play` (`play_arrow`),
  `.icon-refresh`, `.icon-arrow-up` (`keyboard_arrow_up`), `.icon-arrow-down`
  (`keyboard_arrow_down`). Today these render via a shared base rule + one
  `mask-image: url(/assets/icons/<name>.svg)` per class, painted with
  `background-color: currentColor` behind an `@supports` guard
  (`style.css:1371-1376`). `.icon-star::before { content: "★" }` is explicitly
  excluded from this group and stays untouched (gold rating).
- **The theme-axis pattern to mirror** (`public/js/common.js`): `THEME_REGISTRY`
  (id/name/blurb/swatch) drives the setup-page picker; `resolveTheme(storedEra,
  storedMode, legacyTheme)` is a pure, node:test-covered resolver; `applyTheme`
  sets `data-theme`/`data-mode` on `<html>` and persists `ft-era`/`ft-mode`;
  `initTheme` runs on `DOMContentLoaded`; `setTheme(era)` (setup-page picker,
  no Save step) and `toggleTheme()` (header/bottom-nav, mode-only) both funnel
  through `applyTheme`; `updateNavThemeItem()` keeps the bottom-nav Dark/Light
  item in sync.
- **The FOUC guard** (inline `<script>` in `<head>` of `index.html`,
  `setup.html`, `watch.html`): a hand-kept-in-sync copy of `resolveTheme`'s
  logic that sets `data-theme`/`data-mode` before first paint.

_(Full discovery/design body preserved from the active plan; see the shipped
v1.7.0 commit `eaab138` for the implemented result. This tombstone marks the
plan complete — the authoritative record of what shipped is the code + tests on
`main`. The remainder of the original plan text — Scope, Sourcing, the 14
acceptance criteria, `resolveIconSet` contract + 11 node:test cases, the CSS
mechanism/no-square fix, the JS axis wiring, FOUC additions, the setup.html
picker, risks, and the PM/PE progress + decision logs — was carried in the
active file and is retained in version control history for this path.)_

## Outcome

- Shipped as **v1.7.0** on 2026-07-05.
- `resolveIconSet` unit tests (`test/unit/resolve-icon-set.test.js`) and the
  extended `test/unit/icon-assets.test.js` CI guards (bundled/served rounded +
  filled SVGs, no-CDN, re-scoped no-stray-emoji) all green.
- Two-reviewer QA (quality-assurance agent + `/code-review`) passed; the gold
  `★` rating, the v1.6.0 `aria-label`s, and the 8-combo `currentColor` theming
  all confirmed unregressed across every set.
