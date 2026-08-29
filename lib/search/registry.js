'use strict';

// Universal search - the PROVIDER REGISTRY (Wave B). Each media module has a
// provider that, given (query, requester), returns TYPED, RBAC-FILTERED,
// normalized results. "Automatic" is enforced-by-test, not magic: the
// provider-coverage census (search-provider-census.test.js) binds this
// registry to KIND_TO_LIBRARY (lib/auth/visibility.js) - a new media library
// with no provider goes RED. Modeled on the LIBRARY_GLYPH_SLOTS array
// registry.
//
// Purity: providers read only their INJECTED `deps` (db namespaces + the
// EXISTING per-kind *VisibleTo gates + buildWatchUrl), never server internals
// directly - so the server wires one deps object at /api/search and this
// module stays unit-testable with fakes. Every provider applies its RBAC gate
// (the recurring leaks-titles/counts class - never skipped) AND rank.matchTier
// for inclusion, so match and rank agree by construction.

const rank = require('./rank');
const tvParse = require('../tv/parse');

// The normalized result each provider emits:
//   { resultType, kind, id, title, identityText, recency, ...cardFields }
// resultType drives rank + the type badge; kind drives the client's
// cardKindPresentation (media path when absent); title/identityText/recency
// feed rank; the rest are the fields buildCardHtml renders.

function pushIfMatch(out, q, base) {
  if (rank.matchTier(base.title, base.identityText, q) < 0) return;
  out.push(base);
}

// db.metadata split by media type (video | audio). RBAC: mediaVisibleTo.
function searchMetadata(q, req, deps, mediaType) {
  const items = Object.values((deps.db && deps.db.metadata) || {});
  const out = [];
  for (const item of items) {
    if (item.type !== mediaType) continue;
    if (!deps.gates.mediaVisibleTo(req, item)) continue; // RBAC FIRST
    pushIfMatch(out, q, {
      resultType: mediaType,
      id: item.id,
      title: item.title || '',
      identityText: [item.channelName, item.folderName].filter(Boolean).join(' '),
      recency: rank.toRecency(item.addedAt),
      // card fields (media kind -> the byte-identical video-card path):
      type: item.type,
      duration: item.duration,
      ext: item.ext,
      hasSubtitles: item.hasSubtitles === true ? true : undefined,
      channelName: item.channelName,
      folderName: item.folderName,
      watchUrl: deps.buildWatchUrl ? deps.buildWatchUrl(item) : undefined,
      progressPercent: 0,
    });
  }
  return out;
}

// db.music.tracks. RBAC: trackVisibleTo. Client kind 'track'.
function searchMusic(q, req, deps) {
  const tracks = Object.values((deps.db && deps.db.music && deps.db.music.tracks) || {});
  const out = [];
  for (const t of tracks) {
    if (!deps.gates.trackVisibleTo(req, t)) continue;
    pushIfMatch(out, q, {
      resultType: 'music', kind: 'track', id: t.id,
      title: t.title || '',
      identityText: [t.artist, t.album, t.albumArtist].filter(Boolean).join(' '),
      recency: rank.toRecency(t.addedAt), // ISO string -> ms (was silently 0)
      artist: t.artist, album: t.album,
    });
  }
  return out;
}

// db.podcasts.subscriptions (shows). RBAC: podcastVisibleTo on a bare {subId}
// (the show-art route's form). Client kind 'podcast-show'.
function searchPodcastShows(q, req, deps) {
  const subs = (deps.db && deps.db.podcasts && deps.db.podcasts.subscriptions) || [];
  const out = [];
  for (const sub of subs) {
    if (!deps.gates.podcastVisibleTo(req, { subId: sub.id, filePath: '' })) continue;
    pushIfMatch(out, q, {
      resultType: 'podcast-show', kind: 'podcast-show', id: sub.id,
      title: sub.name || '',
      identityText: sub.author || '',
      recency: 0, // subscriptions have no addedAt; recency rarely tiebreaks a show
      author: sub.author, subId: sub.id, episodeCount: sub.episodeCount,
    });
  }
  return out;
}

// db.podcasts.episodes. RBAC: podcastVisibleTo({subId, filePath}). Client kind
// 'podcast' (reuses the existing cardKindPresentation podcast arm).
function searchPodcastEpisodes(q, req, deps) {
  const eps = Object.values((deps.db && deps.db.podcasts && deps.db.podcasts.episodes) || {});
  const subs = (deps.db && deps.db.podcasts && deps.db.podcasts.subscriptions) || [];
  const nameById = new Map(subs.map((s) => [s.id, s.name]));
  const out = [];
  for (const ep of eps) {
    if (!deps.gates.podcastVisibleTo(req, { subId: ep.subId, filePath: ep.filePath })) continue;
    // Only DOWNLOADED (on-disk, playable) episodes - the same invariant the
    // play route (/episode/:id 404s otherwise) and every list surface enforce.
    // Without this, a pending/failed/trashed/tombstone episode surfaced as a
    // card that 404s on click AND resurfaced a title the user had DELETED
    // (gate WARNING).
    if (ep.status !== 'downloaded') continue;
    const showName = nameById.get(ep.subId) || '';
    pushIfMatch(out, q, {
      resultType: 'podcast-episode', kind: 'podcast', id: ep.id,
      title: ep.title || '',
      identityText: showName,
      recency: rank.toRecency(ep.pubDateMs),
      subId: ep.subId, showName,
    });
  }
  return out;
}

// TV shows derived from VISIBLE episodes only (never a show from a blocked
// episode set). RBAC: tvVisibleEpisodes already filtered. Client kind 'tv-show'.
function searchTvShows(q, req, deps) {
  const eps = deps.gates.tvVisibleEpisodes(req);
  // groupShows.latestAddedAt is Number(ISO) -> 0 (a pre-existing parse.js bug,
  // out of this wave's scope), so derive each show's recency HERE from the
  // episodes' addedAt via toRecency, rather than trusting the zeroed field.
  const recencyByShow = new Map();
  for (const ep of eps) {
    const r = rank.toRecency(ep.addedAt);
    const prev = recencyByShow.get(ep.showId);
    if (prev === undefined || r > prev) recencyByShow.set(ep.showId, r);
  }
  const shows = tvParse.groupShows(eps);
  const out = [];
  for (const s of shows) {
    pushIfMatch(out, q, {
      resultType: 'tv-show', kind: 'tv-show', id: s.id,
      title: s.name || '',
      identityText: '',
      recency: recencyByShow.get(s.id) || 0,
      episodeCount: s.episodeCount, posterEpisodeId: s.posterEpisodeId,
    });
  }
  return out;
}

// TV episodes (already RBAC-filtered by tvVisibleEpisodes). Client kind
// 'tv-episode'.
function searchTvEpisodes(q, req, deps) {
  const eps = deps.gates.tvVisibleEpisodes(req);
  const out = [];
  for (const ep of eps) {
    pushIfMatch(out, q, {
      resultType: 'tv-episode', kind: 'tv-episode', id: ep.id,
      title: ep.title || '',
      identityText: ep.showName || '',
      recency: rank.toRecency(ep.addedAt), // ISO string -> ms (was silently 0)
      showId: ep.showId, showName: ep.showName, seasonNum: ep.seasonNum, episodeNum: ep.episodeNum,
    });
  }
  return out;
}

// db.books.items. RBAC: bookVisibleTo. Client kind 'book'.
function searchBooks(q, req, deps) {
  const items = Object.values((deps.db && deps.db.books && deps.db.books.items) || {});
  const out = [];
  for (const b of items) {
    if (!deps.gates.bookVisibleTo(req, b)) continue;
    pushIfMatch(out, q, {
      resultType: 'book', kind: 'book', id: b.id,
      title: b.title || '',
      identityText: b.author || '',
      recency: rank.toRecency(b.addedAt), // ISO string -> ms (was silently 0)
      author: b.author,
    });
  }
  return out;
}

// The registry. `library` is the KIND_TO_LIBRARY value the provider covers
// (the census authority); `chip` is the client filter it belongs to.
const PROVIDERS = [
  { type: 'video', chip: 'videos', library: 'video', search: (q, req, d) => searchMetadata(q, req, d, 'video') },
  { type: 'audio', chip: 'audio', library: 'video', search: (q, req, d) => searchMetadata(q, req, d, 'audio') },
  { type: 'music', chip: 'music', library: 'music', search: searchMusic },
  { type: 'podcast-show', chip: 'podcasts', library: 'podcasts', search: searchPodcastShows },
  { type: 'podcast-episode', chip: 'podcasts', library: 'podcasts', search: searchPodcastEpisodes },
  { type: 'tv-show', chip: 'shows', library: 'tv', search: searchTvShows },
  { type: 'tv-episode', chip: 'shows', library: 'tv', search: searchTvEpisodes },
  { type: 'book', chip: 'books', library: 'books', search: searchBooks },
];

// The valid content-type filter chips (client + endpoint validation). Order is
// the display order of the chip row after "All".
const SEARCH_CHIPS = ['videos', 'audio', 'music', 'podcasts', 'shows', 'books'];

function normalizeChip(raw) {
  return SEARCH_CHIPS.includes(raw) ? raw : 'all';
}

// Run the matching providers for (query, chip) and return the BLENDED, ranked
// flat result list. `chip` 'all'/absent -> every provider. Empty query -> [].
function runSearch(query, chip, req, deps) {
  const q = typeof query === 'string' ? query : '';
  if (q.trim() === '') return [];
  const want = normalizeChip(chip);
  const providers = want === 'all' ? PROVIDERS : PROVIDERS.filter((p) => p.chip === want);
  let all = [];
  for (const p of providers) all = all.concat(p.search(q, req, deps));
  return rank.rankResults(all, q);
}

module.exports = { PROVIDERS, SEARCH_CHIPS, normalizeChip, runSearch };
