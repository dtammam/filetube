/* global sidebarMoveAnchor, persistSidebarMoveByPath */ // v1.339 S2: the by-path sidebar persist (common.js, loaded first; not in eslint.config.js's list)
// FileTube Home Page Logic — registered VIEW MODULE (FR-1, T1).
//
// `init(root)` runs both on a full page load (progressive-enhancement boot,
// via common.js's bootRouter) and on an in-app swap into `/`/`/index.html` —
// the identical code path either way. Every listener this view adds to its
// OWN grid/sidebar controls (plus the SHARED shell's sidebar-folder-list,
// which lives outside #view-root) is registered through ONE per-view
// AbortController, so `destroy()` removes all of them in a single call when
// the user navigates away — no leaks. Prior to v1.17.0 (FR-3(b), T2) this
// view had NO `document`-level listeners and NO timers, which is what made
// its `#view-root` node safe to retain across a round trip: the router's
// home `viewCache` (FR-4, T4, public/js/common.js) detaches and holds onto
// this EXACT node -- WITHOUT calling destroy() -- when leaving home for
// another view, and later reattaches it (WITHOUT calling init() again) on a
// matching return, so this view's single AbortController-per-instance stays
// bound exactly once per live/cached instance -- never zero, never two --
// across any number of cache hits. See common.js's
// homeViewCache/swapToView/restoreHomeFromCache comments for the full
// contract this view must keep honoring. The card action menu (UI pass sweep
// S2) binds its long-press/right-click trigger through the SAME per-instance
// signal and closes any open menu in destroy() (teardownCardMenuFn).
//
// NOTE (C1 remediation, v1.16.0): the shared shell's header #search-input/
// #search-btn are SHELL-owned -- bound exactly once at real-page-load boot
// by common.js's DOMContentLoaded handler, never per-view. This view only
// reads/sets #search-input's value (to reflect the current `?search=`
// query); it never (re-)binds a listener to it.
//
// Pure, DOM-free helpers (v1.22.0 FR-9, T-H) -- kept at module scope, above
// the view IIFE below, so `node:test` can `require()` them directly without
// touching `window`/`document` (mirrors watch.js's/player.js's own
// top-of-file pure-helper + `module.exports` guard pattern).

// buildCardDownloadHref: the home/library card's "save to device" anchor
// href -- reuses the EXISTING, unmodified `/video/:id?download=1` route
// (shipped v1.19.0 on the watch page; see watch.js's `downloadBtn` wiring)
// unchanged. Source-agnostic: works identically for a yt-dlp-managed item
// and a plain local file, since the route itself doesn't care how the file
// got onto disk. `encodeURIComponent` on the id mirrors watch.js exactly.
function buildCardDownloadHref(id) {
  return `/video/${encodeURIComponent(id)}?download=1`;
}

// buildCardDownloadFilename: the anchor's `download` attribute value -- a
// belt-and-suspenders filename hint for browsers that honor it (the actual
// save is authoritative on the server's `Content-Disposition: attachment`
// header). Byte-identical fallback logic to watch.js's `downloadBtn` wiring
// (`title || 'download'` plus the raw extension, e.g. ".mp4") so a missing
// title/ext can never produce a blank or "undefined"-suffixed filename.
// Returned RAW (not HTML-escaped): the one caller (the card menu's Save to
// device, saveCardToDevice) sets it through setAttribute, never markup.
function buildCardDownloadFilename(title, ext) {
  return `${title || 'download'}${ext || ''}`;
}

// buildSkeletonGrid (Item 1, v1.26.3): `n` lightweight `.video-card`-shaped
// loading placeholders, rendered into `#video-grid` BEFORE the
// `/api/config`+`/api/videos` fetch chain in `loadLibrary()` settles --
// replaces the old "ships empty, pops the whole grid in at once" blank
// window. `aria-hidden="true"` on every skeleton card since it carries no real
// content for assistive tech to announce. No timer -- the shimmer motion is
// CSS-only (`.skeleton-shimmer`, prefers-reduced-motion honored -- see
// style.css). Exported for node:test.
//
// v1.339 (L2, plan D5 - "seed the SHAPE you reveal", LESSONS 7): the skeleton
// is the real card's own geometry, so the reveal swaps in place. UI pass sweep
// S2 (D9, F63): it is now built by buildSkeletonCardEl from the SAME ui
// primitives as the real card (the ui-thumb box, a two-line title, byline, meta
// and the five-icon rating row) and serialized here for the innerHTML seed.
// `opts.avatar` reserves the Modern byline avatar; `opts.typeLine` the unified
// search's type label line. `opts.doc` for tests.
function buildSkeletonGrid(n, opts) {
  const count = Number.isInteger(n) && n > 0 ? n : 0;
  const doc = (opts && opts.doc) || (typeof document !== 'undefined' ? document : null);
  if (!doc || count === 0) return '';
  let html = '';
  for (let i = 0; i < count; i++) html += buildSkeletonCardEl(doc, { avatar: !!(opts && opts.avatar), typeLine: !!(opts && opts.typeLine) }).outerHTML;
  return html;
}

// The number of skeleton cards shown while the initial library fetch is in
// flight -- enough to plausibly fill a typical grid row or two on both
// mobile (single column) and desktop (`auto-fill, minmax(210px, 1fr)`)
// without over-committing to a specific viewport width.
const SKELETON_CARD_COUNT = 8;

// v1.102 (tranche 4 shimmer): the Library sidebar folder-list skeleton. Each row
// REUSES the real `.sidebar-item` box (same padding/gap/font-size), so swapping
// it for real folder links is zero-shift: an 18x18 shimmer glyph box (matching
// `.sidebar-item i`) + a shimmer label bar of varied width. Pure string builder
// (buildSkeletonGrid contract): n<=0 / non-integer -> '', every node aria-hidden.
// Exported for node:test.
function buildSidebarSkeletonRows(n) {
  const count = Number.isInteger(n) && n > 0 ? n : 0;
  let html = '';
  for (let i = 0; i < count; i++) {
    const w = 55 + (i % 3) * 12; // 55 / 67 / 79% -> a natural ragged edge
    html += `
      <div class="sidebar-item" aria-hidden="true">
        <span class="skeleton-shimmer" style="width:18px; height:18px; border-radius:var(--radius); flex:none;"></span>
        <span class="skeleton-line skeleton-shimmer" style="width:${w}%; margin:0;"></span>
      </div>`;
  }
  return html;
}
// A plausible folder count to reserve while /api/config is in flight.
const SIDEBAR_SKELETON_ROWS = 5;

// The zero-folders sidebar affordance (also the cold-load error fallback below).
const SIDEBAR_NONE_HTML = '<div style="padding: 6px 24px; font-style: italic; color: var(--ink-2);">None</div>';

// v1.102 (tranche 4, gate CRITICAL): a total /api/config failure must not leave
// the cold-load sidebar skeleton (buildSidebarSkeletonRows) shimmering forever in
// the persistent left rail. GUARDED to the skeleton's aria-hidden placeholder
// rows only: a re-nav whose config fetch fails while REAL folders are already
// rendered keeps them (never wiped to a misleading "None"). Exported for node:test
// so the error-path reveal is BOUND behaviourally, not just source-locked (the
// gap that let the original miss slip past a presence-only test).
function clearSidebarSkeletonOnError(listEl) {
  if (listEl && listEl.querySelector('.sidebar-item[aria-hidden="true"]')) {
    listEl.innerHTML = SIDEBAR_NONE_HTML;
  }
}

// v1.37.0 T10 (books): pure builders for the home surfaces -- the
// continue-reading row (bare home view only) and the books-in-search
// section. Cover cards are compact portrait tiles linking to /read.html;
// escapeHtml discipline (attribute + text escapes).
function escapeBookRowHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildBookRowCardHtml(item) {
  const percent = item && item.progress && typeof item.progress.percent === 'number'
    ? Math.min(100, Math.max(0, item.progress.percent))
    : 0;
  const bar = percent > 0.5
    ? `<div class="book-row-progress"><div class="book-row-progress-fill" style="width: ${percent}%"></div></div>`
    : '';
  return `
    <a class="book-row-card" href="/read.html?b=${encodeURIComponent(item.id)}" title="${escapeBookRowHtml(item.title)}">
      <span class="book-row-cover"><img class="art-shimmer" src="/bookcover/${encodeURIComponent(item.id)}" alt="" loading="lazy" />${bar}</span>
      <span class="book-row-title">${escapeBookRowHtml(item.title)}</span>
    </a>
  `;
}

// The whole row/section: empty items = empty string = nothing rendered
// (books-less installs keep a byte-identical home).
function buildBooksHomeSectionHtml(items, heading, seeAllHref) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const seeAll = seeAllHref ? `<a class="books-row-seeall" href="${escapeBookRowHtml(seeAllHref)}">See all</a>` : '';
  return `
    <section class="books-home-row">
      <div class="books-home-row-header"><h3>${escapeBookRowHtml(heading)}</h3>${seeAll}</div>
      <div class="books-home-row-scroller">${items.map(buildBookRowCardHtml).join('')}</div>
    </section>
  `;
}

// v1.44: the "Continue listening" music row — a compact album-art tile linking
// to /music (the queue picks up from the resume pointer). Reuses the books-row
// scroller styling; empty items = empty string (music-less home stays
// byte-identical).
// v1.340 (#287 e): the tile is 92x138 (.book-row-cover's fixed height wins over
// .music-row-cover's aspect-ratio), so the square cover cover-fits to 138x138; at the 2x DPR
// cap music.js sizes art for (MUSIC_ART_DPR_CAP) that needs 276px: the 512 rendition (the
// smallest allowlisted size covering it, what musicArtSize(138, 2) picks), not the full-size
// cover (often 1000px+). Keyed on the album's `artId` when the payload carries it, so the tile
// shares one cached file with the album's rows on /music.
var MUSIC_ROW_CARD_ART_SIZE = 512;
function buildMusicRowCardHtml(item) {
  // Deep-link to the specific track so /music resumes it (consuming the
  // per-user resume pointer), mirroring the books row's /read.html?b=<id>.
  const artId = (typeof item.artId === 'string' && item.artId) ? item.artId : item.id;
  return `
    <a class="book-row-card music-row-card" href="/music?play=${encodeURIComponent(item.id)}" title="${escapeBookRowHtml(item.title)}">
      <span class="book-row-cover music-row-cover"><img class="art-shimmer" src="/albumart/${encodeURIComponent(artId)}?s=${MUSIC_ROW_CARD_ART_SIZE}" alt="" loading="lazy" /></span>
      <span class="book-row-title">${escapeBookRowHtml(item.title)}</span>
      <span class="music-row-artist">${escapeBookRowHtml(item.artist || '')}</span>
    </a>
  `;
}

// v1.73 (Dean ruling 3): the uniform cap on every home row.
const HOME_ROW_CAP = 8;

// v1.73 (Dean ruling 1): ONE merged "Continue listening" section - music
// tracks and podcast episodes interleaved by listening recency (progress
// updatedAt desc; ISO strings compare lexicographically), capped at
// HOME_ROW_CAP. No See-all link: the mixed row has no single destination
// (each card deep-links its own place). Replaces the two per-kind section
// builders v1.44/v1.71 shipped.
function buildListeningHomeSectionHtml(tracks, episodes, heading) {
  const tagged = [
    ...(Array.isArray(tracks) ? tracks : []).map((t) => ({ kind: 'track', item: t, at: t && t.progress && typeof t.progress.updatedAt === 'string' ? t.progress.updatedAt : '' })),
    ...(Array.isArray(episodes) ? episodes : []).map((e) => ({ kind: 'podcast', item: e, at: e && e.progress && typeof e.progress.updatedAt === 'string' ? e.progress.updatedAt : '' })),
  ];
  if (tagged.length === 0) return '';
  tagged.sort((a, b) => b.at.localeCompare(a.at));
  const cards = tagged.slice(0, HOME_ROW_CAP)
    .map((x) => (x.kind === 'podcast' ? buildPodcastRowCardHtml(x.item) : buildMusicRowCardHtml(x.item)))
    .join('');
  return `
    <section class="books-home-row music-home-row">
      <div class="books-home-row-header"><h3>${escapeBookRowHtml(heading)}</h3></div>
      <div class="books-home-row-scroller">${cards}</div>
    </section>
  `;
}

// v1.71 T5: the podcasts "Continue listening" row - the music row's chassis
// (identical classes, zero new CSS), podcast fields. Deep-links
// /podcasts?play=<episodeId>, which opens the owning show and starts the
// dock at the saved position (the resumeMode:'podcast' ladder).
function buildPodcastRowCardHtml(ep) {
  return `
    <a class="book-row-card music-row-card" href="/podcasts?play=${encodeURIComponent(ep.id)}" title="${escapeBookRowHtml(ep.title)}">
      <span class="book-row-cover music-row-cover"><img class="art-shimmer" src="/podcastart/${encodeURIComponent(ep.subId)}" alt="" loading="lazy" /></span>
      <span class="book-row-title">${escapeBookRowHtml(ep.title)}</span>
      <span class="music-row-artist">${escapeBookRowHtml(ep.showName || '')}</span>
    </a>
  `;
}

// (v1.73: the per-kind podcast section builder retired with the music one -
// buildListeningHomeSectionHtml above renders the merged row; the CARD
// builders survive as its per-kind arms.)

// v1.72 (cap 5): the videos "Continue watching" row - the music/podcasts
// row chassis with media fields. 16:9 thumbs (`.video-row-cover` widens the
// shared cover box; the img cover-fit comes from the chassis rule) and the
// books row's progress-bar classes (videos have real percent to show).
// Deep-links /watch.html?v=<id>; the watch page's own resume ladder picks
// up the saved position - the row never re-derives it.
function buildVideoRowCardHtml(item) {
  const percent = item && typeof item.progressPercent === 'number'
    ? Math.min(100, Math.max(0, item.progressPercent))
    : 0;
  const bar = percent > 0.5
    ? `<div class="book-row-progress"><div class="book-row-progress-fill" style="width: ${percent}%"></div></div>`
    : '';
  // v1.236: continue-watching / video-home rows honor the "open audio in music" flag too.
  const rowHref = musicHrefForItem(item) || `/watch.html?v=${encodeURIComponent(item.id)}`;
  return `
    <a class="book-row-card music-row-card video-row-card" href="${rowHref}" title="${escapeBookRowHtml(item.title)}">
      <span class="book-row-cover video-row-cover"><img class="art-shimmer" src="/thumbnail/${encodeURIComponent(item.id)}" alt="" loading="lazy" />${bar}</span>
      <span class="book-row-title">${escapeBookRowHtml(item.title)}</span>
      <span class="music-row-artist">${escapeBookRowHtml(resolveChannelName(item))}</span>
    </a>
  `;
}

function buildVideoHomeSectionHtml(items, heading, seeAllHref) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const seeAll = seeAllHref ? `<a class="books-row-seeall" href="${escapeBookRowHtml(seeAllHref)}">See all</a>` : '';
  return `
    <section class="books-home-row music-home-row">
      <div class="books-home-row-header"><h3>${escapeBookRowHtml(heading)}</h3>${seeAll}</div>
      <div class="books-home-row-scroller">${items.map(buildVideoRowCardHtml).join('')}</div>
    </section>
  `;
}

// v1.79 home feed: ONE uniform card for the server-resolved GET /api/home item
// shape ({id, kind, title, subtitle, thumbnailUrl, href, progressPercent}).
// Reuses the existing row-card CSS chassis (.book-row-card / .video-row-cover /
// .book-row-progress) - no new card CSS. Every field is ALREADY server-resolved
// (href/thumbnailUrl carry their own encoding), so nothing is re-derived; the
// escapes here are the same attribute/text discipline the sibling builders use.
function buildFeedCardHtml(item) {
  const pct = item && typeof item.progressPercent === 'number' ? Math.min(100, Math.max(0, item.progressPercent)) : 0;
  const bar = pct > 0.5
    ? `<div class="book-row-progress"><div class="book-row-progress-fill" style="width: ${pct}%"></div></div>`
    : '';
  // v1.236: the home ROW feed now carries `type`/`chapterCount` (server-fold), so an audio
  // download reroutes to the music player here too when the flag is on; else the server href.
  const feedHref = musicHrefForItem(item) || item.href;
  return `
    <a class="book-row-card music-row-card video-row-card" href="${escapeBookRowHtml(feedHref)}" title="${escapeBookRowHtml(item.title)}">
      <span class="book-row-cover video-row-cover"><img class="art-shimmer" src="${escapeBookRowHtml(item.thumbnailUrl)}" alt="" loading="lazy" />${bar}</span>
      <span class="book-row-title">${escapeBookRowHtml(item.title)}</span>
      <span class="music-row-artist">${escapeBookRowHtml(item.subtitle || '')}</span>
    </a>
  `;
}

// v1.79 home feed: one server-assembled row -> a section. Empty items = '' (the
// server already omits empty rows, but a belt-and-braces guard keeps a stray
// empty row from rendering an empty scroller).
function buildFeedRowHtml(row) {
  if (!row || !Array.isArray(row.items) || row.items.length === 0) return '';
  const seeAll = row.seeAllHref ? `<a class="books-row-seeall" href="${escapeBookRowHtml(row.seeAllHref)}">See all</a>` : '';
  return `
    <section class="books-home-row music-home-row">
      <div class="books-home-row-header"><h3>${escapeBookRowHtml(row.title)}</h3>${seeAll}</div>
      <div class="books-home-row-scroller">${row.items.map(buildFeedCardHtml).join('')}</div>
    </section>
  `;
}

// v1.102 shimmer sweep (tranche 4): FEED mode was the ONE home layout with no
// skeleton - the pre-fetch seed lives in `#video-grid`, which feed mode hides
// (style.css), so `#home-feed-host` stayed blank until /api/home resolved. This
// seeds a shape-matched shimmer into the feed host BEFORE the fetch: `rows`
// sections, each a real `.books-home-row` header bar (`.skel-title`) over a real
// `.books-home-row-scroller` of `cards` `.video-row-card`-shaped shimmer cards
// (the SAME 164px card + 16:9 cover box the real feed cards use, so the reveal is
// vertically zero-shift). Pure string builder (buildSkeletonGrid contract):
// non-positive counts -> '', every node aria-hidden + skeleton-shimmer. Exported
// for node:test.
function buildFeedSkeleton(rows, cards) {
  const rowCount = Number.isInteger(rows) && rows > 0 ? rows : 0;
  const cardCount = Number.isInteger(cards) && cards > 0 ? cards : 0;
  if (rowCount === 0 || cardCount === 0) return '';
  let cardHtml = '';
  for (let i = 0; i < cardCount; i++) {
    cardHtml += `
      <span class="book-row-card music-row-card video-row-card" aria-hidden="true">
        <span class="book-row-cover video-row-cover skeleton-shimmer"></span>
        <span class="book-row-title skeleton-line skeleton-line-title skeleton-shimmer"></span>
        <span class="music-row-artist skeleton-line skeleton-line-meta skeleton-shimmer"></span>
      </span>`;
  }
  let html = '';
  for (let r = 0; r < rowCount; r++) {
    html += `
      <section class="books-home-row music-home-row" aria-hidden="true">
        <div class="books-home-row-header"><div class="skeleton-shimmer skel-title"></div></div>
        <div class="books-home-row-scroller">${cardHtml}</div>
      </section>`;
  }
  return html;
}
// Enough sections/cards to plausibly fill the feed viewport before the fetch.
const FEED_SKELETON_ROWS = 3;
const FEED_SKELETON_CARDS = 6;

// v1.157 (P1, gate WARNING): a PER-KIND home-row skeleton so the reserved COVER
// height matches the real row -- a truly zero-shift reveal. buildFeedSkeleton is
// video-shaped (`.video-row-cover`, 16:9 ~92px), which left the books/listening
// rows (`.book-row-cover`, 138px) ~46px short. Same `.books-home-row` chassis;
// the card + cover classes are the real per-kind ones ('video' | 'music' |
// 'book'), so the shimmer cover is the same box the real card reveals into.
// Pure string builder -> node:test-covered.
function buildHomeRowSkeleton(kind, n) {
  const count = Number.isInteger(n) && n > 0 ? n : 0;
  if (count === 0) return '';
  // BYTE-MATCH the real per-kind card/cover classes (buildVideoRowCardHtml /
  // buildBookRowCardHtml / buildMusicRowCardHtml). `.book-row-cover` is the ONLY
  // class that sets display:block + a box on these covers -- WITHOUT it the
  // cover is an inline <span> and width/height/aspect-ratio do not apply, so it
  // collapses to a line-box (the gate WARNING: dropping it made the video cover
  // ~15px, not ~92px). The video/music modifiers refine width/aspect ON TOP of
  // book-row-cover: video -> 164px 16:9 (~92px), music -> inert (stays 138px).
  const cardCls = kind === 'video' ? 'book-row-card music-row-card video-row-card'
    : kind === 'music' ? 'book-row-card music-row-card'
      : 'book-row-card';
  const coverCls = kind === 'video' ? 'book-row-cover video-row-cover'
    : kind === 'music' ? 'book-row-cover music-row-cover'
      : 'book-row-cover';
  // video (channel) + music (artist) rows carry a second line; the book row does not.
  const meta = (kind === 'video' || kind === 'music')
    ? '<span class="music-row-artist skeleton-line skeleton-line-meta skeleton-shimmer"></span>'
    : '';
  let cards = '';
  for (let i = 0; i < count; i++) {
    cards += '<span class="' + cardCls + '" aria-hidden="true">'
      + '<span class="' + coverCls + ' skeleton-shimmer"></span>'
      + '<span class="book-row-title skeleton-line skeleton-line-title skeleton-shimmer"></span>'
      + meta + '</span>';
  }
  return '<section class="books-home-row music-home-row" aria-hidden="true">'
    + '<div class="books-home-row-header"><div class="skeleton-shimmer skel-title"></div></div>'
    + '<div class="books-home-row-scroller">' + cards + '</div></section>';
}

// v1.157 (P1, cold-launch crispness): hydrate one home "Continue *" row without
// a layout jump. The row hosts are inserted EMPTY above #video-grid, then filled
// after an async fetch -- which shoved the whole grid DOWN on every cold launch
// for anyone with in-progress items (classic is the default layout,
// homeRowEnabled defaults ON). Now, when the row had content LAST launch (a
// per-row `ft-home-row-seen:*` flag -- the avatar/bell last-known-state
// pattern), we seed the caller's shape-matched `skeletonHtml` FIRST, reserving
// the row's height so the fetched content replaces it IN PLACE (zero shift). A
// user with nothing to continue has no flag, so gets no skeleton -- never a
// reserve-then-collapse. `fetcher` resolves to the section HTML ('' when the
// kind has no in-progress items); the flag is then set to whether content
// actually rendered. On a fetch error only the HOST is cleared -- the flag is
// left intact so a transient failure still reserves next launch.
// v1.339 (L2, plan D5): the home art reveal. Every card thumbnail and row cover ships
// `art-shimmer`; after each render or append, the shared reveal (common.js
// revealArtTogether) clears the ON-SCREEN images together - once all have decoded or
// errored, or its cap elapses - so a screen of thumbnails no longer pops in tile by tile
// (skeleton -> black -> picture). Off-screen (lazy) images reveal per image. An append
// re-runs it over the whole host: only the NEW cards still carry the class (revealed ones
// lost it; a pending batch's images are skipped), so it batches just the new in-view set.
// `signal` (the view's) hands every held image back on teardown.
function revealHomeArt(scope, signal) {
  const ft = typeof window !== 'undefined' ? window.FileTube : null;
  if (!ft || !scope) return;
  if (typeof ft.revealArtTogether === 'function') ft.revealArtTogether(scope, signal ? { signal } : undefined);
  else if (typeof ft.shimmerArt === 'function') ft.shimmerArt(scope);
}

function hydrateHomeRow(host, seenId, fetcher, skeletonHtml) {
  if (!host) return;
  const seenKey = 'ft-home-row-seen:' + seenId;
  let hadItems = false;
  try { hadItems = localStorage.getItem(seenKey) === '1'; } catch { hadItems = false; }
  if (hadItems && skeletonHtml) host.innerHTML = skeletonHtml;
  fetcher()
    .then((html) => {
      host.innerHTML = html || '';
      revealHomeArt(host);
      try { localStorage.setItem(seenKey, html ? '1' : '0'); } catch { /* private mode -- session-only */ }
    })
    .catch(() => { host.innerHTML = ''; });
}

// ---- v1.84 Modern Mode: the filter-chip row ---------------------------------
//
// The `filter` params are the CLIENT half of the server's MODERN_GRID_FILTERS
// (lib/home/feed.js); test/unit/modern-home-layout.test.js's "source-lock" test
// binds the two lists equal so they cannot drift. Labels are static literals (no
// escape needed).
const MODERN_CHIPS = [
  { filter: 'all', label: 'All' },
  { filter: 'videos', label: 'Videos' },
  { filter: 'audio', label: 'Audio' },
  { filter: 'podcasts', label: 'Podcasts' },
  { filter: 'continue', label: 'Continue watching' },
  { filter: 'unwatched', label: 'Unwatched' },
];
// v1.86.0 (Dean): MODERN_SORT_OPTIONS / MODERN_SORT_DEFAULT / resolveModernSort
// live in common.js (exported + source-locked against the server whitelist) and
// are visible here via the shared classic-script global scope, exactly like
// MODERN_CHIP_FILTERS / resolveModernChip.

// UI pass sweep S2 (F19): the Modern chips are the ui-chip filter primitive
// (selected = aria-pressed, ink on the tonal fill - never red). Single-select:
// All is one of the chips here (one dimension).
function buildModernChipRowHtml(active) {
  const a = typeof resolveModernChip === 'function' ? resolveModernChip(active) : 'all';
  const chips = MODERN_CHIPS.map((c) => {
    const on = c.filter === a;
    return `<button type="button" class="ui-chip ui-chip--filter" aria-pressed="${on}" data-chip="${c.filter}">${c.label}</button>`;
  }).join('');
  return `<div class="modern-chip-row library-chips" role="group" aria-label="Filter the home feed">${chips}</div>`;
}
// v1.99 shimmer sweep (Dean's device report): the avatar bar sits ABOVE the chip
// row and used to ship `hidden`, then POP IN after /api/channels resolved -
// shoving the chips + grid down a beat late (the "top flow flickers / has more or
// less"). To reveal-once WITHOUT a reverse-shift, persist the last-known chip
// count and, on the next load, RESERVE the strip with that many shimmer chips
// before the fetch (the v1.53 capability-cache pattern). buildAvatarBarSkeleton
// is a pure builder (the buildSkeletonGrid contract) reusing the REAL
// `.modern-avatar-chip` / ui-avatar xl disc box, so the swap to real chips is
// zero-shift.
const MODERN_AVATARBAR_COUNT_KEY = 'ft-modern-avatarbar-count';
function readModernAvatarBarCount() {
  try {
    const v = parseInt(localStorage.getItem(MODERN_AVATARBAR_COUNT_KEY), 10);
    return Number.isInteger(v) && v > 0 ? Math.min(v, 12) : 0;
  } catch (_) { return 0; }
}
function writeModernAvatarBarCount(n) {
  try { localStorage.setItem(MODERN_AVATARBAR_COUNT_KEY, String(Number.isInteger(n) && n > 0 ? n : 0)); } catch (_) { /* private mode */ }
}
function buildAvatarBarSkeleton(n) {
  const count = Number.isInteger(n) && n > 0 ? Math.min(n, 12) : 0;
  let html = '';
  for (let i = 0; i < count; i++) {
    html += '<span class="modern-avatar-chip" aria-hidden="true">'
      + '<span class="ui-avatar ui-avatar--xl skeleton-shimmer"></span>'
      + '<span class="skeleton-line skeleton-line-meta skeleton-shimmer"></span>'
      + '</span>';
  }
  return html;
}

// v1.84 T4: the mobile recent-uploader subscription bar. Built as DOM; each
// channel is a ui.avatar (UI pass sweep S2, D4.4: the photo, else a monogram on
// a hash-derived tone - never an inline colour). Empty -> the bar stays hidden
// (no empty strip).
function populateModernAvatarBar(barEl, channels) {
  if (!barEl) return;
  barEl.textContent = '';
  if (!Array.isArray(channels) || channels.length === 0) {
    writeModernAvatarBarCount(0); // v1.99: remember "none" so next load reserves nothing (no reverse-shift)
    barEl.hidden = true;
    return;
  }
  writeModernAvatarBarCount(channels.length); // v1.99: reserve this many on the next load
  const u = cardUi();
  for (const c of channels) {
    const a = document.createElement('a');
    a.className = 'modern-avatar-chip';
    a.href = `/?folder=${encodeURIComponent(c.folder)}`;
    a.setAttribute('aria-label', c.name);
    const av = u.avatar({ name: c.name, url: c.avatarUrl || null, kind: 'channel', size: 'xl' });
    const img = av.querySelector('img');
    if (img) img.classList.add('art-shimmer');
    const name = document.createElement('span');
    name.className = 'modern-avatar-name';
    name.textContent = c.name;
    a.appendChild(av);
    a.appendChild(name);
    barEl.appendChild(a);
  }
  barEl.hidden = false;
  // v1.102 (tranche 4 shimmer): the URL-avatar images ship `art-shimmer`; the
  // shared decode-reveal clears each on decode (immediately for a cached avatar).
  if (typeof window !== 'undefined' && window.FileTube && typeof window.FileTube.shimmerArt === 'function') {
    window.FileTube.shimmerArt(barEl);
  }
}

function buildModernEmptyHtml(filter) {
  const msgs = {
    videos: 'No videos here yet.',
    audio: 'No audio here yet.',
    podcasts: 'No downloaded podcast episodes yet.',
    continue: 'Nothing in progress - start watching and it shows up here.',
    unwatched: "Nothing unwatched - you're all caught up.",
    all: 'Nothing here yet - add media and it fills in.',
  };
  return uiStateHtml({ icon: 'smart_display', title: msgs[filter] || msgs.all });
}

// v1.79 home feed: fetch the per-user rows and render them into `host`. Every
// field is server-resolved, so this is pure rendering. Aborts cleanly with the
// view's signal; an empty feed (brand-new user) renders a gentle empty state,
// never a blank surface; a failure leaves the host empty (classic is one toggle
// away).
async function renderHomeFeed(host, signal) {
  if (!host) return;
  // v1.102: shimmer the feed host BEFORE the fetch so it never sits blank while
  // /api/home is in flight. Every branch below overwrites host.innerHTML, so the
  // skeleton is always replaced (reveal-once) - real rows, empty state, or error.
  host.innerHTML = buildFeedSkeleton(FEED_SKELETON_ROWS, FEED_SKELETON_CARDS);
  try {
    const res = await fetch('/api/home', { signal });
    const data = res.ok ? await res.json() : { rows: [] };
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (rows.length === 0) {
      host.innerHTML = uiStateHtml({ icon: 'smart_display', title: 'Nothing here yet', body: 'Start watching and your feed fills in.' });
      return;
    }
    host.innerHTML = rows.map(buildFeedRowHtml).join('');
    revealHomeArt(host, signal);
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    // QA gate SUGGESTION: feed mode hides the classic grid, so a thrown fetch
    // error must not leave a fully blank home - render a message with the way
    // back to the classic grid, never an empty surface.
    host.innerHTML = uiStateHtml({ icon: 'error', tone: 'error', title: 'Could not load your home feed', body: 'Try again, or switch to the classic grid in Settings.' });
  }
}

// v1.72 (#94): the kind dispatch for a mixed-kind Liked card. A shaped
// non-media item (kind 'podcast' | 'track', 'book' rides the books commit)
// renders through the SAME video-card markup and classes - only the
// destination, art route, byline and applicable menu actions differ.
// Returns null for kind 'media'/absent kind: the media path stays
// byte-identical (kind is CARRIED by the server, never inferred here).
function cardKindPresentation(item) {
  const kind = item && typeof item.kind === 'string' ? item.kind : 'media';
  if (kind === 'media') return null;
  const encId = encodeURIComponent(item && item.id != null ? String(item.id) : '');
  if (kind === 'podcast') {
    return {
      kind,
      href: '/podcasts?play=' + encId,
      thumbSrc: '/podcastart/' + encodeURIComponent(item.subId != null ? String(item.subId) : ''),
      uploaderLabel: item.showName || 'Podcast',
      uploaderHref: '/podcasts',
      downloadHref: '/episode/' + encId + '?download=1',
      // Queue rides the v1.71 'podcast' entry kind; delete/share/reheat are
      // media affordances (episode delete lives in the podcasts place).
      canQueue: true
    };
  }
  if (kind === 'track') {
    // v1.222 (Dean): show the ALBUM in a music result byline - "Artist . Album"
    // (the album is on the result; appended only when present, so a track with no
    // album tag reads as the artist alone, unchanged).
    var trackArtist = item.artist || 'Music';
    var trackByline = (typeof item.album === 'string' && item.album)
      ? (trackArtist + ' · ' + item.album)
      : trackArtist;
    return {
      kind,
      href: '/music?play=' + encId,
      thumbSrc: '/albumart/' + encId,
      uploaderLabel: trackByline,
      uploaderHref: '/music',
      downloadHref: '/track/' + encId + '?download=1',
      canQueue: true // v1.72: tracks ride the one queue (entry kind 'track')
    };
  }
  if (kind === 'book') {
    return {
      kind,
      href: '/read.html?b=' + encId,
      thumbSrc: '/bookcover/' + encId,
      uploaderLabel: item.author || 'Books',
      uploaderHref: '/books',
      downloadHref: '/book/' + encId + '/file?download=1',
      canQueue: false // books do not queue (Dean's ruling 7)
    };
  }
  // v1.205 Wave B: TV shows/episodes as unified-search result cards. An
  // episode opens the shared watch page (?tv=, tv.js's own openEpisode); a
  // show opens the Shows page scrolled to it (/tv?show=, tv.js reads it on
  // load). TV cards are NOT card-downloadable/likeable/queueable (no such
  // routes), so downloadHref is '' (the menu offers no Save to device) and
  // likeable:false drops Like from the card menu.
  if (kind === 'tv-episode') {
    return {
      kind,
      href: '/watch.html?tv=' + encId,
      thumbSrc: '/tvthumb/' + encId,
      uploaderLabel: item.showName || 'Shows',
      uploaderHref: item.showId ? '/tv?show=' + encodeURIComponent(String(item.showId)) : '/tv',
      downloadHref: '',
      canQueue: false,
      likeable: false,
    };
  }
  if (kind === 'tv-show') {
    return {
      kind,
      href: '/tv?show=' + encId,
      thumbSrc: item.posterEpisodeId ? '/tvthumb/' + encodeURIComponent(String(item.posterEpisodeId)) : '/tvposter/' + encId,
      uploaderLabel: 'Shows',
      uploaderHref: '/tv',
      downloadHref: '',
      canQueue: false,
      likeable: false,
    };
  }
  return null;
}

// v1.205 Wave B: the small TYPE badge shown on a unified-search result card
// (only when the server tagged the item with a resultType). Maps the eight
// provider resultTypes to a short human label; '' for a plain library item
// (no resultType) so a normal /api/videos card renders no badge.
const SEARCH_RESULT_BADGE = {
  video: 'Video', audio: 'Audio', music: 'Music',
  'podcast-show': 'Podcast', 'podcast-episode': 'Episode',
  'tv-show': 'Show', 'tv-episode': 'Episode', book: 'Book',
};
function searchResultBadgeLabel(resultType) {
  return (typeof resultType === 'string' && SEARCH_RESULT_BADGE[resultType]) || '';
}

// ---- UI pass sweep S2 (D8.5): the clean card and its ONE action menu ---------
//
// A card's thumbnail carries only the duration badge and the progress bar (the
// ui-thumb primitive). Every action the v1.67-v1.204 corner overlays held
// (Download, Delete, Like, Queue, Share, Reheat, Transcript) plus the modern
// feed's Hide-from-feed lives in ONE action menu built with ui.menu, reached by
// the kebab in the card's meta row, a long-press, or a desktop right-click
// (FTInteraction.onActionMenu). The per-user corner layout (Settings "Card
// corners", the cornerTL..BR settings lane) no longer places anything: the menu
// lists every action that APPLIES to the item (the same applicability rules the
// corners had - C4: an inapplicable action is absent, never a substitute).

// The ui builders: the page's window.ui, else (node:test) the sibling module.
function cardUi() {
  if (typeof window !== 'undefined' && window.ui) return window.ui;
  if (typeof module !== 'undefined' && module.require) {
    try { return module.require('./ui.js'); } catch (_) { return null; }
  }
  return null;
}

// Pure: the item's shareable original link (the SERVER-resolved field, never
// re-approximated from a raw youtubeId - the v1.52 lesson). YouTube's watchUrl
// wins; a download from another site shares its saved page link (v1.338).
function cardShareUrl(item) {
  if (item && typeof item.watchUrl === 'string' && item.watchUrl !== '') return item.watchUrl;
  if (item && typeof item.sourceShareUrl === 'string' && item.sourceShareUrl !== '') return item.sourceShareUrl;
  return '';
}

// Pure: the save-to-device href for a card ('' when the kind has none - TV).
function cardDownloadHref(item) {
  const kp = cardKindPresentation(item);
  if (kp) return kp.downloadHref || '';
  return buildCardDownloadHref(item.id);
}

// Pure: the card action menu's items, in menu order, for one item. `caps` =
// { canModifyLibrary, reheatEnabled } (the signed-in user's effective library
// capability and the yt-dlp module health); `opts.feedHideable` = the modern
// feed's Hide-from-feed (explicit, never inferred from a global mode flag).
// Each entry: { id, icon, label, danger? }. Applicability is the corners' C4
// rules verbatim: a non-media kind (podcast/track/book/tv) gets only what its
// own routes support; Delete and Reheat are media verbs; Delete also needs the
// capability (v1.81 write-RBAC - the server is the real gate).
function buildCardMenuItems(item, caps, opts) {
  const it = item || {};
  const c = caps || {};
  const kp = cardKindPresentation(it);
  const out = [];
  if (!kp || kp.canQueue) out.push({ id: 'queue', icon: 'playlist_add', label: 'Add to queue' });
  // v1.343 Watch later: media (video/audio) only. opts.watchLater = already on the list.
  if (!kp) {
    out.push({ id: 'watchlater', icon: 'schedule', label: opts && opts.watchLater ? 'Remove from Watch later' : 'Watch later' });
    if (opts && opts.watchLaterTop) out.push({ id: 'watchlater-top', icon: 'arrow_upward', label: 'Move to top' });
  }
  if (!(kp && kp.likeable === false)) {
    out.push(it.liked === true
      ? { id: 'like', icon: 'favorite.fill', label: 'Unlike' }
      : { id: 'like', icon: 'favorite', label: 'Like' });
  }
  if (cardShareUrl(it)) out.push({ id: 'share', icon: 'share', label: 'Share' });
  if (cardDownloadHref(it)) out.push({ id: 'download', icon: 'download', label: 'Save to device' });
  if (!kp && it.hasSubtitles === true) out.push({ id: 'transcript', icon: 'subject', label: 'Transcript' });
  if (!kp && c.reheatEnabled === true) out.push({ id: 'reheat', icon: 'local_fire_department', label: 'Reheat metadata' });
  if (!kp && opts && opts.feedHideable) out.push({ id: 'feedhide', icon: 'visibility_off', label: 'Hide from feed' });
  if (!kp && c.canModifyLibrary === true) out.push({ id: 'delete', icon: 'delete', label: 'Move to Trash', danger: true });
  return out;
}

// Pure: the Delete confirm's copy. It says exactly what the one code path does:
// the card's Delete calls DELETE /api/videos/:id (the watch page's verb), which
// MOVES the file to Trash for every item - yt-dlp-managed and local alike (the
// route's v1.65 trash move; never a permanent unlink). A local file cannot be
// re-downloaded once the Trash retention window empties it, so its copy says so.
// The watch page's More menu and the Pocket extras ask this same copy (step 7 retired
// the old checkbox-gated local-file dialog, showHardDeleteModal, which had no caller left).
function cardDeleteConfirmCopy(item) {
  const title = item && typeof item.title === 'string' && item.title !== '' ? item.title : 'This file';
  const local = typeof isYtdlpManagedItem === 'function' ? !isYtdlpManagedItem(item) : false;
  const body = '"' + title + '" leaves your library now. It stays in Trash, where you can restore it from Settings, until the Trash retention window empties it.'
    + (local ? ' This local file cannot be re-downloaded.' : '');
  return { title: 'Move to Trash?', body, confirmLabel: 'Move to Trash', cancelLabel: 'Cancel', danger: true };
}

// The card's DOM, built with the ui primitives (ui.thumb, ui.avatar, ui.button,
// ui.icon, ui.chip). `o`: { doc, href, channelName, channelHref, avatar
// ({ url } or null = no avatar), menu (render the kebab) }. Everything textual is
// textContent - no markup string carries item data.
function buildVideoCardEl(item, o) {
  const opts = o || {};
  const ui = cardUi();
  const doc = opts.doc || document;
  const kp = cardKindPresentation(item);
  const card = doc.createElement('div');
  card.className = 'video-card';
  card.setAttribute('data-id', String(item.id));

  // Media: a link around the ui-thumb (duration badge + progress bar only).
  const media = doc.createElement('a');
  media.className = 'card-media';
  media.setAttribute('href', opts.href);
  const pct = typeof item.progressPercent === 'number' && item.progressPercent > 0.5 ? Math.min(100, item.progressPercent) / 100 : 0;
  const thumb = ui.thumb({ src: kp ? kp.thumbSrc : '/thumbnail/' + item.id, alt: item.title || '', duration: item.duration, progress: pct, context: 'card', doc });
  const img = thumb.querySelector('.ui-thumb__img');
  if (img) img.classList.add('art-shimmer');
  if (!kp && item.hasPreview) {
    const preview = doc.createElement('div');
    preview.className = 'card-preview';
    preview.setAttribute('aria-hidden', 'true');
    preview.setAttribute('data-preview-id', String(item.id));
    thumb.insertBefore(preview, img ? img.nextSibling : thumb.firstChild);
  }
  media.appendChild(thumb);
  card.appendChild(media);

  const info = doc.createElement('div');
  info.className = 'video-info';
  if (opts.avatar) info.appendChild(ui.avatar({ name: opts.channelName, url: opts.avatar.url || null, kind: 'channel', size: 'sm', doc }));

  const text = doc.createElement('div');
  text.className = 'card-text';
  if (item.resultType) {
    const badge = ui.chip({ kind: 'meta', label: searchResultBadgeLabel(item.resultType), doc });
    badge.classList.add('card-type');
    text.appendChild(badge);
  }
  const title = doc.createElement('a');
  title.className = 'video-title';
  title.setAttribute('href', opts.href);
  title.setAttribute('title', item.title || '');
  title.textContent = item.title || '';
  text.appendChild(title);

  const byline = doc.createElement('div');
  byline.className = 'video-uploader';
  const channel = doc.createElement('a');
  channel.setAttribute('href', opts.channelHref);
  channel.textContent = opts.channelName || '';
  byline.appendChild(channel);
  text.appendChild(byline);

  // Meta: views (the mock is a fabricated stat - the era flourish, D8.1) + age.
  const meta = doc.createElement('div');
  meta.className = 'video-meta';
  const views = doc.createElement('span');
  views.className = 'card-views' + (isFabricatedViewCount(item) ? ' ft-fabricated' : '');
  views.textContent = resolveViewCountLabel(item);
  const when = doc.createElement('span');
  when.className = 'card-when';
  when.textContent = formatRelativeTime(item.addedAt);
  meta.appendChild(views);
  meta.appendChild(when);
  text.appendChild(meta);

  // The deterministic mock stars: always fabricated (D8.1), drawn icons (AC4).
  const rating = getStarRating(item.id);
  const stars = doc.createElement('div');
  stars.className = 'card-rating ft-fabricated';
  stars.setAttribute('role', 'img');
  stars.setAttribute('aria-label', 'Rated ' + rating + ' out of 5 stars');
  for (let i = 0; i < 5; i++) stars.appendChild(ui.icon(i < rating ? 'star.fill' : 'star', { size: 'sm', cls: i < rating ? 'on' : 'off', doc }));
  text.appendChild(stars);
  info.appendChild(text);

  // The kebab renders only when the menu can hold something: the caps-free
  // entries (queue/like/save/share/transcript) decide it - every capability-gated
  // entry (delete/reheat/feedhide) is a media verb, and a media item always
  // offers Like. A TV card (no such routes) gets no kebab: never an inert control.
  if (opts.menu !== false && buildCardMenuItems(item, {}, {}).length > 0) {
    const kebab = ui.button({ variant: 'plain', shape: 'icon', size: 'sm', icon: 'more_vert', ariaLabel: 'More actions', doc });
    kebab.classList.add('card-kebab');
    kebab.setAttribute('aria-haspopup', 'menu');
    kebab.setAttribute('data-id', String(item.id));
    info.appendChild(kebab);
  }
  card.appendChild(info);
  return card;
}

// A skeleton card of the FINAL geometry (D9, F63): the same ui-thumb box, the
// same info block with a two-line title, byline, meta and rating line boxes -
// so the reveal swaps in place. `opts.avatar` reserves the byline avatar.
function buildSkeletonCardEl(doc, opts) {
  const ui = cardUi();
  const card = doc.createElement('div');
  card.className = 'video-card skeleton-card';
  card.setAttribute('aria-hidden', 'true');
  const media = doc.createElement('div');
  media.className = 'card-media';
  const thumb = ui.thumb({ context: 'card', doc });
  thumb.classList.add('skeleton-shimmer');
  media.appendChild(thumb);
  card.appendChild(media);
  const info = doc.createElement('div');
  info.className = 'video-info';
  if (opts && opts.avatar) {
    const av = ui.avatar({ name: '', kind: 'channel', size: 'sm', doc });
    av.classList.add('skeleton-shimmer');
    while (av.firstChild) av.removeChild(av.firstChild);
    info.appendChild(av);
  }
  const text = doc.createElement('div');
  text.className = 'card-text';
  const bar = (host, cls) => {
    const s = doc.createElement('span');
    s.className = 'skeleton-text skeleton-shimmer ' + cls;
    s.textContent = ' ';
    host.appendChild(s);
    return s;
  };
  // A unified-search result card carries the type label line (opts.typeLine).
  if (opts && opts.typeLine) {
    const type = doc.createElement('span');
    type.className = 'ui-chip ui-chip--meta card-type';
    bar(type, 'skeleton-text-short').textContent = 'Video';
    text.appendChild(type);
  }
  const title = doc.createElement('div');
  title.className = 'video-title';
  bar(title, 'skeleton-text-long');
  title.appendChild(doc.createElement('br'));
  bar(title, 'skeleton-text-mid');
  text.appendChild(title);
  const by = doc.createElement('div');
  by.className = 'video-uploader';
  bar(by, 'skeleton-text-short');
  text.appendChild(by);
  const meta = doc.createElement('div');
  meta.className = 'video-meta';
  bar(meta, 'skeleton-text-mid');
  text.appendChild(meta);
  // The rating row: the real row's five icon boxes, invisible, on the shimmer.
  const rating = doc.createElement('div');
  rating.className = 'card-rating ft-fabricated skeleton-shimmer';
  for (let i = 0; i < 5; i++) rating.appendChild(ui.icon('star', { size: 'sm', doc }));
  text.appendChild(rating);
  info.appendChild(text);
  card.appendChild(info);
  return card;
}

// Home-row visibility toggles (device-local display prefs, like the sort/
// resume prefs). Default ON. Pure so the Settings UI + the home render read
// the SAME decision.
function homeRowEnabled(key) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? true : v !== '0';
  } catch (_) {
    return true;
  }
}

// v1.246 (Dean): audio-only items ALWAYS open in the mobile music player/skin, never the
// video /watch page - EVERYWHERE (grid / channel / search / continue-watching; the server
// mirrors this for notifications). The v1.236 opt-out toggle is RETIRED: Dean's directive is
// "all non-video audio + podcasts open in the skin" (v1.242 already projected every audio-only
// item into Music - this makes the DESTINATION match, unconditionally). Music VIDEOS and
// regular videos are untouched (type !== 'audio'); a non-media kind (podcast / track / book /
// tv) keeps its own destination. `musicHrefForItem` returns the /music href or null (caller
// keeps its /watch href). Chaptered audio routes to the album's FIRST chapter track (`::c0`) so
// it opens IN ITS ALBUM and the iPod MENU/list browses the chapters. Client-only: an id the
// music API can't resolve (a non-projected download) bounces to /watch (music.js's miss path).
function musicHrefForItem(item) {
  // v1.251: THE rule moved VERBATIM to common.js's audioOpenHref - ONE authority for every
  // tap surface (this file's grid/rows/feed, the bell rows, the queue chrome, history, the
  // watch page's related rail). This delegate keeps main.js's three callers and its CJS test
  // export stable; in the browser the bare identifier resolves to common.js's declaration
  // (loaded first on every shell), in node:test the harness supplies the global.
  const rule = (typeof audioOpenHref === 'function' && audioOpenHref)
    || (typeof window !== 'undefined' && window.audioOpenHref) || null;
  return rule ? rule(item) : null;
}

// v1.73 gate C1 (BOTH seats): ruling 1's either-was-on clause is an
// UPGRADE MIGRATION, not a permanent read. The first cut gated the merged
// row on a permanent OR of both keys - homeRowEnabled treats an ABSENT key
// as ON, so on any device that never explicitly disabled the old podcasts
// row (i.e. effectively every device) the new toggle's OFF write could
// never win: a lying Settings control on the headline ruling, proven by a
// surviving ||->&& mutant. This folds the retired key into the surviving
// one EXACTLY ONCE, then deletes it - after which the ONE toggle genuinely
// governs. No retired key present = nothing to fold (fresh devices, and
// every visit after the fold).
function migrateListeningRowPref() {
  try {
    const pod = localStorage.getItem('ft-home-continue-podcasts');
    if (pod === null) return;
    const lv = localStorage.getItem('ft-home-continue-listening');
    const mergedOn = (lv === null ? true : lv !== '0') || (pod !== '0');
    localStorage.setItem('ft-home-continue-listening', mergedOn ? '1' : '0');
    localStorage.removeItem('ft-home-continue-podcasts');
  } catch (_) { /* storage disabled - the default-ON read stands */ }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildCardDownloadHref,
    buildCardDownloadFilename,
    buildSkeletonGrid,
    buildSidebarSkeletonRows,
    clearSidebarSkeletonOnError,
    buildAvatarBarSkeleton,
    buildBookRowCardHtml,
    buildBooksHomeSectionHtml,
    buildMusicRowCardHtml,
    buildListeningHomeSectionHtml,
    HOME_ROW_CAP,
    buildPodcastRowCardHtml,
    buildVideoRowCardHtml,
    buildVideoHomeSectionHtml,
    buildFeedCardHtml,
    buildFeedRowHtml,
    buildFeedSkeleton,
    // v1.157 (P1): the per-kind Continue-row skeleton + the reserve-then-fill
    // hydrator, exported so the shape-match + the no-jump behaviour (seed only
    // when last-seen; reveal both axes) are bound by EXECUTION.
    buildHomeRowSkeleton,
    hydrateHomeRow,
    renderHomeFeed,
    // v1.339 (L2): the home art reveal seam (every card thumbnail + row cover).
    revealHomeArt,
    homeRowEnabled,
    musicHrefForItem,
    migrateListeningRowPref,
    cardKindPresentation,
    searchResultBadgeLabel,
    // UI pass sweep S2 (D8.5): the clean card + its one action menu.
    cardShareUrl,
    cardDownloadHref,
    buildCardMenuItems,
    cardDeleteConfirmCopy,
    buildVideoCardEl,
    buildSkeletonCardEl,
  };
}

// v1.94 CARD preview controller. Plays a short muted MP4 hover clip
// (/preview/:id) over the poster: on DESKTOP when the pointer hovers the card,
// on MOBILE when the card scrolls into the centre of the viewport (capped to
// MAX_INVIEW for battery). One app-wide singleton (init() idempotent). This
// REPLACES the v1.92-v1.93 storyboard-still slideshow; the storyboard sprite now
// drives only the seek-bar SCRUB preview (player.js). Load-guarded: the clip is
// revealed only once it can play (`canplay`), so a 404 (clip not generated yet)
// leaves the poster - never a blank box. Starts on sustained intent (delay).
const PreviewCards = (function () {
  const START_DELAY_MS = 1500;     // sustained hover/in-view before the clip plays
  const MAX_INVIEW = 2;            // battery guard: at most N clips play at once on mobile
  const active = new Set();        // overlay els currently playing
  const pending = new Map();       // overlay el -> start-delay timeout id
  const videoOf = new WeakMap();   // overlay el -> its lazy <video> (GC'd with the el)
  const detachOf = new WeakMap();  // overlay el -> its current begin()'s listener-detach fn
  const ratios = new Map();        // overlay el -> latest intersectionRatio (mobile)
  const observed = new Set();      // overlay els currently observed (for teardown)
  let observer = null;             // the in-view IntersectionObserver (mobile only)
  let inited = false;

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function canHover() {
    return !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  }
  const CLIP_SRC = function (el) { return '/preview/' + encodeURIComponent(el.getAttribute('data-preview-id')); };
  // Lazily create the muted looping inline <video> for a card (only for cards we
  // actually preview). muted + playsinline lets iOS autoplay via play(). Cached
  // in a WeakMap; if a prior stop() released its src (mobile teardown), re-set it.
  function ensureVideo(el) {
    let v = videoOf.get(el);
    if (v) { if (!v.getAttribute('src')) v.setAttribute('src', CLIP_SRC(el)); return v; }
    v = document.createElement('video');
    v.className = 'card-preview-video';
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'metadata';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.src = CLIP_SRC(el);
    el.appendChild(v);
    videoOf.set(el, v);
    return v;
  }
  // hover/in-view start is DELAYED so a brush-past / fast scroll never fires it.
  function start(el) {
    if (active.has(el) || pending.has(el) || reducedMotion()) return;
    if (el.getAttribute('data-pv-nofile') === '1') return; // known-absent -> no delay, no probe
    const t = setTimeout(function () { pending.delete(el); begin(el); }, START_DELAY_MS);
    pending.set(el, t);
  }
  // Kick playback and reveal ONLY on the `playing` event (guaranteed the clip is
  // actually rolling - more robust than `canplay`, which can stall under
  // preload='metadata'). A 404/undecodable clip fires `error` -> stay on the
  // poster (never a blank box), never re-probe.
  function begin(el) {
    if (active.has(el) || reducedMotion()) return;
    if (el.getAttribute('data-pv-nofile') === '1') return;
    const v = ensureVideo(el);
    el.setAttribute('data-pv-want', '1'); // still-wanted intent (cleared by stop)
    // Remove any PRIOR begin()'s still-attached listeners first (a re-hover whose
    // last attempt never reached playing/error), so they can't accumulate.
    const prior = detachOf.get(el);
    if (prior) prior();
    const onPlaying = function () {
      detach();
      if (el.getAttribute('data-pv-want') === '1' && el.isConnected) {
        el.classList.add('previewing'); // reveal (opacity 1) now that it's rolling
        active.add(el);
      } else {
        try { v.pause(); } catch (_) { /* left while starting */ }
      }
    };
    const onErr = function () {
      detach();
      el.setAttribute('data-pv-nofile', '1'); // 404 / undecodable -> poster, no re-probe
    };
    function detach() {
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('error', onErr);
      if (detachOf.get(el) === detach) detachOf.delete(el);
    }
    detachOf.set(el, detach);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('error', onErr);
    try { v.currentTime = 0; } catch (_) { /* not seekable yet */ }
    const pr = v.play(); // muted autoplay is allowed inline (incl. iOS); drives buffering
    if (pr && pr.catch) pr.catch(function () { /* autoplay refused -> poster stays */ });
  }
  function stop(el) {
    if (!el) return;
    const p = pending.get(el);
    if (p) { clearTimeout(p); pending.delete(el); } // cancel a not-yet-started preview
    el.removeAttribute('data-pv-want');
    active.delete(el);
    el.classList.remove('previewing');
    const v = videoOf.get(el);
    if (v) {
      try { v.pause(); } catch (_) { /* torn down */ }
      // Mobile: release the decoder + buffer of a scrolled-away clip (they can
      // pile up on a long grid). Desktop keeps the buffer for instant re-hover.
      // ensureVideo re-sets src on the next begin().
      if (!canHover()) { try { v.removeAttribute('src'); v.load(); } catch (_) { /* best-effort */ } }
    }
  }

  // Desktop: delegated so it covers cards from every render path (initial,
  // append, modern grid) with no per-render registration. The overlay itself is
  // `pointer-events:none` (it must never eat the card's tap), so hover events
  // target the INTERACTIVE `.card-media` (the card's <a>, UI pass sweep S2 -
  // was `.thumbnail-container`) beneath it - we match THAT and reach the overlay
  // child, never the overlay directly (a pointer-events:none sibling is never
  // `e.target` nor its ancestor).
  const PREVIEW_HOST = '.card-media';
  function overlayForEvent(e) {
    const host = e.target.closest && e.target.closest(PREVIEW_HOST);
    return host ? host.querySelector('.card-preview[data-preview-id]') : null;
  }
  function onOver(e) {
    const el = overlayForEvent(e);
    if (el) start(el);
  }
  function onOut(e) {
    const host = e.target.closest && e.target.closest(PREVIEW_HOST);
    if (!host) return;
    // still inside the same card (e.g. moving img -> duration badge) -> keep going
    if (host.contains(e.relatedTarget)) return;
    const el = host.querySelector('.card-preview[data-preview-id]');
    if (el) stop(el);
  }

  // Mobile: play only the up-to-MAX_INVIEW most-visible cards.
  function onIntersect(entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting && en.intersectionRatio > 0) ratios.set(en.target, en.intersectionRatio);
      else ratios.delete(en.target);
    });
    const winners = Array.from(ratios.entries())
      .filter(function (pair) { return pair[0].isConnected && pair[1] >= 0.6; })
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, MAX_INVIEW)
      .map(function (pair) { return pair[0]; });
    const winSet = new Set(winners);
    active.forEach(function (el) { if (!winSet.has(el)) stop(el); }); // active is a Set: (value)
    // v1.93.3 (slim gate): also cancel PENDING start-delay timers for cards that
    // are no longer winners. Without this, scroll churn leaves stale timers that
    // later fire begin() with no in-view re-check, breaching the MAX_INVIEW cap.
    pending.forEach(function (_t, el) { if (!winSet.has(el)) stop(el); });
    winners.forEach(start);
  }

  // Observe any not-yet-observed preview overlays anywhere in the document
  // (mobile). The IntersectionObserver is created LAZILY on the first preview
  // card discovered, so a page/view with none never instantiates one.
  function refresh() {
    // Prune cards a grid re-render detached: IntersectionObserver holds a strong
    // ref to every observed target, so unobserve them or they leak for the app's
    // life (the v1.85 cached-home scar). refresh() runs on every DOM mutation.
    if (observer && observed.size) {
      observed.forEach(function (el) {
        if (!el.isConnected) { observer.unobserve(el); observed.delete(el); ratios.delete(el); }
      });
    }
    const cards = document.querySelectorAll('.card-preview[data-preview-id]:not([data-pv-obs])');
    if (!cards.length) return;
    if (!observer) {
      if (typeof IntersectionObserver !== 'function') return;
      observer = new IntersectionObserver(onIntersect, { threshold: [0, 0.3, 0.6, 0.85, 1] });
    }
    cards.forEach(function (el) { el.setAttribute('data-pv-obs', '1'); observer.observe(el); observed.add(el); });
  }

  return {
    init() {
      if (inited || typeof document === 'undefined') return;
      inited = true;
      if (canHover()) {
        // desktop hover
        document.addEventListener('pointerover', onOver);
        document.addEventListener('pointerout', onOut);
      } else if (typeof IntersectionObserver === 'function' && typeof MutationObserver === 'function') {
        // mobile in-view autoplay. Discover cards from every render path via ONE
        // debounced DOM watcher (the IntersectionObserver itself is created
        // lazily inside refresh() only once a preview card exists).
        let refreshTimer = null; // (renamed from `pending`: distinct from the module-level start-delay map)
        const mo = new MutationObserver(function () {
          if (refreshTimer) return;
          refreshTimer = setTimeout(function () { refreshTimer = null; refresh(); }, 120);
        });
        try { mo.observe(document.body, { childList: true, subtree: true }); } catch (_) { /* body not ready */ }
        refresh();
      }
    },
  };
})();

// Wrapped in its own IIFE so its helpers (escapeHtml, renderMediaGridPage, etc.)
// stay private to this file and never collide with the same-named helpers in
// watch.js/setup.js, which all load on every page (FR-1, T1).
(function () {
  let controller = null;
  // C3 remediation (v1.16.0): a reference to THIS instance's sidebar
  // re-render closure (set inside init(), reset per instance below), so
  // `restoreSidebar()` -- called by common.js's `restoreHomeFromCache` after
  // a cache-hit reattach -- can restore the shared #sidebar-folders-list to
  // home's draggable + active-highlighted rendering. Cleared in destroy() so
  // a torn-down instance can never be (mis)invoked after the fact.
  let restoreSidebarFn = null;
  // UI pass sweep S2: set inside init() to that instance's closeCardMenu, so
  // destroy() closes an open card action menu (a sheet on <body>, outside the
  // view) instead of leaving it acting on a torn-down instance.
  let teardownCardMenuFn = null;
  // v1.30.0 T7: set inside init() to that instance's own
  // teardownGridSentinel() closure -- an IntersectionObserver is NOT
  // AbortSignal-bound (there is no such integration on the platform), so
  // destroy() must explicitly disconnect it (and detach the sentinel DOM
  // node) rather than leaving it observing a torn-down/about-to-be-replaced
  // view's grid indefinitely.
  let disconnectGridSentinelFn = null;

  function init(root) {
    controller = new AbortController();
    const { signal } = controller;
    // v1.94: arm the CARD preview-clip controller (idempotent app-wide singleton
    // -- desktop hover / mobile in-view; plays the muted /preview/:id clip).
    try { PreviewCards.init(); } catch (_) { /* preview is a progressive enhancement */ }
    // C3 remediation: reads the LIVE `allFolders`/`folderSettings` bindings
    // below (a closure over the `let`s, not a value snapshot) -- so calling
    // this later, after loadLibrary() has populated them (or after a sidebar
    // reorder updates them), always re-renders with current data.
    restoreSidebarFn = () => renderSidebarFolders(allFolders, folderSettings);

    const videoGrid = root.querySelector('#video-grid');
    const welcomeMessage = root.querySelector('#welcome-message');
    const libraryContent = root.querySelector('#library-content');

    // v1.52 instant watch: stash the tapped card's in-memory item (plus this
    // view's folderSettings) immediately before the document-level anchor
    // handler navigates -- a bubble listener on the GRID fires first
    // (target -> root order). The watch view consumes it and paints
    // synchronously, so the metadata never flashes placeholders. Bound
    // through this view's own { signal } (the v1.45 leak discipline) -- and
    // ONLY that: a detached #video-grid cannot receive real clicks, and the
    // cache's stale-orphan branches abort before a second instance ever
    // binds, so no isConnected belt is needed here (gate QA S4: a guard
    // with no reachable false branch is the v1.49 dead-guard class).
    videoGrid.addEventListener('click', (e) => {
      const cardLink = e.target && e.target.closest && e.target.closest('a[href*="/watch.html?v="]');
      if (!cardLink) return;
      let id = null;
      try { id = new URL(cardLink.href, window.location.origin).searchParams.get('v'); } catch { /* malformed href -- no seed */ }
      const item = id ? currentItems.find((it) => it && it.id === id) : null;
      if (item && window.FileTube && window.FileTube.stashWatchSeed) {
        window.FileTube.stashWatchSeed(item, { folderSettings });
      }
    }, { signal });
    // #sidebar-folders-list/#search-input live in the PERSISTENT shell
    // (outside #view-root), not this view's own root. The search box's
    // click/keypress LISTENERS are now shell-owned (bound once at boot by
    // common.js's DOMContentLoaded handler — see the C1 remediation comment
    // there); this view only READS/SETS #search-input's value (to reflect the
    // current `?search=` query), guarded since a search-less deep link into a
    // shell that somehow lacks the control must never throw.
    const sidebarFoldersList = document.getElementById('sidebar-folders-list');
    const searchInput = document.getElementById('search-input');
    const rescanBtn = root.querySelector('#rescan-library-btn');
    const videosHeader = root.querySelector('#videos-section-header');
    // UI pass sweep S2: the sort control is a ui-btn icon that opens a ui.menu
    // (the options live in SORT_MENU_OPTIONS below, not in markup).
    const sortBtn = root.querySelector('#sort-select-btn');
    const chipHost = root.querySelector('#library-chip-host'); // the ONE filter chip row (F19)
    const shuffleAgainBtn = root.querySelector('#shuffle-again-btn');
    const playAllBtn = root.querySelector('#play-all-btn'); // v1.343: Watch later's Play all (shown on that scope only)
    const viewModeBtn = root.querySelector('#view-mode-btn'); // v1.45.6: card/list toggle
    // The toolbar row: the filter chip host + the trailing icon tools (sort,
    // shuffle, rescan, view); the bulk-attribution control joins it on an
    // eligible folder view.
    const sectionActions = root.querySelector('.section-actions');

    // The one open card action menu (UI pass sweep S2), or null. A new menu, a
    // full grid re-render and destroy() all close it (closeCardMenu).
    let openCardMenuCtrl = null;

    // Sort preference persists across visits. v1.34 (Dean): precedence is
    // explicit per-browser dropdown pick (localStorage `filetube_sort`) >
    // the server-side `defaultSort` setting (Settings page, out-of-the-box
    // 'release-date' -- the real-YouTube-feed flip) > 'release-date'
    // (matches the server default when the settings fetch fails). The
    // provisional value below is refined from /api/settings in init()
    // BEFORE the first page fetch whenever no explicit pick exists.
    let currentItems = [];
    let folderSettings = {}; // { "<path>": { name, hidden, hiddenFromSidebar } } — for author display, shared with cards
    // The signed-in user's card-action capability (library modify + the yt-dlp
    // module's reheat), latched by loadLibrary BEFORE the first card render
    // (server-authoritative - deliberately NO localStorage lane, the v1.53
    // cross-user-bleed class). Empty until the latch lands: the card menu then
    // offers neither Delete nor Reheat.
    let cardCaps = {};
    const storedSortPick = localStorage.getItem('filetube_sort');
    let currentSort = storedSortPick || 'release-date';

    // v1.30.0 T7 (A5): the home grid is now PAGINATED and SERVER-authoritative
    // for sort/filter (see server.js's T6, `GET /api/videos` ->
    // `{ items, total, offset, limit }`). `HOME_PAGE_LIMIT` is the page size
    // this view requests explicitly (never relies on the server's own
    // default, so behavior stays correct even if that default is retuned).
    // `currentOffset`/`currentLimit`/`currentTotal` track the LAST response's
    // pagination window; `currentSeed` is regenerated on every full reset
    // (initial load, sort/format/search change, "shuffle again") and then
    // reused unchanged across that reset's own subsequent page fetches, so a
    // `random`-sorted scroll session observes ONE stable shuffle instead of
    // re-shuffling (and re-showing duplicates) every time the sentinel fires.
    // `loadingNextPage` guards against a double-fire (e.g. two intersection
    // callbacks landing before the first fetch settles) ever requesting the
    // same page twice.
    const HOME_PAGE_LIMIT = 60;
    let currentOffset = 0;
    let currentLimit = HOME_PAGE_LIMIT;
    let currentTotal = 0;
    let currentSeed = null;
    let loadingNextPage = false;
    // The IntersectionObserver sentinel element (a zero-content sibling of
    // #video-grid, never a grid item itself) + its observer -- both created
    // ONCE per view instance (see ensureGridSentinel(), called from init()
    // below) and torn down in destroy(). Guarded end-to-end for a browser (or
    // test) environment without IntersectionObserver support: the grid still
    // works, it just never auto-loads further pages (AC3.4 only requires the
    // FIRST page to render eagerly; further pages are a progressive
    // enhancement on top of that).
    let gridSentinel = null;
    let sentinelObserver = null;
    // Item 1 (v1.15.0): the FULL folders array (as last received from
    // GET/POST /api/config, including the synthetic Downloads folder when the
    // yt-dlp module contributes one) -- kept alongside folderSettings so the
    // sidebar's drag-and-drop reorder can rebuild the full order after
    // reordering just the VISIBLE subset (see renderSidebarFolders below).
    let allFolders = [];
    // v1.73.1: the module-contributed roots (GET /api/config syntheticFolders)
    // - the sidebar folder list drops these (the hard Downloads entry owns
    // that surface); the reorder math treats them like hiddenFromSidebar.
    let syntheticFolderPaths = [];

    // Parse URL query params — read fresh on every init(), since this same
    // function now runs for every navigation (SPA swap or full load), each
    // potentially with different query params.
    const urlParams = new URLSearchParams(window.location.search);
    const searchQuery = urlParams.get('search') || '';
    // v1.149 (Dean): the search-scope filter (All | Titles | Channels).
    // Deep-linkable via ?searchIn= (whitelisted; junk -> 'all'), otherwise
    // every new search starts on 'all' - DELIBERATELY unpersisted (the
    // YouTube posture; the v1.143 chip persistence was the fiddly half of
    // that wave and a search filter should not follow you between
    // searches). State lives here in the view closure; the toggle below
    // and buildVideosApiUrl both read/write it.
    let activeSearchScope = (typeof normalizeSearchScopeMode === 'function')
      ? normalizeSearchScopeMode(urlParams.get('searchIn'))
      : 'all';
    // v1.205 Wave B: the unified-search content-TYPE chip (All | Videos | Audio
    // | Music | Podcasts | Shows | Books). Deep-linkable via ?type= (whitelist
    // -> 'all'); unpersisted, like the searchIn scope. Used ONLY for a global
    // header search (isUnifiedSearch below); a folder/root search keeps the
    // video-only searchIn toggle.
    let activeSearchType = (typeof normalizeSearchTypeChip === 'function')
      ? normalizeSearchTypeChip(urlParams.get('type'))
      : 'all';
    const folderFilter = urlParams.get('folder') || '';
    // mapped folder (recursive) -- `let` because a bare home load (no query
    // param at all) may apply the configured item-4 defaultView in its place
    // (see loadLibrary()); any explicit query param always wins and this stays
    // as-parsed.
    let rootFilter = urlParams.get('root') || '';
    // v1.32 (Dean): the built-in Liked playlist view -- `?liked=1` scopes the
    // grid to GET /api/liked (the v1.30 collection endpoint, same
    // {items,total,offset,limit} shape as /api/videos; this is its first
    // consumer). Mutually exclusive with the other scope filters by
    // construction (a liked view ignores folder/root/search server-side).
    const likedFilter = urlParams.get('liked') === '1';
    // v1.343 Watch later: `?watchlater=1` is a scope exactly like `?liked=1`, served by GET /api/watch-later
    // (the user's own ordered list; same item shape as Liked, so the same cards).
    const watchLaterFilter = urlParams.get('watchlater') === '1';
    // v1.376 W3 (R3): a channel link opened from an item carries that item's type
    // (`?format=video|audio`, common.js channelHrefForItem). While it applies, it wins over
    // the remembered `filetube_format` for THIS view only and is never written back, so Home
    // keeps the remembered filter. null = no URL format (the remembered filter applies).
    // `let`: the empty state's "Show all" sets it to 'both'; the format chip clears it.
    let viewFormatOverride = (typeof urlFormatFilter === 'function') ? urlFormatFilter(urlParams) : null;
    function activeFormatFilter() { return viewFormatOverride || getStoredFormatFilter(); }

    // v1.79 home feed: the feed replaces the BARE home landing only. Drilling
    // into a folder / channel / search / liked view is always the classic list
    // (which is exactly where each row's "See all ->" lands). Read the toggle
    // synchronously (localStorage device-truth, seeded from the user record at
    // boot - see common.js homeFeedEnabled/bootHomeFeedPref). When on, hide the
    // classic grid + controls via a root class (CSS) and mount a feed host;
    // loadLibrary() renders the feed into it instead of the grid, and the
    // continue-rows block below is skipped (the feed carries its own).
    // v1.79.1: two feed See-all escapes into the classic grid. `?subs=1` is a
    // SCOPE (subscription-only browse - a real filter, so it excludes bare-home
    // like folder/root/liked do). `?browse=1` FORCES classic without a scope
    // (the Recently-added See-all - all videos), because a bare '/' would just
    // re-show the feed for a feed-enabled user.
    const subsFilter = urlParams.get('subs') === '1';
    const forceGrid = urlParams.get('browse') === '1';
    const isBareHome = !searchQuery && !folderFilter && !rootFilter && !likedFilter && !watchLaterFilter && !subsFilter;
    // v1.205 Wave B: a GLOBAL header search (a query with no folder/root/liked/
    // subs scope) is the UNIFIED cross-content search - it hits /api/search and
    // shows the content-type chip row. A search WITHIN a folder/root/liked scope
    // keeps the classic video-only /api/videos path + its searchIn toggle, so
    // nothing about the existing scoped-search behaviour changes.
    const isUnifiedSearch = !!searchQuery && !folderFilter && !rootFilter && !likedFilter && !watchLaterFilter && !subsFilter;
    // v1.84 Modern Mode wins the bare-home layout race: precedence modern > feed
    // > classic (resolveHomeLayout is the pure, unit-bound decision). Modern
    // renders a FLAT chip-filtered grid of rich cards into the SAME #video-grid
    // (so every delegated card handler + card CSS applies unchanged), with a chip
    // row (+ mobile avatar bar, T4) mounted above it.
    const wantModern = typeof modernModeEnabled === 'function' && modernModeEnabled();
    const wantFeed = typeof homeFeedEnabled === 'function' && homeFeedEnabled();
    const homeLayout = typeof resolveHomeLayout === 'function'
      ? resolveHomeLayout({ bareHome: isBareHome, forceGrid, modern: wantModern, feed: wantFeed })
      : (isBareHome && !forceGrid && wantFeed ? 'feed' : 'classic');
    const modernMode = homeLayout === 'modern';
    const feedMode = homeLayout === 'feed';
    let homeFeedHost = null;
    if (feedMode && libraryContent) {
      root.classList.add('home-feed-mode');
      homeFeedHost = document.createElement('div');
      homeFeedHost.id = 'home-feed-host';
      libraryContent.insertBefore(homeFeedHost, libraryContent.firstChild);
    }
    // Modern chrome host (chip row + avatar bar) mounted above the grid, once.
    let modernChromeHost = null;
    let activeModernChip = (typeof resolveModernChip === 'function') ? resolveModernChip('all') : 'all';
    // v1.143 (Dean): the chip filter now persists per-device EXACTLY like the
    // sort right below it - pick Audio, close the app or refresh, and the feed
    // is still on Audio until you toggle it off (picking All persists 'all',
    // the natural cleared state; no extra setting). Read through the whitelist
    // (localStorage is untrusted): resolveModernChip bounds a stale/invalid
    // stored value to 'all', the same posture as the sort's own read.
    try { activeModernChip = resolveModernChip(localStorage.getItem('filetube_modern_chip')); } catch (_) { /* private mode -> default */ }
    // v1.86.0 (Dean): the modern grid's chosen sort, persisted per-device. Read
    // through the whitelist (localStorage is untrusted); the server bounds it too.
    let activeModernSort = MODERN_SORT_DEFAULT;
    try { activeModernSort = resolveModernSort(localStorage.getItem('filetube_modern_sort')); } catch (_) { /* private mode -> default */ }
    let modernReqToken = 0;
    if (modernMode && libraryContent) {
      root.classList.add('modern-home-mode');
      modernChromeHost = document.createElement('div');
      modernChromeHost.id = 'modern-home-chrome';
      libraryContent.insertBefore(modernChromeHost, libraryContent.firstChild);
    }

    // v1.45.6 (Dean): PER-PAGE SORT. When the client toggle is on, this page
    // (folder / Liked / home) remembers its OWN sort — resolve it here, overriding
    // the global pick read above; it falls back to that global pick/default when
    // this page has none yet. Keyed by the AS-PARSED scope (a bare load that later
    // resolves a defaultView folder uses the 'home' key — acceptable). Off by
    // default → this whole block is inert and the global path is byte-unchanged.
    const perPageSortActive = isPerPageSortEnabled();
    const sortPageKeyValue = pageSortKey({ root: rootFilter, liked: likedFilter, watchLater: watchLaterFilter });
    let sortPinnedByPage = false;
    if (perPageSortActive) {
      const pageSort = getPerPageSort(sortPageKeyValue);
      if (pageSort) { currentSort = pageSort; sortPinnedByPage = true; }
    }

    // v1.45.6 (Dean): apply the stored card/list VIEW MODE to the grid + toggle
    // button. The `.list-view` class rides on the persistent #video-grid element,
    // so it survives every innerHTML re-render/append — apply once here.
    function applyViewMode(mode) {
      const m = mode === 'list' ? 'list' : 'card';
      videoGrid.classList.toggle('list-view', m === 'list');
      if (viewModeBtn) {
        const targetIsList = m === 'card'; // in card mode, a click switches TO list
        const use = viewModeBtn.querySelector('use');
        if (use) use.setAttribute('href', targetIsList ? '#i-view_list' : '#i-grid_view');
        viewModeBtn.setAttribute('aria-label', targetIsList ? 'Switch to list view' : 'Switch to card view');
      }
    }
    applyViewMode(getStoredViewMode());
    if (viewModeBtn) {
      viewModeBtn.addEventListener('click', () => {
        const next = getStoredViewMode() === 'list' ? 'card' : 'list';
        setStoredViewMode(next);
        applyViewMode(next);
      }, { signal });
    }

    if (searchQuery) {
      if (searchInput) {
        searchInput.value = searchQuery;
        // v1.150: programmatic sets fire no 'input' - the clear X (common.js)
        // syncs its visibility off this event, so dispatch it explicitly.
        try { searchInput.dispatchEvent(new Event('input')); } catch (_) { /* jsdom-less test shells */ }
      }
      videosHeader.textContent = `Search results for "${searchQuery}"`;
    } else if (likedFilter) {
      videosHeader.textContent = 'Playlist: Liked';
    } else if (watchLaterFilter) {
      videosHeader.textContent = 'Playlist: Watch later';
    } else if (folderFilter) {
      // v1.126: the display map beats the raw folder name on FIRST paint - the
      // v1.122 heal only covered `?root=` views, but the surfaces users tap
      // (a card's channel link, the channels bar) link to `?folder=`, so this
      // header rendered "Playlist: nestalgiamusic" style raw names (Dean's
      // report). The post-fetch retitle below refines with page-0 unanimity.
      const mappedFolder = (typeof folderDisplayName === 'function') ? folderDisplayName(folderFilter) : null;
      videosHeader.textContent = `Playlist: ${mappedFolder || folderFilter}`;
    } else if (subsFilter) {
      videosHeader.textContent = 'From your subscriptions'; // v1.79.1 See-all target
    }

    // The card menu's capability (UI pass sweep S2; was the v1.67 corner latch).
    // Never throws (loadLibrary races it against /api/config in one Promise.all;
    // a failure here must never block the grid): any failure resolves to "no
    // capability", so the menu offers no Delete/Reheat rather than guessing.
    // v1.81 write-RBAC: the EFFECTIVE library-modify capability - admin bypasses
    // via role, exactly like the server gate (never the raw column alone).
    async function fetchCardCaps() {
      let canModifyLibrary = false;
      try {
        const r = await fetch('/api/auth/me');
        if (r.ok) {
          const me = await r.json();
          canModifyLibrary = !!(me && me.user && (me.user.role === 'admin' || me.user.canModifyLibrary === true));
        }
      } catch (_) { /* signed-out shell / network failure -> no capability */ }
      // Reheat rides the latched module-health capability the watch page and the
      // subscriptions nav injector use (common.js capability cache). With no
      // latch yet, the health probe runs in the BACKGROUND and upgrades the
      // latched caps when it answers - the grid never waits on it (the menu
      // reads cardCaps when it opens, so a late answer still lands).
      const cached = readCapabilityCache();
      if (cached && typeof cached.moduleEnabled === 'boolean') {
        return { canModifyLibrary, reheatEnabled: cached.moduleEnabled === true };
      }
      // The late answer mutates the SAME object loadLibrary latches into cardCaps,
      // so it lands whichever of the two settles first.
      const caps = { canModifyLibrary, reheatEnabled: false };
      fetch('/api/subscriptions/health')
        .then((res) => {
          writeCapabilityCache({ moduleEnabled: res.ok === true });
          caps.reheatEnabled = res.ok === true;
        })
        .catch(() => { /* no module answer -> no Reheat */ });
      return caps;
    }

    // Load configuration and files
    async function loadLibrary() {
      // Item 1 (v1.26.3): show skeleton placeholders immediately, before
      // either fetch below even starts -- kills the old "grid ships empty,
      // then pops in all at once" window. Harmless when `#library-content`
      // ends up hidden a moment later (the zero-folders `welcomeMessage`
      // branch below): the skeleton just never becomes visible. Also covers
      // the Retry button's re-invocation of this same function (see the
      // catch block below) -- a retry gets its own fresh skeleton, not a
      // stale error card sitting there while the retried fetch is in flight.
      videoGrid.innerHTML = buildSkeletonGrid(SKELETON_CARD_COUNT, { avatar: !!modernMode, typeLine: isUnifiedSearch });
      // v1.100 (Dean): the toolbar's filters are SYNCHRONOUS (localStorage prefs,
      // the URL's search scope/type), so the chip row renders NOW - before the
      // config/videos fetches - and the toolbar is complete from the first
      // paint. Classic/folder/search only (modern home uses its own chip
      // chrome). ensureLibraryChips builds the row only when the host has none of
      // THIS view's kind, so a loadLibrary retry or a rescan's in-place refresh
      // never rebuilds it (scroll position and focus stay put), and never stacks
      // a second one.
      if (!modernMode) ensureLibraryChips();
      // v1.102 (tranche 4 shimmer): the Library folder list built after
      // /api/config with no placeholder - a blank rail until the fetch landed.
      // Seed a shape-matched skeleton (mirrors the real `.sidebar-item` box, so
      // the reveal is zero-shift) ONLY on a COLD sidebar (no real folder row yet)
      // - an in-app re-nav keeps the already-rendered folders, never a
      // shimmer-over-real reverse flash (the podcasts-grid seed guard pattern).
      if (sidebarFoldersList && !sidebarFoldersList.querySelector('.sidebar-item')) {
        sidebarFoldersList.innerHTML = buildSidebarSkeletonRows(SIDEBAR_SKELETON_ROWS);
      }
      try {
        // v1.339 (L2): the modern chrome paints NOW, before the first await (see
        // mountModernChrome; its function declaration is hoisted within this block).
        if (modernMode) mountModernChrome(modernChromeHost, signal);
        // 1. Check configs (+ the card-menu capability latch, raced in parallel
        // so it never delays the grid behind a second round-trip; both land
        // BEFORE the first card render below, and the skeleton grid above
        // already covers the wait).
        const [configRes, caps] = await Promise.all([
          fetch('/api/config'),
          fetchCardCaps(),
        ]);
        cardCaps = caps;
        const configData = await configRes.json();
        const folders = configData.folders || [];
        folderSettings = configData.folderSettings || {};
        // v1.126: seed the shell-level folder display map (common.js cache) so
        // resolveChannelName + every folder-label surface see it from one fetch.
        if (typeof setFolderDisplayNames === 'function') setFolderDisplayNames(configData.folderDisplayNames);
        syntheticFolderPaths = Array.isArray(configData.syntheticFolders) ? configData.syntheticFolders : [];

        // UI pass sweep S2: the welcome box and the library swap via `hidden`
        // (the global [hidden] rule), never an inline display write.
        if (folders.length === 0) {
          welcomeMessage.hidden = false;
          libraryContent.hidden = true;
          sidebarFoldersList.innerHTML = SIDEBAR_NONE_HTML;
          return;
        }

        welcomeMessage.hidden = true;
        libraryContent.hidden = false;

        // Item 4 (v1.14.0): on a BARE home load (no ?search=/?folder=/?root=
        // at all) apply the configured default view -- an explicit deep link
        // always wins (resolveDefaultView only ever changes rootFilter when
        // none of the three params were present), and a stored default folder
        // that no longer exists falls back to Most recent. Only fetched on a
        // bare load -- a deep-link visit never pays for this extra request.
        // A network/parse failure here must never block the rest of the page.
        // v1.34: the settings fetch now serves TWO defaults -- the item-4
        // default view (bare loads only, unchanged) and the new defaultSort
        // (any load where this browser has no explicit dropdown pick). One
        // fetch covers both; a failure blocks neither (view falls back to
        // Most recent, sort keeps the provisional 'release-date').
        // v1.79.1: the subs-scoped + force-grid See-all views are NOT bare
        // loads - a configured defaultView must not clobber them.
        const bareLoad = !searchQuery && !folderFilter && !rootFilter && !likedFilter && !watchLaterFilter && !subsFilter && !forceGrid;
        if (bareLoad || !storedSortPick) {
          try {
            const settingsRes = await fetch('/api/settings');
            const settingsData = await settingsRes.json();
            if (bareLoad) {
              // v1.32: ?liked=1 is an explicit scope param exactly like the
              // other three -- the configured default view must never
              // clobber a deep link to the Liked playlist.
              rootFilter = resolveDefaultView(rootFilter, searchQuery, folderFilter, settingsData.defaultView, folders);
            }
            if (!storedSortPick && !sortPinnedByPage && typeof settingsData.defaultSort === 'string' && settingsData.defaultSort !== '') {
              // v1.45.6: a per-page sort pinned for THIS page (above) outranks the
              // server defaultSort — don't clobber it.
              currentSort = settingsData.defaultSort;
              applySortLabel(currentSort);
            }
          } catch (err) {
            console.error('Failed to load settings defaults:', err);
          }
        }

        // 2. Render sidebar folders
        renderSidebarFolders(folders, folderSettings);

        // Header for a mapped-folder view uses its friendly name if set.
        if (rootFilter) {
          const base = rootFilter.split(/[\\/]/).pop() || rootFilter;
          const label = (folderSettings[rootFilter] && folderSettings[rootFilter].name) || base;
          videosHeader.textContent = label;
        }

        // v1.84 Modern Mode renderers (nested so they reach putCards + the
        // grid). fetchModernGrid fetches the active chip's items and renders the
        // rich cards into #video-grid; a request token drops a stale response so
        // rapid chip switching never paints an out-of-order result.
        // v1.86.2 (Dean): the modern grid LAZY-LOADS. fetchModernGrid fetches
        // PAGE 0 (replace + fresh seed) via buildModernGridUrl (hoisted to the
        // loadLibrary scope so the shared sentinel's maybeLoadNextPage can reach
        // it); further pages append through that same sentinel machinery
        // (currentSeed/Offset/Limit/Total + ensureGridSentinel), reused because
        // both grids render into the SAME #video-grid.
        async function fetchModernGrid(sig) {
          const token = ++modernReqToken;
          currentSeed = generateSeed(); // fresh shuffle per chip/sort change (a 'random' scroll session then stays stable across pages)
          currentOffset = 0;
          currentLimit = HOME_PAGE_LIMIT;
          const filter = resolveModernChip(activeModernChip);
          let data;
          try {
            const res = await fetch(buildModernGridUrl(0), { signal: sig });
            data = res.ok ? await res.json() : { items: [] };
          } catch (err) {
            if (err && err.name === 'AbortError') return;
            if (token === modernReqToken) videoGrid.innerHTML = uiStateHtml({ icon: 'error', tone: 'error', title: 'Could not load', body: 'Try again, or switch layout in Settings.' });
            return;
          }
          if (token !== modernReqToken) return; // a newer chip click superseded this
          const items = Array.isArray(data.items) ? data.items : [];
          currentItems = items;
          currentOffset = typeof data.offset === 'number' ? data.offset : 0;
          currentLimit = typeof data.limit === 'number' && data.limit > 0 ? data.limit : HOME_PAGE_LIMIT;
          currentTotal = typeof data.total === 'number' ? data.total : items.length;
          if (items.length) putCards(items, false);
          else videoGrid.innerHTML = buildModernEmptyHtml(filter);
          ensureGridSentinel(); // append further pages as the user scrolls
        }
        // v1.86.0 (Dean): a glyph-only sort ▾ injected as the LEFTMOST control in
        // the header top-right. It lives in the PERSISTENT header (Dean's
        // placement), so its visibility is bound to the home ROUTE via CSS
        // (`body[data-view="home"] .modern-sort` shows it; it is display:none on
        // every other view). That is load-bearing: the SPA router CACHES the home
        // view when you navigate away (swapToView's home-cache branch, common.js)
        // WITHOUT calling destroy()/controller.abort() - so an abort-only removal
        // would leave the ▾ orphaned in the header on watch/music/etc. (the v1.86.0
        // gate WARNING, both seats). Route-CSS handles the cache path in BOTH
        // directions (hidden on leave, re-shown on cache-restore, which never
        // re-runs init()); the abort listener below additionally REMOVES the node
        // outright on a genuine view DESTROY (a fresh/folder home load), so a
        // destroyed instance leaves nothing behind. Selecting a sort re-fetches
        // the grid. Self-contained (own menu + handlers) because the classic
        // #sort-dropdown wiring drives the classic grid's resetAndReload, not this
        // endpoint. Reuses .sort-menu.
        // Sweep S9 (F46, F31): the glyph is a plain icon ui-btn (the header's own button, the
        // registry `sort` glyph - never a text caret) and the options are a ui.menu anchored
        // under it: the current sort is a trailing ink CHECK, never red text (F46), and the
        // menu owns Esc / arrow keys / the outside tap / focus return. `menuCtrl` closes with
        // the view (the signal) like every other body-level overlay.
        function injectModernHeaderSort(sig) {
          const headerRight = document.querySelector('.header-right');
          if (!headerRight) return; // signed-out / no shell -> nothing to attach to
          const prior = headerRight.querySelector('.modern-sort');
          if (prior) prior.remove(); // idempotent across re-renders

          const wrap = document.createElement('div');
          wrap.className = 'modern-sort';
          const btn = chromeButtonEl({ icon: 'sort', ariaLabel: 'Sort', cls: 'modern-sort-btn' });
          btn.setAttribute('aria-haspopup', 'menu');
          btn.setAttribute('aria-expanded', 'false');
          btn.title = 'Sort';
          wrap.appendChild(btn);
          headerRight.insertBefore(wrap, headerRight.firstChild); // leftmost of the cluster

          let menuCtrl = null;
          const choose = (val) => {
            const next = resolveModernSort(val);
            // v1.86.0 gate SUGGESTION: re-picking the SAME key is a no-op EXCEPT
            // 'random' - "Feeling lucky" should re-roll each time (the server
            // re-shuffles the whole set on every request), so let random fall
            // through to a fresh fetch even when it is already active.
            if (next === activeModernSort && next !== 'random') return;
            activeModernSort = next;
            try { localStorage.setItem('filetube_modern_sort', next); } catch (_) { /* private mode */ }
            fetchModernGrid(sig);
          };
          btn.addEventListener('click', () => {
            if (menuCtrl && menuCtrl.isOpen()) { menuCtrl.close(); return; }
            btn.setAttribute('aria-expanded', 'true');
            menuCtrl = window.ui.menu({
              title: 'Sort by',
              anchor: btn,
              signal: shownViewSignal(), // gate r2: `sig` is the cached home's, never aborted on nav-away
              items: MODERN_SORT_OPTIONS.map(([val, label]) => ({ label, value: val, checked: val === activeModernSort })),
              onSelect: choose,
              onClose: () => { btn.setAttribute('aria-expanded', 'false'); },
            });
          }, { signal: sig });

          // Genuine view DESTROY (fresh/folder home load): remove the node
          // outright. This is the SECONDARY teardown - route-CSS already hides it
          // on the common cache-away nav (where abort never fires); this handles
          // the destroy path so a torn-down instance leaves nothing behind. The
          // handler is idempotent (removes whatever .modern-sort exists, not a
          // captured node) and `once` so repeated renderModernHome calls within an
          // instance can't pile up live listeners on the same signal (gate
          // SUGGESTION).
          sig.addEventListener('abort', () => {
            const el = document.querySelector('.modern-sort');
            if (el) el.remove();
          }, { once: true });
        }
        // v1.160 (Dean): the card/list toggle for the MODERN home. The classic
        // #view-mode-btn lives in .section-actions, which modern mode hides - but
        // ft-view-mode + applyViewMode already drive the modern grid, so it just
        // needs a control. Same key/helpers as the classic button; lives in the
        // header top-right beside the sort glyph. Cleaned up on destroy like it.
        function injectModernViewToggle(sig) {
          const headerRight = document.querySelector('.header-right');
          if (!headerRight) return;
          const prior = headerRight.querySelector('.modern-view-toggle');
          if (prior) prior.remove(); // idempotent
          // Sweep S9 (F31): a plain icon ui-btn like every header glyph; the registry
          // grid_view / view_list glyph shows the mode a click switches TO.
          const btn = chromeButtonEl({ icon: 'view_list', ariaLabel: 'Switch to list view', cls: 'modern-view-toggle' });
          const use = btn.querySelector('.ui-btn__icon use');
          const sync = () => {
            const isList = getStoredViewMode() === 'list';
            if (use) use.setAttribute('href', isList ? '#i-grid_view' : '#i-view_list'); // the mode a click switches TO
            const label = isList ? 'Switch to card view' : 'Switch to list view';
            btn.title = label;
            btn.setAttribute('aria-label', label);
          };
          sync();
          btn.addEventListener('click', () => {
            const next = getStoredViewMode() === 'list' ? 'card' : 'list';
            setStoredViewMode(next);
            applyViewMode(next);
            sync();
          }, { signal: sig }); // sig is always passed (like the sort); the abort below relies on it
          const modernSort = headerRight.querySelector('.modern-sort');
          if (modernSort) headerRight.insertBefore(btn, modernSort); // left of the sort glyph
          else headerRight.appendChild(btn);
          sig.addEventListener('abort', () => {
            const el = document.querySelector('.modern-view-toggle');
            if (el) el.remove();
          }, { once: true });
        }
        // v1.339 (L2, plan D5): the modern CHROME (header sort + view toggle, the chip row
        // and the avatar-bar reserve) is painted SYNCHRONOUSLY at mount - loadLibrary calls
        // this before its first await. It used to wait behind the /api/config + /api/settings
        // round trips, so the chips (~54px) and the reserve (~98px) landed ABOVE the
        // already-painted grid skeleton and shoved it down (probe: 0.175 CLS, modern cold at
        // 390). Only the channel fetch and the grid fetch wait now (renderModernHome).
        function mountModernChrome(chromeHost, sig) {
          injectModernHeaderSort(sig); // glyph-only ▾, leftmost in the header top-right
          injectModernViewToggle(sig); // v1.160: card/list toggle beside it
          if (chromeHost) {
            // #modern-avatar-bar is filled by T4 (mobile-only). The chip row is
            // wired with ONE delegated listener covering every chip.
            chromeHost.innerHTML = '<div id="modern-avatar-bar" class="modern-avatar-bar" hidden></div>' + buildModernChipRowHtml(activeModernChip);
            const chipRow = chromeHost.querySelector('.modern-chip-row');
            if (chipRow) {
              chipRow.addEventListener('click', (e) => {
                const btn = e.target.closest('.ui-chip[data-chip]');
                if (!btn) return;
                const next = resolveModernChip(btn.dataset.chip);
                if (next === activeModernChip) return;
                activeModernChip = next;
                // v1.143 (Dean): remember the pick per-device - the mirror of
                // the sort's own persistence line (injectModernHeaderSort's
                // choose(), the 'filetube_modern_sort' write).
                try { localStorage.setItem('filetube_modern_chip', next); } catch (_) { /* private mode */ }
                chipRow.querySelectorAll('.ui-chip[data-chip]').forEach((b) => {
                  b.setAttribute('aria-pressed', b.dataset.chip === next ? 'true' : 'false');
                });
                fetchModernGrid(sig);
              }, { signal: sig });
            }
            // v1.99 shimmer sweep: RESERVE the avatar strip with last-known-many
            // shimmer chips, so the real chips reveal in place instead of popping in
            // above the chips. renderModernHome's fetch fills it (or collapses it to
            // hidden if now truly none; a failure clears the seed, never stranded).
            const bar = chromeHost.querySelector('#modern-avatar-bar');
            if (bar) {
              const seedN = readModernAvatarBarCount();
              if (seedN > 0) { bar.innerHTML = buildAvatarBarSkeleton(seedN); bar.hidden = false; }
            }
          }
        }
        async function renderModernHome(chromeHost, sig) {
          // T4: the mobile recent-uploader subscription bar - best-effort; a
          // failure or no subs leaves it hidden, never a broken strip.
          const bar = chromeHost ? chromeHost.querySelector('#modern-avatar-bar') : null;
          if (bar) {
            fetch('/api/channels', { signal: sig })
              .then((r) => (r.ok ? r.json() : { channels: [] }))
              .then((data) => populateModernAvatarBar(bar, selectRecentUploaderChannels(data && data.channels, 12)))
              .catch(() => { if (!sig.aborted) { bar.textContent = ''; bar.hidden = true; } });
          }
          await fetchModernGrid(sig);
        }

        // 3. Fetch + render the media surface. Modern mode (bare home, toggle
        // on) renders a flat chip-filtered grid of rich cards into #video-grid
        // with a chip row above it; feed mode renders the server-assembled rows
        // into the feed host; otherwise page 0 of the classic grid + the
        // infinite-scroll sentinel. Precedence: modern > feed > classic.
        if (modernMode) {
          await renderModernHome(modernChromeHost, signal);
        } else if (feedMode) {
          await renderHomeFeed(homeFeedHost, signal);
        } else {
          await fetchLibraryPage0();
          ensureGridSentinel();
        }

      } catch (err) {
        console.error('Failed to load library data:', err);
        // Item 3 (v1.26.3): the shared, styled `.error-state` card (replaces
        // the old bare inline-styled red text) with a real Retry affordance
        // that re-invokes THIS SAME `loadLibrary()` -- the exact function
        // that just failed -- rather than a full page reload. Bound via this
        // view's per-instance `signal` (same AbortController every other
        // listener in this file uses), so a retry click can never fire
        // against an already-torn-down (navigated-away-from) instance.
        videoGrid.innerHTML = buildErrorStateHtml({ message: 'Error loading library data from server.' });
        const retryBtn = videoGrid.querySelector('[data-error-retry]');
        if (retryBtn) retryBtn.addEventListener('click', () => loadLibrary(), { signal });
        // v1.102 (gate CRITICAL): stop the cold-load sidebar skeleton shimmering
        // forever when /api/config failed - Retry (above) repaints it on success.
        clearSidebarSkeletonOnError(sidebarFoldersList);
      }
    }

    // A fresh, non-reproducible integer for `GET /api/videos`'s `seed` param
    // -- only actually consumed by the server when `sort === 'random'`, but
    // sent unconditionally so the code path is the same either way. Sent
    // ONCE per full reset (see fetchLibraryPage0()) and reused unchanged for
    // every subsequent page fetched under that same reset (maybeLoadNextPage
    // below), so a `random`-sorted scroll session observes one stable
    // shuffle rather than re-shuffling (and duplicating/skipping items) on
    // every page.
    function generateSeed() {
      return Math.floor(Math.random() * 2147483647);
    }

    // v1.86.2 (Dean): the modern grid's paginated URL. Hoisted to this scope
    // (not nested with fetchModernGrid) so the shared sentinel's maybeLoadNextPage
    // can build the next-page URL too. Carries the active chip + sort + this
    // scroll-session's stable `seed` (so a 'random' scroll doesn't re-shuffle) +
    // the page window. Mirrors buildVideosApiUrl's shape for /api/home?view=grid.
    function buildModernGridUrl(offset) {
      const filter = (typeof resolveModernChip === 'function') ? resolveModernChip(activeModernChip) : activeModernChip;
      return '/api/home?view=grid'
        + `&filter=${encodeURIComponent(filter)}`
        + `&sort=${encodeURIComponent(activeModernSort)}`
        + `&seed=${encodeURIComponent(currentSeed)}`
        + `&limit=${HOME_PAGE_LIMIT}`
        + `&offset=${offset}`;
    }

    // Builds the `GET /api/videos` URL for a given page `offset`, carrying
    // every server-authoritative param this view's controls affect: the
    // current search/folder/root scope (unchanged for the lifetime of this
    // view instance -- a new scope is a new page navigation, not a
    // reset-in-place), `sort`/`format` (the persisted preferences; a URL
    // `format=` wins for this view, v1.376 W3 activeFormatFilter), an
    // explicit `limit` (never relies on the server's own default), and the
    // CURRENT reset's `seed`.
    function buildVideosApiUrl(offset) {
      // v1.205 Wave B: a global header search rides the UNIFIED endpoint,
      // blended across every media type. Same {items,total,offset,limit}
      // contract as /api/videos, so the render + infinite scroll + total
      // handling below are unchanged. sort/format/watch/seed do not apply to a
      // cross-type ranked stream (ranking is server-authoritative).
      if (isUnifiedSearch) {
        const p = [`q=${encodeURIComponent(searchQuery)}`];
        if (activeSearchType !== 'all') p.push(`type=${encodeURIComponent(activeSearchType)}`);
        p.push(`limit=${HOME_PAGE_LIMIT}`);
        p.push(`offset=${offset}`);
        return `/api/search?${p.join('&')}`;
      }
      const queryParams = [];
      if (searchQuery) queryParams.push(`search=${encodeURIComponent(searchQuery)}`);
      // v1.149: the scope narrows server-side (pagination must stay honest
      // under the filter, the format/watch precedent). 'all' is the server
      // default - omitted so pre-v1.149 URLs and requests stay byte-identical.
      if (searchQuery && activeSearchScope !== 'all') queryParams.push(`searchIn=${encodeURIComponent(activeSearchScope)}`);
      if (folderFilter) queryParams.push(`folder=${encodeURIComponent(folderFilter)}`);
      if (rootFilter) queryParams.push(`root=${encodeURIComponent(rootFilter)}`);
      if (subsFilter) queryParams.push('subs=1'); // v1.79.1: subscription-scoped browse
      queryParams.push(`sort=${encodeURIComponent(currentSort)}`);
      queryParams.push(`format=${encodeURIComponent(activeFormatFilter())}`);
      // v1.50: watched-state filter -- server-authoritative like format
      // (pagination would break under a client-side filter). Honored by
      // BOTH endpoints below (the v1.32 format-toggle parity posture).
      queryParams.push(`watch=${encodeURIComponent(getStoredWatchFilter())}`);
      queryParams.push(`limit=${HOME_PAGE_LIMIT}`);
      queryParams.push(`offset=${offset}`);
      queryParams.push(`seed=${currentSeed}`);
      // v1.32: the Liked view swaps the ENDPOINT, not the shape --
      // GET /api/liked returns the identical {items,total,offset,limit}
      // contract (v1.30), so pagination/sort/format/seed all just work.
      const endpoint = likedFilter ? '/api/liked' : (watchLaterFilter ? '/api/watch-later' : '/api/videos');
      return `${endpoint}?${queryParams.join('&')}`;
    }

    // v1.30.0 T7 (AC3.4): fetches + renders PAGE 0 ONLY of the media list --
    // never the full library. Called on initial load and on every "reset"
    // (sort change, format-toggle change, "shuffle again") -- each of which
    // mints a FRESH `currentSeed` so a re-roll of `random` actually
    // re-randomizes, then replaces the grid (never appends). Pagination
    // state (`currentOffset`/`currentLimit`/`currentTotal`) is refreshed from
    // the response so the sentinel's "is there more?" guard is always correct
    // for the NEW filter/sort/seed, not the previous reset's.
    async function fetchLibraryPage0() {
      currentSeed = generateSeed();
      const res = await fetch(buildVideosApiUrl(0));
      const data = await res.json();
      currentItems = Array.isArray(data.items) ? data.items : [];
      currentOffset = typeof data.offset === 'number' ? data.offset : 0;
      currentLimit = typeof data.limit === 'number' && data.limit > 0 ? data.limit : HOME_PAGE_LIMIT;
      currentTotal = typeof data.total === 'number' ? data.total : currentItems.length;
      renderMediaGridPage(currentItems, { append: false });
      updateItemCountBadge();
      // v1.161 (Dean): a SUCCESSFUL search clears the box so the next search needs
      // no X-press first; a zero-result search KEEPS the query (its X still resets
      // it). The header still shows "Search results for ..." so the query is never
      // lost. Results ride the `?search=` URL, so clearing the box never wipes them.
      // Dispatch 'input' so the clear-X (common.js) hides now that the box is empty.
      if (searchQuery && searchInput && shouldClearSearchInputAfterResults(currentTotal)) {
        searchInput.value = '';
        try { searchInput.dispatchEvent(new Event('input')); } catch (_) { /* jsdom-less test shells */ }
      }
      // v1.122 (Dean): a `?root=` CHANNEL-folder view titles itself with the
      // channel's resolved display name ("NESTALGIA") once page 0 shows every
      // item agreeing on one name -- so tapping a channel name never lands on a
      // header showing the raw folder ("nestalgiamusic"). A MIXED folder (or an
      // empty page) keeps the folder label -- the header never DISAGREES with
      // the page-0 cards (see resolveRootHeaderLabel's header for the exact
      // contract; a partially-healed folder falls back to the folder label,
      // matching the fallback-named cards on that page). The fallback is
      // DERIVED (same spelling as the initial header set above), never read
      // back from the DOM. The count badge is unaffected: renderItemCountBadge
      // inserts it as the header's NEXT SIBLING (common.js ~1595; gate W1
      // corrected the earlier inside-the-header claim), so setting textContent
      // here cannot touch it. Page-0 only (appends never retitle); non-root
      // views (search/liked/subs/bare home) are untouched by the rootFilter gate.
      if (rootFilter && videosHeader) {
        const rootBase = rootFilter.split(/[\\/]/).pop() || rootFilter;
        const rootLabel = (folderSettings[rootFilter] && folderSettings[rootFilter].name) || rootBase;
        videosHeader.textContent = resolveRootHeaderLabel(currentItems, folderSettings, rootLabel);
      }
      // v1.126: the SAME heal for `?folder=` views - the entry path the v1.122
      // sweep missed (cards' channel links + the channels bar navigate here).
      // Order: the display map beats page-0 sampling (a mapping is an explicit
      // decision; unanimity is the automatic fallback for unmapped folders),
      // and the raw folder name is last. Keeps the familiar "Playlist:" frame.
      if (folderFilter && videosHeader) {
        const mapped = (typeof folderDisplayName === 'function') ? folderDisplayName(folderFilter) : null;
        const label = mapped || resolveRootHeaderLabel(currentItems, folderSettings, folderFilter);
        videosHeader.textContent = `Playlist: ${label}`;
      }
      // v1.126: the rename affordance. UI pass sweep S2 (F61): the heading's
      // controls are ui-btn plain icons (no text dingbats), APPENDED at the END
      // of the heading group - after the name and the item count - so a control
      // that appears or leaves after its fetch never moves anything beside it.
      // Folder views only, library-write members only. Re-rendered idempotently
      // on every page-0 load.
      const headingGroup = videosHeader ? videosHeader.parentNode : null;
      const staleRenameBtn = document.getElementById('folder-rename-btn');
      if (staleRenameBtn && staleRenameBtn.parentNode) staleRenameBtn.parentNode.removeChild(staleRenameBtn);
      if (folderFilter && headingGroup && cardCaps.canModifyLibrary === true) {
        const btn = cardUi().button({ variant: 'plain', shape: 'icon', size: 'sm', icon: 'edit', ariaLabel: 'Rename this playlist' });
        btn.id = 'folder-rename-btn';
        btn.addEventListener('click', async () => {
          const current = (typeof folderDisplayName === 'function' && folderDisplayName(folderFilter)) || '';
          const entered = await cardUi().prompt({ title: 'Rename this playlist', label: 'Display name (empty to reset)', value: current, confirmLabel: 'Save' });
          if (entered === null) return; // cancelled
          try {
            const res = await fetch('/api/folders/display-name', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ folderName: folderFilter, name: entered.trim() }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            // Refresh the shell cache from the server (one authoritative read),
            // then repaint the header from the SAME rule as above.
            const cfg = await (await fetch('/api/config')).json();
            if (typeof setFolderDisplayNames === 'function') setFolderDisplayNames(cfg.folderDisplayNames);
            const mappedNow = (typeof folderDisplayName === 'function') ? folderDisplayName(folderFilter) : null;
            videosHeader.textContent = `Playlist: ${mappedNow || resolveRootHeaderLabel(currentItems, folderSettings, folderFilter)}`;
          } catch (err) {
            cardUi().toast('Could not save the name. ' + (err && err.message ? err.message : ''), { kind: 'error' });
          }
        });
        headingGroup.appendChild(btn);
      }
      // Wave G: the "Show in Music library" toggle - next to the rename control
      // (same idempotent-remove + canModifyLibrary gate). Only on a folder view
      // that actually HAS audio (the mark is meaningless otherwise). Marks the
      // channel (folder) so its downloaded music projects into the Music
      // library. (The per-user opt-in master toggle was RETIRED in v1.242 - audio
      // projects into Music unconditionally and this mark is the OPT-OUT.)
      const staleMusicBtn = document.getElementById('folder-music-toggle');
      if (staleMusicBtn && staleMusicBtn.parentNode) staleMusicBtn.parentNode.removeChild(staleMusicBtn);
      const folderHasAudio = Array.isArray(currentItems) && currentItems.some((it) => it && it.type === 'audio');
      // v1.224 (Dean): the toggle shows whenever the FOLDER has audio (server
      // truth), not just when an audio file is on the loaded page. v1.225: a
      // PINNED sidebar channel navigates via ?root=, so derive the channel folder
      // from the loaded items' OWN folderName when the whole view is ONE channel;
      // a multi-channel root gets no single mark. Prefer an explicit ?folder=.
      let musicFolderName = folderFilter;
      if (!musicFolderName && rootFilter) {
        const itemFolders = Array.from(new Set((Array.isArray(currentItems) ? currentItems : [])
          .map((it) => (it && typeof it.folderName === 'string' ? it.folderName.trim() : ''))
          .filter(Boolean)));
        if (itemFolders.length === 1) musicFolderName = itemFolders[0];
      }
      if (musicFolderName && headingGroup && cardCaps.canModifyLibrary === true) {
        // A ui-btn icon toggle: pressed = showing in Music (music_note), not
        // pressed = hidden from Music (music_off). v1.268 slim W2: seeded to the
        // v1.242 DEFAULT (on) - never a pessimistic guess the fetch then flips.
        const mbtn = cardUi().button({ variant: 'plain', shape: 'icon', size: 'sm', icon: { off: 'music_off', on: 'music_note' }, pressed: true, ariaLabel: 'Show in Music' });
        mbtn.id = 'folder-music-toggle';
        mbtn.hidden = !folderHasAudio; // optimistic show if the page has audio; the fetch confirms
        let effectiveNow = true;
        const paint = (effective) => {
          // v1.268 (Dean): say what the control does in both states (it is an
          // OPT-OUT: every channel is in Music by default) - one label source for
          // the accessible name; the icon (music_note / music_off) shows the state
          // without hover.
          const t = effective
            ? 'Showing in Music - tap to hide this channel\u2019s songs from your Music library'
            : 'Hidden from Music - tap to show this channel\u2019s songs in your Music library';
          mbtn.setAttribute('aria-label', t);
          cardUi().setPressed(mbtn, !!effective);
        };
        paint(true);
        fetch(`/api/folders/music-flag?folderName=${encodeURIComponent(musicFolderName)}`)
          .then((r) => r.json())
          .then((s) => {
            // hasAudio is the authority: a folder with NO audio never gets the mark.
            if (!s || s.hasAudio !== true) { if (mbtn.parentNode) mbtn.parentNode.removeChild(mbtn); return; }
            mbtn.hidden = false;
            effectiveNow = !!s.effective;
            paint(effectiveNow);
          })
          .catch(() => { if (!folderHasAudio && mbtn.parentNode) mbtn.parentNode.removeChild(mbtn); });
        mbtn.addEventListener('click', async () => {
          const next = effectiveNow ? 'off' : 'on';
          try {
            const res = await fetch('/api/folders/music-flag', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ folderName: musicFolderName, music: next }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            effectiveNow = (next === 'on');
            paint(effectiveNow);
            cardUi().toast(effectiveNow ? 'Showing in Music' : 'Hidden from Music');
          } catch (err) {
            cardUi().toast('Could not update the Music setting. ' + (err && err.message ? err.message : ''), { kind: 'error' });
          }
        });
        headingGroup.appendChild(mbtn);
      }
      // The chip row rendered synchronously at the top of loadLibrary; this
      // guarded twin covers a path where that early render was skipped.
      ensureLibraryChips();
      // v1.53 (Dean): the bulk-attribution control for folder views (data-
      // dependent - it needs the fetched items to know eligibility, so it stays
      // here, post-fetch; it appears only on an eligible folder view, disclosed).
      ensureAttributeFolderButton(sectionActions);
    }

    // v1.53: "Attribute folder..." -- shown ONLY on a ?root= folder view
    // with at least one genuinely UNATTRIBUTED item (channelUrl empty, the
    // single predicate every surface uses -- never resolveChannelName,
    // which always fabricates a label). Container-scoped de-dupe (the
    // doubled-toggle-row lesson); explicit order: 12 in the phone block
    // (the v1.50.4 orphan-row lesson -- repull owns 11).
    // v1.202: the bulk tool is behind the manual-attribution opt-in. This
    // `let` is INSIDE init(root) - one per view instance - so a toggle in
    // Settings takes effect on the next navigation, and a transient fetch
    // failure pins only that one view OFF. Fetched only on a `?root=` view
    // (the button cannot mount anywhere else), so no other view pays the
    // request. null = unknown -> the button stays absent.
    let attributeControlEnabled = null;
    function ensureAttributeFolderButton(actionsEl) {
      if (!actionsEl) return;
      const existing = actionsEl.querySelector('#attribute-folder-btn');
      if (attributeControlEnabled === null && rootFilter) {
        attributeControlEnabled = false; // in flight
        fetch('/api/settings')
          .then((r) => (r && r.ok ? r.json() : null))
          .then((settings) => {
            attributeControlEnabled = !!(settings && settings.attributeControlEnabled === true);
            if (attributeControlEnabled) ensureAttributeFolderButton(actionsEl);
          })
          .catch(() => { /* stays absent */ });
      }
      const eligible = attributeControlEnabled === true && Boolean(rootFilter) &&
        currentItems.some((it) => it && (typeof it.channelUrl !== 'string' || it.channelUrl === ''));
      if (!eligible) {
        if (existing) existing.remove();
        return;
      }
      if (existing) return;
      // UI pass sweep S2: a ui-btn (tonal, the toolbar's size) with its label.
      const btn = cardUi().button({ variant: 'tonal', size: 'sm', pill: true, label: 'Attribute folder',
        ariaLabel: 'Attribute unattributed videos in this folder to a channel' });
      btn.id = 'attribute-folder-btn';
      btn.addEventListener('click', async () => {
        let targets = [];
        try {
          const res = await fetch('/api/attribution-targets');
          const body = await res.json();
          targets = Array.isArray(body.targets) ? body.targets : [];
        } catch (_) { /* picker shows its own empty state */ }
        // Gate C3 (adversarial): NOTHING moves before the user confirms REAL
        // server-computed numbers -- preview first (write-free), then a
        // count-and-destination confirm, then execute. Gate W6: the picker
        // handle dies with the view.
        const picker = showAttributionPicker(targets, { title: 'Attribute this folder to', showRelocate: true }, (target, opts) => {
          const relocate = opts.relocate === true;
          fetch('/api/videos/attribute-channel-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ root: rootFilter, target, relocate, preview: true }),
          })
            .then((res) => res.json().then((b) => ({ ok: res.ok, b })))
            .then(({ ok, b }) => {
              if (!ok) { showToast((b && b.error) || 'Bulk attribution failed.'); return; }
              const total = (b.matched || 0) + (b.resuming || 0);
              if (total === 0) { showToast('Nothing to attribute in this folder.'); return; }
              const moveLine = relocate && b.relocatable
                ? `<br>${escapeHtml(String(total))} file(s) will MOVE to:<br><small>${escapeHtml(b.destinationDir || '')}</small>`
                : (relocate ? '<br><small>Files will not move: ' + escapeHtml(b.relocateSkipped || 'destination unavailable') + '</small>' : '');
              showConfirmModal(
                'Attribute this folder?',
                `Attribute <strong>${escapeHtml(String(b.matched || 0))}</strong> video(s) to <strong>${escapeHtml(target.channelName)}</strong>` +
                (b.resuming ? ` (and finish moving ${escapeHtml(String(b.resuming))} from an earlier run)` : '') + moveLine,
                () => executeBulkAttribution(target, relocate),
                { confirm: relocate && b.relocatable ? 'Attribute and move' : 'Attribute', cancel: 'Cancel' }
              );
            })
            .catch(() => showToast('Bulk attribution failed.'));
        });
        if (picker && picker.dismiss) signal.addEventListener('abort', picker.dismiss, { once: true });
      }, { signal });
      actionsEl.appendChild(btn);
    }

    // Gate W1 (adversarial): the mover's progress cannot render on the
    // download chip (unknown kind/states there) -- the FOLDER VIEW polls the
    // one-shot itself and reports the full honest summary: moved,
    // collisions, already-there, failed, cancelled.
    function executeBulkAttribution(target, relocate) {
      fetch('/api/videos/attribute-channel-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: rootFilter, target, relocate }),
      })
        .then((res) => res.json().then((b) => ({ status: res.status, b })))
        .then(({ status, b }) => {
          if (status === 409) { showToast('A bulk attribution is already running.'); return; }
          if (status !== 200 && status !== 202) { showToast((b && b.error) || 'Bulk attribution failed.'); return; }
          if (!b.relocating) {
            showToast(b.relocateSkipped
              ? `Attributed ${b.attributed} video(s) to ${target.channelName} (files not moved: ${b.relocateSkipped}).`
              : `Attributed ${b.attributed} video(s) to ${target.channelName}.`);
            resetAndReload();
            return;
          }
          showToast(`Attributed ${b.attributed} video(s) to ${target.channelName}; moving ${b.total} file(s)…`);
          pollBulkAttribution(target.channelName);
        })
        .catch(() => showToast('Bulk attribution failed.'));
    }

    function pollBulkAttribution(channelLabel) {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - startedAt > 10 * 60 * 1000) { clearInterval(timer); return; }
        fetch('/api/subscriptions/status')
          .then((res) => (res.ok ? res.json() : null))
          .then((snap) => {
            const entry = snap && snap.oneShots && snap.oneShots['attribute-bulk'];
            if (!entry) return;
            if (entry.state !== 'done' && entry.state !== 'error') return;
            clearInterval(timer);
            if (entry.state === 'error') { showToast('Bulk move crashed partway - re-run to resume the rest.'); resetAndReload(); return; }
            const bits = [`moved ${entry.moved || 0}`];
            if (entry.alreadyThere) bits.push(`${entry.alreadyThere} already in place`);
            if (entry.collisions) bits.push(`${entry.collisions} name collision(s) skipped`);
            if (entry.failed) bits.push(`${entry.failed} failed`);
            showToast(`${channelLabel}: ${bits.join(', ')}${entry.cancelled ? ' (cancelled - re-run to resume)' : ''}.`);
            resetAndReload();
          })
          .catch(() => { /* transient -- keep polling */ });
      }, 1500);
      // The view's abort signal stops the poll on navigation (v1.41.11
      // async-handler staleness lesson).
      signal.addEventListener('abort', () => clearInterval(timer), { once: true });
    }

    // The shared "reset to a fresh page 0" path for every control that used
    // to just locally re-sort/re-filter the already-fetched `currentItems`
    // (sort <select>, the format toggle, "shuffle again") -- the SERVER is
    // now authoritative for sort/filter (v1.30 A5), so these all become a
    // real refetch instead of a synchronous local re-sort. Network/parse
    // failures are logged, not thrown -- a failed reset leaves the
    // PREVIOUSLY rendered page on screen rather than blanking the grid.
    async function resetAndReload() {
      try {
        await fetchLibraryPage0();
      } catch (err) {
        console.error('Failed to refresh library:', err);
      }
    }

    // v1.30.0 T7 (AC3.4): fetches exactly the NEXT page (guarded so it can
    // never run twice concurrently, and never past the end of the current
    // filtered/sorted set) and APPENDS it to the grid -- never a full
    // library re-render. Invoked by the IntersectionObserver sentinel
    // callback below.
    async function maybeLoadNextPage() {
      if (loadingNextPage) return;
      if (currentOffset + currentLimit >= currentTotal) return; // reached the end -- nothing more to fetch
      loadingNextPage = true;
      // v1.86.2 (Dean): the modern grid appends its own paginated cards from
      // /api/home?view=grid (same window/seed contract). A chip/sort change mid-
      // fetch bumps modernReqToken, so a stale append is dropped rather than
      // stacking cards for the wrong filter behind the freshly-replaced grid.
      if (modernMode) {
        const token = modernReqToken;
        try {
          const nextOffset = currentOffset + currentLimit;
          const res = await fetch(buildModernGridUrl(nextOffset));
          const data = await res.json();
          if (token !== modernReqToken) return; // superseded by a chip/sort reset
          const items = Array.isArray(data.items) ? data.items : [];
          currentOffset = typeof data.offset === 'number' ? data.offset : nextOffset;
          currentLimit = typeof data.limit === 'number' && data.limit > 0 ? data.limit : currentLimit;
          currentTotal = typeof data.total === 'number' ? data.total : currentTotal;
          // v1.97 gate W1/S1: DE-DUPE on append. After a mid-session feed-hide the
          // candidate set shrank by one, so a seeded `random` shuffle re-permutes
          // and the next page can re-deliver an already-rendered card. Drop any id
          // already on screen so a hidden-then-scroll never DUPES a card. (A random
          // SKIP is inherent to a seeded shuffle over a changed set and self-heals
          // on refresh - disclosed; the stable sorts are unaffected either way.)
          const seenIds = new Set(currentItems.map((it) => String(it.id)));
          const fresh = items.filter((it) => !seenIds.has(String(it.id)));
          currentItems = currentItems.concat(fresh);
          putCards(fresh, true);
        } catch (err) {
          console.error('Failed to load the next modern grid page:', err);
        } finally {
          loadingNextPage = false;
        }
        return;
      }
      try {
        const nextOffset = currentOffset + currentLimit;
        const res = await fetch(buildVideosApiUrl(nextOffset));
        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];
        currentOffset = typeof data.offset === 'number' ? data.offset : nextOffset;
        currentLimit = typeof data.limit === 'number' && data.limit > 0 ? data.limit : currentLimit;
        currentTotal = typeof data.total === 'number' ? data.total : currentTotal;
        currentItems = currentItems.concat(items);
        renderMediaGridPage(items, { append: true });
        // v1.53 gate QA-C1: bulk-attribution eligibility was decided off
        // page 0 (60 items) and never revisited -- a folder whose
        // unattributed orphans sort past the first page silently never
        // showed the button. Every appended page re-checks.
        ensureAttributeFolderButton(root.querySelector('.section-actions'));
      } catch (err) {
        console.error('Failed to load the next library page:', err);
      } finally {
        loadingNextPage = false;
      }
    }

    // Creates (once per view instance) a zero-content sentinel element as a
    // SIBLING of #video-grid (never a grid item itself -- it must never
    // render as a stray/blank card cell) and an IntersectionObserver that
    // fires maybeLoadNextPage() whenever it scrolls into view. Guarded for
    // an environment without IntersectionObserver support (older browsers,
    // and this repo's jsdom-based tests unless they supply their own stub --
    // see shell-smoke.test.js's stubbing conventions): the grid still works
    // fully, it just never auto-loads further pages, which is a strict
    // subset of AC3.4's REQUIRED behavior (only the first page is required
    // to render eagerly). Idempotent -- a second call is a no-op.
    function ensureGridSentinel() {
      if (gridSentinel) return;
      if (typeof IntersectionObserver !== 'function') return;
      gridSentinel = document.createElement('div');
      gridSentinel.id = 'video-grid-sentinel';
      gridSentinel.setAttribute('aria-hidden', 'true');
      gridSentinel.style.height = '1px';
      videoGrid.insertAdjacentElement('afterend', gridSentinel);
      sentinelObserver = new IntersectionObserver((entries) => {
        const last = entries[entries.length - 1];
        if (last && last.isIntersecting) maybeLoadNextPage();
      });
      sentinelObserver.observe(gridSentinel);
    }

    // Disconnects the observer and detaches the sentinel node -- see
    // `disconnectGridSentinelFn` (declared at the outer IIFE scope, above
    // init()) for why destroy() needs an explicit hook for this rather than
    // relying on the AbortController every other listener here uses.
    function teardownGridSentinel() {
      if (sentinelObserver) {
        sentinelObserver.disconnect();
        sentinelObserver = null;
      }
      if (gridSentinel && gridSentinel.parentNode) {
        gridSentinel.parentNode.removeChild(gridSentinel);
      }
      gridSentinel = null;
    }
    disconnectGridSentinelFn = teardownGridSentinel;

    // Pure(ish) card-markup builder -- extracted from the old renderMediaGrid
    // so BOTH the page-0 replace path and the append-a-page path (below)
    // build identical card markup from a single source of truth.
    // v1.40.0: the current view's browse context, encoded for the watch link.
    // Mirrors buildVideosApiUrl's server-order inputs (scope + sort + format +
    // shuffle seed) so prev/next on the watch page reproduces THIS exact list.
    // Recomputed per render so it always reflects the live sort/seed (a
    // sort-change or "shuffle again" re-renders the whole grid).
    function currentBrowseContextParam() {
      // v1.88 (Dean): in Modern mode the home grid is a flat, PILL-filtered
      // list served by /api/home?view=grid -- a different endpoint AND a
      // different filter dimension (the pill: all/videos/audio/podcasts/
      // continue/unwatched) than the classic /api/videos scope/format below.
      // Carry the grid's OWN query so prev/next/autoplay walk the SAME pill the
      // card was opened from, in its Modern sort + this scroll session's seed.
      // `modernMode` is true ONLY on the bare home (resolveHomeLayout gates it
      // on bareHome), so a folder/search view -- which renders the classic grid
      // even under the Modern setting -- correctly falls through to the scope
      // path. The watch page re-fetches via buildContextListUrl (common.js) and
      // steps the response order verbatim, media-only (podcast tiles are
      // non-media and drop out of the video-player walk, like mixed Liked).
      if (modernMode) {
        return encodeListContext({
          src: 'home-grid',
          filter: (typeof resolveModernChip === 'function') ? resolveModernChip(activeModernChip) : activeModernChip,
          sort: activeModernSort,
          seed: currentSeed,
        });
      }
      return encodeListContext({
        src: likedFilter ? 'liked' : (watchLaterFilter ? 'watchlater' : 'videos'),
        sort: currentSort,
        seed: currentSeed,
        search: searchQuery,
        searchIn: activeSearchScope, // v1.149 gate W1: the scope rides the ctx (encodeListContext drops 'all')
        folder: folderFilter,
        root: rootFilter,
        format: activeFormatFilter(),
      });
    }

    // One card, as DOM (UI pass sweep S2: module-scope buildVideoCardEl builds it
    // from the ui primitives). The view supplies what only it knows: the
    // destination (with the browse context, v1.40.0), the channel identity, and
    // the Modern byline avatar decision (common.js modernCardAvatar).
    function buildCardEl(item) {
      const kp = cardKindPresentation(item);
      // v1.40.0: carry the FULL browse context into the watch page so prev/next
      // walks THIS view's exact on-screen order; a non-media card opens its own
      // kind's surface; an audio-only tile opens the music player (v1.236/v1.246).
      const ctxParam = currentBrowseContextParam();
      const href = musicHrefForItem(item) || (kp ? kp.href : `/watch.html?v=${item.id}${ctxParam ? '&ctx=' + encodeURIComponent(ctxParam) : ''}`);
      const channelName = kp ? kp.uploaderLabel : resolveChannelName(item, folderSettings);
      // v1.376 W3 (R3): a media card's channel opens filtered to the card's own type.
      const channelHref = kp ? kp.uploaderHref : channelHrefForItem(`/?folder=${encodeURIComponent(item.folderName)}`, item);
      const chAv = (!kp && typeof modernCardAvatar === 'function')
        ? modernCardAvatar(channelName, item.channelAvatarUrl, typeof modernModeEnabled === 'function' && modernModeEnabled())
        : { kind: 'none' };
      const avatar = chAv.kind === 'img' ? { url: chAv.url } : (chAv.kind === 'mono' ? { url: null } : null);
      return buildVideoCardEl(item, { doc: document, href, channelName, channelHref, avatar });
    }

    // Replaces (or, with `append`, extends) the grid's cards. DOM nodes, never a
    // markup string: every card is built by buildVideoCardEl.
    function putCards(items, append) {
      const frag = document.createDocumentFragment();
      items.forEach((it) => frag.appendChild(buildCardEl(it)));
      if (append) videoGrid.appendChild(frag);
      else videoGrid.replaceChildren(frag);
      revealHomeArt(videoGrid, signal);
    }

    // Appends `items` as NEW cards at the tail of #video-grid - the existing
    // (already rendered) cards are never touched.
    function appendCardsToGrid(items) {
      if (!items || items.length === 0) return;
      putCards(items, true);
    }

    // renderItemCountBadge (common.js) only ever reads `.length` off
    // whatever `list` it's given (via its own countItems helper) -- a
    // sparse Array of the desired length is the simplest way to feed it the
    // server's authoritative filtered `currentTotal` (the TRUE count under
    // pagination -- `currentItems`/a rendered page is only ever a subset of
    // it) without changing common.js's existing list-shaped contract.
    function updateItemCountBadge() {
      renderItemCountBadge(videosHeader, new Array(Math.max(0, currentTotal)));
    }

    // Removes exactly one already-rendered card (by id) from the live DOM,
    // WITHOUT a server refetch/full re-render -- deleting an item is not one
    // of the "reset to page 0" actions (sort/format/search/shuffle change);
    // it just shrinks the currently-rendered set in place. Falls back to the
    // shared empty-state render once the grid has no cards left.
    function removeCardFromGrid(id) {
      const cards = videoGrid.querySelectorAll('.video-card[data-id]');
      for (let i = 0; i < cards.length; i++) {
        if (cards[i].getAttribute('data-id') === String(id)) { cards[i].remove(); break; }
      }
      if (!videoGrid.querySelector('.video-card')) {
        renderMediaGridPage([], { append: false });
      }
    }

    // Render folders in the sidebar. A folder flagged
    // folderSettings[path].hiddenFromSidebar (item 3, v1.14.0) is omitted from
    // this list -- it stays fully browsable via a direct /?root=<path> link,
    // this only controls whether a LINK to it is rendered here.
    //
    // Item 1 (v1.15.0), rewired in v1.76: also wires drag-to-reorder, now
    // through common.js's shared POINTER gesture layer rather than this
    // surface's own copy of the native HTML5 DnD wiring (which never fired on
    // touch at all). The home sidebar has no Save button, so a drop persists
    // IMMEDIATELY via POST /api/config. v1.339 S2 (T-C1): the drop is turned
    // into a path-anchored move (sidebarMoveAnchor), then
    // persistSidebarMoveByPath re-GETs the config at drop time, applies the
    // move by path onto THAT list (rebuildFullFolderOrder keeps a
    // hidden-from-sidebar or synthetic folder at its absolute position), and
    // POSTs it with the fresh folderSettings and `baseVersion`; the sidebar
    // then re-renders from the freshest GET (which also reflects the synthetic
    // Downloads folder's position-splice). This render's own `folders` /
    // `settings` are never POSTed back - they can be an init-time copy.
    //
    // The Setup page's up/down buttons are GONE as of v1.76 (they were the
    // thing Dean asked to be rid of); keyboard reorder lives on the drag
    // HANDLE of the two Settings lists that have one. This sidebar has no
    // handle and therefore still no keyboard reorder of its own -- see the
    // wireReorderable call below for why that is deliberate.
    function renderSidebarFolders(folders, settings = {}) {
      allFolders = Array.isArray(folders) ? folders : [];
      const visibleFolders = visibleSidebarFolders(folders, settings, syntheticFolderPaths);
      // v1.32 (Dean): the built-in Liked playlist entry -- fixed, first,
      // never draggable/reorderable (it isn't a db.folders row), active when
      // the ?liked=1 view is open. v1.33.1: no longer inlined -- applied via
      // common.js's count-gated applyLikedSidebarEntry (visible iff at least
      // one liked video exists), the SAME helper every other sidebar surface
      // now uses. It prepends without touching siblings, so the [data-index]
      // drag wiring below is unaffected.
      if (visibleFolders.length === 0) {
        sidebarFoldersList.innerHTML =
          '<div style="padding: 6px 24px; font-style: italic; color: var(--ink-2);">None</div>';
        applyLikedSidebarEntry(sidebarFoldersList, { active: likedFilter, watchLaterActive: watchLaterFilter });
        return;
      }
      sidebarFoldersList.innerHTML = visibleFolders.map((f, index) => {
        const folderName = f.split(/[\\/]/).pop() || f;
        const label = (settings[f] && settings[f].name) || folderName;
        const isActive = rootFilter === f ? 'active' : '';
        // ?root= shows everything under the mapped folder, including subfolders.
        // v1.77: the folder's chosen glyph (Dean's "change them out of a
        // pool"). resolveFolderGlyphClass only ever returns `icon-` + a known
        // registry id, so this interpolation cannot inject markup even if the
        // database were hand-edited; the server validates the same value
        // against the same registry on write.
        const glyphClass = resolveFolderGlyphClass(settings[f] && settings[f].glyph);
        return `
          <a href="/?root=${encodeURIComponent(f)}" class="sidebar-item ${isActive}" data-index="${index}" title="${escapeHtml(f)}">
            <i class="${glyphClass}"></i> ${escapeHtml(label)}
          </a>
        `;
      }).join('');
      applyLikedSidebarEntry(sidebarFoldersList, { active: likedFilter, watchLaterActive: watchLaterFilter });

      // v1.76: the shared POINTER gesture layer replaces this surface's own
      // copy of the native HTML5 DnD wiring -- which is why the sidebar can
      // now be reordered on a phone at all. The row selector is unchanged, so
      // the built-in Liked entry (prepended by applyLikedSidebarEntry, and
      // never a db.folders row) is still not a drag target.
      //
      // No `handleSelector`: these rows are <a> links with no grip, so the
      // whole row drags and no keyboard reorder is wired -- claiming
      // ArrowUp/ArrowDown here would break normal focus scrolling, and this
      // surface never had a keyboard reorder to preserve (the Setup page's
      // list is where that lives).
      //
      // This sidebar has no Save button, so a drop persists immediately -
      // v1.339 S2: by path onto the FRESH config (persistSidebarFolderOrder
      // below), never this render's copy (a hidden-from-sidebar or synthetic
      // folder keeps its absolute position; it never appears here to be
      // dragged).
      wireReorderable(sidebarFoldersList, {
        rowSelector: '.sidebar-item[data-index]',
        scrollContainer: document.getElementById('sidebar'),
        onReorder: async (fromIndex, toIndex) => {
          // v1.339 S2 (T-C1): the drop is recorded BY PATH and replayed onto
          // the config the server holds NOW - never `allFolders`/`settings`,
          // which are this render's copy (init-time, or the cached-home
          // restore's) and may lack a folder another device added since.
          const move = sidebarMoveAnchor(visibleFolders, fromIndex, toIndex);
          if (!move) return;
          await persistSidebarFolderOrder(move);
        },
        signal,
      });
    }

    // Persists a sidebar drag-and-drop reorder through common.js's
    // persistSidebarMoveByPath (v1.339 S2): a fresh GET /api/config at drop
    // time, the move applied by path onto THAT list, POSTed with the fresh
    // folderSettings and `baseVersion` (one retry on a 409). Whatever the
    // outcome - saved, conflicted twice, the dragged folder gone, an error -
    // the sidebar re-renders from the freshest config it read, so a stale
    // list is never left on screen to be dragged again.
    async function persistSidebarFolderOrder(move) {
      const outcome = await persistSidebarMoveByPath(move);
      const cfg = outcome.config;
      if (!cfg) return;
      folderSettings = cfg.folderSettings || {};
      syntheticFolderPaths = Array.isArray(cfg.syntheticFolders) ? cfg.syntheticFolders : [];
      renderSidebarFolders(cfg.folders || [], folderSettings);
    }

    // UI pass sweep S2 (F19): the library's ONE filter chip row (common.js
    // buildFilterChipRow). Its dimensions depend on the view:
    //   - a GLOBAL search (unified /api/search): the content TYPE only - sort,
    //     format and watch state do not apply to the server-ranked stream, so
    //     neither those chips nor the sort/shuffle tools show there;
    //   - everything else: format + watch state, plus the Titles/Channels scope
    //     on a folder/root-scoped search.
    // One tap = one reload (onChange reports every changed dimension at once).
    // The row's KIND - which dimensions it carries. v1.150's belt, kept: a
    // reused view DOM (the homeViewCache posture) must never keep a row of a
    // different kind (a search's type chips on a library view, or the reverse).
    function chipRowKind() { return isUnifiedSearch ? 'search' : ((searchQuery && !likedFilter && !watchLaterFilter) ? 'scoped-search' : 'library'); }
    function ensureLibraryChips() {
      if (!chipHost) return;
      const cur = chipHost.firstElementChild;
      if (cur && cur.getAttribute('data-kind') === chipRowKind()) return;
      mountLibraryChips();
    }
    // v1.376 W3: set (or, with null, drop) the view URL's `format=` without a history entry,
    // keeping the entry's router state (the v1.362 gate r1 A2 posture in the chip handler).
    function replaceViewFormatParam(value) {
      try {
        const u = new URL(window.location.href);
        if (value === null) u.searchParams.delete('format');
        else u.searchParams.set('format', value);
        const prev = history.state;
        history.replaceState(prev && typeof prev === 'object' ? Object.assign({}, prev, { url: u.pathname + u.search }) : prev, '', u);
      } catch (_) { /* URL/history quirk - the in-view state still drives the fetch */ }
    }
    // The filtered empty state's "Show all": this view shows every format (the URL keeps
    // `format=both`, so a reload or Back lands the same); the remembered filter is untouched.
    function showAllFormats() {
      viewFormatOverride = 'both';
      replaceViewFormatParam('both');
      mountLibraryChips();
      resetAndReload();
    }
    function mountLibraryChips() {
      if (!chipHost || typeof buildFilterChipRow !== 'function') return;
      const groups = [];
      if (isUnifiedSearch) {
        groups.push({ key: 'type', value: activeSearchType, all: 'all',
          options: SEARCH_TYPE_OPTIONS.map((o) => ({ value: o.chip, label: o.label })) });
      } else {
        groups.push({ key: 'format', value: activeFormatFilter(), all: 'both',
          options: FORMAT_TOGGLE_OPTIONS.map((o) => ({ value: o.mode, label: o.label })) });
        groups.push({ key: 'watch', value: getStoredWatchFilter(), all: 'all',
          options: WATCH_TOGGLE_OPTIONS.map((o) => ({ value: o.mode, label: o.label })) });
        if (searchQuery && !likedFilter && !watchLaterFilter) {
          groups.push({ key: 'scope', value: activeSearchScope, all: 'all',
            options: SEARCH_SCOPE_OPTIONS.map((o) => ({ value: o.mode, label: o.label })) });
        }
      }
      const row = buildFilterChipRow(groups, (changes) => {
        // The format chip is the REMEMBERED filter's own control: a tap writes it (as on
        // every view) and ends this visit's URL format (v1.376 W3), so the view and the
        // remembered filter agree again.
        if ('format' in changes) {
          setStoredFormatFilter(changes.format);
          if (viewFormatOverride !== null) { viewFormatOverride = null; replaceViewFormatParam(null); }
        }
        if ('watch' in changes) setStoredWatchFilter(changes.watch);
        // The search dimensions are URL state (replaceState keeps the deep link
        // shareable without a history entry per tap).
        const urlKey = ('type' in changes) ? ['type', 'type'] : (('scope' in changes) ? ['scope', 'searchIn'] : null);
        if ('type' in changes) activeSearchType = changes.type;
        if ('scope' in changes) activeSearchScope = changes.scope;
        if (urlKey) {
          try {
            const u = new URL(window.location.href);
            const v = changes[urlKey[0]];
            if (v === 'all') u.searchParams.delete(urlKey[1]);
            else u.searchParams.set(urlKey[1], v);
            // v1.362 gate r1 (A2): keep the entry's router state (depth, browseDepth - where a
            // minimized player lands), only the URL changes; a null state erased it.
            const prev = history.state;
            history.replaceState(prev && typeof prev === 'object' ? Object.assign({}, prev, { url: u.pathname + u.search }) : prev, '', u);
          } catch (_) { /* URL/history quirk - the in-view state still drives the fetch */ }
        }
        resetAndReload();
      }, { id: 'library-filter-chips', label: 'Filter the library' });
      row.setAttribute('data-kind', chipRowKind());
      chipHost.replaceChildren(row);
      if (sortBtn) sortBtn.hidden = isUnifiedSearch || watchLaterFilter; // the Watch later list keeps the user's own order
      if (playAllBtn) playAllBtn.hidden = !watchLaterFilter;
      if (isUnifiedSearch && shuffleAgainBtn) shuffleAgainBtn.hidden = true;
    }

    // Item 1 (v1.14.0): show/hide the "shuffle again" re-roll button to match
    // the current sort selection (visible only for `random`; never on a global
    // search, where sort does not apply).
    function updateShuffleButtonVisibility() {
      if (shuffleAgainBtn) shuffleAgainBtn.hidden = isUnifiedSearch || watchLaterFilter || !shouldShowShuffleButton(currentSort);
    }

    // Closes the open card menu (if any). Safe to call unconditionally: from a
    // full re-render (its card is about to be detached), a new menu, destroy().
    function closeCardMenu() {
      const c = openCardMenuCtrl;
      openCardMenuCtrl = null;
      if (c && typeof c.isOpen === 'function' && c.isOpen()) c.close();
    }
    teardownCardMenuFn = closeCardMenu;

    // v1.17.0 FR-3(b), T2: fires the SAME `DELETE /api/videos/:id` endpoint
    // the watch page's delete flow uses -- no new endpoint, no contract
    // change. `id` is the menu's own item id (the menu is built per card from
    // that card's item - never an index or a shared variable), so there is no id
    // mixup between cards. It runs ONLY after the Move to Trash confirm resolved
    // true (confirmAndDeleteCard). On a 409 (read-only/permission-denied mount, `{readOnly:true}`)
    // this surfaces an explanatory toast and stops -- it NEVER follows up
    // with `?removeAnyway=true` (that opt-in UI stays out of scope per the
    // design; only a path that has already seen a 409 may ever send it, and
    // this path never does). On success, the item is dropped from
    // `currentItems`/`currentTotal` and its card is removed from the DOM IN
    // PLACE (v1.30.0 T7: a delete is not a "reset to page 0" action -- see
    // removeCardFromGrid() -- so it never refetches/re-renders the rest of
    // the already-loaded pages) -- no `window.location.reload()`/full
    // navigation either.
    async function deleteCardById(id) {
      try {
        const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
        if (res.status === 409) {
          showToast('File is on a read-only location -- not deleted.');
          return;
        }
        if (res.status === 403) {
          // v1.81 write-RBAC: no capability -> plain message, card stays put.
          showToast("You don't have permission to delete library files.");
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (data.success) {
          currentItems = currentItems.filter((item) => item.id !== id);
          currentTotal = Math.max(0, currentTotal - 1);
          removeCardFromGrid(id);
          updateItemCountBadge();
          // v1.41.10 (QA gate): the server distinguishes a clean delete from a
          // file that could not actually be removed (held open / read-only) --
          // surfacing only "File deleted." for all of them hid every honest
          // message this API sends. Same three-way toast as watch.js's delete.
          showToast(deleteResultToast(data));
        } else {
          showToast('Error deleting file: ' + (data.error || 'unknown error'));
        }
      } catch (err) {
        console.error('Failed to delete video from card:', err);
        showToast('Network error occurred while trying to delete file.');
      }
    }

    // Renders one PAGE of media items. `{ append: false }` (the default --
    // page 0, a sort/format/search/shuffle reset, or the post-delete
    // fallback to the empty state) fully REPLACES the grid's children,
    // exactly like the old renderMediaGrid did. `{ append: true }` (every
    // subsequent page, fetched by the IntersectionObserver sentinel) instead
    // adds `items` as NEW cards at the tail via appendCardsToGrid -- it never
    // touches/re-renders the cards already on screen.
    function renderMediaGridPage(items, opts) {
      const append = !!(opts && opts.append);

      if (append) {
        appendCardsToGrid(items);
        return;
      }

      // A full replace detaches every card - a menu opened on one must not
      // outlive it.
      closeCardMenu();

      if (items.length === 0) {
        // Item 2 (v1.26.3): the shared, styled `.empty-state` card (replaces
        // the old bare inline-styled text) -- same "View All Media" escape
        // hatch as before (only shown for a search/folder view, never on an
        // already-unfiltered empty library, where there is nothing broader
        // to return to), now rendered as a real `.btn` via `actionHtml`.
        // v1.81 (Task 4): give every empty video view the same helpful intro
        // treatment books/podcasts already have - no blank surfaces. The copy
        // is context-aware: a search miss, an empty folder, or a genuinely
        // empty library each get their own message + hint.
        const actionHtml = (searchQuery || folderFilter)
          ? '<a href="/" class="ui-btn ui-btn--secondary ui-btn--md empty-state-action"><span class="ui-btn__label">View All Media</span></a>'
          : '';
        let emptyOpts;
        // v1.376 W3 (R3): an empty list while a format filter applies (the URL's or the
        // remembered one) says the FILTER emptied it, with a "Show all" that lifts the
        // filter for THIS view only (it never writes the remembered filter; the chip row
        // is that control). Before this, a remembered Audio filter on a video-only channel
        // read "This folder is empty." / "No videos or audio yet.".
        const emptyFormat = activeFormatFilter();
        if (searchQuery) {
          emptyOpts = { icon: 'search', message: 'No results found.', hint: 'Try a different search, or browse all your media.', actionHtml };
        } else if (emptyFormat === 'video' || emptyFormat === 'audio') {
          const isAudio = emptyFormat === 'audio';
          emptyOpts = {
            icon: isAudio ? 'music_note' : 'smart_display',
            message: isAudio ? 'No audio here.' : 'No videos here.',
            hint: `The ${isAudio ? 'Audio' : 'Videos'} filter is on.`,
            actionHtml: '<button type="button" class="ui-btn ui-btn--secondary ui-btn--md empty-state-action" data-format-show-all><span class="ui-btn__label">Show all</span></button>',
          };
        } else if (folderFilter) {
          emptyOpts = { icon: 'folder', message: 'This folder is empty.', hint: 'Nothing here yet - new files in this folder show up after a scan.', actionHtml };
        } else {
          emptyOpts = { icon: 'smart_display', message: 'No videos or audio yet.', hint: 'Files in your media folders show up here - with thumbnails, durations, and playback that picks up where you left off.' };
        }
        videoGrid.innerHTML = buildEmptyStateHtml(emptyOpts);
        const showAllBtn = videoGrid.querySelector('[data-format-show-all]');
        if (showAllBtn) showAllBtn.addEventListener('click', showAllFormats, { signal });
        return;
      }

      putCards(items, false);
    }

    // Local escape HTML helper
    function escapeHtml(text) {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Event Listeners
    // NOTE: the header search box's click/keydown listeners are shell-owned
    // (bound once at boot by common.js — see the C1 remediation comment
    // there), not wired per-view here.

    // The sort menu (UI pass sweep S2): a ui-btn icon that opens a ui.menu of
    // the sorts, the current one checked (D4.6: selected = a trailing check in
    // ink). Function DECLARATIONS (hoisted) so the async settings-default apply
    // above (applySortLabel) can call them.
    const SORT_MENU_OPTIONS = [
      { value: 'newest', label: 'Newest first' },
      { value: 'oldest', label: 'Oldest first' },
      { value: 'release-date', label: 'Release date' },
      { value: 'title-asc', label: 'Title (A-Z)' },
      { value: 'title-desc', label: 'Title (Z-A)' },
      { value: 'size-desc', label: 'Largest first' },
      { value: 'size-asc', label: 'Smallest first' },
      { value: 'random', label: 'Feeling lucky' },
    ];
    function applySortLabel(value) {
      // `value` can be an untrusted localStorage string: matched by equality,
      // never interpolated into a selector.
      const opt = SORT_MENU_OPTIONS.find((o) => o.value === value);
      if (sortBtn) sortBtn.setAttribute('aria-label', opt ? 'Sort: ' + opt.label : 'Sort');
    }
    function chooseSort(value) {
      if (!value || value === currentSort) return;
      currentSort = value;
      // v1.45.6 (Dean): when per-page sort is on, persist to THIS page's slot;
      // otherwise the global key (today's behavior). Same key used to read at init.
      if (perPageSortActive) setPerPageSort(sortPageKeyValue, currentSort);
      else localStorage.setItem('filetube_sort', currentSort);
      applySortLabel(currentSort);
      updateShuffleButtonVisibility();
      resetAndReload();
    }
    if (sortBtn) {
      applySortLabel(currentSort);
      updateShuffleButtonVisibility();
      sortBtn.addEventListener('click', () => {
        const u = cardUi();
        if (!u || typeof u.menu !== 'function') return;
        u.menu({
          title: 'Sort by',
          anchor: sortBtn,
          signal: shownViewSignal(), // gate r2: leaving the view closes it and frees the scroll lock
          items: SORT_MENU_OPTIONS.map((o) => ({ label: o.label, value: o.value, checked: o.value === currentSort })),
          onSelect: (value) => chooseSort(value),
        });
      }, { signal });
    }

    // "Shuffle again" re-roll (item 1, v1.14.0): re-randomizes the visible
    // order via a fresh server-side `seed` (v1.30.0 T7 -- random is now
    // server-authoritative, see resetAndReload()/fetchLibraryPage0()),
    // WITHOUT changing the selected sort or its persisted localStorage value.
    if (shuffleAgainBtn) {
      shuffleAgainBtn.addEventListener('click', () => {
        resetAndReload();
      }, { signal });
    }
    if (playAllBtn) {
      playAllBtn.addEventListener('click', () => {
        playAllBtn.disabled = true;
        Promise.resolve(playAllWatchLater()).finally(() => { playAllBtn.disabled = false; }); // common.js: the server feeds the queue in list order
      }, { signal });
    }

    // v1.30.0 T3 (AC2.3): `POST /api/scan` now acks with a 202
    // `{scanning, alreadyInProgress}` BEFORE the scan itself completes (see
    // server.js's T2, A2) -- there is no more `{success:true}` to branch on,
    // and the old `window.location.reload()` on completion is GONE. Instead,
    // any 202 (whether this click started a fresh scan OR simply joined one
    // already running -- `alreadyInProgress: true`, e.g. the periodic/boot
    // scan beat this click to it) goes straight into polling
    // `GET /api/scan-status`, keeping the button in its busy (spinner) state,
    // until `scanning` flips false -- then the grid refreshes IN PLACE via
    // `window.__filetubeRefreshLibrary` (the `loadLibrary` hook set up
    // below). This generalizes the v1.29 BUG-2 reload-never contract to scan
    // completion: this path must NEVER call `window.location.reload()` or
    // trigger any other full-page navigation.
    // v1.45.8: extracted so BOTH the Rescan button AND pull-to-refresh (below)
    // trigger the identical scan. The `disabled` guard makes a second trigger
    // (a pull while the button is already busy) a no-op.
    // v1.47.4 item 3 (Dean): the pull indicator's released-and-working state.
    // Declared before runRescan because runRescan drives them; the indicator
    // element itself is created further below, so these are only ever CALLED
    // later (after that assignment), never at definition time.
    function ptrBeginRefreshing() {
      if (!ptrIndicator || !ptrIndicator.isConnected) return;
      ptrIndicator.classList.add('refreshing');
      ptrIndicator.classList.remove('visible', 'ready');
      ptrIndicator.style.removeProperty('--ptr-pull');
    }
    function ptrEndRefreshing() {
      if (!ptrIndicator) return;
      ptrIndicator.classList.remove('refreshing');
    }

    // `fromPull` is passed ONLY by the pull gesture. The Rescan button keeps
    // its own busy spinner as its affordance and deliberately does not
    // raise the pull indicator (the button is right there, on-screen, saying
    // it). Note the button is wired through a wrapper below rather than
    // directly, so a click Event can never arrive here as `opts`.
    // The Rescan tool's in-flight state: `disabled` is the "already scanning"
    // flag the pull-to-refresh and the click both read; aria-busy shows the
    // ui-btn spinner (no label swap - the button is icon-only).
    function setRescanBusy(on) {
      rescanBtn.disabled = !!on;
      const u = cardUi();
      if (u && typeof u.setBusy === 'function') u.setBusy(rescanBtn, !!on);
      rescanBtn.setAttribute('aria-label', on ? 'Scanning files' : 'Rescan files');
    }

    async function runRescan(opts) {
      const fromPull = Boolean(opts && opts.fromPull === true);
      if (rescanBtn.disabled) {
        // A scan is already in flight (button-initiated, or an earlier pull).
        // The pull is a no-op for the SCAN itself, but the user still pulled
        // and deserves feedback -- and the in-flight poller below already owns
        // clearing this, so showing it here cannot strand the indicator.
        if (fromPull) ptrBeginRefreshing();
        return; // already scanning -- don't double-fire
      }
      if (fromPull) ptrBeginRefreshing();
      setRescanBusy(true);
      try {
        const res = await fetch('/api/scan', { method: 'POST' });
        if (!res.ok) {
          let data = {};
          try { data = await res.json(); } catch (_e) { /* no/invalid JSON body -- fall back to a generic message below */ }
          // v1.81 write-RBAC: a member without the capability gets 403 - a plain,
          // non-blocking message (the old blocking alert() was friction).
          showToast(res.status === 403
            ? "You don't have permission to rescan the library."
            : 'Failed to rescan: ' + (data.error || 'unknown error'));
          // Back to the resting Rescan state.
          setRescanBusy(false);
          // The scan never started, so nothing will ever poll it to completion
          // -- the indicator must come down here or it spins forever.
          ptrEndRefreshing();
          return;
        }
        pollRescanStatus();
      } catch (err) {
        console.error(err);
        showToast('Network error trigger scanner.');
        setRescanBusy(false);
        ptrEndRefreshing(); // same reasoning as the !res.ok path above
      }
    }
    // Wrapped rather than passed directly: as a bare listener the click Event
    // would arrive as `opts`, and a future `opts.fromPull`-adjacent field could
    // start reading properties off a DOM event.
    rescanBtn.addEventListener('click', () => runRescan(), { signal });

    // v1.45.8 (Dean): pull-to-refresh → rescan. Native-feeling on iOS by RIDING
    // the elastic top overscroll (we never preventDefault, so normal scrolling
    // + the iOS bounce are untouched — a deliberate contrast to the custom
    // mobile-video gesture layer that fought the OS). At the very top
    // (scrollY <= 0) a downward drag past PULL_REFRESH_THRESHOLD_PX arms it; on
    // release we fire runRescan(). A fixed indicator fades/rotates with the
    // pull. Touch-only by nature (touchstart never fires under a mouse), so it's
    // wired unconditionally and is simply inert on non-touch desktops.
    const PULL_REFRESH_THRESHOLD_PX = 70;
    const ptrIndicator = document.createElement('div');
    ptrIndicator.className = 'ptr-indicator';
    ptrIndicator.setAttribute('aria-hidden', 'true');
    ptrIndicator.innerHTML = '<i class="icon-refresh"></i>';
    root.appendChild(ptrIndicator);
    let ptrStartY = null;   // non-null only while a pull that began AT THE TOP is live
    let ptrStartX = null;   // v1.86.1: X at start, to reject horizontal-dominant drags
    let ptrArmed = false;
    function ptrReset() {
      ptrStartY = null;
      ptrStartX = null;
      ptrArmed = false;
      ptrIndicator.classList.remove('visible', 'ready');
      ptrIndicator.style.removeProperty('--ptr-pull');
    }
    window.addEventListener('touchstart', (e) => {
      // Only a single-finger drag that begins at the very top is a pull. The
      // `ptrIndicator.isConnected` guard is the load-bearing one (gate CRITICAL):
      // these listeners live on `window`, and leaving Home CACHES the view node
      // WITHOUT calling destroy() (homeViewCache contract) — so they stay bound
      // while the user is on /music etc. When Home is cached its #view-root (and
      // this indicator, a child of it) is detached → isConnected is false → the
      // whole pull path is inert off-Home, so a pull elsewhere can't fire a
      // rescan. When Home is the live view it's reconnected and active again.
      if (window.scrollY > 0 || rescanBtn.disabled || !ptrIndicator.isConnected || !e.touches || e.touches.length !== 1) { ptrStartY = null; return; }
      ptrStartY = e.touches[0].clientY;
      ptrStartX = e.touches[0].clientX;
      ptrArmed = false;
    }, { signal, passive: true });
    window.addEventListener('touchmove', (e) => {
      if (ptrStartY === null || !e.touches || e.touches.length !== 1) return;
      // A pull is only valid while still pinned at the top; any real upward
      // scroll (scrollY > 0) cancels it so a normal scroll never shows the UI.
      if (window.scrollY > 0) { ptrReset(); return; }
      const pull = e.touches[0].clientY - ptrStartY;
      // v1.86.1 (Dean): a HORIZONTAL-dominant drag is a horizontal-scroller swipe
      // (the avatar bar / chip row, both pinned at the top), NOT a pull - swiping
      // the subscriber circles was constantly flashing the rescan spinner. Lock
      // the pull out for the REST of this gesture (ptrReset nulls ptrStartY, so
      // every later touchmove bails at the guard above).
      if (pullIsHorizontalDrag(e.touches[0].clientX - ptrStartX, pull)) { ptrReset(); return; }
      // Dragged back to/above the start → DISARM (gate WARNING: else a release
      // here still ran the rescan) and hide, but keep tracking in case the
      // finger pulls down again in the same gesture.
      if (pull <= 0) { ptrArmed = false; ptrIndicator.classList.remove('visible', 'ready'); return; }
      const phase = pullRefreshState(pull, PULL_REFRESH_THRESHOLD_PX);
      ptrArmed = phase === 'ready';
      ptrIndicator.classList.add('visible');
      ptrIndicator.classList.toggle('ready', ptrArmed);
      // Clamp the visual travel so the glyph eases toward the threshold.
      ptrIndicator.style.setProperty('--ptr-pull', String(Math.min(pull, PULL_REFRESH_THRESHOLD_PX * 1.5)));
    }, { signal, passive: true });
    function ptrEnd() {
      // isConnected re-checked defensively (Home must be the live view to rescan).
      // v1.47.4 item 3: `fromPull` hands the indicator over to the
      // released-and-working state, and the ptrReset() below deliberately does
      // NOT clear `.refreshing` -- it only drops the pull-tracking classes
      // (`visible`/`ready`) and the now-meaningless --ptr-pull travel. That
      // hand-off is what keeps the spinner up for the whole scan instead of
      // dying the instant the finger lifts.
      if (ptrStartY !== null && ptrArmed && ptrIndicator.isConnected) runRescan({ fromPull: true });
      ptrReset();
    }
    window.addEventListener('touchend', ptrEnd, { signal, passive: true });
    window.addEventListener('touchcancel', ptrEnd, { signal, passive: true });

    // Non-redirecting `/api/scan-status` poller for the rescan button --
    // mirrors setup.js's `pollAutomationScanStatus()` shape/cadence (fetch ->
    // read `scanning` -> `setTimeout` re-poll at ~1s) rather than the OTHER
    // existing poller, setup.js's `pollScanStatus()`, which navigates to `/`
    // on completion and is exactly the full-reload behavior this task
    // removes. Torn-down-view-safe: bails out (no further polling, no stray
    // DOM writes) the moment `controller` is cleared/aborted by destroy(),
    // same guard setup.js's poller uses.
    function pollRescanStatus() {
      if (!controller || controller.signal.aborted) return;
      fetch('/api/scan-status')
        .then((r) => r.json())
        .then((s) => {
          if (!controller || controller.signal.aborted) return;
          if (s.scanning) {
            setTimeout(pollRescanStatus, 1000);
            return;
          }
          // Scan complete -- refresh the grid IN PLACE (never a reload).
          // Guarded since the hook is nulled on teardown (see destroy()).
          if (typeof window.__filetubeRefreshLibrary === 'function') {
            window.__filetubeRefreshLibrary();
          }
          setRescanBusy(false);
          // v1.47.4 item 3: the scan is genuinely finished AND the grid has been
          // refreshed above, so this is the honest moment to drop the pull
          // indicator -- not finger-release. Ordered after the refresh so the
          // spinner never comes down while stale rows are still on screen.
          ptrEndRefreshing();
        })
        .catch(() => {
          // Transient fetch failure while polling -- retry rather than
          // leaving the button stuck busy forever (mirrors
          // pollAutomationScanStatus's own retry-on-transient-failure
          // posture).
          if (!controller || controller.signal.aborted) return;
          setTimeout(pollRescanStatus, 1500);
        });
    }

    // UI pass sweep S2 (D8.5): the card action menu. ONE delegated kebab click
    // on #video-grid plus ONE FTInteraction.onActionMenu (long-press on touch,
    // right-click on desktop) on the grid - delegation covers a full replace and
    // an appended page with zero extra wiring. Every action reads the item from
    // THIS view's currentItems by the card's own data-id.
    function cardItemOf(card) {
      const id = card ? card.getAttribute('data-id') : null;
      return id == null ? null : (currentItems.find((it) => it && String(it.id) === id) || null);
    }

    // v1.72 (#94): the per-kind membership endpoints. Each kind's liked
    // carrier keeps its own route family (the existing lanes stay the write
    // authorities); a card button carries data-kind so the toggle dispatches
    // without inferring anything from the id.
    function cardLikeEndpoint(kind, id) {
      const encId = encodeURIComponent(id);
      if (kind === 'podcast') return '/api/podcasts/episodes/' + encId + '/liked';
      // M3 chapter likes (v1.317): a `<mediaId>::c<n>` chapter of a chaptered
      // audio file is liked in the MEDIA store (POST/DELETE /api/liked/:id) - the
      // music-native lane is ownTrack-gated and would strand the row on unlike.
      if (kind === 'track' && /::c\d+$/.test(String(id))) return '/api/liked/' + encId;
      if (kind === 'track') return '/api/music/liked/' + encId;
      if (kind === 'book') return '/api/books/liked/' + encId;
      return '/api/liked/' + encId;
    }
    // v1.40.0: the per-card Like toggle, NON-optimistic (the state flips only
    // after the request resolves). The item carries the state, so the next menu
    // reads Like/Unlike from it and a re-render rebuilds it correctly.
    async function toggleCardLike(item) {
      if (!item || !item.id) return;
      const currentlyLiked = item.liked === true;
      const kp = cardKindPresentation(item);
      try {
        const res = await fetch(cardLikeEndpoint(kp ? kp.kind : undefined, item.id), { method: currentlyLiked ? 'DELETE' : 'POST' });
        if (!res.ok) throw new Error('like request failed: ' + res.status);
        const data = await res.json().catch(() => ({}));
        item.liked = typeof data.liked === 'boolean' ? data.liked : !currentlyLiked;
        showToast(item.liked ? 'Added to Liked' : 'Removed from Liked');
      } catch (_) {
        showToast('Could not update Liked.'); // never fake success
      }
    }
    // v1.343 Watch later. On the list's own scope a removal also pulls the card (and the window
    // shrinks by one, the hide-from-feed bookkeeping); elsewhere it only flips the menu label.
    async function toggleCardWatchLater(card, item) {
      if (!item || !item.id) return;
      const snap = watchLaterSnapshot();
      const inList = watchLaterFilter || !!(snap && snap.has(String(item.id)));
      const now = await setWatchLater(item.id, !inList); // common.js: THE one verb, toasts the outcome
      if (now !== false || !watchLaterFilter) return;
      if (signal.aborted) return; // the view was left while the request ran
      if (card && card.isConnected) card.remove();
      if (currentItems.some((it) => String(it.id) === String(item.id))) {
        currentItems = currentItems.filter((it) => String(it.id) !== String(item.id));
        currentOffset -= 1;
        currentTotal -= 1;
      }
    }
    // Move to top: PUT the loaded window's ids with this one first. The server keeps any row the
    // window did not list (unloaded pages, another device's add) after them, so it never drops one.
    async function moveCardToTop(card, item) {
      if (!item || !item.id) return;
      const ids = [String(item.id), ...currentItems.map((it) => String(it.id)).filter((x) => x !== String(item.id))];
      try {
        const res = await fetch('/api/watch-later/order', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) throw new Error('reorder failed: ' + res.status);
        if (signal.aborted) return;
        currentItems = [item, ...currentItems.filter((it) => it !== item)];
        if (card && card.isConnected && card.parentNode) card.parentNode.insertBefore(card, card.parentNode.firstElementChild);
        showToast('Moved to top');
      } catch (_) {
        showToast('Could not reorder Watch later.');
      }
    }
    // v1.67: Reheat fires the SAME per-item endpoint as the watch page's flame
    // button, with the same status->toast vocabulary; progress surfaces in the
    // existing download status chip (no second progress mechanism).
    async function triggerCardReheat(item) {
      if (!item || !item.id) return;
      try {
        const res = await fetch(`/api/ytdlp/repull-metadata/item/${encodeURIComponent(item.id)}`, { method: 'POST' });
        const body = await res.json().catch(() => ({}));
        if (res.status === 202) { showToast('Reheating…'); return; }
        if (res.status === 409) { showToast('A reheat is already running.'); return; }
        if (res.status === 404) { showToast('This video has no source to reheat from.'); return; }
        if (res.status === 403) { showToast('Read-only mode: reheat is disabled on this instance.'); return; }
        showToast((body && body.error) || 'Reheat could not be started.');
      } catch (_) {
        showToast('Reheat could not be started.');
      }
    }

    // v1.97 "Hide from feed": optimistically pull the card, POST the prune, and
    // offer Undo (DELETE) via the toast. Pagination stays consistent: the loaded
    // window shrank by one, so drop currentOffset AND currentTotal by one. On any
    // failure the card is restored in place.
    function hideCardFromFeed(card, id) {
      if (!card || !id) return;
      const parent = card.parentNode;
      const anchor = card.nextSibling; // reinsertion point for a byte-identical undo
      const itemObj = currentItems.find((it) => String(it.id) === String(id));
      const restore = () => {
        if (parent) {
          if (anchor && anchor.parentNode === parent) parent.insertBefore(card, anchor);
          else parent.appendChild(card);
        }
        if (itemObj && !currentItems.some((it) => String(it.id) === String(id))) currentItems.push(itemObj);
        currentOffset += 1;
        currentTotal += 1;
      };
      card.remove();
      currentItems = currentItems.filter((it) => String(it.id) !== String(id));
      currentOffset -= 1;
      currentTotal -= 1;
      fetch('/api/feed-hidden/' + encodeURIComponent(id), { method: 'POST' })
        .then((res) => {
          if (!res.ok) throw new Error('hide failed');
          showToast('Hidden from feed', {
            label: 'Undo',
            onAction: () => {
              fetch('/api/feed-hidden/' + encodeURIComponent(id), { method: 'DELETE' })
                .then((r) => { if (!r.ok) throw new Error('undo failed'); restore(); })
                .catch(() => showToast('Could not restore to feed.'));
            },
          });
        })
        .catch(() => { restore(); showToast('Could not hide from feed.'); });
    }

    // Save to device: the /video/:id?download=1 route (or the kind's own), the
    // server's Content-Disposition names the file. A transient <a download>
    // (never a navigation: the SPA router does not route a ?download=1 href).
    function saveCardToDevice(item) {
      const href = cardDownloadHref(item);
      if (!href) return;
      const a = document.createElement('a');
      a.href = href;
      a.setAttribute('download', cardKindPresentation(item) ? '' : buildCardDownloadFilename(item.title, item.ext));
      a.hidden = true;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    // DELETE IS DESTRUCTIVE (LESSONS 9): the ONLY path to the delete request.
    // It asks ui.confirm with copy that says what DELETE /api/videos/:id does
    // (cardDeleteConfirmCopy: a move to Trash) and calls deleteCardById only
    // when the confirm resolves exactly true - Cancel, Esc, the scrim, Close and
    // a missing ui all resolve to no delete.
    // The router's SHOWN-view signal, read when a surface opens (this view's own `signal`
    // outside the router, e.g. a unit harness). Gate r2: every menu or confirm a card or the
    // sort button opens is bound to it, or it stays up over the next view and still acts.
    function shownViewSignal() {
      const ft = window.FileTube;
      return (ft && typeof ft.viewSignal === 'function') ? ft.viewSignal() : signal;
    }

    // Gate r1 (adversary 3): the confirm is bound to the router's SHOWN-view signal, read now.
    // This view is CACHED on nav-away and its own `signal` never fires then, so a confirm bound
    // only to it stayed open over the next view and its OK still deleted; viewSignal() aborts
    // the moment the user leaves, which dismisses the dialog (resolving false).
    async function confirmAndDeleteCard(item) {
      if (!item || !item.id) return;
      const u = cardUi();
      if (!u || typeof u.confirm !== 'function') return;
      const shown = shownViewSignal();
      const ok = await u.confirm(Object.assign({}, cardDeleteConfirmCopy(item), { signal: shown }));
      if (ok !== true) return;
      if (shown.aborted || signal.aborted) return;
      deleteCardById(item.id);
    }

    // Items whose transcript is loading (see runCardAction's transcript arm).
    const transcriptBusy = new Set();
    fetchWatchLaterIds(true); // v1.343: re-read the membership per view mount (a finish removes server side) so the card menu's first open shows the right label

    // Runs one menu action for one card's item.
    function runCardAction(action, card, item) {
      if (!item) return;
      if (action === 'queue') {
        const kp = cardKindPresentation(item);
        addToQueue(item.id, undefined, kp ? kp.kind : undefined); // common.js: THE one queue verb
      } else if (action === 'like') {
        toggleCardLike(item);
      } else if (action === 'share') {
        const url = cardShareUrl(item);
        if (!url) return;
        shareExternalUrl(url, item.title).then((outcome) => {
          if (outcome === 'copied') showToast('Link copied');
          if (outcome === 'copy-failed' || outcome === 'unavailable') showToast('Could not share the link.');
        });
      } else if (action === 'download') {
        saveCardToDevice(item);
      } else if (action === 'transcript') {
        // v1.203: the watch page's own transcript flow. This view is CACHED on
        // nav-away (its signal never fires), so the card answers "am I still on
        // screen" when the text lands - a detached grid opens nothing. While
        // the text loads the item is busy: choosing Transcript again is a
        // no-op (the v1.203 corner disabled itself; one fetch, one modal).
        if (transcriptBusy.has(item.id)) return;
        openTranscriptFor({
          id: item.id, title: item.title, signal,
          onBusy: (busy) => { if (busy) transcriptBusy.add(item.id); else transcriptBusy.delete(item.id); },
          stillWanted: () => card.isConnected,
        });
      } else if (action === 'reheat') {
        triggerCardReheat(item);
      } else if (action === 'watchlater') {
        toggleCardWatchLater(card, item);
      } else if (action === 'watchlater-top') {
        moveCardToTop(card, item);
      } else if (action === 'feedhide') {
        hideCardFromFeed(card, item.id);
      } else if (action === 'delete') {
        confirmAndDeleteCard(item);
      }
    }

    // Opens the action menu for `card`. `anchor` = the kebab, or a point
    // ({ x, y }) for a long-press / right-click.
    function openCardMenu(card, anchor) {
      const item = cardItemOf(card);
      const u = cardUi();
      if (!item || !u || typeof u.menu !== 'function') return;
      const wlSnap = watchLaterSnapshot();
      const entries = buildCardMenuItems(item, cardCaps, {
        feedHideable: modernMode,
        watchLater: watchLaterFilter || !!(wlSnap && wlSnap.has(String(item.id))),
        watchLaterTop: watchLaterFilter && currentItems.length > 1 && currentItems[0] !== item,
      });
      if (!entries.length) return;
      closeCardMenu();
      const anchorEl = anchor && anchor.nodeType ? anchor
        : { getBoundingClientRect: () => ({ left: anchor ? anchor.x : 0, bottom: anchor ? anchor.y : 0 }) };
      openCardMenuCtrl = u.menu({
        title: item.title || 'Actions',
        anchor: anchorEl,
        signal: shownViewSignal(), // gate r2: leaving the view closes it (home is cached, never aborted)
        items: entries.map((en) => ({
          icon: en.icon,
          label: en.label,
          danger: !!en.danger,
          value: en.id,
          onSelect: () => runCardAction(en.id, card, item),
        })),
        onClose: () => { openCardMenuCtrl = null; },
      });
    }

    videoGrid.addEventListener('click', (e) => {
      const kebab = e.target && e.target.closest ? e.target.closest('.card-kebab') : null;
      if (!kebab) return;
      e.preventDefault();
      openCardMenu(kebab.closest('.video-card'), kebab);
    }, { signal });

    // Long-press (touch) and right-click (desktop) on a card open the SAME menu
    // (D6; interaction.js owns the gesture and the contextmenu listener).
    const FTI = (typeof window !== 'undefined' && window.FTInteraction) || null;
    if (FTI && typeof FTI.onActionMenu === 'function') {
      const offActionMenu = FTI.onActionMenu(videoGrid, (e, pt) => {
        const card = e && e.target && e.target.closest ? e.target.closest('.video-card') : null;
        if (!card || card.classList.contains('skeleton-card')) return;
        openCardMenu(card, pt);
      });
      signal.addEventListener('abort', offActionMenu, { once: true });
    }

    // v1.117 (Dean bug): the desktop-sidebar pin render moved to common.js's
    // shell-level DOMContentLoaded boot (it runs on EVERY page, not just here +
    // watch.js, so pins no longer vanish on Stats/Music/History/etc.). This
    // home-only boot call is retired; the pinned section still renders on the
    // home page via that shared owner (and re-renders on unpin/reorder via
    // refreshAllPinSurfaces, unchanged).

    // v1.37.0 T10 (books): the home book surfaces. BARE home view -> a
    // 'Continue reading' row above the grid; SEARCH view -> a 'Books'
    // section above the video results. Both fetch-and-forget: any failure
    // (or a books-less install's empty list) renders NOTHING and the home
    // page stays byte-identical.
    const booksRowHost = document.createElement('div');
    // v1.79: in feed mode the server-assembled feed carries its own continue-*
    // rows, so the client-side continue-rows injection is skipped entirely.
    // v1.84: modern mode is one flat grid (its Continue-watching chip covers
    // resume), so its home skips the injected continue rows too.
    if (videoGrid && videoGrid.parentElement && !feedMode && !modernMode) {
      videoGrid.insertAdjacentElement('beforebegin', booksRowHost);
      const bareHome = !searchQuery && !folderFilter && !rootFilter && !likedFilter && !watchLaterFilter;
      if (bareHome) {
        // v1.72 (cap 5): the videos "Continue watching" row sits FIRST -
        // videos are the reference kind, and their in-progress items now get
        // the same home resume surface every other kind already had. Same
        // rules as the rows below: toggleable, empty selection renders
        // NOTHING.
        // v1.157 (P1): each Continue row reserves a shape-matched skeleton
        // before its fetch (gated on a per-row last-known flag) so the grid no
        // longer jumps down as the rows arrive -- see hydrateHomeRow.
        const videosRowHost = document.createElement('div');
        booksRowHost.insertAdjacentElement('beforebegin', videosRowHost);
        if (homeRowEnabled('ft-home-continue-watching')) {
          hydrateHomeRow(videosRowHost, 'watching', () =>
            fetch(`/api/videos?filter=recent-watching&limit=${HOME_ROW_CAP}`)
              .then((r) => (r.ok ? r.json() : { items: [] }))
              // No See-all href: the watched-state filter is a stored toolbar
              // pref, not a URL scope - a ?watch= link would silently no-op
              // (the v1.68.1 bystander-artifact lesson).
              .then((data) => buildVideoHomeSectionHtml(data.items, 'Continue watching', '')),
          buildHomeRowSkeleton('video', HOME_ROW_CAP));
        }
        // v1.73 (Dean ruling 1): ONE merged "Continue listening" host sits
        // ABOVE the books one - music tracks + podcast episodes interleaved by
        // recency. One toggle governs it; a device where EITHER pre-v1.73
        // toggle was on shows the row (both-off stays off - the retired
        // podcasts key is still READ for that migration).
        const listeningRowHost = document.createElement('div');
        booksRowHost.insertAdjacentElement('beforebegin', listeningRowHost);
        // Gate C1: fold the retired key ONCE, then the ONE key governs.
        migrateListeningRowPref();
        if (homeRowEnabled('ft-home-continue-listening')) {
          hydrateHomeRow(listeningRowHost, 'listening', () =>
            Promise.all([
              fetch(`/api/music?filter=recent-listening&limit=${HOME_ROW_CAP}`).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
              fetch(`/api/podcasts/episodes?filter=recent-listening&limit=${HOME_ROW_CAP}`).then((r) => (r.ok ? r.json() : { episodes: [] })).catch(() => ({ episodes: [] })),
            ]).then(([music, pods]) => buildListeningHomeSectionHtml(music.items, pods.episodes, 'Continue listening')),
          buildHomeRowSkeleton('music', HOME_ROW_CAP));
        }
        if (homeRowEnabled('ft-home-continue-reading')) {
          hydrateHomeRow(booksRowHost, 'reading', () =>
            fetch(`/api/books?filter=reading&limit=${HOME_ROW_CAP}`)
              .then((r) => (r.ok ? r.json() : { items: [] }))
              .then((data) => buildBooksHomeSectionHtml(data.items, 'Continue reading', '/books')),
          buildHomeRowSkeleton('book', HOME_ROW_CAP));
        }
      } else if (searchQuery) {
        fetch('/api/books?search=' + encodeURIComponent(searchQuery) + '&limit=12')
          .then((r) => (r.ok ? r.json() : { items: [] }))
          .then((data) => {
            booksRowHost.innerHTML = buildBooksHomeSectionHtml(
              data.items,
              'Books',
              '/books?search=' + encodeURIComponent(searchQuery),
            );
            revealHomeArt(booksRowHost, signal);
          })
          .catch(() => { booksRowHost.innerHTML = ''; });
      }
    }

    // v1.29.0 T8 (R2.3/R2.4, AC4.3/AC4.4): expose THIS instance's own
    // loadLibrary() as the corner chip's in-place library-refresh hook (see
    // public/js/common.js's injectDownloadStatusChip -- fires exactly once
    // per one-shot job as it transitions into 'done', never a page reload).
    // Home page ONLY: loadLibrary is a page-local closure that exists only
    // inside this view's init(), so no other view ever sets this global --
    // the chip's own call site is typeof-guarded and is a safe no-op on any
    // other page/tab.
    window.__filetubeRefreshLibrary = loadLibrary;

    // Start initialization
    loadLibrary();
  }

  function destroy() {
    if (controller) {
      controller.abort();
      controller = null;
    }
    if (typeof teardownCardMenuFn === 'function') teardownCardMenuFn();
    teardownCardMenuFn = null;
    if (typeof disconnectGridSentinelFn === 'function') disconnectGridSentinelFn();
    disconnectGridSentinelFn = null;
    restoreSidebarFn = null;
    // GF1 (post-gate QA suggestion, folded in as trivial): init() exposes
    // window.__filetubeRefreshLibrary = loadLibrary (see init(), above) but
    // nothing previously cleared it on teardown -- a stale reference to a
    // torn-down instance's closure would otherwise linger indefinitely.
    // Harmless today (only home ever sets it, and common.js's call site is
    // typeof-guarded), but a real leak worth closing while touching this
    // file. `loadLibrary` is scoped inside init(), not reachable here, so
    // this clears unconditionally rather than by identity -- there is only
    // ever one live home instance at a time.
    if (typeof window !== 'undefined') {
      window.__filetubeRefreshLibrary = null;
    }
  }

  // C3 remediation (v1.16.0): called by common.js's `restoreHomeFromCache`
  // right after it reattaches this cached instance's `#view-root` node --
  // #sidebar-folders-list lives OUTSIDE that node (in the persistent shell),
  // so a plain reattach leaves it exactly as whichever OTHER view rendered it
  // last (e.g. watch.js's plain non-draggable links) unless something
  // re-renders it back to home's draggable + active-highlighted markup. This
  // re-runs the SAME per-instance `renderSidebarFolders` this instance's own
  // `init()` already uses (not a fresh init(), not a new AbortController) --
  // it just replaces #sidebar-folders-list's innerHTML and re-binds its own
  // drag listeners on the (still-live, never-aborted) cached instance's
  // `signal`, exactly like `persistSidebarFolderOrder` already does after a
  // reorder. No-op if this instance was destroyed (torn down) since it was
  // cached, which should never happen for a live cache entry but is guarded
  // defensively regardless.
  function restoreSidebar() {
    if (typeof restoreSidebarFn === 'function') {
      try { restoreSidebarFn(); } catch (err) { console.error('Failed to restore home sidebar from cache', err); }
    }
  }

  if (typeof window !== 'undefined' && window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('home', { init, destroy, restoreSidebar });
  }
})();
