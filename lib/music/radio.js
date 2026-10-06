'use strict';

// v1.368.0 music radio: the station picker (plan docs/exec-plans/active/2026-10-06-v1368-music-radio.md,
// rulings R7-R13). PURE: no I/O, no clock reads, no Math.random - the caller passes the viewer's
// VISIBLE library (the list GET /api/music builds), the session context and a seeded rng, so the
// route, the unit tests and tools/radio-sim/simulate.js (--picker new) all run the same code.
//
// A station has a SEED (a track, an artist, an album or a genre) that every batch is drawn against
// (R8), never "the last track". Candidates fall into similarity tiers (R9), closest first:
//   T1 the seed artist (track artist OR album artist)
//   T2 the seed's primary genre AND a year within YEAR_WINDOW of the seed's
//   T3 the seed's primary genre
//   T4 a neighbouring genre (the library has an artist with tracks in both; weight = shared artists)
//   T5 the seed's folder / channel (the fallback for untagged tracks)
//   T6 the seed's YouTube category, for a station with no genre (T0 tuning, see genreKey)
//   T7 the rest of the library, only so the station never falls silent
// A batch MIXES tiers (TIER1_PER_BATCH from T1, the rest from the closest non-empty tier below it)
// so the seed artist recurs without dominating; a farther tier is drawn only when every closer one
// is exhausted for this session (its tracks are all in the exclude list). Within a tier a liked
// track weighs LIKED_WEIGHT and a track played in the last RECENT_MS weighs RECENT_WEIGHT (R10).
// Artist spacing (R12): never 3 in a row from one artist, counting the session's last plays; it can
// widen a pick to a farther close tier (T1-T6) but never to T7, where it relaxes instead (R4).
// Session memory (R11): exclude = the session's played ids, oldest first; when EVERY visible track
// is excluded the least recently played come back first (no silence).

const store = require('./store');
const tags = require('./tags');

const BATCH_COUNT = 5;
const MAX_COUNT = 20;
const TIER1_PER_BATCH = 2; // R9 / R12: at most 2 per batch of 5 from the seed artist
const MAX_ARTIST_RUN = 2; // R12: never 3 in a row from one artist
const YEAR_WINDOW = 5; // R9 T2
const LIKED_WEIGHT = 2; // R10
const RECENT_WEIGHT = 0.25; // R10: a soft cool-down across reloads
const RECENT_MS = 24 * 60 * 60 * 1000;
const ARTIST_WINDOW = 20; // T0 tuning: an hour of plays (T0's span mode: 19 a median hour, 21 at p90)
const ARTIST_WINDOW_MAX = 3; // T0 tuning: the "at most 3 per hour" target
const EXCLUDE_CAP = 200; // R11: the client sends at most the last 200 ids

// The simulator's primaryGenre (tools/radio-sim/simulate.js): the first of `; / , |`, trimmed,
// lowercased; '' -> null. The metric's definition; the tiers use genreKey below.
function primaryGenre(t) {
  const g = t && typeof t.genre === 'string' ? t.genre.split(/[;/,|]/)[0].trim().toLowerCase() : '';
  return g || null;
}

// YouTube's category names. yt-dlp writes the upload's CATEGORY as the genre tag, so on projected
// library audio "Music" or "Gaming" says which YouTube shelf it sat on, not what it sounds like
// (T0: `music` 3414, `gaming` 2419, `people & blogs` 261 of 53 primary genres). A station keyed
// on one would span every upload - today's randomness by another name - so on yt-dlp audio such a
// genre counts as untagged and the track falls to the folder / channel tier (T5).
const YOUTUBE_CATEGORIES = new Set([
  'film & animation', 'autos & vehicles', 'music', 'pets & animals', 'sports', 'travel & events',
  'gaming', 'people & blogs', 'comedy', 'entertainment', 'news & politics', 'howto & style',
  'education', 'science & technology', 'nonprofits & activism', 'movies', 'shows', 'trailers',
].map(foldGenre));

// A genre key: lowercased, `-` `_` and runs of spaces folded to one space (`hip-hop` = `hip hop`).
function foldGenre(g) {
  return typeof g === 'string' ? g.trim().toLowerCase().replace(/[-_\s]+/g, ' ') : '';
}

// The YouTube category a yt-dlp track sits in (folded), else null.
function categoryOf(t) {
  const g = foldGenre(primaryGenre(t) || '');
  return (g && YOUTUBE_CATEGORIES.has(g) && t && (t.source === 'library' || t.source === 'library-chapter')) ? g : null;
}

// The genre a station tiers by: the folded primary genre, except a YouTube category on yt-dlp
// audio (null, untagged). `categoryOk` keeps categories for a station seeded FROM one (a genre row
// named "Music" plays its own members).
function genreKey(t, categoryOk) {
  const g = foldGenre(primaryGenre(t) || '');
  if (!g) return null;
  if (!categoryOk && YOUTUBE_CATEGORIES.has(g) && t && (t.source === 'library' || t.source === 'library-chapter')) return null;
  return g;
}

function norm(s) {
  return typeof s === 'string' ? s.trim().toLowerCase() : '';
}

// Every artist name a track answers to (matchesArtist's track artist OR album artist), normalised.
function artistKeys(t) {
  const out = [];
  const a = norm(t && t.artist);
  const b = norm(t && t.albumArtist);
  if (a) out.push(a);
  if (b && b !== a) out.push(b);
  return out;
}

// The one artist a track is spaced by (R12): its track artist, else its album artist.
function spacingArtist(t) {
  return norm(t && t.artist) || norm(t && t.albumArtist) || '';
}

function trackYear(t) {
  return t ? tags.parseYear(t.year) : null;
}

function mostCommon(values) {
  const counts = new Map();
  let best = null;
  let bestN = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const n = (counts.get(v) || 0) + 1;
    counts.set(v, n);
    // ties go to the value seen first (stable for a stable library order)
    if (n > bestN) { best = v; bestN = n; }
  }
  return best;
}

function medianYear(tracks) {
  const ys = tracks.map(trackYear).filter((y) => y !== null).sort((a, b) => a - b);
  return ys.length ? ys[Math.floor((ys.length - 1) / 2)] : null;
}

// Parse a `seed` query value: `track:<id>`, `artist:<name>`, `album:<albumKey>`, `genre:<name>`.
// Anything else -> null.
function parseSeed(raw) {
  if (typeof raw !== 'string') return null;
  const m = /^(track|artist|album|genre):([\s\S]+)$/.exec(raw);
  if (!m) return null;
  const value = m[2];
  if (!value.trim() || value.length > 1000) return null;
  return { kind: m[1], value };
}

// A station profile: what every batch is drawn against. `library` is the viewer's visible list.
// Returns null when the seed matches nothing the viewer can see.
function buildStationProfile(seed, library) {
  if (!seed || !Array.isArray(library)) return null;
  const list = library;
  if (seed.kind === 'track') {
    const t = list.find((x) => x && x.id === seed.value);
    if (!t) return null;
    const artists = artistKeys(t);
    const folder = typeof t.folderName === 'string' ? t.folderName : null;
    // an untagged seed borrows its artist's most common genre, else its folder's (T0: 6013 of
    // 11951 chapter-tracks and 184 of 11450 native tracks carry no genre)
    const genre = genreKey(t)
      || mostCommon(list.filter((x) => artistKeys(x).some((a) => artists.includes(a))).map((x) => genreKey(x)))
      || (folder ? mostCommon(list.filter((x) => x.folderName === folder).map((x) => genreKey(x))) : null);
    return {
      kind: 'track',
      seedId: t.id,
      artists,
      genre,
      category: genre ? null : categoryOf(t),
      year: trackYear(t),
      folder,
    };
  }
  let members;
  if (seed.kind === 'artist') {
    const name = norm(seed.value);
    members = list.filter((t) => artistKeys(t).includes(name));
    if (!members.length) return null;
    return {
      kind: 'artist', seedId: null, artists: [name],
      genre: mostCommon(members.map((x) => genreKey(x))),
      year: medianYear(members),
      folder: mostCommon(members.map((t) => t.folderName)),
    };
  }
  if (seed.kind === 'album') {
    members = list.filter((t) => store.albumKeyFor(t) === seed.value);
    if (!members.length) return null;
    const artists = [];
    for (const t of members) for (const a of artistKeys(t)) if (!artists.includes(a)) artists.push(a);
    return {
      kind: 'album', seedId: null, albumKey: seed.value, artists,
      genre: mostCommon(members.map((x) => genreKey(x))),
      year: medianYear(members),
      folder: mostCommon(members.map((t) => t.folderName)),
    };
  }
  if (seed.kind === 'genre') {
    const genre = foldGenre(seed.value.split(/[;/,|]/)[0]);
    const categoryOk = YOUTUBE_CATEGORIES.has(genre);
    members = list.filter((t) => genreKey(t, categoryOk) === genre);
    if (!members.length) return null;
    return {
      kind: 'genre', seedId: null, artists: [], genre, categoryOk,
      year: null, // a genre station spans its years
      folder: null,
    };
  }
  return null;
}

// Genre neighbours (R9 T4): two primary genres are neighbours when the library has an artist with
// tracks in both; strength = the number of such artists. Computed from the list it is given (the
// VIEWER's visible library), so a hidden folder's artists never shape a member's station.
function genreNeighbours(library) {
  const byArtist = new Map();
  for (const t of library) {
    const g = genreKey(t);
    if (!g) continue;
    for (const a of artistKeys(t)) {
      if (!byArtist.has(a)) byArtist.set(a, new Set());
      byArtist.get(a).add(g);
    }
  }
  const out = new Map();
  for (const genres of byArtist.values()) {
    if (genres.size < 2) continue;
    const gs = [...genres];
    for (const x of gs) {
      for (const y of gs) {
        if (x === y) continue;
        if (!out.has(x)) out.set(x, new Map());
        const m = out.get(x);
        m.set(y, (m.get(y) || 0) + 1);
      }
    }
  }
  return out;
}

// The tier (1-7) of one candidate against a profile.
function tierOf(t, profile, neighbours) {
  if (profile.artists.length) {
    const keys = artistKeys(t);
    for (const k of keys) if (profile.artists.includes(k)) return 1;
  }
  const g = genreKey(t, profile.categoryOk);
  if (profile.genre && g === profile.genre) {
    const y = trackYear(t);
    if (profile.year !== null && y !== null && Math.abs(y - profile.year) <= YEAR_WINDOW) return 2;
    return 3;
  }
  if (profile.genre && g && neighbours && neighbours.has(profile.genre) && neighbours.get(profile.genre).has(g)) return 4;
  if (profile.folder && t.folderName === profile.folder) return 5;
  if (profile.category && categoryOf(t) === profile.category) return 6;
  return 7;
}

function isRecent(id, ctx) {
  const p = ctx.progress && Object.prototype.hasOwnProperty.call(ctx.progress, id) ? ctx.progress[id] : null;
  if (!p || !p.updatedAt) return false;
  const at = Date.parse(p.updatedAt);
  return Number.isFinite(at) && Number.isFinite(ctx.now) && ctx.now - at >= 0 && ctx.now - at < RECENT_MS;
}

function weightOf(t, tier, profile, neighbours, ctx) {
  let w = 1;
  if (tier === 4) w = neighbours.get(profile.genre).get(genreKey(t, profile.categoryOk)) || 1;
  if (ctx.liked && ctx.liked.has(t.id)) w *= LIKED_WEIGHT;
  if (isRecent(t.id, ctx)) w *= RECENT_WEIGHT;
  return w;
}

// Would appending `t` after `seq` (the session's recent artists + this batch so far) make a run of
// more than MAX_ARTIST_RUN from one artist (R12), or a 4th play of one artist inside the last
// ARTIST_WINDOW plays (T0 tuning)? An untagged artist never counts.
// `runOnly` checks the run rule alone (the first thing relaxed is the window, never the run).
function breaksSpacing(t, seq, runOnly) {
  const a = spacingArtist(t);
  if (!a) return false;
  if (!runOnly) {
    let inWindow = 0;
    for (let k = Math.max(0, seq.length - ARTIST_WINDOW + 1); k < seq.length; k += 1) if (seq[k] === a) inWindow += 1;
    if (inWindow >= ARTIST_WINDOW_MAX) return true;
  }
  if (seq.length < MAX_ARTIST_RUN) return false;
  for (let k = seq.length - MAX_ARTIST_RUN; k < seq.length; k += 1) if (seq[k] !== a) return false;
  return true;
}

// One weighted draw (without replacement) from `pool` honouring artist spacing; returns the index
// in `pool` or -1. A key-per-candidate draw (u^(1/w), Efraimidis-Spirakis) so it is reproducible
// for a given rng sequence.
function drawFrom(pool, seq, rng, runOnly) {
  let best = -1;
  let bestKey = -1;
  for (let k = 0; k < pool.length; k += 1) {
    const c = pool[k];
    if (seq && breaksSpacing(c.t, seq, runOnly)) continue;
    const key = Math.pow(rng(), 1 / c.w);
    if (key > bestKey) { bestKey = key; best = k; }
  }
  return best;
}

// The batch. `ctx`: { exclude: string[] (oldest play first), liked: Set<id>, progress: {id:
// {updatedAt}}, now: ms, count }. Returns the picked library objects in play order.
function pickRadioBatch(profile, library, ctx, rng) {
  if (!profile || !Array.isArray(library) || typeof rng !== 'function') return [];
  const c = ctx || {};
  const count = Math.max(1, Math.min(MAX_COUNT, Number.isInteger(c.count) ? c.count : BATCH_COUNT));
  const exclude = Array.isArray(c.exclude) ? c.exclude.slice(-EXCLUDE_CAP) : [];
  const excluded = new Set(exclude);
  if (profile.seedId) excluded.add(profile.seedId);
  const byId = new Map();
  for (const t of library) if (t && typeof t.id === 'string' && !byId.has(t.id)) byId.set(t.id, t);
  // the session's last plays' artists seed the spacing rule (R12 across batches)
  const seq = [];
  for (const id of exclude.slice(-ARTIST_WINDOW)) {
    const t = byId.get(id);
    seq.push(t ? spacingArtist(t) : '');
  }
  // a station with neither a genre nor a category (an untagged artist in an untagged folder) anchors
  // on what the session has been playing: the most common genre of its last ARTIST_WINDOW plays, so
  // its first step out of the seed artist sets a direction it then keeps (drift, not a jump per pick)
  if (!profile.genre && !profile.category) {
    const recent = exclude.slice(-ARTIST_WINDOW).map((id) => byId.get(id)).filter(Boolean);
    const g = mostCommon(recent.map((t) => genreKey(t)));
    if (g) profile = Object.assign({}, profile, { genre: g, year: medianYear(recent.filter((t) => genreKey(t) === g)) });
  }
  const neighbours = genreNeighbours(library);
  const tiers = [[], [], [], [], [], [], [], []]; // index 1..7
  for (const t of byId.values()) {
    if (excluded.has(t.id)) continue;
    const tier = tierOf(t, profile, neighbours);
    tiers[tier].push({ t, w: weightOf(t, tier, profile, neighbours, c) });
  }
  const picks = [];
  // the slot plan: TIER1_PER_BATCH seed-artist slots spread through the batch (slots 0 and 2 of 5);
  // every other slot draws the closest non-empty tier below T1 (T2 before T3: closest first), and
  // reaches back to T1 only when T2-T7 are all empty
  const tier1Slots = new Set();
  for (let k = 0; k < Math.min(TIER1_PER_BATCH, count); k += 1) tier1Slots.add(Math.floor((k * count) / TIER1_PER_BATCH));
  for (let slot = 0; slot < count; slot += 1) {
    const order = tier1Slots.has(slot) ? [1, 2, 3, 4, 5, 6, 7] : [2, 3, 4, 5, 6, 7, 1];
    // T7 (the rest: an unrelated genre) is drawn only when T1-T6 are ALL empty: artist spacing may
    // widen a pick to a farther CLOSE tier, never to an unrelated genre (R4 beats R12 there). A
    // station with neither a genre nor a category has nothing to stay close to, so spacing may reach
    // T7 rather than replay one artist (the selftest's untagged seeds ran one artist 15 in a row).
    const farOk = !profile.genre && !profile.category;
    let allowed = order.filter((tier) => (tier !== 7 || farOk) && tiers[tier].length);
    if (!allowed.length && tiers[7].length) allowed = [7];
    let got = null;
    // spacing could not be honoured in any allowed tier (few artists left close by): relax the hourly
    // window first, then the run rule, in the closest tier, rather than jump genre or go silent
    for (const pass of ['full', 'runOnly', 'none']) {
      for (const tier of allowed) {
        const idx = drawFrom(tiers[tier], pass === 'none' ? null : seq, rng, pass === 'runOnly');
        if (idx < 0) continue; // every candidate here breaks the spacing: try the next tier
        got = tiers[tier].splice(idx, 1)[0];
        break;
      }
      if (got) break;
    }
    if (!got) break;
    picks.push(got.t);
    seq.push(spacingArtist(got.t));
  }
  if (picks.length < count) {
    // R11: every visible track is in the exclude list - the least recently played come back first
    const picked = new Set(picks.map((t) => t.id));
    for (const id of exclude) {
      if (picks.length >= count) break;
      const t = byId.get(id);
      if (!t || picked.has(id) || id === profile.seedId) continue;
      picked.add(id);
      picks.push(t);
    }
  }
  return picks;
}

module.exports = {
  ARTIST_WINDOW,
  ARTIST_WINDOW_MAX,
  BATCH_COUNT,
  EXCLUDE_CAP,
  LIKED_WEIGHT,
  MAX_ARTIST_RUN,
  MAX_COUNT,
  RECENT_WEIGHT,
  TIER1_PER_BATCH,
  YEAR_WINDOW,
  buildStationProfile,
  genreKey,
  genreNeighbours,
  parseSeed,
  pickRadioBatch,
  primaryGenre,
  tierOf,
};
