# Bundled icons

FileTube's chrome iconography ships as three self-hosted, offline vector
icon sets — plus a colorful emoji set defined directly in `style.css` (no
SVG files) — selectable via the `data-icons` axis (see
`docs/exec-plans/active/icon-sets.md`). Each vector set covers the same
14 `.icon-*` classes, is used as a CSS `mask-image`, and is painted with
`currentColor`, so a single unmodified asset renders correctly in every
FileTube theme (era × light/dark).

## Material Symbols (Outlined) — `outlined` (default)

Fourteen individual SVG icons from Google's Material Symbols set (Outlined
style), living at the top level of this directory (`public/assets/icons/*.svg`)
— twelve are the v1.6.0 baseline set (FileTube's default look); `download.svg`
was added in v1.17.0 (FR-7); `shuffle.svg` was added later as a fix for the
Shuffle button rendering a raw emoji instead of a themed glyph in non-emoji
icon sets (it previously used a fixed `::before` unicode glyph, unlike every
other `.icon-*`).

- Icon set: **Material Symbols**, © Google
- License: **Apache License 2.0** — https://www.apache.org/licenses/LICENSE-2.0
- Source: https://github.com/google/material-design-icons

Apache-2.0 permits redistribution; these files are included unmodified.

| File | Material Symbol | Used by |
|---|---|---|
| `home.svg` | `home` | `.icon-home` |
| `folder.svg` | `folder` | `.icon-folder` |
| `settings.svg` | `settings` | `.icon-cog` |
| `delete.svg` | `delete` | `.icon-delete` |
| `dark_mode.svg` | `dark_mode` | `.icon-moon` |
| `light_mode.svg` | `light_mode` | `.icon-sun` |
| `menu.svg` | `menu` | `.icon-menu` |
| `search.svg` | `search` | `.icon-search` |
| `play_arrow.svg` | `play_arrow` | `.icon-play` |
| `refresh.svg` | `refresh` | `.icon-refresh` |
| `keyboard_arrow_up.svg` | `keyboard_arrow_up` | `.icon-arrow-up` |
| `keyboard_arrow_down.svg` | `keyboard_arrow_down` | `.icon-arrow-down` |
| `download.svg` | `download` | `.icon-download` |
| `shuffle.svg` | `shuffle` | `.icon-shuffle` |

## Material Symbols (Rounded) — `rounded`

Fourteen SVG icons from the same Material Symbols family, Rounded style — a
softer, modern look. Bundled under `public/assets/icons/rounded/` using the
**same filenames** as the outlined set (only the glyph outline differs).

- Icon set: **Material Symbols (Rounded)**, © Google
- License: **Apache License 2.0** — https://www.apache.org/licenses/LICENSE-2.0
- Source: https://github.com/google/material-design-icons
  (`symbols/web/<glyph>/materialsymbolsrounded/<glyph>_24px.svg`)

Apache-2.0 permits redistribution; these files are included unmodified.

| File | Material Symbol | Used by |
|---|---|---|
| `rounded/home.svg` | `home` | `.icon-home` |
| `rounded/folder.svg` | `folder` | `.icon-folder` |
| `rounded/settings.svg` | `settings` | `.icon-cog` |
| `rounded/delete.svg` | `delete` | `.icon-delete` |
| `rounded/dark_mode.svg` | `dark_mode` | `.icon-moon` |
| `rounded/light_mode.svg` | `light_mode` | `.icon-sun` |
| `rounded/menu.svg` | `menu` | `.icon-menu` |
| `rounded/search.svg` | `search` | `.icon-search` |
| `rounded/play_arrow.svg` | `play_arrow` | `.icon-play` |
| `rounded/refresh.svg` | `refresh` | `.icon-refresh` |
| `rounded/keyboard_arrow_up.svg` | `keyboard_arrow_up` | `.icon-arrow-up` |
| `rounded/keyboard_arrow_down.svg` | `keyboard_arrow_down` | `.icon-arrow-down` |
| `rounded/download.svg` | `download` | `.icon-download` |
| `rounded/shuffle.svg` | `shuffle` | `.icon-shuffle` |

## Material Icons Classic (2014) — `filled`

Fourteen SVG icons from the original 2014 Material Icons launch set (the
"Classic"/filled style), bundled under `public/assets/icons/filled/` —
authentic to Material Design's original June 2014 release. Filenames match
the actual source glyph name (self-documenting), which is why three of them
differ from the `.icon-*` class name they back (see substitutes/renames
below).

- Icon set: **Material Icons** (Classic), © Google
- License: **Apache License 2.0** — https://www.apache.org/licenses/LICENSE-2.0
- Source: https://github.com/google/material-design-icons
  (`src/<category>/<glyph>/materialicons/24px.svg`)

Apache-2.0 permits redistribution; these files are included unmodified.

| File | Material Icon (category) | Used by |
|---|---|---|
| `filled/home.svg` | `home` (`action`) | `.icon-home` |
| `filled/folder.svg` | `folder` (`file`) | `.icon-folder` |
| `filled/settings.svg` | `settings` (`action`) | `.icon-cog` |
| `filled/delete.svg` | `delete` (`action`) | `.icon-delete` |
| `filled/menu.svg` | `menu` (`navigation`) | `.icon-menu` |
| `filled/search.svg` | `search` (`action`) | `.icon-search` |
| `filled/play_arrow.svg` | `play_arrow` (`av`) | `.icon-play` |
| `filled/refresh.svg` | `refresh` (`navigation`) | `.icon-refresh` |
| `filled/keyboard_arrow_up.svg` | `keyboard_arrow_up` (`hardware`) | `.icon-arrow-up` |
| `filled/keyboard_arrow_down.svg` | `keyboard_arrow_down` (`hardware`) | `.icon-arrow-down` |
| `filled/wb_sunny.svg` | `wb_sunny` (`image`) — **substitute** | `.icon-sun` |
| `filled/brightness_2.svg` | `brightness_2` (`image`) — **substitute** | `.icon-moon` |
| `filled/download.svg` | `file_download` (`file`) — **renamed** | `.icon-download` |
| `filled/shuffle.svg` | `shuffle` (`av`) | `.icon-shuffle` |

### Substitute glyphs: `icon-sun` / `icon-moon` have no 2014 counterpart

`dark_mode` and `light_mode` are modern Material Symbols glyphs (introduced
with system-level dark-theme support, ~2019+) — they don't exist in the 2014
Material Icons Classic launch set that `filled` recreates, so two
period-correct substitutes are used instead:

- **`icon-sun` → `wb_sunny`**: a literal sun glyph, part of the original 2014
  `image`-category weather icons — no substitution in spirit, just a
  different (period-correct) glyph name than the modern `light_mode`.
- **`icon-moon` → `brightness_2`**: the original 2014 `image`-category
  brightness-level glyph — a circle with a crescent cut into it. Verified at
  build time to read as a moon-adjacent crescent shape at small sizes, so it
  was kept as the closest period-authentic "night mode" stand-in (apps of
  that era commonly reused a brightness glyph this way before Material had an
  official moon icon). No fallback to `brightness_3` was needed.

### Renamed glyph: `icon-download` ships as `filled/download.svg`, not `filled/file_download.svg`

The 2014 Classic set's actual source glyph for a download arrow lives under
the `file` category as `file_download` (unlike `icon-sun`/`icon-moon` above,
this ISN'T a substitute glyph — it's the same "download" pictograph used by
`outlined`/`rounded`, just filed under a different category name in the
Classic launch set). The file is saved as `download.svg` here (not
`file_download.svg`) so all three vector sets share one filename per
`.icon-*` class, matching `outlined`/`rounded`'s own `download.svg` — content
is unmodified from the upstream `file_download` asset, only the filename
differs from its source path.

## Emoji — `emoji`

The pre-v1.6.0 emoji glyphs, restored as a selectable icon set. Unlike the
three vector sets above, `emoji` has **no bundled SVGs** — the glyphs are
CSS `::before { content: "\XXXX" }` unicode escapes directly in
`public/css/style.css` (see the `[data-icons="emoji"]` block), so it's
intentionally colorful rather than `currentColor`-themed.

| `.icon-*` class | emoji |
|---|---|
| `.icon-home` | 🏠 |
| `.icon-folder` | 📁 |
| `.icon-cog` | ⚙ |
| `.icon-delete` | 🗑 |
| `.icon-moon` | 🌙 |
| `.icon-sun` | ☀️ |
| `.icon-menu` | ☰ |
| `.icon-search` | 🔍 |
| `.icon-play` | ▶ |
| `.icon-refresh` | 🔄 |
| `.icon-arrow-up` | ▲ |
| `.icon-arrow-down` | ▼ |
| `.icon-download` | 📥 |
| `.icon-shuffle` | 🔀 |
