# Exec plan: cold-launch crispness sweep

Status: ACTIVE
Branch: `feat/cold-launch-crispness`
Target release: v1.157.0
Owner: main session (lean mode)
Origin: Dean's #2 ask - eliminate flash-of-unstyled/unloaded content + layout
SHIFT on cold PWA launch across the shell. Scope confirmed by a codebase recon
(most of the shell is ALREADY crisp - grid, sidebar, You avatar, bell, menus,
theme/era, router all covered). Dean's calls: **full sweep** (P1+P2+P3) and
**inline-SVG the masked icons** (they stop following the icon-set picker, like
the bottom nav already does).

## The fixes (each reuses an EXISTING primitive; no new shimmer machinery)

### P1 - the worst offender: Continue rows shove the grid down (default cold launch)
`main.js:~3001-3055`. `videosRowHost`/`listeningRowHost`/`booksRowHost` are
inserted EMPTY (zero height) above `#video-grid`, then filled after async
fetches -> the whole grid jumps down. `homeRowEnabled` defaults ON; classic is
the default layout, so any user WITH in-progress items (Dean) eats this every
launch. Fix: reserve each row with a skeleton BEFORE its fetch, seeded only when
that row had items last launch (a per-row localStorage last-known flag, the
avatar/bell pattern) so empty-continue users get no reverse-collapse. Reuse the
`buildFeedSkeleton` `.books-home-row` row shimmer (`main.js:~310-334`).

### P2a - iOS mask-decode pop-in: inline-SVG the static masked icons
Static `<i class="icon-*">` render via `-webkit-mask-image` (show nothing until
iOS decodes -> pop in). The nav was already converted (chromeIconMarkup /
CHROME_ICON_SVG, common.js:~29-81); these were left behind:
`index.html:92` icon-menu (hamburger), `:112/115/123` icon-home/cog/star
(desktop sidebar). Converted these to inline SVG reusing the chrome-icon
primitive (added menu/star glyphs to CHROME_ICON_SVG). Trade-off (Dean-
approved): they stop following the icon-set.
SHIPPED SCOPE (Dean's ask was the hamburger + sidebar): the home-toolbar
`icon-shuffle/refresh/list` (`index.html:186-191`) were deliberately LEFT as
masks -- converting them cascaded into main.js's rescanBtn re-renders + several
tests, out of scope for this wave.

### P2b - Subscriptions FOUC-guard parity
`subscriptions.html` FOUC guard omits `ft-custom-logo` + `ft-hide-stars` (every
other shell has them). A direct/cold load of /subscriptions flashes the wordmark
for a custom-logo user / star markup for a hide-stars user. Add the two
localStorage->classList lines to match index/stats/setup.

### P3 - the #141 in-app-nav surfaces (Dean: sweep them too)
- **DONE - setup folder list** (`setup.js` loadConfig): buildSetupFolderSkeleton
  seeds shape-matched `.folder-item-row` shimmer before /api/config; cleared on
  success (renderFolders) + error.
- **DONE - podcast show view** (`podcasts.js` openShow + the ?play= deep link;
  ?show= routes through openShow): buildPodcastShowSkeleton (art header + episode
  rows) seeded before the episodes fetch; the grid already had its own.
- **DEFERRED (disclosed) - reader pane** (`read.js`): the reader ALREADY shows an
  "Opening book..." status during load (not a blank flash), and a shimmer must
  match the 3 reader themes AND coexist with epub.js's finicky renderTo/iframe
  lifecycle (this file is full of epub.js-quirk hotfix comments). Low marginal
  value (status already mitigates) vs real risk to a high-value feature -> a
  careful standalone follow-up if Dean finds the reflow jarring on device, not a
  rushed tail-end change. Tech-debt #141.
- custom-logo width reflow: NOT done (custom-logo only, low priority) - #141.

## Reusable primitives (reuse, do NOT invent)
- CSS `.skeleton-shimmer`/`.skeleton-line`/`.skel-*` (style.css:~1799-1931),
  `img.art-shimmer` (~1848). Reduced-motion carve-out present.
- Builders: buildSkeletonGrid/buildSidebarSkeletonRows/buildFeedSkeleton/
  buildAvatarBarSkeleton (main.js), buildStatsSkeleton* (stats.js),
  buildHistorySkeletonRows (history.js), buildRelatedSkeletonCards (watch.js),
  buildSkeletonRows (subscriptions client). chromeIconMarkup/chromeIconEl/
  CHROME_ICON_SVG (common.js) for the SVG icons.

## Task commits (each green before the next; ONE full gate over the diff)
- T1 (P1): continue-rows skeleton + per-row last-known flag.
- T2 (P2a): inline-SVG the 7 masked shell icons.
- T3 (P2b): subscriptions FOUC-guard stamps.
- T4 (P3): read pane + setup lists + podcast pin skeletons (+ logo width call).

## Predictions (machine-derived; re-verify at every commit)
- Unit baseline: **5450/5450**. Net positive (new skeleton/icon/FOUC tests).
- Masked `class="icon-(menu|home|cog|star)"` in index.html + every sidebar
  shell: **-> 0** (converted to inline SVG). The home-toolbar
  shuffle/refresh/list masks are deliberately OUT of scope (kept as masks).
- `ft-custom-logo` + `ft-hide-stars` in subscriptions.html FOUC guard: **0 -> 2**.
- Token census stays **0**; lint + ledger green.

## Gate
FULL gate (breadth across the shell; no data-loss, but many first-paint
surfaces). Adversarial attack surfaces:
1. P1 reverse-CLS: an empty-continue user must NOT get a skeleton that then
   collapses (the last-known flag must gate it); a returning-with-items user
   must get reserved space that content replaces IN PLACE.
2. The inline-SVG icons must render the CORRECT glyph (menu/home/cog/star/etc.)
   and keep their aria-labels/click targets; nothing keys off the old `<i
   class="icon-*">` (CSS/JS) that breaks when it becomes `<svg>`.
3. P2b stamps must match the OTHER shells' exact class names (a typo'd class is
   a silent no-op).
4. Skeletons must CLEAR on load AND on error/empty (the reveal-once TWO-axis
   class), never left shimmering.

## Device probes (Dean, cold PWA launch)
- Home: the grid does NOT jump down as the Continue rows arrive.
- iOS: the hamburger + sidebar + toolbar icons are there instantly (no pop-in).
- Direct-load /subscriptions with a custom logo / hidden stars: no wordmark/star
  flash.
- Read a book / open Setup / open a pinned podcast: no empty-then-fill flash.
