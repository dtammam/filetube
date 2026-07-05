// FileTube Main Page Logic

document.addEventListener('DOMContentLoaded', () => {
  const videoGrid = document.getElementById('video-grid');
  const welcomeMessage = document.getElementById('welcome-message');
  const libraryContent = document.getElementById('library-content');
  const sidebarFoldersList = document.getElementById('sidebar-folders-list');
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const rescanBtn = document.getElementById('rescan-library-btn');
  const videosHeader = document.getElementById('videos-section-header');
  const sortSelect = document.getElementById('sort-select');

  // Sort preference persists across visits
  let currentItems = [];
  let folderSettings = {}; // { "<path>": { name, hidden } } — for author display, shared with cards
  let currentSort = localStorage.getItem('filetube_sort') || 'newest';

  // Parse URL query params
  const urlParams = new URLSearchParams(window.location.search);
  const searchQuery = urlParams.get('search') || '';
  const folderFilter = urlParams.get('folder') || '';
  const rootFilter = urlParams.get('root') || ''; // mapped folder (recursive)

  if (searchQuery) {
    searchInput.value = searchQuery;
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

  // Render folders in the sidebar
  function renderSidebarFolders(folders, settings = {}) {
    if (folders.length === 0) {
      sidebarFoldersList.innerHTML = '<div style="padding: 6px 24px; font-style: italic; color: var(--text-secondary);">None</div>';
      return;
    }

    sidebarFoldersList.innerHTML = folders.map(f => {
      const folderName = f.split(/[\\/]/).pop() || f;
      const label = (settings[f] && settings[f].name) || folderName;
      const isActive = rootFilter === f ? 'active' : '';
      // ?root= shows everything under the mapped folder, including subfolders.
      return `
        <a href="/?root=${encodeURIComponent(f)}" class="sidebar-item ${isActive}" title="${escapeHtml(f)}">
          <i class="icon-folder"></i> ${escapeHtml(label)}
        </a>
      `;
    }).join('');
  }

  // Sort the current items by the selected option, then render.
  function renderSorted() {
    const items = [...currentItems];
    switch (currentSort) {
      case 'oldest': items.sort((a, b) => a.addedAt - b.addedAt); break;
      case 'title-asc': items.sort((a, b) => (a.title || '').localeCompare(b.title || '')); break;
      case 'title-desc': items.sort((a, b) => (b.title || '').localeCompare(a.title || '')); break;
      case 'size-desc': items.sort((a, b) => (b.size || 0) - (a.size || 0)); break;
      case 'size-asc': items.sort((a, b) => (a.size || 0) - (b.size || 0)); break;
      case 'newest':
      default: items.sort((a, b) => b.addedAt - a.addedAt); break;
    }
    renderMediaGrid(items);
  }

  // Render media items in the grid
  function renderMediaGrid(items) {
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

  // Search trigger helper
  function performSearch() {
    const query = searchInput.value.trim();
    if (query) {
      window.location.href = `/?search=${encodeURIComponent(query)}`;
    } else {
      window.location.href = '/';
    }
  }

  // Event Listeners
  searchBtn.addEventListener('click', performSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });

  if (sortSelect) {
    sortSelect.value = currentSort;
    sortSelect.addEventListener('change', () => {
      currentSort = sortSelect.value;
      localStorage.setItem('filetube_sort', currentSort);
      renderSorted();
    });
  }

  rescanBtn.addEventListener('click', async () => {
    rescanBtn.innerHTML = '<i class="icon-refresh"></i> Scanning...';
    rescanBtn.disabled = true;
    try {
      const res = await fetch('/api/scan', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        window.location.reload();
      } else {
        alert('Failed to rescan: ' + data.error);
        rescanBtn.innerHTML = '<i class="icon-refresh"></i> Rescan Files';
        rescanBtn.disabled = false;
      }
    } catch (err) {
      console.error(err);
      alert('Network error trigger scanner.');
      rescanBtn.innerHTML = '<i class="icon-refresh"></i> Rescan Files';
      rescanBtn.disabled = false;
    }
  });

  // Start initialization
  loadLibrary();
});
