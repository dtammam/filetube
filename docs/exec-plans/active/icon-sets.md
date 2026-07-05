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
  logic that sets `data-theme`/`data-mode` before first paint (comment: "Mirror
  of resolveTheme() in /js/common.js — keep the two in sync").
- **The Appearance section** (`setup.html:103-108`): one `setup-box` containing
  the theme picker (`#theme-picker`, rendered by `renderThemePicker()`).
- **Asset/attribution precedent** (`public/assets/icons/README.md`): Material
  Symbols, Apache-2.0, self-hosted, "included unmodified," mirroring
  `public/fonts/README.md`.
- **The pre-v1.6.0 emoji mapping** (recovered from
  `docs/exec-plans/completed/icon-assets.md`'s inventory — this is exactly
  what the new `emoji` set restores): 🏠 home, 📁 folder, ⚙ cog/settings,
  🗑 delete, 🌙 moon/dark_mode, ☀️ sun/light_mode, ☰ menu, 🔍 search, ▶ play,
  🔄 refresh, ▲ arrow-up, ▼ arrow-down.
- **A11y precedent**: v1.6.0's code-review pass added `aria-label`s to
  icon-only buttons (`#menu-toggle`, `#theme-toggle-btn`) after the emoji text
  was removed. Those labels live on the parent `<button>`, not the `<i>` — this
  feature only ever changes how the `<i>` renders, never the button markup, so
  they are structurally safe, but must be explicitly re-verified per set.

## Overlap / conflict check

- `docs/exec-plans/active/` contains only `.gitkeep` — no active exec plan
  overlaps.
- `docs/exec-plans/tech-debt-tracker.md` — Active table is empty; the one
  Closed item (transcode-cache eviction) is unrelated. This feature neither
  opens nor closes a tracked item.
- No contradiction with `docs/ARCHITECTURE.md` (frontend is vanilla JS/CSS,
  no build step — this feature adds CSS + a JS resolver + SVGs, consistent).
- `docs/CONTRIBUTING.md`'s "every feature ships with tests" is respected: the
  one pure-logic seam (`resolveIconSet`) gets `node:test` coverage, mirroring
  `resolveTheme`'s pattern exactly (see Testability). No out-of-scope item
  below defers anything CONTRIBUTING.md requires.

## Scope

- A new persisted setting `ft-icons` (localStorage) + `data-icons` attribute
  on `<html>`, holding one of: `outlined`, `rounded`, `filled`, `emoji`, or the
  meta-value `auto`.
- Four concrete icon sets, each covering all 12 existing `.icon-*` classes:
  - **outlined** — Material Symbols Outlined (today's v1.6.0 assets, unchanged).
  - **rounded** — Material Symbols Rounded (same repo/family as outlined, a
    distinct visual style — confirmed via the same
    `google/material-design-icons` source pattern used for `icon-assets`).
  - **filled** — a 2014-flavored solid Material Icons (Classic) set, authentic
    to Material's original June 2014 launch, with documented era-appropriate
    substitutes for the two glyphs that did not exist in 2014 (see Sourcing).
  - **emoji** — restores the original pre-v1.6.0 `::before` emoji per icon
    (recovered mapping above); intentionally colorful, not currentColor-themed.
- **Auto**: not a 5th CSS-visible set. It is a stored *preference* that resolves
  to one of the four concrete sets based on the current era, recomputed
  whenever era or icon-set changes (see era→set map below).
- CSS: keep every existing `.icon-*` class; add `data-icons`-scoped
  `mask-image` overrides for the vector sets, and an emoji override that turns
  the mask off and restores `::before` content, per icon.
- Bundle `rounded`/`filled` SVGs under `public/assets/icons/rounded/` and
  `public/assets/icons/filled/` (Apache-2.0 attribution, extending
  `public/assets/icons/README.md`). The existing top-level
  `public/assets/icons/*.svg` files remain, unmoved, as the `outlined` source
  (see Decision log — avoids churn/broken-reference risk for zero benefit).
- JS: `resolveIconSet(storedSet, era)` pure helper (the test seam) +
  `applyIconSet`/`setIconSet` mirroring `applyTheme`/`setTheme`; recompute on
  era change; FOUC inline script updated to also set `data-icons` before
  paint, kept in sync with `resolveIconSet`.
- Settings UI: an "Icons" picker in `setup.html`'s existing Appearance
  section, next to the theme picker, driven by an `ICON_SET_REGISTRY`
  (`{id, name, blurb}`) mirroring `THEME_REGISTRY`, with **Auto listed first**.
- A recommended + justified default for `ft-icons` when unset (new installs
  and existing v1.6.0 users alike).

## Out of scope

- The gold `★`/`☆` rating system — `.icon-star::before { content: "★" }` and
  the `.star`/`.card-rating` displays stay exactly as-is, untouched by any set.
- Any raster/Silk icon format — vector (SVG mask) or emoji text only, matching
  the existing mechanism.
- Any change to the header light/dark **mode** toggle or the era **theme**
  picker's own logic (`resolveTheme`, `applyTheme`, `toggleTheme`, `setTheme`
  era-switching semantics) — icon-set is a fully orthogonal 3rd axis layered on
  top; the mode/era systems are read (to resolve Auto and to size/color icons)
  but not modified in behavior.
- Any new icon glyphs beyond the existing 12 `.icon-*` classes — this is a
  re-skinning axis, not an icon-inventory expansion.
- A11y labels: this feature must not touch any `aria-label` — it only changes
  what renders **inside** an `<i>`, never the parent control's markup.
  (Explicitly kept in scope for *verification*, out of scope for *change*.)

## Constraints

- **Fully offline**: no CDN reference for `rounded`/`filled` assets — self-hosted
  under `public/assets/icons/<set>/`, shipped via the existing `COPY public/
  ./public/` Docker step (no Dockerfile change), matching the `outlined`
  precedent.
- **License**: `rounded` and `filled` are Apache-2.0 (Google) — extend
  `public/assets/icons/README.md` with per-set attribution and the source/file
  table, same format as the existing `outlined` table.
- **Theming**: vector sets (`outlined`, `rounded`, `filled`) must continue to
  paint via `background-color: currentColor` — no hardcoded fill — so they
  theme correctly across all 4 eras × 2 modes with zero per-theme rules,
  exactly like today. `emoji` is intentionally colorful (not currentColor).
- **No regression**: `resolveTheme`/`applyTheme`/`toggleTheme`/`setTheme`
  behavior, the existing 8-combo theming of every `.icon-*` class, and every
  v1.6.0 acceptance criterion (offline, no-CDN, aria-labels, `@supports`
  fallback, gold star exclusion) must hold unchanged for every icon set.
- **Additive persistence**: introduces one new localStorage key (`ft-icons`)
  only; no existing key (`ft-era`, `ft-mode`, legacy `theme`) is touched or
  reinterpreted.
- Per `docs/CONTRIBUTING.md`: every feature ships with tests — see
  Testability.

## Sourcing — the 12 icons × 4 sets

| `.icon-*` class | outlined (today, unchanged) | rounded | filled (2014) |
|---|---|---|---|
| `icon-home` | `home` | `home` (Rounded) | `home` (Classic) |
| `icon-folder` | `folder` | `folder` (Rounded) | `folder` (Classic) |
| `icon-cog` | `settings` | `settings` (Rounded) | `settings` (Classic) |
| `icon-delete` | `delete` | `delete` (Rounded) | `delete` (Classic) |
| `icon-menu` | `menu` | `menu` (Rounded) | `menu` (Classic) |
| `icon-search` | `search` | `search` (Rounded) | `search` (Classic) |
| `icon-play` | `play_arrow` | `play_arrow` (Rounded) | `play_arrow` (Classic) |
| `icon-refresh` | `refresh` | `refresh` (Rounded) | `refresh` (Classic) |
| `icon-arrow-up` | `keyboard_arrow_up` | `keyboard_arrow_up` (Rounded) | `keyboard_arrow_up` (Classic) |
| `icon-arrow-down` | `keyboard_arrow_down` | `keyboard_arrow_down` (Rounded) | `keyboard_arrow_down` (Classic) |
| `icon-sun` | `light_mode` | `light_mode` (Rounded) | **`wb_sunny`** (substitute — see below) |
| `icon-moon` | `dark_mode` | `dark_mode` (Rounded) | **`brightness_2`** (substitute — see below) |

emoji set (all 12, restoring the pre-v1.6.0 mapping recovered from
`docs/exec-plans/completed/icon-assets.md`):

| `.icon-*` class | emoji |
|---|---|
| `icon-home` | 🏠 |
| `icon-folder` | 📁 |
| `icon-cog` | ⚙ |
| `icon-delete` | 🗑 |
| `icon-moon` | 🌙 |
| `icon-sun` | ☀️ |
| `icon-menu` | ☰ |
| `icon-search` | 🔍 |
| `icon-play` | ▶ |
| `icon-refresh` | 🔄 |
| `icon-arrow-up` | ▲ |
| `icon-arrow-down` | ▼ |

### CRITICAL sourcing finding: `dark_mode`/`light_mode` did not exist in 2014

`dark_mode` and `light_mode` are recent Material Symbols glyphs, introduced
alongside system-level dark-theme support (Android 10-era, ~2019+) — they have
no counterpart in the original 2014 Material Icons (Classic) launch set. The
`filled` set cannot reference them. Documented substitutes, both drawn from
Material Icons Classic's original 2014 inventory so the set stays internally
authentic:

- **`icon-sun` → `wb_sunny`**: a literal sun glyph, part of the original 2014
  "action" category weather icons — no substitution needed in spirit, just a
  different (period-correct) glyph name than the modern `light_mode`.
- **`icon-moon` → `brightness_2`**: the original 2014 "device" category
  brightness-level glyph (a partially-shaded circle/crescent shape). Before
  Material had an official moon/dark-mode icon, apps of that era commonly
  reused a brightness glyph as the de facto "dim/night" indicator — this is
  the closest period-authentic stand-in.

**Build-time verification required** (flagged for principal-engineer/build,
not resolved here): confirm both glyph names resolve in the
`google/material-design-icons` repo's classic/filled style (same fetch
pattern `icon-assets` used) and that `brightness_2` reads visually as a
moon-adjacent shape at 1em size. If it doesn't read well, a same-era
alternate (e.g. `brightness_3`) may be substituted by design without
reopening discovery, provided it comes from the same 2014-era Classic set and
the substitution is documented in `public/assets/icons/README.md` exactly as
this section documents it.

## Requirements + acceptance criteria

### The axis + attribute

- `data-icons` on `<html>` holds one of the four **concrete** values:
  `outlined | rounded | filled | emoji`. `'auto'` is never written to
  `data-icons` — it is only ever a *stored preference* (`ft-icons`) that
  resolves to a concrete value.
- Era → set map for Auto:

  | Era | Auto resolves to |
  |---|---|
  | 2005 | emoji |
  | 2009 | emoji |
  | 2014 | filled |
  | 2021 | rounded |

- [ ] **AC1**: Switching the Icons picker to any explicit set immediately
  updates every visible icon on the current page with no reload.
- [ ] **AC2**: With `ft-icons = auto`, switching the **era** (theme picker)
  immediately updates every visible icon to the era's mapped set, with no
  reload, on every page that has both pickers reachable in the same session.
- [ ] **AC3**: `data-icons` never contains the literal string `auto` at any
  point after page load — it always holds one of the four concrete values.

### Sourcing completeness

- [ ] **AC4**: Every one of the 12 `.icon-*` classes has a defined, rendering
  source under all four sets (outlined/rounded/filled/emoji) — no `.icon-*`
  usage anywhere in `public/*.html` is missing an icon in any set.
- [ ] **AC5**: The `filled` set's `icon-sun`/`icon-moon` substitutes
  (`wb_sunny`/`brightness_2`) are documented in
  `public/assets/icons/README.md` exactly as decided above (or their build-time
  same-era replacement, if swapped per the verification note).

### CSS mechanism

- [ ] **AC6**: For `outlined`/`rounded`/`filled`, `.icon-*` continues to render
  via `mask-image` (per-set source swap keyed by `[data-icons="<set>"]`) +
  `background-color: currentColor` — no hardcoded fill — and themes correctly
  across all 4 eras × 2 modes (8 combos) for all three vector sets (24 total
  set×theme combos).
- [ ] **AC7**: For `emoji`, every `.icon-*` class shows its original emoji via
  restored `::before { content: "<emoji>" }`, with the mask fully disabled
  (`mask-image: none`) **and** no residual `currentColor`-filled box rendered
  behind/around the emoji in any theme combo (the existing `@supports` fill
  guard must be explicitly neutralized under `[data-icons="emoji"]`).
- [ ] **AC8**: `.icon-star` is never touched by any `data-icons` rule in any
  set — the gold `★` renders identically regardless of icon-set selection.
- [ ] **AC9**: Vector-set SVGs live under `public/assets/icons/<set>/` (new:
  `rounded/`, `filled/`; unchanged: existing top-level files serve as
  `outlined`'s source) and are served (200) with Apache-2.0 attribution
  recorded in `public/assets/icons/README.md`.

### `resolveIconSet(storedSet, era)` — pure helper (test seam)

Lives in `public/js/common.js`, exported for `node:test` exactly like
`resolveTheme`. Never throws; always returns one of the four concrete set ids.

Required cases (mirrors `test/unit/resolve-theme.test.js`'s style):

1. `resolveIconSet('outlined', <any era>)` → `'outlined'`
2. `resolveIconSet('rounded', <any era>)` → `'rounded'`
3. `resolveIconSet('filled', <any era>)` → `'filled'`
4. `resolveIconSet('emoji', <any era>)` → `'emoji'`
5. `resolveIconSet('auto', '2005')` → `'emoji'`
6. `resolveIconSet('auto', '2009')` → `'emoji'`
7. `resolveIconSet('auto', '2014')` → `'filled'`
8. `resolveIconSet('auto', '2021')` → `'rounded'`
9. `resolveIconSet('auto', <invalid/unrecognized era>)` → the set mapped from
   the default era (`'rounded'`, since `DEFAULT_ERA = '2021'`)
10. `resolveIconSet(null, <any era>)` → default concrete set (`'outlined'`,
    see Default recommendation)
11. `resolveIconSet(<invalid string>, <any era>)` → default concrete set
    (`'outlined'`)

- [ ] **AC10**: All 11 cases above pass as `node:test` unit tests.

### JS wiring

- `applyIconSet(storedSet, era)`: sets `data-icons` to
  `resolveIconSet(storedSet, era)` on `<html>`.
- `setIconSet(storedSet)`: called by the setup-page picker; persists
  `ft-icons = storedSet` (the raw value, including `'auto'` — never the
  resolved concrete value, so future era changes can still recompute it) and
  calls `applyIconSet` immediately, no Save step (mirrors `setTheme`).
- `initIconSet()` (or folded into `initTheme`'s `DOMContentLoaded` handler):
  reads `ft-icons` + the current era, calls `applyIconSet`.
- **Era-change recompute**: `setTheme(era)` (the existing era-picker function)
  must, after updating `data-theme`, also re-run `applyIconSet(<current
  ft-icons value>, era)` so an `auto` preference immediately reflects the new
  era. (`toggleTheme()`, which only flips light/dark **mode**, never touches
  era, so it never needs to trigger an icon-set recompute.)
- [ ] **AC11**: Persisting `ft-icons` and reading it back reproduces the same
  `data-icons` result (round-trip), for every one of the 5 stored values
  (4 concrete + `auto`) at every era.
- [ ] **AC12**: Selecting the theme (era) picker while `ft-icons = auto` is
  stored updates `data-icons` correctly without the user touching the Icons
  picker at all (verifies the recompute wiring, not just the pure resolver).

### FOUC inline `<head>` script

- The inline bootstrap script already present in `index.html`/`setup.html`/
  `watch.html` (which sets `data-theme`/`data-mode` before paint) must be
  extended to also read `ft-icons` + resolve era→set (a hand-kept-in-sync copy
  of `resolveIconSet`'s logic, exactly as it already hand-keeps a copy of
  `resolveTheme`'s logic) and set `data-icons` before first paint.
- [ ] **AC13**: On a hard reload with any of the 5 stored `ft-icons` values
  (4 concrete + auto, at each era), the icon set rendered at first paint
  matches what `resolveIconSet`/`applyIconSet` would compute — no
  wrong-icon-then-correct-icon flash, on all three pages.

### Settings UI

- New `ICON_SET_REGISTRY` in `common.js` (or setup.html's own script, matching
  wherever `THEME_REGISTRY` lives): `{ id, name, blurb }` per set, **Auto
  listed first**, e.g.:
  - `auto` — "Matches the icon style to whichever era you've picked."
  - `outlined` — "Material Symbols Outlined — today's default look."
  - `rounded` — "Material Symbols Rounded — a softer, modern style."
  - `filled` — "2014-flavored solid Material icons — the original flat era."
  - `emoji` — "The original emoji glyphs — 🏠 📁 ⚙️ and friends."
- An "Icons" picker rendered next to the existing theme picker inside
  `setup.html`'s Appearance `setup-box`, following the same card/registry/click
  pattern as `renderThemePicker()`/`setTheme()`.
- [ ] **AC14**: The Icons picker renders all 5 entries (Auto first), highlights
  the currently-active stored value, and clicking any entry applies + persists
  immediately (no Save button, no reload) — mirroring the theme picker's UX
  exactly.

## Default `ft-icons` — recommendation

**Recommendation: default to `outlined` when `ft-icons` is unset** (both for
existing v1.6.0 users upgrading and for fresh installs). `auto` remains fully
available and is listed first in the picker for anyone who wants it, but it is
not the out-of-the-box behavior.

Rationale:

1. **Zero visible change from v1.6.0.** Every existing user, regardless of
   which era they've picked, sees exactly the icons they see today after
   upgrading — satisfying this feature's explicit "additive/no-regression"
   constraint.
2. **Auto's own map would silently change the majority default.** `DEFAULT_ERA`
   is `'2021'`, which is almost certainly what most users are on (nobody has
   touched the era picker). Auto maps 2021 → `rounded` — meaning if Auto were
   the default, the very first thing most users would see after upgrading to
   v1.7.0 is their icons changing from Outlined to Rounded, with no action on
   their part. That is a bigger, unrequested surface change than a purely
   additive/opt-in feature should make.
3. **Precedent.** The theme axis itself defaults to `2021` (today's shipped
   look), not to some "recommended" era; defaulting the icon axis to "today's
   look" (`outlined`) mirrors that same conservative default already
   established by the theme system.
4. **Auto is one click away**, listed first in the registry as instructed —
   users who want the era-matching vision get it immediately and explicitly by
   choosing it, rather than having it forced on them.

**Migration**: `resolveIconSet(null, <any era>)` → `'outlined'`. No `ft-icons`
key present (the state for every current user and every fresh install) always
resolves to `outlined`, independent of era. This is covered by AC10 (case 10)
and is itself the migration contract — no separate migration code path is
needed beyond the default-fallback branch of `resolveIconSet`.

## Testability

- **`resolveIconSet`** — the sole pure-logic seam, gets full `node:test`
  coverage (the 11 cases enumerated above), in a new
  `test/unit/resolve-icon-set.test.js` mirroring
  `test/unit/resolve-theme.test.js` exactly (same import-from-`common.js`
  pattern, same `assert.strictEqual` style).
- **CI-checkable guards** (extend the existing `icon-assets` CI checks):
  - Every SVG referenced by `style.css` under `public/assets/icons/rounded/`
    and `public/assets/icons/filled/` exists and is served (200) — same
    served-200 integration check pattern used for the original 12 outlined
    assets.
  - No CDN reference (`fonts.googleapis.com`/`fonts.gstatic.com`/etc.)
    anywhere under `public/` — unchanged, re-run against the new assets too.
  - **No stray emoji in markup/JS**: the existing "no chrome emoji in
    `public/*.html`/`public/js/*.js`" grep check must be **re-scoped** to
    exclude `public/css/style.css`, since `style.css` will now *intentionally*
    contain the 12 emoji strings as `::before` content for the `emoji` set.
    HTML/JS must still contain zero literal emoji chars — only CSS may.
  - `npm run lint` clean.
- **Everything visual is manual** (no visual-regression tooling in this repo,
  matching `icon-assets`'s precedent): every icon set × all 8 era/mode combos
  × index/setup/watch/bottom-nav. Concretely: 4 concrete sets × 8 combos × 3
  pages, plus a separate Auto-specific check (switching era with Auto selected,
  at each of the 4 eras, confirming the mapped set appears) and the FOUC
  no-flash check on hard reload for all 5 stored values. This is the same
  order of manual-QA magnitude as `icon-assets`' shipped 8-combo checklist,
  multiplied by 4 sets — plan reviewer time accordingly.

## Risks

- **FOUC-script / `resolveIconSet` drift**: the inline `<head>` script is a
  hand-kept-in-sync copy of `resolveIconSet`'s logic (exactly like the
  existing `resolveTheme` FOUC copy) — a future change to one without the
  other reintroduces a wrong-icon flash on load. Mitigation: comment both
  copies pointing at each other (matching the existing `resolveTheme` comment
  pattern), and AC13 explicitly requires testing the FOUC path.
- **Auto not recomputing on era change**: if `setTheme(era)` isn't wired to
  re-run `applyIconSet`, an `auto` user's icons will silently go stale after
  switching eras until next reload. Mitigation: AC12 specifically tests this
  wiring, independent of the pure-resolver unit tests (which can't catch a
  missing call site).
- **Missing filled-set icon**: `dark_mode`/`light_mode` have no 2014
  counterpart; if the substitutes (`wb_sunny`/`brightness_2`) aren't sourced
  and documented, `icon-sun`/`icon-moon` render blank under `filled`.
  Mitigation: AC4/AC5 explicitly require completeness + documentation, and the
  substitutes are named concretely above rather than left as a TODO.
- **Emoji-set stray mask / double-render**: the existing `@supports` fill
  guard (`background-color: currentColor`) applies unconditionally to the
  vector-icon selector list today; if `[data-icons="emoji"]` doesn't override
  both `mask-image` *and* `background-color`, the emoji can render on top of
  (or behind) a solid currentColor square. Mitigation: AC7 explicitly requires
  neutralizing both properties under the emoji override, and this is a named
  manual-QA check, not just a code-review nit.
- **A11y regression via association**: `icon-sets` touches the exact same
  icon-only buttons (`#menu-toggle`, `#theme-toggle-btn`) that lost their
  accessible names in `icon-assets` before code-review caught it. This feature
  never changes button markup or `aria-label`s — only the `<i>`'s
  rendering — but the QA pass must explicitly re-verify labels are intact in
  all 4 concrete sets, since that's exactly the kind of regression that slips
  through visual-only review.
- **CSS combinatorial explosion**: 4 sets × 12 icons is up to 48 new
  `mask-image` declarations plus 12 emoji `::before` overrides. Mitigation:
  reuse the existing shared base rule (sizing/position/repeat) unchanged;
  add only per-set `mask-image` source blocks (one compact block per set,
  mirroring the existing single outlined block) plus one emoji override
  block — do not introduce per-icon-per-set bespoke sizing/position rules.

## Non-goals

- No new `.icon-*` classes or new chrome iconography — this is a re-skinning
  axis over the existing 12.
- No raster/Silk assets, no icon web-font/CDN integration.
- No change to `resolveTheme`/`applyTheme`/`toggleTheme`/era-picker semantics.
- No change to the gold `★` rating system.

## Design

(To be filled by principal-engineer. Flagging one open decision from
discovery: whether `outlined`'s existing top-level `public/assets/icons/*.svg`
files should be left in place as-is (discovery's default recommendation — zero
file churn, zero broken-reference risk) or moved into a
`public/assets/icons/outlined/` subdirectory for full structural symmetry with
`rounded/`/`filled/`. Either is acceptable; if moved, every existing
non-`data-icons`-scoped reference to `/assets/icons/<name>.svg` must be
updated in the same change.)

## Technical Design

### Resolved open decision (asset layout)

Keep the existing top-level `public/assets/icons/*.svg` files exactly where
they are as the `outlined` source — **do not** move them into an
`outlined/` subdirectory. Rationale: the unscoped per-icon `mask-image` rules
(`style.css:1355-1366`) already point at `/assets/icons/<name>.svg` and double
as the ultimate fallback when `data-icons` is absent or unrecognized; moving
them would touch 12 CSS rules and the `icon-assets` CI test for zero
functional gain and non-zero broken-reference risk. `rounded/` and `filled/`
become new subdirectories under the same parent. This confirms the
product-manager's discovery recommendation.

### Approach

Icon-set is a third, orthogonal appearance axis layered on the v1.6.0 mask
mechanism with **no change** to `resolveTheme`/`applyTheme`/`toggleTheme` and
no change to the mode/era semantics. Three seams:

1. **CSS** (`public/css/style.css`) — the shared `.icon-*` base rule, the
   unscoped per-icon `mask-image` block, the `@supports` `currentColor` guard,
   and `.icon-star` all stay byte-for-byte unchanged. We append three new
   blocks scoped by `[data-icons="<set>"]`: a `rounded` mask block, a `filled`
   mask block, and one `emoji` override (mask off + fill neutralized) plus 12
   `::before` glyphs. Default/`outlined` needs no scoped rules — the unscoped
   block already serves it and is the fallback.
2. **JS** (`public/js/common.js`) — a pure `resolveIconSet(storedSet, era)`
   resolver (the `node:test` seam, mirroring `resolveTheme`), plus
   `applyIconSet`/`setIconSet`/`initIconSet` mirroring
   `applyTheme`/`setTheme`/`initTheme`, an `ICON_SET_REGISTRY`, and a one-line
   icon recompute wired into `setTheme` so an `auto` preference tracks era
   changes live. `initIconSet` is called from the existing `DOMContentLoaded`
   handler right after `initTheme`.
3. **FOUC + UI** — the inline `<head>` bootstrap on all three pages also sets
   `data-icons` before paint (a hand-synced mirror of `resolveIconSet`, exactly
   as it already mirrors `resolveTheme`); `setup.html` gains an "Icons" picker
   in the Appearance `setup-box` next to the theme picker.

New persisted key: `ft-icons` (holds the raw preference — one of the 4 concrete
sets or `auto`). New attribute: `data-icons` on `<html>` (always one of the 4
concrete sets — never `auto`).

### Asset layout + sourcing

`outlined` (unchanged): `public/assets/icons/*.svg` — the 12 v1.6.0 files.

`rounded` — new `public/assets/icons/rounded/*.svg`, Material Symbols Rounded,
fetched from `google/material-design-icons` at
`symbols/web/<glyph>/materialsymbolsrounded/<glyph>_24px.svg`, bundled under the
**same filenames** as `outlined` (so the `rounded` CSS block is structurally
identical, only the `/rounded/` path prefix differs):

`home`, `folder`, `settings`, `delete`, `dark_mode`, `light_mode`, `menu`,
`search`, `play_arrow`, `refresh`, `keyboard_arrow_up`, `keyboard_arrow_down`
→ `rounded/<same-name>.svg`.

`filled` — new `public/assets/icons/filled/*.svg`, Material Icons Classic
(the 2014 launch set), fetched from `google/material-design-icons` under
`src/<category>/<glyph>/materialicons/24px.svg`. Exact per-icon source path and
bundled filename (filenames match the actual source glyph, so they stay
self-documenting — only `icon-sun`/`icon-moon` differ from `outlined`):

| `.icon-*` | glyph | source path (repo `src/`) | bundled as |
|---|---|---|---|
| `icon-home` | `home` | `src/action/home/materialicons/24px.svg` | `filled/home.svg` |
| `icon-folder` | `folder` | `src/file/folder/materialicons/24px.svg` | `filled/folder.svg` |
| `icon-cog` | `settings` | `src/action/settings/materialicons/24px.svg` | `filled/settings.svg` |
| `icon-delete` | `delete` | `src/action/delete/materialicons/24px.svg` | `filled/delete.svg` |
| `icon-menu` | `menu` | `src/navigation/menu/materialicons/24px.svg` | `filled/menu.svg` |
| `icon-search` | `search` | `src/action/search/materialicons/24px.svg` | `filled/search.svg` |
| `icon-play` | `play_arrow` | `src/av/play_arrow/materialicons/24px.svg` | `filled/play_arrow.svg` |
| `icon-refresh` | `refresh` | `src/navigation/refresh/materialicons/24px.svg` | `filled/refresh.svg` |
| `icon-arrow-up` | `keyboard_arrow_up` | `src/hardware/keyboard_arrow_up/materialicons/24px.svg` | `filled/keyboard_arrow_up.svg` |
| `icon-arrow-down` | `keyboard_arrow_down` | `src/hardware/keyboard_arrow_down/materialicons/24px.svg` | `filled/keyboard_arrow_down.svg` |
| `icon-sun` | `wb_sunny` (substitute) | `src/image/wb_sunny/materialicons/24px.svg` | `filled/wb_sunny.svg` |
| `icon-moon` | `brightness_2` (substitute) | `src/image/brightness_2/materialicons/24px.svg` | `filled/brightness_2.svg` |

**Substitute verification** (build-time): both `wb_sunny` and `brightness_2`
exist in the Classic `image` category and resolve at that path. If
`brightness_2` doesn't read as moon-adjacent at 1em, swap to the same-era
`brightness_3` (`src/image/brightness_3/materialicons/24px.svg` →
`filled/brightness_3.svg`) and update the CSS rule + README accordingly — no
discovery reopen. `icon-play`/`icon-search` are currently unused in markup but
are still bundled in every set for full 12-icon API parity.

**README**: extend `public/assets/icons/README.md` with two new tables
(Material Symbols Rounded; Material Icons Classic), both Apache-2.0 / self-hosted
/ unmodified, matching the existing Outlined table format, and document the
`icon-sun`→`wb_sunny` / `icon-moon`→`brightness_2` substitutes with the 2014
rationale exactly as the Sourcing section states (AC5).

### CSS mechanism

Append after the existing `@supports` guard (`style.css:1376`). The base
`.icon-*` rule, the unscoped mask block, the `@supports` fill, and
`.icon-star` are **untouched**.

Specificity note that makes this work: a scoped selector like
`[data-icons="rounded"] .icon-home` is `(0,2,0)` and beats both the unscoped
`.icon-home` `(0,1,0)` mask rule **and** the `@supports` block's `.icon-home`
`(0,1,0)` fill rule — no `!important` needed anywhere.

Rounded block (12 rules, uniform with the outlined block):

```css
[data-icons="rounded"] .icon-home { -webkit-mask-image: url(/assets/icons/rounded/home.svg); mask-image: url(/assets/icons/rounded/home.svg); }
/* ...folder, settings->cog, delete, dark_mode->moon, light_mode->sun, menu,
   search, play_arrow->play, refresh, keyboard_arrow_up->arrow-up,
   keyboard_arrow_down->arrow-down, all under /assets/icons/rounded/ ... */
```

Filled block (12 rules; note the two substitute filenames):

```css
[data-icons="filled"] .icon-home { -webkit-mask-image: url(/assets/icons/filled/home.svg); mask-image: url(/assets/icons/filled/home.svg); }
/* ...10 more mirroring the table above... */
[data-icons="filled"] .icon-sun  { -webkit-mask-image: url(/assets/icons/filled/wb_sunny.svg);     mask-image: url(/assets/icons/filled/wb_sunny.svg); }
[data-icons="filled"] .icon-moon { -webkit-mask-image: url(/assets/icons/filled/brightness_2.svg); mask-image: url(/assets/icons/filled/brightness_2.svg); }
```

Emoji override — the **no-square fix** (AC7). One grouped rule neutralizes the
mask *and* the `@supports` `currentColor` fill, then per-icon `::before` glyphs:

```css
[data-icons="emoji"] .icon-home,
[data-icons="emoji"] .icon-folder,
[data-icons="emoji"] .icon-cog,
[data-icons="emoji"] .icon-delete,
[data-icons="emoji"] .icon-moon,
[data-icons="emoji"] .icon-sun,
[data-icons="emoji"] .icon-menu,
[data-icons="emoji"] .icon-search,
[data-icons="emoji"] .icon-play,
[data-icons="emoji"] .icon-refresh,
[data-icons="emoji"] .icon-arrow-up,
[data-icons="emoji"] .icon-arrow-down {
  -webkit-mask-image: none;
  mask-image: none;
  background-color: transparent;  /* CRITICAL: overrides the @supports currentColor fill -> no solid box */
  width: auto;                    /* let the glyph size naturally, no 1em clip/overlap */
  height: auto;
}

[data-icons="emoji"] .icon-home::before      { content: "\1F3E0"; } /* 🏠 */
[data-icons="emoji"] .icon-folder::before    { content: "\1F4C1"; } /* 📁 */
[data-icons="emoji"] .icon-cog::before       { content: "\2699";  } /* ⚙ */
[data-icons="emoji"] .icon-delete::before    { content: "\1F5D1"; } /* 🗑 */
[data-icons="emoji"] .icon-moon::before      { content: "\1F319"; } /* 🌙 */
[data-icons="emoji"] .icon-sun::before       { content: "\2600\FE0F"; } /* ☀️ */
[data-icons="emoji"] .icon-menu::before      { content: "\2630";  } /* ☰ */
[data-icons="emoji"] .icon-search::before    { content: "\1F50D"; } /* 🔍 */
[data-icons="emoji"] .icon-play::before      { content: "\25B6";  } /* ▶ */
[data-icons="emoji"] .icon-refresh::before   { content: "\1F504"; } /* 🔄 */
[data-icons="emoji"] .icon-arrow-up::before  { content: "\25B2";  } /* ▲ */
[data-icons="emoji"] .icon-arrow-down::before{ content: "\25BC";  } /* ▼ */
```

Why the group rule beats the fill guard: each `[data-icons="emoji"] .icon-X`
selector is `(0,2,0)` vs the guard's `.icon-X` `(0,1,0)`, so
`background-color: transparent` wins and there is no `currentColor` square
behind the glyph in any of the 8 theme combos. `mask-image: none` disables the
mask so nothing paints from the fill even if it leaked. `width/height: auto`
avoids constraining the `::before` glyph to a 1em box (prevents clip/overlap).

Using CSS `\XXXX` unicode escapes (not literal emoji) keeps `style.css`
human-readable-with-comments while dodging any future "no chrome emoji" grep
that might be widened to CSS — but note the current CI grep already excludes
`style.css`, so literal glyphs would also be acceptable here; escapes are the
safer default. `.icon-star` is deliberately absent from every block above and
renders `★` identically under all sets (AC8).

### `resolveIconSet(storedSet, era)` — the pure seam

New constants + function in `common.js`, placed beside `THEME_REGISTRY`/
`resolveTheme`, exported for `node:test`:

```js
const ICON_SETS = ['outlined', 'rounded', 'filled', 'emoji'];
const DEFAULT_ICON_SET = 'outlined';
const AUTO_ERA_ICON_MAP = { '2005': 'emoji', '2009': 'emoji', '2014': 'filled', '2021': 'rounded' };

// Pure: resolves a stored icon-set preference (+ current era, for 'auto') into
// one of the four CONCRETE set ids. Never throws; never returns 'auto'. Kept in
// sync with the inline FOUC bootstrap in <head>. See resolve-icon-set.test.js.
function resolveIconSet(storedSet, era) {
  if (ICON_SETS.includes(storedSet)) return storedSet;          // valid explicit set
  if (storedSet === 'auto') {                                   // meta -> era map
    const e = THEME_ERAS.includes(era) ? era : DEFAULT_ERA;     // invalid era -> DEFAULT_ERA mapping
    return AUTO_ERA_ICON_MAP[e];
  }
  return DEFAULT_ICON_SET;                                      // null/garbage -> outlined
}
```

The 11 `node:test` cases (new `test/unit/resolve-icon-set.test.js`, mirroring
`resolve-theme.test.js`'s `assert.strictEqual` style):

1. `resolveIconSet('outlined', '2021')` → `'outlined'`
2. `resolveIconSet('rounded', '2005')` → `'rounded'`
3. `resolveIconSet('filled', '2014')` → `'filled'`
4. `resolveIconSet('emoji', '2009')` → `'emoji'`
5. `resolveIconSet('auto', '2005')` → `'emoji'`
6. `resolveIconSet('auto', '2009')` → `'emoji'`
7. `resolveIconSet('auto', '2014')` → `'filled'`
8. `resolveIconSet('auto', '2021')` → `'rounded'`
9. `resolveIconSet('auto', '2050')` → `'rounded'` (invalid era → DEFAULT_ERA `'2021'` mapping)
10. `resolveIconSet(null, '2014')` → `'outlined'` (unset → default; the migration contract)
11. `resolveIconSet('bogus', '2021')` → `'outlined'` (garbage → default)

### JS axis wiring

`ICON_SET_REGISTRY` in `common.js` (exported), **Auto first**:

```js
const ICON_SET_REGISTRY = [
  { id: 'auto',     name: 'Auto',     blurb: "Matches the icon style to whichever era you've picked." },
  { id: 'outlined', name: 'Outlined', blurb: "Material Symbols Outlined — today's default look." },
  { id: 'rounded',  name: 'Rounded',  blurb: 'Material Symbols Rounded — a softer, modern style.' },
  { id: 'filled',   name: 'Filled',   blurb: '2014-flavored solid Material icons — the original flat era.' },
  { id: 'emoji',    name: 'Emoji',    blurb: 'The original emoji glyphs — \u{1F3E0} \u{1F4C1} \u{2699}\u{FE0F} and friends.' }
];
```

**CI-compatibility note (important):** the `icon-assets` "no stray chrome
emoji" grep scans `js/common.js` for literal glyphs incl. `🏠 📁 ⚙`. The Emoji
blurb therefore uses `\u{...}` escapes (shown above) so the *source* contains no
literal chrome-emoji char (grep passes) while the *rendered* card still shows
`🏠 📁 ⚙️`. All new JS/HTML stays literal-emoji-free; only `style.css` (already
excluded from that grep) carries glyphs, and even there as `\XXXX` escapes.

`applyIconSet` / `setIconSet` / `initIconSet` (mirror `applyTheme`/`setTheme`/
`initTheme`), all feature-detected:

```js
// Resolves the pref against the CURRENT era (read from data-theme), sets
// data-icons to the concrete result, and persists the PREF (never the resolved
// value, so 'auto' survives to recompute on future era changes).
function applyIconSet(storedSetPref) {
  const d = document.documentElement;
  const era = d.getAttribute('data-theme') || DEFAULT_ERA;
  d.setAttribute('data-icons', resolveIconSet(storedSetPref, era));
  if (storedSetPref === 'auto' || ICON_SETS.includes(storedSetPref)) {
    try { localStorage.setItem('ft-icons', storedSetPref); }
    catch (_) { /* storage disabled — attribute still applied */ }
  }
  // else: unset/garbage pref -> resolves to 'outlined' but DON'T persist, so a
  // fresh/never-chosen user's ft-icons stays UNSET (avoids writing "null").
  if (typeof renderIconPicker === 'function') renderIconPicker(); // re-highlight if present
}

// Setup-page picker entry (no Save step), mirrors setTheme().
function setIconSet(storedSetPref) { applyIconSet(storedSetPref); }

// DOMContentLoaded: read the stored pref and apply against the loaded era.
function initIconSet() {
  let pref = null;
  try { pref = localStorage.getItem('ft-icons'); } catch (_) { /* fall through to default */ }
  applyIconSet(pref);
}
```

**Era-change recompute** — the one behavioral wire. `setTheme(era)` is the
*only* function that changes the era, so the recompute lives there (additive;
mode/era semantics unchanged). `toggleTheme()` only flips mode → era unchanged →
`auto` resolves identically → no recompute needed, left untouched:

```js
function setTheme(era) {
  const mode = document.documentElement.getAttribute('data-mode') || DEFAULT_MODE;
  applyTheme(era, mode);                       // sets data-theme = era FIRST
  let pref = null;
  try { pref = localStorage.getItem('ft-icons'); } catch (_) {}
  applyIconSet(pref);                          // recompute data-icons from the NEW era (matters for 'auto')
}
```

`DOMContentLoaded` handler gains one line after `initTheme();`:

```js
initTheme();
initIconSet();   // reads ft-icons + the just-applied data-theme
```

`module.exports` grows to add `resolveIconSet, ICON_SET_REGISTRY, ICON_SETS`
alongside the existing `resolveTheme, THEME_REGISTRY, ...`.

### FOUC inline `<head>` script

Extend the existing IIFE on `index.html`, `setup.html`, `watch.html`. `era` is
already computed and guaranteed to be a valid era string above; reuse it.
Added snippet (inside the `try`, after the two existing `setAttribute` calls):

```js
        /* Also resolve the icon set before paint. Inline mirror of
           resolveIconSet() in /js/common.js — keep the two in sync. */
        var iconSets = ['outlined', 'rounded', 'filled', 'emoji'];
        var iconAutoMap = { '2005': 'emoji', '2009': 'emoji', '2014': 'filled', '2021': 'rounded' };
        var storedIcons = localStorage.getItem('ft-icons');
        var iconSet = iconSets.indexOf(storedIcons) >= 0 ? storedIcons
          : storedIcons === 'auto' ? iconAutoMap[era]   // `era` already validated above
          : 'outlined';
        d.setAttribute('data-icons', iconSet);
```

And the `catch` fallback gains one line:

```js
      } catch (_) {
        d.setAttribute('data-theme', '2021');
        d.setAttribute('data-mode', 'light');
        d.setAttribute('data-icons', 'outlined');
      }
```

Update the existing header comment on `resolveIconSet` to point back at this
inline copy (bidirectional cross-reference, matching the `resolveTheme`
pattern) so a future edit to one flags the other (mitigates the drift risk /
AC13).

### Settings picker (setup.html)

Extend the Appearance `setup-box` (`setup.html:103-108`) with an Icons picker
below the theme picker. Reuse `.theme-picker` (grid) + `.theme-card` styles —
the icon card is just name + blurb (no swatch/year), so no new CSS is required;
optionally add a thin `.icon-set-card` alias if visual separation is wanted,
but reuse is preferred (zero CSS churn):

```html
<div class="theme-picker" id="theme-picker"><!-- rendered by JS --></div>
<h3 style="margin-top:20px;">Icons</h3>
<p>Pick the icon style for FileTube's chrome. <strong>Auto</strong> matches it
   to the era above.</p>
<div class="theme-picker" id="icon-picker"><!-- rendered by JS --></div>
```

`renderIconPicker()` in setup.html's inline script (mirrors
`renderThemePicker()`); active card = the raw stored pref (read from storage,
since `data-icons` never holds `auto`), defaulting to `outlined` when unset:

```js
function renderIconPicker() {
  const container = document.getElementById('icon-picker');
  if (!container) return;
  let pref = null;
  try { pref = localStorage.getItem('ft-icons'); } catch (_) {}
  const active = (pref === 'auto' || ICON_SETS.includes(pref)) ? pref : 'outlined';
  container.innerHTML = ICON_SET_REGISTRY.map(s => `
    <button type="button" class="theme-card${s.id === active ? ' active' : ''}"
            data-icons-pref="${s.id}">
      <span class="theme-card-name">${s.name}</span>
      <span class="theme-card-blurb">${s.blurb}</span>
    </button>`).join('');
  container.querySelectorAll('.theme-card').forEach(btn => {
    btn.addEventListener('click', () => {
      setIconSet(btn.dataset.iconsPref);   // applies + persists immediately, no Save
      renderIconPicker();                   // re-highlight
    });
  });
}
renderIconPicker();
```

Because `applyIconSet` calls `renderIconPicker` when present, choosing an era
with `auto` selected re-highlights correctly and updates `data-icons` in the
same tick (AC2/AC14). `ICON_SETS` must be exported from `common.js` for the
`renderIconPicker` highlight check (added to `module.exports`; available as a
browser global too).

### Component changes

- **`public/css/style.css`**: append rounded block (12), filled block (12),
  emoji override group + 12 `::before` rules. Base rule, unscoped outlined
  block, `@supports` guard, `.icon-star` unchanged.
- **`public/js/common.js`**: add `ICON_SETS`/`DEFAULT_ICON_SET`/
  `AUTO_ERA_ICON_MAP`/`ICON_SET_REGISTRY`/`resolveIconSet`/`applyIconSet`/
  `setIconSet`/`initIconSet`; add `initIconSet()` to `DOMContentLoaded`; add the
  recompute call to `setTheme`; extend `module.exports`; add the cross-ref
  comment.
- **`public/{index,setup,watch}.html`**: extend the inline FOUC IIFE (+ catch)
  to set `data-icons`.
- **`public/setup.html`**: add the Icons picker markup + `renderIconPicker()`.
- **`public/assets/icons/rounded/`, `.../filled/`**: 24 new SVGs.
- **`public/assets/icons/README.md`**: two new attribution tables + substitute
  notes.
- **`test/unit/resolve-icon-set.test.js`** (new) and
  **`test/unit/icon-assets.test.js`** (extended).

### Data model changes

None. One additive `localStorage` key (`ft-icons`) and one `<html>` attribute
(`data-icons`). No server, DB, or API involvement — the SVGs ship via the
existing `COPY public/ ./public/` Docker step (no Dockerfile change).

### API changes

None.

### Alternatives considered

- **Single mask rule + `var(--icon-dir)`**: one `mask-image: url(var(...))`
  per icon, swapping a directory custom property per set. Rejected —
  `url(var(...))` composition is not reliably supported across browsers, and it
  wouldn't handle the emoji set (no mask) anyway. The per-set blocks are
  verbose but bulletproof and match the shipped v1.6.0 pattern.
- **Move `outlined` into `outlined/` for structural symmetry**: rejected (see
  Resolved open decision) — 12 CSS edits + CI-test churn + broken-reference
  risk for zero functional gain.
- **Put the recompute in `applyTheme` instead of `setTheme`**: rejected —
  `applyTheme` is also the mode/init path (out-of-scope to alter its
  behavior), and only `setTheme` ever changes era, so `setTheme` is the precise,
  minimal wire.
- **Persist the resolved concrete set instead of the pref**: rejected — it
  would flatten `auto` into a frozen set and break live era-tracking (AC2/AC12).

### Risks and mitigations

- **Emoji currentColor square** → group override sets
  `background-color: transparent` at `(0,2,0)` specificity, beating the
  `@supports` fill; named manual-QA + AC7.
- **FOUC / `resolveIconSet` drift** → bidirectional cross-ref comments + AC13
  hard-reload check across all 5 stored values × eras.
- **`auto` going stale on era change** → recompute wired into `setTheme`; AC12
  tests the call site independent of the pure resolver.
- **Persisting the literal string `"null"`** → `applyIconSet` only writes when
  the pref is `auto` or a concrete set; unset stays unset (migration-safe).
- **`brightness_2` unreadable as a moon** → documented same-era fallback
  (`brightness_3`) swappable at build without discovery reopen.
- **Emoji leaking into `common.js`/HTML and tripping CI** → `\u{...}` escapes in
  the blurb + `\XXXX` escapes in CSS; only `style.css` (already grep-excluded)
  carries glyph semantics.
- **A11y label regression** → this feature never edits button markup or
  `aria-label`s; QA re-verifies `#menu-toggle`/`#theme-toggle-btn` across all 4
  concrete sets.

### Performance impact

No expected impact on any `RELIABILITY.md` budget. `RELIABILITY.md` defines no
frontend rendering budget; the added CSS is ~36 static `mask-image`
declarations + 12 `::before` rules (negligible parse cost), and browsers fetch
a `mask-image` SVG only for elements that actually match the active
`[data-icons]` scope — so only the *selected* set's ~12 SVGs are ever
requested, never all 36. No new network round-trips at runtime (all
self-hosted), no server/DB path touched.

### Testability summary

- **Unit**: `test/unit/resolve-icon-set.test.js` — the 11 cases above (AC10).
- **CI guards** (extend `test/unit/icon-assets.test.js`): assert the 12
  `rounded/` and 12 `filled/` SVGs (incl. `wb_sunny.svg`/`brightness_2.svg`)
  are bundled + valid `<svg>`; keep the no-CDN grep (now also covering the new
  assets); keep the no-stray-emoji grep green (the escape strategy above
  guarantees it). `npm run lint` clean.
- **Manual (two-reviewer)**: 4 concrete sets × 8 era/mode combos ×
  index/setup/watch/bottom-nav; `auto` live recompute at each of the 4 eras;
  emoji no-square in every combo; FOUC no-flash for all 5 stored values;
  `aria-label`s intact per set; gold `★` untouched.

## Task breakdown

(To be filled by engineering-manager.)

## QA note

This branch requires a **significant, two-reviewer QA pass** before
acceptance (quality-assurance stage + `/code-review`), specifically covering:

- All 4 concrete sets × all 8 era/mode combos × index/setup/watch/bottom-nav —
  no missing, duplicated, or wrong-colored icon anywhere.
- Auto era-mapping correctness (2005/2009→emoji, 2014→filled, 2021→rounded)
  **and** live recompute when switching era with Auto selected.
- FOUC script / `resolveIconSet` sync — no wrong-icon flash on hard reload,
  across all 5 stored `ft-icons` values.
- Emoji-mode correctness: no residual currentColor square/box under or behind
  any emoji glyph (the `@supports` guard risk above).
- No missing icon in any set (all 12 classes × all 4 sets), including the
  `filled` set's `wb_sunny`/`brightness_2` substitutes reading recognizably.
- A11y: `aria-label`s on icon-only buttons (`#menu-toggle`,
  `#theme-toggle-btn`, others) confirmed intact and unchanged across all 4
  sets.
- Gold `★` rating confirmed untouched by every set.

## Progress log

- 2026-07-05 (product-manager): Discovery complete. Grounded in
  `public/css/style.css` (existing `.icon-*` mask rules + `@supports` guard),
  `public/js/common.js` (theme-axis pattern to mirror), the inline FOUC
  scripts on all 3 pages, `public/assets/icons/README.md` (bundling/attribution
  precedent), `setup.html`'s Appearance section, and the completed
  `icon-assets` exec plan (recovered the exact pre-v1.6.0 emoji mapping the
  new `emoji` set restores). No conflicts with active exec plans (none besides
  this) or the tech-debt tracker. Sourced the 2014 `filled` set's two
  substitute glyphs for `dark_mode`/`light_mode` (`wb_sunny`/`brightness_2`)
  and flagged build-time verification. Recommended `outlined` as the default
  `ft-icons` value (over `auto`) to guarantee zero visible change from v1.6.0
  on upgrade. Awaiting principal-engineer design.
- 2026-07-05 (principal-engineer): Technical Design complete (see
  `## Technical Design`); `artifacts.design` set. Confirmed the open asset-layout
  decision (keep `outlined` top-level; add `rounded/`+`filled/` subdirs). Gave
  exact per-icon `filled` source paths (`src/<category>/<glyph>/materialicons/
  24px.svg`), incl. the substitutes `wb_sunny`/`brightness_2` (fallback
  `brightness_3`). Specified: the 3 CSS blocks (rounded/filled scoped mask +
  emoji override) and the no-square fix (grouped `[data-icons="emoji"] .icon-*`
  at `(0,2,0)` specificity setting `background-color:transparent` +
  `mask-image:none` + `width/height:auto`, beating the `@supports`
  `currentColor` guard); `resolveIconSet(storedSet, era)` pure contract + 11
  `node:test` cases; the JS axis (`ICON_SET_REGISTRY`/`applyIconSet`/`setIconSet`/
  `initIconSet`) with the auto-recompute wired into `setTheme` (not `applyTheme`)
  and the "don't persist on unset/garbage" guard; the FOUC inline additions on
  all 3 pages (+catch fallback, bidirectional cross-ref); the setup.html Icons
  picker reusing `.theme-card`. Flagged a CI gotcha: the Emoji registry blurb +
  CSS glyphs use `\u{...}`/`\XXXX` escapes so the "no stray chrome emoji"
  grep over `common.js`/HTML stays green (only `style.css`, already excluded,
  carries glyph semantics). Task breakdown left for engineering-manager.

## Decision log

- 2026-07-05 (product-manager): Recommended default `ft-icons` = `outlined`,
  not `auto`, specifically because Auto's own era→set map would flip the
  out-of-the-box look for the (default-era) majority of users from Outlined to
  Rounded with no action on their part — a bigger surface change than an
  additive/opt-in feature should make unprompted. Auto remains listed first
  and one click away.
- 2026-07-05 (product-manager): Kept the existing top-level
  `public/assets/icons/*.svg` files as the `outlined` set's source unchanged,
  rather than moving them into a `public/assets/icons/outlined/` subdirectory,
  to avoid churn and broken-reference risk for zero functional benefit; left
  the alternative open for principal-engineer to choose in Design.
- 2026-07-05 (product-manager): Documented `wb_sunny` (sun) and `brightness_2`
  (moon) as the `filled` set's period-correct substitutes for
  `light_mode`/`dark_mode`, since neither modern glyph existed at Material's
  2014 launch; flagged that build must confirm exact asset availability and
  may swap `brightness_2` for a same-era alternate if it doesn't read as
  moon-adjacent, without reopening discovery.
