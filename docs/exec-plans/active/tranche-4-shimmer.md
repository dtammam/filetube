# Shimmer sweep - Tranche 4 (v1.102.0)

Status: ACTIVE. Release branch `release/v1.102.0`. Grounded against the tree at
branch-point off `main` @ `d411679` (v1.101.0 shipped). Feeds the same
"every loading moment is beautiful" sweep as t1-t3; audit source is
`docs/exec-plans/active/fouc-shimmer-audit.md`.

Dean's intake rulings (2026-08-11):
1. Scope = **everything**, incl. the structural iOS mask-glyph swap. One release.
2. Setup toggles = **`data-loading` reveal-once barrier**, NOT align-HTML-defaults.
3. Art-decode = **whole family, uniform** across all surfaces.

## The contract this wave must honour

The MANDATORY `docs/CONTRIBUTING.md` "Every fetch-then-render surface reveals
ONCE" contract (codified v1.99). Each surface below either (a) seeds a
shape-matched skeleton BEFORE its fetch and swaps zero-shift, or (b) reserves +
shimmers and reveals ONCE the LAST async input settles. No blank-then-pop, no
bare spinner, no reflow-on-land. Reuse the existing toolkit (`.skeleton-shimmer`,
`.skeleton-row`, `buildSkeletonGrid`, the `data-loading` barrier) - do not
rebuild it.

## Sub-tasks (each its own green task commit)

### T4-A - Stats dashboard skeleton (audit row 38)
- Files: `public/js/stats.js`, `public/stats.html` (shell already ships the
  empty containers), `public/css/style.css` (skeleton tile/row shapes if needed).
- Now: `init()` fires `/api/stats` + `/api/duplicates`; each `render*` does
  `clearChildren(root)` then fills. Empty containers stack and reflow twice.
- Fix: a `seedStatsSkeleton()` called at the TOP of `init()`, BEFORE both
  fetches, that seeds shimmer tiles into the 4 tile grids
  (`stats-glance-grid`, `stats-by-type`, `stats-records-grid`,
  `stats-books-grid`) and shimmer rows into the 7 list containers
  (`stats-folder-list`, `stats-channel-list`, `stats-most-watched-list`,
  `stats-books-folder-list`, `stats-duplicates-list`, `stats-inventory-list`,
  `stats-about`). The existing `clearChildren` in every `render*` swaps them
  out. Tile skeleton reuses the real `.stat-tile` box; row skeleton reuses the
  `.about-row`/breakdown-row box (measure, don't guess).
- PREDICTION (machine-derived): exactly **11** render-target containers are
  seeded. `grep -c 'getElementById(.stats-' stats.js` render targets == 11.
- Reveal-once: fixed N skeleton rows per list; real count differs (inherent to
  unknown-length lists, consistent with t1). Error path already replaces.

### T4-B - Feed-mode home skeleton (audit row 12)
- Files: `public/js/main.js` (`renderHomeFeed`), `public/css/style.css`.
- Now: `renderHomeFeed(host, signal)` awaits `/api/home` then sets
  `host.innerHTML`. `#home-feed-host` is blank until resolve; the `#video-grid`
  skeleton is `display:none` in feed mode (`style.css:7737`).
- Fix: seed a feed-row skeleton into `host` BEFORE the await, shaped like
  `buildFeedRowHtml` output. Empty/error/success paths all overwrite
  `host.innerHTML`, so the swap is clean.
- Reveal-once: skeleton -> real rows, one swap.

### T4-C - Setup automation toggles reveal-once barrier (audit row 39)
- Files: `public/js/setup.js` (`loadAutomationSettings`), `public/setup.html`,
  `public/css/style.css`.
- Now: default-ON toggles (`relocate-hydrated-check`, `notifications-enabled-check`)
  and `prune-missing-check` paint their static HTML default then FLIP after
  `/api/settings`. Guaranteed visible flash.
- Fix: mark the automation card container `data-loading` in the shell; CSS
  reserves + shimmers the toggle rows; `loadAutomationSettings` clears the
  attribute in a `finally` (reveal on BOTH success AND error - controls must be
  usable even if the fetch fails).
- REVEAL-ONCE-NEEDS-ALL-INPUTS GUARD (v1.96 lesson): the barrier container must
  hold ONLY controls that `loadAutomationSettings` populates. Any control in the
  same card fed by a DIFFERENT fetch (`loadConfig`) would reveal early ->
  partial-render bug. VERIFY the card membership at implementation; scope the
  `data-loading` element to exactly the `/api/settings`-fed toggle rows.

### T4-D - Sidebar folders + pinned playlists skeleton (audit row 4)
- Files: `public/js/main.js` (`renderSidebarFolders`), `public/js/common.js`
  (`renderPinnedSidebar`), `public/css/style.css` (`.skeleton-row` already
  exists, currently unused - the audit's ready-made asset).
- Now: left rail builds after `/api/config` (folders) and `fetchAllPins`
  (pins); both blank-then-fill.
- Fix: seed `.skeleton-row` rows into the folder list + pinned list BEFORE their
  fetches; the existing renders clear+fill.
- Note: `renderPinnedSidebar` has an OPTIMISTIC cache paint
  (`common.js:3109-3114`) - the skeleton only shows on a COLD (no-cache) load;
  the cache paint already covers the warm path. Seed only when no cache.

### T4-E - Art-decode shimmer family (audit row 8, whole family)
- Files: `public/js/music.js`, `public/js/podcasts.js`, `public/js/books.js`,
  `public/js/history.js`, `public/js/main.js` (modern avatar), `public/css/style.css`.
- Now: reserved image boxes (no reflow) but each `<img>` pops flat-tint ->
  decoded picture. 9 img sites across 5 surfaces:
  `music-album-art`, `music-song-thumb`, `music-drill-art`, `music-sticky-thumb`,
  `podcast-card-art`, `podcast-show-art`, `book-cover-img`, `history-thumb-img`,
  modern-avatar `<img>`.
- Fix: ONE shared idiom. A `.art-shimmer` class on the `<img>` (same gradient +
  `@keyframes skeleton-sweep` as `.skeleton-shimmer`, `prefers-reduced-motion`
  honoured) shows the shimmer THROUGH the not-yet-decoded (transparent) image;
  a shared helper wires `load`/`error` to remove the class, and handles the
  CACHED case (`img.complete && img.naturalWidth` -> remove immediately, else it
  shimmers forever). Helper lives in `common.js` (`FileTube.shimmerArt(root)`),
  called after each surface renders; string-built imgs carry a marker
  (`data-art-shimmer`) the helper queries.
- PREDICTION (machine-derived): **9** img sites gain the marker;
  `grep -rc 'data-art-shimmer\|art-shimmer' public/js` accounts for all 9.
- CACHED-IMAGE EDGE is the named attack surface: a `complete` image that fires
  no `load` must still clear (else permanent shimmer under a visible picture).

### T4-F - Row action glyphs: mask -> inline SVG (audit rows 21, 25) [STRUCTURAL]
- Files: `public/js/common.js` (`CHROME_ICON_SVG`), `public/js/music.js`,
  `public/js/podcasts.js`, `test/unit/chrome-icons.test.js`.
- Now: row action glyphs are `<i class="icon-X">` CSS-mask glyphs; on iOS the
  mask decode-lags -> pop-in (the v1.87 class). Music row: `icon-queue`,
  `icon-download`, `icon-heart`. Podcast row: `icon-heart`, `icon-queue`,
  `icon-download`, `icon-delete`.
- Fix: extend `CHROME_ICON_SVG` with the missing glyphs, then swap the row
  glyphs to inline SVG (the v1.87/v1.74 pattern that reveals instantly):
  - Music (string HTML): `chromeIconMarkup('queue'|'download'|'heart')`.
  - Podcasts (DOM-built): `chromeIconEl('heart'|'queue'|'download'|'delete')`.
- NEW `CHROME_ICON_SVG` entries needed: **queue, heart, delete** (`download`
  already present). Path data (from `public/assets/icons/*.svg`):
  - queue: vb `0 0 24 24`, d `M3 6h13v2H3V6zm0 4h13v2H3v-2zm0 4h9v2H3v-2zm14-1v6l5-3-5-3z`
  - heart: vb `0 -960 960 960`, d `m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 24.5t81 66.5q34-42 81-66.5t99-24.5q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q744-381 678-315T538-172l-58 52Z`
  - delete: vb `0 -960 960 960`, d `M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z`
- CSS PARITY: the `.chrome-icon { fill: currentColor }` tint must match the old
  mask `background-color` tint on `.music-like-btn`/`.podcast-*-btn`; the SVG
  box size must match the old mask box (16-18px). Verify each button renders
  identical size/colour - this is a NAMED attack surface.
- `chrome-icons.test.js` source-locks `chromeIconMarkup`; extend it to cover the
  3 new glyphs (deterministic reconstruction).

## Named attack surfaces for the adversarial seat

1. **T4-E cached image** - a warm-cache `<img>` fires no `load`; assert the
   shimmer still clears (permanent-shimmer-under-picture is the failure).
2. **T4-F mask->SVG parity** - the swapped row glyphs must render the SAME
   visible size + colour as the masks (light AND dark), across the era skins;
   a wrong `fill`/viewBox = an invisible or oversized glyph.
3. **T4-C early reveal** - if any non-`/api/settings` control sits inside the
   `data-loading` barrier it reveals with stale content (v1.96 partial-render).
4. **T4-A/B/D reveal-once binding** - each skeleton test must BIND the reveal
   (delete the seed -> test goes red), not merely assert the seed string is
   present (the recurring "presence not binding" scar).
5. **Census / design-token ledger** - `npm run lint:css` + `npm run ledger:check`
   must stay green through the new skeleton CSS and the SVG swap (no raw colour
   literals; `runtime palette value` comments where a JS colour is unavoidable).
6. **Zero-shift** - every reveal must not shift layout beyond the inherent
   unknown-list-length case; measure the real box for each skeleton.

## Test strategy

- Per sub-task: a behavioural jsdom test that BINDS the reveal (seed present
  pre-fetch; real content post-resolve; seed gone). Bind, don't assert-presence.
- T4-F: extend `chrome-icons.test.js` for the 3 new glyphs; a music/podcasts row
  test asserting inline `<svg class="chrome-icon">` (no `<i class="icon-*">`) in
  the row action buttons.
- Full `npm test` after any setup/settings-adjacent change (the pre-commit hook
  is UNIT-ONLY - the v1.79 scar).
- Dual-Node (v22.23.1 + v24.14.0), sequential, reviewers idle, counts verbatim.

## Predictions (re-verify at every commit)
- T4-A: 11 stats render-target containers seeded.
- T4-E: 9 art img sites marked.
- T4-F: 3 new `CHROME_ICON_SVG` entries (queue, heart, delete); 0 `icon-queue`/
  `icon-heart`/`icon-download`/`icon-delete` `<i>` tags remain in the music
  song row + podcast episode row action buttons.
