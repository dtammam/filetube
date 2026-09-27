// FileTube Books page (v1.37.0 T8) — registered VIEW MODULE, the main.js
// pattern: `init(root)` runs on both a full page load (progressive
// enhancement via common.js's bootRouter) and an in-app swap into /books;
// every listener binds through ONE per-instance AbortController so
// `destroy()` removes them all. Loaded directly by books.html (a hard load
// needs it immediately) and lazy-loaded by every other shell via
// common.js's ensureViewScriptLoaded.

// ---- Pure, DOM-free helpers (node:test-covered without a browser) ----------

function escapeBookHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// One cover card. `item` is a GET /api/books list item. Progress renders as
// a slim fill bar over the cover bottom (the video-card idiom, portrait).
function buildBookCardHtml(item) {
  const percent = item && item.progress && typeof item.progress.percent === 'number'
    ? Math.min(100, Math.max(0, item.progress.percent))
    : 0;
  const progressBar = percent > 0.5
    ? `<div class="book-progress-track"><div class="book-progress-fill" style="width: ${percent}%"></div></div>`
    : '';
  return `
    <div class="book-card">
      <a href="/read.html?b=${encodeURIComponent(item.id)}" class="book-cover-link">
        <img class="book-cover-img art-shimmer" src="/bookcover/${encodeURIComponent(item.id)}" alt="${escapeBookHtml(item.title)}" loading="lazy" />
        ${progressBar}
      </a>
      <a href="/read.html?b=${encodeURIComponent(item.id)}" class="book-title" title="${escapeBookHtml(item.title)}">${escapeBookHtml(item.title)}</a>
      <div class="book-author">${escapeBookHtml(item.author || '')}</div>
    </div>
  `;
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
// BEFORE the fetch. Reuses the REAL `.book-cover-link` (aspect 2/3) as the
// shimmer box + two skeleton lines, so the swap to real cards is zero-shift.
function buildBookSkeletonCards(n) {
  const count = Number.isInteger(n) && n > 0 ? n : 0;
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="book-card" aria-hidden="true">
        <span class="book-cover-link skeleton-shimmer"></span>
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
  module.exports = { buildBookCardHtml, deriveShelfChips, escapeBookHtml, buildBookSkeletonCards,
    readBooksContinueCount, writeBooksContinueCount, reserveBooksContinueShelf, BOOKS_CONTINUE_COUNT_KEY };
}

(function () {
  if (typeof window === 'undefined') return;
  let controller = null;

  const SORT_STORAGE_KEY = 'filetube_books_sort';

  function readSortPref() {
    try {
      return localStorage.getItem(SORT_STORAGE_KEY) || 'recent';
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

  function init(root) {
    controller = new AbortController();
    const { signal } = controller;

    const grid = root.querySelector('#books-grid');
    const emptyNote = root.querySelector('#books-empty');
    const continueSection = root.querySelector('#books-continue-section');
    const continueGrid = root.querySelector('#books-continue-grid');
    const chipsHost = root.querySelector('#books-shelf-chips');
    const sortSelect = root.querySelector('#books-sort-select');
    const scanBtn = root.querySelector('#books-scan-btn');
    if (!grid) return;

    const params = new URLSearchParams(window.location.search);
    const rootFilter = params.get('root') || '';
    const searchFilter = params.get('search') || '';

    if (sortSelect) {
      sortSelect.value = readSortPref();
      sortSelect.addEventListener('change', () => {
        writeSortPref(sortSelect.value);
        loadBooks().catch(() => {});
      }, { signal });
    }

    if (scanBtn) {
      scanBtn.addEventListener('click', () => {
        scanBtn.disabled = true;
        fetch('/api/books/scan', { method: 'POST' })
          .catch(() => {})
          .finally(() => {
            // Give the (fast at hundreds of books) scan a beat, then refresh.
            setTimeout(() => {
              scanBtn.disabled = false;
              loadBooks().catch(() => {});
            }, 1500);
          });
      }, { signal });
    }

    async function loadBooks() {
      const query = new URLSearchParams();
      query.set('sort', sortSelect ? sortSelect.value : readSortPref());
      query.set('limit', '500');
      if (rootFilter) query.set('root', rootFilter);
      if (searchFilter) query.set('search', searchFilter);
      // v1.98 shimmer sweep: seed the shimmer before the fetch (the reveal is the
      // real-card innerHTML= below); on error clear it so it never strands.
      grid.innerHTML = buildBookSkeletonCards(8);
      try {
        const data = await fetchJson(`/api/books?${query.toString()}`);
        const items = Array.isArray(data.items) ? data.items : [];
        grid.innerHTML = items.map(buildBookCardHtml).join('');
        if (emptyNote) emptyNote.hidden = items.length > 0;
        revealBookArt(grid);
        return items.length;
      } catch (err) {
        grid.innerHTML = '';
        if (emptyNote) emptyNote.hidden = false;
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
        continueGrid.innerHTML = items.map(buildBookCardHtml).join('');
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

    async function loadShelfChips() {
      if (!chipsHost) return;
      try {
        const payload = await fetchJson('/api/books/folders');
        const chips = deriveShelfChips(payload.folders);
        if (chips.length < 2 && !rootFilter) {
          chipsHost.innerHTML = '';
          return; // one folder = no useful filter chips
        }
        chipsHost.innerHTML = '';
        const allChip = document.createElement('a');
        allChip.className = `books-shelf-chip${rootFilter ? '' : ' active'}`;
        allChip.textContent = 'All';
        allChip.href = '/books';
        chipsHost.appendChild(allChip);
        for (const chip of chips) {
          const el = document.createElement('a');
          el.className = `books-shelf-chip${rootFilter === chip.dir ? ' active' : ''}`;
          el.href = `/books?root=${encodeURIComponent(chip.dir)}`;
          el.textContent = `${chip.name} (${chip.count})`;
          // Shelf pin toggle (T10 -- shelves join the pinned-playlists
          // sidebar). Star = pinned state; click posts/deletes the pin.
          const pinBtn = document.createElement('button');
          pinBtn.type = 'button';
          pinBtn.className = `books-shelf-pin-btn${chip.pinned ? ' pinned' : ''}`;
          pinBtn.title = chip.pinned ? 'Unpin shelf' : 'Pin shelf to sidebar';
          pinBtn.textContent = chip.pinned ? '★' : '☆';
          pinBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const request = chip.pinned
              ? fetch(`/api/books/pins/${encodeURIComponent(chip.pinId)}`, { method: 'DELETE' })
              : fetch('/api/books/pins', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dir: chip.dir, label: chip.name }),
              });
            request.then(() => {
              loadShelfChips();
              // Gate fix (QA S7): the sidebar + Playlists sheet reflect the
              // pin change immediately, not on the next full load.
              if (typeof refreshAllPinSurfaces === 'function') refreshAllPinSurfaces();
            }).catch(() => {});
          }, { signal });
          el.appendChild(pinBtn);
          chipsHost.appendChild(el);
        }
      } catch (_) {
        chipsHost.innerHTML = '';
      }
    }

    loadBooks().catch((err) => {
      console.error('Books: failed to load library:', err);
      if (emptyNote) emptyNote.hidden = false;
    });
    loadContinueShelf().catch(() => {});
    loadShelfChips().catch(() => {});
  }

  function destroy() {
    if (controller) controller.abort();
    controller = null;
  }

  if (window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('books', { init, destroy });
  }
})();
