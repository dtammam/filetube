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
// interpolated attribute values (see `escapeHtml` below).
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
        <div class="thumbnail-container skeleton-shimmer"></div>
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

function buildMusicHomeSectionHtml(items, heading, seeAllHref) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const seeAll = seeAllHref ? `<a class="books-row-seeall" href="${escapeBookRowHtml(seeAllHref)}">See all</a>` : '';
  return `
    <section class="books-home-row music-home-row">
      <div class="books-home-row-header"><h3>${escapeBookRowHtml(heading)}</h3>${seeAll}</div>
      <div class="books-home-row-scroller">${items.map(buildMusicRowCardHtml).join('')}</div>
    </section>
  `;
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildCardDownloadHref,
    buildCardDownloadFilename,
    buildSkeletonGrid,
    buildBookRowCardHtml,
    buildBooksHomeSectionHtml,
    buildMusicRowCardHtml,
    buildMusicHomeSectionHtml,
    homeRowEnabled,
  };
}

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
    // C3 remediation: reads the LIVE `allFolders`/`folderSettings` bindings
    // below (a closure over the `let`s, not a value snapshot) -- so calling
    // this later, after loadLibrary() has populated them (or after a sidebar
    // reorder updates them), always re-renders with current data.
    restoreSidebarFn = () => renderSidebarFolders(allFolders, folderSettings);

    const videoGrid = root.querySelector('#video-grid');
    const welcomeMessage = root.querySelector('#welcome-message');
    const libraryContent = root.querySelector('#library-content');
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
    // Tracks the source index of an in-progress sidebar drag; per-init (like
    // every other piece of this view's state) so it always starts clean.
    let sidebarDragSrcIndex = null;

    // Parse URL query params — read fresh on every init(), since this same
    // function now runs for every navigation (SPA swap or full load), each
    // potentially with different query params.
    const urlParams = new URLSearchParams(window.location.search);
    const searchQuery = urlParams.get('search') || '';
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

    if (searchQuery) {
      if (searchInput) searchInput.value = searchQuery;
      videosHeader.textContent = `Search Results for "${searchQuery}"`;
    } else if (likedFilter) {
      videosHeader.textContent = 'Playlist: Liked';
    } else if (folderFilter) {
      videosHeader.textContent = `Playlist: ${folderFilter}`;
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
      try {
        // 1. Check configs
        const configRes = await fetch('/api/config');
        const configData = await configRes.json();
        const folders = configData.folders || [];
        folderSettings = configData.folderSettings || {};

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
        // that no longer exists falls back to Most Recent. Only fetched on a
        // bare load -- a deep-link visit never pays for this extra request.
        // A network/parse failure here must never block the rest of the page.
        // v1.34: the settings fetch now serves TWO defaults -- the item-4
        // default view (bare loads only, unchanged) and the new defaultSort
        // (any load where this browser has no explicit dropdown pick). One
        // fetch covers both; a failure blocks neither (view falls back to
        // Most Recent, sort keeps the provisional 'release-date').
        const bareLoad = !searchQuery && !folderFilter && !rootFilter && !likedFilter;
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
            if (!storedSortPick && typeof settingsData.defaultSort === 'string' && settingsData.defaultSort !== '') {
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

        // 3. Fetch + render page 0 of the media list (server-authoritative
        // sort/format/pagination -- see fetchLibraryPage0() below) and arm
        // the infinite-scroll sentinel for any further pages.
        await fetchLibraryPage0();
        ensureGridSentinel();

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

    // Builds the `GET /api/videos` URL for a given page `offset`, carrying
    // every server-authoritative param this view's controls affect: the
    // current search/folder/root scope (unchanged for the lifetime of this
    // view instance -- a new scope is a new page navigation, not a
    // reset-in-place), `sort`/`format` (the persisted preferences), an
    // explicit `limit` (never relies on the server's own default), and the
    // CURRENT reset's `seed`.
    function buildVideosApiUrl(offset) {
      const queryParams = [];
      if (searchQuery) queryParams.push(`search=${encodeURIComponent(searchQuery)}`);
      if (folderFilter) queryParams.push(`folder=${encodeURIComponent(folderFilter)}`);
      if (rootFilter) queryParams.push(`root=${encodeURIComponent(rootFilter)}`);
      queryParams.push(`sort=${encodeURIComponent(currentSort)}`);
      queryParams.push(`format=${encodeURIComponent(getStoredFormatFilter())}`);
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
      renderFormatToggle(sectionActions, getStoredFormatFilter(), () => resetAndReload());
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
      return encodeListContext({
        src: likedFilter ? 'liked' : 'videos',
        sort: currentSort,
        seed: currentSeed,
        search: searchQuery,
        folder: folderFilter,
        root: rootFilter,
        format: getStoredFormatFilter(),
      });
    }

    function buildCardHtml(item) {
      const views = getMockViews(item.id, item.size);
      const relativeTime = formatRelativeTime(item.addedAt);
      // v1.40.0 (Dean, superseding the v1.36.2 `list=liked`-only carry): carry
      // the FULL browse context into the watch page so prev/next walks THIS
      // view's exact on-screen order -- the current folder/search/liked scope,
      // sort, AND the server shuffle seed -- not the item's own channel folder.
      // The watch page re-fetches the same list-API query and steps through the
      // response order (see common.js buildContextListUrl / watch.js
      // setupPrevNext). Empty ctx (nothing meaningful to carry) -> bare URL ->
      // the folder-scoped fallback, byte-identical to pre-v1.40.0.
      const ctxParam = currentBrowseContextParam();
      const watchHref = `/watch.html?v=${item.id}${ctxParam ? '&ctx=' + encodeURIComponent(ctxParam) : ''}`;
      // Author/channel resolved the same way as the watch page (see common.js).
      const channelName = resolveChannelName(item, folderSettings);
      // Deterministic 3–5 star rating — the same value shows on this item's watch page.
      const rating = getStarRating(item.id);

      // Calculate duration format
      const durationStr = item.duration > 0 ? formatDuration(item.duration) : (item.type === 'audio' ? 'Audio' : '');
      const durationBadge = durationStr ? `<div class="duration-badge">${durationStr}</div>` : '';

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
              <img class="thumbnail-img" src="/thumbnail/${item.id}" alt="${escapeHtml(item.title)}" loading="lazy" />
              ${durationBadge}
              ${progressBar}
            </a>
            <button type="button" class="card-delete-btn" data-id="${escapeHtml(item.id)}" aria-label="Delete this video">
              <i class="icon-delete"></i><span class="card-delete-confirm">Sure?</span>
            </button>
            <a class="card-download-btn" href="${buildCardDownloadHref(item.id)}" download="${escapeHtml(buildCardDownloadFilename(item.title, item.ext))}" aria-label="Save to device" title="Save to device">
              <i class="icon-download"></i>
            </a>
            <button type="button" class="card-like-btn${item.liked ? ' liked' : ''}" data-id="${escapeHtml(item.id)}" aria-label="${item.liked ? 'Unlike' : 'Like'}" aria-pressed="${item.liked ? 'true' : 'false'}" title="Like">
              <i class="icon-heart"></i>
            </button>
          </div>
          <div class="video-info">
            <a href="${watchHref}" class="video-title" title="${escapeHtml(item.title)}">
              ${escapeHtml(item.title)}
            </a>
            <div class="video-uploader">
              <a href="/?folder=${encodeURIComponent(item.folderName)}">${escapeHtml(channelName)}</a>
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
    // Item 1 (v1.15.0): also wires native HTML5 drag-and-drop reordering. The
    // home sidebar has no Save button, so a drop persists IMMEDIATELY via the
    // SAME POST /api/config path the Setup page's up/down buttons use: (1) the
    // reordered VISIBLE subset via moveArrayItem, (2) rebuilt into the FULL
    // folders order via rebuildFullFolderOrder (a hidden-from-sidebar folder
    // keeps its absolute position -- it never appears here to be dragged),
    // (3) POSTed, then the config is re-fetched (GET) so the synthetic
    // Downloads folder's position-splice (server.js) is reflected. The
    // up/down buttons on the Setup page remain the keyboard/tap-accessible
    // fallback for reordering (this sidebar has no such fallback of its own).
    function renderSidebarFolders(folders, settings = {}) {
      allFolders = Array.isArray(folders) ? folders : [];
      const visibleFolders = visibleSidebarFolders(folders, settings);
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
        return `
          <a href="/?root=${encodeURIComponent(f)}" class="sidebar-item ${isActive}" data-index="${index}" draggable="true" title="${escapeHtml(f)}">
            <i class="icon-folder"></i> ${escapeHtml(label)}
          </a>
        `;
      }).join('');
      applyLikedSidebarEntry(sidebarFoldersList, { active: likedFilter });

      const items = sidebarFoldersList.querySelectorAll('.sidebar-item[data-index]');
      items.forEach((el) => {
        el.addEventListener('dragstart', (e) => {
          sidebarDragSrcIndex = parseInt(el.dataset.index, 10);
          el.classList.add('dragging');
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            // Firefox requires data to be set for the drag to initiate at all.
            e.dataTransfer.setData('text/plain', String(sidebarDragSrcIndex));
          }
        }, { signal });
        el.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          const rect = el.getBoundingClientRect();
          const before = (e.clientY - rect.top) < rect.height / 2;
          el.classList.toggle('drag-over-before', before);
          el.classList.toggle('drag-over-after', !before);
        }, { signal });
        el.addEventListener('dragleave', () => {
          el.classList.remove('drag-over-before', 'drag-over-after');
        }, { signal });
        el.addEventListener('drop', async (e) => {
          e.preventDefault();
          const targetIndex = parseInt(el.dataset.index, 10);
          const before = el.classList.contains('drag-over-before');
          el.classList.remove('drag-over-before', 'drag-over-after');
          const fromIndex = sidebarDragSrcIndex;
          sidebarDragSrcIndex = null;
          if (fromIndex === null || Number.isNaN(targetIndex)) return;
          const toIndex = computeDropIndex(fromIndex, targetIndex, before);
          const newVisibleOrder = moveArrayItem(visibleFolders, fromIndex, toIndex);
          const rebuiltFull = rebuildFullFolderOrder(allFolders, settings, newVisibleOrder);
          await persistSidebarFolderOrder(rebuiltFull, settings);
        }, { signal });
        el.addEventListener('dragend', () => {
          sidebarDragSrcIndex = null;
          items.forEach((r) => r.classList.remove('dragging', 'drag-over-before', 'drag-over-after'));
        }, { signal });
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
        const actionHtml = (searchQuery || folderFilter)
          ? '<a href="/" class="btn empty-state-action">View All Media</a>'
          : '';
        videoGrid.innerHTML = buildEmptyStateHtml({
          message: 'No video or audio files found.',
          actionHtml,
        });
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
    // NOTE: the header search box's click/keypress listeners are shell-owned
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
      localStorage.setItem('filetube_sort', currentSort);
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
    rescanBtn.addEventListener('click', async () => {
      rescanBtn.innerHTML = '<i class="icon-refresh"></i> <span class="btn-label">Scanning...</span>';
      rescanBtn.disabled = true;
      try {
        const res = await fetch('/api/scan', { method: 'POST' });
        if (!res.ok) {
          let data = {};
          try { data = await res.json(); } catch (_e) { /* no/invalid JSON body -- fall back to a generic message below */ }
          alert('Failed to rescan: ' + (data.error || 'unknown error'));
          // Visual-consistency polish: reset to the SAME short "Rescan"
          // label the static markup starts with (was "Rescan Files" here,
          // a casing/length mismatch against the button's own resting
          // label -- the fuller "Rescan Files" name still lives in
          // title/aria-label).
          rescanBtn.innerHTML = '<i class="icon-refresh"></i> <span class="btn-label">Rescan</span>';
          rescanBtn.disabled = false;
          return;
        }
        pollRescanStatus();
      } catch (err) {
        console.error(err);
        alert('Network error trigger scanner.');
        rescanBtn.innerHTML = '<i class="icon-refresh"></i> <span class="btn-label">Rescan</span>';
        rescanBtn.disabled = false;
      }
    }, { signal });

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
    // FR-7 (v1.21.0, T6): the confirming second tap is where the escalation
    // happens. A yt-dlp-managed item's second tap stays this EXACT,
    // unchanged immediate-delete (AC47). A LOCAL item's second tap does NOT
    // delete immediately -- it opens the checkbox-gated `showHardDeleteModal`
    // (common.js) as a conscious 3rd action; only confirming THERE calls
    // `deleteCardById` (AC46/AC49). Both paths converge on the exact same,
    // unmodified `deleteCardById` -> `DELETE /api/videos/:id` (AC48).
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
    async function toggleCardLike(btn) {
      const id = btn.dataset.id;
      if (!id || btn.disabled) return;
      const currentlyLiked = btn.classList.contains('liked');
      btn.disabled = true;
      try {
        const res = await fetch('/api/liked/' + encodeURIComponent(id), { method: currentlyLiked ? 'DELETE' : 'POST' });
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
    videoGrid.addEventListener('click', (e) => {
      const likeBtn = e.target.closest('.card-like-btn');
      if (likeBtn) { e.preventDefault(); toggleCardLike(likeBtn); return; }
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
        const item = currentItems.find((it) => it.id === id);
        if (isYtdlpManagedItem(item)) {
          deleteCardById(id);
        } else {
          showHardDeleteModal(item, () => deleteCardById(id));
        }
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

    // v1.22.0 FR-5 (AC32-AC38): desktop-sidebar channel pins -- a SEPARATE
    // fetch against the module's own gated pin store, independent of
    // loadLibrary()'s folder-list rendering above: renderPinnedSidebar
    // inserts `#sidebar-pinned-section` as a SIBLING of, never a child of,
    // `#sidebar-folders-list`, so it is unaffected regardless of fetch/
    // render ordering between the two. A 404 (module disabled) resolves to
    // `[]` (no pins rendered), preserving the disabled-module no-op
    // guarantee -- this never logs/throws on a 404. Read-only: never writes
    // db.folders/folderSettings.
    // v1.37.0: channel pins + book-shelf pins, one merged sidebar section.
    fetchAllPins().then((pins) => renderPinnedSidebar(pins));

    // v1.37.0 T10 (books): the home book surfaces. BARE home view -> a
    // 'Continue reading' row above the grid; SEARCH view -> a 'Books'
    // section above the video results. Both fetch-and-forget: any failure
    // (or a books-less install's empty list) renders NOTHING and the home
    // page stays byte-identical.
    const booksRowHost = document.createElement('div');
    if (videoGrid && videoGrid.parentElement) {
      videoGrid.insertAdjacentElement('beforebegin', booksRowHost);
      const bareHome = !searchQuery && !folderFilter && !rootFilter && !likedFilter;
      if (bareHome) {
        // v1.44: a music "Continue listening" host sits ABOVE the books one.
        // Both rows are individually toggleable (device-local pref, default
        // ON); a music-less/books-less install (or a hidden row) renders
        // NOTHING, keeping the home page byte-identical.
        const musicRowHost = document.createElement('div');
        booksRowHost.insertAdjacentElement('beforebegin', musicRowHost);
        if (homeRowEnabled('ft-home-continue-listening')) {
          fetch('/api/music?filter=recent-listening&limit=10')
            .then((r) => (r.ok ? r.json() : { items: [] }))
            .then((data) => {
              musicRowHost.innerHTML = buildMusicHomeSectionHtml(data.items, 'Continue listening', '/music');
            })
            .catch(() => { musicRowHost.innerHTML = ''; });
        }
        if (homeRowEnabled('ft-home-continue-reading')) {
          fetch('/api/books?filter=reading&limit=10')
            .then((r) => (r.ok ? r.json() : { items: [] }))
            .then((data) => {
              booksRowHost.innerHTML = buildBooksHomeSectionHtml(data.items, 'Continue reading', '/books');
            })
            .catch(() => { booksRowHost.innerHTML = ''; });
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
