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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildCardDownloadHref,
    buildCardDownloadFilename,
  };
}

// Wrapped in its own IIFE so its helpers (escapeHtml, renderSorted, etc.)
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
    const sortSelect = root.querySelector('#sort-select');
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
    // disarmCardDelete()) at the top of every renderMediaGrid() call, since a
    // re-render replaces the grid's children -- an armed reference to a
    // about-to-be-detached node must never leak/double-fire across it.
    let armState = 'idle';
    let armedBtn = null;
    let armDisarmTimer = null;
    const CARD_ARM_TIMEOUT_MS = 3000;

    // Sort preference persists across visits
    let currentItems = [];
    let folderSettings = {}; // { "<path>": { name, hidden, hiddenFromSidebar } } — for author display, shared with cards
    let currentSort = localStorage.getItem('filetube_sort') || 'newest';
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

    if (searchQuery) {
      if (searchInput) searchInput.value = searchQuery;
      videosHeader.textContent = `Search Results for "${searchQuery}"`;
    } else if (folderFilter) {
      videosHeader.textContent = `Playlist: ${folderFilter}`;
    }

    // Load configuration and files
    async function loadLibrary() {
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
        if (!searchQuery && !folderFilter && !rootFilter) {
          try {
            const settingsRes = await fetch('/api/settings');
            const settingsData = await settingsRes.json();
            rootFilter = resolveDefaultView(rootFilter, searchQuery, folderFilter, settingsData.defaultView, folders);
          } catch (err) {
            console.error('Failed to load default view setting:', err);
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

        // 3. Fetch and render media files
        let apiUrl = `/api/videos`;
        const queryParams = [];
        if (searchQuery) queryParams.push(`search=${encodeURIComponent(searchQuery)}`);
        if (folderFilter) queryParams.push(`folder=${encodeURIComponent(folderFilter)}`);
        if (rootFilter) queryParams.push(`root=${encodeURIComponent(rootFilter)}`);

        if (queryParams.length > 0) {
          apiUrl += `?${queryParams.join('&')}`;
        }

        const mediaRes = await fetch(apiUrl);
        currentItems = await mediaRes.json();

        renderSorted();

      } catch (err) {
        console.error('Failed to load library data:', err);
        videoGrid.innerHTML = `<div style="padding: 20px; color: var(--yt-red); font-weight: bold;">Error loading library data from server.</div>`;
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
      if (visibleFolders.length === 0) {
        sidebarFoldersList.innerHTML = '<div style="padding: 6px 24px; font-style: italic; color: var(--text-secondary);">None</div>';
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

    // Sort the current items by the selected option, then render. `random`
    // (item 1, v1.14.0) shuffles a fresh order on EVERY call -- including the
    // initial load and each "shuffle again" click -- since the shuffle order
    // itself is ephemeral (only the `random` sort PREFERENCE persists).
    //
    // C3 (v1.24.0, T3-WIRE): the persisted format-filter preference is
    // applied BEFORE sorting -- every home/folder/playlist/channel view funnels
    // through this one function, so filtering here covers all of them.
    // C2 (v1.24.0, T3-WIRE): the item-count badge reflects the SAME
    // already-filtered `items` the grid actually renders, never a separately
    // computed count. Both `renderItemCountBadge`/`renderFormatToggle` are
    // idempotent (see common.js) -- safe to call on every render (initial
    // load, sort change, shuffle-again, post-delete re-render) without ever
    // accumulating duplicate badges/toggles.
    function renderSorted() {
      const filtered = filterByMediaType(currentItems, getStoredFormatFilter());
      const items = sortItems(filtered, currentSort);
      renderItemCountBadge(videosHeader, items);
      renderFormatToggle(sectionActions, getStoredFormatFilter(), () => renderSorted());
      renderMediaGrid(items);
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
    // `currentItems` and re-rendered via the SAME `renderSorted()`/
    // `renderMediaGrid()` path every other library refresh already uses --
    // no `window.location.reload()`/full navigation.
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
          renderSorted();
          showToast('File deleted.');
        } else {
          showToast('Error deleting file: ' + (data.error || 'unknown error'));
        }
      } catch (err) {
        console.error('Failed to delete video from card:', err);
        showToast('Network error occurred while trying to delete file.');
      }
    }

    // Render media items in the grid
    function renderMediaGrid(items) {
      // Any re-render replaces the grid's children -- an armed reference to
      // a node that's about to be detached must never leak/double-fire
      // across it (hard constraint: reset arm state on re-render).
      disarmCardDelete();

      if (items.length === 0) {
        videoGrid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-secondary); font-size: 14px;">
            No video or audio files found.
            ${searchQuery || folderFilter ? '<br><a href="/" style="display: inline-block; margin-top: 12px;" class="btn">View All Media</a>' : ''}
          </div>
        `;
        return;
      }

      videoGrid.innerHTML = items.map(item => {
        const views = getMockViews(item.id, item.size);
        const relativeTime = formatRelativeTime(item.addedAt);
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
            <a href="/watch.html?v=${item.id}" class="thumbnail-container">
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
            <div class="video-info">
              <a href="/watch.html?v=${item.id}" class="video-title" title="${escapeHtml(item.title)}">
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
      }).join('');
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

    if (sortSelect) {
      sortSelect.value = currentSort;
      updateShuffleButtonVisibility();
      sortSelect.addEventListener('change', () => {
        currentSort = sortSelect.value;
        localStorage.setItem('filetube_sort', currentSort);
        updateShuffleButtonVisibility();
        renderSorted();
      }, { signal });
    }

    // "Shuffle again" re-roll (item 1, v1.14.0): re-randomizes the visible
    // order in place WITHOUT changing the selected sort or its persisted
    // localStorage value -- renderSorted() re-shuffles on every call while
    // currentSort === 'random'.
    if (shuffleAgainBtn) {
      shuffleAgainBtn.addEventListener('click', () => {
        renderSorted();
      }, { signal });
    }

    rescanBtn.addEventListener('click', async () => {
      rescanBtn.innerHTML = '<i class="icon-refresh"></i> <span class="btn-label">Scanning...</span>';
      rescanBtn.disabled = true;
      try {
        const res = await fetch('/api/scan', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          window.location.reload();
        } else {
          alert('Failed to rescan: ' + data.error);
          rescanBtn.innerHTML = '<i class="icon-refresh"></i> <span class="btn-label">Rescan Files</span>';
          rescanBtn.disabled = false;
        }
      } catch (err) {
        console.error(err);
        alert('Network error trigger scanner.');
        rescanBtn.innerHTML = '<i class="icon-refresh"></i> <span class="btn-label">Rescan Files</span>';
        rescanBtn.disabled = false;
      }
    }, { signal });

    // v1.17.0 FR-3(b), T2: ONE delegated click listener on #video-grid (never
    // per-card -- the grid's children are fully replaced on every
    // renderMediaGrid() call, so a per-card listener would leak/duplicate).
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
    fetch('/api/subscriptions/pins')
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((pins) => renderPinnedSidebar(pins));

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
    restoreSidebarFn = null;
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
