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
- [ ] `--font-family` and `--logo-font` tokens exist and are used everywhere
      `style.css` currently hardcodes `'Roboto', ...` (body ~line 56, `.logo`
      ~line 112), plus any other hardcoded font-family declarations in the
      file (e.g. the monospace file-path display).
- [ ] A radius scale (`--radius` for small elements — buttons, inputs, chips —
      and `--radius-lg` for large surfaces — thumbnails, the player, modals)
      exists and replaces the ~25 hardcoded `border-radius` values currently
      scattered through `style.css` (values seen today: `2px`, `3px`, `4px`,
      `8px`, `12px`, `14px`, `27px`, `50%`). Perfect circles (`50%`, avatar/
      dot elements) are not required to move onto the scale — those aren't an
      era-varying shape. Everything else should resolve to `--radius` or
      `--radius-lg`.
- [ ] `--shadow` (already defined but only consumed in one place today —
      `style.css` line 984) is consumed everywhere elevation currently uses a
      hardcoded `box-shadow` (modal, popup menus, etc.), so an era can flatten
      or add shadow.
- [ ] A `--density` (or equivalent spacing-scale) token exists and visibly
      varies chrome padding/spacing by era (exact values are a design-stage
      decision, not prescribed here).
- [ ] `--yt-red` (or a generalized `--accent`) remains a single token consumed
      everywhere the brand-red accent is used today (logo tab, delete button,
      links, etc.) and every era defines it (need not literally be red for
      every era, but must exist and resolve).
- [ ] No visual regression versus v1.3.0 when era = 2021 / mode = light or
      dark (i.e. the token migration is a refactor, not a redesign, for the
      current look).

**Attribute model**
- [ ] `<html>` carries both `data-theme="2005|2009|2014|2021"` and
      `data-mode="light|dark"` simultaneously.
- [ ] Structural/typographic tokens (font, radius, density, shadow) are scoped
      under `[data-theme="<id>"]`; each era's light color palette is also
      under `[data-theme="<id>"]`; each era's dark color overrides are under
      `[data-theme="<id>"][data-mode="dark"]` — mirroring the existing
      `:root` / `[data-theme="dark"]` pattern, extended.
- [ ] Changing either axis re-renders the page correctly with no reload
      (pure CSS attribute switch + JS attribute set).
- [ ] All 4 × 2 = 8 (era × mode) combinations render as a coherent, readable
      theme (verified manually/visually — see Testability).

**Theme registry**
- [ ] A single JS array/object (e.g. in `common.js` or a new small module)
      lists each theme's id, display name, year, one-line blurb, and enough
      swatch data (a couple of representative colors) to render a picker
      preview — and is the only thing both the setup-page picker and the
      switching logic read.
- [ ] Adding a 5th theme requires exactly one new CSS block
      (`[data-theme="x"]` + `[data-theme="x"][data-mode="dark"]`) and one new
      registry entry — no changes to `initTheme`, `toggleTheme`, or the
      picker-rendering code.

**Settings UI**
- [ ] `setup.html` has a new "Appearance" section (peer to the existing
      Library Settings content) listing all 4 registry entries with a visible
      preview affordance (swatches, name, year/blurb).
- [ ] The current era is visibly indicated as selected on load.
- [ ] Clicking a theme option applies it immediately (no separate "Save"
      step, consistent with how the header dark-mode toggle already behaves)
      and persists it.
- [ ] The header 🌙/☀️ toggle (`theme-toggle-btn`) is unchanged in position
      and icon behavior, but now only flips `data-mode`; it never changes
      `data-theme`.

**Persistence & migration**
- [ ] Era and mode persist to two distinct `localStorage` keys (naming is an
      implementation detail, but they must be independent keys, not a single
      combined value, to keep the axes genuinely orthogonal in storage too).
- [ ] Fresh visitor (no keys at all): defaults to era **2021 Modern**, mode
      `light` — matching today's default and causing zero visual change for
      new users.
      - Recommended default era for migration/fresh-start: **2021 Modern**,
        because it already *is* today's shipped palette and token values —
        picking any other era as the default would be a visible regression
        for every existing user on upgrade day. 2021 Modern is the only
        choice with zero migration risk.
- [ ] Existing user with legacy `theme` = `dark` (no era key yet): after
      upgrade, resolves to era `2021`, mode `dark` — i.e., looks identical to
      before the upgrade, no reset flash, no prompt.
- [ ] Existing user with legacy `theme` = `light`: resolves to era `2021`,
      mode `light`.
- [ ] Once a user has explicit era/mode keys (either from migration or from
      using the new picker), those keys take precedence over any leftover
      legacy `theme` key.
- [ ] Invalid/corrupted stored values (unrecognized era id, unrecognized mode
      string) fail safe to the default rather than throwing or leaving
      `data-theme`/`data-mode` unset.

**Apply across all pages / FOUC**
- [ ] `index.html`, `setup.html`, and `watch.html` all apply the resolved
      era + mode before the user perceives an unstyled or wrong-themed flash
      — this is a hard requirement, not a nice-to-have, given how visually
      distinct the eras are (unlike today's light/dark, where the flash risk
      is minor).

**Fonts**
- [ ] 2005 Original and 2009 Classic use system font stacks only (no Roboto)
      for both body and logo.
- [ ] 2014 Flat and 2021 Modern use the bundled Roboto (`--font-family`
      resolving through the existing `@font-face`), matching today's stack
      for 2021.
- [ ] No new files added under `public/fonts/`.

**Per-theme bespoke overrides**
- [ ] Any era-specific flourish that isn't representable as a token (e.g. a
      2009-style button gradient, 2005 always-underlined links) lives in a
      `[data-theme="<id>"] .selector {}` rule, not a bare, unscoped selector
      override — keeping bespoke CSS auditable and removable per-era.

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

### 1. Token architecture

Two token classes:

- **Structural (mode-independent)** — live in `[data-theme="<id>"]` only:
  `--font-family`, `--logo-font`, `--mono-font`, `--radius`, `--radius-lg`,
  `--density`, `--shadow`, `--shadow-lg`. (Shadows are structural but a dark
  block may override them if an era needs it; none do in v1.4.0.)
- **Palette (mode-dependent)** — light values in `[data-theme="<id>"]`, dark
  overrides in `[data-theme="<id>"][data-mode="dark"]`: `--yt-red`, `--bg-color`,
  `--bg-secondary`, `--bg-sidebar`, `--text-primary`, `--text-secondary`,
  `--text-link`, `--border-color`, `--border-dark`, `--header-bg`, `--btn-bg`,
  `--btn-hover`, `--card-bg`, `--star-gold`, `--star-gray`.

`:root` is kept as a **safe default** equal to the 2021 light palette + 2021
structural tokens, so tokens always resolve even if an attribute is missing or
corrupt (fail-safe). Each era — including 2021 — still gets its own explicit
`[data-theme]` block so it is a first-class, uniform registry entry (2021's block
duplicating `:root` is intentional and cheap). The old `[data-theme="dark"]`
selector is **removed** and replaced by the per-era `[data-mode="dark"]` blocks;
its color values move verbatim into `[data-theme="2021"][data-mode="dark"]`.

New additions beyond today's tokens: `--font-family`, `--logo-font`,
`--mono-font`, `--radius`, `--radius-lg`, `--density`, `--shadow-lg`. Existing
`--shadow` and `--yt-red` are retained (`--yt-red` stays the single brand-accent
token every era defines; it need not literally be red per era but must resolve).

#### CSS block skeleton

```css
:root {
  /* Safe default == 2021 Modern light. Guarantees every token resolves even
     if data-theme / data-mode is missing or invalid. */
  --font-family: 'Roboto', 'Helvetica Neue', system-ui, Arial, sans-serif;
  --logo-font: 'Roboto', "Arial Black", Gadget, sans-serif;
  --mono-font: monospace;
  --radius: 4px;
  --radius-lg: 12px;
  --density: 8px;
  --shadow: 0 1px 2px rgba(0,0,0,0.1);
  --shadow-lg: 0 4px 12px rgba(0,0,0,0.25);
  --yt-red: #cc0000;
  --bg-color: #ffffff;
  --bg-secondary: #f1f1f1;
  --bg-sidebar: #f9f9f9;
  --text-primary: #333333;
  --text-secondary: #666666;
  --text-link: #03c;
  --border-color: #e2e2e2;
  --border-dark: #cccccc;
  --header-bg: #ffffff;
  --btn-bg: #ececec;
  --btn-hover: #e0e0e0;
  --card-bg: #ffffff;
  --star-gold: #ffcc00;
  --star-gray: #e0e0e0;
}

[data-theme="2021"] {
  /* structural */
  --font-family: 'Roboto', 'Helvetica Neue', system-ui, Arial, sans-serif;
  --logo-font: 'Roboto', "Arial Black", Gadget, sans-serif;
  --mono-font: monospace;
  --radius: 4px;
  --radius-lg: 12px;
  --density: 8px;
  --shadow: 0 1px 2px rgba(0,0,0,0.1);
  --shadow-lg: 0 4px 12px rgba(0,0,0,0.25);
  /* light palette (== today's :root) */
  --yt-red: #cc0000;
  --bg-color: #ffffff;
  --bg-secondary: #f1f1f1;
  --bg-sidebar: #f9f9f9;
  --text-primary: #333333;
  --text-secondary: #666666;
  --text-link: #03c;
  --border-color: #e2e2e2;
  --border-dark: #cccccc;
  --header-bg: #ffffff;
  --btn-bg: #ececec;
  --btn-hover: #e0e0e0;
  --card-bg: #ffffff;
  --star-gold: #ffcc00;
  --star-gray: #e0e0e0;
}

[data-theme="2021"][data-mode="dark"] {
  /* dark overrides only (== today's [data-theme="dark"]) */
  --bg-color: #121212;
  --bg-secondary: #1e1e1e;
  --bg-sidebar: #181818;
  --text-primary: #f1f1f1;
  --text-secondary: #aaaaaa;
  --text-link: #3ea6ff;
  --border-color: #2d2d2d;
  --border-dark: #444444;
  --header-bg: #1c1c1c;
  --btn-bg: #2b2b2b;
  --btn-hover: #3a3a3a;
  --card-bg: #1a1a1a;
  --star-gray: #444444;
}
```

#### Find-replace plan (the top regression risk — do line-by-line, not blind)

Radius scale semantics: `--radius-lg` = hero media surfaces (main thumbnail,
player, audio artwork, floating modal); `--radius` = all other chrome (buttons,
inputs, chips, cards, badges, panels, avatars-as-rounded-squares).

**Exempt from the scale** (shape geometry, not era-varying corner rounding —
extends the exec plan's "perfect circles" exemption to stadium/pill shapes whose
radius is defined by element height): `.theme-toggle` `50%` (L213),
`.audio-vinyl` `50%` (L480), `.audio-vinyl::after` `50%` (L498),
`.transcode-spinner` `50%` (L565), `.speed-badge` `14px` pill (L591),
`.skip-btn` `27px` stadium (L627), `.skip-ripple-*` ellipses (L667/668). These
stay hardcoded — this keeps the 2021 skip/badge/vinyl chrome pixel-identical and
is architecturally coherent (a pill is as much fixed geometry as a circle).

`border-radius` migrations (20 declarations → tokens):

| Line | Selector | Today | Token | 2021 result |
|------|----------|-------|-------|-------------|
| 120 | `.logo span.tube` | 4px | `--radius` | 4px (same) |
| 139 | `.search-form` | 2px | `--radius` | 4px |
| 183 | `.btn` | 3px | `--radius` | 4px |
| 325 | `.sort-select` | 2px | `--radius` | 4px |
| 344 | `.video-card` | 4px | `--radius` | 4px (same) |
| 355 | `.thumbnail-container` | 12px | `--radius-lg` | 12px (same) |
| 374 | `.duration-badge` | 2px | `--radius` | 4px |
| 441 | `.player-container` | 12px | `--radius-lg` | 12px (same) |
| 469 | `.audio-artwork` | 8px | `--radius-lg` | 12px |
| 749 | `.uploader-info-panel` | 4px | `--radius` | 4px (same) |
| 765 | `.uploader-avatar` | 4px | `--radius` | 4px (same) |
| 790 | `.description-container` | 4px | `--radius` | 4px (same) |
| 856 | `.comment-input-box` | 2px | `--radius` | 4px |
| 878 | `.comment-avatar` | 4px | `--radius` | 4px (same) |
| 939 | `.related-thumb` | 2px | `--radius` | 4px |
| 982 | `.setup-box` | 4px | `--radius` | 4px (same) |
| 1017 | `.form-group input[type=text]` | 3px | `--radius` | 4px |
| 1027 | `.folder-list-builder` | 3px | `--radius` | 4px |
| 1041 | `.folder-item-row` | 3px | `--radius` | 4px |
| 1094 | `.modal-content` | 4px | `--radius-lg` | 12px |

**Sanctioned 2021 deltas** (unification the exec plan authorizes; all
sub-perceptual except the last two — flag both for QA sign-off as *intended*,
not regressions): `2px→4px` and `3px→4px` on small chrome; `.audio-artwork`
`8px→12px` (inside the fixed-dark audio player, negligible); `.modal-content`
`4px→12px` (modals are large surfaces per the exec plan; 12px matches real 2021
YouTube dialogs). Everything marked "(same)" is pixel-identical.

`box-shadow` migrations (elevation only):

- L1098 `.modal-content` `0 4px 12px rgba(0,0,0,0.25)` → `var(--shadow-lg)`
  (2021 `--shadow-lg` is set to this exact value → zero change).
- L984 `.setup-box` `var(--shadow)` — already tokenized, leave.
- **Keep hardcoded** (not elevation / not theme-varying): L141 `.search-form`
  inset shadow (decorative inset), L470 `.audio-artwork` and L482 `.audio-vinyl`
  (both inside the always-dark audio visualizer, not palette-driven).

`font-family` migrations:

- L56 `body` → `var(--font-family)` (2021 token == current string, zero change).
- L112 `.logo` → `var(--logo-font)` (2021 token == current string, zero change).
- L1050 `.folder-path-text` `monospace` → `var(--mono-font)`.
- `watch.html` L156 inline `style="font-family: monospace"` on `#file-path-text`:
  add `.file-path { font-family: var(--mono-font); }` to `style.css` and swap the
  inline style for `class="file-path"` so the file path also era-varies.
- L7 `@font-face` Roboto declaration: leave untouched.

`--density` application (kept deliberately narrow to preserve zero regression —
2021 `--density: 8px` equals the current value on exactly the tokenized spots):

- L268 `.sidebar-item` `padding: 8px 24px` → `padding: var(--density) 24px`.
- L392 `.video-info` `padding: 8px 4px` → `padding: var(--density) 4px`.

These two nav/list-density signals visibly convey "dense 2005 vs airy 2014"
without a full padding rewrite (which would be a large, high-risk edit). Header,
button, and content paddings stay fixed.

### 2. The 8 palettes

2021 Modern is above (== today, verbatim). The other three eras follow. Values
are chosen for era authenticity and checked for readable contrast; the 2005/2009
dark palettes are invented-but-coherent (no historical reference existed).

```css
/* ---- 2005 Original: system Verdana, sharp 0px, plain B/W, blue links ---- */
[data-theme="2005"] {
  --font-family: Verdana, Arial, Helvetica, sans-serif;
  --logo-font: "Arial Black", Arial, sans-serif;
  --mono-font: "Courier New", monospace;
  --radius: 0;
  --radius-lg: 0;
  --density: 4px;               /* dense */
  --shadow: none;
  --shadow-lg: 0 2px 6px rgba(0,0,0,0.35);  /* minimal, keeps modals usable */
  --yt-red: #cc0000;
  --bg-color: #ffffff;
  --bg-secondary: #ececec;
  --bg-sidebar: #f5f5f5;
  --text-primary: #000000;
  --text-secondary: #666666;
  --text-link: #0000cc;
  --border-color: #cccccc;
  --border-dark: #999999;
  --header-bg: #ffffff;
  --btn-bg: #e4e4e4;
  --btn-hover: #d8d8d8;
  --card-bg: #ffffff;
  --star-gold: #ffcc00;
  --star-gray: #cccccc;
}
[data-theme="2005"][data-mode="dark"] {
  --bg-color: #0d0d0d;
  --bg-secondary: #1a1a1a;
  --bg-sidebar: #141414;
  --text-primary: #e8e8e8;
  --text-secondary: #9a9a9a;
  --text-link: #6699ff;
  --border-color: #333333;
  --border-dark: #555555;
  --header-bg: #000000;
  --btn-bg: #262626;
  --btn-hover: #333333;
  --card-bg: #111111;
  --star-gray: #444444;
}

/* ---- 2009 Classic: Arial, ~2px, warm grays, red/gray chrome ---- */
[data-theme="2009"] {
  --font-family: Arial, Helvetica, sans-serif;
  --logo-font: Arial, Helvetica, sans-serif;
  --mono-font: "Courier New", monospace;
  --radius: 2px;
  --radius-lg: 2px;
  --density: 6px;
  --shadow: 0 1px 2px rgba(0,0,0,0.15);
  --shadow-lg: 0 2px 6px rgba(0,0,0,0.30);
  --yt-red: #cc0000;
  --bg-color: #ffffff;
  --bg-secondary: #ededed;
  --bg-sidebar: #f0f0f0;
  --text-primary: #333333;
  --text-secondary: #666666;
  --text-link: #2b587a;
  --border-color: #d5d5d5;
  --border-dark: #b0b0b0;
  --header-bg: #f5f5f5;
  --btn-bg: #e3e3e3;
  --btn-hover: #d6d6d6;
  --card-bg: #ffffff;
  --star-gold: #ffcc00;
  --star-gray: #d0d0d0;
}
[data-theme="2009"][data-mode="dark"] {
  --bg-color: #141210;
  --bg-secondary: #201d19;
  --bg-sidebar: #1b1815;
  --text-primary: #ededed;
  --text-secondary: #a8a29a;
  --text-link: #7fa8cc;
  --border-color: #34302b;
  --border-dark: #4a453e;
  --header-bg: #1c1916;
  --btn-bg: #2a2621;
  --btn-hover: #38332c;
  --card-bg: #191612;
  --star-gray: #4a453e;
}

/* ---- 2014 Flat: Roboto, ~2px, flat white, brighter red, airy ---- */
[data-theme="2014"] {
  --font-family: 'Roboto', Arial, sans-serif;
  --logo-font: 'Roboto', Arial, sans-serif;
  --mono-font: monospace;
  --radius: 2px;
  --radius-lg: 2px;
  --density: 10px;             /* airier */
  --shadow: none;             /* flat design */
  --shadow-lg: 0 1px 4px rgba(0,0,0,0.12);
  --yt-red: #e62117;
  --bg-color: #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-sidebar: #fafafa;
  --text-primary: #333333;
  --text-secondary: #757575;
  --text-link: #167ac6;
  --border-color: #e0e0e0;
  --border-dark: #cccccc;
  --header-bg: #ffffff;
  --btn-bg: #f5f5f5;
  --btn-hover: #e8e8e8;
  --card-bg: #ffffff;
  --star-gold: #ffc107;
  --star-gray: #e0e0e0;
}
[data-theme="2014"][data-mode="dark"] {
  --bg-color: #212121;
  --bg-secondary: #2a2a2a;
  --bg-sidebar: #1a1a1a;
  --text-primary: #ffffff;
  --text-secondary: #aaaaaa;
  --text-link: #3ea6ff;
  --border-color: #383838;
  --border-dark: #4d4d4d;
  --header-bg: #212121;
  --btn-bg: #303030;
  --btn-hover: #3d3d3d;
  --card-bg: #212121;
  --star-gray: #4d4d4d;
}
```

Per-era bespoke overrides (namespaced, not bare selectors), for flourishes not
expressible as tokens:

```css
[data-theme="2005"] a { text-decoration: underline; }       /* always-underlined links */
[data-theme="2009"] .btn {                                   /* glossy 2009 button */
  background-image: linear-gradient(to bottom, #f7f7f7, #dcdcdc);
}
```

Keep bespoke rules minimal and auditable; everything else is pure token
resolution.

### 3. `resolveTheme(storedEra, storedMode, legacyTheme)` — pure, exported

Lives in `common.js`, exported via the existing `module.exports` shim (the same
pattern as `getStarRating` / `resolveChannelName`). Returns `{ era, mode }`.
Never throws; never returns an unset axis.

```js
const THEME_ERAS = ['2005', '2009', '2014', '2021'];
const THEME_MODES = ['light', 'dark'];
const DEFAULT_ERA = '2021';
const DEFAULT_MODE = 'light';

function resolveTheme(storedEra, storedMode, legacyTheme) {
  const era = THEME_ERAS.includes(storedEra) ? storedEra : DEFAULT_ERA;
  let mode;
  if (THEME_MODES.includes(storedMode)) {
    mode = storedMode;                       // valid new key wins
  } else if (storedEra == null && storedMode == null &&
             (legacyTheme === 'dark' || legacyTheme === 'light')) {
    mode = legacyTheme;                      // one-time migration of legacy `theme`
  } else {
    mode = DEFAULT_MODE;                     // missing/corrupt -> fail safe
  }
  return { era, mode };
}
```

Rules encoded: valid stored era/mode win; legacy `theme` is honored **only** when
neither new key exists yet (true pre-migration state), mapping `dark`/`light`
onto `mode` with era defaulting to `2021`; anything else fails safe to
`{2021, light}`. Once either new key is present, the legacy key is ignored.

`node:test` cases (`test/unit/resolve-theme.test.js`, mirroring
`star-rating.test.js`), ~7:

1. `(null, null, null)` → `{2021, light}` (nothing stored).
2. `(null, null, 'dark')` → `{2021, dark}` (legacy dark migration).
3. `(null, null, 'light')` → `{2021, light}` (legacy light migration).
4. `('2009', 'dark', 'light')` → `{2009, dark}` (new keys win, legacy ignored).
5. `('2050', 'dark', null)` → `{2021, dark}` (bad era → default era, mode kept).
6. `('2014', 'xyz', null)` → `{2014, light}` (bad mode → default mode).
7. `('2005', null, null)` → `{2005, light}` (era only, mode absent → light).

### 4. `initTheme` / `applyTheme` / `toggleTheme` / `setTheme`

Storage keys: `ft-era`, `ft-mode` (two independent keys). Legacy `theme` is read
for migration and left in place (non-destructive; `resolveTheme` ignores it once
new keys exist). The 🌙/☀️ button (`theme-toggle-btn`) keeps its position and
job — it flips `data-mode` only.

```js
function applyTheme(era, mode) {
  const d = document.documentElement;
  d.setAttribute('data-theme', era);
  d.setAttribute('data-mode', mode);
  localStorage.setItem('ft-era', era);
  localStorage.setItem('ft-mode', mode);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.innerHTML = mode === 'dark' ? '☀️' : '🌙';
}

function initTheme() {
  const { era, mode } = resolveTheme(
    localStorage.getItem('ft-era'),
    localStorage.getItem('ft-mode'),
    localStorage.getItem('theme')
  );
  applyTheme(era, mode);   // also persists -> completes migration on first load
}

function toggleTheme() {
  const d = document.documentElement;
  const mode = d.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
  const era = d.getAttribute('data-theme') || DEFAULT_ERA;
  applyTheme(era, mode);   // flips mode only, keeps era
}

function setTheme(era) {                          // for the picker
  const mode = document.documentElement.getAttribute('data-mode') || DEFAULT_MODE;
  applyTheme(era, mode);   // changes era only, keeps mode
}
```

`initTheme` runs from the existing `DOMContentLoaded` handler and re-applies +
persists (so migration writes `ft-era`/`ft-mode` on first upgraded load). The
`theme-toggle-btn` click listener stays wired to `toggleTheme`. Attribute reads
in `toggleTheme`/`setTheme` are already populated by the FOUC bootstrap, so both
work even before `initTheme` has run.

### 5. FOUC fix — inline `<head>` bootstrap (all 3 pages)

A tiny, self-contained inline script placed in `<head>` immediately after the
`<link rel="stylesheet" href="/css/style.css">` on `index.html`, `setup.html`,
and `watch.html`. It cannot depend on `common.js` (which loads at end of body),
so it inlines the minimal `resolveTheme` decision. It only sets attributes;
persistence/migration writes are left to `initTheme`, keeping this snippet tiny.

```html
<script>
  /* FOUC guard: set era+mode on <html> before first paint. Mirror of
     resolveTheme() in /js/common.js — keep the two in sync. */
  (function () {
    var d = document.documentElement;
    try {
      var eras = ['2005', '2009', '2014', '2021'];
      var modes = ['light', 'dark'];
      var e = localStorage.getItem('ft-era');
      var m = localStorage.getItem('ft-mode');
      var legacy = localStorage.getItem('theme');
      var era = eras.indexOf(e) >= 0 ? e : '2021';
      var mode = modes.indexOf(m) >= 0 ? m
        : (e == null && m == null && (legacy === 'dark' || legacy === 'light')) ? legacy
        : 'light';
      d.setAttribute('data-theme', era);
      d.setAttribute('data-mode', mode);
    } catch (_) {
      d.setAttribute('data-theme', '2021');
      d.setAttribute('data-mode', 'light');
    }
  })();
</script>
```

Because it runs synchronously in `<head>`, both attributes are set before the
body paints, so the correct era/mode renders on first frame. Consistency with
`resolveTheme` is maintained by the cross-reference comment in both places; a
QA/CI note (below) documents that the two must be edited together.

### 6. Theme registry

Single source of truth in `common.js`, exported. Shape:
`{ id, name, year, blurb, swatch: [surfaceColor, accentColor] }`.

```js
const THEME_REGISTRY = [
  { id: '2005', name: 'Original', year: 2005,
    blurb: 'Plain HTML, sharp corners, blue underlined links.',
    swatch: ['#ffffff', '#0000cc'] },
  { id: '2009', name: 'Classic', year: 2009,
    blurb: 'Warm grays and glossy red chrome.',
    swatch: ['#f0f0f0', '#cc0000'] },
  { id: '2014', name: 'Flat', year: 2014,
    blurb: 'Clean flat white with a brighter red.',
    swatch: ['#ffffff', '#e62117'] },
  { id: '2021', name: 'Modern', year: 2021,
    blurb: 'Rounded cards and Roboto — today\'s look.',
    swatch: ['#ffffff', '#cc0000'] }
];
```

Adding a 5th era = append one entry here + one `[data-theme="x"]` /
`[data-theme="x"][data-mode="dark"]` CSS block pair. No other code changes.

### 7. Appearance settings UI (`setup.html`)

A new `.setup-box` section (peer to the existing Library Settings box), rendering
`THEME_REGISTRY` as clickable cards. `common.js` loads before the page's inline
script, so `THEME_REGISTRY` and `setTheme` are in scope as globals.

HTML:

```html
<div class="setup-box">
  <h2>Appearance</h2>
  <p>Pick the YouTube era FileTube dresses up as. Light / dark is the
     🌙 button in the header.</p>
  <div class="theme-picker" id="theme-picker"><!-- rendered by JS --></div>
</div>
```

JS (added to the existing `setup.html` inline script, run after `loadConfig`):

```js
function renderThemePicker() {
  const container = document.getElementById('theme-picker');
  const active = document.documentElement.getAttribute('data-theme');
  container.innerHTML = THEME_REGISTRY.map(t => `
    <button type="button" class="theme-card${t.id === active ? ' active' : ''}"
            data-era="${t.id}">
      <span class="theme-swatch">
        <span style="background:${t.swatch[0]}"></span>
        <span style="background:${t.swatch[1]}"></span>
      </span>
      <span class="theme-card-name">${t.name}
        <span class="theme-card-year">${t.year}</span></span>
      <span class="theme-card-blurb">${t.blurb}</span>
    </button>`).join('');
  container.querySelectorAll('.theme-card').forEach(btn => {
    btn.addEventListener('click', () => {
      setTheme(btn.dataset.era);   // applies + persists immediately, no Save step
      renderThemePicker();          // re-highlight active card
    });
  });
}
renderThemePicker();
```

Supporting styles added to `style.css` (token-driven so the picker itself
themes correctly):

```css
.theme-picker {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}
.theme-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  padding: 12px;
  background-color: var(--card-bg);
  border: 1px solid var(--border-dark);
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--text-primary);
}
.theme-card.active { border-color: var(--yt-red); border-width: 2px; }
.theme-swatch { display: flex; height: 20px; border-radius: var(--radius); overflow: hidden; }
.theme-swatch span { flex: 1; }
.theme-card-name { font-weight: bold; font-size: 13px; }
.theme-card-year { color: var(--text-secondary); font-weight: normal; }
.theme-card-blurb { font-size: 11px; color: var(--text-secondary); }
```

### 8. Testing

- **Automated (`node:test`):** `test/unit/resolve-theme.test.js` — the 7
  `resolveTheme` cases in section 3. This is the only unit-testable logic;
  `resolveTheme` (and `THEME_REGISTRY`) are added to `module.exports`.
- **Manual visual checklist** (theming can't be judged by automated tests):
  1. All 8 era × mode combinations render coherently on `index.html`,
     `setup.html`, `watch.html` (24 renders).
  2. **No regression on 2021**: 2021/light and 2021/dark match v1.3.0 on all 3
     pages (top-priority check). Confirm the flagged intentional deltas
     (`.audio-artwork` 8→12px, `.modal-content` 4→12px) are the *only* rounding
     changes and are accepted.
  3. **Migration**: with only legacy `theme=dark` set, first load renders
     2021/dark and writes `ft-era=2021`, `ft-mode=dark`; same for `theme=light`.
  4. **FOUC**: hard-reload each page (throttled) while in a visually distinct era
     (e.g. 2005) — no flash of 2021/white before the correct theme paints.
  5. **Header toggle**: 🌙/☀️ still flips light/dark within every era and never
     changes the era; icon updates.
  6. **Picker**: active era highlighted on load; clicking applies instantly and
     persists across reload; era change keeps the current mode.
  7. **Fail-safe**: corrupt `ft-era`/`ft-mode` values fall back to 2021/light,
     attributes never left unset.

### Alternatives considered

- **Separate stylesheet per era** (`theme-2005.css`, …, swapped via `<link>`).
  Rejected: exactly the "four one-off stylesheets" the goal forbids; duplicates
  the whole sheet four times, no shared token layer, a 5th era is a full copy,
  and swapping a `<link>` reintroduces FOUC. The token approach keeps one sheet
  and makes a new era a small additive block.
- **A single combined `localStorage` key** (e.g. `"2005:dark"`). Rejected: the
  axes must be orthogonal in storage too (exec plan), and it complicates
  migration and partial-write recovery. Two independent keys are simpler and
  match the two attributes.
- **`prefers-color-scheme` to seed mode.** Rejected: explicitly out of scope
  (no OS-driven auto-switching); mode stays explicit/migrated only.

### Risks and mitigations

- **Token find-replace regression (highest).** → Do the migration line-by-line
  using the table above, land it as its own step, and run the full 2021
  light+dark regression pass *before* adding any new era (task order below).
- **FOUC on era swap.** → Inline `<head>` bootstrap sets both attributes before
  first paint on all 3 pages; verified in the manual checklist.
- **`resolveTheme` vs inline bootstrap drift.** → Both carry a cross-reference
  comment; the inline copy is intentionally minimal and covered indirectly by
  the migration/FOUC manual checks. Flag for the two-reviewer QA.
- **Invented 2005/2009 dark palettes.** → Values chosen for contrast/readability,
  not just flavor; the manual checklist reviews all dark combos explicitly.
- **Toggle semantic narrowing (mode-only).** → `toggleTheme` reads the live
  `data-theme` and re-applies it unchanged; checklist item 5 regression-tests it
  across every era and with no era ever explicitly chosen.

### Performance impact

No expected impact on any RELIABILITY.md budget. This is a client-side
CSS/attribute change: no new network requests (no new fonts, all system stacks
or the already-bundled Roboto), no server work, no change to scan/transcode/
streaming paths. The inline bootstrap is a few microseconds of synchronous JS
per page load. CSS custom-property switching re-renders with no reload.

### Ordered task breakdown (seed for the Engineering Manager)

1. **Tokenize `style.css` structurally.** Add the 7 new structural tokens to
   `:root`; migrate the 20 `border-radius` declarations, the modal `box-shadow`,
   the 3 `font-family` spots (+ the `.file-path` class for watch.html's inline
   monospace), and the 2 `--density` paddings per the find-replace tables.
2. **Restructure the mode blocks.** Create `[data-theme="2021"]` (structural +
   light) and `[data-theme="2021"][data-mode="dark"]` from the current `:root` /
   `[data-theme="dark"]` values; remove the old `[data-theme="dark"]` selector.
3. **Regression checkpoint.** Full visual pass of 2021 light + dark on all 3
   pages vs v1.3.0 — must be clean before any new era.
4. **Add 2014 Flat** CSS block pair.
5. **Add 2009 Classic** block pair + bespoke `.btn` gradient.
6. **Add 2005 Original** block pair + bespoke underlined-links rule.
7. **`common.js` logic.** Add `resolveTheme` (pure), `THEME_REGISTRY`,
   `applyTheme`/`setTheme`, rework `initTheme`/`toggleTheme`, update
   `DOMContentLoaded` wiring and `module.exports`.
8. **FOUC bootstrap.** Add the inline `<head>` script to index/setup/watch.
9. **Appearance UI.** Add the setup.html section + picker render/click wiring +
   `.theme-picker` styles.
10. **Tests + QA.** Write `test/unit/resolve-theme.test.js` (7 cases); run the
    full manual visual checklist (8 combos × 3 pages, migration, FOUC,
    no-regression, toggle, picker, fail-safe).

## Task breakdown

(To be filled by engineering-manager)

## Testability

Theming is fundamentally a visual/CSS concern. There is no meaningful way for
`node:test` (or any automated test) to judge whether 2005 Original "looks
right" — that verification is manual/visual, browser-checked across all 8
era×mode combinations and all 3 pages. Call this out explicitly rather than
inventing brittle pixel-diff tests.

The one piece of genuinely pure, unit-testable logic: the storage
resolution/migration function. Extract it as a pure helper (e.g.
`resolveTheme(storedEra, storedMode, legacyTheme)` returning `{ era, mode }`)
in `public/js/common.js`, exported the same way `getStarRating` etc. already
are, and covered with `node:test`. At minimum, cover:

1. Nothing stored at all → default era (2021), default mode (light).
2. Legacy `theme` = `dark` only → default era (2021), mode `dark`.
3. Legacy `theme` = `light` only → default era (2021), mode `light`.
4. New era + mode keys already present → returned as-is, legacy key ignored
   even if it's also present (post-migration state).
5. Stored era is an unrecognized value → falls back to default era.
6. Stored mode is an unrecognized value → falls back to default mode
   (`light`).
7. Era present, mode key absent entirely → mode defaults to `light` rather
   than throwing/undefined.

Everything else (attribute application, DOM updates, picker rendering,
per-era visual correctness) is verified by running the app and checking each
page in each of the 8 combinations.

## Risks

1. **Token find-replace regression (highest risk).** Migrating ~25 hardcoded
   `border-radius` values and 3+ hardcoded `font-family` declarations onto
   new tokens across a large, un-preprocessed `style.css` is a broad,
   mechanical edit with real potential to subtly change spacing/rounding on
   elements the migration didn't intend to touch. Needs careful line-by-line
   review, not a blind find-replace, and a full visual pass of the *current*
   (2021/light and 2021/dark) look before touching any new era.
2. **FOUC.** Theme init currently runs from a `<script>` at the bottom of
   `<body>` via `common.js`'s `DOMContentLoaded` listener — adequate when
   light/dark are visually close, much riskier once a full era swap (e.g.
   defaulting a returning 2005-era user) is on the table. Needs to run before
   first paint.
3. **Invented palettes.** 8 total palettes (4 eras × 2 modes) is a lot of
   original color design; "2005 dark" and "2009 dark" have no historical
   reference (the real 2005/2009 YouTube had no dark mode) — these are
   necessarily invented and should be reviewed for actual usability
   (contrast, readability), not just retro flavor.
4. **Header toggle semantic change.** `toggleTheme()` currently reads/writes
   a single `theme` key and attribute; redefining it to touch only
   `data-mode` while a separate mechanism owns `data-theme` is a behavior
   change to an existing, working control — regression-test it deliberately
   (does it still work with no era ever explicitly chosen? with every era?).
5. **Migration edge cases.** Partial/mixed storage states (legacy key present
   alongside a partially-set new key, only one of the two new keys present,
   garbage/corrupted values from manual localStorage edits or a previous
   failed write) must all fail safe rather than crash or silently reset to
   an unexpected combination.

## Non-goals / v1 scope (recap)

- Exactly 4 eras ship; the system is built to make a 5th mechanical, but no
  5th theme is included.
- No per-page theme, no auto-switching (time-of-day or OS-driven).
- No dynamic `<meta name="theme-color">` updates (deferred, see Out of scope).

## QA note

This branch touches shared, load-bearing CSS (`style.css`'s token layer) used
by every page and every existing feature, plus a core, frequently-exercised
piece of client bootstrap logic (`initTheme`). It requires a significant
two-reviewer QA pass before acceptance, specifically checking:

1. The token migration does **not** regress the current (v1.3.0) 2021
   Modern light/dark look — this is the top-priority regression check.
2. Migration correctness for existing `theme=light`/`theme=dark` users (no
   flash, no unexpected era change).
3. No FOUC on any of the 3 pages, on first load and on repeat visits.
4. All 8 era×mode combinations render coherently on all 3 pages (manual
   visual pass — not automatable).

## Progress log

- 2026-07-04: Discovery complete. Exec plan drafted from the bootstrapped
  feature description plus a read of the current token system
  (`public/css/style.css` `:root`/`[data-theme="dark"]`, ~25 hardcoded
  `border-radius` values, 3 hardcoded `font-family` declarations),
  `initTheme`/`toggleTheme` in `public/js/common.js`, and the header/
  setup-page structure across `index.html`/`setup.html`/`watch.html`. No
  conflicts found with active exec plans (none exist besides this one) or
  the tech-debt tracker (Closed #1 is unrelated transcode-cache work). No
  out-of-scope item here conflicts with `docs/CONTRIBUTING.md`'s
  every-feature-ships-with-tests rule — the pure migration/resolution
  function is explicitly brought into test scope precisely because it's the
  one piece of this feature that *is* testable; everything else is correctly
  scoped as manual/visual verification, not deferred testing.

## Decision log

- 2026-07-04: Recommended default/migration era = **2021 Modern**, not 2009
  Classic or any other era, because it is a lossless representation of
  today's shipped look — the only choice that guarantees zero visual
  surprise for existing users on upgrade and for new users with no stored
  preference at all.
- 2026-07-04: `<meta name="theme-color">` dynamic updates explicitly
  deferred out of scope rather than silently assumed in or out — flagged
  for a future, separable pass.
