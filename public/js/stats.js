'use strict';

// C4 "fun stats" page (v1.24 UX Round, Wave 3) -- a standalone dashboard
// page, NOT registered with the SPA-lite router in common.js (that router
// deliberately only knows the four routes it has always known -- home/
// watch/setup/subscriptions; see deriveRouteView's own comment). A link to
// `/stats.html` therefore falls through to a normal, full-page browser
// navigation (the router's own documented behavior for any route it doesn't
// recognize) rather than an in-app swap -- this page runs its own plain
// DOMContentLoaded boot below, the same progressive-enhancement posture
// every other page's inline boot used before the router existed.
//
// Fetches GET /api/stats ONCE per page load (the route itself computes live,
// server-side, on every request -- see lib/stats.js's header comment) and
// renders it with vanilla DOM. `textContent` only, never `innerHTML`
// (CONTRIBUTING.md) -- every value on this page ultimately comes from
// user-controlled filenames/folder names/titles, so nothing here is ever
// interpreted as markup.
//
// Reuses EXISTING classes only (`.setup-box`, `.theme-picker`/`.theme-card`/
// `.theme-card-name`/`.theme-card-blurb` from the Appearance picker on
// setup.html, `.folder-list-builder` from the folder-management list) --
// this page owns no new CSS (see the T10 task card's client-ownership note).
//
// Deliberately self-contained: common.js already defines equivalent
// `formatDuration`/`formatFileSize`/`formatRelativeTime` globals, but this
// script does NOT reuse them -- doing so would require adding
// `public/js/stats.js` to eslint.config.js's cross-file `globals` allowlist
// (public/js/main.js/watch.js/setup.js/player.js only today), and
// eslint.config.js is outside this task's owned-files list. The small
// formatters below are independent, locally-scoped, and unit-tested here.

// ---- Pure formatting helpers (unit-tested directly, no DOM) ---------------

// A non-negative integer with thousands separators (e.g. `1234` -> `1,234`).
// Deliberately NOT `toLocaleString()` (locale-dependent, so it would be
// non-deterministic across environments) -- a fixed, always-en-US-shaped
// grouping instead. Fails safe to `'0'` on anything non-finite/negative.
function formatCount(n) {
  const value = (typeof n === 'number' && Number.isFinite(n) && n >= 0) ? Math.floor(n) : 0;
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// A compact "days/hours/minutes" readout for a LIBRARY-WIDE total duration
// (which can run into the thousands of hours -- unlike a single item's
// duration, `formatDuration` from common.js's MM:SS/H:MM:SS shape would be
// unreadable at that scale). Shows only the two most significant units so
// the number stays glanceable; fails safe to `'0m'` on anything non-finite/
// negative.
function formatTotalDuration(totalSeconds) {
  const seconds = (typeof totalSeconds === 'number' && Number.isFinite(totalSeconds) && totalSeconds >= 0) ? Math.floor(totalSeconds) : 0;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Human-readable file size (e.g. `1536` -> `1.5 KB`). Mirrors common.js's
// `formatFileSize` shape/rounding exactly, kept as an independent local copy
// (see this file's header comment for why). Fails safe to `'0 B'` on
// anything non-finite/negative.
function formatByteSize(bytes) {
  const value = (typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0) ? bytes : 0;
  if (value === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(k)), units.length - 1);
  return `${parseFloat((value / Math.pow(k, exponent)).toFixed(1))} ${units[exponent]}`;
}

// A single item's playback duration, MM:SS or H:MM:SS (for the Longest/
// Shortest record tiles -- distinct from `formatTotalDuration` above, which
// is for a LIBRARY-WIDE total). Mirrors common.js's `formatDuration` shape,
// kept as an independent local copy (see this file's header comment).
function formatItemDuration(seconds) {
  const value = (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) ? seconds : 0;
  if (value === 0) return '0:00';
  const hrs = Math.floor(value / 3600);
  const mins = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  const paddedSecs = secs < 10 ? `0${secs}` : String(secs);
  if (hrs > 0) return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${paddedSecs}`;
  return `${mins}:${paddedSecs}`;
}

// A relative "N days/hours/minutes ago" readout for the Newest record tile.
// `nowMs` is an injectable "current time" (defaults to `Date.now()`) so this
// stays deterministically unit-testable. Fails safe to `'unknown date'` on a
// missing/non-finite `epochMs`.
function formatRelativeDate(epochMs, nowMs) {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return 'unknown date';
  const now = (typeof nowMs === 'number' && Number.isFinite(nowMs)) ? nowMs : Date.now();
  const diffMs = epochMs - now;
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  if (Math.abs(diffMinutes) < 60) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  if (Math.abs(diffHours) < 24) return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(diffHours, 'hour');
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(diffDays, 'day');
}

// A short, human-friendly label for a channel breakdown row's `channelUrl`
// (a full URL, e.g. `https://www.youtube.com/@somechannel`). Prefers the
// `@handle` shape (the common case); otherwise falls back to the last
// non-empty path segment; otherwise the raw string. Never throws -- a
// malformed URL (or a non-URL string, defensively) just falls through to the
// raw-string fallback rather than crashing the dashboard render.
function shortenChannelLabel(channelUrl) {
  if (typeof channelUrl !== 'string' || channelUrl.trim() === '') return 'Unknown channel';
  try {
    const parsed = new URL(channelUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length > 0) return decodeURIComponent(segments[segments.length - 1]);
    return channelUrl;
  } catch (_) {
    return channelUrl;
  }
}

// ---- DOM rendering (untested-by-necessity, mirrors the rest of the app) ---

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// A `.theme-card`-styled tile (reused verbatim from the Appearance picker --
// see this file's header comment): a big number/label on top, a muted
// caption below. `value`/`caption` are always `textContent`.
function buildStatTile(value, caption) {
  const tile = document.createElement('div');
  tile.className = 'theme-card';
  const valueEl = document.createElement('div');
  valueEl.className = 'theme-card-name';
  valueEl.style.fontSize = '22px';
  valueEl.textContent = value;
  const captionEl = document.createElement('div');
  captionEl.className = 'theme-card-blurb';
  captionEl.textContent = caption;
  tile.appendChild(valueEl);
  tile.appendChild(captionEl);
  return tile;
}

function renderGlanceTiles(root, statsData) {
  clearChildren(root);
  root.appendChild(buildStatTile(formatCount(statsData.count.total), 'Total items'));
  root.appendChild(buildStatTile(formatCount(statsData.count.video), 'Videos'));
  root.appendChild(buildStatTile(formatCount(statsData.count.audio), 'Audio tracks'));
  root.appendChild(buildStatTile(formatTotalDuration(statsData.totalDurationSeconds), 'Total watch time'));
  root.appendChild(buildStatTile(formatByteSize(statsData.totalSizeBytes), 'Total size on disk'));
}

// A single "label ... count / duration / size" row for the folder/channel
// breakdown lists -- a plain flex row (inline-styled, matching the rest of
// this app's ad hoc one-off layout tweaks) rather than a new CSS class.
function buildBreakdownRow(label, group) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 4px; border-bottom:1px solid var(--border-color);';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  labelEl.style.cssText = 'font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
  const valueEl = document.createElement('span');
  valueEl.textContent = `${formatCount(group.count)} · ${formatTotalDuration(group.totalDurationSeconds)} · ${formatByteSize(group.totalSizeBytes)}`;
  valueEl.style.cssText = 'color:var(--text-secondary); font-size:12px; flex-shrink:0;';
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function renderBreakdownList(root, groups, labelFn, emptyMessage) {
  clearChildren(root);
  if (!Array.isArray(groups) || groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'theme-card-blurb';
    empty.textContent = emptyMessage;
    root.appendChild(empty);
    return;
  }
  for (const group of groups) {
    root.appendChild(buildBreakdownRow(labelFn(group), group));
  }
}

function renderRecordTiles(root, statsData) {
  clearChildren(root);
  if (statsData.longest) {
    root.appendChild(buildStatTile(formatItemDuration(statsData.longest.duration), `Longest: ${statsData.longest.title}`));
  }
  if (statsData.shortest) {
    root.appendChild(buildStatTile(formatItemDuration(statsData.shortest.duration), `Shortest: ${statsData.shortest.title}`));
  }
  if (statsData.newest) {
    root.appendChild(buildStatTile(formatRelativeDate(statsData.newest.addedAt), `Newest: ${statsData.newest.title}`));
  }
  if (!statsData.longest && !statsData.shortest && !statsData.newest) {
    root.appendChild(buildStatTile('—', 'No items yet'));
  }
}

function renderMostWatched(root, mostWatched) {
  clearChildren(root);
  if (!Array.isArray(mostWatched) || mostWatched.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'theme-card-blurb';
    empty.textContent = 'No watch data yet — most-watched fills in as you watch things.';
    root.appendChild(empty);
    return;
  }
  mostWatched.forEach((entry, index) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 4px; border-bottom:1px solid var(--border-color);';
    const labelEl = document.createElement('span');
    labelEl.textContent = `${index + 1}. ${entry.title}`;
    labelEl.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    const valueEl = document.createElement('span');
    valueEl.textContent = `${formatCount(entry.viewCount)} views`;
    valueEl.style.cssText = 'color:var(--text-secondary); font-size:12px; flex-shrink:0;';
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    root.appendChild(row);
  });
}

// ---- v1.41.0: Books inventory + About/version section ----------------------

function renderBookTiles(root, books) {
  clearChildren(root);
  const b = books || {};
  const byFormat = b.byFormat || {};
  const epub = byFormat.epub || {};
  const pdf = byFormat.pdf || {};
  root.appendChild(buildStatTile(formatCount(b.count || 0), 'Books'));
  root.appendChild(buildStatTile(formatByteSize(b.totalSizeBytes || 0), 'Total size on disk'));
  root.appendChild(buildStatTile(formatCount(epub.count || 0), 'EPUB'));
  root.appendChild(buildStatTile(formatCount(pdf.count || 0), 'PDF'));
  root.appendChild(buildStatTile(formatCount(b.narratedCount || 0), 'With narration'));
}

// Book folder rows are size-only (books have no duration) -- so a dedicated row
// rather than buildBreakdownRow (which shows a duration segment).
function buildBookFolderRow(group) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 4px; border-bottom:1px solid var(--border-color);';
  const labelEl = document.createElement('span');
  labelEl.textContent = group.folderName;
  labelEl.style.cssText = 'font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
  const valueEl = document.createElement('span');
  valueEl.textContent = `${formatCount(group.count)} · ${formatByteSize(group.totalSizeBytes)}`;
  valueEl.style.cssText = 'color:var(--text-secondary); font-size:12px; flex-shrink:0;';
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function renderBookFolders(root, books) {
  clearChildren(root);
  const groups = (books && Array.isArray(books.byFolder)) ? books.byFolder : [];
  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'theme-card-blurb';
    empty.textContent = 'No books yet — add a book folder in Library Settings.';
    root.appendChild(empty);
    return;
  }
  for (const group of groups) root.appendChild(buildBookFolderRow(group));
}

// A GitHub-style external link. href is always a server-provided repo URL (a
// trusted constant, never user data) with a fixed path; label is fixed text.
function buildRepoLink(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.cssText = 'color:var(--accent, #cc0000); text-decoration:none; font-weight:bold;';
  return a;
}

// One "label ..... value" row where the value can be a text node OR a link.
function buildAboutRow(label, valueNode) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 4px; border-bottom:1px solid var(--border-color);';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  labelEl.style.cssText = 'font-weight:bold;';
  const valueEl = document.createElement('span');
  valueEl.style.cssText = 'color:var(--text-secondary); flex-shrink:0;';
  valueEl.appendChild(valueNode);
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function renderAbout(root, system) {
  clearChildren(root);
  const sys = system || {};
  const repoUrl = (typeof sys.repoUrl === 'string' && sys.repoUrl) ? sys.repoUrl : 'https://github.com/dtammam/filetube';

  // FileTube version -> links to its own release tag.
  if (sys.version) {
    root.appendChild(buildAboutRow('FileTube', buildRepoLink(`${repoUrl}/releases/tag/v${sys.version}`, `v${sys.version}`)));
  }
  // yt-dlp -- shown ONLY when the module is enabled AND a version is known
  // (Dean: if it isn't installed, don't show the row at all).
  if (sys.ytdlp && sys.ytdlp.enabled && sys.ytdlp.version) {
    root.appendChild(buildAboutRow('yt-dlp', document.createTextNode(sys.ytdlp.version)));
  }
  // Text-to-speech -- shown when available; version when known (espeak-ng),
  // otherwise just the engine name (piper's --version isn't trustworthy).
  if (sys.tts && sys.tts.available && sys.tts.engine) {
    const ttsText = sys.tts.version ? `${sys.tts.engine} ${sys.tts.version}` : sys.tts.engine;
    root.appendChild(buildAboutRow('Text-to-speech', document.createTextNode(ttsText)));
  }

  // GitHub links.
  const links = document.createElement('div');
  links.style.cssText = 'display:flex; flex-wrap:wrap; gap:16px; padding:14px 4px 4px;';
  links.appendChild(buildRepoLink(repoUrl, 'GitHub repository'));
  links.appendChild(buildRepoLink(`${repoUrl}/releases`, 'Releases'));
  links.appendChild(buildRepoLink(`${repoUrl}/issues`, 'Report an issue'));
  root.appendChild(links);
}

function renderStatsDashboard(statsData) {
  const glanceRoot = document.getElementById('stats-glance-grid');
  const byTypeRoot = document.getElementById('stats-by-type');
  const folderRoot = document.getElementById('stats-folder-list');
  const channelRoot = document.getElementById('stats-channel-list');
  const recordsRoot = document.getElementById('stats-records-grid');
  const mostWatchedRoot = document.getElementById('stats-most-watched-list');
  const booksRoot = document.getElementById('stats-books-grid');
  const booksFolderRoot = document.getElementById('stats-books-folder-list');
  const aboutRoot = document.getElementById('stats-about');

  if (glanceRoot) renderGlanceTiles(glanceRoot, statsData);
  if (byTypeRoot) {
    clearChildren(byTypeRoot);
    byTypeRoot.appendChild(buildStatTile(`${formatCount(statsData.byType.video.count)} · ${formatTotalDuration(statsData.byType.video.totalDurationSeconds)} · ${formatByteSize(statsData.byType.video.totalSizeBytes)}`, 'Video'));
    byTypeRoot.appendChild(buildStatTile(`${formatCount(statsData.byType.audio.count)} · ${formatTotalDuration(statsData.byType.audio.totalDurationSeconds)} · ${formatByteSize(statsData.byType.audio.totalSizeBytes)}`, 'Audio'));
  }
  if (folderRoot) renderBreakdownList(folderRoot, statsData.byFolder, (g) => g.folderName, 'No folders yet.');
  if (channelRoot) renderBreakdownList(channelRoot, statsData.byChannel, (g) => shortenChannelLabel(g.channelUrl), 'No subscribed-channel content yet.');
  if (recordsRoot) renderRecordTiles(recordsRoot, statsData);
  if (mostWatchedRoot) renderMostWatched(mostWatchedRoot, statsData.mostWatched);
  if (booksRoot) renderBookTiles(booksRoot, statsData.books);
  if (booksFolderRoot) renderBookFolders(booksFolderRoot, statsData.books);
  if (aboutRoot) renderAbout(aboutRoot, statsData.system);
}

function renderStatsError() {
  const glanceRoot = document.getElementById('stats-glance-grid');
  if (!glanceRoot) return;
  clearChildren(glanceRoot);
  const error = document.createElement('div');
  error.className = 'theme-card-blurb';
  error.textContent = 'Could not load stats right now. Try refreshing the page.';
  glanceRoot.appendChild(error);
}

function init() {
  fetch('/api/stats')
    .then((res) => {
      if (!res.ok) throw new Error(`GET /api/stats failed (${res.status})`);
      return res.json();
    })
    .then((statsData) => renderStatsDashboard(statsData))
    .catch((err) => {
      console.error('Failed to load stats:', err);
      renderStatsError();
    });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}

// Guarded so requiring this file in Node (for unit tests) never touches
// `window`/`document` -- mirrors setup.js/player.js's own module.exports guard.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatCount, formatTotalDuration, formatByteSize, formatItemDuration, formatRelativeDate, shortenChannelLabel };
}
