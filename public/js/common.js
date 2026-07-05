// Shared Utility Functions for FileTube

// ---- Era theme system ----------------------------------------------------
// Two orthogonal axes applied to <html>: data-theme (era) and data-mode
// (light|dark). See docs/exec-plans/active/era-themes.md for the full design.

const THEME_MODES = ['light', 'dark'];
const DEFAULT_ERA = '2021';
const DEFAULT_MODE = 'light';

// Single source of truth for both the setup-page Appearance picker and the
// switching logic. Adding a 5th era = one entry here + one CSS block pair.
const THEME_REGISTRY = [
  { id: '2005', name: 'Original', year: 2005,
    blurb: 'Plain HTML, sharp corners, blue underlined links.',
    swatch: ['#ffffff', '#0000cc'] },
  { id: '2009', name: 'Classic', year: 2009,
    blurb: 'Warm grays and glossy red chrome.',
    swatch: ['#f0f0f0', '#cc0000'] },
  { id: '2014', name: 'Flat', year: 2014,
    blurb: 'Clean flat white with a brighter red.',
    swatch: ['#ffffff', '#e62117'] },
  { id: '2021', name: 'Modern', year: 2021,
    blurb: 'Rounded cards and Roboto — today\'s look.',
    swatch: ['#ffffff', '#cc0000'] }
];

// Valid era ids derived from the registry — adding an entry above makes it valid
// automatically. (The inline FOUC scripts in <head> keep their own copy of this
// list, since they must run before common.js loads.)
const THEME_ERAS = THEME_REGISTRY.map((t) => t.id);

// Pure: resolves the stored era/mode (with legacy-key migration) into a safe
// { era, mode } pair. Never throws; never returns an unset axis. Exported for
// node:test — see test/unit/resolve-theme.test.js. Kept in sync with the
// inline FOUC bootstrap in <head> on index.html/setup.html/watch.html.
function resolveTheme(storedEra, storedMode, legacyTheme) {
  const era = THEME_ERAS.includes(storedEra) ? storedEra : DEFAULT_ERA;
  let mode;
  if (THEME_MODES.includes(storedMode)) {
    mode = storedMode;                       // valid new key wins
  } else if (storedEra == null && storedMode == null &&
             (legacyTheme === 'dark' || legacyTheme === 'light')) {
    mode = legacyTheme;                      // one-time migration of legacy `theme`
  } else {
    mode = DEFAULT_MODE;                     // missing/corrupt -> fail safe
  }
  return { era, mode };
}

// Applies both attributes + persists both keys. Also flips the header
// moon/sun icon to reflect the current mode.
function applyTheme(era, mode) {
  const d = document.documentElement;
  d.setAttribute('data-theme', era);
  d.setAttribute('data-mode', mode);
  try {
    localStorage.setItem('ft-era', era);
    localStorage.setItem('ft-mode', mode);
  } catch (_) { /* storage disabled (private mode/sandbox) — attributes still applied */ }
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    btn.innerHTML = mode === 'dark'
      ? '<i class="icon-sun"></i>'
      : '<i class="icon-moon"></i>';
  }
  if (typeof updateNavThemeItem === 'function') updateNavThemeItem();
}

// Runs on DOMContentLoaded: resolves stored/legacy state and (re-)applies it,
// completing the legacy `theme` -> ft-era/ft-mode migration on first load.
function initTheme() {
  let e = null, m = null, legacy = null;
  try {
    e = localStorage.getItem('ft-era');
    m = localStorage.getItem('ft-mode');
    legacy = localStorage.getItem('theme');
  } catch (_) { /* storage unavailable — fall through to safe defaults */ }
  const { era, mode } = resolveTheme(e, m, legacy);
  applyTheme(era, mode);
}

// Header moon/sun button: flips data-mode only, never touches data-theme (era
// selection lives solely in the setup-page picker).
function toggleTheme() {
  const d = document.documentElement;
  const mode = d.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
  const era = d.getAttribute('data-theme') || DEFAULT_ERA;
  applyTheme(era, mode);
}

// Setup-page Appearance picker: changes era only, keeps the current mode.
// Also re-runs icon-set resolution (below): an `auto` ft-icons preference
// must recompute against the NEW era immediately, since resolveIconSet() maps
// era -> concrete set. toggleTheme() never changes era, so it never needs
// this call.
function setTheme(era) {
  const mode = document.documentElement.getAttribute('data-mode') || DEFAULT_MODE;
  applyTheme(era, mode);
  let pref = null;
  try { pref = localStorage.getItem('ft-icons'); } catch (_) { /* fall through to default */ }
  applyIconSet(pref);
}

// ---- Icon-set system ------------------------------------------------------
// A third, orthogonal appearance axis (theme x mode x icon-set) layered on
// top of the era/mode system above, with no change to resolveTheme/
// applyTheme/toggleTheme. See docs/exec-plans/active/icon-sets.md for the
// full design. Two axes: a persisted `ft-icons` preference (one of the 4
// concrete sets, or the meta-value 'auto') and a `data-icons` attribute on
// <html> that always holds one of the 4 CONCRETE values — 'auto' is never
// written to data-icons.

const ICON_SETS = ['outlined', 'rounded', 'filled', 'emoji'];
const DEFAULT_ICON_SET = 'outlined';
const AUTO_ERA_ICON_MAP = { '2005': 'emoji', '2009': 'emoji', '2014': 'filled', '2021': 'rounded' };

// Single source of truth for the setup-page Icons picker. Auto listed first.
const ICON_SET_REGISTRY = [
  { id: 'auto', name: 'Auto', blurb: 'Matches the icon style to whichever era you\'ve picked.' },
  { id: 'outlined', name: 'Outlined', blurb: 'Material Symbols Outlined — today\'s default look.' },
  { id: 'rounded', name: 'Rounded', blurb: 'Material Symbols Rounded — a softer, modern style.' },
  { id: 'filled', name: 'Filled', blurb: '2014-flavored solid Material icons — the original flat era.' },
  { id: 'emoji', name: 'Emoji', blurb: 'The original emoji glyphs — \u{1F3E0} \u{1F4C1} \u{2699}\u{FE0F} and friends.' }
];

// Pure: resolves a stored icon-set preference (+ the current era, needed only
// for 'auto') into one of the four CONCRETE set ids. Never throws; never
// returns 'auto'. Exported for node:test — see test/unit/resolve-icon-set.test.js.
// Kept in sync with the inline FOUC bootstrap in <head> on
// index.html/setup.html/watch.html (see the comment there).
function resolveIconSet(storedSet, era) {
  if (ICON_SETS.includes(storedSet)) return storedSet;      // valid explicit set
  if (storedSet === 'auto') {                                // meta -> era map
    const e = THEME_ERAS.includes(era) ? era : DEFAULT_ERA;  // invalid era -> DEFAULT_ERA mapping
    return AUTO_ERA_ICON_MAP[e];
  }
  return DEFAULT_ICON_SET;                                    // null/garbage -> outlined
}

// Resolves the pref against the CURRENT era (read from data-theme), sets
// data-icons to the concrete result, and persists the PREF (never the
// resolved value, so 'auto' survives to recompute on future era changes).
function applyIconSet(storedSetPref) {
  const d = document.documentElement;
  const era = d.getAttribute('data-theme') || DEFAULT_ERA;
  d.setAttribute('data-icons', resolveIconSet(storedSetPref, era));
  if (storedSetPref === 'auto' || ICON_SETS.includes(storedSetPref)) {
    try { localStorage.setItem('ft-icons', storedSetPref); }
    catch (_) { /* storage disabled — attribute still applied */ }
  }
  // else: unset/garbage pref -> resolves to 'outlined' but DON'T persist, so a
  // fresh/never-chosen user's ft-icons stays UNSET (avoids writing "null").
  if (typeof renderIconPicker === 'function') renderIconPicker(); // re-highlight if present
}

// Setup-page Icons picker entry (no Save step), mirrors setTheme().
function setIconSet(storedSetPref) {
  applyIconSet(storedSetPref);
}

// DOMContentLoaded: read the stored pref and apply against the loaded era.
function initIconSet() {
  let pref = null;
  try { pref = localStorage.getItem('ft-icons'); } catch (_) { /* fall through to default */ }
  applyIconSet(pref);
}

// Format duration from seconds to MM:SS or HH:MM:SS
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  let result = '';
  if (hrs > 0) {
    result += hrs + ':' + (mins < 10 ? '0' : '');
  }
  result += mins + ':' + (secs < 10 ? '0' : '') + secs;
  return result;
}

// Format file size in bytes to human readable format
function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Format date relative time (e.g. "3 days ago")
function formatRelativeTime(epochMs) {
  if (!epochMs) return 'unknown date';
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const diffMs = epochMs - Date.now();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  
  if (Math.abs(diffDays) < 1) {
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    if (Math.abs(diffHours) < 1) {
      const diffMins = Math.round(diffMs / (1000 * 60));
      return rtf.format(diffMins, 'minute');
    }
    return rtf.format(diffHours, 'hour');
  }
  
  if (Math.abs(diffDays) > 30) {
    const diffMonths = Math.round(diffDays / 30);
    return rtf.format(diffMonths, 'month');
  }
  
  return rtf.format(diffDays, 'day');
}

// GB <-> bytes conversion for the Settings-page "Transcode cache" size-cap
// input: users think in GB, but the API persists/consumes raw bytes
// (`cacheMaxBytes`). Both pure/side-effect-free so they're reusable from the
// setup.html inline script and independently unit-testable.

// '' / null / undefined / non-finite / <=0 -> null, meaning "no override, use
// the default" (mirrors the API's own null = defer-to-env-var contract).
// Otherwise rounds to the nearest whole byte -- EXCEPT a tiny positive input
// that rounds to < 1 byte, which is also clamped to null rather than 0: the
// API rejects cacheMaxBytes:0 with a 400, so posting 0 for "I typed something
// tiny" would surface a misleading validation error instead of just using the
// default.
function gbToBytes(gb) {
  if (gb === '' || gb === null || gb === undefined) return null;
  const n = Number(gb);
  if (!Number.isFinite(n) || n <= 0) return null;
  const bytes = Math.round(n * 1024 * 1024 * 1024);
  if (bytes < 1) return null; // sub-1-byte positive -> "no override", not an invalid 0
  return bytes;
}

// null/undefined/non-finite -> null (no value to display). Otherwise bytes
// converted to GB, rounded to 2 decimal places for a clean input/placeholder value.
function bytesToGb(bytes) {
  if (bytes === null || bytes === undefined) return null;
  const n = Number(bytes);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / (1024 * 1024 * 1024)) * 100) / 100;
}

// Resolve the "channel"/author name for a media item, the same way everywhere:
// the mapped folder's friendly display name (if set), else the file's artist
// tag, else the immediate folder name. Keeps the list cards and the watch page
// in agreement (both call this).
function resolveChannelName(item, folderSettings) {
  const settings = folderSettings || {};
  const mapped = settings[item.rootFolder] && settings[item.rootFolder].name;
  return mapped || item.artist || item.folderName || 'Library';
}

// ---- Related-items similarity ranking (rankRelated) -----------------------
// See docs/exec-plans/active/2026-07-05-audio-art-and-related.md ("Feature 2")
// for the full design/rationale. Pure and deterministic; replaces the
// most-recent/same-folder sort previously inline in watch.js's
// loadRelatedFiles(). Named constants below are the score weights + the
// fallback/result-size guarantees.

const RESULT_COUNT = 10;   // matches today's slice(0, 10)
// "Genuinely similar" guarantee point: whenever fewer than 6 candidates clear
// score > 0, the shortfall is filled from the most-recent tail (today's exact
// fallback behavior). NOTE: there is no literal `if (similar.length <
// SIMILAR_FLOOR)` branch below — rankRelated always concatenates
// similar + recent and slices to RESULT_COUNT, a safe superset that satisfies
// this guarantee unconditionally (recent already contains every candidate, so
// the guarantee holds whether similar has 0, 5, or 50 entries). SIMILAR_FLOOR
// exists to document/name that guarantee point, not to gate a code path.
const SIMILAR_FLOOR = 6;
const W_TOKEN = 3;   // per shared title/filename/tag token (primary signal)
const W_FOLDER = 2;  // same non-empty folderName (secondary signal)
const W_CHANNEL = 1; // same resolved channel/artist, cross-folder only (tertiary)

// Small, fixed stopword set: articles/conjunctions/prepositions plus common
// media-noise tokens that would otherwise inflate "similarity" on every item.
const RANK_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'feat', 'ft', 'official', 'video', 'audio', 'hd', 'mp3', 'mp4', 'avi',
  'mkv', 'mov', 'webm'
]);

// Lowercase, split on non-alphanumeric runs, drop <2-char tokens and the
// stopword set above, dedupe. Never throws; non-string/empty input yields an
// empty Set. Exported for node:test — see test/unit/rank-related.test.js.
function tokenize(str) {
  const tokens = new Set();
  if (typeof str !== 'string' || !str) return tokens;
  const parts = str.toLowerCase().split(/[^a-z0-9]+/);
  for (const part of parts) {
    if (part.length < 2) continue;
    if (RANK_STOPWORDS.has(part)) continue;
    tokens.add(part);
  }
  return tokens;
}

// An item's token set = tokenize(title) UNION tokenize(basename of filePath)
// UNION tokenize(the tags field). tags is optional; missing/null contributes
// nothing. tags may be:
//  - an OBJECT (the real /api/videos shape, e.g. { artist, album, title,
//    comment, date, ... } from server.js's parseFfprobeTags) -> tokenize the
//    joined string VALUES (Object.values filtered to strings), so embedded
//    artist/album/title metadata contributes to similarity;
//  - an ARRAY (kept for safety/forward-compat) -> tokenize each entry;
//  - a plain STRING -> tokenize it directly.
// Missing title/filePath contribute nothing. Never throws.
function relatedItemTokens(item) {
  const tokens = new Set();
  if (!item) return tokens;
  for (const t of tokenize(item.title)) tokens.add(t);
  if (typeof item.filePath === 'string' && item.filePath) {
    const base = item.filePath.split(/[\\/]/).pop() || '';
    for (const t of tokenize(base)) tokens.add(t);
  }
  const tags = item.tags;
  if (tags && typeof tags === 'object' && !Array.isArray(tags)) {
    const values = Object.values(tags).filter((v) => typeof v === 'string');
    for (const t of tokenize(values.join(' '))) tokens.add(t);
  } else if (Array.isArray(tags)) {
    for (const tag of tags) {
      for (const t of tokenize(tag)) tokens.add(t);
    }
  } else if (typeof tags === 'string') {
    for (const t of tokenize(tags)) tokens.add(t);
  }
  return tokens;
}

function sharedTokenCount(setA, setB) {
  let count = 0;
  for (const t of setA) if (setB.has(t)) count++;
  return count;
}

// Explicit total-order tie-break: addedAt DESC (missing sorts as oldest), then
// id ASC. Used both as the similar-set secondary sort and as the whole-list
// "recent" fallback order — never relies on Array.sort's stability alone.
function byRecencyThenId(a, b) {
  const aAdded = Number.isFinite(a.addedAt) ? a.addedAt : -Infinity;
  const bAdded = Number.isFinite(b.addedAt) ? b.addedAt : -Infinity;
  if (bAdded !== aAdded) return bAdded - aAdded;
  const aId = String(a.id || '');
  const bId = String(b.id || '');
  if (aId < bId) return -1;
  if (aId > bId) return 1;
  return 0;
}

// Pure. Returns an ordered array of related items (never the current item),
// best-match first, padded with most-recent so the result is never empty and
// never worse than today's most-recent/same-folder list. Length capped at
// RESULT_COUNT. Deterministic for identical input: score DESC, then addedAt
// DESC, then id ASC (see byRecencyThenId) — an explicit total order, not
// left to sort stability.
function rankRelated(currentItem, allItems) {
  const current = currentItem || {};
  const items = Array.isArray(allItems) ? allItems : [];
  const candidates = items.filter((item) => item && item !== current && item.id !== current.id);
  if (candidates.length === 0) return [];

  const currentTokens = relatedItemTokens(current);
  const currentChannel = resolveChannelName(current);
  const currentFolder = current.folderName || '';
  // W_CHANNEL requires an ACTUAL channel signal on both sides, not just a
  // resolveChannelName() match — resolveChannelName falls back to the literal
  // string 'Library' when an item has neither artist nor folderName, so two
  // otherwise-unrelated items that are both missing artist+folderName would
  // both resolve to 'Library' and spuriously "match". Guarding on the raw
  // inputs (rather than coupling to resolveChannelName's internal default)
  // keeps that degenerate case out of the similar bucket.
  const currentHasChannelSignal = !!(current.artist || current.folderName);

  const scored = candidates.map((item) => {
    const shared = sharedTokenCount(currentTokens, relatedItemTokens(item));
    const itemFolder = item.folderName || '';
    const sameFolder = !!currentFolder && !!itemFolder && currentFolder === itemFolder;
    let score = W_TOKEN * shared;
    if (sameFolder) score += W_FOLDER;
    const itemHasChannelSignal = !!(item.artist || item.folderName);
    if (!sameFolder && currentHasChannelSignal && itemHasChannelSignal &&
        resolveChannelName(item) === currentChannel) {
      score += W_CHANNEL;
    }
    return { item, score };
  });

  const byScoreThenRecency = (a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return byRecencyThenId(a.item, b.item);
  };

  const similar = scored.filter((s) => s.score > 0).sort(byScoreThenRecency).map((s) => s.item);
  const recent = candidates.slice().sort(byRecencyThenId); // today's ordering — the fallback pool

  const result = [];
  const seen = new Set();
  for (const item of [...similar, ...recent]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
    if (result.length >= RESULT_COUNT) break;
  }
  return result;
}

// Deterministic "rating" for a media item: a stable 3–5 stars derived from its
// id. Pure and side-effect free, so the SAME item shows the SAME star count on
// the home card and on its own watch page (a fun cosmetic touch, not a real
// user rating).
function getStarRating(id) {
  const s = String(id || '');
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  return (sum % 3) + 3; // 3, 4, or 5
}

// Deterministic per-item comment count (4–14): a given video always shows the
// same number of mock comments, but different videos vary. Clamped to the pool
// size so we never ask for more comments than exist.
function getCommentCount(id, poolSize) {
  const s = String(id || '');
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  const count = 4 + (sum % 11); // 4..14
  return poolSize ? Math.min(count, poolSize) : count;
}

// Validate/clamp inputs for MediaSession.setPositionState, which THROWS on bad
// values (non-finite or <= 0 duration, position > duration, etc.). Returns a safe
// { duration, position, playbackRate } — or null when it can't be represented
// (e.g. a live/streaming source with unknown duration) so callers skip the call
// entirely rather than throw. Pure.
function clampPositionState(duration, position, playbackRate) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  let pos = Number(position);
  if (!Number.isFinite(pos) || pos < 0) pos = 0;
  if (pos > duration) pos = duration;
  let rate = Number(playbackRate);
  if (!Number.isFinite(rate) || rate <= 0) rate = 1;
  return { duration, position: pos, playbackRate: rate };
}

// Mock uploader subscriptions counts (based on uploader name length to make it deterministic but diverse)
function getMockSubCount(uploaderName) {
  const code = uploaderName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const count = (code * 17) % 85000 + 150;
  if (count > 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return count;
}

// Mock views counts (based on size/addedAt, deterministic)
function getMockViews(mediaId, sizeBytes) {
  const code = parseInt(mediaId.substring(0, 6), 16) || 0;
  const count = (code + (sizeBytes % 10000)) % 120000 + 12;
  return count.toLocaleString() + ' views';
}

// ---- Mobile app shell: bottom nav / Playlists sheet -----------------------

// Pure: which bottom-nav item should be marked active for the current route.
// Home covers "/" and "/index.html" incl. any query (?search=, ?root=,
// ?folder= are all still the home grid). Settings covers "/setup.html".
// watch.html (and anything else) has no active item. Exported for node:test.
function activeNavItem(pathname, search) {
  if (pathname === '/setup.html') return 'settings';
  if (pathname === '/' || pathname === '/index.html') return 'home';
  return null;
}

// Small local HTML-escape mirroring the per-page escapeHtml helpers, used only
// by renderPlaylistsSheet so common.js has no dependency on a given page's copy.
function escapeAttr(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Renders the Playlists sheet's folder list — functionally equivalent to the
// existing #sidebar-folders-list (same /?root=<path> links, same folderSettings
// display-name lookup, same hidden-flag parity: the hidden flag only affects
// the home grid via the API, not this list, matching the sidebar today).
function renderPlaylistsSheet(folders, folderSettings) {
  const list = document.getElementById('playlists-sheet-list');
  if (!list) return;
  const settings = folderSettings || {};
  if (!folders || folders.length === 0) {
    list.innerHTML = '<div class="sidebar-item">No folders configured.</div>';
    return;
  }
  list.innerHTML = folders.map((f) => {
    const base = f.split(/[\\/]/).pop() || f;
    const label = (settings[f] && settings[f].name) || base;
    return '<a href="/?root=' + encodeURIComponent(f) +
      '" class="sidebar-item"><i class="icon-folder"></i> ' +
      escapeAttr(label) + '</a>';
  }).join('');
}

// Lazily fetches /api/config on first open, populates the sheet, then reveals
// it. Feature-detects its own elements so it's safe to call on any page.
function openPlaylistsSheet() {
  const backdrop = document.getElementById('playlists-backdrop');
  const sheet = document.getElementById('playlists-sheet');
  if (!backdrop || !sheet) return;
  backdrop.hidden = false;
  sheet.hidden = false;
  // Fetch fresh on every open — /api/config is tiny, and this avoids showing a
  // stale folder list if the library changed during the session.
  fetch('/api/config')
    .then((r) => r.json())
    .then((data) => renderPlaylistsSheet(data.folders || [], data.folderSettings || {}))
    .catch(() => {
      const list = document.getElementById('playlists-sheet-list');
      if (list) list.innerHTML = '<div class="sidebar-item">Failed to load folders.</div>';
    });
}

function closePlaylistsSheet() {
  const backdrop = document.getElementById('playlists-backdrop');
  const sheet = document.getElementById('playlists-sheet');
  if (backdrop) backdrop.hidden = true;
  if (sheet) sheet.hidden = true;
}

// Mirrors the bottom nav's Dark/Light item icon/label to the current data-mode.
// Called from applyTheme(), so it stays in sync no matter how the mode changes
// (nav item, header toggle, or initial load).
function updateNavThemeItem() {
  const item = document.getElementById('nav-theme-toggle');
  if (!item) return;
  const dark = document.documentElement.getAttribute('data-mode') === 'dark';
  const icon = item.querySelector('i');
  const label = item.querySelector('.bottom-nav-label');
  if (icon) icon.className = dark ? 'icon-sun' : 'icon-moon';
  if (label) label.textContent = dark ? 'Light' : 'Dark';
}

// Global modal dialog helpers
function showConfirmModal(title, bodyText, onConfirm) {
  const modalBackdrop = document.createElement('div');
  modalBackdrop.className = 'modal-backdrop';
  
  modalBackdrop.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">${title}</div>
      <div class="modal-body">${bodyText}</div>
      <div class="modal-actions">
        <button class="btn" id="modal-cancel-btn">Cancel</button>
        <button class="btn btn-primary" id="modal-confirm-btn">Confirm</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modalBackdrop);
  
  document.getElementById('modal-cancel-btn').addEventListener('click', () => {
    document.body.removeChild(modalBackdrop);
  });
  
  document.getElementById('modal-confirm-btn').addEventListener('click', () => {
    document.body.removeChild(modalBackdrop);
    onConfirm();
  });
}

// Sidebar toggle responsive menu helper. Guarded so requiring this file in Node
// (for unit tests) never touches `document`.
if (typeof document !== 'undefined') {
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initIconSet();   // reads ft-icons + the just-applied data-theme

  const menuToggle = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.getElementById('main-content');
  
  if (menuToggle && sidebar && mainContent) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('hidden');
      sidebar.classList.toggle('mobile-open');
      mainContent.classList.toggle('expanded');
    });
  }
  
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  }

  // ---- Mobile app shell: bottom nav / Playlists sheet wiring ----
  // Guarded on the nav's presence so pages without it (or load-order issues)
  // never throw.
  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) {
    // Active-state highlight
    const key = activeNavItem(window.location.pathname, window.location.search);
    if (key) {
      const item = bottomNav.querySelector('[data-nav="' + key + '"]');
      if (item) item.classList.add('active');
    }

    // Dark/Light item -> toggleTheme(), then sync its own icon/label
    const themeItem = document.getElementById('nav-theme-toggle');
    if (themeItem) {
      updateNavThemeItem();               // initial state from data-mode
      themeItem.addEventListener('click', () => {
        toggleTheme();
        updateNavThemeItem();
      });
    }

    // Playlists item -> open sheet
    const playlistsBtn = document.getElementById('nav-playlists-btn');
    if (playlistsBtn) playlistsBtn.addEventListener('click', openPlaylistsSheet);

    // Close wiring (feature-detected)
    const backdrop = document.getElementById('playlists-backdrop');
    const closeBtn = document.getElementById('playlists-close');
    if (backdrop) backdrop.addEventListener('click', closePlaylistsSheet);
    if (closeBtn) closeBtn.addEventListener('click', closePlaylistsSheet);
  }
});
}

// Expose pure helpers to Node for unit testing (browsers ignore this block —
// `module` is undefined there).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getStarRating, getCommentCount, resolveChannelName, clampPositionState,
    resolveTheme, THEME_REGISTRY, activeNavItem,
    resolveIconSet, ICON_SET_REGISTRY, ICON_SETS,
    gbToBytes, bytesToGb,
    tokenize, rankRelated, RESULT_COUNT, SIMILAR_FLOOR
  };
}
