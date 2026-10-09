'use strict';

// lib/music/stations.js - v1.378.0 music radio STATIONS (plan docs/exec-plans/completed/2026-10-09-music-stations.md,
// rulings R1-R4, defaults D5-D9). PURE: no I/O, no clock reads, no Math.random. The caller hands in the
// viewer's VISIBLE library (the list GET /api/music builds - D9: every station, its count and its art
// come from what THIS viewer can see, so a restricted account never learns a hidden song exists) and
// the viewer's OWN signals (likes, resume rows, play counts, their custom station definitions, the keys
// they hid). The route (lib/music/routes.js), the picker (lib/music/radio.js, a `station:<key>` seed) and
// tools/radio-sim/simulate.js (--stations, the T0 census) all run this one code.
//
// The stations (each a KEY, a NAME and its MEMBERS; a song may sit in several):
//   favorites        (D6) liked songs plus songs with 3+ plays and a finish. Until that holds ANY song
//                    (D2: counts start at zero on this release, and the first plays are not yet 3 with a
//                    finish - gate r1 adversary W2: a literal "until counts exist" made Favorites vanish on
//                    the viewer's first play) it falls back to the likes, then the most RECENTLY resumed
//                    songs (progress rows carry no resume count), and its subtitle says "Builds as you listen".
//   deepcuts         (D6) songs by the artists the viewer plays (any plays) that they played 0-1 times;
//                    absent until counts exist.
//   decade:<1980>    (D6) Throwback: one per decade with MIN_SONGS songs, from RELEASE years only - a
//                    native file's tag. A yt-dlp download's year is its UPLOAD year and never counts.
//                    (The plan's D6 also names "a saved album's own year if present": a saved album
//                    (lib/ytdlp/album.js) stores no year, so that clause has nothing to read - stated
//                    in the ledger as built.)
//   recent           (D6) the newest RECENT_N songs by addedAt, weighed newest first.
//   c:<id>           (D7) the viewer's own: name + any of genres / artists / words / a year range /
//                    exclude words, and "stay strict" (the picker never widens it).
//   s:<style>        (D5b) a CURATED style, matched as whole words on the genre tag, the album, the title
//                    and the channel / folder name (STYLES below; no learned words - v1.375.0's leak);
//                    game music is v1.375.0's game family (radio.js), not words.
//   g:<genre>        (D5a) a real genre tag (native, or a non-category tag on yt-dlp audio; keys folded,
//                    `hip-hop` = `hip hop`) that no style already names.
// A generated station needs MIN_SONGS songs from MIN_ARTISTS artists (D5). At most SHOWN_MAX generated
// stations are shown, biggest first; the rest and the hidden ones sit under "More stations" (D5c, D8).

const radio = require('./radio');
const tags = require('./tags');

const MIN_SONGS = 40;
const MIN_ARTISTS = 3;
const SHOWN_MAX = 12;
const RECENT_N = 200;
const FAVORITES_PLAYS = 3; // 3+ plays and a finish
const DEEPCUTS_MAX_PLAYS = 1; // played 0-1 times
const RESUMED_MAX = 100; // the Favorites fallback: the most recently resumed songs
const CUSTOM_MAX = 50; // stations one user may keep
const NAME_MAX = 40;
const LIST_MAX = 20; // genres / artists / words / exclude entries per custom station
const ENTRY_MAX = 60; // characters per entry

// D5b: the style dictionary. Phrases are matched as WHOLE WORDS (after folding: lowercase, accents off,
// every run of non-letters one space - so `lo-fi` and `lofi` are two spellings and both are listed).
// `game` has no words: its members are radio.js's game-music family (the v1.375.0 rules).
const STYLES = [
  { key: 'lofi', name: 'Lofi', words: ['lofi', 'lo fi', 'lofi hip hop', 'chillhop'] },
  { key: 'synthwave', name: 'Synthwave', words: ['synthwave', 'retrowave', 'outrun', 'darksynth'] },
  { key: 'chill', name: 'Chill', words: ['chillout', 'chill', 'ambient', 'downtempo'] },
  { key: 'reggae', name: 'Reggae', words: ['reggae', 'dub', 'dancehall', 'ska'] },
  { key: 'vaporwave', name: 'Vaporwave', words: ['vaporwave'] },
  { key: 'jazz', name: 'Jazz', words: ['jazz'] },
  { key: 'game', name: 'Game music', words: [], family: true },
];

function norm(s) { return typeof s === 'string' ? s.trim().toLowerCase() : ''; }
function isLib(t) { return !!t && (t.source === 'library' || t.source === 'library-chapter'); }
function artistOf(t) { return norm(t && t.artist) || norm(t && t.albumArtist); }

// A whole-word matcher for a list of phrases over folded text (radio.js foldedWords: the same fold the
// series words use). One-word phrases are a Set lookup; longer ones a padded substring search.
function wordMatcher(phrases) {
  const single = new Set();
  const multi = [];
  for (const p of phrases || []) {
    const w = radio.foldedWords(String(p));
    if (!w.length) continue;
    if (w.length === 1) single.add(w[0]); else multi.push(' ' + w.join(' ') + ' ');
  }
  if (!single.size && !multi.length) return null;
  return function matches(raw) {
    const words = radio.foldedWords(typeof raw === 'string' ? raw : '');
    if (!words.length) return false;
    for (let i = 0; i < words.length; i += 1) if (single.has(words[i])) return true;
    if (multi.length) {
      const padded = ' ' + words.join(' ') + ' ';
      for (let k = 0; k < multi.length; k += 1) if (padded.indexOf(multi[k]) !== -1) return true;
    }
    return false;
  };
}

// The four text fields a style or a custom word is matched on, in the order the census reports them.
const TEXT_FIELDS = ['genre', 'album', 'title', 'channel'];
function fieldText(t, field) {
  if (field === 'genre') return typeof t.genre === 'string' ? t.genre : '';
  if (field === 'album') return typeof t.album === 'string' ? t.album : '';
  if (field === 'title') return typeof t.title === 'string' ? t.title : '';
  return typeof t.folderName === 'string' ? t.folderName : '';
}
function anyFieldMatches(t, matcher) {
  if (!matcher) return false;
  for (let i = 0; i < TEXT_FIELDS.length; i += 1) if (matcher(fieldText(t, TEXT_FIELDS[i]))) return true;
  return false;
}

function releaseYear(t) {
  return isLib(t) ? null : tags.parseYear(t.year); // D6: a yt-dlp upload's date is never a release year
}
function anyYear(t) { return tags.parseYear(t && t.year); }

function enough(members) {
  if (members.length < MIN_SONGS) return false;
  const artists = new Set();
  for (const t of members) { const a = artistOf(t); if (a) artists.add(a); if (artists.size >= MIN_ARTISTS) return true; }
  return false;
}

// ---- the viewer's own stations (D7) ----------------------------------------------------------------
// A definition: { name, genres: [], artists: [], words: [], yearFrom, yearTo, exclude: [], strict }.
// Validate a request body into one (bounded, trimmed, every list deduplicated) or name the fault.
function cleanList(v, label) {
  if (v === undefined || v === null) return { ok: true, list: [] };
  if (!Array.isArray(v)) return { ok: false, error: label + ' must be a list' };
  if (v.length > LIST_MAX) return { ok: false, error: label + ` holds at most ${LIST_MAX} entries` };
  const out = [];
  const seen = new Set();
  for (const x of v) {
    if (typeof x !== 'string') return { ok: false, error: label + ' entries must be text' };
    const s = x.trim();
    if (!s) continue;
    if (s.length > ENTRY_MAX) return { ok: false, error: label + ` entries are at most ${ENTRY_MAX} characters` };
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return { ok: true, list: out };
}
function cleanYear(v, label) {
  if (v === undefined || v === null || v === '') return { ok: true, year: null };
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d{4}$/.test(v.trim()) ? Number(v.trim()) : NaN);
  if (!Number.isInteger(n) || n < 1000 || n > 9999) return { ok: false, error: label + ' must be a four-digit year' };
  return { ok: true, year: n };
}
function validateCustomDef(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > NAME_MAX) return { ok: false, error: `name must be 1-${NAME_MAX} characters` };
  const lists = {};
  for (const [field, label] of [['genres', 'genres'], ['artists', 'artists'], ['words', 'words'], ['exclude', 'exclude']]) {
    const r = cleanList(b[field], label);
    if (!r.ok) return r;
    lists[field] = r.list;
  }
  const from = cleanYear(b.yearFrom, 'yearFrom');
  if (!from.ok) return from;
  const to = cleanYear(b.yearTo, 'yearTo');
  if (!to.ok) return to;
  if (from.year !== null && to.year !== null && from.year > to.year) return { ok: false, error: 'yearFrom must not be after yearTo' };
  if (!lists.genres.length && !lists.artists.length && !lists.words.length && from.year === null && to.year === null) {
    return { ok: false, error: 'a station needs at least one of genres, artists, words or a year range' };
  }
  return { ok: true, def: { name, genres: lists.genres, artists: lists.artists, words: lists.words, yearFrom: from.year, yearTo: to.year, exclude: lists.exclude, strict: b.strict === true } };
}

// The songs a definition names: every given axis must agree (genres AND artists AND words AND years),
// any entry within an axis will do; an exclude word anywhere drops the song. No axis = no song.
function matchCustom(def, library) {
  if (!def || !Array.isArray(library)) return [];
  // a definition from storage is read defensively (gate r1 adversary W1: a bundle once restored `genres: 'rock'`)
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const genres = new Set(arr(def.genres).map((g) => radio.genreKey({ genre: g, source: 'native' })).filter(Boolean));
  const artists = new Set(arr(def.artists).map(norm).filter(Boolean));
  const words = wordMatcher(arr(def.words));
  const exclude = wordMatcher(arr(def.exclude));
  const from = Number.isInteger(def.yearFrom) ? def.yearFrom : null;
  const to = Number.isInteger(def.yearTo) ? def.yearTo : null;
  const hasAxis = genres.size || artists.size || words || from !== null || to !== null;
  if (!hasAxis) return [];
  const out = [];
  for (const t of library) {
    if (!t) continue;
    if (genres.size && !genres.has(radio.genreKey(t, true))) continue;
    if (artists.size && !(artists.has(norm(t.artist)) || artists.has(norm(t.albumArtist)))) continue;
    if (words && !anyFieldMatches(t, words)) continue;
    if (from !== null || to !== null) {
      const y = anyYear(t);
      if (y === null || (from !== null && y < from) || (to !== null && y > to)) continue;
    }
    if (exclude && anyFieldMatches(t, exclude)) continue;
    out.push(t);
  }
  return out;
}

// ---- the generated and built-in stations -------------------------------------------------------------
// `user` = { liked: Set<id>, progress: { id: { position, updatedAt } }, plays: { id: { plays, skips,
// finishes } }, custom: [ { id, ...def } ], hidden: Set<key> }. Returns every station THIS viewer can
// see, in display order, each { key, name, kind, subtitle, members: [track], weights: Map | null,
// strict, def?, group: 'main' | 'more', hidden }. A station with no members is not listed (D9).
function hasAnyCounts(plays) {
  if (!plays) return false;
  for (const id in plays) if (Object.prototype.hasOwnProperty.call(plays, id) && plays[id] && (plays[id].plays > 0 || plays[id].finishes > 0)) return true;
  return false;
}
function playsOf(plays, id) {
  return plays && Object.prototype.hasOwnProperty.call(plays, id) && plays[id] ? plays[id] : null;
}

function buildStations(library, user) {
  const list = Array.isArray(library) ? library.filter(Boolean) : [];
  const u = user || {};
  const liked = u.liked instanceof Set ? u.liked : new Set();
  const plays = u.plays || null;
  const progress = u.progress || null;
  const hidden = u.hidden instanceof Set ? u.hidden : new Set();
  const out = [];
  const push = (key, name, kind, members, extra) => {
    if (!members.length) return;
    out.push(Object.assign({ key, name, kind, subtitle: members.length + (members.length === 1 ? ' song' : ' songs'), members, weights: null, strict: false, group: 'main', hidden: hidden.has(key) }, extra || {}));
  };
  // Favorites: the counted rule the moment a COUNTED song qualifies (3+ plays and a finish); the fallback
  // (likes, then the most recently resumed) until then, however many likes there are
  const counted = hasAnyCounts(plays);
  const isFav = (t) => { const p = playsOf(plays, t.id); return !!(p && p.plays >= FAVORITES_PLAYS && p.finishes >= 1); };
  if (list.some(isFav)) {
    push('favorites', 'Favorites', 'builtin', list.filter((t) => liked.has(t.id) || isFav(t)));
  } else {
    const likedOnes = list.filter((t) => liked.has(t.id));
    const seen = new Set(likedOnes.map((t) => t.id));
    const resumed = list.filter((t) => !seen.has(t.id) && progress && Object.prototype.hasOwnProperty.call(progress, t.id) && progress[t.id] && Number(progress[t.id].position) > 0)
      .sort((a, b) => String(progress[b.id].updatedAt || '').localeCompare(String(progress[a.id].updatedAt || '')) || String(a.id).localeCompare(String(b.id)))
      .slice(0, RESUMED_MAX);
    push('favorites', 'Favorites', 'builtin', likedOnes.concat(resumed), { subtitle: 'Builds as you listen' });
  }
  // Deep cuts
  if (counted) {
    const played = new Set();
    for (const t of list) { const p = playsOf(plays, t.id); if (p && p.plays > 0) { const a = artistOf(t); if (a) played.add(a); } }
    push('deepcuts', 'Deep cuts', 'builtin', list.filter((t) => { const a = artistOf(t); if (!a || !played.has(a)) return false; const p = playsOf(plays, t.id); return !p || p.plays <= DEEPCUTS_MAX_PLAYS; }));
  }
  // Throwback: a station per decade (release years only), newest decade first
  const byDecade = new Map();
  for (const t of list) { const y = releaseYear(t); if (y === null) continue; const d = Math.floor(y / 10) * 10; if (!byDecade.has(d)) byDecade.set(d, []); byDecade.get(d).push(t); }
  for (const d of [...byDecade.keys()].sort((a, b) => b - a)) {
    const members = byDecade.get(d);
    if (!enough(members)) continue;
    push('decade:' + d, d + 's', 'builtin', members);
  }
  // Recently added: the newest RECENT_N by addedAt, weighed newest first (2x down to 1x)
  const dated = list.filter((t) => typeof t.addedAt === 'string' && t.addedAt).sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)) || String(a.id).localeCompare(String(b.id))).slice(0, RECENT_N);
  if (dated.length) {
    const w = new Map();
    dated.forEach((t, i) => { w.set(t.id, 1 + (dated.length - i) / dated.length); });
    push('recent', 'Recently added', 'builtin', dated, { weights: w });
  }
  // The viewer's own (D7), in creation order; an own station that matches nothing stays listed (the
  // editor shows it empty) - it is the one kind the viewer made, so it is never silently dropped
  for (const c of Array.isArray(u.custom) ? u.custom : []) {
    if (!c || typeof c.id !== 'string' || !c.id) continue;
    const members = matchCustom(c, list);
    const name = typeof c.name === 'string' ? c.name : 'Station';
    out.push({ key: 'c:' + c.id, name, kind: 'custom', subtitle: members.length + (members.length === 1 ? ' song' : ' songs'), members, weights: null, strict: c.strict === true, def: c, group: 'main', hidden: false });
  }
  // Generated: styles (D5b) and real genres (D5a), biggest first; SHOWN_MAX on the shelf
  const generated = [];
  const styleGenreKeys = new Set(); // a genre a style already names is not a second station
  const isGame = radio.gameMusicPredicate(list);
  for (const st of STYLES) {
    let members;
    if (st.family) members = list.filter(isGame);
    else {
      const m = wordMatcher(st.words);
      members = list.filter((t) => anyFieldMatches(t, m));
      for (const w of st.words) styleGenreKeys.add(radio.genreKey({ genre: w, source: 'native' }));
    }
    if (enough(members)) generated.push({ key: 's:' + st.key, name: st.name, kind: 'style', members });
  }
  const byGenre = new Map();
  for (const t of list) { const g = radio.genreKey(t); if (!g || styleGenreKeys.has(g)) continue; if (!byGenre.has(g)) byGenre.set(g, []); byGenre.get(g).push(t); }
  for (const [g, members] of byGenre) if (enough(members)) generated.push({ key: 'g:' + g, name: genreName(members, g), kind: 'genre', members });
  generated.sort((a, b) => (b.members.length - a.members.length) || String(a.key).localeCompare(String(b.key)));
  // SHOWN_MAX of the generated stations the viewer has NOT hidden take the shelf; a hidden one never
  // holds a slot (gate r1 qa S1), the rest sit under More
  let slots = SHOWN_MAX;
  for (const s of generated) {
    const hid = hidden.has(s.key);
    const main = !hid && slots > 0;
    if (main) slots -= 1;
    push(s.key, s.name, s.kind, s.members, { group: main ? 'main' : 'more' });
  }
  return out;
}

// A genre station's display name: the most common raw spelling of the folded key among its members
// ("Hip-Hop" for `hip hop`), title-cased when the tag is all lower case.
function genreName(members, key) {
  const counts = new Map();
  for (const t of members) {
    const raw = radio.primaryGenre(t);
    if (!raw) continue;
    const orig = String(t.genre).split(/[;/,|]/)[0].trim();
    counts.set(orig, (counts.get(orig) || 0) + 1);
  }
  let best = key; let n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best === best.toLowerCase() ? best.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : best;
}

// The station a `station:<key>` seed plays: its members as the picker's close pool, its weights, and
// whether it stays strict. null when the key names nothing this viewer can see.
function stationProfile(key, library, user) {
  const all = buildStations(library, user);
  const s = all.find((x) => x.key === key);
  if (!s) return null;
  return {
    kind: 'station', seedId: null, key: s.key, name: s.name, artists: [], genre: null, category: null, year: null, folder: null,
    memberIds: new Set(s.members.map((t) => t.id)), weights: s.weights, strict: s.strict,
  };
}

// Up to `max` member tracks with DISTINCT art (the card's 2x2 mosaic): art-carrying albums first, then
// the lexicographically-lowest id per art id - order-invariant, so a rescan never flips the tiles.
function artTracksFor(members, artIdOf, max) {
  const byArt = new Map();
  for (const t of members) {
    const id = artIdOf(t);
    if (!id) continue;
    const cur = byArt.get(id);
    const hasArt = !!(t.hasEmbeddedArt || t.hasArt || t.hasThumbnail);
    if (!cur || (hasArt && !cur.hasArt) || (hasArt === cur.hasArt && String(t.id) < String(cur.t.id))) byArt.set(id, { t, hasArt });
  }
  return [...byArt.entries()].sort((a, b) => (Number(b[1].hasArt) - Number(a[1].hasArt)) || String(a[0]).localeCompare(String(b[0]))).slice(0, max || 4).map(([, x]) => x.t);
}

// ---- the T0 census (tools/radio-sim --stations): aggregate counts only, no titles or paths ---------
// For every style phrase: how many songs each FIELD matches (a word that matches mostly unrelated songs
// shows up as a title / channel count out of proportion to its genre count - the v1.375.0 class).
function styleWordCensus(library) {
  const list = Array.isArray(library) ? library.filter(Boolean) : [];
  const out = [];
  for (const st of STYLES) {
    if (st.family) continue;
    for (const p of st.words) {
      const m = wordMatcher([p]);
      const row = { style: st.key, phrase: p, any: 0 };
      for (const f of TEXT_FIELDS) row[f] = 0;
      for (const t of list) {
        let hit = false;
        for (const f of TEXT_FIELDS) if (m(fieldText(t, f))) { row[f] += 1; hit = true; }
        if (hit) row.any += 1;
      }
      out.push(row);
    }
  }
  return out;
}

module.exports = {
  CUSTOM_MAX,
  DEEPCUTS_MAX_PLAYS,
  ENTRY_MAX,
  FAVORITES_PLAYS,
  LIST_MAX,
  MIN_ARTISTS,
  MIN_SONGS,
  NAME_MAX,
  RECENT_N,
  SHOWN_MAX,
  STYLES,
  TEXT_FIELDS,
  artTracksFor,
  buildStations,
  matchCustom,
  releaseYear,
  stationProfile,
  styleWordCensus,
  validateCustomDef,
  wordMatcher,
};
