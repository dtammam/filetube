'use strict';

// Universal search - the ONE ranking primitive, shared by every provider and
// the /api/search blender (Wave B, Dean: BLENDED by relevance, one flat
// stream). Pure + type-agnostic: it never reads a raw db item, only the
// NORMALIZED result shape each provider emits ({ resultType, id, title,
// identityText, recency, ...cardFields }). Keeping match AND rank in one
// function means a result can never be included at one relevance and ordered
// at another (the divergent-fixture class this repo keeps paying for).
//
// Decision 4 (Dean): match TITLE + IDENTITY fields only (author/artist/album/
// channel/show name) - NOT long descriptions. The provider folds its identity
// fields into `identityText`; `title` is the primary name.

// Relevance TIER of one result against the query. Lower = better. -1 = no
// match (the provider uses this as the inclusion test, so match and rank agree
// by construction).
//   0: title === query           (exact, case-insensitive)
//   1: title startsWith query
//   2: title includes query
//   3: an identity field includes query (title did NOT match)
//  -1: no match
function matchTier(title, identityText, rawQuery) {
  const q = (typeof rawQuery === 'string' ? rawQuery : '').toLowerCase().trim();
  if (q === '') return -1; // empty query matches nothing (endpoint returns [])
  const t = (typeof title === 'string' ? title : '').toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.includes(q)) return 2;
  const id = (typeof identityText === 'string' ? identityText : '').toLowerCase();
  if (id.includes(q)) return 3;
  return -1;
}

// The fixed type priority (Dean's tie-breaker after relevance). Lower = higher.
// Shows sit above their own episodes so a matching show leads its episodes in a
// tie. A resultType absent here sorts last among its tier.
const TYPE_PRIORITY = {
  video: 0,
  audio: 1,
  music: 2,
  'podcast-show': 3,
  'podcast-episode': 4,
  'tv-show': 5,
  'tv-episode': 6,
  book: 7,
};

// Blend + order a flat list of normalized results for `query`:
//   relevance tier asc -> TYPE_PRIORITY asc -> recency desc -> id asc (stable).
// Returns a NEW array; does not mutate the input. Results with tier -1 (should
// not occur - providers pre-filter) sort to the end deterministically.
function rankResults(results, query) {
  const list = Array.isArray(results) ? results.slice() : [];
  return list.sort((a, b) => {
    const ta = matchTier(a.title, a.identityText, query);
    const tb = matchTier(b.title, b.identityText, query);
    const na = ta < 0 ? Infinity : ta;
    const nb = tb < 0 ? Infinity : tb;
    if (na !== nb) return na - nb;
    const pa = TYPE_PRIORITY[a.resultType] != null ? TYPE_PRIORITY[a.resultType] : 99;
    const pb = TYPE_PRIORITY[b.resultType] != null ? TYPE_PRIORITY[b.resultType] : 99;
    if (pa !== pb) return pa - pb;
    const ra = typeof a.recency === 'number' ? a.recency : 0;
    const rb = typeof b.recency === 'number' ? b.recency : 0;
    if (ra !== rb) return rb - ra; // newer first
    return String(a.id).localeCompare(String(b.id));
  });
}

module.exports = { matchTier, TYPE_PRIORITY, rankResults };
