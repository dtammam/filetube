> ARCHIVED (docs reset 2026-08-15): this AUDIT was the INPUT to the FOUC/shimmer
> sweep that SHIPPED across v1.98-v1.102 (see ROADMAP.md). Its per-surface
> checklist is historical; the deliberately-unswept residuals are tracked in
> docs/exec-plans/tech-debt-tracker.md (#141) and the memory index.

# FOUC / shimmer audit - the "make every loading moment beautiful" sweep

Status: AUDIT ONLY (read-only). This document is the input to a later
implementation plan; it changes no source.

Date: 2026-08-11. Grounded against the tree at `dc59511` (v1.95.0 shipped).

## What this is and why

FileTube already owns a shimmer/reveal-once toolkit and it looks great where it
runs. The goal of the sweep this doc feeds is to make that the RULE, not the
exception: **every surface that does processing or loading should present a
reserved-space skeleton-shimmer that reveals ONCE, the way a modern React app
does - never blank-then-pop, never a bare spinner, never a layout that reflows
as data lands.** Dean's framing: "shimmer is beautiful." So in this audit a
visible loading/processing moment with no shimmer is ITSELF the defect to fix,
even where the current flash is brief.

### The toolkit that already exists (reuse it, don't rebuild it)

- `.skeleton-shimmer` + `@keyframes skeleton-sweep` - the CSS-only shimmering
  placeholder, `prefers-reduced-motion` honored. `public/css/style.css:1732`,
  `:1752`. Compound size classes (`.skel-title`, `.skel-w60/120/140/200`,
  `.skel-line`) at `public/css/style.css:9257-9319`.
- `buildSkeletonGrid(n)` - `.video-card`-shaped shimmer cards, box-model matched
  so the swap to real cards is zero-shift. `public/js/main.js:76`, seeded at
  `public/js/main.js:1111`.
- `.skeleton-card` / `.skeleton-line` / `.skeleton-row` CSS
  (`public/css/style.css:1756-1808`). NB: `buildSkeletonRows`/`subscriptions.js`
  are referenced in comments (`public/js/main.js`, `public/css/style.css:1729`)
  but no `subscriptions.js` file exists in this tree - the `.skeleton-row` CSS
  is effectively unused today and is a ready-made asset for the list surfaces
  below.
- The `data-loading` attribute barrier (v1.96) - reserve the space, shimmer the
  whole set, drop the attribute ONCE the complete set is settled.
  `public/watch.html:214`, revealed by `revealActionBar()` /
  `maybeRevealActionBar()` at `public/js/watch.js:733`, `:1256`. CSS at
  `public/css/style.css:10886`.
- Synchronous seed-paint (v1.52 instant watch) - paint from a click-seed before
  the fetch, hydrate after. `paintMetadata()` `public/js/watch.js:1306`.

### Repo constraints that shape any fix

- **The SPA router swaps only `#view-root`.** Server-rendered shells
  (`index.html`, `watch.html`, `music.html`, ...) are fetched, their `#view-root`
  extracted and swapped in (`public/js/common.js:7217`, `:7523`). Page-local
  `<head>` styles are lost on in-app nav - **all skeleton/shimmer styling must
  live in `style.css`**, never in a shell's `<head>`.
- **iOS CSS-mask decode-lag causes pop-in** (v1.87) - inline `<svg>` reveals
  instantly, a CSS `mask-image` glyph blanks until its mask decodes. Any
  post-fetch injected control built from `.icon-*` mask glyphs pops in on iOS.
- **Measure containers, don't guess CSS-var heights** (lesson #7) - reserved-
  space skeletons must match the REAL box model (the `buildSkeletonGrid`
  discipline), or the reveal itself shifts.
- Images only avoid REFLOW when their box reserves space (`aspect-ratio` or fixed
  w/h). Even reserved, an image still POPS from a flat tint to the decoded
  picture - a shimmer over the reserved box removes that too.

---

## Master table

Risk = user-visible impact of the current flash/pop/reflow. Fix = quick win
(drop in the existing shimmer/seed toolkit) vs structural (needs new
reserved-space plumbing or a deeper reveal-once barrier).

| # | Surface | Renders after fetch? | Current coverage | Flash risk | Fix | Anchors |
|---|---------|----------------------|------------------|------------|-----|---------|
| 1 | Theme / era / icons / logo / stars pre-paint | no (localStorage, pre-paint) | inline `<head>` FOUC guard | none | done | `index.html:42-88` (mirrored in every shell) |
| 2 | Web font (Roboto) | yes (font file) | `font-display:swap` + `<link rel=preload>` | low | none/accept | `style.css:37-42`, `index.html:39` |
| 3 | Header-right cluster (account menu + bell + settings/theme) | YES - JS-injected after `/api/auth/me` and `/api/notifications/badge` | none; header-right ships EMPTY | med-high (every page) | structural (reserve slot + skeleton avatar) | `index.html:103-104`; `injectAccountMenu` `common.js:5591`; `injectNotificationBellIfEnabled` `common.js:3294` |
| 4 | Left sidebar folders + pinned playlists | YES - after `/api/config` | none | med | quick win (skeleton rows) | `index.html:129`; `renderSidebarFolders` `main.js:1932`; `renderPinnedSidebar` `common.js:8265` |
| 5 | Cross-device handoff card (mini) | YES | rAF fade-in reveal | low | done-ish | `common.js` build ~`:11225`, `render` ~`:11286` |
| 6 | Library item-count badge | YES - after list | none (appears late) | low | quick win | `renderItemCountBadge` `common.js:1530` |
| 7 | Bottom nav | no (static, inline SVG glyphs) | source-locked markup | none | done | `common.js:12-58` |
| 8 | Home - classic grid | YES | `buildSkeletonGrid` seeded pre-fetch | none | done | `main.js:1111`, `:1474` |
| 9 | Home - modern grid | YES | inherits the `#video-grid` skeleton | low | done (verify shape match) | `fetchModernGrid` `main.js:1195-1217` |
| 10 | Home - modern chip row | YES (immediate, no fetch) | painted synchronously | low | none | `buildModernChipRowHtml` `main.js:293`, `:1351` |
| 11 | Home - modern avatar bar (mobile) | YES - after `/api/channels` | DONE v1.99: persist last-known count -> reserve+shimmer before fetch | was high (Dean's device report: the top chip "flow" flickers / more-or-less) | DONE (persist-last-known reserve, no reverse-shift) | `buildAvatarBarSkeleton`/`populateModernAvatarBar` `main.js:299`, seed `main.js:1372` |
| 12 | Home - FEED mode rows | YES - into `#home-feed-host` | NONE; the skeleton lives in `#video-grid` which feed mode sets `display:none` | high (blank until fetch) | quick win (seed skeleton into the feed host) | `renderHomeFeed` `main.js:356`; hide rule `style.css:7737` |
| 13 | Watch - title/views/uploader/meta/description | YES | skeleton-shimmer + seed-paint | none | done | `watch.html:201-336`, `paintMetadata` `watch.js:1306` |
| 14 | Watch - action row | YES | `data-loading` reveal-once (v1.96) | none | done | `watch.html:214`, `revealActionBar` `watch.js:1256` |
| 15 | Watch - RELATED files list | YES | DONE v1.99: seed skeleton rows + reveal header before fetch | was med-high (right rail) | DONE | `buildRelatedSkeletonCards`/`loadRelatedFiles` `watch.js:1463` |
| 16 | Watch - COMMENTS list | NO (CORRECTION) | n/a - SYNCHRONOUS (localStorage + mock, rendered at init) | none | none (audit was wrong - no async load) | `loadComments` `watch.js:2289` (no fetch) |
| 17 | Watch - queue up-next box | YES | hidden until engaged | low | none | `watch.html:273` |
| 18 | Watch/player - transcode "Preparing video" | YES (long job) | spinner + progress overlay | med (spinner, not shimmer) | consider shimmer/progress-forward | `.transcode-spinner` `style.css:2220`; `player.js:1790`, `:3324` |
| 19 | Music - content host (albums/artists/songs/drill) | YES | none; blank-then-`innerHTML` | high | quick win (seed skeleton grid/rows) | `render` `music.js:491-530`, fills `music.js:437/458/515/520` |
| 20 | Music - album/song/drill/sticky art | YES | reserved box, grey fill; pops on decode | med | quick win (shimmer the reserved box) | `music.js:39`, `:69`, `:149` (eager), `:174` (eager) |
| 21 | Music - row action glyphs (like/queue/download) | YES - CSS mask glyphs | none | med (iOS mask lag) | structural (inline SVG) | `music.js:80-93` |
| 22 | Podcasts - content host (shows / episodes) | YES | none; blank-then-append | high | quick win (seed skeleton cards/rows) | `renderShows` `podcasts.js:126-138`, `renderEpisodes` `podcasts.js:196-297` |
| 23 | Podcasts - show/episode art | YES | reserved box; pops on decode; header art eager | med | quick win (shimmer box) | `podcasts.js:151-157`, `:217-220` (eager) |
| 24 | Podcasts - pin button late label swap | YES - 2nd round trip to `/api/podcasts/pins` | none; "Pin to Playlists" -> "Pinned *" | med | structural-ish (reserve/shimmer the button) | `paintPinBtn` `podcasts.js:252-267` |
| 25 | Podcasts - row action glyphs | YES - CSS mask glyphs | none | med (iOS) | structural (inline SVG) | `podcasts.js:432/464/484/500` |
| 26 | Books - grid | YES | none; empty-then-`innerHTML` | high | quick win (skeleton grid) | `loadBooks` fill `books.js:127` |
| 27 | Books - "Continue reading" shelf | YES - 2nd fetch, `hidden` -> shown | none; inserts + pushes grid down | med | structural (reserve height / co-reveal) | `loadContinueShelf` `books.js:139-140` |
| 28 | Books - shelf chips | YES - after `/api/books/folders` | none; empty -> appended, shifts grid | med | quick win (reserve/shimmer chip row) | `loadShelfChips` `books.js:155-192` |
| 29 | Books - cover images | YES | reserved `aspect-ratio:2/3` box; pops on decode | low-med | quick win (shimmer box) | `books.js:32`, `style.css:8107-8117` |
| 30 | Read - EPUB first paint + rAF resize | YES | text status only; re-fits a frame later | high (inherent) | structural (epub.js) | `openEpub` `read.js:429-434`, `:557-572` |
| 31 | Read - narration-bar reveal + refit | user-triggered | deliberate reveal-then-remeasure | by design | N/A (one-frame refit) | `read.js:237-246`, `:598-604` |
| 32 | Read - topbar controls (title/Listen/Like/Finished/Download) | YES - after `/api/books/:id` + tts config | none; buttons unhide, topbar can wrap to 2 rows | med | quick win (reserve slots / seed title) | `read.js:971`, `:983-988`, `maybeShowListen` `:851-857` |
| 33 | Read - PDF per-page 200px -> real height | YES (progressive) | 200px min-height placeholder | med | structural (measure page-1 aspect) | `read.js:630`, `:649-651` |
| 34 | Read - progress readout 0% -> real | YES | seeds `0%` then sets | low | none | `read.html:151-152`, `updateProgressBar` `read.js:198-204` |
| 35 | History - list | YES | none; empty-then-`innerHTML` | high | quick win (skeleton rows) | `fetchPage` `history.js:157-158` |
| 36 | History - thumbnails | YES | reserved `aspect-ratio:16/9` box; pops on decode | low-med | quick win (shimmer box) | `history.js:88`, `style.css:8346-8355` |
| 37 | History - resume bars 0 -> width | YES | deliberate two-step (`--history-pct`) | low | none | `history.js:134-139` |
| 38 | Stats - entire dashboard (10 containers, 2 fetches) | YES | none; empty containers reflow on resolve | high | quick win (skeleton tiles/rows) | `renderStatsDashboard` `stats.js:428-453`, duplicates `:499-518` |
| 39 | Setup - automation toggles flash DEFAULT then correct | YES - after `/api/settings` | none | high (guaranteed on the default-on toggles) | quick win (data-loading barrier OR align HTML defaults) | `loadAutomationSettings` `setup.js:956-997`: `relocate-hydrated` `:979`, `notifications-enabled` `:983`, `prune-missing` `:963` |
| 40 | Setup - lists (users / trash / access / folder builders / corner+glyph editors) | YES | none; empty-then-fill | med | structural (reserve/skeleton per list) | `loadUsersList` `setup.js:1899`, trash `:2179`, access `:1990`, `loadConfig` `:56`, editors `:691`/`:765` |
| 41 | Login / welcome | no (static form) | n/a | low | none | `login.js`, `login.html`, `welcome.html` |

---

## Already smooth (no action)

- **Theme / era / icons / custom-logo / stars** are all resolved on
  `<html>` before first paint by the inline FOUC guard mirrored into every shell
  (`index.html:42-88`). This is the model the rest of the app should aspire to.
- **Watch-page metadata** (title, views, uploader avatar+name, added/size/type,
  description) - skeleton-shimmer markup + synchronous seed-paint, hydrated in
  place. `watch.html:201-336`, `paintMetadata` `watch.js:1306`.
- **Watch action row** - the v1.96 `data-loading` reveal-once barrier, gated on
  BOTH media and capability settling. `watch.js:733`, `:1256`.
- **Home classic grid** (and, by inheritance, the modern grid) -
  `buildSkeletonGrid` seeded before any fetch. `main.js:1111`.
- **Bottom nav** - static, inline-SVG glyphs; no post-fetch pop. `common.js:12`.
- **Cross-device handoff card** - rAF fade-in reveal. `common.js:~11286`.
- **The small deliberate two-steps** - history resume bars, read progress bar,
  the read narration refit - are intentional one-frame settles, not defects.

## Candidates for the sweep, ranked by user-visible impact

Ranked by how much of the viewport flashes and how often a user hits it.

1. **Media library views blank-then-fill (Music, Podcasts, Books, History).**
   Four whole primary places paint an empty host and then snap the entire grid/
   list in on fetch resolve - the single most common "not a modern app" moment.
   All four are QUICK WINS: seed `buildSkeletonGrid` cards or `.skeleton-row`
   rows into the host before the await. `music.js:437/458/515/520`,
   `podcasts.js:127/198`, `books.js:127`, `history.js:157-158`.
2. **Stats dashboard.** Ten unsized containers stacked, reflowing twice (two
   independent fetches). The whole page visibly grows. QUICK WIN: shimmer tiles/
   rows in the known-shape containers. `stats.js:428-453`, `:499-518`.
3. **Persistent header-right cluster (account + bell).** Injected after auth/
   badge fetches, so the top-right of EVERY page pops a control cluster in a beat
   late against an empty header. High frequency, high visibility. STRUCTURAL:
   reserve the slot and shimmer an avatar placeholder until `/api/auth/me`
   settles; inject into the reserved slot. `common.js:5591`, `:3294`.
4. **Watch related-rail + comments.** The entire right rail (related) and the
   comment column paint empty then fill with no placeholder - jarring next to the
   already-shimmered metadata above them. QUICK WINS (skeleton rows).
   `watch.js:1492`, `:2370`.
5. **Home FEED mode.** The one home layout with NO skeleton: the seeded skeleton
   sits in `#video-grid`, which feed mode hides (`style.css:7737`), so the feed
   host is blank until `/api/home` resolves. QUICK WIN: seed a skeleton into
   `#home-feed-host`. `main.js:356`.
6. **Setup default-then-correct toggle flash.** Automation checkboxes paint a
   wrong default and visibly flip after `/api/settings` (guaranteed on the two
   default-ON toggles). QUICK WIN: a `data-loading` reveal-once barrier over the
   settings card, or align the static HTML defaults to the server defaults.
   `setup.js:963/979/983`.
7. **Sidebar folders + pinned playlists.** Left rail builds after `/api/config`.
   QUICK WIN (skeleton rows). `main.js:1932`, `common.js:8265`.
8. **Art decode pop-in across every card surface** (music/podcast/book/history/
   modern-avatar). Space is reserved (no reflow) but each image flashes from a
   flat tint to the picture. QUICK WIN: `.skeleton-shimmer` on the reserved box,
   cleared on `img.onload`. `music.js:39`, `podcasts.js:151`, `books.js:32`,
   `history.js:88`.

### Quick wins vs structural changes

Quick wins (drop in the existing toolkit; no new plumbing):
rows 4, 6, 8, 9, 11, 12, 15, 16, 19, 20, 22, 23, 26, 28, 29, 32, 35, 36, 38, 39
(the align-defaults variant). These are seed-a-skeleton or shimmer-the-reserved-
box edits mirroring `buildSkeletonGrid` / the `data-loading` barrier.

Structural (new reserved-space plumbing or a deeper barrier):
- **Row 3** header-right cluster - needs a reserved slot in the shell + a
  skeleton avatar so injection lands into reserved space instead of appending.
- **Rows 21, 25** iOS CSS-mask row glyphs - inline-SVG swap (the v1.87 pattern)
  to kill mask-decode pop-in.
- **Row 24** podcasts pin button - reserve/shimmer across the second round trip.
- **Row 27** books "Continue reading" shelf - reserve height or co-reveal with
  the main grid so it stops shoving the grid down.
- **Rows 30, 33** epub.js first paint and PDF per-page reflow - inherent to the
  reader engines; the honest fix is measuring page-1 aspect up front (PDF) and a
  shimmer over the reading surface until `rendition` truly paints (EPUB), not a
  drop-in.
- **Row 40** setup lists - per-list reserved skeletons.

### One judgment call to raise with Dean

**Row 18 (transcode "Preparing video").** This is genuinely long-running work,
not a sub-second fetch, so a determinate spinner/progress is defensible where a
shimmer is not (shimmer implies "almost there"). Recommend keeping a progress-
forward affordance here rather than shimmer, but flag it so the "no bare
spinners" rule has one deliberate, disclosed exception.
