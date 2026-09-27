// FileTube Books page (v1.37.0 T8) — registered VIEW MODULE, the main.js
// pattern: `init(root)` runs on both a full page load (progressive
// enhancement via common.js's bootRouter) and an in-app swap into /books;
// every listener binds through ONE per-instance AbortController so
// `destroy()` removes them all. Loaded directly by books.html (a hard load
// needs it immediately) and lazy-loaded by every other shell via
// common.js's ensureViewScriptLoaded.

// ---- Pure helpers and builders (node:test-covered; buildBookCard takes a document) ----

// The UI primitives (public/js/ui.js): the page's window.ui, else (Node tests) the module.
function booksUi() {
  if (typeof window !== 'undefined' && window.ui) return window.ui;
  if (typeof module !== 'undefined' && module.require) return module.require('./ui.js');
  return null;
}

// A book's read fraction for the cover's progress bar: 0..1, and 0 (no bar) until
// the reader is past the first half-percent - an opened-once book shows no sliver.
function bookProgressFraction(item) {
  const percent = item && item.progress && typeof item.progress.percent === 'number'
    ? Math.min(100, Math.max(0, item.progress.percent))
    : 0;
  return percent > 0.5 ? percent / 100 : 0;
}

// One cover card (UI pass sweep S10). `item` is a GET /api/books list item. The cover is
// a ui-thumb (2:3, card radius, the --thumb-ground placeholder at its final size, the
// progress bar reading --p) inside the link; the title is the card's second link. Built
// with DOM calls, so a title or author is always text, never markup.
function buildBookCard(item, doc) {
  const d = doc || document;
  const ui = booksUi();
  const href = `/read.html?b=${encodeURIComponent(item.id)}`;
  const title = String(item.title || '');
  const card = d.createElement('div');
  card.className = 'book-card';
  const cover = d.createElement('a');
  cover.className = 'book-cover-link';
  cover.href = href;
  cover.setAttribute('aria-label', title);
  cover.tabIndex = -1; // the title link is the card's one tab stop
  const thumb = ui.thumb({ aspect: '2x3', context: 'card', src: `/bookcover/${encodeURIComponent(item.id)}`,
    alt: '', progress: bookProgressFraction(item), doc: d });
  const img = thumb.querySelector('img');
  if (img) img.classList.add('art-shimmer'); // the shared decode reveal (revealArtTogether)
  cover.appendChild(thumb);
  const titleLink = d.createElement('a');
  titleLink.className = 'book-title';
  titleLink.href = href;
  titleLink.title = title;
  titleLink.textContent = title;
  const author = d.createElement('div');
  author.className = 'book-author';
  author.textContent = String(item.author || '');
  card.append(cover, titleLink, author);
  return card;
}

// The five sort orders GET /api/books takes, in menu order.
const BOOK_SORTS = [
  { value: 'recent', label: 'Recently added' },
  { value: 'title-asc', label: 'Title A-Z' },
  { value: 'title-desc', label: 'Title Z-A' },
  { value: 'author', label: 'Author' },
  { value: 'recent-progress', label: 'Recently read' },
];
function normalizeBookSort(value) {
  return BOOK_SORTS.some((s) => s.value === value) ? value : 'recent';
}

// The library's non-grid states (plan D9): a failed load is an ERROR with Retry, never
// "No books yet"; an empty library says how to add books; a filtered view that matches
// nothing says so, without the setup advice. Pure: returns the ui.state options.
function bookLibraryState({ failed, rootFilter, searchFilter } = {}) {
  if (failed) {
    return { kind: 'error', icon: 'error', title: 'Couldn’t load your books',
      body: 'Check that the server is reachable, then try again.', action: 'Retry' };
  }
  if (searchFilter) return { kind: 'empty-filtered', icon: 'search', title: 'No books match', body: `Nothing matches “${searchFilter}”.` };
  if (rootFilter) return { kind: 'empty-filtered', icon: 'menu_book', title: 'No books on this shelf', body: 'Its folder holds no EPUB or PDF files yet.' };
  return { kind: 'empty', icon: 'menu_book', title: 'No books yet',
    body: 'Add a book folder in Settings, drop EPUB or PDF files in it, and scan.', action: 'Open Settings' };
}

// Unique shelf chips from a folders aggregation payload
// (GET /api/books/folders -> [{name, dir, count, pinned}]), sorted by name.
function deriveShelfChips(folders) {
  if (!Array.isArray(folders)) return [];
  return folders
    .filter((f) => f && typeof f.name === 'string' && f.name !== '' && typeof f.dir === 'string')
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

// v1.98 shimmer sweep: n `.book-card`-shaped shimmer cards seeded into the grid
// BEFORE the fetch. The same `.book-cover-link` > 2:3 `ui-thumb` box the real card
// uses (sweep S10) + two skeleton lines, so the swap to real cards is zero-shift.
function buildBookSkeletonCards(n) {
  const count = Number.isInteger(n) && n > 0 ? n : 0;
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="book-card" aria-hidden="true">
        <span class="book-cover-link"><span class="ui-thumb ui-thumb--2x3 ui-thumb--card skeleton-shimmer"></span></span>
        <div class="skeleton-line skeleton-line-title skeleton-shimmer"></div>
        <div class="skeleton-line skeleton-line-meta skeleton-shimmer"></div>
      </div>
    `;
  }
  return html;
}

// v1.339 (L2, plan D5): the Continue shelf sits ABOVE the grid and used to unhide after
// its own fetch, pushing the whole library down on every visit (August row 27; probe:
// books cold CLS 0.66 at 390). The last shelf size is remembered per device (the v1.99
// avatar-bar pattern) and, on the next visit, the shelf is reserved with that many
// shape-matched skeleton cards before the fetch, so the real covers fill in place. A
// shelf that is now empty collapses once (disclosed); a fetch error clears the reserve
// but keeps the count (a transient failure still reserves next time).
const BOOKS_CONTINUE_COUNT_KEY = 'ft-books-continue-count';
const BOOKS_CONTINUE_LIMIT = 12;
function readBooksContinueCount() {
  try {
    const v = parseInt(localStorage.getItem(BOOKS_CONTINUE_COUNT_KEY), 10);
    return Number.isInteger(v) && v > 0 ? Math.min(v, BOOKS_CONTINUE_LIMIT) : 0;
  } catch (_) { return 0; }
}
function writeBooksContinueCount(n) {
  try { localStorage.setItem(BOOKS_CONTINUE_COUNT_KEY, String(Number.isInteger(n) && n > 0 ? Math.min(n, BOOKS_CONTINUE_LIMIT) : 0)); } catch (_) { /* private mode */ }
}
// Reserve the shelf from the remembered count (no-op when there is none).
function reserveBooksContinueShelf(section, grid) {
  const n = readBooksContinueCount();
  if (!section || !grid || n <= 0) return false;
  grid.innerHTML = buildBookSkeletonCards(n);
  section.hidden = false;
  return true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildBookCard, bookProgressFraction, deriveShelfChips, buildBookSkeletonCards,
    BOOK_SORTS, normalizeBookSort, bookLibraryState,
    readBooksContinueCount, writeBooksContinueCount, reserveBooksContinueShelf, BOOKS_CONTINUE_COUNT_KEY };
}

(function () {
  if (typeof window === 'undefined') return;
  let controller = null;
  let openMenu = null; // the sort menu (a ui.sheet on <body>), closed on destroy

  const SORT_STORAGE_KEY = 'filetube_books_sort';

  function readSortPref() {
    try {
      return normalizeBookSort(localStorage.getItem(SORT_STORAGE_KEY) || 'recent');
    } catch (_) {
      return 'recent';
    }
  }

  function writeSortPref(value) {
    try { localStorage.setItem(SORT_STORAGE_KEY, value); } catch (_) { /* storage disabled */ }
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  }

  function go(url) {
    if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate(url);
    else window.location.assign(url);
  }

  function init(root) {
    controller = new AbortController();
    const { signal } = controller;
    const doc = root.ownerDocument || document;
    const ui = booksUi();

    const grid = root.querySelector('#books-grid');
    const stateHost = root.querySelector('#books-state');
    const continueSection = root.querySelector('#books-continue-section');
    const continueGrid = root.querySelector('#books-continue-grid');
    const chipsHost = root.querySelector('#books-shelf-chips');
    const pinHost = root.querySelector('#books-shelf-pin-host');
    const sortBtn = root.querySelector('#books-sort-btn');
    const sortLabel = root.querySelector('#books-sort-label');
    const scanBtn = root.querySelector('#books-scan-btn');
    if (!grid) return;

    const params = new URLSearchParams(window.location.search);
    const rootFilter = params.get('root') || '';
    const searchFilter = params.get('search') || '';

    let sort = readSortPref();
    function paintSort() {
      const entry = BOOK_SORTS.find((s) => s.value === sort) || BOOK_SORTS[0];
      if (sortLabel) sortLabel.textContent = entry.label;
      if (sortBtn) sortBtn.setAttribute('aria-label', `Sort books: ${entry.label}`);
    }
    paintSort();

    if (sortBtn && ui) {
      sortBtn.addEventListener('click', () => {
        if (openMenu && openMenu.isOpen()) return;
        openMenu = ui.menu({
          title: 'Sort by',
          anchor: sortBtn,
          items: BOOK_SORTS.map((s) => ({ label: s.label, value: s.value, checked: s.value === sort })),
          onSelect: (value) => {
            if (signal.aborted) return;
            const next = normalizeBookSort(value);
            if (next === sort) return;
            sort = next;
            writeSortPref(sort);
            paintSort();
            loadBooks().catch(() => {});
          },
          onClose: () => { openMenu = null; },
          doc,
        });
      }, { signal });
    }

    if (scanBtn) {
      scanBtn.addEventListener('click', () => {
        if (scanBtn.getAttribute('aria-busy') === 'true') return;
        if (ui) ui.setBusy(scanBtn, true);
        fetch('/api/books/scan', { method: 'POST' })
          .catch(() => {})
          .finally(() => {
            // Give the (fast at hundreds of books) scan a beat, then refresh.
            setTimeout(() => {
              if (signal.aborted) return;
              if (ui) ui.setBusy(scanBtn, false);
              loadBooks().catch(() => {});
            }, 1500);
          });
      }, { signal });
    }

    // The empty / error block (plan D9). `null` hides it.
    function showState(spec) {
      if (!stateHost) return;
      stateHost.replaceChildren();
      stateHost.hidden = !spec;
      if (!spec || !ui) return;
      let action = null;
      if (spec.kind === 'error') action = { label: spec.action, onClick: () => loadBooks().catch(() => {}) };
      else if (spec.kind === 'empty') action = { label: spec.action, onClick: () => go('/setup.html') };
      const block = ui.state({ icon: spec.icon, title: spec.title, body: spec.body, action, doc });
      block.setAttribute('data-state', spec.kind);
      stateHost.appendChild(block);
    }

    async function loadBooks() {
      const query = new URLSearchParams();
      query.set('sort', sort);
      query.set('limit', '500');
      if (rootFilter) query.set('root', rootFilter);
      if (searchFilter) query.set('search', searchFilter);
      showState(null);
      // v1.98 shimmer sweep: seed the shimmer before the fetch (the reveal is the
      // real cards below); on error clear it so it never strands.
      grid.innerHTML = buildBookSkeletonCards(8);
      try {
        const data = await fetchJson(`/api/books?${query.toString()}`);
        if (signal.aborted) return 0;
        const items = Array.isArray(data.items) ? data.items : [];
        grid.replaceChildren(...items.map((item) => buildBookCard(item, doc)));
        showState(items.length > 0 ? null : bookLibraryState({ rootFilter, searchFilter }));
        revealBookArt(grid);
        return items.length;
      } catch (err) {
        grid.innerHTML = '';
        if (signal.aborted) return 0;
        // D9: a failed fetch is an error with Retry - never the "No books yet" advice.
        showState(bookLibraryState({ failed: true }));
        console.error('Books: load failed', err);
        return 0;
      }
    }

    async function loadContinueShelf() {
      // The Continue shelf only decorates the UNFILTERED library view --
      // a shelf/search view IS already a narrowed list.
      if (rootFilter || searchFilter || !continueSection || !continueGrid) return;
      reserveBooksContinueShelf(continueSection, continueGrid); // v1.339 (L2): hold its place
      try {
        const data = await fetchJson(`/api/books?filter=reading&limit=${BOOKS_CONTINUE_LIMIT}`);
        if (signal.aborted) return; // a torn-down view writes nothing
        const items = Array.isArray(data.items) ? data.items : [];
        continueGrid.replaceChildren(...items.map((item) => buildBookCard(item, doc)));
        continueSection.hidden = items.length === 0;
        writeBooksContinueCount(items.length);
        revealBookArt(continueGrid);
      } catch (_) {
        if (signal.aborted) return;
        continueGrid.innerHTML = '';
        continueSection.hidden = true;
      }
    }

    // v1.102 (tranche 4 shimmer): the cover images ship `art-shimmer`; the shared
    // decode-reveal clears each the instant it decodes (immediately for a cached
    // cover, so a warm image never shimmers forever under a visible picture).
    // v1.339 (L2): the on-screen covers reveal TOGETHER (common.js revealArtTogether:
    // all decoded or errored, or its cap), off-screen per image; shimmerArt fallback.
    function revealBookArt(scope) {
      const ft = typeof window !== 'undefined' ? window.FileTube : null;
      if (!ft) return;
      if (typeof ft.revealArtTogether === 'function') ft.revealArtTogether(scope, { signal });
      else if (typeof ft.shimmerArt === 'function') ft.shimmerArt(scope);
    }

    // The selected shelf's Pin toggle (T10: shelves join the pinned-playlists sidebar).
    // One concept everywhere (F32): the keep / keep.fill plain toggle, "Pin shelf" /
    // "Pinned". Only a selected shelf has one; the All view has nothing to pin.
    function renderShelfPin(chip) {
      if (!pinHost) return;
      pinHost.replaceChildren();
      if (!chip || !ui) return;
      const btn = ui.button({ variant: 'plain', size: 'sm', icon: { off: 'keep', on: 'keep.fill' },
        labels: ['Pin shelf', 'Pinned'], pressed: chip.pinned === true, doc });
      btn.id = 'books-shelf-pin-btn';
      btn.title = chip.pinned ? 'Unpin shelf from the sidebar' : 'Pin shelf to the sidebar';
      btn.addEventListener('click', () => {
        if (btn.getAttribute('aria-busy') === 'true') return;
        ui.setBusy(btn, true);
        const request = chip.pinned
          ? fetch(`/api/books/pins/${encodeURIComponent(chip.pinId)}`, { method: 'DELETE' })
          : fetch('/api/books/pins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dir: chip.dir, label: chip.name }),
          });
        request.then(() => {
          if (signal.aborted) return;
          loadShelfChips();
          // Gate fix (QA S7): the sidebar + Playlists sheet reflect the
          // pin change immediately, not on the next full load.
          if (typeof refreshAllPinSurfaces === 'function') refreshAllPinSurfaces();
        }).catch(() => {
          if (!signal.aborted) ui.setBusy(btn, false);
        });
      }, { signal });
      pinHost.appendChild(btn);
    }

    async function loadShelfChips() {
      if (!chipsHost) return;
      try {
        const payload = await fetchJson('/api/books/folders');
        if (signal.aborted) return;
        const chips = deriveShelfChips(payload.folders);
        chipsHost.replaceChildren();
        renderShelfPin(null);
        if ((chips.length < 2 && !rootFilter) || !ui) return; // one folder = no useful filter chips
        const filterChip = (label, selected, url) => ui.chip({ kind: 'filter', label, selected,
          onClick: () => { if (!selected) go(url); }, doc });
        chipsHost.appendChild(filterChip('All', !rootFilter, '/books'));
        for (const chip of chips) {
          const selected = rootFilter === chip.dir;
          chipsHost.appendChild(filterChip(`${chip.name} (${chip.count})`, selected, `/books?root=${encodeURIComponent(chip.dir)}`));
          if (selected) renderShelfPin(chip);
        }
      } catch (_) {
        if (signal.aborted) return;
        chipsHost.replaceChildren();
        renderShelfPin(null);
      }
    }

    loadBooks().catch((err) => {
      console.error('Books: failed to load library:', err);
      showState(bookLibraryState({ failed: true }));
    });
    loadContinueShelf().catch(() => {});
    loadShelfChips().catch(() => {});
  }

  function destroy() {
    if (controller) controller.abort();
    controller = null;
    // The sort menu lives on <body>, outside #view-root: an in-app nav must not strand it.
    if (openMenu && openMenu.isOpen()) openMenu.close();
    openMenu = null;
  }

  if (window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('books', { init, destroy });
  }
})();
