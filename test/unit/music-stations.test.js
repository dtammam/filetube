'use strict';

// [UNIT] v1.378.0 music stations W2 (plan docs/exec-plans/active/2026-10-09-music-stations.md, D4-D8): the
// pure station builder (lib/music/stations.js) and the picker's station ladder (lib/music/radio.js
// stationLadder) on fixtures where each rule and its absence DIVERGE (LESSONS 2): the thresholds, the
// whole-word style matcher (a word inside another word is no match), the release-year rule (a yt-dlp
// upload year never places a song in a decade), Favorites before and after counts exist, Deep cuts, the
// custom definition's axes and bounds, strict vs widening, and the Kirby fixture's game station.

const { test } = require('node:test');
const assert = require('node:assert');
const stations = require('../../lib/music/stations');
const radio = require('../../lib/music/radio');
const { createSeededRng } = require('../../lib/videoQuery');
const kirby = require('../helpers/radio-kirby-library');

let seq = 0;
const nat = (artist, genre, extra) => Object.assign({ id: 'n' + (++seq), title: 'Song ' + seq, artist, albumArtist: artist, album: 'Album of ' + artist, genre: genre || '', year: '1990', folderName: 'f-' + artist, addedAt: '2026-01-01T00:00:00.000Z', hasEmbeddedArt: true, albumArtKey: 'k-' + artist }, extra || {});
const lib = (id, folder, artist, genre, extra) => Object.assign({ id: 'l' + (++seq), title: 'Upload ' + seq, artist, albumArtist: artist, album: '', genre: genre || '', year: '2021', folderName: folder, source: 'library', addedAt: '2026-01-01T00:00:00.000Z' }, extra || {});
function many(n, make) { const out = []; for (let i = 0; i < n; i += 1) out.push(make(i)); return out; }
const NO_USER = { liked: new Set(), progress: {}, plays: {}, custom: [], hidden: new Set() };
const keys = (list, user) => stations.buildStations(list, user || NO_USER).map((s) => s.key);
const byKey = (list, user, key) => stations.buildStations(list, user || NO_USER).find((s) => s.key === key);

test('D5a: a real genre station needs 40 songs from 3 artists; a YouTube category on yt-dlp audio is not a genre; keys fold (Hip-Hop = hip hop); the name is the tag\'s own spelling', () => {
  const list = [];
  list.push(...many(40, (i) => nat('Rocker ' + (i % 3), 'Rock'))); // 40 songs, 3 artists: a station
  list.push(...many(45, (i) => nat('Lone Popper', 'Pop'))); // 45 songs, ONE artist: no station
  list.push(...many(39, (i) => nat('Jazzer ' + (i % 5), 'Jazz'))); // 39 songs: no station (one short) - also a style word
  list.push(...many(22, (i) => nat('Hop ' + (i % 3), 'Hip-Hop')));
  list.push(...many(20, (i) => nat('Hop B ' + (i % 3), 'hip hop'))); // folded together: 42
  list.push(...many(60, (i) => lib(null, 'tube' + (i % 4), 'Tube ' + (i % 4), 'Music'))); // a YouTube category: never a genre station
  const k = keys(list);
  assert.ok(k.includes('g:rock'), k.join(' '));
  assert.ok(!k.includes('g:pop'), 'one artist is no station');
  assert.ok(!k.includes('g:jazz') && !k.includes('s:jazz'), '39 songs is under the threshold (the style too)');
  assert.ok(k.includes('g:hip hop'), 'folded: ' + k.join(' '));
  assert.strictEqual(byKey(list, null, 'g:hip hop').members.length, 42);
  assert.strictEqual(byKey(list, null, 'g:hip hop').name, 'Hip-Hop', 'the most common raw spelling');
  assert.ok(!k.includes('g:music'), 'a category is not a genre: ' + k.join(' '));
});

test('D5b: a style matches WHOLE words on genre, album, title and channel; a word inside another word is no match; the style absorbs its same-named genre', () => {
  const list = [];
  list.push(...many(15, (i) => nat('Dub Master ' + (i % 3), 'Reggae')));            // genre
  list.push(...many(15, (i) => nat('Islander ' + (i % 3), '', { album: 'Roots Dub Sessions' }))); // album
  list.push(...many(12, (i) => lib(null, 'skaband', 'Ska Band', 'Music', { title: 'Ska Party ' + i })));     // title + channel name
  list.push(...many(10, (i) => nat('Dancehall Kings ' + (i % 2), '', { title: 'Dancehall Night ' + i })));   // title
  list.push(...many(30, (i) => nat('Dubstep DJ ' + (i % 3), 'Dubstep', { title: 'Dubstep Drop ' + i, album: 'Skating Dubs' }))); // NOT reggae: dubstep / skating / dubs are other words
  list.push(...many(50, (i) => nat('Rocker ' + (i % 3), 'Rock')));
  const s = byKey(list, null, 's:reggae');
  assert.ok(s, 'the Reggae station exists: ' + keys(list).join(' '));
  assert.strictEqual(s.members.length, 52, 'genre + album + title + channel matches, none from Dubstep');
  assert.ok(!s.members.some((t) => t.genre === 'Dubstep'), 'dubstep / dubs / skating never match reggae words');
  assert.ok(!keys(list).includes('g:reggae'), 'the style names the genre: no second station');
  assert.strictEqual(s.name, 'Reggae');
  // the matcher itself, incl. multi-word phrases and accents
  const m = stations.wordMatcher(['lofi', 'lo fi', 'lofi hip hop', 'chillhop']);
  assert.ok(m('Lo-Fi Beats to Relax To'), 'lo-fi folds to lo fi');
  assert.ok(m('LOFI hip hop radio'));
  assert.ok(m('Chillhop Essentials'));
  assert.ok(!m('Lofiction'), 'a longer word is not the word');
  assert.ok(!m('Chill hop'), '"chill hop" is not "chillhop"');
  assert.ok(!m(''));
  assert.strictEqual(stations.wordMatcher([]), null);
});

test('D6 Throwback: a decade station needs 40 songs from RELEASE years; a yt-dlp upload year never counts; newest decade first', () => {
  const list = [];
  list.push(...many(45, (i) => nat('Eighties ' + (i % 4), 'Pop', { year: String(1980 + (i % 10)) })));
  list.push(...many(45, (i) => nat('Nineties ' + (i % 4), 'Pop', { year: '1995' })));
  list.push(...many(30, (i) => nat('Noughties ' + (i % 4), 'Pop', { year: '2004' }))); // under 40
  list.push(...many(60, (i) => lib(null, 'oldies', 'Oldies Channel', 'Music', { year: '1987' }))); // uploads: never a release year
  list.push(...many(60, (i) => lib(null, 'seventies', 'Seventies Channel', 'Music', { year: '1975' })));
  const k = keys(list);
  assert.deepStrictEqual(k.filter((x) => x.startsWith('decade:')), ['decade:1990', 'decade:1980'], k.join(' '));
  assert.strictEqual(byKey(list, null, 'decade:1980').members.length, 45, 'the 60 uploads tagged 1987 are not in it');
  assert.strictEqual(byKey(list, null, 'decade:1980').name, '1980s');
  assert.strictEqual(stations.releaseYear(lib(null, 'x', 'X', '', { year: '1987' })), null);
  assert.strictEqual(stations.releaseYear(nat('A', '', { year: '1987' })), 1987);
});

test('D6 Recently added: the newest 200 by addedAt, weighed newest first (2x down to 1x)', () => {
  const list = many(250, (i) => nat('Adder ' + (i % 9), 'Rock', { addedAt: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString() }));
  const s = byKey(list, null, 'recent');
  assert.strictEqual(s.members.length, 200);
  assert.strictEqual(s.members[0].addedAt, list[249].addedAt, 'newest first');
  assert.ok(!s.members.some((t) => t === list[0]), 'the 50 oldest are out');
  assert.ok(Math.abs(s.weights.get(list[249].id) - 2) < 1e-9, 'the newest weighs 2x');
  assert.ok(Math.abs(s.weights.get(list[50].id) - 1.005) < 1e-9, 'the oldest kept weighs ~1x');
});

test('D6 / D2 Favorites: without counts it is the likes then the most recently resumed and says "Builds as you listen"; with counts it is likes plus 3+ plays and a finish; Deep cuts appears only with counts', () => {
  const list = many(30, (i) => nat('Fav ' + (i % 3), 'Rock'));
  const liked = new Set([list[0].id, list[1].id]);
  const progress = {}; progress[list[5].id] = { position: 40, updatedAt: '2026-01-02T00:00:00.000Z' }; progress[list[6].id] = { position: 10, updatedAt: '2026-01-03T00:00:00.000Z' }; progress[list[7].id] = { position: 0, updatedAt: '2026-01-04T00:00:00.000Z' };
  const noCounts = { liked, progress, plays: {}, custom: [], hidden: new Set() };
  const f0 = byKey(list, noCounts, 'favorites');
  assert.deepStrictEqual(f0.members.map((t) => t.id), [list[0].id, list[1].id, list[6].id, list[5].id], 'likes, then resumed newest first (position 0 is not a resume)');
  assert.strictEqual(f0.subtitle, 'Builds as you listen');
  assert.ok(!keys(list, noCounts).includes('deepcuts'), 'no counts: no Deep cuts');
  const plays = {};
  plays[list[10].id] = { plays: 3, skips: 0, finishes: 1 }; // in
  plays[list[11].id] = { plays: 5, skips: 0, finishes: 0 }; // never finished: out
  plays[list[12].id] = { plays: 2, skips: 0, finishes: 2 }; // 2 plays: out
  plays[list[13].id] = { plays: 1, skips: 0, finishes: 0 }; // Fav 1's artist is played
  const counted = { liked, progress, plays, custom: [], hidden: new Set() };
  const f1 = byKey(list, counted, 'favorites');
  assert.deepStrictEqual(f1.members.map((t) => t.id), [list[0].id, list[1].id, list[10].id], 'likes plus 3+ plays with a finish; resumes no longer count');
  assert.strictEqual(f1.subtitle, '3 songs');
  const d = byKey(list, counted, 'deepcuts');
  assert.ok(d, 'with counts Deep cuts exists');
  const playedArtists = new Set([list[10], list[11], list[12], list[13]].map((t) => t.artist));
  assert.ok(d.members.every((t) => playedArtists.has(t.artist)), 'only artists the viewer plays');
  assert.ok(!d.members.some((t) => [list[10].id, list[11].id, list[12].id].includes(t.id)), 'songs played 2+ times are out');
  assert.ok(d.members.some((t) => t.id === list[13].id), 'a song played once is in');
  assert.ok(d.members.some((t) => !plays[t.id]), 'unplayed songs of those artists are in');
});

test('D5c / D8 / D9: order and groups - built-ins, your own, then generated biggest first (12 shown, the rest under More); a hidden key is flagged; an empty station is not listed', () => {
  const list = [];
  for (let g = 0; g < 15; g += 1) list.push(...many(40 + g, (i) => nat('G' + g + ' Artist ' + (i % 3), 'Genre ' + g)));
  const user = Object.assign({}, NO_USER, { custom: [{ id: 'abc', name: 'Mine', genres: ['Genre 3'] }, { id: 'none', name: 'Empty', words: ['zzzz'] }], hidden: new Set(['g:genre 14']) });
  const all = stations.buildStations(list, user);
  const k = all.map((s) => s.key);
  assert.deepStrictEqual(k.slice(0, 2), ['decade:1990', 'recent'], 'built-ins first (every fixture song is a 1990 release; no likes)');
  assert.deepStrictEqual(k.slice(2, 4), ['c:abc', 'c:none'], 'your own next, in creation order (an empty own station stays listed for its editor)');
  const gen = all.filter((s) => s.kind === 'genre');
  assert.strictEqual(gen[0].key, 'g:genre 14', 'biggest first');
  assert.deepStrictEqual(gen.map((s) => s.group), ['more'].concat(new Array(12).fill('main')).concat(['more', 'more']), 'the hidden biggest one takes no shelf slot (gate r1 qa S1): 12 non-hidden on the shelf');
  assert.strictEqual(gen[0].hidden, true, 'the hidden flag rides the station');
  assert.strictEqual(byKey(list, user, 'c:none').members.length, 0);
  assert.ok(!all.some((s) => s.kind !== 'custom' && !s.members.length), 'no empty generated / built-in station');
});

test('D7: a custom definition - every given axis must agree, any entry within one will do, exclude words drop, years bound; validation bounds; a definition with no axis matches nothing', () => {
  const list = [
    nat('Nas', 'Hip-Hop', { title: 'NY State of Mind', year: '1994' }),
    nat('Nas', 'Hip-Hop', { title: 'Made You Look', year: '2002' }),
    nat('Biggie', 'Hip-Hop', { title: 'Juicy', year: '1994', album: 'Ready to Die' }),
    nat('Queen', 'Rock', { title: 'Radio Ga Ga', year: '1984' }),
    lib(null, 'lofi', 'Lofi Girl', 'Music', { title: 'lofi hip hop radio', year: '2020' }),
  ];
  const ids = (def) => stations.matchCustom(def, list).map((t) => t.title);
  assert.deepStrictEqual(ids({ genres: ['hip hop'] }), ['NY State of Mind', 'Made You Look', 'Juicy'], 'a genre, folded');
  assert.deepStrictEqual(ids({ genres: ['Hip-Hop'], artists: ['nas'] }), ['NY State of Mind', 'Made You Look'], 'genre AND artist');
  assert.deepStrictEqual(ids({ artists: ['Nas', 'Queen'] }), ['NY State of Mind', 'Made You Look', 'Radio Ga Ga'], 'any artist');
  assert.deepStrictEqual(ids({ words: ['radio'] }), ['Radio Ga Ga', 'lofi hip hop radio'], 'a word on the title');
  assert.deepStrictEqual(ids({ words: ['hip hop'], exclude: ['lofi'] }), ['NY State of Mind', 'Made You Look', 'Juicy'], 'a word matches the GENRE tag too (Hip-Hop folds to hip hop, the D5b fields); the lofi upload is excluded');
  assert.deepStrictEqual(ids({ words: ['die'] }), ['Juicy'], 'a word on the album');
  assert.deepStrictEqual(ids({ yearFrom: 1990, yearTo: 1999 }), ['NY State of Mind', 'Juicy'], 'a year range (any source: the viewer chose it)');
  assert.deepStrictEqual(ids({ genres: ['Hip-Hop'], yearTo: 1994 }), ['NY State of Mind', 'Juicy']);
  assert.deepStrictEqual(ids({ exclude: ['radio'] }), [], 'exclude alone is no axis');
  assert.deepStrictEqual(ids({}), []);
  // validation
  const ok = stations.validateCustomDef({ name: '  Chill   Vibes ', genres: ['Chill', ' chill ', ''], words: ['lofi'], yearFrom: '1990', strict: true });
  assert.deepStrictEqual(ok, { ok: true, def: { name: 'Chill Vibes', genres: ['Chill'], artists: [], words: ['lofi'], yearFrom: 1990, yearTo: null, exclude: [], strict: true } });
  assert.strictEqual(stations.validateCustomDef({ name: '', genres: ['x'] }).ok, false);
  assert.strictEqual(stations.validateCustomDef({ name: 'x'.repeat(41), genres: ['x'] }).ok, false);
  assert.strictEqual(stations.validateCustomDef({ name: 'A' }).ok, false, 'no axis');
  assert.strictEqual(stations.validateCustomDef({ name: 'A', genres: 'rock' }).ok, false, 'a list is a list');
  assert.strictEqual(stations.validateCustomDef({ name: 'A', genres: new Array(21).fill('g') }).ok, false, '20 entries at most');
  assert.strictEqual(stations.validateCustomDef({ name: 'A', words: ['w'.repeat(61)] }).ok, false, '60 characters at most');
  assert.strictEqual(stations.validateCustomDef({ name: 'A', yearFrom: 2000, yearTo: 1990 }).ok, false);
  assert.strictEqual(stations.validateCustomDef({ name: 'A', yearFrom: '19x0' }).ok, false);
  assert.strictEqual(stations.validateCustomDef({ name: 'A', genres: ['<b>'], strict: 'yes' }).def.strict, false, 'strict is a real boolean only');
  assert.strictEqual(stations.validateCustomDef(null).ok, false);
});

test('D4: a station seed draws its members first (every slot), then the nearest real genres of its members, never the whole library before those; a strict station never leaves its members and repeats when spent', () => {
  const list = [];
  list.push(...many(12, (i) => nat('Member ' + (i % 4), 'Reggae', { title: 'Reggae Tune ' + i })));
  list.push(...many(12, (i) => nat('Dub Crew ' + (i % 4), 'Dub'))); // the nearest genre: shares the artists? no - make a bridge
  list.push(nat('Member 0', 'Dub')); // Member 0 plays Dub too: Reggae ~ Dub neighbours
  list.push(...many(40, (i) => nat('Rocker ' + (i % 5), 'Rock'))); // the rest
  const members = new Set(list.filter((t) => /Reggae Tune/.test(t.title)).map((t) => t.id));
  const profile = { kind: 'station', key: 's:test', name: 'Test', artists: [], genre: null, category: null, year: null, folder: null, memberIds: members, weights: null, strict: false };
  // a full session: members first, then Dub, Rock only last
  const played = [];
  for (let b = 0; b < 30; b += 1) {
    const picks = radio.pickRadioBatch(profile, list, { exclude: played.slice(-200), count: 5 }, createSeededRng(b + 1));
    if (!picks.length) break;
    for (const t of picks) played.push(t.id);
  }
  const byId = new Map(list.map((t) => [t.id, t]));
  const firstNonMember = played.findIndex((id) => !members.has(id));
  assert.strictEqual(firstNonMember, 12, 'all 12 members before anything else (artist spacing never pushes it out of the station): ' + played.slice(0, 14).map((id) => byId.get(id).title).join(', '));
  const firstRock = played.findIndex((id) => byId.get(id).genre === 'Rock');
  const lastDub = Math.max(...played.map((id, i) => (byId.get(id).genre === 'Dub' ? i : -1)));
  assert.ok(firstRock > lastDub, 'the whole library (Rock) only after the members\' nearest genre (Dub) is spent: first Rock ' + firstRock + ', last Dub ' + lastDub);
  // strict: never a non-member; spent -> the recycle brings members back (repeats, never drifts)
  const strict = Object.assign({}, profile, { strict: true });
  const got = [];
  for (let b = 0; b < 6; b += 1) {
    const picks = radio.pickRadioBatch(strict, list, { exclude: got.slice(-200), count: 5 }, createSeededRng(b + 1));
    for (const t of picks) got.push(t.id);
  }
  assert.strictEqual(got.length, 30, 'never silent');
  assert.ok(got.every((id) => members.has(id)), 'strict: members only, repeated once spent');
  assert.ok(new Set(got.slice(0, 12)).size === 12, 'the first 12 are the 12 members');
  // widen=1 on a strict station still never leaves it
  const widened = radio.pickRadioBatch(strict, list, { exclude: [...members], count: 5, widen: true }, createSeededRng(9));
  assert.ok(widened.every((t) => members.has(t.id)), 'widen cannot pull a non-member into a strict station');
  // the station's weights reach the draw (Recently added's newest-first)
  const w = new Map(); for (const id of members) w.set(id, 1); w.set([...members][0], 50);
  let top = 0;
  for (let k = 1; k <= 200; k += 1) if (radio.pickRadioBatch(Object.assign({}, profile, { weights: w }), list, { exclude: [], count: 1 }, createSeededRng(k))[0].id === [...members][0]) top += 1;
  assert.ok(top > 120, 'a 50x member weight draws it most of the time: ' + top + '/200');
});

test('D5b game music: on the Kirby fixture the Game music station is exactly v1.375.0\'s game family, and a Kirby-seeded station seed parses', () => {
  const list = kirby.buildLibrary();
  const s = byKey(list, null, 's:game');
  assert.ok(s, 'the game station exists: ' + keys(list).join(' '));
  const isGame = radio.gameMusicPredicate(list);
  const family = list.filter(isGame);
  assert.strictEqual(s.members.length, family.length, 'the same family (' + family.length + ')');
  assert.ok(s.members.every(isGame));
  // the fixture's own oracle differs from the picker's rule in exactly ONE song: a podcast episode the
  // channel filed under People & Blogs (gate r1 adversary W2: a non-music category upload is never game
  // music) - the station follows the picker, not the oracle
  const oracleOnly = list.filter((t) => kirby.isGameMusic(t) !== isGame(t));
  assert.deepStrictEqual(oracleOnly.map((t) => t.genre), ['People & Blogs']);
  assert.ok(!s.members.includes(oracleOnly[0]), 'the podcast episode is not in the Game music station');
  assert.deepStrictEqual(radio.parseSeed('station:s:game'), { kind: 'station', value: 's:game' });
  assert.strictEqual(radio.buildStationProfile({ kind: 'station', value: 's:game' }, list), null, 'the route builds a station profile from the viewer\'s own signals, never buildStationProfile');
  const prof = stations.stationProfile('s:game', list, NO_USER);
  assert.strictEqual(prof.kind, 'station');
  assert.strictEqual(prof.memberIds.size, family.length);
  assert.strictEqual(stations.stationProfile('s:nope', list, NO_USER), null);
  // the 2x2 art: distinct art ids, art-carrying first, order-invariant
  const art = stations.artTracksFor(s.members, (t) => (t.source === 'library-chapter' ? String(t.id).replace(/::c\d+$/, '') : t.id), 4);
  assert.strictEqual(art.length, 4);
  assert.strictEqual(new Set(art.map((t) => String(t.id).replace(/::c\d+$/, ''))).size, 4, 'four different covers');
  const again = stations.artTracksFor(s.members.slice().reverse(), (t) => (t.source === 'library-chapter' ? String(t.id).replace(/::c\d+$/, '') : t.id), 4);
  assert.deepStrictEqual(again.map((t) => t.id), art.map((t) => t.id), 'the same tiles whatever the list order');
});

test('the T0 census is aggregate only: per style phrase, a count per field and in any field', () => {
  const list = [nat('A', 'Reggae', { title: 'Dub Plate', album: 'Ska Days' }), nat('B', 'Rock', { title: 'Reggae Rock' }), lib(null, 'dub', 'Dub Channel', 'Music')];
  const rows = stations.styleWordCensus(list);
  const row = (phrase) => rows.find((r) => r.phrase === phrase);
  assert.deepStrictEqual(row('reggae'), { style: 'reggae', phrase: 'reggae', any: 2, genre: 1, album: 0, title: 1, channel: 0 });
  assert.deepStrictEqual(row('dub'), { style: 'reggae', phrase: 'dub', any: 2, genre: 0, album: 0, title: 1, channel: 1 });
  assert.deepStrictEqual(row('ska'), { style: 'reggae', phrase: 'ska', any: 1, genre: 0, album: 1, title: 0, channel: 0 });
  assert.ok(!rows.some((r) => r.style === 'game'), 'game music has no words');
  for (const r of rows) for (const k of Object.keys(r)) assert.ok(['style', 'phrase', 'any'].concat(stations.TEXT_FIELDS).includes(k), 'no title or path in a row: ' + k);
});

// ---- gate r1 (qa C2 = adversary C2, adversary W3 M3 / M31 / W2, W1) -------------------------------------
test('gate r1 C2: a strict station never leaves its members on EITHER run-dry path - songs played before the station started are not recycled into it, a skipped-out non-member never enters it', () => {
  const list = [];
  list.push(...many(12, (i) => nat('Member ' + (i % 4), 'Reggae', { title: 'Reggae Tune ' + i })));
  list.push(...many(10, (i) => nat('Rocker ' + (i % 3), 'Rock', { title: 'Rock ' + i })));
  const members = new Set(list.filter((t) => /Reggae Tune/.test(t.title)).map((t) => t.id));
  const rock = list.filter((t) => t.genre === 'Rock').map((t) => t.id);
  const strict = { kind: 'station', key: 'c:x', name: 'Strict', artists: [], genre: null, category: null, year: null, folder: null, memberIds: members, weights: null, strict: true };
  // (b) three Rock plays before the station started, then every member played: the recycle must return MEMBERS
  const exclude = rock.slice(0, 3).concat([...members]);
  const plays = {}; plays[rock[5]] = { plays: 0, skips: 3, finishes: 0 }; // (a) a skipped-out NON-member
  for (let k = 1; k <= 40; k += 1) {
    const picks = radio.pickRadioBatch(strict, list, { exclude, count: 5, plays }, createSeededRng(k));
    assert.strictEqual(picks.length, 5, 'never silent');
    assert.ok(picks.every((t) => members.has(t.id)), 'seed ' + k + ': a non-member in a strict station: ' + picks.map((t) => t.title).join(', '));
  }
  // a non-strict station: a skipped-out NON-member comes back only when every tier is spent, after the members' own recycle?
  // no - D3 as built: the skipped-out pool (candidates of the station only) is drawn before the R11 recycle; a skipped-out
  // song the station could never draw (tier 0) is not in it. Here every song is a candidate (T1 members, T7 rest):
  const loose = Object.assign({}, strict, { strict: false });
  const everything = list.map((t) => t.id).filter((id) => id !== rock[5]);
  const dry = radio.pickRadioBatch(loose, list, { exclude: everything, count: 3, plays }, createSeededRng(3)).map((t) => t.id);
  assert.strictEqual(dry[0], rock[5], 'non-strict, everything else spent: the skipped-out candidate returns before the recycle (D3 as built: "unless the station would run dry")');
});

test('gate r1 adversary M3: a station draw weighs the viewer\'s counts - a 3x-skipped member is left out while others remain, a 2x-skipped member draws ~0.3x', () => {
  const list = many(5, (i) => nat('M' + i, 'Reggae', { title: 'Tune ' + i }));
  const members = new Set(list.map((t) => t.id));
  const profile = { kind: 'station', key: 's:reggae', name: 'Reggae', artists: [], genre: null, category: null, year: null, folder: null, memberIds: members, weights: null, strict: false };
  const plays = {}; plays[list[0].id] = { plays: 0, skips: 3, finishes: 0 }; plays[list[1].id] = { plays: 1, skips: 2, finishes: 0 };
  const tally = {};
  for (let k = 1; k <= 1000; k += 1) { const id = radio.pickRadioBatch(profile, list, { exclude: [], count: 1, plays }, createSeededRng(k))[0].id; tally[id] = (tally[id] || 0) + 1; }
  assert.strictEqual(tally[list[0].id], undefined, 'left out: ' + JSON.stringify(tally));
  const ref = (tally[list[2].id] + tally[list[3].id] + tally[list[4].id]) / 3;
  assert.ok(tally[list[1].id] / ref > 0.2 && tally[list[1].id] / ref < 0.45, '~0.3x: ' + tally[list[1].id] + ' vs ' + ref);
});

test('gate r1 adversary M31: a style absorbs a genre that WOULD form its own station (45 reggae-tagged songs from 3 artists: s:reggae only, never g:reggae)', () => {
  const list = many(45, (i) => nat('Reggae Band ' + (i % 3), 'Reggae'));
  list.push(...many(50, (i) => nat('Rocker ' + (i % 3), 'Rock')));
  const k = keys(list);
  assert.ok(k.includes('s:reggae') && !k.includes('g:reggae'), k.join(' '));
  assert.ok(k.includes('g:rock'), 'a genre no style names keeps its own station');
  assert.strictEqual(byKey(list, null, 's:reggae').members.length, 45);
});

test('gate r1 adversary W2: Favorites keeps its fallback (likes, then the most recently resumed) until a COUNTED song qualifies - one play never empties it; likes alone do not end the fallback', () => {
  const list = many(10, (i) => nat('F' + i, 'Rock'));
  const liked = new Set([list[0].id]);
  const progress = {}; progress[list[5].id] = { position: 40, updatedAt: '2026-01-02T00:00:00.000Z' };
  const one = {}; one[list[7].id] = { plays: 1, skips: 0, finishes: 0 };
  const f = byKey(list, { liked, progress, plays: one, custom: [], hidden: new Set() }, 'favorites');
  assert.ok(f, 'Favorites did not vanish on the first play');
  assert.deepStrictEqual(f.members.map((t) => t.id), [list[0].id, list[5].id], 'likes then resumed, still the fallback');
  assert.strictEqual(f.subtitle, 'Builds as you listen');
  const noLikes = byKey(list, { liked: new Set(), progress, plays: one, custom: [], hidden: new Set() }, 'favorites');
  assert.deepStrictEqual(noLikes.members.map((t) => t.id), [list[5].id], 'no likes, one play: the resumed song keeps Favorites alive');
  const three = {}; three[list[7].id] = { plays: 3, skips: 0, finishes: 1 };
  const f3 = byKey(list, { liked, progress, plays: three, custom: [], hidden: new Set() }, 'favorites');
  assert.deepStrictEqual(f3.members.map((t) => t.id), [list[0].id, list[7].id], 'a counted song qualifies: likes + counted, the resumed one is out');
  assert.strictEqual(f3.subtitle, '2 songs');
});

test('gate r1 adversary W1 / security L1: a stored definition with the wrong shapes never throws - matchCustom reads lists defensively', () => {
  const list = many(5, (i) => nat('A' + i, 'Rock'));
  assert.deepStrictEqual(stations.matchCustom({ genres: 'rock' }, list), [], 'a string where a list should be: no axis, no throw');
  assert.deepStrictEqual(stations.matchCustom({ exclude: { a: 1 }, artists: ['A1'] }, list).map((t) => t.artist), ['A1']);
  assert.deepStrictEqual(stations.matchCustom({ words: [1, null, 'nope'] }, list), []);
  const bad = stations.buildStations(list, Object.assign({}, NO_USER, { custom: [{ id: 'abc', name: 'Bad', genres: 'rock' }] }));
  assert.ok(bad.some((s) => s.key === 'c:abc' && s.members.length === 0), 'listed empty, the editor can fix it');
});
