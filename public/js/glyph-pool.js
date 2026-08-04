'use strict';

// ---- v1.77: the folder/library glyph pool ---------------------------------
//
// ONE source of truth for the assignable glyph vocabulary, loaded as a browser
// script (script order: glyph-pool -> common -> main -> setup) AND required by
// server.js as a CommonJS module. Both halves read THIS list, which is the
// whole point: the server validates a submitted glyph id against the same
// array the client renders from, so the two can never drift into a state where
// a value saves but does not paint (or paints but does not save).
//
// Why the registry carries `asset` and `emoji` rather than the CSS carrying
// them alone: every member needs SEVEN disjoint enumerations in style.css
// (base mask, sizing list, @supports fill list, rounded override, filled
// override, emoji neutralize group, emoji ::before). Twenty members means 140
// hand-typed enumerations, and this repo has been bitten twice by exactly that
// shape - v1.41.4 (a writer that was never updated) and v1.47.6, where
// `.icon-share` got a mask but was missed in the fill list and rendered on
// Dean's device as "a blank box". Holding `asset`/`emoji` here lets
// test/unit/glyph-pool.test.js DERIVE the expected CSS for every member and
// fail CI when one of the seven is missed. The invariant is enforced by
// measurement, never by care in typing.
//
// `asset` is the upstream Material glyph name, not the class name - the
// established convention in this repo (`.icon-cog` ships as `settings.svg`).
// The same filename is used in all three vector directories.
//
// `emoji` is space-separated CODEPOINTS, not a literal emoji character:
// test/unit/icon-assets.test.js asserts that no literal emoji char appears in
// any HTML/JS file (only CSS may carry them, as \XXXX escapes), and this file
// is JS. The codepoints are also what the CSS `content: "\XXXX"` escape is
// derived from, so the test can rebuild the expected declaration exactly.

const GLYPH_POOL = [
  // The default. Already bundled in all three vector sets since v1.6.0 - it is
  // listed here so it is a first-class, explicitly-selectable pool member
  // rather than a magic absent value.
  { id: 'folder', name: 'Folder', asset: 'folder', emoji: '1F4C1' },

  // Dean's four (intake 2026-08-04).
  { id: 'school', name: 'School', asset: 'school', emoji: '1F393' },
  { id: 'movies', name: 'Movies', asset: 'movie', emoji: '1F3AC' },
  // DISCLOSED collision: `.icon-downloads` also renders 1F4FA in the emoji
  // set (Dean's v1.73 ruling 4). That ruling is not re-litigated here; this
  // wave makes the Downloads glyph user-changeable for the first time, which
  // is the honest mitigation. See the exec plan's "Known gaps".
  { id: 'shows', name: 'Shows', asset: 'tv', emoji: '1F4FA' },
  { id: 'documents', name: 'Documents', asset: 'description', emoji: '1F4C4' },

  // Picked here at Dean's request ("you pick a bunch of other things first").
  { id: 'music-note', name: 'Music', asset: 'music_note', emoji: '1F3B5' },
  { id: 'kids', name: 'Kids', asset: 'child_care', emoji: '1F9F8' },
  { id: 'games', name: 'Games', asset: 'sports_esports', emoji: '1F3AE' },
  { id: 'camcorder', name: 'Home video', asset: 'videocam', emoji: '1F4F9' },
  { id: 'photos', name: 'Photos', asset: 'photo_camera', emoji: '1F4F7' },
  { id: 'travel', name: 'Travel', asset: 'flight', emoji: '2708 FE0F' },
  { id: 'work', name: 'Work', asset: 'work', emoji: '1F4BC' },
  { id: 'cooking', name: 'Cooking', asset: 'restaurant', emoji: '1F37D FE0F' },
  { id: 'fitness', name: 'Fitness', asset: 'fitness_center', emoji: '1F3CB FE0F' },
  { id: 'comedy', name: 'Comedy', asset: 'theater_comedy', emoji: '1F3AD' },
  { id: 'pets', name: 'Pets', asset: 'pets', emoji: '1F43E' },
  { id: 'cars', name: 'Cars', asset: 'directions_car', emoji: '1F697' },
  { id: 'archive', name: 'Archive', asset: 'archive', emoji: '1F4E6' },
  { id: 'radio', name: 'Radio', asset: 'radio', emoji: '1F4FB' },
  // Shares `star.svg` with `.icon-liked` below. Two classes, one asset: they
  // are different intents that happen to want the same picture, and keeping
  // them separate means the Liked lane's glyph can change later without
  // silently changing every folder that chose "Favorites".
  { id: 'favorites', name: 'Favorites', asset: 'star', emoji: '2B50' },
];

const DEFAULT_FOLDER_GLYPH = 'folder';

// The Liked lane's own glyph (intake ruling 3). NOT a pool member: it is not
// assignable to a folder, it is the fixed identity of the Liked entry. It gets
// the same four-set treatment every pool member does, which is what Dean asked
// for ("Liked is a full star and needs more in its set").
//
// It is deliberately NOT `.icon-star`: that class is still used by the two
// Stats sidebar links, and Liked and Stats are different intents. Note that
// contrary to the comment this wave deletes from style.css, `.icon-star` was
// never what rendered the gold rating stars - those are literal textContent
// characters in `.card-rating` and `#star-rating-control`.
const LIKED_GLYPH = { id: 'liked', name: 'Liked', asset: 'star', emoji: '2B50' };

// Every class this module governs, pool + liked. The CSS-parity test iterates
// THIS, so a future member cannot be added to the pool and forgotten in the
// stylesheet.
function glyphClassName(id) {
  return 'icon-' + id;
}

function allGlyphEntries() {
  return GLYPH_POOL.concat([LIKED_GLYPH]);
}

// Pure. A stored folder-glyph value -> a safe class name. Anything unknown,
// absent, or non-string resolves to the default folder glyph. This is the
// garbage-defense layer (the resolveCardCornerPrefs posture): the server
// validates too, but a database written by an older/hand-edited build must
// still render something sane rather than emitting an arbitrary class.
function resolveFolderGlyphClass(value) {
  if (typeof value === 'string' && GLYPH_POOL.some((g) => g.id === value)) {
    return glyphClassName(value);
  }
  return glyphClassName(DEFAULT_FOLDER_GLYPH);
}

// The Library entries whose glyph is user-assignable (intake ruling 5: all of
// them, not just the two Dean named).
//   `key`      - the settings key on the per-user record
//   `nav`      - the value used by BOTH `[data-nav-sidebar="..."]` (sidebar)
//                and `[data-nav="..."]` (bottom bar), so the repainter can
//                find every surface for a slot without a second mapping to
//                keep in sync
//   `fallback` - the class that entry has rendered since it shipped, so an
//                untouched install looks EXACTLY as it does today
const LIBRARY_GLYPH_SLOTS = [
  { key: 'glyphDownloads', nav: 'downloads', name: 'Downloads', fallback: 'icon-downloads' },
  { key: 'glyphMusic', nav: 'music', name: 'Music', fallback: 'icon-play' },
  { key: 'glyphBooks', nav: 'books', name: 'Books', fallback: 'icon-books' },
  { key: 'glyphPodcasts', nav: 'podcasts', name: 'Podcasts', fallback: 'icon-podcast' },
  { key: 'glyphHistory', nav: 'history', name: 'History', fallback: 'icon-history' },
];

// Pure. A per-user settings object -> the class for one Library slot. The
// meta-value 'default' (and absence, and garbage) keeps that entry's shipped
// glyph, so "I never touched this" and "I explicitly chose the original" are
// the same pixel - a user can always get back to the default from the picker.
function resolveLibraryGlyphClass(settings, slotKey) {
  const slot = LIBRARY_GLYPH_SLOTS.find((s) => s.key === slotKey);
  if (!slot) return null;
  const s = settings && typeof settings === 'object' ? settings : {};
  const v = s[slotKey];
  if (typeof v === 'string' && GLYPH_POOL.some((g) => g.id === v)) {
    return glyphClassName(v);
  }
  return slot.fallback;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GLYPH_POOL, DEFAULT_FOLDER_GLYPH, LIKED_GLYPH, LIBRARY_GLYPH_SLOTS,
    glyphClassName, allGlyphEntries,
    resolveFolderGlyphClass, resolveLibraryGlyphClass,
  };
}
