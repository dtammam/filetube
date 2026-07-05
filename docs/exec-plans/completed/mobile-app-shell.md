> **COMPLETED — Shipped v1.5.0 (2026-07-04).** This is the archived record of the
> Mobile App Shell feature. The phone-width YouTube-mobile-app layout shipped:
> the fixed 4-item bottom nav (Home / Playlists / Dark-Light / Settings) on
> index/setup/watch, the mobile top restructure (centered `/favicon.svg` logo +
> full-width search pill, header-right folded into the nav), the scoped
> Playlists bottom sheet (lazy `/api/config`, `/?root=<path>` links, sidebar
> parity) with the hamburger reconciled to a single mobile path to folders, the
> iOS safe-area handling (`viewport-fit=cover` on all three pages +
> `env(safe-area-inset-*)` insets), the pure exported `activeNavItem` helper
> with node:test coverage, and zero desktop regression (all shell CSS behind the
> existing `@media (max-width: 768px)` breakpoint). Two-reviewer QA passed
> (QA APPROVE-WITH-NITS caught landscape nav/player overlap; the code-review
> workflow caught 2 show-stoppers QA missed — the Playlists sheet showing on
> every mobile load and a missing `safe-area-inset-top` under
> `viewport-fit=cover` — all fixed; 86 tests green). The matching
> `docs/exec-plans/active/mobile-app-shell.md` copy is a stale tombstone to be
> `git rm`'d by the main loop.

# Mobile App Shell (v1.5.0)

## Goal

Give the HOME screen a YouTube-mobile-app layout — centered logo, prominent
search, and a fixed bottom nav — on phone-width viewports only, with zero
change to the desktop experience, themed correctly across all 4 eras x
light/dark using the existing v1.4.0 design tokens.

## Context

- The app already has one responsive breakpoint, `@media (max-width: 768px)`,
  in `public/css/style.css`, which today: slides the `.sidebar` off-canvas
  (toggled by the `#menu-toggle` hamburger in `.header-left`), collapses
  `.main-content` margin, shrinks header padding/search, and hides the
  header-right Settings `.btn` (but **not** `#theme-toggle-btn`, which stays
  visible in the header on mobile today).
- All three pages (`index.html`, `setup.html`, `watch.html`) share the same
  `<header>` + `.sidebar` shell; `index.html` and `watch.html` additionally
  have `.header-search`. `setup.html` has no search bar.
- The sidebar already has a "Playlists (Folders)" section
  (`#sidebar-folders-list`) populated by `renderSidebarFolders()` in
  `main.js` (and duplicated inline in `setup.html`), each folder rendered as
  `<a href="/?root=<path>" class="sidebar-item">`. This is the folder data
  the bottom nav's Playlists entry must surface — there is no separate
  "playlist" concept in the backend; folders **are** playlists.
- Icons: the codebase already defines emoji/glyph icon classes for exactly
  what's needed — `.icon-home`, `.icon-folder`, `.icon-cog`, `.icon-moon`,
  `.icon-sun` (`public/css/style.css`, "Custom icon fonts" section). No new
  icon assets should be required.
- `toggleTheme()` (`public/js/common.js`) flips `data-mode` only (light/dark);
  it does not touch the era (`data-theme`), which is chosen on the Setup
  page's Appearance picker. This confirms the bottom nav's "Dark/Light" item
  maps directly to the existing `toggleTheme()` call, not a new mechanism.
- Design tokens live in `:root` / `[data-theme="…"]` blocks (`--radius`,
  `--radius-lg`, `--font-family`, `--density`, colors, `--shadow`) and are
  what make the 8 era x mode combos look distinct (e.g. 2005 is `--radius: 0`
  sharp/plain Verdana; 2021 dark is rounded `--radius-lg: 12px` Roboto). Any
  new component must consume these tokens, not hardcode colors/radii/fonts.
- **iOS safe-area gap in current markup:** none of the three pages set
  `viewport-fit=cover` in their `<meta name="viewport">` tag. Per the iOS
  Safari spec, `env(safe-area-inset-*)` resolves to `0` unless the viewport
  meta declares `viewport-fit=cover`. This must be corrected for the
  safe-area acceptance criterion to be verifiable at all — flagging it here
  since it's easy to miss (the CSS can be perfect and still show `0`).
- **No inline logo mark exists today.** The header logo is a text logotype
  (`File<span class="tube">Tube</span>`), not an image. The assignment calls
  for the mobile centered logo to use the served `/favicon.svg` icon
  specifically — this requires adding a small additional logo element
  (shown mobile-only; desktop keeps the current text logotype unchanged).

## Scope

- A fixed bottom nav bar, phone-width viewports only, 4 items left to right:
  **Home** (`/`) · **Playlists** (folders) · **Dark/Light** (`toggleTheme()`)
  · **Settings** (`/setup.html`) — each with icon + label, reusing the
  existing icon glyph classes.
- Mobile-only top restructure: centered FileTube icon (`/favicon.svg`) with a
  prominent search pill below it, reusing `#search-input`'s existing
  behavior (`performSearch()` in `main.js`). Header-right (Settings `.btn` +
  `#theme-toggle-btn`) is hidden on mobile — those actions move to the
  bottom nav.
- iOS safe-area handling for the fixed bottom bar (including the
  `viewport-fit=cover` correction above) and bottom padding on scrollable
  content so the fixed bar never covers the last row/section.
- Active-state highlighting in the bottom nav for the current section.
- Reconciling the existing mobile hamburger/sidebar with the new bottom nav
  (see Decision: Playlists UX, below) so there is one clear way to reach
  folders on mobile, not two competing ones.
- All new styling lives behind the existing `@media (max-width: 768px)`
  breakpoint (or a narrower phone-specific one nested within it, if the
  principal-engineer's design determines the current 768px tablet range is
  too wide for this layout — to be resolved in design, not here). No new
  top-level breakpoint value should be introduced without reason; reuse the
  established one.
- Themed via existing tokens only — must read correctly in all 8 era x mode
  combinations (2005/2009/2014/2021 x light/dark).

## Out of scope

- No backend/API changes. No new "playlist" data model — folders already
  are the playlist unit, surfaced via `/api/config` + `folderSettings`.
- No desktop redesign or desktop layout changes of any kind.
- No changes to `toggleTheme()`/`initTheme()`/era-picker logic — the bottom
  nav only *calls* the existing function.
- No native app packaging, push notifications, or other PWA features beyond
  the safe-area CSS fix already implied by the bottom nav.
- No redesign of the watch page's player, skip-controls, or transcode
  overlay beyond ensuring the new fixed bottom bar doesn't overlap them
  (z-index reconciliation only, not a visual redesign of those elements).

## Decisions made in discovery

### Decision: Playlists nav item — dedicated scoped panel, not the full sidebar

**Recommendation: option (b)** — a dedicated, lightweight overlay/sheet that
lists only the folders (same data as `#sidebar-folders-list`, same
`/?root=<path>` links), not the full existing `.sidebar`.

**Why, not (a) reusing the full mobile sidebar as-is:**
- The existing `.sidebar` also contains a "Home" link and a "Library
  Settings" link. Both of those already have dedicated, more prominent
  bottom-nav items in this feature. Opening the full sidebar from a
  "Playlists" tap would show the user two more ways to reach Home and
  Settings than they just used to get there — a confusing, redundant
  affordance in a shell whose whole point is a clean 4-item bottom nav.
- A scoped panel matches the mental model this shell is emulating (tapping
  "Library"-style tabs in a mobile app surfaces *only* that tab's content).
- It still reuses the existing folder-rendering data/links
  (`/?root=<path>`, folder display names from `folderSettings`) — this is
  a presentation change (what wraps the list), not a new data path.

**Consequence — the hamburger must be reconciled:** on mobile, the header
simplifies to centered-logo + search only, and `#menu-toggle` (which today
opens the full `.sidebar`) is redundant with the new bottom nav (Home,
Playlists, Settings all now have direct bottom-nav entry points). The
hamburger should be hidden on mobile so there is exactly one way to reach
folders (the bottom nav's Playlists item), not two overlapping ones. This
is called out explicitly as an acceptance criterion and a risk below.

### Decision: bottom nav appears on all three mobile pages (index, setup, watch)

**Recommendation:** yes, on `index.html`, `setup.html`, and `watch.html` —
justified by app-consistency (a persistent bottom nav that vanishes on one
of three pages breaks the "app shell" illusion this feature exists to
create) and by the fact that it is one shared component behind one shared
media query, not three bespoke builds. Home is the priority surface for
polish; `setup.html` and `watch.html` need the same fixed bar with correct
safe-area/z-index handling but can lean on the same CSS.

**Caveat:** `watch.html` needs the most care — it already has several
absolutely/fixed-positioned mobile-relevant overlays (`#resume-overlay`,
`#transcode-overlay`, `#skip-controls`, `#speed-badge`) plus a comments
section that scrolls to the bottom of the page. The bottom nav must sit
above all page content but must not intercept taps meant for the native
`<video>` controls, and the page's bottom padding must clear the fixed bar
so the comments section and delete button aren't hidden behind it.

## Constraints

- Zero desktop regression: every new rule must be scoped inside the
  existing (or a phone-specific nested) mobile media query; nothing outside
  it may change.
- Themed via existing design tokens only (`--radius`, `--radius-lg`,
  `--font-family`, `--density`, color tokens, `--shadow`) — no hardcoded
  colors, fonts, or corner radii in the new component. Must render
  correctly in all 8 era x mode combinations.
- `viewport-fit=cover` must be added to the `<meta name="viewport">` tag on
  all three pages for `env(safe-area-inset-bottom)` to have any effect on
  iOS.
- Reuse `toggleTheme()` and existing folder data/link patterns
  (`/?root=<path>`) — no new theme mechanism, no new folder API.
- No new build tooling; plain CSS/vanilla JS per `docs/CONTRIBUTING.md`.

## Acceptance criteria

**Bottom nav bar**
- [x] A fixed bottom nav renders with exactly 4 items, left to right: Home,
      Playlists, Dark/Light, Settings — each with an icon (reusing existing
      `.icon-*` glyph classes) and a text label.
- [x] The bottom nav is visible only below the mobile breakpoint; at
      desktop widths it does not render/is not visible, and no desktop CSS
      rule outside the mobile media query changes as part of this feature
      (zero desktop regression, spot-checked against the current desktop
      layout).
- [x] The bottom nav's colors, corner radius, font, and spacing are driven
      entirely by existing design tokens (no hardcoded values) — verified
      by inspecting the new CSS and by visually checking it in all 8 era x
      mode combinations.
- [x] Home item links to `/`; Settings item links to `/setup.html`;
      Dark/Light item calls the existing `toggleTheme()` and its icon/label
      reflects the current mode (mirroring `#theme-toggle-btn`'s existing
      🌙/☀️ swap behavior); Playlists item opens the scoped folders
      panel/sheet described in the Decision above.

**Playlists panel**
- [x] Tapping Playlists opens a panel/sheet listing every folder from
      `/api/config` (respecting each folder's display name from
      `folderSettings` and its existing `hidden` flag where the current
      sidebar already respects it), each item linking to `/?root=<path>` —
      i.e., functionally equivalent folder data/links to today's
      `#sidebar-folders-list`, just scoped to folders only (no Home/Library
      Settings items duplicated inside it).
- [x] The existing mobile hamburger/full-sidebar affordance is reconciled
      (hidden or otherwise made non-redundant) so there is exactly one
      mobile path to the folder list, not two.

**iOS safe-area**
- [x] The fixed bottom bar's CSS includes `padding-bottom:
      env(safe-area-inset-bottom)` (or equivalent), and all three pages'
      `<meta name="viewport">` tags include `viewport-fit=cover` so the
      env() value is non-zero on notched/home-indicator iOS devices.
- [x] Scrollable page content (main content on index/setup, and the full
      watch-page column including comments) reserves enough bottom padding
      that the fixed nav never visually overlaps the last grid row, last
      setup-page control, or the comment box/delete button on watch.

**Mobile top restructure**
- [x] On mobile, the header shows a centered FileTube icon (`/favicon.svg`)
      with the search pill (existing `#search-input` behavior, unchanged)
      below it; the header-right Settings link and `#theme-toggle-btn` are
      not shown in the header on mobile (their functions live in the bottom
      nav now).
- [x] Desktop header is visually and functionally unchanged (text logotype,
      inline search, header-right Settings + moon toggle all intact).

**Active state**
- [x] The bottom nav visually marks the current section: Home is marked
      active on `/` (including with `?search=` or `?root=` query strings,
      since those are still the home grid); Settings is marked active on
      `/setup.html`. Dark/Light and Playlists are momentary actions (a
      toggle and a sheet-opener, respectively) and do not carry a
      persistent "active" state the way Home/Settings do; Playlists may
      show a transient pressed/open state while its panel is open.
- [x] On `watch.html`, the nav does not falsely mark Home or Settings as
      active (watch is its own section, not a sub-state of either).

**Page scope**
- [x] The bottom nav (with correct safe-area padding and content
      clearance) renders correctly on `index.html`, `setup.html`, and
      `watch.html` on mobile.
- [x] On `watch.html` specifically: the bottom nav does not intercept taps
      intended for the native video controls or the existing
      `#skip-controls`/`#speed-badge` elements, and sits at a z-index that
      doesn't conflict with `#resume-overlay` / `#transcode-overlay`
      (those overlays, when shown, should still be fully usable — the nav
      should not float on top of them in a way that blocks their buttons,
      nor be hidden fully behind them for state that persists after the
      overlay closes).

## Testability

This feature is almost entirely visual/responsive/CSS work — there is very
little pure logic to unit test, and CI cannot judge layout correctness.
Per `docs/CONTRIBUTING.md` ("every feature ships with tests"):

- If the active-nav-item logic is extracted as a small pure function (e.g.
  something like "given a pathname, which of Home/Settings is current"),
  it is pure and server/`node:test`-testable and **must** get a unit test
  under `test/unit/` (this is a design decision for the principal-engineer
  — if it ends up as inline DOM-coupled logic instead, it stays manually
  verified, but extraction to a pure function is preferred specifically so
  it *can* be tested).
- Everything else (layout, theming, safe-area, z-index, active-state
  visuals) has no automated coverage path in this repo — no headless
  browser/visual-regression tooling exists here. This must be verified
  manually before acceptance. Manual checklist:
  - [ ] All 8 era x mode combinations look coherent (correct radius, font,
        colors) in the bottom nav and mobile header.
  - [ ] Desktop (>768px, or the design's chosen breakpoint) is pixel-
        identical to today's layout — header, sidebar, main content.
  - [ ] Bottom nav appears and functions on index, setup, and watch at
        mobile widths.
  - [ ] iOS safe-area: verified on an actual notched device (or Safari's
        device simulation with `viewport-fit=cover`) that the bar clears
        the home indicator and page content isn't hidden behind the bar.
  - [ ] Active-state correctness across `/`, `/?root=...`, `/?search=...`,
        `/setup.html`, and a `watch.html` URL.
  - [ ] Playlists panel shows the correct folder set/names/order matching
        `/api/config`, and the old hamburger/full-sidebar path no longer
        offers a competing way to reach folders.
  - [ ] Watch page: bottom nav doesn't block skip/resume/transcode overlay
        interactions.

## Risks

- **Desktop regression via leaky media queries.** Highest-priority risk —
  any new rule that lands outside the mobile media query (or a selector
  broad enough to also match desktop) breaks the "zero desktop regression"
  requirement. Needs careful scoping and an explicit desktop-unchanged
  check in QA.
- **Fixed bar covering content.** Both the home grid's last row and the
  watch page's comment/delete-button area are natural places for the fixed
  bar to visually clip content if bottom padding isn't sized to the bar's
  actual (safe-area-inclusive) height.
- **iOS safe-area / home-indicator overlap**, compounded by the missing
  `viewport-fit=cover` today — if that meta fix is missed, `env()` silently
  evaluates to 0 and the bar will sit under the home indicator on notched
  iPhones despite "correct-looking" CSS.
- **z-index conflicts** with the watch page's existing overlays
  (`#resume-overlay`, `#transcode-overlay`, z-index 10), `#skip-controls`
  (z-index 6), the sidebar (z-index 99), the header (z-index 1000), and
  modals (z-index 2000). The new fixed bar needs a z-index that's
  intentionally chosen relative to all of these, not just "high enough."
- **Theming gaps.** A single hardcoded color/radius/font in the new
  component will look fine in 2021 dark (today's de facto reference look)
  and visibly wrong in 2005/2009/2014 — this class of bug is easy to miss
  without explicitly cycling all 8 combos.
- **Duplicate navigation vs. the existing hamburger/sidebar.** If the
  hamburger is left as-is, mobile users get two different, overlapping
  ways to reach folders (and, via the full sidebar, redundant Home/Settings
  links) — addressed by the Playlists decision above, but it's a real risk
  if the hamburger reconciliation is skipped or done inconsistently across
  the three pages.

## Non-goals

- No new backend endpoints or data model — folders already are playlists.
- No desktop redesign.
- No native app packaging / push notifications / offline support beyond
  the incidental safe-area CSS fix.

## QA note

This branch requires a significant two-reviewer QA pass before acceptance.
Top targets, in priority order: (1) zero desktop regression, (2) theming
correctness across all 8 era x mode combinations, (3) iOS safe-area
behavior (including the `viewport-fit=cover` fix), (4) z-index/overlay
conflicts on the watch page, (5) active-state correctness across routes.
Given the lack of automated visual coverage, QA should work through the
manual checklist above item by item rather than spot-checking.

## Design

### Technical Design

#### 1. Breakpoint and scoping

Reuse the **existing** phone breakpoint already in `public/css/style.css`:
`@media (max-width: 768px)` (line 1349). No new top-level breakpoint value is
introduced. **Every** visible/layout rule for the shell lives inside that
media query.

The one unavoidable exception to "desktop gets nothing": the new elements
(`.bottom-nav`, the Playlists sheet, and the mobile logo) are brand-new
selectors that must not render on desktop. They are hidden by a single
**additive** base rule placed just above the media query:

```css
/* New mobile-shell elements never render outside the phone breakpoint.
   Additive: new selectors only — no existing desktop rule is touched. */
.bottom-nav,
.playlists-sheet,
.playlists-sheet-backdrop,
.mobile-logo {
  display: none;
}
```

This adds selectors that did not exist before; it changes no existing desktop
rule, so it is zero-regression by construction. All `display: flex/block`
"turn-on" plus positioning/theming lives inside the media query. This is the
correct reading of the "all new shell CSS behind the mobile query" constraint —
a new element still needs a hide rule so it does not fall back to its default
`display`.

#### 2. Bottom nav

**Shared markup** — one identical block added to `index.html`, `setup.html`,
and `watch.html`, placed immediately after `</div>` closing `.app-container`
and before the `<script>` tags:

```html
<nav class="bottom-nav" id="bottom-nav" aria-label="Primary">
  <a href="/" class="bottom-nav-item" data-nav="home">
    <i class="icon-home"></i>
    <span class="bottom-nav-label">Home</span>
  </a>
  <button type="button" class="bottom-nav-item" data-nav="playlists" id="nav-playlists-btn">
    <i class="icon-folder"></i>
    <span class="bottom-nav-label">Playlists</span>
  </button>
  <button type="button" class="bottom-nav-item" data-nav="theme" id="nav-theme-toggle">
    <i class="icon-moon"></i>
    <span class="bottom-nav-label">Dark</span>
  </button>
  <a href="/setup.html" class="bottom-nav-item" data-nav="settings">
    <i class="icon-cog"></i>
    <span class="bottom-nav-label">Settings</span>
  </a>
</nav>
```

Home and Settings are `<a>` (real navigation); Playlists and Dark/Light are
`<button>` (in-page actions). Icons reuse the existing glyph classes
(`.icon-home`, `.icon-folder`, `.icon-moon`/`.icon-sun`, `.icon-cog`) — no new
assets.

**CSS** (inside `@media (max-width: 768px)`), fully token-driven:

```css
.bottom-nav {
  display: flex;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 900;
  justify-content: space-around;
  align-items: stretch;
  background: var(--header-bg);
  border-top: 1px solid var(--border-color);
  box-shadow: var(--shadow);
  padding-bottom: env(safe-area-inset-bottom);
  font-family: var(--font-family);
}

.bottom-nav-item {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 8px 0 6px;
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: none;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 11px;
}

.bottom-nav-item i {
  font-size: 20px;
  line-height: 1;
  color: inherit;
}

.bottom-nav-item.active {
  color: var(--yt-red);
}
```

Colors, border, shadow, and font all come from tokens, so the bar renders
correctly across all 8 era x mode combos. Active color uses `--yt-red` (the
one brand accent that stays constant and legible across every era/mode);
`--text-secondary` is the resting label color. `border-radius` is not applied
to the fixed edge-to-edge bar itself (a full-width bar has no visible corners),
but the Playlists sheet below consumes `--radius-lg` where corners are visible.

**z-index = 900.** Chosen relative to the documented stack:

| Layer | z-index | Notes |
|-------|---------|-------|
| Page content | auto | below everything |
| Sidebar | 99 | hidden on mobile |
| **Bottom nav** | **900** | above content, below header/modals |
| Header | 1000 | fixed top bar |
| Playlists sheet backdrop / panel | 1500 / 1501 | covers nav + header, below modal |
| `showConfirmModal` backdrop | 2000 | delete-confirm covers the nav |
| watch `#resume-overlay` / `#transcode-overlay` | 10 (local) | see below |

The watch overlays are `position: absolute` **inside** `.player-container`
(a `position: relative` element that creates its own stacking context), so
their `z-index: 10` is local to the player and never competes with the
root-level fixed nav. On mobile the player sits at the top of the watch
column, so the bottom nav is physically far from the overlays and cannot cover
their buttons. `#skip-controls` (z-index 6) is already `display: none` on
mobile (line 1388). `#speed-badge` (z-index 20) is likewise local to the
player. Result: **no positional or stacking conflict** with any watch overlay;
the delete-confirm modal (2000) still correctly covers the nav.

**Content clearance.** Add a mobile-only bottom spacer to `.main-content`
(which wraps the scrollable body on all three pages — home grid, setup boxes,
and the full watch column incl. comments/delete) inside the media query:

```css
.main-content {
  margin-left: 0;
  padding: 16px;
  padding-bottom: calc(72px + env(safe-area-inset-bottom));
}
```

72px ≈ nav content height (~56px) + breathing room; the `env()` term adds the
home-indicator inset so the last row/control/comment box is never clipped.
(The existing rule already sets `margin-left: 0; padding: 16px`; this replaces
it, adding the `padding-bottom`.)

#### 3. viewport-fit=cover

On all three pages, replace the viewport meta tag exactly:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

Without `viewport-fit=cover`, iOS Safari resolves every `env(safe-area-inset-*)`
to `0`, so this is a hard prerequisite for the `padding-bottom` in section 2 to
do anything on a notched device. No other viewport attributes change.

#### 4. Mobile top restructure

Decision: **use a `/favicon.svg` `<img>`**, not the recentered text logotype.
Justification: the scope and AC (line 199) explicitly call for the centered
FileTube icon sourced from `/favicon.svg`; the existing header logo is a text
logotype with no image mark, and adding a small mobile-only `<img>` keeps the
desktop logotype 100% untouched.

Add a mobile logo element inside `.header-left` on all three pages (desktop
hides it via the base rule in section 1):

```html
<a href="/" class="mobile-logo" aria-label="FileTube home">
  <img src="/favicon.svg" alt="FileTube" />
</a>
```

Mobile header restructure (inside the media query). The header stacks to two
rows (centered logo, then full-width search); it keeps a fixed height so the
`.app-container` top padding stays deterministic:

```css
header {
  flex-direction: column;
  height: auto;
  min-height: 96px;
  padding: 8px;
  gap: 6px;
}

.app-container {
  padding-top: 96px;
}

.menu-toggle { display: none; }   /* hamburger reconciled — see section 5 */
.logo { display: none; }          /* hide desktop text logotype on mobile */

.mobile-logo { display: block; }
.mobile-logo img {
  display: block;
  height: 28px;
  width: 28px;
  margin: 0 auto;
}

.header-left {
  width: 100%;
  justify-content: center;
  gap: 0;
}

.header-search {
  width: 100%;
  max-width: none;
  margin: 0;
}

.header-right { display: none; }  /* Settings + moon toggle now live in bottom nav */
```

`96px` is a tunable constant (logo 28px + search ~36px + padding/gap) that both
`header min-height` and `.app-container padding-top` must agree on — the QA
checklist calls out verifying no content hides under the header. On
`setup.html` there is no `.header-search`, so the header simply shows the
centered logo row (shorter, still clears fine under the 96px reservation).
`#search-input`/`performSearch()` behavior in `main.js` is unchanged — only the
container's width/position change.

Desktop is untouched: `.logo`, inline `.header-search`, `.header-right`
(Settings + `#theme-toggle-btn`), and `#menu-toggle` all render exactly as
today because every rule above is inside the media query.

#### 5. Playlists sheet

A bottom sheet + backdrop, self-contained in `common.js` so it works
identically on all three pages regardless of per-page load timing.

**Shared markup** (added next to the bottom nav, before the `<script>` tags):

```html
<div class="playlists-sheet-backdrop" id="playlists-backdrop" hidden></div>
<aside class="playlists-sheet" id="playlists-sheet" hidden aria-label="Playlists">
  <div class="playlists-sheet-header">
    <span>Playlists</span>
    <button type="button" class="playlists-sheet-close" id="playlists-close" aria-label="Close">&times;</button>
  </div>
  <div class="playlists-sheet-list" id="playlists-sheet-list"></div>
</aside>
```

**CSS** (inside the media query), token-driven; rows reuse the existing
`.sidebar-item` class so they inherit already-tokenized styling:

```css
.playlists-sheet-backdrop:not([hidden]) {
  display: block;
  position: fixed;
  inset: 0;
  z-index: 1500;
  background: rgba(0, 0, 0, 0.5);
}

.playlists-sheet:not([hidden]) {
  display: block;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1501;
  max-height: 70vh;
  overflow-y: auto;
  background: var(--bg-sidebar);
  border-top: 1px solid var(--border-color);
  border-top-left-radius: var(--radius-lg);
  border-top-right-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding-bottom: env(safe-area-inset-bottom);
  font-family: var(--font-family);
}

.playlists-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  font-weight: bold;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
}

.playlists-sheet-close {
  background: none;
  border: none;
  font-size: 22px;
  line-height: 1;
  color: var(--text-secondary);
  cursor: pointer;
}
```

> **QA fix (shipped):** the sheet/backdrop use `:not([hidden])` (not a bare
> `display: block`) so `[hidden]` keeps them out of the flow until JS opens
> them — the original design's bare `display: block` inside the media query
> overrode `[hidden]` and showed the sheet on every mobile load. The sheet
> re-fetches `/api/config` on each open (no stale latch).

`[hidden]` keeps both elements out of the flow until opened; the base
`.playlists-sheet, .playlists-sheet-backdrop { display: none }` rule
additionally keeps them invisible on desktop, and the media-query
`:not([hidden])` rule only wins on mobile (where `[hidden]` is removed by JS on
open). Net effect: never visible on desktop; toggled by JS on mobile.

**Populate / open / close (in `common.js`):**

- **Open** (Playlists nav button click): remove `hidden` from backdrop + sheet;
  re-`fetch('/api/config')` on each open and render rows. Reuse the exact
  folder-link contract used by the sidebar today:
  `/?root=<encodeURIComponent(path)>`, display label =
  `folderSettings[path].name || basename(path)`. This mirrors the current
  `#sidebar-folders-list` output (all mapped folders, in configured order, no
  Home/Library-Settings entries), scoped to folders only.
- **Hidden-flag parity:** the sheet lists the same folder set the sidebar shows
  today (the sidebar does not filter the `hidden` flag — `hidden` only removes a
  folder from the home grid via the API). The sheet keeps that exact parity, so
  behavior is functionally equivalent to `#sidebar-folders-list`. No new
  filtering is introduced.
- **Close:** clicking the backdrop or the `×` re-adds `hidden` to both.

Rendering helper (self-contained, escapes labels like the existing code):

```js
function renderPlaylistsSheet(folders, folderSettings) {
  const list = document.getElementById('playlists-sheet-list');
  if (!list) return;
  const settings = folderSettings || {};
  if (!folders || folders.length === 0) {
    list.innerHTML = '<div class="sidebar-item">No folders configured.</div>';
    return;
  }
  list.innerHTML = folders.map((f) => {
    const base = f.split(/[\\/]/).pop() || f;
    const label = (settings[f] && settings[f].name) || base;
    return '<a href="/?root=' + encodeURIComponent(f) +
      '" class="sidebar-item"><i class="icon-folder"></i> ' +
      escapeAttr(label) + '</a>';
  }).join('');
}
```

(`escapeAttr` = a small local HTML-escape mirroring the per-page `escapeHtml`.)

**Hamburger reconciliation.** `#menu-toggle` is hidden on mobile (`.menu-toggle
{ display: none }`, section 4). The existing DOMContentLoaded handler in
`common.js` that wires `#menu-toggle` stays but can never fire on mobile (the
button is not visible/tappable), so the full `.sidebar` never opens on mobile.
This leaves **exactly one** mobile path to folders: the bottom nav's Playlists
sheet. Desktop hamburger + sidebar are unchanged.

#### 6. Active state — pure helper

Add a pure, exported helper to `common.js`:

```js
// Pure: which bottom-nav item should be marked active for the current route.
// Home covers "/" and "/index.html" incl. any query (?search=, ?root=,
// ?folder= are all still the home grid). Settings covers "/setup.html".
// watch.html (and anything else) has no active item. Exported for node:test.
function activeNavItem(pathname, search) {
  if (pathname === '/setup.html') return 'settings';
  if (pathname === '/' || pathname === '/index.html') return 'home';
  return null;
}
```

Contract: `(pathname, search) -> 'home' | 'settings' | null`. Playlists and
Dark/Light are momentary actions and never carry a persistent `active` state,
so the helper never returns them. `search` is part of the signature for
clarity/future use but is intentionally not consulted today (per AC, `?root=`
and `?search=` are still Home, not Playlists).

Export via the existing `module.exports` block in `common.js` (add
`activeNavItem`).

Node test cases (`test/unit/active-nav-item.test.js`):

| Input | Expected |
|-------|----------|
| `('/', '')` | `'home'` |
| `('/', '?search=cats')` | `'home'` |
| `('/', '?root=%2Fmedia%2Fmovies')` | `'home'` |
| `('/', '?folder=Movies')` | `'home'` |
| `('/index.html', '')` | `'home'` |
| `('/setup.html', '')` | `'settings'` |
| `('/watch.html', '?v=abc123')` | `null` |
| `('/anything-else', '')` | `null` |

#### 7. Wiring (`common.js`, shared, runs on every page)

All wiring goes in the existing `DOMContentLoaded` handler in `common.js`
(after `initTheme()`), guarded so it never throws if the markup is absent
(defensive: a page that lacks the nav simply skips wiring):

```js
const bottomNav = document.getElementById('bottom-nav');
if (bottomNav) {
  // Active-state highlight
  const key = activeNavItem(window.location.pathname, window.location.search);
  if (key) {
    const item = bottomNav.querySelector('[data-nav="' + key + '"]');
    if (item) item.classList.add('active');
  }

  // Dark/Light item -> toggleTheme(), then sync its own icon/label
  const themeItem = document.getElementById('nav-theme-toggle');
  if (themeItem) {
    updateNavThemeItem();               // initial state from data-mode
    themeItem.addEventListener('click', () => {
      toggleTheme();
      updateNavThemeItem();
    });
  }

  // Playlists item -> open sheet
  const playlistsBtn = document.getElementById('nav-playlists-btn');
  if (playlistsBtn) playlistsBtn.addEventListener('click', openPlaylistsSheet);

  // Close wiring (feature-detected)
  const backdrop = document.getElementById('playlists-backdrop');
  const closeBtn = document.getElementById('playlists-close');
  if (backdrop) backdrop.addEventListener('click', closePlaylistsSheet);
  if (closeBtn) closeBtn.addEventListener('click', closePlaylistsSheet);
}
```

`updateNavThemeItem()` keeps the Dark/Light item's icon/label mirroring the
header `#theme-toggle-btn` behavior. To stay robust it is also called from
`applyTheme()` (the QA pass wired the nav theme item into `applyTheme` so it
syncs whenever mode changes) while still respecting the "no new theme
mechanism" boundary — it only *reads* `data-mode` and updates the nav item's
`<i>` class + label.

```js
function updateNavThemeItem() {
  const item = document.getElementById('nav-theme-toggle');
  if (!item) return;
  const dark = document.documentElement.getAttribute('data-mode') === 'dark';
  const icon = item.querySelector('i');
  const label = item.querySelector('.bottom-nav-label');
  if (icon) icon.className = dark ? 'icon-sun' : 'icon-moon';
  if (label) label.textContent = dark ? 'Light' : 'Dark';
}
```

`openPlaylistsSheet()` fetches `/api/config` on each open and calls
`renderPlaylistsSheet(...)`, then removes `hidden`; `closePlaylistsSheet()`
re-adds `hidden`. Both feature-detect their elements.

#### 8. Test list

- **Automated (`node:test`, `test/unit/active-nav-item.test.js`):** the
  `activeNavItem` cases in the table above. This is the only pure logic in the
  feature.
- **Manual visual checklist (no headless/visual tooling in this repo):**
  - Desktop (>768px) pixel-identical to today on all three pages — header,
    sidebar, main content, hamburger, header-right all unchanged; bottom nav /
    sheet / mobile logo not rendered at all.
  - Bottom nav renders with exactly 4 items and functions on `index.html`,
    `setup.html`, `watch.html` at <=768px.
  - All 8 era x mode combos: nav bar, mobile header, and Playlists sheet read
    correctly (radius, font, colors, borders, shadow) — cycle each via the
    Setup Appearance picker + the Dark/Light nav toggle.
  - iOS notched device (or Safari device sim with `viewport-fit=cover`): bar
    clears the home indicator; last grid row / last setup control / watch
    comment box + delete button are not hidden behind the bar.
  - Active-state across `/`, `/?search=...`, `/?root=...`, `/setup.html`, and a
    `watch.html?v=...` URL (watch shows no false Home/Settings highlight).
  - Playlists sheet shows the correct folder set/names/order matching
    `/api/config`; the old hamburger/full-sidebar path no longer offers a
    competing route to folders on mobile.
  - watch.html: bottom nav does not intercept native video-control taps and
    does not cover the resume/transcode overlays; the delete-confirm modal
    still covers the nav.

#### 9. Ordered task breakdown

1. **Viewport meta** — add `viewport-fit=cover` to the viewport meta on
   `index.html`, `setup.html`, `watch.html` (section 3).
2. **Shared markup** — add the mobile logo (`.mobile-logo`) into `.header-left`,
   the `.bottom-nav` block, and the Playlists sheet + backdrop to all three
   pages (sections 2, 4, 5).
3. **Base hide rule** — add the additive `display: none` block for the new
   elements just above the `@media (max-width: 768px)` query (section 1).
4. **Bottom nav CSS** — add the nav rules inside the media query, incl. the
   `.main-content` bottom clearance (section 2).
5. **Mobile header CSS** — add the header restructure rules inside the media
   query (centered logo, full-width search, hide hamburger/text-logo/
   header-right, `.app-container` padding-top) (section 4).
6. **Playlists sheet CSS** — add the sheet + backdrop rules inside the media
   query (section 5).
7. **`activeNavItem` + export** — add the pure helper and export it from
   `common.js` (section 6).
8. **Wiring** — add the nav/sheet/theme wiring + `updateNavThemeItem`,
   `openPlaylistsSheet`, `closePlaylistsSheet`, `renderPlaylistsSheet` to
   `common.js` (sections 5, 7).
9. **Unit test** — `test/unit/active-nav-item.test.js` (section 8).
10. **Manual QA pass** — work the checklist in section 8 item by item.

### Alternatives considered

- **Reuse the full mobile `.sidebar` for Playlists** (option a in discovery).
  Rejected in discovery and reaffirmed here: it duplicates Home + Library
  Settings links that already have their own bottom-nav entries, contradicting
  the clean 4-item shell. The scoped sheet is simpler and matches the mobile-app
  mental model.
- **Modify `applyTheme()` to also flip the nav item's icon** (instead of a
  separate `updateNavThemeItem()` synced in wiring). This was ultimately
  adopted during QA — `applyTheme()` calls `updateNavThemeItem()` so the nav
  stays in sync whenever mode changes — while keeping the theme functions'
  core mechanism untouched (the nav helper only reads `data-mode`).
- **Keep the header a single row on mobile** (logo left, search right, no
  stacking). Pro: no `.app-container padding-top` change, less fragile. Con:
  does not deliver the "centered logo + prominent search below" layout the
  scope/AC require. Rejected; the two-row stack with a fixed 96px reservation
  is the deliverable.

### Risks and mitigations

- **Risk:** a shell rule leaks outside the media query and regresses desktop.
  **Mitigation:** only the additive `display: none` base rule (new selectors
  only) lives outside the query; everything else is inside it. Explicit
  desktop-unchanged QA item.
- **Risk:** header height (96px) and `.app-container padding-top` drift apart,
  hiding content under the header. **Mitigation:** both constants are called out
  as a matched pair to verify in QA; `setup.html` (no search row) also checked.
  (QA additionally added `safe-area-inset-top` to header padding + app-container
  padding so the header clears the notch under `viewport-fit=cover`.)
- **Risk:** `env(safe-area-inset-bottom)` silently `0` if the meta fix is
  missed. **Mitigation:** the meta change is task #1 and its own AC.
- **Risk:** a single hardcoded color/radius/font looks fine in 2021 dark and
  wrong in 2005/2009/2014. **Mitigation:** every new rule is token-only;
  all-8-combos QA item.
- **Risk:** z-index conflict on watch. **Mitigation:** nav = 900 sits below
  header/modal; watch overlays are local to `.player-container` and physically
  top-of-column, so no conflict — verified in QA. (QA also hid the nav in
  landscape so it never overlaps the immersive player.)

### Performance impact

No expected impact. This is static markup + CSS + a small amount of vanilla JS
(a lazy `/api/config` fetch on Playlists-sheet open, reusing an endpoint
the pages already call). No new dependencies, no build step, no changes to
scanning/transcoding/streaming paths. `docs/RELIABILITY.md` defines no numeric
performance budgets; its error-handling/testing invariants are untouched (this
feature adds only frontend markup/CSS/JS plus one node:test).

## Task breakdown

See "9. Ordered task breakdown" in the Design section above — the 10 ordered
steps were implemented as the task set for this feature.

## Progress log

- 2026-07-04 — Discovery complete (product-manager). Exec plan drafted from
  the bootstrapped feature description in `.state/feature-state.json`,
  grounded directly in `public/index.html`, `public/setup.html`,
  `public/watch.html`, `public/js/main.js`, `public/js/common.js`, and
  `public/css/style.css`. No overlapping active exec plans (active/ was
  empty apart from `.gitkeep`); no tech-debt-tracker items opened or
  closed by this feature; no contradictions with `docs/ARCHITECTURE.md`.
- 2026-07-04 — Design complete (principal-engineer). Technical Design
  appended, grounded in the real code: reuse the existing
  `@media (max-width: 768px)` breakpoint (all shell CSS behind it; one
  additive `display:none` base rule for the new elements as the only
  desktop-side addition, changing no existing rule). Specified the shared
  4-item `.bottom-nav` markup + token-driven CSS at **z-index 900** (below
  header 1000 and modal 2000; watch overlays are local to
  `.player-container` so no conflict), `.main-content` bottom clearance
  `calc(72px + env(safe-area-inset-bottom))`, the exact
  `viewport-fit=cover` meta string for all three pages, the mobile header
  restructure (centered `/favicon.svg` logo + full-width search, hidden
  hamburger/text-logo/header-right), a self-contained Playlists bottom
  sheet in `common.js` (lazy `/api/config`, `/?root=<path>` links, sidebar
  parity) at z-index 1500/1501, a pure exported `activeNavItem(pathname,
  search)` helper with node:test cases, and the shared feature-detected
  wiring in `common.js`. artifacts.design set to the exec plan path.
- 2026-07-04 — Two-reviewer QA pass. QA agent APPROVE-WITH-NITS (caught
  landscape nav/player overlap). Code-review workflow caught 2 show-stoppers
  QA missed: (1) Playlists sheet+backdrop shown on every mobile load
  (`display:block` overrode `[hidden]`) and undismissable; (2) missing
  `safe-area-inset-top` under `viewport-fit=cover` (header under the notch).
  All fixed: sheet uses `:not([hidden])`; header padding-top/min-height +
  app-container padding-top get `env(safe-area-inset-top)`; nav hidden in
  landscape (no player overlap, matches YouTube immersive); Playlists
  re-fetches each open (no stale latch); nav theme item synced via
  `applyTheme`. 86 tests green.
- 2026-07-04 — **Shipped v1.5.0.** All acceptance criteria met; two-reviewer
  QA passed; 86 tests green. Feature complete and archived to
  `docs/exec-plans/completed/`.
