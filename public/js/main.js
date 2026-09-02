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
// contract this view must keep honoring. T2's card trash-can arm/disarm now
// adds a `document` click/scroll listener (still AbortSignal-bound to the
// SAME per-instance controller, so it is still cleaned up exactly once by
// destroy()) plus a plain (non-Signal) ~3s `setTimeout` for the auto-disarm,
// which `destroy()` now explicitly clears via `disarmCardDeleteFn` -- see
// that comment below. Both are deliberately harmless while this view is
// CACHED-but-not-destroyed (a no-op state reset against an already-detached
// node), matching the design's "disarm on any document click/scroll" intent.
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
// Returned RAW (not HTML-escaped) -- callers building an HTML attribute
// string must escape it themselves, exactly like this file's other
// interpolated attribute values (v1.67: the one caller is the corner
// renderer, which escapes via module-scope `escapeBookRowHtml`).
function buildCardDownloadFilename(title, ext) {
  return `${title || 'download'}${ext || ''}`;
}

// buildSkeletonGrid (Item 1, v1.26.3): `n` lightweight `.video-card`-shaped
// loading placeholders, rendered into `#video-grid` BEFORE the
// `/api/config`+`/api/videos` fetch chain in `loadLibrary()` settles --
// replaces the old "ships empty, pops the whole grid in at once" blank
// window. Each skeleton card matches the REAL card's box model exactly
// (`.thumbnail-container`'s 16/9 aspect-ratio + border-radius, `.video-info`'s
// padding, two text-line placeholders roughly matching the title/meta line
// heights) so swapping skeleton markup for real card markup produces zero
// layout shift. `aria-hidden="true"` on every skeleton card since it carries
// no real content for assistive tech to announce. Pure (string-building
// only, no DOM/timer) -- the shimmer motion itself is CSS-only
// (`.skeleton-shimmer`, prefers-reduced-motion honored -- see style.css).
// Exported for node:test.
function buildSkeletonGrid(n) {
  const count = Number.isInteger(n) && n > 0 ? n : 0;
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="video-card skeleton-card" aria-hidden="true">
        <div class="card-media"><div class="thumbnail-container skeleton-shimmer"></div></div>
        <div class="video-info">
          <div class="skeleton-line skeleton-line-title skeleton-shimmer"></div>
          <div class="skeleton-line skeleton-line-meta skeleton-shimmer"></div>
        </div>
      </div>
    `;
  }
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
const SIDEBAR_NONE_HTML = '<div style="padding: 6px 24px; font-style: italic; color: var(--text-secondary);">None</div>';

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
// escapeHtml discipline matches buildCardHtml's (attribute + text escapes).
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
      <span class="book-row-cover"><img src="/bookcover/${encodeURIComponent(item.id)}" alt="" loading="lazy" />${bar}</span>
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
function buildMusicRowCardHtml(item) {
  // Deep-link to the specific track so /music resumes it (consuming the
  // per-user resume pointer), mirroring the books row's /read.html?b=<id>.
  return `
    <a class="book-row-card music-row-card" href="/music?play=${encodeURIComponent(item.id)}" title="${escapeBookRowHtml(item.title)}">
      <span class="book-row-cover music-row-cover"><img src="/albumart/${encodeURIComponent(item.id)}" alt="" loading="lazy" /></span>
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
      <span class="book-row-cover music-row-cover"><img src="/podcastart/${encodeURIComponent(ep.subId)}" alt="" loading="lazy" /></span>
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
      <span class="book-row-cover video-row-cover"><img src="/thumbnail/${encodeURIComponent(item.id)}" alt="" loading="lazy" />${bar}</span>
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
      <span class="book-row-cover video-row-cover"><img src="${escapeBookRowHtml(item.thumbnailUrl)}" alt="" loading="lazy" />${bar}</span>
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
function hydrateHomeRow(host, seenId, fetcher, skeletonHtml) {
  if (!host) return;
  const seenKey = 'ft-home-row-seen:' + seenId;
  let hadItems = false;
  try { hadItems = localStorage.getItem(seenKey) === '1'; } catch { hadItems = false; }
  if (hadItems && skeletonHtml) host.innerHTML = skeletonHtml;
  fetcher()
    .then((html) => {
      host.innerHTML = html || '';
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

function buildModernChipRowHtml(active) {
  const a = typeof resolveModernChip === 'function' ? resolveModernChip(active) : 'all';
  const chips = MODERN_CHIPS.map((c) => {
    const on = c.filter === a;
    return `<button type="button" class="modern-chip${on ? ' active' : ''}" role="tab" aria-selected="${on}" data-chip="${c.filter}">${c.label}</button>`;
  }).join('');
  return `<div class="modern-chip-row" role="tablist" aria-label="Filter the home feed">${chips}</div>`;
}
// v1.99 shimmer sweep (Dean's device report): the avatar bar sits ABOVE the chip
// row and used to ship `hidden`, then POP IN after /api/channels resolved -
// shoving the chips + grid down a beat late (the "top flow flickers / has more or
// less"). To reveal-once WITHOUT a reverse-shift, persist the last-known chip
// count and, on the next load, RESERVE the strip with that many shimmer chips
// before the fetch (the v1.53 capability-cache pattern). buildAvatarBarSkeleton
// is a pure builder (the buildSkeletonGrid contract) reusing the REAL
// `.modern-avatar-chip` / `.modern-avatar-circle` (56px disc) box, so the swap to
// real chips is zero-shift.
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
      + '<span class="modern-avatar-circle skeleton-shimmer"></span>'
      + '<span class="skeleton-line skeleton-line-meta skeleton-shimmer"></span>'
      + '</span>';
  }
  return html;
}

// v1.84 T4: the mobile recent-uploader subscription bar. Built as DOM (not an
// HTML string) so the generated monogram colour is applied via
// `.style.backgroundColor` (a runtime palette value - census-safe, the same way
// buildAccountAvatarEl does it). Empty -> the bar stays hidden (no empty strip).
function populateModernAvatarBar(barEl, channels) {
  if (!barEl) return;
  barEl.textContent = '';
  if (!Array.isArray(channels) || channels.length === 0) {
    writeModernAvatarBarCount(0); // v1.99: remember "none" so next load reserves nothing (no reverse-shift)
    barEl.hidden = true;
    return;
  }
  writeModernAvatarBarCount(channels.length); // v1.99: reserve this many on the next load
  for (const c of channels) {
    const a = document.createElement('a');
    a.className = 'modern-avatar-chip';
    a.href = `/?folder=${encodeURIComponent(c.folder)}`;
    a.title = c.name;
    const circle = document.createElement('span');
    circle.className = 'modern-avatar-circle';
    const src = (typeof resolveAvatarSource === 'function') ? resolveAvatarSource(c.name, c.avatarUrl) : { type: 'generated', glyph: '?', color: '#888' };
    if (src.type === 'url') {
      const img = document.createElement('img');
      img.src = src.url; img.alt = ''; img.loading = 'lazy'; img.className = 'art-shimmer';
      circle.appendChild(img);
    } else {
      circle.textContent = src.glyph;
      circle.style.backgroundColor = src.color; // runtime palette value (census-safe)
    }
    const name = document.createElement('span');
    name.className = 'modern-avatar-name';
    name.textContent = c.name;
    a.appendChild(circle);
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
  return `<div class="home-feed-empty">${msgs[filter] || msgs.all}</div>`;
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
      host.innerHTML = '<div class="home-feed-empty">Nothing here yet - start watching and your feed fills in.</div>';
      return;
    }
    host.innerHTML = rows.map(buildFeedRowHtml).join('');
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    // QA gate SUGGESTION: feed mode hides the classic grid, so a thrown fetch
    // error must not leave a fully blank home - render a message with the way
    // back to the classic grid, never an empty surface.
    host.innerHTML = '<div class="home-feed-empty">Could not load your home feed. Try again, or switch to the classic grid in Settings.</div>';
  }
}

// ---- v1.67: the card-corner renderer (plan D3) ------------------------------
//
// ONE module-scope, exported, pure renderer for the FOUR assignable card
// corners. Position comes from the `.card-corner-tl/tr/bl/br` classes;
// identity/look/behavior stay on the control classes (`.card-delete-btn`
// etc.), so the delete arm state machine and every delegated click handler
// keep keying off the control class unchanged wherever the control lands.
// Never copy this renderer (the v1.41.4 every-writer scar) - buildCardHtml is
// its one caller.
//
// v1.204 (Dean): the bottom-right corner became SELECTABLE too. It SHARES the
// bottom-right with the duration badge: when the BR slot renders a real button
// the badge shifts LEFT to sit beside it (buildCardCorners returns brOccupied,
// which buildCardHtml turns into `.duration-badge--beside-corner`); when BR is
// unassigned or its control does not apply, the badge stays pinned in its home
// and nothing changes. BR defaults to 'none', so no existing card moves.

const CARD_CORNER_KEYS = [
  ['cornerTL', 'card-corner-tl'],
  ['cornerTR', 'card-corner-tr'],
  ['cornerBL', 'card-corner-bl'],
  ['cornerBR', 'card-corner-br'], // v1.204: shares bottom-right with the duration badge
];

// C5: the defaults reproduce today's layout so nobody's muscle memory breaks.
// Queue is deliberately UNASSIGNED by default; the bottom-right slot (v1.204)
// is 'none' by default too, so the duration badge keeps its home until a user
// opts a control into that corner.
const CARD_CORNER_DEFAULTS = { cornerTL: 'download', cornerTR: 'delete', cornerBL: 'like', cornerBR: 'none' };

const CARD_CORNER_CONTROLS = ['download', 'delete', 'like', 'queue', 'share', 'reheat', 'transcript']; // v1.203: + transcript (Dean)

// Settings object (from GET /api/auth/me, or nothing) -> the resolved
// four-corner layout. The server lane is SHAPE-only (plan D1), so THIS is
// where garbage defends: an unknown value falls back to that corner's C5
// default (the starRatings garbage-tolerance precedent); `none` is an
// explicit empty corner and survives as-is.
function resolveCardCornerPrefs(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const out = {};
  for (const [key] of CARD_CORNER_KEYS) {
    const v = s[key];
    out[key] = (v === 'none' || CARD_CORNER_CONTROLS.includes(v)) ? v : CARD_CORNER_DEFAULTS[key];
  }
  return out;
}

// One corner control's markup, or '' when the control does not apply to this
// item (C4: an inapplicable corner renders NOTHING, never a substitute).
// Attribute shapes are byte-compatible with the pre-v1.67 inline template
// (plus the appended corner class) so every delegated handler and CSS state
// rule keeps matching.
// v1.72 (#94): the kind dispatch for a mixed-kind Liked card. A shaped
// non-media item (kind 'podcast' | 'track', 'book' rides the books commit)
// renders through the SAME video-card markup and classes - only the
// destination, art route, byline and applicable corner controls differ.
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
  // routes), so downloadHref is '' (the download arm skips an empty href) and
  // likeable:false suppresses the like corner.
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

function buildCardCornerControlHtml(control, cornerClass, item, caps) {
  const id = escapeBookRowHtml(item.id);
  const kp = cardKindPresentation(item);
  const kindAttr = kp ? ` data-kind="${escapeBookRowHtml(kp.kind)}"` : '';
  switch (control) {
    case 'download':
      // A non-media save rides its kind's ?download=1 route; the server's
      // Content-Disposition names the file, so the download attr is bare.
      if (kp) {
        // v1.205: a kind with no card-download route (TV) renders nothing here.
        if (!kp.downloadHref) return '';
        return `<a class="card-download-btn ${cornerClass}" href="${escapeBookRowHtml(kp.downloadHref)}" download aria-label="Save to device" title="Save to device">
              <i class="icon-download"></i>
            </a>`;
      }
      return `<a class="card-download-btn ${cornerClass}" href="${buildCardDownloadHref(item.id)}" download="${escapeBookRowHtml(buildCardDownloadFilename(item.title, item.ext))}" aria-label="Save to device" title="Save to device">
              <i class="icon-download"></i>
            </a>`;
    case 'delete':
      if (kp) return ''; // the card delete verb is DELETE /api/videos/:id - media only
      // v1.81 write-RBAC: a member without the modify-library capability cannot
      // delete - hide the affordance (the server is the real gate; this only
      // spares them a button that always 403s). Admin's effective cap is true.
      if (!caps || caps.canModifyLibrary !== true) return '';
      return `<button type="button" class="card-delete-btn ${cornerClass}" data-id="${id}" aria-label="Delete this video">
              <i class="icon-delete"></i><span class="card-delete-confirm">Sure?</span>
            </button>`;
    case 'like':
      // v1.205: a kind with no like route (TV) renders nothing here.
      if (kp && kp.likeable === false) return '';
      return `<button type="button" class="card-like-btn${item.liked ? ' liked' : ''} ${cornerClass}" data-id="${id}"${kindAttr} aria-label="${item.liked ? 'Unlike' : 'Like'}" aria-pressed="${item.liked ? 'true' : 'false'}" title="Like">
              <i class="icon-heart"></i>
            </button>`;
    case 'queue':
      if (kp && !kp.canQueue) return '';
      return `<button type="button" class="card-queue-btn ${cornerClass}" data-id="${id}"${kindAttr} aria-label="Add to queue" title="Add to queue">
              <i class="icon-queue"></i>
            </button>`;
    case 'share':
      // Applies only when the server derived an original link (C4); the URL
      // is the SERVER-resolved field, never re-approximated from the raw
      // youtubeId client-side (the v1.52 lesson).
      if (typeof item.watchUrl !== 'string' || item.watchUrl === '') return '';
      return `<button type="button" class="card-share-btn ${cornerClass}" data-id="${id}" data-share-url="${escapeBookRowHtml(item.watchUrl)}" aria-label="Share the original YouTube link" title="Share">
              <i class="icon-share"></i>
            </button>`;
    case 'transcript':
      // v1.203 (Dean: "add the transcript button as a selectable option for
      // a given card ... from a card view maybe send a video along to an
      // AI"). Applies only when the item HAS captions (`hasSubtitles`, the
      // scan's sidecar detection) - exactly Share's only-when-it-applies
      // posture. The click runs the SAME flow as the watch page's button
      // (common.js openTranscriptFor): desktop modal, phone picker with
      // Share / Copy / Share with AI.
      if (kp) return '';
      if (item.hasSubtitles !== true) return '';
      return `<button type="button" class="card-transcript-btn ${cornerClass}" data-id="${id}" aria-label="Transcript: read, copy or share the captions as text" title="Transcript">
              <i class="icon-transcript"></i>
            </button>`;
    case 'reheat':
      // Applies only when the yt-dlp module capability is affirmatively
      // enabled (=== true, matching the watch page's module-health gate).
      // Never on a non-media card - the repull endpoint is a media verb.
      if (kp) return '';
      if (!caps || caps.reheatEnabled !== true) return '';
      return `<button type="button" class="card-reheat-btn ${cornerClass}" data-id="${id}" aria-label="Reheat this video's metadata" title="Reheat">
              <i class="icon-flame"></i>
            </button>`;
    default:
      return '';
  }
}

// The four corners' combined markup PLUS whether the bottom-right slot
// actually rendered a button (brOccupied) - the one signal buildCardHtml
// needs to shift the duration badge left. Dedupe (plan D5): the editor
// enforces C2, but a direct POST /api/me/settings can assign one control to
// two corners - the FIRST assignment (TL > TR > BL > BR) wins and later
// duplicates render nothing. Deduped by ASSIGNMENT, not render outcome:
// applicability is uniform per item, so an inapplicable duplicate is empty
// either way and assignment-order keeps the rule deterministic. brOccupied is
// the RENDER outcome for BR specifically: a BR control that does not apply to
// this card (no captions, no watchUrl, deduped away) leaves the badge home.
function buildCardCorners(item, prefs, caps) {
  const resolved = prefs && typeof prefs === 'object' ? prefs : resolveCardCornerPrefs(null);
  const seen = new Set();
  let html = '';
  let brOccupied = false;
  for (const [key, cornerClass] of CARD_CORNER_KEYS) {
    const control = resolved[key];
    if (!control || control === 'none' || seen.has(control)) continue;
    seen.add(control);
    const markup = buildCardCornerControlHtml(control, cornerClass, item, caps);
    if (markup) {
      html += `\n            ${markup}`;
      if (key === 'cornerBR') brOccupied = true;
    }
  }
  return { html, brOccupied };
}

// Back-compat thin wrapper: the corner markup alone (every pre-v1.204 caller
// and test reads just the string). buildCardCorners is the single source of
// truth for the dedupe - never re-derive the corner set anywhere else.
function buildCardCornerButtonsHtml(item, prefs, caps) {
  return buildCardCorners(item, prefs, caps).html;
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
  if (!item || item.type !== 'audio') return null;
  // reroute ONLY media-kind items (kind absent or 'media'). type:'audio' is NOT unique to
  // downloads - a podcast episode (kind 'podcast'), track/book/tv carry it on some feeds too;
  // never hijack their own destinations (a podcast must open /podcasts).
  if (item.kind && item.kind !== 'media') return null;
  const id = item.id != null ? String(item.id) : '';
  if (!id) return null;
  // chaptered (>= 2) -> the album via its FIRST chapter track (::c0). `chapters` (array) rides
  // the /api/videos surfaces; the home-feed + modern-grid carry `chapterCount` instead (the
  // v1.236 server-fold), so accept either signal.
  const chaptered = (Array.isArray(item.chapters) && item.chapters.length >= 2) || (Number(item.chapterCount) >= 2);
  const playId = chaptered ? (id + '::c0') : id;
  // &ao=1 marks a reroute-ORIGIN navigation: the music view bounces a MISS to /watch (a
  // video-side download plays there) ONLY for this origin, leaving the legacy continue-
  // listening card's miss behaviour (a native-track id that must NOT bounce to /watch) unchanged.
  return '/music?play=' + encodeURIComponent(playId) + '&ao=1';
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
    homeRowEnabled,
    musicHrefForItem,
    migrateListeningRowPref,
    resolveCardCornerPrefs,
    buildCardCorners,
    buildCardCornerButtonsHtml,
    cardKindPresentation,
    searchResultBadgeLabel,
    CARD_CORNER_CONTROLS,
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
  // target the INTERACTIVE `.thumbnail-container` (the card's <a>) beneath it -
  // we match THAT and reach the overlay child, never the overlay directly (a
  // pointer-events:none sibling is never `e.target` nor its ancestor).
  function overlayForEvent(e) {
    const host = e.target.closest && e.target.closest('.thumbnail-container');
    return host ? host.querySelector('.card-preview[data-preview-id]') : null;
  }
  function onOver(e) {
    const el = overlayForEvent(e);
    if (el) start(el);
  }
  function onOut(e) {
    const host = e.target.closest && e.target.closest('.thumbnail-container');
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
  // v1.17.0 FR-3(b), T2: set inside init() to that instance's own
  // disarmCardDelete() closure, so destroy() can clear a pending ~3s
  // auto-disarm setTimeout (a plain timer, NOT AbortSignal-bound) rather
  // than leaving it to fire later against an already-torn-down instance.
  let disarmCardDeleteFn = null;
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
    // v1.41.2: the sort control is a custom .btn dropdown (not a native
    // <select> -- see index.html / the wiring below).
    const sortDropdown = root.querySelector('#sort-dropdown');
    const sortBtn = root.querySelector('#sort-select-btn');
    const sortLabel = root.querySelector('#sort-select-label');
    const sortMenu = root.querySelector('#sort-menu');
    const shuffleAgainBtn = root.querySelector('#shuffle-again-btn');
    const viewModeBtn = root.querySelector('#view-mode-btn'); // v1.45.6: card/list toggle
    // C2/C3 (v1.24.0, T3-WIRE): the shared "actions" row that already holds
    // the sort <select>/shuffle/rescan controls -- the format toggle mounts
    // into it too (renderFormatToggle inserts itself as the FIRST child, so
    // it never disturbs the existing controls' order/listeners).
    const sectionActions = root.querySelector('.section-actions');

    // v1.17.0 FR-3(b), T2: card trash-can arm/disarm state, driven by
    // common.js's pure `nextArmState` reducer. `armedBtn` is the ACTUAL
    // `.card-delete-btn` DOM node currently armed (or null); `armState`
    // mirrors the reducer's `'idle'|'armed'` for that node. Only one card is
    // ever armed at a time -- arming a different card, a ~3s timeout, or any
    // document click/scroll outside the armed button all disarm. Reset (via
    // disarmCardDelete()) at the top of every renderMediaGridPage() FULL
    // REPLACE (never on an append -- appending only ADDS cards, it never
    // detaches an existing/armed one), since a replace re-render replaces
    // the grid's children -- an armed reference to a about-to-be-detached
    // node must never leak/double-fire across it.
    let armState = 'idle';
    let armedBtn = null;
    let armDisarmTimer = null;
    const CARD_ARM_TIMEOUT_MS = 3000;

    // Sort preference persists across visits. v1.34 (Dean): precedence is
    // explicit per-browser dropdown pick (localStorage `filetube_sort`) >
    // the server-side `defaultSort` setting (Settings page, out-of-the-box
    // 'release-date' -- the real-YouTube-feed flip) > 'release-date'
    // (matches the server default when the settings fetch fails). The
    // provisional value below is refined from /api/settings in init()
    // BEFORE the first page fetch whenever no explicit pick exists.
    let currentItems = [];
    let folderSettings = {}; // { "<path>": { name, hidden, hiddenFromSidebar } } — for author display, shared with cards
    // v1.67: the per-user corner layout + capability, latched by loadLibrary
    // BEFORE the first card render (plan D2: server-authoritative per C1 -
    // deliberately NO localStorage lane, the v1.53 cross-user-bleed class).
    // C5 defaults until the latch lands; a signed-out shell or fetch failure
    // keeps them.
    let cardCornerPrefs = resolveCardCornerPrefs(null);
    let cardCornerCaps = {};
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
    const isBareHome = !searchQuery && !folderFilter && !rootFilter && !likedFilter && !subsFilter;
    // v1.205 Wave B: a GLOBAL header search (a query with no folder/root/liked/
    // subs scope) is the UNIFIED cross-content search - it hits /api/search and
    // shows the content-type chip row. A search WITHIN a folder/root/liked scope
    // keeps the classic video-only /api/videos path + its searchIn toggle, so
    // nothing about the existing scoped-search behaviour changes.
    const isUnifiedSearch = !!searchQuery && !folderFilter && !rootFilter && !likedFilter && !subsFilter;
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
    const sortPageKeyValue = pageSortKey({ root: rootFilter, liked: likedFilter });
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
        const icon = viewModeBtn.querySelector('i');
        if (icon) icon.className = targetIsList ? 'icon-list' : 'icon-grid';
        const label = targetIsList ? 'Switch to list view' : 'Switch to card view';
        viewModeBtn.title = label;
        viewModeBtn.setAttribute('aria-label', label);
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

    // v1.67 (plan D2/D4): resolve the signed-in user's corner layout and -
    // only when a corner actually assigns reheat - the module capability.
    // Never throws (loadLibrary races it against /api/config in one
    // Promise.all; a failure here must never block the grid): any failure
    // resolves to the C5 defaults / an empty caps object, and C4 then
    // renders nothing in a reheat corner rather than guessing.
    async function fetchCardCornerState() {
      let prefs = resolveCardCornerPrefs(null);
      // v1.81 write-RBAC: the EFFECTIVE library-modify capability drives whether
      // the card delete affordance renders. Admin bypasses via role (their
      // stored flag is irrelevant), so compute admin-OR-flag exactly like the
      // server gate - never key the client purely off the raw column.
      let canModifyLibrary = false;
      try {
        const r = await fetch('/api/auth/me');
        if (r.ok) {
          const me = await r.json();
          prefs = resolveCardCornerPrefs(me && me.settings);
          canModifyLibrary = !!(me && me.user && (me.user.role === 'admin' || me.user.canModifyLibrary === true));
        }
      } catch (_) { /* signed-out shell / network failure -> defaults */ }
      const needsReheat = prefs.cornerTL === 'reheat' || prefs.cornerTR === 'reheat' || prefs.cornerBL === 'reheat';
      if (!needsReheat) return { prefs, caps: { canModifyLibrary } };
      // The same latched module-health capability the watch page and the
      // subscriptions nav injector use (common.js capability cache; the
      // fresh answer refreshes it for them too).
      const cached = readCapabilityCache();
      if (cached && typeof cached.moduleEnabled === 'boolean') {
        return { prefs, caps: { canModifyLibrary, reheatEnabled: cached.moduleEnabled === true } };
      }
      try {
        const res = await fetch('/api/subscriptions/health');
        writeCapabilityCache({ moduleEnabled: res.ok === true });
        return { prefs, caps: { canModifyLibrary, reheatEnabled: res.ok === true } };
      } catch (_) {
        return { prefs, caps: { canModifyLibrary, reheatEnabled: false } };
      }
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
      videoGrid.innerHTML = buildSkeletonGrid(SKELETON_CARD_COUNT);
      // v1.100 (Dean): the classic toolbar's format (All/Videos/Audio) + watch-
      // state (All/New/Watching/Watched) toggles are SYNCHRONOUS (localStorage
      // prefs), so render them NOW - before the config/videos fetches - so the
      // toolbar is COMPLETE from the first paint. Previously they injected in
      // fetchLibraryPage0 AFTER the fetch, so the static sort/rescan/view buttons
      // showed first and these grew the row a beat later ("starts with only a few
      // buttons"). Classic/folder/search only (modern home uses its own chip
      // chrome, section-actions hidden); guarded on not-present so a loadLibrary
      // retry / cached re-entry never removes+reinserts them (a flash).
      if (!modernMode && sectionActions && !sectionActions.querySelector('#library-format-toggle')) {
        renderFormatToggle(sectionActions, getStoredFormatFilter(), () => resetAndReload());
        renderWatchToggle(sectionActions, getStoredWatchFilter(), () => resetAndReload());
      }
      // v1.150 belt: a NON-search render must never inherit a prior search
      // render's scope toggle or its mobile strip class (cached/reused view
      // DOM - the homeViewCache posture makes persistence possible, so the
      // cleanup is unconditional rather than reasoned away).
      if (!searchQuery && sectionActions) {
        const staleScope = sectionActions.querySelector('#library-search-scope-toggle');
        if (staleScope && staleScope.parentNode) staleScope.parentNode.removeChild(staleScope);
        // v1.205: also drop a prior unified-search TYPE chip row (same cached-
        // view cleanup posture) so a non-search render never inherits it.
        const staleTypeChips = sectionActions.querySelector('#library-search-type-chips');
        if (staleTypeChips && staleTypeChips.parentNode) staleTypeChips.parentNode.removeChild(staleTypeChips);
        sectionActions.classList.remove('search-scoped-toolbar');
      }
      // v1.149: the search-scope toggle - SEARCH VIEWS ONLY (the guard is the
      // whole feature gate: no search, no third toggle, every other view
      // byte-identical). Same synchronous-before-fetch posture as its two
      // siblings above (the v1.100 complete-from-first-paint rule; the scope
      // is known synchronously from the URL). On change: state + URL
      // (replaceState keeps the deep link shareable without a history spam
      // entry per click) + the same resetAndReload the siblings use.
      if (!modernMode && searchQuery && !likedFilter && sectionActions) {
        // v1.150 (Dean's device report): mark the toolbar as search-scoped so
        // mobile CSS collapses it into ONE scrollable strip instead of the
        // v1.50 two-row layout (whose zero-slack budget orphaned this toggle
        // onto a third row). Removed by the non-search cleanup below.
        sectionActions.classList.add('search-scoped-toolbar');
        // v1.205 Wave B: a GLOBAL search shows the content-TYPE chip row;
        // a folder/root-scoped search keeps the video-only searchIn toggle.
        if (isUnifiedSearch && typeof renderSearchTypeChips === 'function') {
          if (!sectionActions.querySelector('#library-search-type-chips')) {
            renderSearchTypeChips(sectionActions, activeSearchType, (chip) => {
              activeSearchType = chip;
              try {
                const u = new URL(window.location.href);
                if (chip === 'all') u.searchParams.delete('type');
                else u.searchParams.set('type', chip);
                history.replaceState(null, '', u);
              } catch (_) { /* URL/history quirk - the in-view state still drives the fetch */ }
              resetAndReload();
            });
          }
        } else if (!isUnifiedSearch && !sectionActions.querySelector('#library-search-scope-toggle')) {
          renderSearchScopeToggle(sectionActions, activeSearchScope, (mode) => {
            activeSearchScope = mode;
            try {
              const u = new URL(window.location.href);
              if (mode === 'all') u.searchParams.delete('searchIn');
              else u.searchParams.set('searchIn', mode);
              history.replaceState(null, '', u);
            } catch (_) { /* URL/history quirk - the in-view state still drives the fetch */ }
            resetAndReload();
          });
        }
      }
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
        // 1. Check configs (+ the v1.67 corner latch, raced in parallel so
        // the pref never delays the grid behind a second round-trip; both
        // must land BEFORE the first buildCardHtml call below - a
        // paint-then-reshuffle of custom corners is exactly what plan D2
        // rules out, and the skeleton grid above already covers the wait).
        const [configRes, cornerState] = await Promise.all([
          fetch('/api/config'),
          fetchCardCornerState(),
        ]);
        cardCornerPrefs = cornerState.prefs;
        cardCornerCaps = cornerState.caps;
        const configData = await configRes.json();
        const folders = configData.folders || [];
        folderSettings = configData.folderSettings || {};
        // v1.126: seed the shell-level folder display map (common.js cache) so
        // resolveChannelName + every folder-label surface see it from one fetch.
        if (typeof setFolderDisplayNames === 'function') setFolderDisplayNames(configData.folderDisplayNames);
        syntheticFolderPaths = Array.isArray(configData.syntheticFolders) ? configData.syntheticFolders : [];

        if (folders.length === 0) {
          welcomeMessage.style.display = 'block';
          libraryContent.style.display = 'none';
          sidebarFoldersList.innerHTML = '<div style="padding: 6px 24px; font-style: italic; color: var(--text-secondary);">None</div>';
          return;
        }

        welcomeMessage.style.display = 'none';
        libraryContent.style.display = 'block';

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
        const bareLoad = !searchQuery && !folderFilter && !rootFilter && !likedFilter && !subsFilter && !forceGrid;
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

        // v1.84 Modern Mode renderers (nested so they reach buildCardHtml + the
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
            if (token === modernReqToken) videoGrid.innerHTML = '<div class="home-feed-empty">Could not load. Try again, or switch layout in Settings.</div>';
            return;
          }
          if (token !== modernReqToken) return; // a newer chip click superseded this
          const items = Array.isArray(data.items) ? data.items : [];
          currentItems = items;
          currentOffset = typeof data.offset === 'number' ? data.offset : 0;
          currentLimit = typeof data.limit === 'number' && data.limit > 0 ? data.limit : HOME_PAGE_LIMIT;
          currentTotal = typeof data.total === 'number' ? data.total : items.length;
          videoGrid.innerHTML = items.length ? items.map((it) => buildCardHtml(it, { feedHideable: true })).join('') : buildModernEmptyHtml(filter);
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
        function injectModernHeaderSort(sig) {
          const headerRight = document.querySelector('.header-right');
          if (!headerRight) return; // signed-out / no shell -> nothing to attach to
          const prior = headerRight.querySelector('.modern-sort');
          if (prior) prior.remove(); // idempotent across re-renders

          const wrap = document.createElement('div');
          wrap.className = 'modern-sort';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'modern-sort-btn';
          btn.setAttribute('aria-haspopup', 'listbox');
          btn.setAttribute('aria-expanded', 'false');
          btn.setAttribute('aria-label', 'Sort');
          btn.title = 'Sort';
          // v1.86.3 (Dean): a real chevron (keyboard_arrow_down) instead of a tiny
          // ▾ text character, so it sizes like the download/search glyphs.
          // v1.87.1 (Dean): inline <svg> (chrome-icon), not an `.icon-arrow-down`
          // mask - the mask decode-lags on a mobile cold start (chromeIconEl is a
          // common.js top-level, available here like MODERN_SORT_OPTIONS).
          const caret = chromeIconEl('caret', 'modern-sort-caret');
          if (caret) btn.appendChild(caret);
          const menu = document.createElement('ul');
          menu.className = 'sort-menu modern-sort-menu';
          menu.setAttribute('role', 'listbox');
          menu.setAttribute('aria-label', 'Sort');
          menu.hidden = true;
          for (const [val, label] of MODERN_SORT_OPTIONS) {
            const li = document.createElement('li');
            li.setAttribute('role', 'option');
            li.setAttribute('data-sort', val);
            li.tabIndex = -1;
            li.textContent = label;
            menu.appendChild(li);
          }
          wrap.appendChild(btn);
          wrap.appendChild(menu);
          headerRight.insertBefore(wrap, headerRight.firstChild); // leftmost of the cluster

          const opts = () => Array.prototype.slice.call(menu.querySelectorAll('[data-sort]'));
          const applyActive = () => opts().forEach((li) => {
            const on = li.getAttribute('data-sort') === activeModernSort;
            li.classList.toggle('active', on);
            li.setAttribute('aria-selected', on ? 'true' : 'false');
          });
          const open = () => {
            menu.hidden = false;
            btn.setAttribute('aria-expanded', 'true');
            const cur = opts().find((li) => li.getAttribute('data-sort') === activeModernSort) || opts()[0];
            if (cur) cur.focus();
          };
          const close = (returnFocus) => {
            menu.hidden = true;
            btn.setAttribute('aria-expanded', 'false');
            if (returnFocus) btn.focus();
          };
          const choose = (val, returnFocus) => {
            close(returnFocus);
            const next = resolveModernSort(val);
            // v1.86.0 gate SUGGESTION: re-picking the SAME key is a no-op EXCEPT
            // 'random' - "Feeling lucky" should re-roll each time (the server
            // re-shuffles the whole set on every request), so let random fall
            // through to a fresh fetch even when it is already active.
            if (next === activeModernSort && next !== 'random') return;
            activeModernSort = next;
            try { localStorage.setItem('filetube_modern_sort', next); } catch (_) { /* private mode */ }
            applyActive();
            fetchModernGrid(sig);
          };
          applyActive();

          btn.addEventListener('click', (e) => { e.stopPropagation(); if (menu.hidden) open(); else close(); }, { signal: sig });
          btn.addEventListener('keydown', (e) => {
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && menu.hidden) { e.preventDefault(); open(); }
          }, { signal: sig });
          menu.addEventListener('click', (e) => {
            const li = e.target.closest('[data-sort]');
            if (li) choose(li.getAttribute('data-sort'), false);
          }, { signal: sig });
          menu.addEventListener('keydown', (e) => {
            const list = opts();
            const idx = list.indexOf(document.activeElement);
            if (e.key === 'ArrowDown') { e.preventDefault(); (list[idx + 1] || list[0]).focus(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); (list[idx - 1] || list[list.length - 1]).focus(); }
            else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
            else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
            else if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              const li = document.activeElement;
              if (li && li.getAttribute('data-sort')) choose(li.getAttribute('data-sort'), true);
            } else if (e.key === 'Escape') { e.preventDefault(); close(true); }
          }, { signal: sig });
          document.addEventListener('click', (e) => {
            if (menu.hidden) return;
            if (wrap.contains(e.target)) return;
            close();
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
          const btn = document.createElement('button');
          btn.type = 'button';
          // v1.160.1 (Dean): the transparent glyph style (like .modern-sort-btn),
          // NOT the filled .btn look which read as "always selected/grey".
          btn.className = 'modern-view-toggle';
          const icon = document.createElement('i');
          btn.appendChild(icon);
          const sync = () => {
            const isList = getStoredViewMode() === 'list';
            icon.className = isList ? 'icon-grid' : 'icon-list'; // show the mode a click switches TO
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
        async function renderModernHome(chromeHost, sig) {
          injectModernHeaderSort(sig); // glyph-only ▾, leftmost in the header top-right
          injectModernViewToggle(sig); // v1.160: card/list toggle beside it
          if (chromeHost) {
            // #modern-avatar-bar is filled by T4 (mobile-only). The chip row is
            // wired with ONE delegated listener covering every chip.
            chromeHost.innerHTML = '<div id="modern-avatar-bar" class="modern-avatar-bar" hidden></div>' + buildModernChipRowHtml(activeModernChip);
            const chipRow = chromeHost.querySelector('.modern-chip-row');
            if (chipRow) {
              chipRow.addEventListener('click', (e) => {
                const btn = e.target.closest('.modern-chip');
                if (!btn) return;
                const next = resolveModernChip(btn.dataset.chip);
                if (next === activeModernChip) return;
                activeModernChip = next;
                // v1.143 (Dean): remember the pick per-device - the mirror of
                // the sort's own persistence line (injectModernHeaderSort's
                // choose(), the 'filetube_modern_sort' write).
                try { localStorage.setItem('filetube_modern_chip', next); } catch (_) { /* private mode */ }
                chipRow.querySelectorAll('.modern-chip').forEach((b) => {
                  const on = b.dataset.chip === next;
                  b.classList.toggle('active', on);
                  b.setAttribute('aria-selected', on ? 'true' : 'false');
                });
                fetchModernGrid(sig);
              }, { signal: sig });
            }
            // T4: the mobile recent-uploader subscription bar - best-effort; a
            // failure or no subs leaves it hidden, never a broken strip.
            const bar = chromeHost.querySelector('#modern-avatar-bar');
            if (bar) {
              // v1.99 shimmer sweep: RESERVE the strip with last-known-many shimmer
              // chips before the fetch, so the real chips reveal in place instead
              // of popping in above the chips. On a fetch failure the seed is
              // cleared below (never a stranded shimmer); populateModernAvatarBar
              // reveals the real chips or collapses to hidden if now truly none.
              const seedN = readModernAvatarBarCount();
              if (seedN > 0) { bar.innerHTML = buildAvatarBarSkeleton(seedN); bar.hidden = false; }
              fetch('/api/channels', { signal: sig })
                .then((r) => (r.ok ? r.json() : { channels: [] }))
                .then((data) => populateModernAvatarBar(bar, selectRecentUploaderChannels(data && data.channels, 12)))
                .catch(() => { if (!sig.aborted) { bar.textContent = ''; bar.hidden = true; } });
            }
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
    // reset-in-place), `sort`/`format` (the persisted preferences), an
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
      queryParams.push(`format=${encodeURIComponent(getStoredFormatFilter())}`);
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
      const endpoint = likedFilter ? '/api/liked' : '/api/videos';
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
      // v1.126: the rename affordance - a small pencil AFTER the header (a
      // SIBLING, never inside it: textContent writes above would wipe an inner
      // node - the v1.122 count-badge lesson). Folder views only, library-write
      // members only. Re-rendered idempotently on every page-0 load.
      const staleRenameBtn = document.getElementById('folder-rename-btn');
      if (staleRenameBtn && staleRenameBtn.parentNode) staleRenameBtn.parentNode.removeChild(staleRenameBtn);
      if (folderFilter && videosHeader && cardCornerCaps && cardCornerCaps.canModifyLibrary === true) {
        const btn = document.createElement('button');
        btn.id = 'folder-rename-btn';
        btn.type = 'button';
        btn.className = 'folder-rename-btn';
        btn.title = 'Rename this playlist';
        btn.setAttribute('aria-label', 'Rename this playlist');
        btn.textContent = '✎'; // pencil glyph
        btn.addEventListener('click', async () => {
          const current = (typeof folderDisplayName === 'function' && folderDisplayName(folderFilter)) || '';
          const entered = window.prompt('Display name for this playlist (empty to reset):', current);
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
            window.alert('Could not save the name. ' + (err && err.message ? err.message : ''));
          }
        });
        videosHeader.insertAdjacentElement('afterend', btn);
      }
      // Wave G: the "Show in Music library" toggle - a SIBLING next to the rename
      // pencil (same idempotent-remove + canModifyLibrary gate). Only on a folder
      // view that actually HAS audio (the mark is meaningless otherwise). Marks
      // the channel (folder) so its downloaded music projects into the Music
      // library; each user still opts into the projection via the master toggle.
      const staleMusicBtn = document.getElementById('folder-music-toggle');
      if (staleMusicBtn && staleMusicBtn.parentNode) staleMusicBtn.parentNode.removeChild(staleMusicBtn);
      const folderHasAudio = Array.isArray(currentItems) && currentItems.some((it) => it && it.type === 'audio');
      // v1.224 (Dean): the ♪ shows whenever the FOLDER has audio (server truth),
      // not just when an audio file is on the loaded page - so it appears on the
      // "home -> click channel" view too (that's a ?folder= view whose first page
      // may be all videos). Gate only on the folder view + permission here; start
      // hidden unless the loaded page already shows audio (no flash), then the
      // music-flag fetch's hasAudio is authoritative (reveal, or remove).
      // v1.225 (Dean): a PINNED sidebar channel navigates via ?root= (not ?folder=),
      // so the ♪ was absent there. Derive the channel folder from the loaded items'
      // OWN folderName (correct by construction - it IS their channel, and the
      // music-flag is keyed by folderName) when the whole view is ONE channel; a
      // multi-channel root gets no single mark (skip). Prefer an explicit ?folder=.
      let musicFolderName = folderFilter;
      if (!musicFolderName && rootFilter) {
        const itemFolders = Array.from(new Set((Array.isArray(currentItems) ? currentItems : [])
          .map((it) => (it && typeof it.folderName === 'string' ? it.folderName.trim() : ''))
          .filter(Boolean)));
        if (itemFolders.length === 1) musicFolderName = itemFolders[0];
      }
      if (musicFolderName && videosHeader && cardCornerCaps && cardCornerCaps.canModifyLibrary === true) {
        const mbtn = document.createElement('button');
        mbtn.id = 'folder-music-toggle';
        mbtn.type = 'button';
        mbtn.className = 'folder-music-toggle';
        mbtn.textContent = '♪';
        mbtn.hidden = !folderHasAudio; // optimistic show if the page has audio; the fetch confirms
        let effectiveNow = false;
        const paint = (effective) => {
          mbtn.classList.toggle('is-on', !!effective);
          const t = effective ? 'In your Music library - click to remove' : 'Show this channel in your Music library';
          mbtn.title = t;
          mbtn.setAttribute('aria-label', t);
          mbtn.setAttribute('aria-pressed', effective ? 'true' : 'false');
        };
        paint(false);
        fetch(`/api/folders/music-flag?folderName=${encodeURIComponent(musicFolderName)}`)
          .then((r) => r.json())
          .then((s) => {
            // hasAudio is the authority: a folder with NO audio never gets the mark
            // (the toggle would be meaningless); one WITH audio shows it even if the
            // loaded page happened to be all videos (the channel-view gap Dean hit).
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
          } catch (err) {
            window.alert('Could not update the Music setting. ' + (err && err.message ? err.message : ''));
          }
        });
        const anchor = document.getElementById('folder-rename-btn') || videosHeader;
        anchor.insertAdjacentElement('afterend', mbtn);
      }
      // v1.100: the format + watch-state toggles now render synchronously at the
      // top of loadLibrary (before the fetch) so the toolbar is complete from
      // first paint - no longer injected here post-fetch. A guarded re-render
      // covers the rare path where loadLibrary's early render was skipped (e.g. a
      // future modern->classic in-view transition) without a flash otherwise.
      if (sectionActions && !sectionActions.querySelector('#library-format-toggle')) {
        renderFormatToggle(sectionActions, getStoredFormatFilter(), () => resetAndReload());
        renderWatchToggle(sectionActions, getStoredWatchFilter(), () => resetAndReload());
      }
      // v1.149: the guarded re-render twin of the search-scope toggle (same
      // rare-path rationale as the siblings directly above). v1.205 Wave B: the
      // twin branch to the type-chip row for a global search (site 2).
      if (searchQuery && !likedFilter && sectionActions) {
        sectionActions.classList.add('search-scoped-toolbar'); // v1.150: the mobile strip marker (twin of site 1)
        if (isUnifiedSearch && typeof renderSearchTypeChips === 'function') {
          if (!sectionActions.querySelector('#library-search-type-chips')) {
            renderSearchTypeChips(sectionActions, activeSearchType, (chip) => {
              activeSearchType = chip;
              try {
                const u = new URL(window.location.href);
                if (chip === 'all') u.searchParams.delete('type');
                else u.searchParams.set('type', chip);
                history.replaceState(null, '', u);
              } catch (_) { /* URL/history quirk - the in-view state still drives the fetch */ }
              resetAndReload();
            });
          }
        } else if (!isUnifiedSearch && !sectionActions.querySelector('#library-search-scope-toggle')) {
          renderSearchScopeToggle(sectionActions, activeSearchScope, (mode) => {
            activeSearchScope = mode;
            try {
              const u = new URL(window.location.href);
              if (mode === 'all') u.searchParams.delete('searchIn');
              else u.searchParams.set('searchIn', mode);
              history.replaceState(null, '', u);
            } catch (_) { /* URL/history quirk - the in-view state still drives the fetch */ }
            resetAndReload();
          });
        }
      }
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
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'attribute-folder-btn';
      btn.className = 'btn';
      btn.title = 'Attribute unattributed videos in this folder to a channel';
      btn.setAttribute('aria-label', 'Attribute unattributed videos in this folder to a channel');
      const icon = document.createElement('i');
      icon.className = 'icon-attribute'; // v1.202: the same real mask as the watch-page control
      btn.appendChild(icon);
      const label = document.createElement('span');
      label.className = 'btn-label';
      label.textContent = 'Attribute folder';
      btn.appendChild(document.createTextNode(' '));
      btn.appendChild(label);
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
          videoGrid.insertAdjacentHTML('beforeend', fresh.map((it) => buildCardHtml(it, { feedHideable: true })).join(''));
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
        src: likedFilter ? 'liked' : 'videos',
        sort: currentSort,
        seed: currentSeed,
        search: searchQuery,
        searchIn: activeSearchScope, // v1.149 gate W1: the scope rides the ctx (encodeListContext drops 'all')
        folder: folderFilter,
        root: rootFilter,
        format: getStoredFormatFilter(),
      });
    }

    function buildCardHtml(item, opts) {
      // v1.72 (#94): a mixed-kind Liked item renders through this SAME
      // template - identical classes, so tile and list view CSS apply
      // unchanged - with only destination/art/byline swapped per kind.
      const kp = cardKindPresentation(item);
      // v1.97 "Hide from feed": a feed-only affordance, passed EXPLICITLY by the
      // modern-grid render paths (never inferred from the global modernMode flag,
      // which persists across folder/search views where the feed prune must NOT
      // appear). Media items only (kp === null) - per-VIDEO, the media-only set.
      const feedHideable = !!(opts && opts.feedHideable) && !kp;
      const views = resolveViewCountLabel(item);
      const relativeTime = formatRelativeTime(item.addedAt);
      // v1.40.0 (Dean, superseding the v1.36.2 `list=liked`-only carry): carry
      // the FULL browse context into the watch page so prev/next walks THIS
      // view's exact on-screen order -- the current folder/search/liked scope,
      // sort, AND the server shuffle seed -- not the item's own channel folder.
      // The watch page re-fetches the same list-API query and steps through the
      // response order (see common.js buildContextListUrl / watch.js
      // setupTrackNavContext). Empty ctx (nothing meaningful to carry) -> bare URL ->
      // the folder-scoped fallback, byte-identical to pre-v1.40.0.
      const ctxParam = currentBrowseContextParam();
      // A non-media card's destination is its kind's own surface (the ctx
      // contract is a watch-page/media concept and never rides along).
      // v1.236: an audio-only tile taps into the music player when the flag is on (override
      // ONLY the destination - the card keeps its video-side thumbnail/byline).
      const watchHref = musicHrefForItem(item) || (kp ? kp.href : `/watch.html?v=${item.id}${ctxParam ? '&ctx=' + encodeURIComponent(ctxParam) : ''}`);
      // Author/channel resolved the same way as the watch page (see common.js).
      const channelName = resolveChannelName(item, folderSettings);
      // Deterministic 3–5 star rating — the same value shows on this item's watch page.
      const rating = getStarRating(item.id);
      // v1.84 T5: the channel avatar beside the byline (Modern mode, media cards
      // only - a kp card's byline is its own kind's identity). Decision is pure
      // (common.js modernCardAvatar); render + escape here. The monogram colour
      // rides an inline custom property the CSS consumes with var() (census-safe).
      const chAv = (!kp && typeof modernCardAvatar === 'function')
        ? modernCardAvatar(channelName, item.channelAvatarUrl, typeof modernModeEnabled === 'function' && modernModeEnabled())
        : { kind: 'none' };
      let channelAvatarHtml = '';
      if (chAv.kind === 'img') {
        channelAvatarHtml = `<span class="card-channel-avatar"><img src="${escapeHtml(chAv.url)}" alt="" loading="lazy" /></span>`;
      } else if (chAv.kind === 'mono') {
        channelAvatarHtml = `<span class="card-channel-avatar card-channel-avatar-mono" style="--ch-av:${chAv.color}">${escapeHtml(chAv.glyph)}</span>`;
      }

      // v1.204: build the corners first - the bottom-right slot shares its
      // space with the duration badge, so the badge's home depends on whether
      // BR actually rendered a button for THIS card.
      const cardCorners = buildCardCorners(item, cardCornerPrefs, cardCornerCaps);

      // Calculate duration format
      const durationStr = item.duration > 0 ? formatDuration(item.duration) : (item.type === 'audio' ? 'Audio' : '');
      const durationBadge = durationStr
        ? `<div class="duration-badge${cardCorners.brOccupied ? ' duration-badge--beside-corner' : ''}">${durationStr}</div>`
        : '';

      // Playback progress indicator
      let progressBar = '';
      if (item.progressPercent > 0.5) {
        // Only show if watched more than 0.5%
        progressBar = `
          <div class="progress-bar-container">
            <div class="progress-bar-fill" style="width: ${Math.min(100, item.progressPercent)}%"></div>
          </div>
        `;
      }

      return `
        <div class="video-card">
          <div class="card-media">
            <a href="${watchHref}" class="thumbnail-container">
              <img class="thumbnail-img" src="${kp ? kp.thumbSrc : `/thumbnail/${item.id}`}" alt="${escapeHtml(item.title)}" loading="lazy" />
              ${(!kp && item.hasPreview)
                ? `<div class="card-preview" aria-hidden="true" data-preview-id="${item.id}"></div>`
                : ''}
              ${durationBadge}
              ${progressBar}
            </a>
            ${cardCorners.html}
          </div>
          <div class="video-info">
            ${item.resultType ? `<span class="card-type-badge">${escapeHtml(searchResultBadgeLabel(item.resultType))}</span>` : ''}
            ${feedHideable
              ? `<button type="button" class="card-feedhide-btn" data-id="${escapeHtml(item.id)}" aria-label="Hide from feed" title="Hide from feed"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2c1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.95 7.95 0 0 1 4 12a8 8 0 0 1 8-8zm0 16a7.96 7.96 0 0 1-4.9-1.69L18.31 7.1A7.95 7.95 0 0 1 20 12a8 8 0 0 1-8 8z" fill="currentColor"/></svg></button>`
              : ''}
            <a href="${watchHref}" class="video-title" title="${escapeHtml(item.title)}">
              ${escapeHtml(item.title)}
            </a>
            <div class="video-uploader">
              ${channelAvatarHtml}
              ${kp
                ? `<a href="${kp.uploaderHref}">${escapeHtml(kp.uploaderLabel)}</a>`
                : `<a href="/?folder=${encodeURIComponent(item.folderName)}">${escapeHtml(channelName)}</a>`}
            </div>
            <div class="video-meta">
              <span>${views}</span> &bull; <span>${relativeTime}</span>
            </div>
            <div class="card-rating" title="${rating} / 5 stars" aria-label="Rated ${rating} out of 5 stars"><span class="on">${'★'.repeat(rating)}</span><span class="off">${'☆'.repeat(5 - rating)}</span></div>
          </div>
        </div>
      `;
    }

    // Appends `items` as NEW card elements at the tail of #video-grid --
    // via createElement/append, NOT an innerHTML rebuild of the whole grid
    // (the old full-library-in-one-join pattern this task removes). Builds
    // the new items' markup into a detached wrapper, then moves just those
    // resulting elements into the live grid -- the existing (already
    // rendered) cards are never touched/re-parsed.
    function appendCardsToGrid(items) {
      if (!items || items.length === 0) return;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = items.map(buildCardHtml).join('');
      Array.from(wrapper.children).forEach((card) => videoGrid.append(card));
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
    // shared empty-state render (mirrors the old renderMediaGrid([]) path)
    // once the grid has no cards left.
    function removeCardFromGrid(id) {
      const buttons = videoGrid.querySelectorAll('.card-delete-btn');
      for (let i = 0; i < buttons.length; i++) {
        if (buttons[i].dataset.id === id) {
          const card = buttons[i].closest('.video-card');
          if (card) card.remove();
          break;
        }
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
    // IMMEDIATELY via the SAME POST /api/config path the Setup page's Save
    // button uses: (1) the reordered VISIBLE subset via moveArrayItem, (2)
    // rebuilt into the FULL folders order via rebuildFullFolderOrder (a
    // hidden-from-sidebar folder keeps its absolute position -- it never
    // appears here to be dragged), (3) POSTed, then the config is re-fetched
    // (GET) so the synthetic Downloads folder's position-splice (server.js)
    // is reflected.
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
          '<div style="padding: 6px 24px; font-style: italic; color: var(--text-secondary);">None</div>';
        applyLikedSidebarEntry(sidebarFoldersList, { active: likedFilter });
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
      applyLikedSidebarEntry(sidebarFoldersList, { active: likedFilter });

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
      // The persist posture is UNCHANGED: this sidebar has no Save button, so
      // a drop persists immediately, through the SAME
      // moveArrayItem -> rebuildFullFolderOrder -> POST /api/config path as
      // before (a hidden-from-sidebar or synthetic folder keeps its absolute
      // position; it never appears here to be dragged).
      wireReorderable(sidebarFoldersList, {
        rowSelector: '.sidebar-item[data-index]',
        scrollContainer: document.getElementById('sidebar'),
        onReorder: async (fromIndex, toIndex) => {
          const newVisibleOrder = moveArrayItem(visibleFolders, fromIndex, toIndex);
          const rebuiltFull = rebuildFullFolderOrder(allFolders, settings, newVisibleOrder, syntheticFolderPaths);
          await persistSidebarFolderOrder(rebuiltFull, settings);
        },
        signal,
      });
    }

    // Persists a sidebar drag-and-drop reorder via the existing
    // POST /api/config path (same one the Setup page's Save button uses), then
    // re-fetches GET /api/config and re-renders the sidebar so the synthetic
    // Downloads folder's GET-time position splice (server.js) is reflected.
    async function persistSidebarFolderOrder(newFolders, settings) {
      try {
        const postRes = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folders: newFolders, folderSettings: settings })
        });
        const postData = await postRes.json();
        if (!postData.success) {
          console.error('Failed to persist sidebar folder reorder:', postData.error);
          return;
        }
        const getRes = await fetch('/api/config');
        const getData = await getRes.json();
        folderSettings = getData.folderSettings || {};
        syntheticFolderPaths = Array.isArray(getData.syntheticFolders) ? getData.syntheticFolders : [];
        renderSidebarFolders(getData.folders || [], folderSettings);
      } catch (err) {
        console.error('Failed to persist sidebar folder reorder:', err);
      }
    }

    // Item 1 (v1.14.0): show/hide the "shuffle again" re-roll button to match
    // the current sort selection (visible only for `random`).
    function updateShuffleButtonVisibility() {
      if (shuffleAgainBtn) shuffleAgainBtn.hidden = !shouldShowShuffleButton(currentSort);
    }

    // v1.17.0 FR-3(b), T2: clears any pending auto-disarm timer and drops the
    // armed reference WITHOUT requiring the armed node to still be attached
    // (classList.remove on a detached node is a harmless no-op) -- safe to
    // call unconditionally from a re-render, a timeout, an outside click/
    // scroll, or after a delete.
    function disarmCardDelete() {
      if (armDisarmTimer) {
        clearTimeout(armDisarmTimer);
        armDisarmTimer = null;
      }
      if (armedBtn) armedBtn.classList.remove('armed');
      armState = 'idle';
      armedBtn = null;
    }
    disarmCardDeleteFn = disarmCardDelete;

    // Arms `btn` (revealing its inline "Sure?" affordance via the `.armed`
    // CSS class) and starts the ~3s auto-disarm timer. Disarms whatever was
    // PREVIOUSLY armed first, so only one card is ever armed at a time.
    function armCardDelete(btn) {
      disarmCardDelete();
      armState = 'armed';
      armedBtn = btn;
      btn.classList.add('armed');
      armDisarmTimer = setTimeout(disarmCardDelete, CARD_ARM_TIMEOUT_MS);
    }

    // v1.17.0 FR-3(b), T2: fires the SAME `DELETE /api/videos/:id` endpoint
    // the watch page's delete flow uses -- no new endpoint, no contract
    // change. `id` is read straight off the tapped button's OWN `data-id`
    // (never a closed-over/stale value), so there is no id mixup between
    // cards. On a 409 (read-only/permission-denied mount, `{readOnly:true}`)
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

      // Any full replace re-render replaces the grid's children -- an armed
      // reference to a node that's about to be detached must never leak/
      // double-fire across it (hard constraint: reset arm state on
      // re-render).
      disarmCardDelete();

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
          ? '<a href="/" class="btn empty-state-action">View All Media</a>'
          : '';
        let emptyOpts;
        if (searchQuery) {
          emptyOpts = { icon: 'icon-search', message: 'No results found.', hint: 'Try a different search, or browse all your media.', actionHtml };
        } else if (folderFilter) {
          emptyOpts = { icon: 'icon-folder', message: 'This folder is empty.', hint: 'Nothing here yet — new files in this folder will show up after a scan.', actionHtml };
        } else {
          emptyOpts = { icon: 'icon-play', message: 'No videos or audio yet.', hint: 'Files in your media folders show up here — with thumbnails, durations, and playback that picks up where you left off.' };
        }
        videoGrid.innerHTML = buildEmptyStateHtml(emptyOpts);
        return;
      }

      videoGrid.innerHTML = items.map(buildCardHtml).join('');
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

    // v1.41.2: custom sort dropdown wiring. Function DECLARATIONS (hoisted) so
    // the async settings-default apply above (applySortLabel) can call them.
    function sortOptions() {
      return sortMenu ? Array.prototype.slice.call(sortMenu.querySelectorAll('[data-sort]')) : [];
    }
    function sortMenuItem(value) {
      // NOTE: `value` can be an untrusted localStorage string -- a selector-
      // breaking char (e.g. `"]`) would make querySelector throw and, since
      // applySortLabel runs synchronously at init, take down the whole home
      // view. Match by iterating instead of interpolating into a selector.
      return sortOptions().find((li) => li.getAttribute('data-sort') === value) || null;
    }
    function applySortLabel(value) {
      const item = sortMenuItem(value);
      if (sortLabel && item) sortLabel.textContent = item.textContent;
      sortOptions().forEach((li) => {
        const on = li.getAttribute('data-sort') === value;
        li.classList.toggle('active', on);
        li.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    function openSortMenu(focusValue) {
      if (!sortMenu || !sortBtn) return;
      sortMenu.hidden = false;
      sortBtn.setAttribute('aria-expanded', 'true');
      const opts = sortOptions();
      const target = opts.find((li) => li.getAttribute('data-sort') === focusValue) || opts[0];
      if (target) target.focus();
    }
    function closeSortMenu(returnFocus) {
      if (!sortMenu || !sortBtn) return;
      sortMenu.hidden = true;
      sortBtn.setAttribute('aria-expanded', 'false');
      if (returnFocus) sortBtn.focus();
    }
    function chooseSort(value, returnFocus) {
      closeSortMenu(returnFocus);
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
    if (sortBtn && sortMenu) {
      sortOptions().forEach((li) => { li.tabIndex = -1; }); // roving focus target
      applySortLabel(currentSort);
      updateShuffleButtonVisibility();
      sortBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // don't let the document-level close handler see this
        if (sortMenu.hidden) openSortMenu(currentSort); else closeSortMenu();
      }, { signal });
      // Keyboard: open on ArrowDown/Up from the button (Enter/Space already
      // open via native button activation -> click).
      sortBtn.addEventListener('keydown', (e) => {
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && sortMenu.hidden) {
          e.preventDefault();
          openSortMenu(currentSort);
        }
      }, { signal });
      sortMenu.addEventListener('click', (e) => {
        const li = e.target.closest('[data-sort]');
        if (li) chooseSort(li.getAttribute('data-sort'), false);
      }, { signal });
      // Keyboard nav within the open menu: arrows move roving focus, Enter/
      // Space selects, Escape/Tab close (Escape returns focus to the button).
      sortMenu.addEventListener('keydown', (e) => {
        const opts = sortOptions();
        const idx = opts.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); (opts[idx + 1] || opts[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (opts[idx - 1] || opts[opts.length - 1]).focus(); }
        else if (e.key === 'Home') { e.preventDefault(); opts[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); opts[opts.length - 1].focus(); }
        else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const li = document.activeElement;
          if (li && li.getAttribute('data-sort')) chooseSort(li.getAttribute('data-sort'), true);
        } else if (e.key === 'Escape') { e.preventDefault(); closeSortMenu(true); }
      }, { signal });
      // Close on any outside click (the menu overlays the grid).
      document.addEventListener('click', (e) => {
        if (sortMenu.hidden) return;
        if (sortDropdown && sortDropdown.contains(e.target)) return;
        closeSortMenu();
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

    // v1.30.0 T3 (AC2.3): `POST /api/scan` now acks with a 202
    // `{scanning, alreadyInProgress}` BEFORE the scan itself completes (see
    // server.js's T2, A2) -- there is no more `{success:true}` to branch on,
    // and the old `window.location.reload()` on completion is GONE. Instead,
    // any 202 (whether this click started a fresh scan OR simply joined one
    // already running -- `alreadyInProgress: true`, e.g. the periodic/boot
    // scan beat this click to it) goes straight into polling
    // `GET /api/scan-status`, keeping the button in its "Scanning..." state,
    // until `scanning` flips false -- then the grid refreshes IN PLACE via
    // `window.__filetubeRefreshLibrary` (the `loadLibrary` hook set up
    // below). This generalizes the v1.29 BUG-2 reload-never contract to scan
    // completion: this path must NEVER call `window.location.reload()` or
    // trigger any other full-page navigation.
    // v1.45.8: extracted so BOTH the Rescan button AND pull-to-refresh (below)
    // trigger the identical scan. The `disabled` guard makes a second trigger
    // (a pull while the button already says "Scanning...") a no-op.
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
    // its own "Scanning..." label as its affordance and deliberately does not
    // raise the pull indicator (the button is right there, on-screen, saying
    // it). Note the button is wired through a wrapper below rather than
    // directly, so a click Event can never arrive here as `opts`.
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
      rescanBtn.innerHTML = '<i class="icon-refresh"></i> <span class="btn-label">Scanning...</span>';
      rescanBtn.disabled = true;
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
          // Visual-consistency polish: reset to the SAME short "Rescan"
          // label the static markup starts with (was "Rescan Files" here,
          // a casing/length mismatch against the button's own resting
          // label -- the fuller "Rescan Files" name still lives in
          // title/aria-label).
          rescanBtn.innerHTML = '<i class="icon-refresh"></i> <span class="btn-label">Rescan</span>';
          rescanBtn.disabled = false;
          // The scan never started, so nothing will ever poll it to completion
          // -- the indicator must come down here or it spins forever.
          ptrEndRefreshing();
          return;
        }
        pollRescanStatus();
      } catch (err) {
        console.error(err);
        showToast('Network error trigger scanner.');
        rescanBtn.innerHTML = '<i class="icon-refresh"></i> <span class="btn-label">Rescan</span>';
        rescanBtn.disabled = false;
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
          rescanBtn.innerHTML = '<i class="icon-refresh"></i> <span class="btn-label">Rescan</span>';
          rescanBtn.disabled = false;
          // v1.47.4 item 3: the scan is genuinely finished AND the grid has been
          // refreshed above, so this is the honest moment to drop the pull
          // indicator -- not finger-release. Ordered after the refresh so the
          // spinner never comes down while stale rows are still on screen.
          ptrEndRefreshing();
        })
        .catch(() => {
          // Transient fetch failure while polling -- retry rather than
          // leaving the button stuck in "Scanning..." forever (mirrors
          // pollAutomationScanStatus's own retry-on-transient-failure
          // posture).
          if (!controller || controller.signal.aborted) return;
          setTimeout(pollRescanStatus, 1500);
        });
    }

    // v1.17.0 FR-3(b), T2: ONE delegated click listener on #video-grid (never
    // per-card -- delegation means it covers BOTH a full renderMediaGridPage()
    // replace and an appended page's new cards with zero extra wiring, so a
    // per-card listener would leak/duplicate).
    // Drives the pure `nextArmState` reducer: a tap on an idle card's delete
    // button arms it (no delete yet); a tap on the SAME already-armed button
    // is the confirming second tap that actually deletes. A tap that lands on
    // a DIFFERENT card's delete button re-arms the new one (only one card is
    // ever armed at a time) rather than deleting the previously-armed one.
    //
    // v1.86.2 (Dean): the confirming second tap deletes straight to (recoverable)
    // Trash via `deleteCardById` -> `DELETE /api/videos/:id`, for EVERY item.
    // (Superseded the v1.21 FR-7 escalation: a LOCAL card item used to route the
    // second tap through the checkbox-gated `showHardDeleteModal` as a conscious
    // 3rd step; that is dropped ON THE CARD - it moves to Trash either way, so the
    // extra modal was friction Dean didn't want on the feed. showHardDeleteModal
    // still guards the WATCH-page delete for local files - the card revert is
    // scoped to the card, matching the pre-YouTube-feed inline two-tap.)
    // v1.40.0 (Dean): per-card Like toggle. Same `db.liked` id-array membership
    // the watch page's Like button uses (POST/DELETE /api/liked/:id), and the
    // same NON-optimistic posture -- the heart flips only after the request
    // resolves, never on a failed/pending request. Delegated on the grid like
    // the delete control. The card stays in place on unlike (even in the Liked
    // view) -- removing a card mid-grid is disruptive; the heart just greys.
    function applyCardLikeState(btn, liked) {
      btn.classList.toggle('liked', liked);
      btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
      btn.setAttribute('aria-label', liked ? 'Unlike' : 'Like');
      btn.setAttribute('title', liked ? 'Unlike' : 'Like');
    }
    // v1.72 (#94): the per-kind membership endpoints. Each kind's liked
    // carrier keeps its own route family (the existing lanes stay the write
    // authorities); a card button carries data-kind so the toggle dispatches
    // without inferring anything from the id.
    function cardLikeEndpoint(kind, id) {
      const encId = encodeURIComponent(id);
      if (kind === 'podcast') return '/api/podcasts/episodes/' + encId + '/liked';
      if (kind === 'track') return '/api/music/liked/' + encId;
      if (kind === 'book') return '/api/books/liked/' + encId;
      return '/api/liked/' + encId;
    }
    async function toggleCardLike(btn) {
      const id = btn.dataset.id;
      if (!id || btn.disabled) return;
      const currentlyLiked = btn.classList.contains('liked');
      btn.disabled = true;
      try {
        const res = await fetch(cardLikeEndpoint(btn.dataset.kind, id), { method: currentlyLiked ? 'DELETE' : 'POST' });
        if (!res.ok) throw new Error('like request failed: ' + res.status);
        const data = await res.json().catch(() => ({}));
        const nowLiked = typeof data.liked === 'boolean' ? data.liked : !currentlyLiked;
        applyCardLikeState(btn, nowLiked);
        // Persist onto the in-memory item so a later grid re-render (sort/seed
        // reset) rebuilds the card in its correct state.
        const item = currentItems.find((it) => it.id === id);
        if (item) item.liked = nowLiked;
      } catch (_) {
        /* leave the heart unchanged on failure -- never fake success */
      } finally {
        btn.disabled = false;
      }
    }
    // v1.67: the card reheat corner fires the SAME per-item endpoint as the
    // watch page's flame button, with the same status->toast vocabulary. On
    // 202 the job runs server-side and its progress/result surface in the
    // existing download status chip (watch parity - deliberately NO second
    // progress mechanism and NO fake "done" state on the card; the watch
    // page's completion-diff/relocation modal stays a watch-page
    // affordance, disclosed in the plan).
    async function triggerCardReheat(btn) {
      const id = btn.dataset.id;
      if (!id || btn.disabled) return;
      btn.disabled = true;
      try {
        const res = await fetch(`/api/ytdlp/repull-metadata/item/${encodeURIComponent(id)}`, { method: 'POST' });
        const body = await res.json().catch(() => ({}));
        if (res.status === 202) { showToast('Reheating…'); return; }
        if (res.status === 409) { showToast('A reheat is already running.'); return; }
        if (res.status === 404) { showToast('This video has no source to reheat from.'); return; }
        if (res.status === 403) { showToast('Read-only mode: reheat is disabled on this instance.'); return; }
        showToast((body && body.error) || 'Reheat could not be started.');
      } catch (_) {
        showToast('Reheat could not be started.');
      } finally {
        btn.disabled = false;
      }
    }

    // v1.97 "Hide from feed": optimistically pull the card, POST the prune, and
    // offer Undo (DELETE) via the toast. Reversible with no one-way trap (the
    // toast now, the You-tab "Hidden from feed" list later). Pagination stays
    // consistent: the loaded window shrank by one, so drop currentOffset AND
    // currentTotal by one (nextOffset = currentOffset + currentLimit would else
    // skip the item that shifted down). The next server fetch overwrites both
    // with the fresh filtered values, so this only has to be right for the
    // immediately-next lazy page. On any failure the card is restored in place.
    function hideCardFromFeed(btn) {
      const id = btn.getAttribute('data-id');
      if (!id) return;
      const card = btn.closest('.video-card');
      if (!card) return;
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

    videoGrid.addEventListener('click', (e) => {
      const feedhideBtn = e.target.closest('.card-feedhide-btn');
      if (feedhideBtn) { e.preventDefault(); hideCardFromFeed(feedhideBtn); return; }
      const likeBtn = e.target.closest('.card-like-btn');
      if (likeBtn) { e.preventDefault(); toggleCardLike(likeBtn); return; }
      // v1.63: add-to-queue rides the same delegation (common.js addToQueue
      // is THE one verb - toast + header-chrome refresh included).
      const cardQueueBtn = e.target.closest('.card-queue-btn');
      // v1.72: the kind rides the button (a mixed-kind Liked card queues a
      // podcast episode under its own entry kind - addToQueue's third arg).
      if (cardQueueBtn) { e.preventDefault(); addToQueue(cardQueueBtn.getAttribute('data-id'), undefined, cardQueueBtn.getAttribute('data-kind') || undefined); return; }
      // v1.67: the two NEW corner controls ride the same delegation. Share
      // runs common.js's ONE share decision (plan D6) with the item's title
      // for the sheet; the URL is the renderer-emitted data-share-url (the
      // server-derived watchUrl, never assembled client-side).
      const cardShareBtn = e.target.closest('.card-share-btn');
      if (cardShareBtn) {
        e.preventDefault();
        const url = cardShareBtn.getAttribute('data-share-url');
        if (url) {
          const item = currentItems.find((it) => it.id === cardShareBtn.dataset.id);
          shareExternalUrl(url, item && item.title).then((outcome) => {
            if (outcome === 'copied') showToast('Link copied');
            // QA S6: unlike the watch page (whose metadata block still shows
            // the URL), a card has no visible fallback - a silent failure
            // here reads as a dead button, so both failure outcomes toast.
            if (outcome === 'copy-failed' || outcome === 'unavailable') showToast('Could not share the link.');
          });
        }
        return;
      }
      const cardReheatBtn = e.target.closest('.card-reheat-btn');
      if (cardReheatBtn) { e.preventDefault(); triggerCardReheat(cardReheatBtn); return; }
      // v1.203: the Transcript corner - the shared flow, keyed by the item's
      // id + title from the fetched list (never from DOM text). Busy state
      // disables the corner while the text loads; the view's signal tears
      // down whichever modal it opened.
      const cardTranscriptBtn = e.target.closest('.card-transcript-btn');
      if (cardTranscriptBtn) {
        e.preventDefault();
        const item = currentItems.find((it) => it.id === cardTranscriptBtn.dataset.id);
        if (!item || cardTranscriptBtn.disabled) return;
        openTranscriptFor({
          id: item.id,
          title: item.title,
          signal,
          onBusy: (busy) => { cardTranscriptBtn.disabled = busy; },
          // This view is CACHED on nav-away (its signal never fires), so the
          // corner itself answers "am I still on screen" when the text lands
          // - a detached grid opens nothing (gate finding).
          stillWanted: () => cardTranscriptBtn.isConnected,
        });
        return;
      }
    }, { signal });

    videoGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.card-delete-btn');
      if (!btn) return; // any other click inside the grid -- outside-click disarm (below) handles it
      e.preventDefault();
      const isArmedCard = armedBtn === btn;
      const result = nextArmState(isArmedCard ? armState : 'idle', 'tap');
      if (result.deleted) {
        const id = btn.dataset.id;
        disarmCardDelete();
        // v1.86.2 (Dean): the card's confirming SECOND tap deletes straight to
        // (recoverable) Trash - the original pre-YouTube-feed inline two-tap
        // (arm -> "Sure?" -> tap again). The v1.21 checkbox-gated hard-delete
        // escalation for LOCAL files is dropped HERE, on the card: it moves to
        // Trash either way (recoverable within the retention window), so the
        // extra modal+checkbox was friction Dean didn't want on the feed. (The
        // watch-page delete keeps its own flow; this reverts the CARD only.)
        deleteCardById(id);
      } else {
        armCardDelete(btn);
      }
    }, { signal });

    // Disarms the currently-armed card on any click elsewhere in the document
    // (outside the armed button itself -- that tap is handled by the grid
    // listener above, which always runs first since it fires during the same
    // bubble phase closer to the target) or on any scroll. `scroll` does not
    // bubble, so `capture: true` is required to observe it regardless of
    // which element actually scrolled.
    document.addEventListener('click', (e) => {
      if (armState !== 'armed') return;
      const btn = e.target.closest ? e.target.closest('.card-delete-btn') : null;
      if (btn === armedBtn) return; // this click IS the armed tap -- already handled above
      disarmCardDelete();
    }, { signal });
    window.addEventListener('scroll', () => {
      if (armState === 'armed') disarmCardDelete();
    }, { signal, capture: true, passive: true });

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
      const bareHome = !searchQuery && !folderFilter && !rootFilter && !likedFilter;
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
    if (typeof disarmCardDeleteFn === 'function') disarmCardDeleteFn();
    disarmCardDeleteFn = null;
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
