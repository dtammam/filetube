'use strict';

// v1.195 T1 (TV Shows): the PURE parse + grouping core. No fs, no db, no crypto --
// node-testable in isolation. Built to Dean's on-disk convention (exec-plan):
//   <Shows root>/<Show name>/<Season N | Specials>/<Show SxxEyy - Title>.<ext>
// e.g. ".../TV Shows/House MD/Season 2/House MD S02E22 - Forever.mp4"
// Best-effort, never hard-reject: a file that does not match SxxEyy still becomes
// a playable episode in the show's "Extras" bucket; a subfolder that is not a
// recognizable season folds into Extras too.

// A separator run between the S and E numbers and around the title dash. Kept
// permissive: `S02E22`, `s2e22`, `S02.E22`, `S02 E22` all parse.
const SXXEYY = /s(\d{1,3})[\s._-]*e(\d{1,3})/i;

/**
 * A season subfolder name -> its season number, or null when the folder is not a
 * recognizable season (it becomes the show's Extras bucket).
 *   "Season 2" / "Season 02" / "season2"  -> 2
 *   "Specials" / "Season 0" / "Season 00"  -> 0
 *   anything else                          -> null
 * @param {string} name a single path segment (the folder's basename)
 * @returns {number|null}
 */
function parseSeasonFolder(name) {
  if (typeof name !== 'string') return null;
  const s = name.trim();
  if (/^specials$/i.test(s)) return 0;
  const m = /^season\s*0*(\d+)$/i.exec(s);
  if (m) return parseInt(m[1], 10);
  return null;
}

/**
 * An episode FILENAME (with or without extension) -> { seasonNum, episodeNum,
 * title }. Season/episode come from the SxxEyy token; the title is whatever
 * follows it after a ` - ` separator, else the basename with the leading
 * show-name-and-token prefix stripped, else '' (the UI shows "Episode N").
 * A file with no SxxEyy token -> { seasonNum: null, episodeNum: null, title }
 * (the cleaned basename), so it still lists and plays, in Extras.
 * NOTE: the SHOW NAME is taken from the folder, never the filename -- this
 * function only reads the per-episode fields.
 * @param {string} filename
 * @returns {{seasonNum: (number|null), episodeNum: (number|null), title: string}}
 */
function parseEpisodeFilename(filename) {
  if (typeof filename !== 'string') return { seasonNum: null, episodeNum: null, title: '' };
  // Strip a trailing extension (the last dot-segment of 1-5 chars), never an
  // interior dot (a show like "S.W.A.T" keeps its dots).
  const base = filename.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim();
  const m = SXXEYY.exec(base);
  if (!m) {
    return { seasonNum: null, episodeNum: null, title: cleanTitle(base) };
  }
  const seasonNum = parseInt(m[1], 10);
  const episodeNum = parseInt(m[2], 10);
  // Everything AFTER the matched token is the title source.
  const after = base.slice(m.index + m[0].length);
  // Prefer the text after a ` - ` (or a bare leading separator run); else the
  // trimmed remainder; else '' (caller defaults to "Episode N").
  const title = cleanTitle(after);
  return { seasonNum, episodeNum, title };
}

// Trim a title fragment: drop a leading separator run (" - ", " – ", ".", "_"),
// collapse whitespace, and normalize dot/underscore-delimited names to spaces
// ONLY when there are no spaces already (so "Forever" and "The.Mistake" both read
// cleanly, but "S.W.A.T Crossover" is left alone).
function cleanTitle(s) {
  if (typeof s !== 'string') return '';
  let t = s.replace(/^[\s._-]*-?[\s._-]*/, '').trim();
  if (t && !/\s/.test(t) && /[._]/.test(t)) t = t.replace(/[._]+/g, ' ').trim();
  return t;
}

// Normalize the episodes input (a db.tv.episodes id->record map, or an array of
// records) to a plain array of records, skipping non-objects.
function toEpisodeArray(episodes) {
  if (Array.isArray(episodes)) return episodes.filter((e) => e && typeof e === 'object');
  if (episodes && typeof episodes === 'object') {
    return Object.keys(episodes).map((k) => episodes[k]).filter((e) => e && typeof e === 'object');
  }
  return [];
}

/**
 * Group episodes into SHOW cards. One card per showId, with its display name,
 * season/episode counts, a representative episode for a poster fallback, and the
 * newest addedAt (for a recency-aware Continue row while the grid stays A-Z --
 * exec-plan default O1: alphabetical grid order).
 * @param {Object|Array} episodes db.tv.episodes (map) or an array of records
 * @returns {Array<{id, name, seasonCount, episodeCount, posterEpisodeId, latestAddedAt}>}
 */
function groupShows(episodes) {
  const arr = toEpisodeArray(episodes);
  const byShow = new Map();
  for (const ep of arr) {
    const id = typeof ep.showId === 'string' ? ep.showId : '';
    if (!id) continue;
    let g = byShow.get(id);
    if (!g) {
      g = { id, name: typeof ep.showName === 'string' ? ep.showName : '', seasons: new Set(), episodeCount: 0, posterEpisodeId: null, posterKey: null, latestAddedAt: 0 };
      byShow.set(id, g);
    }
    if (!g.name && typeof ep.showName === 'string') g.name = ep.showName;
    g.seasons.add(seasonSortKey(ep.seasonNum));
    g.episodeCount += 1;
    const added = Number(ep.addedAt) || 0;
    if (added > g.latestAddedAt) g.latestAddedAt = added;
    // Representative poster episode = the earliest (season, episode) so the
    // fallback thumbnail is deterministic (never a random mid-run frame).
    const key = episodeSortKey(ep);
    if (g.posterKey === null || key < g.posterKey) { g.posterKey = key; g.posterEpisodeId = typeof ep.id === 'string' ? ep.id : null; }
  }
  const cards = [];
  for (const g of byShow.values()) {
    cards.push({ id: g.id, name: g.name, seasonCount: g.seasons.size, episodeCount: g.episodeCount, posterEpisodeId: g.posterEpisodeId, latestAddedAt: g.latestAddedAt });
  }
  // O1: alphabetical by name (case-insensitive), id as a stable tiebreak.
  cards.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id));
  return cards;
}

/**
 * Group ONE show's episodes into ordered seasons, each an ordered episode list.
 * Season order: regular seasons ascending (1,2,3...), then Specials (0), then
 * Extras (null) last. Episodes within a season order by episodeNum, then title,
 * then id (a stable, deterministic order even when numbers are missing).
 * @param {Object|Array} episodes db.tv.episodes (map) or an array of records
 * @param {string} showId
 * @returns {Array<{seasonNum:(number|null), label:string, episodes:Array}>}
 */
function groupSeasons(episodes, showId) {
  const arr = toEpisodeArray(episodes).filter((e) => e.showId === showId);
  const bySeason = new Map();
  for (const ep of arr) {
    const key = ep.seasonNum == null ? 'x' : String(ep.seasonNum);
    if (!bySeason.has(key)) bySeason.set(key, { seasonNum: ep.seasonNum == null ? null : ep.seasonNum, episodes: [] });
    bySeason.get(key).episodes.push(ep);
  }
  const seasons = [...bySeason.values()];
  for (const s of seasons) {
    s.episodes.sort((a, b) => episodeSortKey(a) - episodeSortKey(b) || String(a.title || '').localeCompare(String(b.title || '')) || String(a.id || '').localeCompare(String(b.id || '')));
    s.label = seasonLabel(s.seasonNum);
  }
  seasons.sort((a, b) => seasonSortKey(a.seasonNum) - seasonSortKey(b.seasonNum));
  return seasons;
}

// Order key so regular seasons come first ascending, Specials (0) after them, and
// Extras (null) last: map 0 -> +Infinity-ish (after regulars) and null -> beyond.
function seasonSortKey(n) {
  if (n == null) return Number.MAX_SAFE_INTEGER;
  if (n === 0) return Number.MAX_SAFE_INTEGER - 1;
  return n;
}

function seasonLabel(n) {
  if (n == null) return 'Extras';
  if (n === 0) return 'Specials';
  return `Season ${n}`;
}

// A within-season numeric sort key from episodeNum (missing -> a large number so
// unnumbered extras sort after numbered episodes, deterministically).
function episodeSortKey(ep) {
  const n = ep && ep.episodeNum;
  return (typeof n === 'number' && isFinite(n)) ? n : Number.MAX_SAFE_INTEGER;
}

module.exports = {
  SXXEYY,
  parseSeasonFolder,
  parseEpisodeFilename,
  cleanTitle,
  groupShows,
  groupSeasons,
  seasonLabel,
};
