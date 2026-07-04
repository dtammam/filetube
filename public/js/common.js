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
// 🌙/☀️ icon to reflect the current mode.
function applyTheme(era, mode) {
  const d = document.documentElement;
  d.setAttribute('data-theme', era);
  d.setAttribute('data-mode', mode);
  try {
    localStorage.setItem('ft-era', era);
    localStorage.setItem('ft-mode', mode);
  } catch (_) { /* storage disabled (private mode/sandbox) — attributes still applied */ }
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.innerHTML = mode === 'dark' ? '☀️' : '🌙';
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

// Header 🌙/☀️ button: flips data-mode only, never touches data-theme (era
// selection lives solely in the setup-page picker).
function toggleTheme() {
  const d = document.documentElement;
  const mode = d.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
  const era = d.getAttribute('data-theme') || DEFAULT_ERA;
  applyTheme(era, mode);
}

// Setup-page Appearance picker: changes era only, keeps the current mode.
function setTheme(era) {
  const mode = document.documentElement.getAttribute('data-mode') || DEFAULT_MODE;
  applyTheme(era, mode);
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

// Resolve the "channel"/author name for a media item, the same way everywhere:
// the mapped folder's friendly display name (if set), else the file's artist
// tag, else the immediate folder name. Keeps the list cards and the watch page
// in agreement (both call this).
function resolveChannelName(item, folderSettings) {
  const settings = folderSettings || {};
  const mapped = settings[item.rootFolder] && settings[item.rootFolder].name;
  return mapped || item.artist || item.folderName || 'Library';
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
});
}

// Expose pure helpers to Node for unit testing (browsers ignore this block —
// `module` is undefined there).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getStarRating, getCommentCount, resolveChannelName, clampPositionState,
    resolveTheme, THEME_REGISTRY
  };
}
