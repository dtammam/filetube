'use strict';

// [UNIT] v1.386.0 speed pass (W3): lib/music/query.js compares with ONE cached Intl.Collator per option set instead
// of a per-compare `localeCompare(..., options)` (which builds a collator each call: a 23,000-track title sort took
// ~3 s). ECMA-402 defines localeCompare through Intl.Collator, so every sort must come out in EXACTLY the order the
// old comparator gave. This drives sortTracks / groupAlbums / groupArtists over strings where collation rules bite
// (case, accents, punctuation, digits, whitespace, empties, mixed scripts, ISO dates) against an ORACLE that is the
// old comparator verbatim.

const { test } = require('node:test');
const assert = require('node:assert');
const query = require('../../lib/music/query');

const WORDS = ['apple', 'Apple', 'APPLE', 'Äpple', 'apple ', ' apple', 'äpfel', 'Zebra', 'zebra', 'zébra', 'éclair', 'Eclair',
  'a-b', 'a_b', 'a b', 'ab', 'a.b', '10 Songs', '2 Songs', '#1', '(Intro)', '!Bang', 'Ölberg', 'Oz', 'naïve', 'naive',
  'Straße', 'Strasse', 'ﬁne', 'fine', 'Ω', 'Ω', 'Ωmega', 'ж', 'Ж', '日本', 'にほん', '', '   ', 'résumé', 'Resume', 'co-op', 'coop'];
const DATES = ['2026-01-02T03:04:05.000Z', '2026-01-02T03:04:05.001Z', '2025-12-31T23:59:59.999Z', '2026-01-02', '', 'not a date', '2026-1-2'];

// the comparators exactly as they were before v1.386.0
function oldCmpStr(a, b) {
  const x = typeof a === 'string' ? a.trim() : '';
  const y = typeof b === 'string' ? b.trim() : '';
  if (x === '' && y === '') return 0;
  if (x === '') return 1;
  if (y === '') return -1;
  return x.localeCompare(y, undefined, { sensitivity: 'base' });
}
const oldDate = (a, b) => String(a).localeCompare(String(b));

function tracks() {
  const out = [];
  let i = 0;
  for (const w of WORDS) {
    for (const d of DATES) {
      out.push({ id: 'id' + String(i).padStart(4, '0'), title: w, artist: WORDS[(i * 7) % WORDS.length], albumArtist: i % 3 ? undefined : WORDS[(i * 5) % WORDS.length],
        album: WORDS[(i * 11) % WORDS.length], addedAt: d, trackNo: i % 9, discNo: 1 + (i % 2), albumArtKey: 'k' + (i % 13) });
      i++;
    }
  }
  return out;
}
const ids = (xs) => xs.map((t) => t.id);

test('cmpStr orders every pair exactly as the old localeCompare comparator', () => {
  for (const a of WORDS) for (const b of WORDS) assert.strictEqual(Math.sign(query.cmpStr(a, b)), Math.sign(oldCmpStr(a, b)), JSON.stringify([a, b]));
});

test('sortTracks gives the old order for every sort key that compares strings', () => {
  const list = tracks();
  const albumSortValue = query.albumSortValue;
  const oracle = {
    'title-asc': (a, b) => oldCmpStr(a.title, b.title),
    'title-desc': (a, b) => oldCmpStr(b.title, a.title),
    'artist-asc': (a, b) => oldCmpStr(a.albumArtist || a.artist, b.albumArtist || b.artist) || oldCmpStr(a.album, b.album) || (albumSortValue(a) - albumSortValue(b)),
    'album-asc': (a, b) => oldCmpStr(a.album, b.album) || (albumSortValue(a) - albumSortValue(b)),
    'album-order': (a, b) => oldCmpStr(a.albumArtist || a.artist, b.albumArtist || b.artist) || oldCmpStr(a.album, b.album) || (albumSortValue(a) - albumSortValue(b)),
    newest: (a, b) => oldDate(b.addedAt, a.addedAt),
    oldest: (a, b) => oldDate(a.addedAt, b.addedAt),
    'release-newest': (a, b) => ((Number(b.releaseDate) || 0) - (Number(a.releaseDate) || 0)) || oldDate(b.addedAt, a.addedAt),
    'release-oldest': (a, b) => ((Number(a.releaseDate) || 0) - (Number(b.releaseDate) || 0)) || oldDate(a.addedAt, b.addedAt),
  };
  for (const [key, cmp] of Object.entries(oracle)) {
    assert.deepStrictEqual(ids(query.sortTracks(list, key)), ids(list.slice().sort(cmp)), key);
  }
});

// The module ITSELF with its two collators swapped back for per-call localeCompare (the pre-v1.386.0 comparator):
// compiled from the current source, so every function that compares through them is checked, now and later.
function oracleModule() {
  const Module = require('node:module');
  const path = require('node:path');
  const fs = require('node:fs');
  const file = path.join(__dirname, '..', '..', 'lib', 'music', 'query.js');
  let src = fs.readFileSync(file, 'utf8');
  const a = 'const COLLATE = new Intl.Collator(undefined).compare;';
  const b = "const COLLATE_BASE = new Intl.Collator(undefined, { sensitivity: 'base' }).compare;";
  assert.ok(src.includes(a) && src.includes(b), 'the collators are where this oracle expects them');
  src = src.replace(a, () => 'const COLLATE = (x, y) => x.localeCompare(y);')
    .replace(b, () => "const COLLATE_BASE = (x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' });");
  const m = new Module(file + '.oracle', module);
  m.filename = file; // relative requires resolve from lib/music
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(src, file);
  return m.exports;
}

test('sortTracks, groupAlbums and groupArtists match the localeCompare build of the same module for every sort', () => {
  const old = oracleModule();
  assert.notStrictEqual(old.sortTracks, query.sortTracks);
  const list = tracks();
  const reps = query.artRepresentatives(list);
  for (const key of ['', 'newest', 'oldest', 'title-asc', 'title-desc', 'artist-asc', 'album-asc', 'album-order', 'release-newest', 'release-oldest', 'duration-asc', 'duration-desc', 'tracks-desc', 'year-desc']) {
    assert.deepStrictEqual(ids(query.sortTracks(list, key)), ids(old.sortTracks(list, key)), 'sortTracks ' + key);
    assert.deepStrictEqual(query.groupAlbums(list, key, reps), old.groupAlbums(list, key, reps), 'groupAlbums ' + key);
    assert.deepStrictEqual(query.groupArtists(list, key, reps), old.groupArtists(list, key, reps), 'groupArtists ' + key);
  }
});

test('lib/music/stations.js: buildStations matches its localeCompare build (recent, generated and art order)', () => {
  const Module = require('node:module');
  const path = require('node:path');
  const fs = require('node:fs');
  const file = path.join(__dirname, '..', '..', 'lib', 'music', 'stations.js');
  const a = 'const COLLATE = new Intl.Collator(undefined).compare;';
  let src = fs.readFileSync(file, 'utf8');
  assert.ok(src.includes(a));
  src = src.replace(a, () => 'const COLLATE = (x, y) => x.localeCompare(y);');
  const m = new Module(file + '.oracle', module);
  m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(src, file);
  const stations = require('../../lib/music/stations');
  const list = tracks().map((t, i) => Object.assign({}, t, { genre: ['Rock', 'Jazz', 'Pop', 'Folk'][i % 4], year: 1960 + (i % 60) }));
  const progress = {};
  list.slice(0, 40).forEach((t, i) => { progress[t.id] = { position: 10, updatedAt: DATES[i % DATES.length] }; });
  const user = { liked: new Set(list.slice(0, 30).map((t) => t.id)), progress, plays: null, custom: [], hidden: new Set() };
  const strip = (xs) => xs.map((x) => ({ key: x.key, name: x.name, members: x.members.map((t) => t.id) }));
  assert.deepStrictEqual(strip(stations.buildStations(list, user)), strip(m.exports.buildStations(list, user)));
  assert.ok(stations.buildStations(list, user).length > 3, 'stations were built (not a vacuous empty compare)');
});
