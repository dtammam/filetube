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
        <img class="book-cover-img" src="/bookcover/${encodeURIComponent(item.id)}" alt="${escapeBookHtml(item.title)}" loading="lazy" />
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildBookCardHtml, deriveShelfChips, escapeBookHtml };
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
      const data = await fetchJson(`/api/books?${query.toString()}`);
      const items = Array.isArray(data.items) ? data.items : [];
      grid.innerHTML = items.map(buildBookCardHtml).join('');
      if (emptyNote) emptyNote.hidden = items.length > 0;
      return items.length;
    }

    async function loadContinueShelf() {
      // The Continue shelf only decorates the UNFILTERED library view --
      // a shelf/search view IS already a narrowed list.
      if (rootFilter || searchFilter || !continueSection || !continueGrid) return;
      try {
        const data = await fetchJson('/api/books?filter=reading&limit=12');
        const items = Array.isArray(data.items) ? data.items : [];
        continueGrid.innerHTML = items.map(buildBookCardHtml).join('');
        continueSection.hidden = items.length === 0;
      } catch (_) {
        continueSection.hidden = true;
      }
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
            request.then(() => loadShelfChips()).catch(() => {});
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
