'use strict';

// v1.368.0 music radio: the station picker (plan docs/exec-plans/completed/2026-10-06-v1368-music-radio.md,
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
// is excluded the least recently played come back first (the server's answer is never empty while
// the library has a track; the client still drops any that are queued - see music.js).
// WIDEN (gate r3 adversary W10): the client sends only the plays that fit a URL budget, so in a long
// session the close tiers can hold old plays the server no longer knows about; when a batch keeps
// nothing the client asks again with ctx.widen, and the picker draws from T7 first as if T1-T6 were
// spent (the drift the station takes when its close pool runs out).
//
// v1.375.0 "radio that feels like radio" (plan docs/exec-plans/active/2026-10-08-v1375-radio-like-radio.md,
// Dean's rulings Q1-Q4, 2026-10-08). A station is defined by its SEED alone: what the session played
// before never steers it (Q3 - v1.368.0's "session genre anchor" borrowed the last 24 plays' genre for
// a station with no genre, the measured cause of Kirby -> Prince). A GAME-MUSIC station - a seed whose
// genre is a game genre ('video game', 'chiptune'), or junk (none, or a YouTube category on yt-dlp audio)
// with its songs or its series mostly game music - draws a SERIES-FIRST ladder instead of the genre
// tiers (Q1, Q2, Q4; the same tiers for every seed kind but genre). Any other junk-genre station keeps
// v1.368.0's T1 / T5 / T6 / T7 (gate r1 qa W1: series words on a lofi channel's "... radio - beats to
// relax/study to" pulled Queen's "Radio Ga Ga" and "Hip Hop Classics"):
//   T8  SERIES: GAME MUSIC whose album or title shares a series word of the seed (Kirby, Zelda,
//       "mega man": rare words of the seed's album / song title, used by 2+ channels; see stationPlan) -
//       a rock, hip-hop or classical song never enters it, whatever words it shares
//   T1  the seed artist (and the seed album's own songs), ONE slot per batch (it takes others' spent slots)
//   T9  GAME MUSIC, the family: a game genre tag ('gaming', 'video game', 'chiptune'...) or an upload of
//       a channel with a strict majority of game-tagged uploads (3 at least); never a podcast / vlog /
//       talk-show category upload (see stationPlan)
//   T10 the NEAREST real genres: the genres the family's artists also play, and soundtrack-like ones
//   T7  the rest, only when every closer tier is spent (or widen)
// Batch plan (5): series, series, the seed artist, series, family - and a spent tier hands its slot
// to the next one in its order (STATION_ORDERS), so as the series empties game music takes over, then
// the nearest genres, and the whole library only last. Seeds with a REAL genre keep T1-T7 above.

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
const ARTIST_WINDOW = 24; // T0 tuning: an hour of plays (19 a median hour at T0's span mode, 21 at p90 in both pickers' runs) plus margin
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

// The one "artist" a track is spaced by (R12 and the hourly cap): its track artist, else its album
// artist - except a CHAPTER of a DJ set, whose artist field is the channel (every chapter a different
// song). A chapter is spaced by its SET (the file), so a station seeded from a DJ channel stays on the
// channel and mixes its sets, never more than 2 in a row from one set (Dean's ruling 2026-10-06:
// "stay on the channel"; production run 2 measured these stations leaving their channel after 3
// chapters for random picks, T7 70.6% at the 1-hour p90).
function spacingArtist(t) {
  if (t && t.source === 'library-chapter' && typeof t.id === 'string') return 'set:' + t.id.replace(/::c\d+$/, '');
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
    const albumKey = (typeof t.album === 'string' && t.album.trim()) ? store.albumKeyFor(t) : null;
    return {
      kind: 'track',
      seedId: t.id,
      artists,
      genre,
      category: genre ? null : categoryOf(t),
      year: trackYear(t),
      folder,
      // v1.375.0: what the series words are read from (seriesTerms) and the seed's own album (T1)
      albumKey,
      albumTitle: albumKey ? t.album : '',
      songTitle: typeof t.title === 'string' ? t.title : '',
      memberTitles: albumKey ? list.filter((x) => x && x.album && store.albumKeyFor(x) === albumKey).map((x) => x.title) : [],
      memberIds: [t.id], // the seed's own songs: is the station game music (stationPlan)
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
      albumKey: null, albumTitle: '', songTitle: '', memberTitles: [], // an artist names no series (v1.375.0)
      memberIds: members.map((t) => t.id),
    };
  }
  if (seed.kind === 'album') {
    members = list.filter((t) => store.albumKeyFor(t) === seed.value);
    if (!members.length) return null;
    const artists = [];
    for (const t of members) for (const a of artistKeys(t)) if (!artists.includes(a)) artists.push(a);
    const folder = mostCommon(members.map((t) => t.folderName));
    // v1.375.0 (Q4, one rule for every entry point): an untagged album borrows its artists' most common
    // genre, else its folder's - exactly as a song of it does (the track seed above), so the album
    // page's Radio and a song's Start radio of the same album draw the same ladder
    let genre = mostCommon(members.map((x) => genreKey(x)));
    if (!genre) {
      // one scan for both borrows (the artists', else the folder's)
      const byArtist = []; const byFolder = [];
      for (const x of list) {
        if (!x) continue;
        if (folder && x.folderName === folder) byFolder.push(x);
        if (artists.includes(norm(x.artist)) || artists.includes(norm(x.albumArtist))) byArtist.push(x);
      }
      genre = mostCommon(byArtist.map((x) => genreKey(x))) || (folder ? mostCommon(byFolder.map((x) => genreKey(x))) : null);
    }
    return {
      kind: 'album', seedId: null, albumKey: seed.value, artists,
      genre,
      // v1.375.0 (gate r1 qa W1): an untagged album keeps its YouTube category as its last close tier
      // (T6), as a song of it always did - a lofi channel's album widens to other "Music" uploads before
      // the whole library
      category: genre ? null : mostCommon(members.map(categoryOf)),
      year: medianYear(members),
      folder,
      albumTitle: members[0].album || '', songTitle: '', memberTitles: members.map((t) => t.title),
      memberIds: members.map((t) => t.id),
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

// Genre neighbours (R9 T4), each with a strength the T4 draw weighs by:
//   - an artist BRIDGE: the library has an artist with tracks in both (strength += 1 per artist);
//   - a FAMILY: the two names share a word of 3+ letters other than a generic one (`grunge rock` ~
//     `folk rock`, `thrash metal` ~ `death metal`; strength += 1). T0 tuning: only 34 of 488 tagged
//     artists span two genres, so bridges alone left rare genres nothing close, and their stations
//     fell to T7 (21.1% of production picks);
//   - SECOND DEGREE: a neighbour's neighbour that is not a neighbour itself (strength 0.25).
// Computed from the list it is given (the VIEWER's visible library), so a hidden folder's artists
// never shape a member's station.
const GENERIC_GENRE_WORDS = new Set(['music', 'and', 'the', 'of', 'new', 'old', 'school', 'style']);
function genreWords(g) {
  return g.split(/[\s&+]+/).filter((w) => w.length >= 3 && !GENERIC_GENRE_WORDS.has(w));
}
// `onlyGenre` (the picker's case): only that genre's row (and the direct rows its second degree needs)
// is built - the picker reads one row, and the whole graph was ~30 ms of a request on a 23.5k-track
// library (gate r1 adversary S3, security S1). Without it, the whole graph (the simulator, the tests).
function genreNeighbours(library, onlyGenre, keyOf) {
  const gk = typeof keyOf === 'function' ? keyOf : (t) => genreKey(t);
  const genreArtists = new Map(); // genre -> Set(artist)
  const artistGenres = new Map(); // artist -> Set(genre)
  for (const t of library) {
    const g = gk(t);
    if (!g) continue;
    if (!genreArtists.has(g)) genreArtists.set(g, new Set());
    for (const a of artistKeys(t)) {
      genreArtists.get(g).add(a);
      if (!artistGenres.has(a)) artistGenres.set(a, new Set());
      artistGenres.get(a).add(g);
    }
  }
  const byWord = new Map();
  for (const g of genreArtists.keys()) for (const w of genreWords(g)) { if (!byWord.has(w)) byWord.set(w, new Set()); byWord.get(w).add(g); }
  const directCache = new Map();
  function direct(x) {
    if (directCache.has(x)) return directCache.get(x);
    const row = new Map();
    for (const a of genreArtists.get(x) || []) {
      for (const y of artistGenres.get(a) || []) if (y !== x) row.set(y, (row.get(y) || 0) + 1); // a bridge
    }
    for (const w of genreWords(x)) {
      for (const y of byWord.get(w) || []) if (y !== x) row.set(y, (row.get(y) || 0) + 1); // a family word
    }
    directCache.set(x, row);
    return row;
  }
  function full(x) {
    const m = direct(x);
    const row = new Map(m);
    for (const y of m.keys()) {
      for (const z of direct(y).keys()) if (z !== x && !row.has(z)) row.set(z, 0.25); // second degree
    }
    return row;
  }
  const out = new Map();
  const keys = onlyGenre ? (genreArtists.has(onlyGenre) ? [onlyGenre] : []) : [...genreArtists.keys()];
  for (const x of keys) { const row = full(x); if (row.size) out.set(x, row); }
  return out;
}

// The tier (1-7) of one candidate against a profile.
function tierOf(t, profile, neighbours, keyOf) {
  if (profile.artists.length) {
    const keys = artistKeys(t);
    for (const k of keys) if (profile.artists.includes(k)) return 1;
  }
  const g = (keyOf && !profile.categoryOk) ? keyOf(t) : genreKey(t, profile.categoryOk);
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

// ---------------------------------------------------------------- v1.375.0: the series-first ladder
// (header above; plan docs/exec-plans/active/2026-10-08-v1375-radio-like-radio.md). Everything here is
// computed per request from the list it is given (the VIEWER's visible library) - no shared cache, so a
// hidden folder's titles never shape a member's station (the v1.368.0 invariant).
const TIER_SERIES = 8;
const TIER_GAME = 9;
const TIER_NEAR = 10;
const SERIES_DF_SHARE = 0.25; // a series word names at most a quarter of the game-music titles (the df universe is game music only)...
const SERIES_DF_FLOOR = 8; // ...or 8, so a small library keeps its series words
const SERIES_MIN_ARTISTS = 2; // ...and 2+ channels use it: one channel's title template ("2 Hours of Happy and Underrated") is no series
const SERIES_MAX_TERMS = 8; // the strongest 8 (rarest first)
const SERIES_COVERAGE = 0.5; // a word in half an album's song titles (and in 3 of them at least) names the album too
const SERIES_COVERAGE_MIN = 3;
const SERIES_CANDIDATES_MAX = 30; // the seed words tested (a 30-bit mask per track)
const SERIES_GAME_MIN = 10; // a junk-genre seed is game music when its series holds 10+ game songs from 2+ channels
const GAME_CHANNEL_MIN = 3; // a game channel: a STRICT majority of its genre-tagged uploads game music, and 3 of them at least

// The game-music genres (folded): YouTube's 'Gaming' category and the native tags game music carries.
const GAME_GENRES = new Set(['gaming', 'video game', 'video games', 'videogame', 'videogames', 'video game music',
  'game', 'games', 'game music', 'game soundtrack', 'vgm', 'chiptune', 'chiptunes', 'chip tune', 'chipmusic',
  'chip music', '8 bit', '8bit'].map(foldGenre));
// The nearest REAL genres to game music even when no artist bridges them (T10, +1 strength).
const NEAR_GAME_WORDS = /soundtrack|score|anime|orchestral|film|cinematic/;

// Words that never name a series: English glue (never part of a two-word name either)...
const SERIES_GLUE = new Set(('the and of a an to in on for with from by at my your our its it this that these those '
  + 'you me we us all no not or but are is was be into out up down over under about off than then so too ever every '
  + 'feat ft featuring vs versus amp one two three four five six seven eight nine ten').split(' '));
// ...and style, format, mood, platform and generic game words (grown from the shapes of YouTube
// video-game-music titles): never a series word alone, allowed beside a name ("mega man", "star fox").
const SERIES_STOP = new Set(('lofi lo fi hifi jazz jazzy remix remixes remixed rmx ost osts soundtrack soundtracks score '
  + 'music musics song songs track tracks theme themes tune tunes chill chilled chillout chillhop beats beat mix mixes '
  + 'mixed medley megamix relaxing relax relaxed study studying focus sleep sleeping vibes vibe hour hours hr hrs '
  + 'minute minutes min mins full album albums ep lp compilation collection playlist best top greatest ultimate '
  + 'complete extended version ver edit cover covers arrangement arranged orchestral orchestra orchestrated symphonic '
  + 'piano guitar acoustic ambient ambience ambiance rain rainy cozy calm calming peaceful happy sad nostalgic '
  + 'nostalgia underrated beautiful epic emotional smooth soft slowed reverb nightcore bit live instrumental '
  + 'instrumentals vol volume part pt disc cd side official video audio hq hd remastered remaster remake game games '
  + 'gaming videogame vgm chiptune nintendo sega snes nes n64 gamecube wii switch playstation ps1 ps2 ps3 ps4 ps5 psp '
  + 'xbox gameboy gba nds 3ds famicom genesis arcade pc retro classic classics original originals edition deluxe dx '
  + 'plus ultra super star stars world worlds land lands adventure adventures legend legends return returns quest '
  + 'saga origins bros brothers kingdom dream dreams man boss battle battles title screen stage level levels area '
  + 'zone town castle main final day night winter summer spring autumn christmas').split(' '));

// YouTube categories that are not music at all: an upload filed there (a podcast, a vlog, a talk
// show) never joins the game family or the series, whatever channel posted it (gate r1 adversary W2)
const NON_MUSIC_CATEGORIES = new Set(['people & blogs', 'comedy', 'entertainment', 'news & politics', 'education',
  'howto & style', 'science & technology', 'nonprofits & activism', 'sports', 'travel & events', 'autos & vehicles',
  'pets & animals'].map(foldGenre));

// A title folded for word matching: accents off, `'s` off, every run of non-letters one space
// ("Kirby's Dream Land" -> "kirby dream land", an accented e in Pokemon -> "pokemon").
function foldText(s) {
  if (typeof s !== 'string' || !s) return '';
  const plain = /^[\x20-\x7e]*$/.test(s) ? s : s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); // ASCII skips the costly normalize
  return plain.toLowerCase().replace(/['\u2019]s\b/g, '').replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Pure-function memos keyed by the raw STRING (a title, a genre tag): the folded words / the folded
// genre of a string are the same for every viewer, so the memo holds no library-derived aggregate and
// no viewer's view (the v1.368.0 "no shared cache" invariant is about a viewer's library shaping
// another's station - a lookup here is only ever made with a string from the caller's own visible list).
// Bounded: cleared at MEMO_MAX entries. Gate r1 adversary W1: folding every game title per request was
// most of the plan's cost.
const MEMO_MAX = 200000;
const WORDS_MEMO = new Map();
function foldedWords(raw) {
  let w = WORDS_MEMO.get(raw);
  if (w === undefined) {
    const f = foldText(raw);
    w = f ? f.split(' ') : [];
    if (WORDS_MEMO.size >= MEMO_MAX) WORDS_MEMO.clear();
    WORDS_MEMO.set(raw, w);
  }
  return w;
}
const MASK_MEMO = new Map(); // a station's candidate words (joined) -> Map(title -> mask)
const MASK_MEMO_STATIONS = 8;
const GENRE_MEMO = new Map();
// the folded primary genre of a track ('' when untagged), memoised by its raw genre tag
function foldedGenreOf(t) {
  const raw = t && typeof t.genre === 'string' ? t.genre : '';
  let g = GENRE_MEMO.get(raw);
  if (g === undefined) {
    const pg = primaryGenre(t);
    g = pg ? foldGenre(pg) : '';
    if (GENRE_MEMO.size >= MEMO_MAX) GENRE_MEMO.clear();
    GENRE_MEMO.set(raw, g);
  }
  return g;
}

function isContentWord(w) {
  return w.length >= 3 && !/^\d+$/.test(w) && !/^[ivx]{1,4}$/.test(w) && !SERIES_STOP.has(w) && !SERIES_GLUE.has(w);
}
function pairWordOk(w) {
  return w.length >= 2 && !/^\d+$/.test(w) && !SERIES_GLUE.has(w);
}
// The candidate series words of one title: its content words and its two-word names (two adjacent
// words, neither glue nor a number, at least one a content word: "mega man", "chrono trigger").
function termsOf(raw) {
  const out = new Set();
  const f = foldText(raw);
  if (!f) return out;
  const words = f.split(' ');
  for (let k = 0; k < words.length; k += 1) {
    const w = words[k];
    if (isContentWord(w)) out.add(w);
    const n = words[k + 1];
    if (n && pairWordOk(w) && pairWordOk(n) && (isContentWord(w) || isContentWord(n))) out.add(w + ' ' + n);
  }
  return out;
}

// A track's channel for the game family and the per-channel weights: the channel FOLDER for yt-dlp
// audio (a chapter's artist is the channel too, but a plain upload's artist tag is often the
// performer), the album artist / artist for native files.
function channelIsFolder(t) {
  return (t.source === 'library' || t.source === 'library-chapter') && typeof t.folderName === 'string' && !!t.folderName;
}
function channelOf(t) {
  return channelIsFolder(t) ? 'f:' + t.folderName : 'a:' + (norm(t.albumArtist) || norm(t.artist));
}

// The station plan for a GAME-MUSIC station (a game-genre seed, or a junk-genre seed whose songs are
// mostly game music or whose series is game music); null for everything else - a real genre, a genre
// station, and a junk-genre station that is not game music all take the T1-T7 genre ladder.
// Pass 1 tallies every channel's genre tags (the game channels); pass 2 reads the titles of GAME MUSIC
// only, each folded and split ONCE into words (gate r1 adversary W1: no per-title regex), and matches
// them against the seed's candidate words by hash lookup. The series tier holds game music only (the
// Architect's ruling on gate r1 adversary C1: a rock, hip-hop or classical song never enters it,
// whatever words it shares). Returns { tierOf(t), weigh(tiers, ctx), slotOrder(slot, count), isGame,
// inSeries, game, terms, allTerms, docs, familySize, seriesSize, near } - tools/radio-sim's --trace
// prints it; with { verdict: true } a non-game station answers { game: false, ... } instead of null.
function stationPlan(profile, library, opts) {
  if (!profile || profile.kind === 'genre' || !Array.isArray(library)) return null;
  if (profile.genre && !GAME_GENRES.has(profile.genre)) return null;
  // the seed's words: its album title's, any word in half (and 3+) of its songs' titles, its song title's
  const albumTerms = termsOf(profile.albumTitle || '');
  const members = Array.isArray(profile.memberTitles) ? profile.memberTitles : [];
  const cover = new Map();
  for (const title of members) for (const w of termsOf(title)) cover.set(w, (cover.get(w) || 0) + 1);
  for (const [w, n] of cover) if (n >= SERIES_COVERAGE_MIN && n / members.length >= SERIES_COVERAGE) albumTerms.add(w);
  const songTerms = [...termsOf(profile.songTitle || '')].filter((w) => !albumTerms.has(w));
  const cand = [...albumTerms].map((term) => ({ term, kind: 'album' }))
    .concat(songTerms.map((term) => ({ term, kind: 'song' }))).slice(0, SERIES_CANDIDATES_MAX);
  const candIdx = new Map(cand.map((x, k) => [x.term, k]));
  // pass 1: every channel's genre tags (the game channels) and the seed's own songs
  const tallyF = new Map(); // channel folder -> [genre-tagged, game-tagged, tracks]
  const tallyA = new Map(); // native channel (album artist / artist) -> the same
  const seedIds = new Set(profile.memberIds || []);
  const seedAlbum = profile.albumTitle || '';
  const seedRecs = [];
  const genreArtists = new Map(); // real genre -> Set(artist) (the T10 bridges, counted against the family below)
  for (const t of library) {
    if (!t) continue;
    const fg = foldedGenreOf(t);
    const isF = channelIsFolder(t);
    const tally = isF ? tallyF : tallyA;
    const ck = isF ? t.folderName : (norm(t.albumArtist) || norm(t.artist));
    let row = tally.get(ck);
    if (!row) { row = [0, 0, 0]; tally.set(ck, row); }
    row[2] += 1;
    if (fg) {
      row[0] += 1;
      if (GAME_GENRES.has(fg)) row[1] += 1;
      else if (!(isF && YOUTUBE_CATEGORIES.has(fg))) { // a real genre (= genreKey)
        let set = genreArtists.get(fg);
        if (!set) { set = new Set(); genreArtists.set(fg, set); }
        const a = norm(t.artist); const b = norm(t.albumArtist);
        if (a) set.add(a);
        if (b) set.add(b);
      }
    }
    // the seed's own songs (an album / song seed's share one album title: a cheap filter first)
    if ((!seedAlbum || t.album === seedAlbum) && seedIds.has(t.id)) seedRecs.push(t);
  }
  const gameRow = (r) => r[1] >= GAME_CHANNEL_MIN && r[1] * 2 > r[0];
  const gameF = new Set(); const gameA = new Set();
  for (const [k, r] of tallyF) if (gameRow(r)) gameF.add(k);
  for (const [k, r] of tallyA) if (gameRow(r)) gameA.add(k);
  const fgOfT = foldedGenreOf;
  const gameChannel = (t) => (channelIsFolder(t) ? gameF.has(t.folderName) : gameA.has(norm(t.albumArtist) || norm(t.artist)));
  // game music: a native game genre tag ('video game', 'chiptune'), or an upload of a game channel -
  // never a non-music category upload. YouTube's 'Gaming' CATEGORY counts only through its channel: a
  // talk show or a vlog is filed under Gaming too (gate r1 adversary W2)
  const isGame = (t) => {
    const fg = fgOfT(t);
    if (NON_MUSIC_CATEGORIES.has(fg)) return false;
    if (GAME_GENRES.has(fg) && !(fg === 'gaming' && channelIsFolder(t))) return true;
    return gameChannel(t);
  };
  // pass 2: game music only - each title split once, its words looked up among the candidates
  const df = cand.map(() => 0);
  const firstCh = cand.map(() => null); // a word's first channel, and whether a second one uses it (2+ is all the rule reads)
  const twoCh = cand.map(() => false);
  const albumMask = new Map(); // album title -> mask (a set's chapters share it)
  const seenTitle = new Set(); // matching song titles already counted in df
  let titleDocs = 0;
  // a title's mask: its folded words looked up among the candidates (and a word + the next one, only
  // after a word that starts a candidate pair) - hash lookups, no regex per word
  const pairStarts = new Set(cand.filter((x) => x.term.includes(' ')).map((x) => x.term.split(' ')[0]));
  // the masks of a seed's words are a pure function of (the words, the title): memoised per word list,
  // so the next batches of the same station look each title up once (MASK_MEMO, a few stations kept)
  const sig = cand.map((x) => x.term).join('|');
  let masks = MASK_MEMO.get(sig);
  if (!masks) {
    masks = new Map();
    if (MASK_MEMO.size >= MASK_MEMO_STATIONS) MASK_MEMO.delete(MASK_MEMO.keys().next().value);
    MASK_MEMO.set(sig, masks);
  }
  const maskOfRaw = (raw) => {
    let m = masks.get(raw);
    if (m !== undefined) return m;
    if (masks.size >= MEMO_MAX) masks.clear();
    const words = foldedWords(raw);
    m = 0;
    for (let i = 0; i < words.length; i += 1) {
      const k = candIdx.get(words[i]);
      if (k !== undefined) m |= (1 << k);
      if (i + 1 < words.length && pairStarts.has(words[i])) { const kp = candIdx.get(words[i] + ' ' + words[i + 1]); if (kp !== undefined) m |= (1 << kp); }
    }
    masks.set(raw, m);
    return m;
  };
  const masked = []; // [track, albumMask, titleMask]
  const familyArtists = new Set(); // the artists of game music (the T10 bridges)
  let familySize = 0;
  for (const t of library) {
    if (!t || !isGame(t)) continue;
    familySize += 1;
    const a = norm(t.artist); const b = norm(t.albumArtist);
    if (a) familyArtists.add(a);
    if (b) familyArtists.add(b);
    if (!cand.length) continue;
    let am = 0;
    if (typeof t.album === 'string' && t.album) {
      am = albumMask.get(t.album);
      if (am === undefined) { am = maskOfRaw(t.album); albumMask.set(t.album, am); for (let k = 0; k < cand.length; k += 1) if (am & (1 << k)) df[k] += 1; }
    }
    let tm = 0;
    if (typeof t.title === 'string' && t.title) {
      titleDocs += 1;
      tm = maskOfRaw(t.title);
      if (tm && !seenTitle.has(t.title)) { seenTitle.add(t.title); for (let k = 0; k < cand.length; k += 1) if (tm & (1 << k)) df[k] += 1; }
    }
    const m = am | tm;
    if (m) {
      masked.push([t, m]);
      const ch = channelIsFolder(t) ? t.folderName : '\u0000' + (b || a); // a folder vs a native channel never collide
      for (let k = 0; k < cand.length; k += 1) {
        if (!(m & (1 << k))) continue;
        if (firstCh[k] === null) firstCh[k] = ch; else if (firstCh[k] !== ch) twoCh[k] = true;
      }
    }
  }
  const docs = albumMask.size + titleDocs; // the game-music album titles and song titles (song titles ~ all distinct)
  const dfCap = Math.max(SERIES_DF_FLOOR, SERIES_DF_SHARE * docs);
  const allTerms = cand.map((x, k) => Object.assign({}, x, { bit: k, df: df[k], artists: twoCh[k] ? 2 : (firstCh[k] === null ? 0 : 1), w: df[k] ? Math.log(docs / df[k]) : 0 }));
  const terms = allTerms
    .filter((x) => x.artists >= SERIES_MIN_ARTISTS && x.df <= dfCap && x.w > 0)
    .sort((x, y) => y.w - x.w)
    .slice(0, SERIES_MAX_TERMS);
  // in the series: an album word shared, or 2+ song words - a two-word name and its own words count as
  // ONE ("ice cream" + "ice" + "cream" is one shared name; gate r1 adversary C1)
  const inSeriesMask = (mask) => {
    const song = [];
    for (const x of terms) {
      if (!(mask & (1 << x.bit))) continue;
      if (x.kind === 'album') return true;
      song.push(x.term);
    }
    const names = song.filter((w) => w.includes(' '));
    const alone = song.filter((w) => !w.includes(' ') && !names.some((n) => n.split(' ').includes(w)));
    return names.length + alone.length >= 2;
  };
  const series = new Set();
  if (terms.length) for (const [t, m] of masked) if (inSeriesMask(m)) series.add(t);
  const seriesChannels = new Set([...series].map(channelOf));
  // is the station game music: a game-genre seed, most of the seed's songs, or a real game series
  const seedGame = seedRecs.filter(isGame).length;
  const game = !!((profile.genre && GAME_GENRES.has(profile.genre))
    || (seedRecs.length > 0 && seedGame * 2 >= seedRecs.length)
    || (series.size >= SERIES_GAME_MIN && seriesChannels.size >= 2));
  if (!game) {
    return (opts && opts.verdict) ? { game: false, terms, allTerms, docs, familySize, seriesSize: series.size, near: new Map() } : null;
  }
  // the nearest REAL genres (T10): the genres the game family's artists also play (strength = artists),
  // and the soundtrack-like genres (+1) - gentle widening before the whole library (Q4)
  const genreKeyOf = (t) => { const fg = fgOfT(t); return fg && !(YOUTUBE_CATEGORIES.has(fg) && (t.source === 'library' || t.source === 'library-chapter')) ? fg : null; };
  const near = new Map();
  for (const [g, set] of genreArtists) {
    let n = NEAR_GAME_WORDS.test(g) ? 1 : 0;
    for (const a of set) if (familyArtists.has(a)) n += 1;
    if (n > 0) near.set(g, n);
  }
  const seedArtists = profile.artists || [];
  const albumTitleTrim = typeof profile.albumTitle === 'string' ? profile.albumTitle.trim() : '';
  // no folder (T5) / category (T6) tier: for game music the family IS the game channels (T9), while a
  // folder is only where files sit - a native file's folder is its parent directory (lib/music/scan.js),
  // an album folder on an Artist/Album layout but the whole library on a flat one, and a yt-dlp folder
  // is the channel, already the seed artist or T9 (gate r1 qa S1)
  function tierOfPlan(t) {
    // the seed album's own songs, by album key (gate r1 qa S2; the trimmed title first, a cheap filter)
    if (profile.albumKey && typeof t.album === 'string' && t.album.trim() === albumTitleTrim && store.albumKeyFor(t) === profile.albumKey) return 1;
    if (series.has(t)) return TIER_SERIES;
    if (seedArtists.length && (seedArtists.includes(norm(t.artist)) || seedArtists.includes(norm(t.albumArtist)))) return 1;
    if (isGame(t)) return TIER_GAME;
    const g = genreKeyOf(t);
    if (g && near.has(g)) return TIER_NEAR;
    return 7;
  }
  // within the series and the game family: per track 1/sqrt(its channel's songs in that tier), so a big
  // channel still plays more than a small one but never drowns it (gate r1 adversary C1: an equal share
  // per channel let a 1-track channel play early); the nearest genres by strength; then likes x2 and
  // the 24 h cool-down (R10)
  function weigh(tiers, c) {
    for (const tier of [TIER_SERIES, TIER_GAME]) {
      const n = new Map();
      for (const x of tiers[tier]) { x.ch = channelOf(x.t); n.set(x.ch, (n.get(x.ch) || 0) + 1); }
      for (const x of tiers[tier]) x.w = 1 / Math.sqrt(n.get(x.ch));
    }
    for (const x of tiers[TIER_NEAR]) x.w = near.get(genreKeyOf(x.t)) || 1;
    for (const pool of tiers) {
      for (const x of pool) {
        if (c.liked && c.liked.has(x.t.id)) x.w *= LIKED_WEIGHT;
        if (isRecent(x.t.id, c)) x.w *= RECENT_WEIGHT;
      }
    }
  }
  // the batch plan (5): series, series, the seed artist, series, family; a spent tier hands its slot on
  // in its order, so the series yields to game music (Q4) and the seed artist stays a minority (Q2)
  function slotOrder(slot, count) {
    if (count >= 2 && slot === Math.floor(count / 2)) return STATION_ORDERS.artist;
    if (count >= 4 && slot === count - 1) return STATION_ORDERS.family;
    return STATION_ORDERS.series;
  }
  return { tierOf: tierOfPlan, weigh, slotOrder, isGame, inSeries: (t) => series.has(t), game, terms, allTerms, docs, familySize, seriesSize: series.size, near };
}
const STATION_ORDERS = {
  series: [TIER_SERIES, TIER_GAME, 1, TIER_NEAR, 7],
  artist: [1, TIER_SERIES, TIER_GAME, TIER_NEAR, 7],
  family: [TIER_GAME, TIER_SERIES, 1, TIER_NEAR, 7],
};

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

// Weighted draws without replacement (Efraimidis-Spirakis): a tier's candidates get a key u^(1/w) each and
// the tier is sorted by key; a slot takes the FIRST candidate in that order its spacing allows. When the
// slot took the top candidate the remaining keys are still a fresh draw (the fast path, O(rows looked at)
// instead of a full rescan - gate r1 adversary S3); when spacing SKIPPED candidates the tier is re-keyed
// before its next draw, because a skipped candidate's surviving key would otherwise favour it the moment
// spacing lets it back (gate r2 adversary W9: measured slot 1 0.51 -> 0.74 for a just-blocked artist).
function keyTier(pool, rng) {
  if (pool.keyed) return;
  for (const c of pool) c.key = Math.pow(rng(), 1 / c.w);
  pool.sort((x, y) => y.key - x.key);
  pool.keyed = true;
}
function drawFrom(pool, seq, rng, runOnly) {
  keyTier(pool, rng);
  for (let k = 0; k < pool.length; k += 1) {
    if (seq && breaksSpacing(pool[k].t, seq, runOnly)) continue;
    if (k > 0) pool.keyed = false; // candidates were skipped: fresh keys for the next draw from this tier
    return k;
  }
  return -1;
}

// The batch. `ctx`: { widen?: true (T7 first - see WIDEN above), exclude: string[] (the session's PLAYS, oldest first), queued: string[] (songs the
// client still has queued - never picked, but NOT plays: they shape neither the spacing nor the
// recycle; gate r2 adversary S7), liked: Set<id>, progress: {id: {updatedAt}}, now: ms,
// count, trace?: [] (receives {id, tier} per pick; the route passes none) }.
// Returns the picked library objects in play order.
function pickRadioBatch(profile, library, ctx, rng) {
  if (!profile || !Array.isArray(library) || typeof rng !== 'function') return [];
  const c = ctx || {};
  const count = Math.max(1, Math.min(MAX_COUNT, Number.isInteger(c.count) ? c.count : BATCH_COUNT));
  const exclude = Array.isArray(c.exclude) ? c.exclude.slice(-EXCLUDE_CAP) : [];
  const excluded = new Set(exclude);
  if (Array.isArray(c.queued)) for (const id of c.queued.slice(-EXCLUDE_CAP)) excluded.add(id);
  if (profile.seedId) excluded.add(profile.seedId);
  const byId = new Map();
  for (const t of library) if (t && typeof t.id === 'string' && !byId.has(t.id)) byId.set(t.id, t);
  // the session's last plays' artists seed the spacing rule (R12 across batches)
  const seq = [];
  for (const id of exclude.slice(-ARTIST_WINDOW)) {
    const t = byId.get(id);
    seq.push(t ? spacingArtist(t) : '');
  }
  // v1.375.0 (Q3, Dean): a station is defined by its SEED only - the session's earlier plays shape the
  // spacing and the exclusions, never the station's genre. (v1.368.0 borrowed the most common genre of
  // the last 24 plays for a station with no genre: a Kirby album after three Prince songs became a pop
  // station, and pop was 52% Prince - the measured Kirby -> Prince.)
  // each track's genre key once per request (the neighbour scan and the tiering both read it; the
  // folding regexes were most of a request's cost on a 23.5k-track library)
  const keys = new Map();
  const keyOf = (t) => { let k = keys.get(t); if (k === undefined) { k = genreKey(t); keys.set(t, k); } return k; };
  // v1.375.0: a junk-genre or game seed draws the series-first ladder (stationPlan), a real genre T1-T7
  const plan = stationPlan(profile, library);
  const neighbours = plan ? null : genreNeighbours(library, profile.genre, keyOf);
  const tiers = [[], [], [], [], [], [], [], [], [], [], []]; // index 1..10
  for (const t of byId.values()) {
    if (excluded.has(t.id)) continue;
    const tier = plan ? plan.tierOf(t) : tierOf(t, profile, neighbours, keyOf);
    tiers[tier].push({ t, tier, w: plan ? 1 : weightOf(t, tier, profile, neighbours, c) });
  }
  if (plan) plan.weigh(tiers, c);
  const picks = [];
  // the slot plan: TIER1_PER_BATCH seed-artist slots spread through the batch (slots 0 and 2 of 5);
  // every other slot draws the closest non-empty tier below T1 (T2 before T3: closest first), and
  // reaches back to T1 when T2-T6 are empty or spacing-blocked (the close passes below, before T7).
  // The series ladder: plan.slotOrder (series, series, the seed artist, series, family).
  const tier1Slots = new Set();
  for (let k = 0; k < Math.min(TIER1_PER_BATCH, count); k += 1) tier1Slots.add(Math.floor((k * count) / TIER1_PER_BATCH));
  for (let slot = 0; slot < count; slot += 1) {
    const order = plan ? plan.slotOrder(slot, count) : (tier1Slots.has(slot) ? [1, 2, 3, 4, 5, 6, 7] : [2, 3, 4, 5, 6, 7, 1]);
    // T7 (the rest: an unrelated genre) is drawn only when every closer tier is empty: artist spacing
    // may widen a pick to a farther CLOSE tier, never to an unrelated genre (R4 beats R12 there). A
    // station with nothing to stay close to (no genre, no category, not game music) may reach T7 by
    // spacing rather than replay one artist (the selftest's untagged seeds ran one artist 15 in a row).
    const farOk = !profile.genre && !profile.category && !(plan && plan.game);
    let allowed = order.filter((tier) => (tier !== 7 || farOk) && tiers[tier].length);
    if ((c.widen || !allowed.length) && tiers[7].length) allowed = [7].concat(c.widen ? allowed : []);
    let got = null;
    // spacing could not be honoured in any allowed tier (few artists left close by): relax the hourly
    // window first, then the run rule, in the closest tier, rather than jump genre or go silent. A
    // station with nothing to stay close to (farOk) still relaxes the hourly window inside the close
    // tiers BEFORE it reaches T7: an untagged DJ channel keeps to its channel, mixing its sets (the run
    // rule still holds), and an untagged artist alternates with T7 instead of repeating.
    // (widen: T7 is the preferred list - the close tiers hold old plays the server no longer knows of)
    const close = c.widen ? allowed.filter((tier) => tier === 7) : allowed.filter((tier) => tier !== 7);
    const passes = [[close, 'full'], [close, 'runOnly'], [allowed, 'full'], [allowed, 'runOnly'], [allowed, 'none']];
    for (const [tierList, pass] of passes) {
      for (const tier of tierList) {
        const idx = drawFrom(tiers[tier], pass === 'none' ? null : seq, rng, pass === 'runOnly');
        if (idx < 0) continue; // every candidate here breaks the spacing: try the next tier
        got = tiers[tier].splice(idx, 1)[0];
        break;
      }
      if (got) break;
    }
    if (!got) break;
    picks.push(got.t);
    if (Array.isArray(c.trace)) c.trace.push({ id: got.t.id, tier: got.tier }); // the simulator's tier attribution
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
      if (Array.isArray(c.trace)) c.trace.push({ id, tier: 0 }); // 0 = recycled (R11)
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
  stationPlan,
  tierOf,
  STATION_ORDERS,
  TIER_GAME,
  TIER_NEAR,
  TIER_SERIES,
};
