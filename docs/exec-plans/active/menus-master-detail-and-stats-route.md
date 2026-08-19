# Exec plan: mini-player-safe Stats + master-detail menus

Status: ACTIVE (started 2026-08-19)
Owner: main session (lean mode)
Design sign-off: Dean, 2026-08-19 (prototype iterated to APPROVE - "Love it")
Prototype (design source of truth): the master-detail artifact
(phone + desktop, tight palette, grouped rows, per-section icon tiles,
era-reactive Appearance tile).

## Why (Dean's two asks)

1. **The left-most utility pages kill playback.** Selecting **Stats** while
   something is playing stops it. Root cause is NOT a teardown bug: `/stats.html`
   is the one nav destination that `deriveRouteView` does not recognize, so the
   browser does a **full page reload** and destroys the persistent player host.
   Every other rail/bottom-nav link is already an SPA route and keeps the docked
   mini-player alive.
2. **The collapsible-section menus feel clunky.** Settings / Stats / Subscriptions
   share one native `<details>` accordion (`wireCollapsibleSections`). Expanding a
   section reflows the page and you lose your place. Dean wants an **iOS-Settings
   master-detail** feel, uniform across all three pages, with grouped rows and
   per-section icon tiles.

## Machine-derived numbers (predictions the tools re-verify each commit)

- **Offending full-reload nav destinations: exactly 1** - `/stats.html`.
  Derivation: every `href` in the shell chrome (`public/index.html`,
  `public/stats.html`, `public/setup.html`, `lib/ytdlp/views/subscriptions.html`)
  and every JS-injected `sidebar-item`/`bottom-nav`/account-menu href, classified
  against `deriveRouteView`. All page-nav hrefs resolve to a route EXCEPT
  `/stats.html`; the remaining non-route hrefs are assets/downloads
  (`/manifest.webmanifest`, `/icons/*`, `/fonts/*`, `/css/*`, `/favicon.*`,
  `/api/duplicates.csv`, `/api/admin/backup`), correctly not routes.
- **Link sites fixed by the one `deriveRouteView` line: 4** occurrences of
  `href="/stats.html"` across the shells - all fixed centrally, none per-link.
- **Sections per page (master-detail row counts):** Settings **12**, Stats **11**,
  Subscriptions **5** (3 static + 2 JS-appended: download-history,
  download-failures). Re-derive with:
  `grep -c 'data-collapse-key' public/setup.html public/stats.html lib/ytdlp/views/subscriptions.html`
  (+ the 2 dynamic subs sections built in `lib/ytdlp/client/subscriptions.js`).
- **Collapsible call sites replaced: 3** - `setup.js` (`wireCollapsibleSections('setup', …)`),
  `stats.js` (`'stats'`), `lib/ytdlp/client/subscriptions.js` (`'subscriptions'`),
  plus the 2 dynamic appenders in subscriptions.js.

## Release sequencing (two releases on this wave)

Item 1 is small, independent, and immediately device-testable; Item 2 is a large
UI rework that will want on-device iteration. Ship them separately so Item 1's win
is not held hostage to Item 2's polish.

- **v1.151.0 - Stats becomes a mini-player-safe SPA route** (Item 1). Branch
  `feat/stats-spa-route`. Slim-to-full gate (core navigation; not data-loss).
- **v1.152.0 - master-detail menus** (Item 2). New branch. **Full gate**
  (large shared-component rework touching 3 pages + capability-gated admin
  sections; adversarial seat briefed on gating leaks and dynamic-section wiring).

The exec plan is committed on the v1.151 branch and stays ACTIVE across both
releases; it moves to `completed/` when Item 2 ships.

---

## Item 1 - Stats as an SPA route (v1.151.0)

### The contract (verified against source)
- Router allowlist: `deriveRouteView(pathname)` (`public/js/common.js`) - add
  `if (pathname === '/stats.html') return 'stats';`. **Nav highlight (gate
  round 1 finding):** `activeNavItem` did NOT map stats - once deriveRouteView
  returns non-null, bootRouter stops no-op'ing and runs the highlight pass,
  which STRIPS stats.html's server-rendered `active` class and lights nothing.
  So `activeNavItem` AND `SIDEBAR_HREF_BY_NAV_KEY` also gain a `stats ->
  /stats.html` entry, and a test binds every static sidebar link to light
  itself.
- Lazy script map: `VIEW_SCRIPT_SRC` (`common.js`) - add `stats: '/js/stats.js'`
  so the router loads it on first navigation (books/music/podcasts/history pattern).
- View contract: `window.FileTube.registerView('stats', { init, destroy })`.
  Router calls `incoming.init(root)` after the swap (`common.js:7645`, `:8076`)
  and `outgoing.destroy()` before replacing `#view-root` (`:7629` et al).
- `stats.html` already ships `<div id="view-root" data-view="stats">` - so
  `extractViewFragment` can pull it unchanged.

### stats.js refactor (mirror books.js)
- Add a module-level `controller`. `init(root)` opens a fresh `AbortController`,
  passes `{ signal }` to both `fetch('/api/stats')` and `fetch('/api/duplicates')`
  and to the `show-shortcuts-btn` listener, and ignores `AbortError` in the
  `.catch`es (a navigate-away must not render into a replaced tree).
- `destroy()` aborts the controller.
- Register `{ init, destroy }` at parse time and **DROP** the old
  `DOMContentLoaded -> init()` self-boot. Now that `/stats.html` is a recognized
  route, `bootRouter` runs `init()` for the initial view on a standalone
  full-page load too - so keeping the self-boot would DOUBLE-init. One init
  path only: bootRouter (standalone) or swapToView (in-app). (Corrected after
  gate round 1 - the original plan text here wrongly said to keep the boot.)

### Player continuity (the actual fix, traced)
- watch/read/music/podcasts -> stats: `shouldDockOnTransition` true -> `dock()`
  BEFORE the swap -> the host reparents into the shell's `#player-dock` (outside
  `#view-root`) and keeps playing as the mini-player.
- stats -> home: stays docked (keeps playing). stats -> watch: re-adopts to full.

### Tests (Item 1)
- `router-helpers.test.js`: `deriveRouteView('/stats.html') === 'stats'`;
  `VIEW_SCRIPT_SRC.stats === '/js/stats.js'`.
- New stats-view-lifecycle test: `registerView` called with `'stats'`;
  `destroy()` aborts an in-flight fetch (bind the REAL effect - mutate out the
  `signal`/abort and watch it red; a late render into a detached root is the
  failure mode).
- Nav-link regression net: assert every `sidebar-item`/`bottom-nav` href in the
  shell resolves via `deriveRouteView` to a non-null route (excluding the
  asset/download allowlist) - so a future full-reload nav link fails here.
- Full `npm test` (unit + integration) after the router change - the pre-commit
  UNIT hook hides a red integration suite (v1.79 class).

### Risks / attack surfaces (brief for the gate)
- Double-init or missed-init across standalone vs lazy load.
- In-flight fetch resolving after `destroy()` (stale render / null container).
- The player NOT docking (regression) on watch->stats - assert the transition.
- `stats.html` standalone still works (its own `#player-dock` + scripts).

---

## Item 2 - master-detail menus (v1.152.0)

### Design (locked with Dean via the prototype)
- **Phone:** each page is a grouped menu (iOS inset lists under quiet group
  headers). Tap a row -> the section slides in full-screen with a centered
  icon hero and a "‹ back" that returns to the menu. No accordion reflow.
- **Desktop:** a grouped **category rail** + a **detail pane**, living inside
  `#view-root`/`.main-content`, to the RIGHT of the existing folder sidebar
  (two rails, one screen - Dean approved).
- **Icon tiles:** every section carries a material-specific glyph on a tinted
  rounded square. **Tight palette:** FileTube red + two neutrals (graphite,
  steel), assigned per GROUP (colour encodes the group, shape encodes the row).
  Toggle "on" keeps the single green (functional).
- **Era-reactive Appearance tile:** the Appearance section's badge tracks the
  active era skin (tint + corner radius shift 2008 -> 2021). Wire it to the
  REAL selected era, not a local copy.
- **Groups:** Settings -> (Appearance) / Library / System / Account;
  Stats -> Overview / Breakdowns / System; Subscriptions -> Following / Add / Activity.

### Build architecture (concrete, from recon 2026-08-19)
- **Progressive enhancement, minimal markup churn.** A new
  `wireMasterDetail(pageKey, root, signal)` consumes the EXISTING
  `details[data-collapse-key]` sections inside a one-line wrapper
  `<div class="md-root" data-md-page="…">…sections…</div>` added to each shell.
  Per-section additive attrs only: `data-md-icon="video"` and
  `data-md-group="Library"`. Replaces `wireCollapsibleSections` at all 3 call
  sites; the old native-`<details>` collapse + its `ft-collapse:` persistence
  retire.
- **Runtime transform:** the component moves the sections into an injected
  `.md-panes`, injects `.md-nav` (grouped rows: inline-SVG tile + summary text
  + optional Admin chip + chevron) and a phone-only `.md-detail-head`
  (back + active title). Native `<summary>` hidden in md-mode (the row is the
  heading); `<details>` forced open; visibility driven by `.md-active`.
- **Icons = inline SVG** (the approved-prototype set embedded in the component),
  NOT the `.icon-*` mask classes: full control over the material-specific
  glyphs, no per-icon-set (default/rounded/filled) asset duplication, and it
  dodges the known iOS mask decode-lag (v1.91). The rest of the app keeps its
  mask chrome. Tight palette per GROUP: red `#cc0000` / graphite / steel
  (tokenised or `token-exempt`-justified). CSS block lives in `style.css`
  (NOT page-local `<head>` - SPA swaps only `#view-root`, v1.38).
- **MutationObserver keeps the menu in sync (correctness-critical).** Admin
  sections (Users/Backup/Downloads) are revealed ASYNCHRONOUSLY - setup.js sets
  `box.hidden = false` AFTER a `/api/me` capability fetch, well after init - and
  the subs history/failures sections are appended dynamically. The component
  observes `.md-root` (childList subtree + `attributes:['hidden']`) and rebuilds
  the nav rows from CURRENTLY-VISIBLE sections; disconnect on `signal` abort.
  Because the menu is built only from non-hidden sections, a restricted user
  never sees an admin section's title/row (the v1.80 leak class - the
  adversarial seat gets briefed to enumerate an admin row as a non-admin).
- **Era-reactive Appearance tile:** special-cased inline SVG (play badge) whose
  tint + corner-radius track the REAL selected era pref (not a local copy);
  refresh the tile when the era changes.
- **Build order:** Settings (pilot, most sections + admin gating) -> Stats
  (read-only) -> Subscriptions (dynamic sections last). Each page green before
  the next.
- **Capability gating preserved:** admin-only sections (Users, Backup, Downloads)
  stay hidden for non-admins - gating is orthogonal to the menu structure and
  must not leak section titles/counts into the menu for a restricted user
  (the v1.80 list-surface leak class - adversarial seat: try to enumerate an
  admin section as a restricted user).
- **Deep-link / state:** default phone to the menu on load; remember last-open
  section per page within a visit is a nice-to-have. Browser-back integrating
  with the detail is DEFERRED (the SPA-pushState bug-magnet, D3 class) - the
  in-page back button returns to the menu; document it. Revisit on Dean's device
  pass if browser-back feels wrong.

### Tests (Item 2) - to be expanded when Item 2 starts
- Component: menu renders all sections per page; tap opens the right detail;
  back returns; admin sections absent for a restricted user (bind the REAL
  filter - populate an admin section then drive the restricted path red).
- Era-reactive tile reflects the selected era (bind config -> effect).
- Dynamic subs sections (history/failures) are reachable through the new
  component after they're appended.
- Migration guard: the three pages no longer emit `data-collapse-key`; the old
  persistence key is retired cleanly.
- Full `npm test` dual-Node before release.

### Open questions to settle when Item 2 starts (not blocking v1.151)
- Exact icon source per section (icon-font vs inline SVG) - match the app.
- Whether Subscriptions' short list keeps the master-detail or degrades to a
  single scroll (Dean chose uniform; confirm it still feels right on-device).
- Desktop: does the category rail collapse under the folder sidebar at narrow
  desktop widths? Measure, don't guess (v1 layout lesson).

### Item 2 status (2026-08-19): IMPLEMENTED, in gate
Built in 6 commits (foundation -> Settings -> Stats -> Subscriptions -> cleanup).
All 3 pages use wireMasterDetail; retired wireCollapsibleSections removed.
Tests: master-detail.test.js (component) + setup/stats/subscriptions-master-detail
binders (real markup, incl. admin reveal + dynamic subs cards). Full suite
7256/7256, census 0. NO browser render was possible in the build env (no
chromium/puppeteer), so the VISUAL layout is Dean's device pass; structure +
behaviour + gating are gate-verified. Device-pass visual items to probe:
- desktop two-rail (folder sidebar + category rail + pane) not cramped;
- each detail section keeps its `.setup-box` card chrome inside the pane (safe
  default; a cleaner "content directly in pane" look is a quick CSS hotfix if
  Dean prefers the prototype's exact framing);
- phone menu->detail push-in + back; the era Appearance tile shifting with the
  skin; Subscriptions' extra tap (uniform master-detail, Dean's call).

## Definition of done
- v1.151: Stats keeps the mini-player alive on navigation (Dean device pass);
  dual-Node green; gate APPROVE x required seats; nav-link regression net in place.
- v1.152: all three pages ship the master-detail feel of the approved prototype;
  admin gating proven non-leaky; dual-Node green; full gate APPROVE; Dean device pass.
