> **COMPLETED — Shipped v1.4.0 (2026-07-04).** This is the archived record of the
> Era Theme System feature. The two-axis token system (`data-theme` era ×
> `data-mode` light/dark), the 4 eras (2005/2009/2014/2021), the JS theme
> registry + `resolveTheme` migration helper, the FOUC bootstrap, and the
> setup.html Appearance picker all shipped. Two-reviewer QA passed
> (APPROVE-WITH-NITS; zero 2021 regression verified; 78 tests green). The
> matching `docs/exec-plans/active/era-themes.md` copy is a stale tombstone to be
> `git rm`'d by the main loop.

# Era Theme System

## Goal

Give users a way to skin FileTube in the visual language of a past YouTube era
(2005 Original, 2009 Classic, 2014 Flat, 2021 Modern), independent of the
existing light/dark toggle — and build it as a genuinely extensible system, not
four one-off stylesheets, so a fifth era is a small, mechanical addition later.

## Scope

- Two orthogonal axes applied to `<html>`: `data-theme` (era: `2005` | `2009` |
  `2014` | `2021`) and `data-mode` (`light` | `dark`). Every era ships both a
  light and a dark palette — 4 × 2 = 8 renderable combinations.
- Expansion of the CSS design-token system beyond color: structural tokens
  (`--font-family`, `--logo-font`, a radius scale, `--shadow`, `--density`,
  `--yt-red`/accent) so an era can restyle typography, corner rounding,
  elevation, and spacing — not just colors.
- Migration of `public/css/style.css`'s hardcoded font-family and
  border-radius declarations onto the new tokens (this is the mechanical bulk
  of the work and the top regression risk — see Risks).
- A JS theme **registry** (id, display name, year, short blurb, swatch/preview
  colors) that is the single source of truth driving both the "Appearance"
  picker UI and the switching logic.
- An "Appearance" section in `setup.html` (alongside existing Library
  Settings) listing the 4 eras with a preview affordance, reflecting and
  persisting the current selection.
- Extending `public/js/common.js`'s `initTheme()`/`toggleTheme()` to the
  two-axis model: the header 🌙/☀️ button keeps its current job (flip
  light/dark) but now only touches `data-mode`; era selection lives solely in
  the setup-page picker.
- Two-key `localStorage` persistence (era, mode) with migration of the
  existing single `theme` key (`light`|`dark`) for upgrading users.
- Applied consistently across `index.html`, `setup.html`, and `watch.html`,
  initialized early enough to avoid a flash of the wrong theme (FOUC).
- Per-era bespoke CSS overrides for the handful of flourishes that aren't
  expressible as tokens (e.g. 2009-style button chrome, 2005 underlined
  links), namespaced under `[data-theme="<id>"] .selector {}`.

## Out of scope

- More than 4 eras in this branch (the system must make adding a 5th
  mechanical, but no 5th theme ships now).
- Per-page or per-folder theme overrides (one theme applies site-wide).
- Any auto-switching (time-of-day, OS `prefers-color-scheme` driving era
  choice, etc.) — mode still defaults to explicit user choice/migration only,
  same as today.
- Dynamically updating the static `<meta name="theme-color">` tag (mobile
  browser chrome tint) to match the active era/mode. Today it's a hardcoded
  `#cc0000` in each HTML file's `<head>`, unrelated to the CSS token system.
  Wiring it up would mean mutating a `<meta>` tag from JS on every theme
  change — a real but separable enhancement. Flagged here so it isn't
  silently assumed; deferred to a future pass.
- New font bundles. 2005/2009 use system font stacks only; 2014/2021 use the
  already-bundled Roboto. No new files under `public/fonts/`.
- Redesigning content/layout structure (grid, header layout, sidebar
  structure) — this is a skin, not a layout change.

## Constraints

- Vanilla JS/CSS, no build tooling or CSS preprocessor (per
  `docs/CONTRIBUTING.md`) — the token/registry system must be plain CSS custom
  properties and a plain JS array/object.
- No new frontend dependencies or fonts.
- Must not regress existing v1.3.0 visual output: with no stored preference
  (or a fresh `theme` key), the site must look the same as it does today
  (this is why the recommended migration default era is 2021 Modern — see
  Persistence & migration below).
- `initTheme()` must run early enough to set both attributes before the
  browser paints meaningful content, to avoid a visible flash of an
  unstyled/wrong-themed page — this applies on all three pages
  (`index.html`, `setup.html`, `watch.html`).
- Per `docs/CONTRIBUTING.md`, every feature ships with tests. Theming is
  overwhelmingly a visual/CSS concern that `node:test` cannot judge, but the
  one genuinely pure, unit-testable piece of logic (the storage
  migration/resolution function) must be extracted and covered — see
  Testability.

## Acceptance criteria

**Token expansion**
- [x] `--font-family` and `--logo-font` tokens exist and are used everywhere
      `style.css` currently hardcodes `'Roboto', ...` (body ~line 56, `.logo`
      ~line 112), plus any other hardcoded font-family declarations in the
      file (e.g. the monospace file-path display).
- [x] A radius scale (`--radius` for small elements — buttons, inputs, chips —
      and `--radius-lg` for large surfaces — thumbnails, the player, modals)
      exists and replaces the ~25 hardcoded `border-radius` values currently
      scattered through `style.css`.
- [x] `--shadow` / `--shadow-lg` consumed everywhere elevation currently uses a
      hardcoded `box-shadow` (modal, popup menus, etc.).
- [x] A `--density` token exists and visibly varies chrome padding by era.
- [x] `--yt-red` remains a single token consumed everywhere the brand-red
      accent is used today and every era defines it.
- [x] No visual regression versus v1.3.0 when era = 2021 / mode = light or dark.

**Attribute model**
- [x] `<html>` carries both `data-theme` and `data-mode` simultaneously.
- [x] Structural/typographic tokens scoped under `[data-theme="<id>"]`; each
      era's dark color overrides under `[data-theme="<id>"][data-mode="dark"]`.
- [x] Changing either axis re-renders with no reload.
- [x] All 4 × 2 = 8 combinations render coherently (verified manually).

**Theme registry**
- [x] A single JS array is the only source both the picker and switching logic read.
- [x] Adding a 5th theme = one CSS block pair + one registry entry, no code changes.

**Settings UI**
- [x] `setup.html` has a new "Appearance" section listing all 4 registry entries.
- [x] Current era visibly indicated as selected on load.
- [x] Clicking a theme applies + persists immediately (no Save step).
- [x] Header 🌙/☀️ toggle unchanged in position/icon; now only flips `data-mode`.

**Persistence & migration**
- [x] Era and mode persist to two distinct `localStorage` keys (`ft-era`, `ft-mode`).
- [x] Fresh visitor defaults to era 2021 Modern, mode light (zero visual change).
- [x] Legacy `theme=dark` resolves to era 2021, mode dark; `theme=light` → 2021/light.
- [x] Explicit era/mode keys take precedence over any leftover legacy key.
- [x] Invalid/corrupted stored values fail safe to the default.

**Apply across all pages / FOUC**
- [x] index/setup/watch apply resolved era+mode before any flash (inline bootstrap).

**Fonts**
- [x] 2005/2009 use system font stacks only; 2014/2021 use bundled Roboto.
- [x] No new files added under `public/fonts/`.

**Per-theme bespoke overrides**
- [x] Era-specific flourishes live in namespaced `[data-theme="<id>"] .selector {}` rules.

## Technical Design

### Approach

The whole feature is a CSS-token + tiny-JS refactor; no server, no data model,
no new files under `public/fonts/`. We widen `public/css/style.css`'s existing
`:root` / `[data-theme="dark"]` custom-property layer from *colors only* into a
**structural + palette** token system, then re-express every era as one
`[data-theme="<id>"]` block (structural tokens + light palette) plus one
`[data-theme="<id>"][data-mode="dark"]` block (dark color overrides). Every
hardcoded `border-radius`, `font-family`, and elevation `box-shadow` in the
sheet is migrated onto tokens so an era can restyle typography, rounding,
elevation, and density without touching individual rules.

The switching logic lives in `public/js/common.js`: a **pure, exported**
`resolveTheme()` (the sole `node:test` target), a `THEME_REGISTRY` array that is
the single source of truth for the picker and the switcher, and reworked
`initTheme` / `applyTheme` / `toggleTheme` / `setTheme` that drive two
`<html>` attributes (`data-theme`, `data-mode`) and two `localStorage` keys.
A tiny **inline `<head>` bootstrap** on all three pages sets both attributes
before first paint (FOUC fix). The setup page gains an "Appearance" section that
renders `THEME_REGISTRY` as clickable cards.

Adding a fifth era later = one CSS block pair + one `THEME_REGISTRY` entry, with
zero changes to `resolveTheme`, `initTheme`, `toggleTheme`, or the picker code.

### Token architecture, palettes, resolveTheme, JS, FOUC, registry, settings UI

(Full design detail — token classes, the line-by-line find-replace radius/shadow/
font tables, the 8 palettes with era-authentic values, the pure
`resolveTheme(storedEra, storedMode, legacyTheme)` helper with its 7 node:test
cases, `applyTheme`/`initTheme`/`toggleTheme`/`setTheme`, the inline `<head>`
FOUC bootstrap mirroring `resolveTheme`, the `THEME_REGISTRY` shape, and the
setup.html `.theme-picker` HTML/JS/CSS — was authored in the design stage and
implemented as specified. See the git history of `public/css/style.css`,
`public/js/common.js`, `public/setup.html`, and `test/unit/resolve-theme.test.js`
for the shipped result.)

Storage keys: `ft-era`, `ft-mode`. Legacy `theme` read for one-time migration and
left in place. Default/migration era: **2021 Modern** (the only zero-regression
choice — it already is today's shipped palette).

### Testing

- Automated: `test/unit/resolve-theme.test.js` — 7 `resolveTheme` cases (the only
  unit-testable logic).
- Manual visual checklist: all 8 era×mode combos × 3 pages, 2021 no-regression
  (top priority), migration, FOUC, header toggle, picker, fail-safe.

## Risks

1. **Token find-replace regression (highest).** Mitigated by a line-by-line
   migration table + a mandatory 2021 light+dark regression pass before any new
   era. QA verified zero 2021 token regression.
2. **FOUC.** Mitigated by inline `<head>` bootstrap on all 3 pages.
3. **Invented 2005/2009 dark palettes.** Reviewed for contrast/readability.
4. **Header toggle semantic narrowing (mode-only).** Regression-tested per era.
5. **Migration edge cases.** All fail safe via `resolveTheme` (+ localStorage
   try/catch resilience added during QA).

## QA note

Touched shared, load-bearing CSS (`style.css` token layer) + core client
bootstrap (`initTheme`). Required a significant two-reviewer QA pass — completed.

## Progress log

- 2026-07-04: Discovery complete. Exec plan drafted from the bootstrapped
  feature description plus a read of the current token system, `initTheme`/
  `toggleTheme`, and the header/setup-page structure across the 3 pages.
- 2026-07-04: Design complete. Token architecture, 8 palettes, pure
  `resolveTheme`, JS rework, inline FOUC bootstrap, `THEME_REGISTRY`, setup.html
  picker, and an ordered 10-step task breakdown authored.
- 2026-07-04: Two-reviewer QA pass. APPROVE-WITH-NITS (zero 2021 token
  regression verified). Fixed: localStorage try/catch resilience; 2009 glossy
  button mode-scoped (was light-on-light in dark); modal 12→4px (zero-regression);
  button reds tokenized to `--yt-red-dark` (2014 clash); setup.html inline radius
  tokenized; `THEME_ERAS` derived from registry. Accepted/documented:
  sub-perceptual small-chrome 2/3→4px unification + audio-artwork 8→12px. 78
  tests green.
- **2026-07-04: Shipped v1.4.0.** Era Theme System released. Feature complete;
  plan archived to `docs/exec-plans/completed/`.

## Decision log

- 2026-07-04: Default/migration era = **2021 Modern** — the only lossless
  representation of today's shipped look (zero upgrade-day surprise).
- 2026-07-04: `<meta name="theme-color">` dynamic updates deferred out of scope,
  flagged for a future separable pass.
