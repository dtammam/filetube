<!-- COMPLETED — Shipped v1.6.0 (2026-07-05). Archived from docs/exec-plans/active/.
     Real emoji-to-Material-Symbols chrome-icon swap: 12 self-hosted Apache-2.0
     Outlined SVGs rendered via CSS mask-image + background-color:currentColor,
     themed across all 8 era x mode combos; gold ★ ratings untouched. Two-reviewer
     QA APPROVE-WITH-NITS; code-review caught + fixed an icon-only-button a11y
     regression (aria-labels), @supports mask fallback, squared sidebar icon box,
     and added CI tests (bundled SVGs / no-CDN / no-stray-emoji / served-200). -->

# Real Icon Assets (Icon Assets, v1.6.0)

## Goal

Replace every emoji-based chrome icon in FileTube with self-hosted Google
Material Symbols (Outlined, Apache-2.0), themed via `currentColor`, rendering
correctly across all 8 era × mode theme combos, fully offline — no CDN,
mirroring how Roboto (`public/fonts/roboto.woff2`) is already self-hosted.

## Context — current state (grounded in code)

### The `.icon-*` class inventory (`public/css/style.css:1327-1337`)

```css
.icon-play::before { content: "▶"; }
.icon-delete::before { content: "🗑"; }
.icon-cog::before { content: "⚙"; }
.icon-search::before { content: "🔍"; }
.icon-moon::before { content: "🌙"; }
.icon-sun::before { content: "☀️"; }
.icon-folder::before { content: "📁"; }
.icon-home::before { content: "🏠"; }
.icon-menu::before { content: "☰"; }
.icon-star::before { content: "★"; }
```

These are consumed today as `<i class="icon-x"></i>` markup. Actual current
consumers, found by grepping `public/*.html` and `public/js/*.js`:

| Class | Consumers |
|---|---|
| `icon-cog` | `index.html:56,68`; `setup.html:59,126`; `watch.html:56,68,233` (Settings links/sidebar/bottom-nav, all 3 pages) |
| `icon-home` | `index.html:65`; `setup.html:56,114`; `watch.html:65,221` (sidebar Home links + bottom-nav) |
| `icon-folder` | `common.js:245`, `main.js:97`, `watch.js:1030`, `setup.html:118,241` (sidebar folder rows + bottom-nav Playlists) |
| `icon-delete` | `watch.html:157` (Delete File button) |
| `icon-moon` | Bottom-nav initial markup, `index.html:121`, `setup.html:122`, `watch.html:229`; toggled by `common.js:285` (`updateNavThemeItem`) |
| `icon-sun` | Only ever set dynamically by `common.js:285` (swapped in when `data-mode="dark"`) |
| `icon-play`, `icon-search`, `icon-menu`, `icon-star` | **No `<i class="icon-x">` consumers found anywhere.** These classes exist in CSS but are currently dead — see "Findings" below. |

### Raw inline emoji NOT using the `.icon-*` system (the actual bulk of this feature)

| Site | Code | Current glyph | Purpose |
|---|---|---|---|
| `index.html:57`, `setup.html:48`, `watch.html:57` | `<button class="theme-toggle" id="theme-toggle-btn">🌙</button>` | 🌙 (static initial markup, all 3 page headers) | Desktop header theme toggle |
| `common.js:62` (`applyTheme`) | `if (btn) btn.innerHTML = mode === 'dark' ? '☀️' : '🌙';` | 🌙/☀️ | Same button, flipped on every theme change |
| `index.html:100` | `<button ... id="rescan-library-btn" ...>🔄 Rescan Files</button>` | 🔄 (static) | Rescan button, home page only |
| `main.js:213` | `rescanBtn.textContent = '🔄 Scanning...';` | 🔄 | Rescan in-progress state |
| `main.js:222`, `main.js:228` | `rescanBtn.textContent = '🔄 Rescan Files';` | 🔄 | Rescan reset (success path / catch path) |
| `setup.html:185` | `<button class="reorder-btn" data-dir="up" ...>▲</button>` | ▲ | Folder reorder "Move up" |
| `setup.html:187` | `<button class="reorder-btn" data-dir="down" ...>▼</button>` | ▼ | Folder reorder "Move down" |

### Finding: the hamburger menu-toggle is a related, pre-existing inconsistency

`index.html:41`, `setup.html:41`, `watch.html:41`:
`<button class="menu-toggle" id="menu-toggle">☰</button>` — a raw inline "☰"
glyph, **not** using the `.icon-menu` class that already exists in CSS (and
has zero other consumers). This predates this feature. `☰` already inherits
`color: var(--text-primary)` from `.menu-toggle` today (it's plain text, not
a color-emoji glyph), so it isn't currently theme-broken — but it's the exact
kind of chrome glyph this feature is meant to normalize, and `.icon-menu`
already has a real slot waiting for it. **Decision: bring it into scope.**
Swap the raw `☰` for `<i class="icon-menu"></i>` in all three pages. Low
risk: the click handler (`common.js:328`, `menuToggle.addEventListener`) only
toggles sidebar/main-content classes and never reads or writes the button's
text content, so this is a pure markup swap.

### Explicitly confirmed OUT OF SCOPE (gold star ratings)

- `watch.html:147-151` — `<span class="star" data-value="N">★</span>` × 5
  (interactive-looking but read-only rating display; styled by `.star` /
  `.star.active` using `--star-gold` / `--star-gray` tokens).
- `main.js:170` — `.card-rating` with `<span class="on">★★★</span><span
  class="off">☆☆</span>` (deterministic per-card rating from
  `getStarRating(id)`, shipped in `avi-ux-refinement`/v1.5-era work).
- `.icon-star::before { content: "★"; }` in `style.css:1337` — also has no
  `<i class="icon-star">` consumers; the real stars above don't use it either.

Confirmed: these are a rating indicator, not navigational/chrome iconography.
Per the feature description they stay **gold** (`--star-gold`/`--star-gray`
tokens), not `currentColor`-themed, and are not touched by this feature. The
`icon-star` CSS class is dead code and is out of scope to wire up or remove
(no behavior depends on it either way; leaving it as literal `★` content is
harmless and consistent with "don't touch the star system").

### Explicitly confirmed OUT OF SCOPE (unrelated glyphs, not emoji-chrome)

- `watch.html:112` `2× ▶▶` (speed badge) and `watch.html:117,120` `«`/`»`
  (skip ±15s guillemets, `.skip-arrow`) — typographic symbols for player
  controls, not part of the `.icon-*` system, not raised in the feature
  request. No change.

### Theming — confirm `currentColor` inheritance path

`.bottom-nav-item i { font-size: 20px; line-height: 1; color: inherit; }`
(`style.css:1431-1435`) and `.sidebar-item i { color: var(--text-secondary);
}` (`style.css:459-464`) already resolve to theme tokens
(`--text-primary`/`--text-secondary`/`--yt-red` for `.active`) across all 4
`data-theme` eras × 2 `data-mode`s defined in `style.css:14-215`. Any new
mask-image-based icon that reads `background-color: currentColor` will
inherit exactly this chain with no extra plumbing — confirmed no icon
consumer sets an explicit `color` that would fight this.

### Offline bundling precedent

`public/fonts/roboto.woff2` + `public/fonts/README.md` (Apache-2.0
attribution) is self-hosted with **no** `@import` or `<link>` to
`fonts.googleapis.com`/`fonts.gstatic.com`. `Dockerfile:18` does
`COPY public/ ./public/` — the entire `public/` tree ships into the image
verbatim, so any new `public/assets/icons/*.svg` files or a new
`public/assets/icons/README.md` ship automatically; no Dockerfile change is
needed.

## Scope

- Replace all 10 `.icon-*` CSS classes' glyph rendering with self-hosted
  Material Symbols (Outlined), themed via `currentColor`.
- Replace the 7 raw inline emoji/glyph sites above (theme toggle × 3 pages +
  1 JS setter, rescan × 1 page + 3 JS setters, reorder × 2 buttons) with
  `.icon-*` classes.
- Fold the hamburger `☰` (`#menu-toggle`, 3 pages) into the `.icon-menu` class
  (see Finding above).
- Add 3 new icon classes needed to cover glyphs that have no existing
  `.icon-*` slot: `icon-refresh` (🔄), `icon-arrow-up` (▲), `icon-arrow-down`
  (▼).
- Bundle the needed SVGs into the repo, ship them in the Docker image, add
  Apache-2.0 attribution.
- Update `common.js` (`applyTheme`, theme-toggle-btn) and `main.js` (rescan
  button states) so they toggle an icon class/markup instead of injecting an
  emoji character — while preserving `toggleTheme()`/`applyTheme()`/
  `updateNavThemeItem()` behavior exactly (mode/era switching logic is
  unchanged; only how the glyph is rendered changes).
- Verify no existing `<i class="icon-x">` usage breaks, across all pages and
  all 8 theme combos.

## Out of scope

- The gold `★`/`☆` rating system (`watch.html` `.star` spans, `main.js`
  `.card-rating`, and the dead `icon-star` CSS class) — stays exactly as-is,
  gold-specific, not `currentColor`-themed.
- `watch.html` speed badge (`2× ▶▶`) and skip-control guillemets (`«`/`»`) —
  unrelated player-control typography, not chrome iconography, not emoji.
- Any new icons beyond a 1:1 replacement of what's enumerated above (no
  icon-driven UI additions).
- Any per-era *style* variation in the icon set — one Outlined family
  serves all 4 eras × 2 modes; only color changes via `currentColor`.
- Any change to theme-switching *logic* (`resolveTheme`, `initTheme`,
  `toggleTheme`, `setTheme`, the FOUC inline scripts) — only how the toggle
  button's glyph is rendered changes.
- Adding a Material Symbols *web font* or any Google Fonts CDN reference —
  this feature uses individual SVG assets, not the Material Symbols icon
  font, so there is no font-loading mechanism to introduce at all.

## Constraints

- **Fully offline**: no runtime request to `fonts.gstatic.com`,
  `fonts.googleapis.com`, or any other CDN for icons. All SVG assets live in
  the repo and ship inside the Docker image via the existing `COPY public/
  ./public/` step (no Dockerfile change).
- **License**: Material Symbols are Apache License 2.0 (Google) — bundle an
  attribution file (e.g. `public/assets/icons/README.md`) mirroring the
  existing `public/fonts/README.md` pattern (license, source, "included
  unmodified" note).
- **API compatibility**: existing `<i class="icon-x">` markup must keep
  working unmodified wherever it isn't explicitly listed for a markup change
  above — this is a CSS-rendering swap, not a markup rewrite, except at the
  7 raw-emoji + 1 hamburger sites called out in Scope.
- **Theming**: icons must render in the current theme's text color via
  `currentColor` (not a hardcoded fill), consistent size, and align on the
  baseline with adjacent text/labels, across all 4 eras × 2 modes (8 combos
  total).
- **No functional change**: this is additive/visual — no route, API, or
  persisted-data changes. `toggleTheme()`/`applyTheme()`/`setTheme()`/
  `resolveTheme()`/`updateNavThemeItem()` semantics are unchanged.
- Per `docs/CONTRIBUTING.md`, every feature ships with tests — see
  Testability below for what is and isn't automatable here.

## Acceptance criteria

**Icon set / mapping**
- [x] Every current emoji/glyph used by a `.icon-*` class has a named
  Material Symbols Outlined replacement (mapping table below); no `.icon-*`
  class is left rendering its old emoji `content`.
- [x] The 3 new classes (`icon-refresh`, `icon-arrow-up`, `icon-arrow-down`)
  exist and are documented alongside the original 10.

**Delivery mechanism**
- [x] `.icon-*` classes render via `mask-image` (or equivalent
  currentColor-driven technique) over self-hosted SVG assets +
  `background-color: currentColor`, not `content: "<emoji>"`.
- [x] Icons render in the current theme's text color with no hardcoded fill,
  verified via a `currentColor`/token inheritance path (e.g.
  `.sidebar-item i`, `.bottom-nav-item i`) across all 8 era×mode combos.
- [x] Icon size is consistent across all consumers of a given class, and
  icons align on the baseline with adjacent text/labels (no visible vertical
  offset vs. today's glyph rendering).
- [x] Existing `<i class="icon-x">` markup that isn't explicitly rewritten
  above continues to render its icon, unchanged, everywhere it currently
  appears (Settings/Home/Folder/Delete/moon-sun across index/setup/watch and
  the bottom nav).

**Bundling / offline**
- [x] SVG assets (or the data driving `mask-image`) live in the repo under
  version control and are shipped inside the Docker image (verified: no
  `Dockerfile` change needed since `COPY public/ ./public/` already covers
  new files).
- [x] No network reference to `fonts.gstatic.com`, `fonts.googleapis.com`, or
  any other external icon/font CDN anywhere in `public/`.
- [x] Icons render correctly with the container's network access disabled
  (offline check).
- [x] An Apache-2.0 attribution file exists for the bundled icon set,
  mirroring `public/fonts/README.md`.

**Emoji removal**
- [x] The 3 static `🌙` sites (`index.html:57`, `setup.html:48`,
  `watch.html:57`) render `<i class="icon-moon">`/`<i class="icon-sun">`
  instead of a literal emoji character.
- [x] `common.js` `applyTheme` sets/swaps the icon class (mirroring the
  existing `updateNavThemeItem` pattern) instead of `btn.innerHTML =
  '☀️'/'🌙'`.
- [x] The rescan button (`index.html:100` + all 3 `main.js` state strings)
  renders `<i class="icon-refresh">` instead of `🔄`, in all three states
  (idle "Rescan Files", "Scanning...", and the error-reset path).
- [x] Both folder-reorder buttons (`setup.html:185,187`) render `<i
  class="icon-arrow-up">`/`<i class="icon-arrow-down">` instead of `▲`/`▼`,
  with `title="Move up"`/`title="Move down"` preserved for accessibility.
- [x] The hamburger (`#menu-toggle`, all 3 pages) renders `<i
  class="icon-menu">` instead of the literal `☰` character.
- [x] Zero chrome emoji/glyph characters (🌙 ☀️ 🔄 ▲ ▼ ☰) remain anywhere in
  `public/*.html` or `public/js/*.js`, **except** the gold `★`/`☆` rating
  display, which is explicitly kept.

**No regression**
- [x] `toggleTheme()`, `applyTheme()`, `setTheme()`, `resolveTheme()`, and
  `updateNavThemeItem()` behave identically to today (mode/era persistence,
  FOUC-guard behavior, bottom-nav Dark/Light label sync) — only the glyph
  render path changed.
- [x] Rescan button's `disabled`/click/fetch/reload/alert behavior in
  `main.js` is unchanged — only the string it renders changed from
  `textContent` (emoji+text) to icon+text markup.
- [x] Folder reorder swap logic (`setup.html`'s `reorder-btn` click handler)
  is unchanged — only the button's inner glyph changed.
- [x] Visual check across index.html, setup.html, watch.html, and the mobile
  bottom nav: nothing is missing, duplicated, or misaligned relative to
  today's emoji baseline.

## Design

(To be filled by principal-engineer. Flagging one concrete sizing concern
found during discovery: the reorder buttons in `setup.html:184-187` are
currently sized via `font-size: 10px` inline styles, because `▲`/`▼` are text
glyphs. A `mask-image`-based icon is not sized by `font-size` — the design
must specify explicit `width`/`height` (or an `em`-based sizing rule on a
shared `[class^="icon-"]` base selector) so these small reorder buttons don't
end up oversized or invisible-at-10px.)

## Technical Design

### Approach

Re-implement the ten `.icon-*` classes (minus `icon-star`) as CSS `mask-image`
over self-hosted Material Symbols Outlined SVGs, with `background-color:
currentColor`. The SVG is used only as an alpha **mask**: its own black fill is
irrelevant (a solid shape = a fully-opaque mask), and the visible pixels are
painted with `currentColor`. Because every icon consumer already resolves
`color` from the theme tokens (`.sidebar-item i` → `--text-secondary`,
`.bottom-nav-item i` → `inherit` → `--text-primary`/`--yt-red` (active),
`.btn`/`.theme-toggle`/`.menu-toggle` → `--text-primary`), the icons theme
across all eight era×mode combos with **zero per-theme rules**. This is a pure
CSS-rendering swap plus a handful of markup/JS edits at the raw-emoji sites; all
existing `<i class="icon-x">` markup keeps working unmodified.

Assets are file-based SVGs under `public/assets/icons/` (not data-URIs), mirroring
the `public/fonts/` precedent — more auditable, diff-friendly, and license-clean;
the extra static requests are irrelevant for a home-LAN app. `Dockerfile:18`'s
`COPY public/ ./public/` ships them with no Dockerfile change.

`icon-star` is deliberately **excluded** from the mask group and keeps its
literal `content: "★"` rule so nothing in the gold-rating system is disturbed
(see Risk: star contamination).

### Component changes

- **`public/assets/icons/` (new dir)**: bundle 12 Material Symbols Outlined
  SVGs (see asset list). Add `public/assets/icons/README.md` (Apache-2.0
  attribution, mirroring `public/fonts/README.md`).
- **`public/css/style.css:1327-1337`**: replace the ten `content:"<emoji>"`
  rules with a shared mask base rule + per-icon `mask-image`, plus three new
  classes (`icon-refresh`, `icon-arrow-up`, `icon-arrow-down`). Keep
  `icon-star::before { content:"★"; }` unchanged.
- **`public/js/common.js` `applyTheme` (line 62)**: swap the emoji `innerHTML`
  for an `<i class="icon-sun/moon">` fragment. `updateNavThemeItem` (line 285)
  already sets `icon.className = 'icon-sun'|'icon-moon'` — **no change needed**.
- **`public/js/main.js` (lines 213/222/228)**: change `rescanBtn.textContent`
  (emoji + text) to `rescanBtn.innerHTML` (`<i class="icon-refresh"></i>` +
  text) in all three states.
- **`public/index.html` / `public/setup.html` / `public/watch.html`**: replace
  the static `🌙` in `#theme-toggle-btn`, the static `☰` in `#menu-toggle`, and
  (index only) the `🔄` in `#rescan-library-btn`; replace `▲`/`▼` in
  `setup.html`'s reorder buttons and fix their inline sizing.

### Asset list (bundle under `public/assets/icons/`)

Source template (Apache-2.0, confirmed fetchable):
`https://raw.githubusercontent.com/google/material-design-icons/master/symbols/web/<name>/materialsymbolsoutlined/<name>_24px.svg`

Save each as `public/assets/icons/<local>.svg`:

| Material Symbol `<name>` | Local file | Class |
|---|---|---|
| `home` | `home.svg` | `icon-home` |
| `folder` | `folder.svg` | `icon-folder` |
| `settings` | `settings.svg` | `icon-cog` |
| `delete` | `delete.svg` | `icon-delete` |
| `dark_mode` | `dark_mode.svg` | `icon-moon` |
| `light_mode` | `light_mode.svg` | `icon-sun` |
| `menu` | `menu.svg` | `icon-menu` |
| `search` | `search.svg` | `icon-search` (dead class, bundled for API completeness) |
| `play_arrow` | `play_arrow.svg` | `icon-play` (dead class, bundled for API completeness) |
| `refresh` | `refresh.svg` | `icon-refresh` (new) |
| `keyboard_arrow_up` | `keyboard_arrow_up.svg` | `icon-arrow-up` (new) |
| `keyboard_arrow_down` | `keyboard_arrow_down.svg` | `icon-arrow-down` (new) |

Twelve files (no `star` — out of scope). Verify each downloaded file is a
single-path outline with no baked color that could fight the mask (a `fill`
attribute is harmless since the shape is used only as a mask, but prefer the
unmodified Outlined source).

### The `.icon-*` CSS rewrite

Replace lines 1328-1336 with a shared base (icons **explicitly enumerated** —
not a `[class^="icon-"]` wildcard — so `icon-star` can never be swept into the
mask/`currentColor` system):

```css
/* Chrome icons: Material Symbols Outlined SVG used as an alpha mask, painted
   in currentColor so they theme across all era x mode combos automatically.
   NOTE: icon-star is intentionally NOT in this group (gold rating, stays ★). */
.icon-home,
.icon-folder,
.icon-cog,
.icon-delete,
.icon-moon,
.icon-sun,
.icon-menu,
.icon-search,
.icon-play,
.icon-refresh,
.icon-arrow-up,
.icon-arrow-down {
  display: inline-block;
  width: 1em;
  height: 1em;
  vertical-align: -0.15em;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}

.icon-home { -webkit-mask-image: url(/assets/icons/home.svg); mask-image: url(/assets/icons/home.svg); }
.icon-folder { -webkit-mask-image: url(/assets/icons/folder.svg); mask-image: url(/assets/icons/folder.svg); }
.icon-cog { -webkit-mask-image: url(/assets/icons/settings.svg); mask-image: url(/assets/icons/settings.svg); }
.icon-delete { -webkit-mask-image: url(/assets/icons/delete.svg); mask-image: url(/assets/icons/delete.svg); }
.icon-moon { -webkit-mask-image: url(/assets/icons/dark_mode.svg); mask-image: url(/assets/icons/dark_mode.svg); }
.icon-sun { -webkit-mask-image: url(/assets/icons/light_mode.svg); mask-image: url(/assets/icons/light_mode.svg); }
.icon-menu { -webkit-mask-image: url(/assets/icons/menu.svg); mask-image: url(/assets/icons/menu.svg); }
.icon-search { -webkit-mask-image: url(/assets/icons/search.svg); mask-image: url(/assets/icons/search.svg); }
.icon-play { -webkit-mask-image: url(/assets/icons/play_arrow.svg); mask-image: url(/assets/icons/play_arrow.svg); }
.icon-refresh { -webkit-mask-image: url(/assets/icons/refresh.svg); mask-image: url(/assets/icons/refresh.svg); }
.icon-arrow-up { -webkit-mask-image: url(/assets/icons/keyboard_arrow_up.svg); mask-image: url(/assets/icons/keyboard_arrow_up.svg); }
.icon-arrow-down { -webkit-mask-image: url(/assets/icons/keyboard_arrow_down.svg); mask-image: url(/assets/icons/keyboard_arrow_down.svg); }

/* Out of scope: gold rating star — NOT a mask/currentColor icon. Leave as-is. */
.icon-star::before { content: "★"; }
```

Both `mask-*` and `-webkit-mask-*` are specified for Safari/iOS (WebKit still
requires the prefix). Sizing is **em-relative** (`width/height: 1em`) so each
icon inherits its context's `font-size` — this is what makes the same class
render correctly in every consumer with no per-context width. `vertical-align:
-0.15em` sits the icon on the text baseline for icon-before-text contexts
(Settings/Delete buttons, sidebar rows). No `content`/`::before` is used for the
masked icons — the mask paints the `<i>` box directly.

### Sizing / alignment per context (all em-driven; no new width overrides needed)

The `font-size` already set on each icon container drives the mask size:

- `.sidebar-item i` (`style.css:459-464`): `font-size: 16px` → 16px icons.
  Note `.sidebar-item i { width: 18px }` (specificity 0-0-1-1) overrides the
  base `width: 1em`; `mask-size: contain` preserves aspect, so the glyph sits
  centered in an 18×16 box — visually identical spacing to today. Harmless;
  leave as-is.
- `.bottom-nav-item i` (`style.css:1431-1435`): `font-size: 20px` → 20px icons,
  `color: inherit` picks up `--text-primary`/`--yt-red` (active). No override
  needed; the em size already matches the previous 20px emoji. (If QA wants them
  visually larger, add `.bottom-nav-item i { width: 22px; height: 22px; }` — but
  keep parity with today unless a reviewer asks.)
- `.theme-toggle` (`font-size: 18px`) and `.menu-toggle` (`font-size: 20px`):
  header buttons size their `<i>` at 18px/20px. Good.
- `.btn` (Settings link, Delete, Rescan): icon = 1em of the button font,
  aligned via `vertical-align: -0.15em`, matching adjacent label text.

### Theme-toggle JS rewrite (`common.js` `applyTheme`, line 62)

Change:

```js
if (btn) btn.innerHTML = mode === 'dark' ? '☀️' : '🌙';
```

to:

```js
if (btn) {
  btn.innerHTML = mode === 'dark'
    ? '<i class="icon-sun"></i>'
    : '<i class="icon-moon"></i>';
}
```

This is the only line that changes. `resolveTheme`, `initTheme`, `toggleTheme`,
`setTheme`, and the FOUC bootstrap are untouched — `applyTheme` is still the
single sink that reflects mode into the button, and `initTheme`/`applyTheme`
run on load so the static header markup is corrected immediately (no FOUC of the
wrong icon beyond the existing attribute-application timing). `updateNavThemeItem`
(line 285) already toggles `icon.className` between `icon-sun`/`icon-moon` and
needs **no change** — it will now render real masked icons for free.

Static header markup (all three pages) becomes the light-mode default
`<button class="theme-toggle" id="theme-toggle-btn"><i class="icon-moon"></i></button>`;
`initTheme` → `applyTheme` overwrites it to the correct icon on load.

### Raw-emoji replacements (exact edits)

- **Theme toggle** — `index.html:57`, `setup.html:48`, `watch.html:57`:
  `🌙` → `<i class="icon-moon"></i>` inside `#theme-toggle-btn`.
- **Hamburger** — `#menu-toggle` (all 3 pages, line 41): `☰` →
  `<i class="icon-menu"></i>`. Click handler (`common.js:328`) never reads
  button text — pure markup swap.
- **Rescan static** — `index.html:100`: `🔄 Rescan Files` →
  `<i class="icon-refresh"></i> Rescan Files` (keep the text).
- **Rescan JS** — `main.js:213/222/228`: switch `.textContent` to `.innerHTML`:
  `rescanBtn.innerHTML = '<i class="icon-refresh"></i> Scanning...';` and
  `rescanBtn.innerHTML = '<i class="icon-refresh"></i> Rescan Files';` (both
  reset paths). `disabled`/fetch/reload/alert behavior is otherwise unchanged.
- **Reorder** — `setup.html:185/187`: `▲` → `<i class="icon-arrow-up"></i>`,
  `▼` → `<i class="icon-arrow-down"></i>`, `title="Move up"`/`"Move down"`
  preserved. **Sizing fix**: the inline `font-size:10px` was correct for a text
  glyph but would render the em-sized mask icon at a tiny 10px. Change the
  inline `font-size:10px` to `font-size:16px` on both reorder buttons so the
  mask icon renders at a sensible 16px (padding `2px 6px` stays; the buttons
  remain compact). The `reorder-btn` click/swap handler is untouched.

### Data model changes

None.

### API changes

None. No route, endpoint, or persisted-key change; the `.icon-*` class contract
is preserved (same class names, same `<i class="icon-x">` markup).

### Alternatives considered

- **Inline SVG `<svg>` markup in each HTML site** instead of CSS mask: gives
  crisp per-icon control but forces a markup rewrite at *every* consumer (dozens
  of sites across 3 HTML files + JS), breaking the existing `.icon-*` class
  contract and bloating the pages. Rejected — the mask approach keeps the class
  contract and touches one CSS block.
- **Data-URI masks embedded in `style.css`**: zero extra requests and one file
  to ship, but base64 SVGs are unreviewable in diffs, harder to attribute
  cleanly, and diverge from the `public/fonts/` file-based precedent. Rejected
  for auditability; the extra static GETs are meaningless on a LAN app.
- **Material Symbols web font (variable icon font)**: the "normal" way to use
  the set, but pulls in a font-loading mechanism and (typically) a Google Fonts
  CDN reference — directly violates the offline constraint. Rejected; per-icon
  SVGs need no font machinery at all.

### Risks and mitigations

- **Risk (star contamination)**: `icon-star` lives in the same rewritten block;
  wiring it into the mask/`currentColor` group would break "stars stay gold". →
  **Mitigation**: the base rule enumerates icons explicitly (no `[class^=]`
  wildcard) and `icon-star::before { content:"★"; }` is kept verbatim with a
  comment. Reviewers must confirm no star span/`.card-rating` was touched.
- **Risk (currentColor miss / black box)**: a mis-scoped rule or a
  color-fill-dependent SVG could render solid black regardless of theme. →
  **Mitigation**: `background-color: currentColor` + mask means the SVG's own
  fill is irrelevant; verify with the 8-combo manual checklist (2005/dark is the
  sharpest tell).
- **Risk (theme-critical JS)**: `applyTheme` runs on every page load and mode
  switch; a mistake breaks every page. → **Mitigation**: change is one
  `innerHTML` line, no control-flow change; verify toggle round-trips
  moon↔sun on header and bottom-nav across pages.
- **Risk (reorder sizing)**: leaving `font-size:10px` renders the mask icon at
  10px (near-invisible). → **Mitigation**: explicit `font-size:16px` fix
  specified above; verify in setup.html with 3+ folders incl. disabled states.
- **Risk (missed emoji)**: implementer leaves a stray glyph. → **Mitigation**:
  final grep for `🌙☀️🔄▲▼☰🏠📁⚙🗑🔍▶` across `public/` (see tests) must return
  only the gold `★`/`☆` rating sites.

### Performance impact

No expected impact on performance budgets. Twelve small static SVGs (a few KB
total) add negligible image weight and Docker-image size; masks are GPU-cheap
and render once per icon. No JS hot-path or request-latency change.

### Tests

CI-checkable (the only automatable seams — the rest is manual/visual):

- **Assets served**: each `/assets/icons/<name>.svg` referenced by `style.css`
  returns HTTP 200 (a small `node:test` hitting the static server, or verify the
  files exist under `public/assets/icons/`).
- **No CDN references**: `grep -r` for `fonts.googleapis.com` / `fonts.gstatic.com`
  (and any `http`-scheme icon/font host) across `public/` returns **0** matches.
- **No stray chrome emoji**: `grep` for `🌙☀️🔄▲▼☰🏠📁⚙🗑🔍▶` across `public/*.html`
  and `public/js/*.js` returns only the gold `★`/`☆` rating sites (which are
  none of those glyphs) — i.e. zero chrome-emoji matches.
- **Lint**: `npm run lint` passes with zero warnings; markdownlint clean on this
  exec plan.

Manual (required, two-reviewer QA — full checklist in Testability above):
per-icon render × 8 era×mode combos × index/setup/watch + bottom nav; theme
toggle round-trip (header + nav item, icon↔label sync); rescan 3 states; reorder
up/down incl. disabled rows; baseline alignment vs. adjacent text; offline
reload with egress blocked.

### Build order

1. Fetch the 12 Material Symbols Outlined SVGs into `public/assets/icons/`
   (exact names in the asset list).
2. Add `public/assets/icons/README.md` — Apache-2.0 attribution mirroring
   `public/fonts/README.md`.
3. Rewrite the `.icon-*` block in `style.css`: shared mask base rule (explicit
   selector list) + per-icon `mask-image`; keep `icon-star::before` verbatim.
4. Swap `applyTheme` (`common.js:62`) to emit `<i class="icon-sun/moon">`;
   confirm `updateNavThemeItem` needs no change.
5. Raw-emoji replacements: theme-toggle `🌙` (3 pages), hamburger `☰` (3 pages),
   rescan `🔄` (index.html + main.js 3 states via `.innerHTML`), reorder `▲`/`▼`
   (setup.html) + change inline `font-size:10px` → `16px`.
6. Verify: assets 200, no-CDN grep = 0, no stray chrome-emoji grep, `npm run
   lint` clean.
7. Manual 8-combo × 3-page visual checklist + offline reload.

## Task breakdown

(Executed by engineering-manager during the tasks stage; all tasks built,
verified, and reviewed — see Progress log.)

## Icon mapping reference (for design/build)

| `.icon-*` class | Old glyph | Material Symbol (Outlined) | Status |
|---|---|---|---|
| `icon-home` | 🏠 | `home` | Active — sidebar + bottom-nav |
| `icon-folder` | 📁 | `folder` | Active — sidebar rows + bottom-nav |
| `icon-cog` | ⚙ | `settings` | Active — Settings links, all pages |
| `icon-delete` | 🗑 | `delete` | Active — watch.html delete button |
| `icon-moon` | 🌙 | `dark_mode` | Active — bottom-nav + (new) header toggle |
| `icon-sun` | ☀️ | `light_mode` | Active — swapped in by `updateNavThemeItem`/`applyTheme` |
| `icon-menu` | ☰ | `menu` | Currently dead class; brought into use for `#menu-toggle` |
| `icon-search` | 🔍 | `search` | Currently dead class; no consumer today — bundle for API completeness, no new consumer added |
| `icon-play` | ▶ | `play_arrow` | Currently dead class; no consumer today — bundle for API completeness, no new consumer added |
| `icon-star` | ★ | **N/A — out of scope** | Dead class; gold rating stars use raw `★`/`☆`, untouched |
| `icon-refresh` *(new)* | 🔄 | `refresh` | New — rescan button, all states |
| `icon-arrow-up` *(new)* | ▲ | `keyboard_arrow_up` | New — folder reorder "Move up" |
| `icon-arrow-down` *(new)* | ▼ | `keyboard_arrow_down` | New — folder reorder "Move down" |

## Testability

This is overwhelmingly a **visual/manual** feature — icon rendering per
theme combo is not meaningfully headless-testable (no visual-regression
tooling exists in this repo, and CI doesn't run a browser).

- **Manual checklist (required, two-reviewer QA — see below):**
  - For each of index.html / setup.html / watch.html: every `.icon-*` usage
    renders (no missing/broken icon glyph box).
  - Theme toggle: click through 🌙→☀️→🌙 on desktop header and the mobile
    bottom-nav item; icon and "Dark"/"Light" label stay in sync.
  - Repeat the full icon check across all 8 combos: `data-theme` ∈
    {2005, 2009, 2014, 2021} × `data-mode` ∈ {light, dark} — confirm icons
    inherit the theme's text color (no icon "stuck" black/white against a
    dark/light background).
  - Rescan button: idle → click → "Scanning..." → success (reload) and the
    error path (`alert` + reset to idle) — icon present in all 3 states.
  - Folder reorder: add 3+ folders in setup.html, click up/down; icons
    visible and functionally correct (order still swaps); disabled-state
    buttons (first row's up arrow, last row's down arrow) look right.
  - Alignment: icons sit on the same baseline as adjacent text (sidebar
    labels, "Settings"/"Rescan Files" button text, bottom-nav labels) — no
    vertical jump vs. today's emoji rendering.
  - Offline check: disconnect network / block egress, reload each page —
    all icons still render (proves no CDN dependency slipped in).
- **What CI *can* verify** (should get lightweight coverage, not full node:test suites necessarily, but confirm before shipping):
  - The bundled icon assets are actually served (e.g. a 200 for each
    `/assets/icons/*.svg` referenced by CSS) if principal-engineer's design
    uses file-based assets rather than pure data-URIs.
  - Static grep-style check that no CDN hostname
    (`fonts.googleapis.com`/`fonts.gstatic.com`/etc.) appears anywhere under
    `public/`.
  - Lint passes with zero warnings (existing `npm run lint` gate).
  - If any pure-logic seam is introduced (e.g. a small "resolve icon class
    for current mode" helper), it should get a `node:test` unit test per
    `docs/CONTRIBUTING.md`'s "every feature ships with tests" rule — but the
    bulk of this feature (CSS + markup + SVG assets) has no meaningful pure
    logic to unit-test beyond what already exists (`resolveTheme` is
    untouched).

## Risks

- **currentColor inheritance miss**: an icon whose `mask-image` rule doesn't
  properly resolve `currentColor` (e.g. an SVG with a hardcoded `fill`
  baked into the file, or a CSS rule ordering issue) would render as solid
  black/white regardless of theme — most visible in 2005/dark or high-contrast
  combos. Mitigation: source *outline-only* SVGs (single path, no baked
  fill/stroke color) and verify with the manual 8-combo checklist above.
- **Sizing/baseline misalignment**: mask-image icons are sized by
  width/height, not `font-size` — any consumer that relied on `font-size` for
  icon sizing (notably the 10px-inline-styled reorder buttons in
  `setup.html`) needs an explicit re-sizing decision, or it'll look wrong
  (tiny/invisible or oversized). Flagged for principal-engineer above.
- **Theme-toggle JS rewrite risk**: `common.js`'s `applyTheme` (touched by
  every mode switch, on every page, on every load via `initTheme`) must swap
  from `btn.innerHTML = '🌙'/'☀️'` to an icon-class swap without breaking
  `toggleTheme()`, `setTheme()`, or the FOUC bootstrap — this is
  theme-critical shared code; a mistake here breaks every page, not just the
  icon.
- **Missed emoji**: the inventory above is exhaustive per grep, but a
  reviewer should re-grep for 🌙/☀️/🔄/▲/▼/☰/🏠/📁/⚙/🗑/🔍/▶ across
  `public/` before sign-off to catch anything missed during implementation.
- **Star rating accidentally touched**: because `icon-star` exists in the
  same CSS block being rewritten, there's a real risk of someone "helpfully"
  wiring gold stars into the mask-image/currentColor system, which would
  break the explicit "stars stay gold" requirement. Call this out loudly in
  design/implementation review.
- **Asset delivery trade-off**: SVG files under `public/assets/icons/` vs.
  inline data-URIs in `style.css` — files are more auditable/maintainable
  and match the `public/fonts/` precedent, but add a new directory and (if
  file-based rather than inline) a few extra static requests per page
  (irrelevant for a home-LAN app, but worth principal-engineer explicitly
  choosing and justifying rather than defaulting silently).
- **Docker image bloat**: negligible (a dozen small SVGs), but confirm
  `Dockerfile`'s `COPY public/ ./public/` picks up the new
  `public/assets/icons/` directory (it does, verified — no Dockerfile change
  needed) so this isn't a surprise at deploy time.

## Non-goals

- No new icons beyond the 1:1 emoji replacements enumerated above.
- Gold `★` rating stars stay exactly as-is — not reskinned, not
  currentColor-themed, not touched.
- No per-era icon *style* variation — one Material Symbols Outlined family
  across all 4 eras × 2 modes; only color varies (via `currentColor` +
  theme tokens).
- No Material Symbols web-font / CDN integration of any kind.

## QA note

This branch required a **significant, two-reviewer QA pass** before
acceptance (quality-assurance stage + `/code-review`), specifically covering:
- All-8-combos rendering (4 eras × 2 modes) for every icon on every page.
- `currentColor` theming correctness (no icon stuck in the wrong color in any
  combo).
- No missing/broken/duplicated icon anywhere `.icon-*` is used.
- No CDN/network dependency introduced (offline check).
- Icon sizing/baseline alignment against adjacent text, including the
  reorder-button sizing risk flagged above.
- Explicit confirmation that the gold star rating system was *not* touched.

## Progress log

- 2026-07-04: Discovery complete. Requirements + full emoji/icon inventory
  grounded in `public/css/style.css`, `public/js/common.js`, `public/js/
  main.js`, `public/index.html`, `public/setup.html`, `public/watch.html`,
  and `Dockerfile`. No conflicts found with active exec plans (none currently
  active) or the tech-debt tracker. Awaiting principal-engineer design.
- 2026-07-04: Principal-engineer design complete (## Technical Design). Mask-image
  over 12 self-hosted Material Symbols Outlined SVGs + `background-color:
  currentColor`; explicit (non-wildcard) selector list to protect `icon-star`;
  single-line `applyTheme` change; enumerated raw-emoji edits + reorder sizing fix.
- 2026-07-05: **Shipped v1.6.0.** Implementation, verification, two-reviewer QA,
  and acceptance complete. QA agent returned APPROVE-WITH-NITS (flagged the
  missing CI-checkable tests). The `/code-review` pass then caught an
  accessibility regression QA missed — the icon-only header buttons
  (`#menu-toggle`, `#theme-toggle-btn`) lost their accessible names once the
  emoji text was removed. Fixes folded in before merge: `aria-label`s added to
  the menu-toggle + theme-toggle across all 3 pages; an `@supports` guard so
  browsers without mask support degrade to a blank box rather than an opaque
  square; the sidebar icon box squared up; and the CI-checkable tests added
  (bundled-SVGs-exist, no-CDN grep, no-stray-chrome-emoji grep, plus a
  served-200 integration check). Dead `icon-play`/`icon-search` classes kept as
  pre-existing class API (bundled assets, no consumer). All acceptance criteria
  met; 90 tests green; no new tech debt.

## Decision log

- 2026-07-04 (product-manager): Brought the hamburger `#menu-toggle` (raw
  `☰`, 3 pages) into scope, wired to the existing-but-previously-unused
  `icon-menu` class, since the class already existed for exactly this glyph
  and the swap is a zero-risk pure-markup change (click handler doesn't
  touch button content). Not explicitly named in the original feature
  request's raw-emoji list, but consistent with its intent.
- 2026-07-04 (product-manager): Confirmed `icon-play`, `icon-search`, and
  `icon-star` currently have **no** `<i class="icon-x">` consumers anywhere
  in the codebase. `icon-play`/`icon-search` are bundled with real Material
  Symbol assets anyway (API completeness — some future feature may reach for
  them), but no new consumer is added by this feature. `icon-star` is
  explicitly left out of the mask-image system per the "stars stay gold"
  requirement.
- 2026-07-04 (product-manager): Added 3 new icon classes
  (`icon-refresh`, `icon-arrow-up`, `icon-arrow-down`) not present in the
  original 10-class inventory, because the rescan (🔄) and reorder (▲/▼)
  glyphs have no existing `.icon-*` slot to reuse.
- 2026-07-05 (code-review): Icon-only buttons need explicit `aria-label`s —
  removing the emoji text stripped their accessible name. Added across all 3
  pages; recorded as the load-bearing a11y fix for this feature.
