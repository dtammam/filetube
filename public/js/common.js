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

// ---- Audio thumbnail-as-background art (resolveAudioArtUrl) ---------------
// See docs/exec-plans/active/2026-07-05-audio-art-and-related.md ("Feature 1")
// for the full feasibility finding/design. Resolve the background-art image
// URL for an audio item, or null when the item would only resolve to the SVG
// placeholder (no real extracted thumbnail). GET /thumbnail/:id (server.js)
// never 404s, but a stretched 160x90 placeholder makes a poor full-bleed
// background, so callers use null to SKIP the art layer (leave it hidden and
// fall back to today's plain poster/black) rather than stretch the
// placeholder. Pure and deterministic; never throws on a missing/null item.
function resolveAudioArtUrl(item) {
  if (!item || !item.id || !item.hasThumbnail) return null;
  return `/thumbnail/${item.id}`;
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

// ---- Random ("feeling lucky") sort (v1.14.0 item 1) -----------------------

// Pure Fisher-Yates shuffle: returns a NEW array containing every element of
// `items` exactly once, in a uniformly random order -- never mutates the
// input. `rng` defaults to Math.random but accepts an injected deterministic
// generator (a zero-arg function returning a number in [0, 1)) so this is
// unit-testable without relying on real randomness: the SAME rng call
// sequence always produces the SAME output order. Exported for node:test.
function fisherYatesShuffle(items, rng) {
  const rand = typeof rng === 'function' ? rng : Math.random;
  const arr = Array.isArray(items) ? items.slice() : [];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Pure: the same sort switch previously inlined in renderSorted()
// (public/js/main.js), extracted here so every case -- including the new
// `random` option -- is unit-testable without a browser/DOM harness. Returns
// a NEW array; never mutates `items`. `rng` is only consulted for the
// `random` case (see fisherYatesShuffle above). Unrecognized/missing
// `sortKey` falls back to `newest`, matching the pre-existing switch's
// default branch byte-for-byte (AC: existing 5 sorts unchanged).
function sortItems(items, sortKey, rng) {
  const list = Array.isArray(items) ? items.slice() : [];
  switch (sortKey) {
    case 'oldest': list.sort((a, b) => a.addedAt - b.addedAt); return list;
    case 'title-asc': list.sort((a, b) => (a.title || '').localeCompare(b.title || '')); return list;
    case 'title-desc': list.sort((a, b) => (b.title || '').localeCompare(a.title || '')); return list;
    case 'size-desc': list.sort((a, b) => (b.size || 0) - (a.size || 0)); return list;
    case 'size-asc': list.sort((a, b) => (a.size || 0) - (b.size || 0)); return list;
    case 'random': return fisherYatesShuffle(list, rng);
    case 'newest':
    default: list.sort((a, b) => b.addedAt - a.addedAt); return list;
  }
}

// Pure: whether the "shuffle again" re-roll button should be visible for the
// current sort selection -- visible only when `random` is selected. The
// `random` PREFERENCE persists in localStorage exactly like the other sorts;
// the shuffle order itself is ephemeral (re-randomizes on every fresh load
// and on every re-roll click, since sortItems() re-shuffles each call).
// Exported for node:test.
function shouldShowShuffleButton(sortKey) {
  return sortKey === 'random';
}

// ---- Hide-from-sidebar (v1.14.0 item 3) ------------------------------------

// Pure: filters `folders` down to the ones that should appear in a
// left-sidebar-style folder list (the desktop sidebar in main.js/setup.html,
// and the mobile Playlists sheet below), omitting any folder whose
// `folderSettings[path].hiddenFromSidebar` is true. Distinct from (and
// independent of) the existing `hidden` ("Hide from home") flag, which never
// affects either list. A filtered-out folder is NOT removed from `folders`
// itself -- it remains fully reachable via a direct /?root=<path> link; this
// only controls whether a LINK to it is rendered. Exported for node:test.
function visibleSidebarFolders(folders, settings) {
  const list = Array.isArray(folders) ? folders : [];
  const s = settings || {};
  return list.filter((f) => !(s[f] && s[f].hiddenFromSidebar));
}

// ---- Folder drag-and-drop reordering (v1.15.0 item 1) ----------------------
//
// These three pure helpers are the SHARED reorder model behind both the
// native HTML5 drag-and-drop (Setup folder list + left sidebar) and the
// existing up/down `.reorder-btn` fallback -- they mutate/derive the SAME
// `configuredFolders`/`folders` array the up/down buttons already swap
// entries in, so a DnD reorder and an equivalent up/down sequence always
// converge on the identical persisted order. No server change: the existing
// `POST /api/config` handler already derives the synthetic Downloads
// folder's `order` from its POSITION in the submitted `folders` array
// (never writing it into `db.folders` -- see server.js), so these helpers
// only need to produce the same reordered `folders` array the up/down path
// already sends.

// Pure: returns a NEW array with the item at `fromIndex` moved to land at
// `toIndex` (splice-out + splice-in), leaving every other item's relative
// order intact and never mutating the input array. Out-of-range indexes are
// clamped rather than throwing; a no-op (`fromIndex` out of bounds) returns
// an unchanged copy. This is the core "move item from i to j" primitive
// shared by the Setup list's row DnD and the sidebar's visible-subset DnD.
// Exported for node:test.
function moveArrayItem(arr, fromIndex, toIndex) {
  const list = Array.isArray(arr) ? arr.slice() : [];
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= list.length) return list;
  const clampedTo = Math.max(0, Math.min(Number.isInteger(toIndex) ? toIndex : fromIndex, list.length - 1));
  const [item] = list.splice(fromIndex, 1);
  list.splice(clampedTo, 0, item);
  return list;
}

// Pure: converts a drop gesture (source index, the row/item index the user
// dropped ON, and whether the drop targeted the top/before half of that
// row vs the bottom/after half -- the visual drop-indicator's own state)
// into the final index `moveArrayItem` should move the dragged entry to.
// Accounts for the index shift caused by removing the source item before
// re-inserting it. Dropping an item onto itself (`fromIndex === targetIndex`)
// is a no-op (returns `fromIndex`). Exported for node:test.
function computeDropIndex(fromIndex, targetIndex, insertBefore) {
  if (fromIndex === targetIndex) return fromIndex;
  const targetIndexAfterRemoval = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
  return insertBefore ? targetIndexAfterRemoval : targetIndexAfterRemoval + 1;
}

// Pure: rebuilds the FULL folders order after a sidebar drag-and-drop
// reordered only the VISIBLE subset (`visibleSidebarFolders` above) -- a
// folder flagged `hiddenFromSidebar` never appears in the sidebar, so it
// keeps its absolute position in the full array; each slot that held a
// visible folder is filled, in order, from `newVisibleOrder` (the reordered
// visible list, e.g. the output of `moveArrayItem` applied to
// `visibleSidebarFolders(fullFolders, settings)`). `newVisibleOrder` must be
// a permutation of that same visible list (same length/membership, new
// order) -- callers derive it that way, never from an unrelated array. This
// lets the sidebar's immediate-save DnD (no Save button there, unlike the
// Setup list) submit the SAME full-array shape `POST /api/config` expects,
// so the synthetic Downloads folder's position -> `folderSettings.order`
// exactly as the Setup page's up/down buttons already produce. Exported for
// node:test.
function rebuildFullFolderOrder(fullFolders, settings, newVisibleOrder) {
  const full = Array.isArray(fullFolders) ? fullFolders : [];
  const visibleSet = new Set(visibleSidebarFolders(full, settings));
  const queue = Array.isArray(newVisibleOrder) ? newVisibleOrder.slice() : [];
  let i = 0;
  return full.map((f) => (visibleSet.has(f) ? queue[i++] : f));
}

// ---- Default landing view (v1.14.0 item 4) ---------------------------------

// Pure: resolves the EFFECTIVE ?root= folder filter for a home-page load,
// applying the configured `defaultView` (db.settings.defaultView) ONLY on a
// bare load -- no ?search=/?folder=/?root= already present -- and only when
// the stored folder still exists among the currently configured `folders`.
// A deep link (any of searchQuery/folderFilter/rootFilter already set)
// always wins and returns `rootFilter` unchanged; a stored default that no
// longer exists falls back to `rootFilter` (i.e. Most Recent) rather than
// throwing or partially applying. Exported for node:test.
function resolveDefaultView(rootFilter, searchQuery, folderFilter, defaultView, folders) {
  const isBareLoad = !searchQuery && !folderFilter && !rootFilter;
  if (isBareLoad && defaultView && Array.isArray(folders) && folders.includes(defaultView)) {
    return defaultView;
  }
  return rootFilter || '';
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
// "/subscriptions" (the optional yt-dlp module's page, D4) covers
// 'subscriptions' -- this route only ever exists server-side when the module
// is enabled, but the pure mapping itself is unconditional (harmless when the
// route/page never gets served, since nothing then ever navigates there).
// watch.html (and anything else) has no active item. Exported for node:test.
function activeNavItem(pathname, search) {
  if (pathname === '/setup.html') return 'settings';
  if (pathname === '/subscriptions') return 'subscriptions';
  if (pathname === '/' || pathname === '/index.html') return 'home';
  return null;
}

// ---- Optional yt-dlp subscriptions nav-link injection (D4, T5) ------------
//
// The /subscriptions page + its nav link only exist when the OPTIONAL yt-dlp
// module is enabled (docs/exec-plans/active/2026-07-05-yt-dlp-integration-
// module.md, locked decision D4). Rather than a CSS-hidden link that always
// exists in the DOM, the link is injected ONLY on a genuine 2xx from the
// capability probe below -- when the module is disabled the probe's route
// doesn't exist server-side at all (see lib/ytdlp/index.js's registerRoutes,
// gated on isEnabled) so it 404s and `shouldInjectSubscriptionsNav` (below)
// returns false, meaning this function does nothing: the link is
// structurally ABSENT from the DOM, not merely hidden (AC3).
//
// Pure decision extracted to its own function so it is node:test-covered
// without a browser/DOM -- the actual DOM mutation below is a thin,
// untested-by-necessity shell around it (this codebase has no browser/DOM
// test harness for any per-page script; see public/js/main.js, watch.js).
function shouldInjectSubscriptionsNav(response) {
  return Boolean(response && response.ok === true);
}

// Idempotent (checks for an existing injected link first) and defensive --
// missing sidebar/bottom-nav elements (a page that doesn't have them) are
// simply skipped, never thrown on.
function injectSubscriptionsNavLinkIfEnabled() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  if (document.querySelector('[data-nav="subscriptions"]')) return; // already injected

  fetch('/api/subscriptions/health')
    .then((res) => {
      if (!shouldInjectSubscriptionsNav(res)) return; // disabled (404) -- inject nothing

      // Sidebar entry, inserted right after the existing "Library Settings"
      // link so it reads as a sibling settings-adjacent surface.
      const settingsSidebarLink = document.querySelector('a.sidebar-item[href="/setup.html"]');
      if (settingsSidebarLink && settingsSidebarLink.parentElement) {
        const sidebarLink = document.createElement('a');
        sidebarLink.href = '/subscriptions';
        sidebarLink.className = 'sidebar-item';
        const sidebarIcon = document.createElement('i');
        sidebarIcon.className = 'icon-refresh';
        sidebarLink.appendChild(sidebarIcon);
        sidebarLink.appendChild(document.createTextNode(' Subscriptions'));
        settingsSidebarLink.insertAdjacentElement('afterend', sidebarLink);
      }

      // Bottom-nav entry (mobile app shell), inserted right after the
      // existing Settings item.
      const settingsNavItem = document.querySelector('#bottom-nav [data-nav="settings"]');
      if (settingsNavItem && settingsNavItem.parentElement) {
        const navLink = document.createElement('a');
        navLink.href = '/subscriptions';
        navLink.className = 'bottom-nav-item';
        navLink.setAttribute('data-nav', 'subscriptions');
        const navIcon = document.createElement('i');
        navIcon.className = 'icon-refresh';
        const navLabel = document.createElement('span');
        navLabel.className = 'bottom-nav-label';
        navLabel.textContent = 'Subs';
        navLink.appendChild(navIcon);
        navLink.appendChild(navLabel);
        settingsNavItem.insertAdjacentElement('afterend', navLink);

        // Match the existing active-state highlight logic (DOMContentLoaded,
        // below) in case injection resolves after that already ran.
        if (activeNavItem(window.location.pathname, window.location.search) === 'subscriptions') {
          navLink.classList.add('active');
        }
      }
    })
    .catch(() => { /* network/parse failure -- fail closed, inject nothing */ });
}

// ---- v1.15.0 item 3: one-off download header button + compact modal -------
//
// A small header download button + compact modal for one-off yt-dlp
// downloads, gated EXACTLY like the /subscriptions nav-link injection above
// (probe `/api/subscriptions/health`, inject only on a genuine 2xx, fail
// closed on 404/network error) -- when the optional module is disabled,
// nothing is ever created (no button, no modal markup), keeping the header
// byte-identical (docs/exec-plans/active/2026-07-06-v1.15-bigswing.md, item
// 3). Reuses the existing `POST /api/ytdlp/download` one-off endpoint and
// `GET /api/subscriptions/status` live-poll endpoint the /subscriptions
// page's own one-off form already calls -- no server change.
//
// The dropdown option lists below are a deliberate, hardcoded MIRROR of
// `lib/ytdlp/client/subscriptions.js`'s FORMAT_OPTIONS/QUALITY_OPTIONS/
// FILETYPE_OPTIONS (which itself mirrors args.js's server-side allowlists) --
// this file (public/js/common.js) is served unconditionally to every page,
// so it cannot `require()` the gated `lib/ytdlp/client/subscriptions.js`
// module (that file is only ever served via the enabled-gated route). The
// server independently RE-VALIDATES format/quality/filetype on every
// request, so any drift here can only ever be neutralized, never trusted
// as-is. Keep these three lists in sync with subscriptions.js's copies if
// the allowlists ever change.

const ONEOFF_FORMAT_OPTIONS = [
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio only' },
];
const ONEOFF_QUALITY_OPTIONS = ['best', '2160p', '1440p', '1080p', '720p', '480p', '360p'];
const ONEOFF_DEFAULT_QUALITY = 'best';
const ONEOFF_FILETYPE_OPTIONS = {
  video: [
    { value: 'mp4', label: 'MP4 (recommended)' },
    { value: 'mkv', label: 'MKV' },
    { value: 'webm', label: 'WebM' },
    { value: 'default', label: 'Default (yt-dlp)' },
  ],
  audio: [
    { value: 'mp3', label: 'MP3 (recommended)' },
    { value: 'm4a', label: 'M4A' },
    { value: 'opus', label: 'Opus' },
    { value: 'default', label: 'Default (yt-dlp)' },
  ],
};
const ONEOFF_DEFAULT_FILETYPE = { video: 'mp4', audio: 'mp3' };

// ~2.5s poll cadence for the modal's live status, matching subscriptions.js's
// STATUS_POLL_BASE_MS -- consistent cadence across both one-off surfaces.
const ONEOFF_STATUS_POLL_MS = 2500;

// Pure decision, mirroring `shouldInjectSubscriptionsNav` exactly: inject iff
// the health probe resolved with a genuine 2xx. `node:test`-covered directly
// (see test/unit/ytdlp-oneoff-modal.test.js) -- the DOM-mutation half below
// it is a thin, untested-by-necessity shell around it, same posture as the
// subscriptions nav-link injection.
function shouldInjectOneOffButton(response) {
  return Boolean(response && response.ok === true);
}

/**
 * Pure reducer (no DOM): given the CURRENT `format` and the filetype value
 * selected before the format changed, decides the filetype `<select>`'s new
 * option list + selected value. Mirrors
 * `lib/ytdlp/client/subscriptions.js`'s `reduceFiletypeOptions` exactly (see
 * that file's comment for the full rationale) -- duplicated here rather than
 * shared, since this file is served to every page while that one is only
 * ever served by the enabled-gated route.
 */
function reduceOneOffFiletypeOptions(format, prevFiletype) {
  const fmt = format === 'audio' ? 'audio' : 'video';
  const options = ONEOFF_FILETYPE_OPTIONS[fmt];
  const stillValid = options.some((opt) => opt.value === prevFiletype);
  const selected = stillValid ? prevFiletype : ONEOFF_DEFAULT_FILETYPE[fmt];
  return { format: fmt, options, selected };
}

/**
 * Pure: builds the exact JSON body the modal's Download button POSTs to
 * `POST /api/ytdlp/download` -- `{ url, format, quality }` plus `filetype`
 * when it is defined. No DOM/fetch involved, so it is directly unit-testable
 * against the four field values a real click would read off the form.
 */
function buildOneOffDownloadBody(url, format, quality, filetype) {
  const body = { url, format, quality };
  if (filetype !== undefined) body.filetype = filetype;
  return body;
}

/**
 * FR-E-style live-status formatter for the modal's status line -- mirrors
 * `lib/ytdlp/client/subscriptions.js`'s `formatLiveStatusText` exactly
 * (same `LiveEntry` shape from `GET /api/subscriptions/status`'s `oneShots`
 * namespace: `{state, title, index, total, percent, error}`). Pure string
 * formatting only -- no DOM -- so it cannot itself introduce an XSS path;
 * callers still render the returned string via `textContent` only, never
 * `innerHTML` (see `buildOneOffModal` below). `entry.error`/`entry.title`
 * are already redacted/confined server-side (activity.js never stores a raw
 * error/stderr), but this function makes no assumption about that -- it
 * treats them as arbitrary strings either way.
 */
function formatOneOffStatusText(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const state = entry.state;
  if (state === 'queued') return 'Queued…';
  if (state === 'listing') return 'Checking for new videos…';
  if (state === 'downloading') {
    const title = typeof entry.title === 'string' && entry.title.trim() !== '' ? entry.title.trim() : 'Downloading';
    const index = typeof entry.index === 'number' && entry.index > 0 ? entry.index : null;
    const total = typeof entry.total === 'number' && entry.total > 0 ? entry.total : null;
    const percent = typeof entry.percent === 'number' && Number.isFinite(entry.percent)
      ? Math.max(0, Math.min(100, Math.round(entry.percent)))
      : 0;
    const position = index !== null && total !== null ? (index + ' of ' + total) : '';
    return [title, position, percent + '%'].filter((part) => part !== '').join(' — ');
  }
  if (state === 'done') return 'Done';
  if (state === 'error') return typeof entry.error === 'string' && entry.error.trim() !== '' ? entry.error : 'error';
  return null; // 'idle' (or an unrecognized future state) -- no live override
}

// Builds a `<select>` populated from `options` (an array of `{value, label}`
// objects) via `createElement`/`textContent` ONLY -- mirrors
// `lib/ytdlp/client/subscriptions.js`'s `buildSelect`.
function buildOneOffSelect(doc, options, selectedValue) {
  const d = doc || document;
  const select = d.createElement('select');
  let matchedValue = null;
  options.forEach((opt) => {
    const option = d.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === selectedValue) {
      option.selected = true;
      matchedValue = opt.value;
    }
    select.appendChild(option);
  });
  select.value = matchedValue !== null ? matchedValue : (options.length > 0 ? options[0].value : undefined);
  return select;
}

// Removes all children of `el` without ever touching innerHTML.
function clearOneOffChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// Rebuilds `filetypeSelect`'s `<option>` list in place from `format`'s
// current value, via `reduceOneOffFiletypeOptions` -- wired to the format
// select's `change` listener, mirroring subscriptions.js's
// `repopulateFiletypeSelect`. `createElement`/`textContent` only.
function repopulateOneOffFiletypeSelect(doc, format, filetypeSelect) {
  if (!filetypeSelect) return;
  const d = doc || document;
  const { options, selected } = reduceOneOffFiletypeOptions(format, filetypeSelect.value);
  clearOneOffChildren(filetypeSelect);
  let matchedValue = null;
  options.forEach((opt) => {
    const option = d.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === selected) {
      option.selected = true;
      matchedValue = opt.value;
    }
    filetypeSelect.appendChild(option);
  });
  filetypeSelect.value = matchedValue !== null ? matchedValue : (options.length > 0 ? options[0].value : undefined);
}

/**
 * Builds the compact one-off download modal as real DOM nodes -- backdrop +
 * dialog, appended to `document.body` by the caller. `createElement`/
 * `textContent` ONLY (never `innerHTML`, matching this file's discipline for
 * every dynamic string). `handlers` = `{ onDownload(body), onClose() }`
 * decouples DOM construction from network calls, mirroring
 * `createSubscriptionRow`'s pattern, so this function stays pure/DOM-only
 * and directly unit-testable with a fake `document` (no real fetch).
 *
 * SECURITY: the only strings ever rendered into this modal after the initial
 * build are the status line (via `setOneOffModalStatus`, `textContent` only)
 * and whatever the user themselves typed into the URL field (never echoed
 * back as markup) -- there is no server/user-derived string rendered any
 * other way.
 */
function buildOneOffModal(doc, handlers) {
  const d = doc || document;
  const h = handlers || {};

  const backdrop = d.createElement('div');
  backdrop.className = 'oneoff-modal-backdrop';
  backdrop.hidden = true;
  backdrop.addEventListener('click', (e) => {
    if (e && e.target === backdrop && typeof h.onClose === 'function') h.onClose();
  });

  const modal = d.createElement('div');
  modal.className = 'oneoff-modal';
  modal.hidden = true;
  backdrop.appendChild(modal);

  const header = d.createElement('div');
  header.className = 'oneoff-modal-header';
  const title = d.createElement('span');
  title.className = 'oneoff-modal-title';
  title.textContent = 'One-off download';
  header.appendChild(title);
  const closeBtn = d.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'oneoff-modal-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    if (typeof h.onClose === 'function') h.onClose();
  });
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const urlInput = d.createElement('input');
  urlInput.type = 'text';
  urlInput.className = 'oneoff-modal-field';
  urlInput.setAttribute('placeholder', 'https://www.youtube.com/watch?v=...');
  modal.appendChild(urlInput);

  const row = d.createElement('div');
  row.className = 'oneoff-modal-row';

  const formatSelect = buildOneOffSelect(d, ONEOFF_FORMAT_OPTIONS, 'video');
  row.appendChild(formatSelect);

  const qualitySelect = buildOneOffSelect(
    d,
    ONEOFF_QUALITY_OPTIONS.map((q) => ({ value: q, label: q })),
    ONEOFF_DEFAULT_QUALITY
  );
  row.appendChild(qualitySelect);

  const filetypeSelect = buildOneOffSelect(d, ONEOFF_FILETYPE_OPTIONS.video, ONEOFF_DEFAULT_FILETYPE.video);
  row.appendChild(filetypeSelect);

  formatSelect.addEventListener('change', () => {
    repopulateOneOffFiletypeSelect(d, formatSelect.value, filetypeSelect);
  });

  modal.appendChild(row);

  const statusEl = d.createElement('div');
  statusEl.className = 'oneoff-modal-status';
  statusEl.setAttribute('aria-live', 'polite');
  modal.appendChild(statusEl);

  const downloadBtn = d.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'btn btn-primary';
  downloadBtn.textContent = 'Download';
  downloadBtn.addEventListener('click', () => {
    const url = typeof urlInput.value === 'string' ? urlInput.value.trim() : '';
    if (!url) {
      statusEl.textContent = 'Enter a video URL.';
      return;
    }
    const body = buildOneOffDownloadBody(url, formatSelect.value, qualitySelect.value, filetypeSelect.value);
    if (typeof h.onDownload === 'function') h.onDownload(body);
  });
  modal.appendChild(downloadBtn);

  // Renders a live-status entry (or clears the line when `null`/no entry) --
  // `textContent` only, never `innerHTML`, no matter what `entry.title`/
  // `entry.error` contain.
  function setStatus(entry) {
    statusEl.textContent = formatOneOffStatusText(entry) || '';
  }

  return { backdrop, modal, urlInput, formatSelect, qualitySelect, filetypeSelect, downloadBtn, closeBtn, statusEl, setStatus };
}

// Idempotent (checks for the button's existence first) and defensive --
// missing `.header-right` (a page without this shared header) is simply
// skipped, never thrown on. Mirrors `injectSubscriptionsNavLinkIfEnabled`'s
// gating exactly: the button/modal are ONLY ever created after a genuine 2xx
// from `/api/subscriptions/health`; a 404 (module disabled) or a network
// failure means this function creates nothing at all -- the header stays
// byte-identical to a disabled install (AC3.3/ACX.1).
function injectOneOffDownloadButtonIfEnabled() {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return;
  if (document.getElementById('ytdlp-oneoff-btn')) return; // already injected

  fetch('/api/subscriptions/health')
    .then((res) => {
      if (!shouldInjectOneOffButton(res)) return; // disabled (404) -- inject nothing

      const headerRight = document.querySelector('.header-right');
      if (!headerRight) return; // page has no shared header -- nothing to attach to

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'ytdlp-oneoff-btn';
      btn.className = 'btn';
      btn.setAttribute('aria-label', 'Download a video');
      btn.title = 'Download a video';
      const icon = document.createElement('i');
      icon.className = 'icon-download';
      btn.appendChild(icon);
      btn.appendChild(document.createTextNode(' Download'));

      // Dean-locked placement: immediately before the Settings link when one
      // exists in this header (index.html/watch.html); pages whose header
      // has no Settings link (setup.html/subscriptions.html) simply get the
      // button appended to `.header-right`.
      const settingsLink = headerRight.querySelector('a[href="/setup.html"]');
      if (settingsLink) {
        headerRight.insertBefore(btn, settingsLink);
      } else {
        headerRight.appendChild(btn);
      }

      let modalState = null;
      let pollTimer = null;
      let currentJobId = null;

      function stopPolling() {
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
      }

      function pollStatusOnce() {
        if (!currentJobId || !modalState) return;
        fetch('/api/subscriptions/status')
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('status endpoint returned ' + r.status))))
          .then((snapshot) => {
            if (!modalState) return; // modal was torn down mid-flight -- nothing to render into
            const entry = snapshot && snapshot.oneShots ? snapshot.oneShots[currentJobId] : undefined;
            modalState.setStatus(entry || { state: 'queued' });
            if (entry && (entry.state === 'done' || entry.state === 'error')) {
              stopPolling(); // terminal -- stop polling this job
              return;
            }
            pollTimer = setTimeout(pollStatusOnce, ONEOFF_STATUS_POLL_MS);
          })
          .catch(() => {
            // Transient/network hiccup -- keep polling at the same cadence
            // rather than giving up (mirrors subscriptions.js's backoff
            // intent, kept simple here since the modal is a short-lived,
            // actively-watched surface).
            pollTimer = setTimeout(pollStatusOnce, ONEOFF_STATUS_POLL_MS);
          });
      }

      function closeModal() {
        if (!modalState) return;
        modalState.backdrop.hidden = true;
        modalState.modal.hidden = true;
        stopPolling();
        currentJobId = null;
      }

      function openModal() {
        if (!modalState) {
          modalState = buildOneOffModal(document, {
            onClose: closeModal,
            onDownload: (body) => {
              modalState.setStatus({ state: 'queued' });
              modalState.statusEl.textContent = 'Starting…';
              fetch('/api/ytdlp/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              })
                .then(async (r) => {
                  const data = await r.json().catch(() => ({}));
                  if (!r.ok) {
                    // SECURITY: the server's validation error string, rendered
                    // via the modal's own textContent-only setStatus/statusEl
                    // path -- never innerHTML.
                    modalState.statusEl.textContent = data.error || 'Could not start download.';
                    return;
                  }
                  currentJobId = data.jobId;
                  modalState.statusEl.textContent = 'Queued…';
                  stopPolling();
                  pollStatusOnce();
                })
                .catch(() => {
                  modalState.statusEl.textContent = 'Could not start download (network error).';
                });
            },
          });
          document.body.appendChild(modalState.backdrop);
        }
        modalState.backdrop.hidden = false;
        modalState.modal.hidden = false;
      }

      btn.addEventListener('click', openModal);

      // Esc closes the modal while it is open -- backdrop-click and the [x]
      // button are wired inside buildOneOffModal itself.
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalState && !modalState.backdrop.hidden) closeModal();
      });
    })
    .catch(() => { /* network/parse failure -- fail closed, inject nothing */ });
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
// display-name lookup, same hidden-flag parity: the `hidden` ("Hide from
// home") flag only affects the home grid via the API, not this list, matching
// the sidebar today). `hiddenFromSidebar` (v1.14.0 item 3) DOES affect this
// list -- it's the mobile equivalent of the left sidebar, so a folder hidden
// from one is hidden from both (via visibleSidebarFolders()).
function renderPlaylistsSheet(folders, folderSettings) {
  const list = document.getElementById('playlists-sheet-list');
  if (!list) return;
  const settings = folderSettings || {};
  const visible = visibleSidebarFolders(folders, settings);
  if (visible.length === 0) {
    list.innerHTML = '<div class="sidebar-item">No folders configured.</div>';
    return;
  }
  list.innerHTML = visible.map((f) => {
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

  // Optional yt-dlp subscriptions nav-link capability probe (D4, T5). Runs on
  // every page (not just inside the `bottomNav` guard below) since it also
  // injects a sidebar link on pages that have one but no bottom nav.
  injectSubscriptionsNavLinkIfEnabled();

  // v1.15.0 item 3: one-off download header button + modal, gated by the
  // SAME capability probe pattern -- runs on every page for the same reason
  // (index.html/watch.html/setup.html/subscriptions.html all share the
  // header and load common.js).
  injectOneOffDownloadButtonIfEnabled();

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
    tokenize, rankRelated, RESULT_COUNT, SIMILAR_FLOOR,
    resolveAudioArtUrl,
    shouldInjectSubscriptionsNav,
    fisherYatesShuffle, sortItems, shouldShowShuffleButton,
    visibleSidebarFolders, resolveDefaultView,
    moveArrayItem, computeDropIndex, rebuildFullFolderOrder,
    shouldInjectOneOffButton, reduceOneOffFiletypeOptions, buildOneOffDownloadBody,
    formatOneOffStatusText, buildOneOffModal,
    ONEOFF_FORMAT_OPTIONS, ONEOFF_QUALITY_OPTIONS, ONEOFF_DEFAULT_QUALITY,
    ONEOFF_FILETYPE_OPTIONS, ONEOFF_DEFAULT_FILETYPE, ONEOFF_STATUS_POLL_MS
  };
}
