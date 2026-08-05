# Bundled icons

FileTube's chrome iconography ships as three self-hosted, offline vector
icon sets — plus a colorful emoji set defined directly in `style.css` (no
SVG files) — selectable via the `data-icons` axis (see
`docs/exec-plans/completed/2026-07-05-icon-sets.md`). Every asset is used as a CSS
`mask-image` and painted with `currentColor`, so a single unmodified file
renders correctly in every FileTube theme (era × light/dark).

Two groups of classes live here, and they have different coverage rules:

1. **Chrome icons** - the 14 `.icon-*` classes each vector set covers in full
   (the tables below), plus ten later additions that ship ONE base asset other
   sets fall back to. Not uniformly, though: **eight** of them (`heart`,
   `share`, `flame`, `history`, `queue`, `podcast`, `grid`, `list`) fall back in
   `rounded`, `filled` AND `emoji`, while `downloads` and `books` have their own
   emoji codepoints (U+1F4FC and U+1F4DA) and fall back only in `rounded` and
   `filled`. That fallback is deliberate, not a gap - but it is now the minority
   behaviour, and it is tracked as tech-debt row 113.
2. **The assignable glyph pool** (v1.77) - 20 user-selectable folder/Library
   glyphs plus `.icon-liked`, every one of which carries a real variant in
   **all four** sets. See "The assignable glyph pool" at the end of this file;
   do not hand-maintain it.

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
| `books.svg` | `menu_book` | Books library entry + bottom-nav item (v1.73.2; emoji set uses U+1F4DA) |
| `shuffle.svg` | `shuffle` | `.icon-shuffle` |

## FileTube original — `flame.svg`

`flame.svg` is the one file in this directory that is **not** a Google
Material asset. It backs `.icon-flame`, the per-video "reheat" control added
in v1.49, and it was drawn for FileTube because the reheat is a
FileTube-specific concept with no Material counterpart worth borrowing.

- Origin: **FileTube original**, drawn to match the bundled Material geometry
  (24×24, `viewBox="0 -960 960 960"`, single `currentColor` path, outlined
  look via an `evenodd` inner cutout).
- License: same as the rest of this repository.
- It is **not** attributed to Google and must not be listed in the Material
  tables above.

Like `heart.svg` and `share.svg` it lives at the top level only, with no
per-icon-set variants — the `rounded`/`filled`/`emoji` blocks in `style.css`
enumerate their members individually, so an icon without a set-specific entry
falls back to this base asset in every set. That is the established behaviour
for those two icons and is deliberate here too.

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

## Material Icons Classic — `filled`

SVG icons in the **Material Icons Filled style** (the original
"Classic"/filled look), bundled under `public/assets/icons/filled/`.
Filenames match the actual source glyph name (self-documenting), which is why
three of them differ from the `.icon-*` class name they back (see
substitutes/renames below).

**Provenance, honestly:** the fourteen chrome icons below are all from the
original June 2014 Material Icons launch set, and this section used to
describe the whole `filled` set as "authentic to Material Design's original
June 2014 release". That is no longer true of the set as a whole. v1.77 added
nineteen glyph-pool assets in this same style, four of which - `child_care`,
`sports_esports`, `theater_comedy`, `fitness_center` - **postdate the 2014
launch**. They are genuine Material Icons Filled-style assets (so the set is
visually consistent, which is what a user sees), but they are not 2014-era
glyphs, and the wording was widened rather than left quietly false. See the
glyph-pool section below.

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

## The assignable glyph pool - `v1.77`

Twenty glyphs a user can assign to a media folder (Settings → Media folders →
each row's **Icon** dropdown) or to a Library sidebar entry (Settings →
Appearance → **Library icons**), plus `.icon-liked` for the Liked lane.

Unlike the ten single-asset glyphs named in item 1 at the top of this file
(`heart`, `share`, `flame`, `history`, `queue`, `podcast`, `downloads`,
`books`, `grid`, `list`), **every entry here ships a
real variant in all four sets** - outlined, rounded, filled and an emoji
codepoint. That was the explicit requirement: "each glyph we choose should be
out of a set of four for the different eras."

- Outlined / Rounded: **Material Symbols**, © Google, Apache-2.0
- Filled: **Material Icons** (Filled style), © Google, Apache-2.0 - see the
  provenance note in the `filled` section above; four of these postdate 2014
- Emoji: CSS `content` codepoints, no asset

**Do not hand-maintain this.** `public/js/glyph-pool.js` is the single source
of truth - `server.js` requires it to validate saves and the browser loads it
as a script to render - and `test/unit/glyph-pool.test.js` re-derives, for
every member, all **seven** required `style.css` enumerations (base mask,
sizing list, `@supports` fill list, rounded override, filled override, emoji
neutralize group, emoji `::before`) plus its three SVGs. A member missing any
one of them fails CI. The fill list is the one that matters most: a mask with
no fill renders as an invisible box, which is exactly the v1.47.6 bug Dean
found on-device.

| `.icon-*` class | Asset | Label in the picker | Emoji |
|---|---|---|---|
| `.icon-folder` | `folder.svg` | Folder | U+1F4C1 |
| `.icon-school` | `school.svg` | School | U+1F393 |
| `.icon-movies` | `movie.svg` | Movies | U+1F3AC |
| `.icon-shows` | `tv.svg` | Shows | U+1F4FA |
| `.icon-documents` | `description.svg` | Documents | U+1F4C4 |
| `.icon-music-note` | `music_note.svg` | Music | U+1F3B5 |
| `.icon-kids` | `child_care.svg` | Kids | U+1F9F8 |
| `.icon-games` | `sports_esports.svg` | Games | U+1F3AE |
| `.icon-camcorder` | `videocam.svg` | Home video | U+1F4F9 |
| `.icon-photos` | `photo_camera.svg` | Photos | U+1F4F7 |
| `.icon-travel` | `flight.svg` | Travel | U+2708 U+FE0F |
| `.icon-work` | `work.svg` | Work | U+1F4BC |
| `.icon-cooking` | `restaurant.svg` | Cooking | U+1F37D U+FE0F |
| `.icon-fitness` | `fitness_center.svg` | Fitness | U+1F3CB U+FE0F |
| `.icon-comedy` | `theater_comedy.svg` | Comedy | U+1F3AD |
| `.icon-pets` | `pets.svg` | Pets | U+1F43E |
| `.icon-cars` | `directions_car.svg` | Cars | U+1F697 |
| `.icon-archive` | `archive.svg` | Archive | U+1F4E6 |
| `.icon-radio` | `radio.svg` | Radio | U+1F4FB |
| `.icon-favorites` | `star.svg` | Favorites | U+2B50 |
| `.icon-liked` | `star.svg` | Liked (not a pool member) | U+2B50 |

`.icon-favorites` and `.icon-liked` deliberately share `star.svg`: different
intents, same picture, kept separate so the Liked lane's glyph can change later
without silently changing every folder that chose Favorites.

**A collision that was resolved, not disclosed:** `.icon-shows` and the
pre-existing `.icon-downloads` both rendered U+1F4FA (📺) in the emoji set.
Dean ruled they must not share, so `.icon-downloads` moved to U+1F4FC (📼
videocassette) and Shows kept the television - a TV being the literal read of a
Shows folder. Downloads' mask assets are unchanged in all three vector sets;
only its emoji glyph moved. Both are user-changeable now, though not in the same
way: Downloads is a Library ENTRY with its own picker, while Shows is a POOL
GLYPH that any folder or Library entry can be given.
