'use strict';

// [UNIT] v1.368.0 gate r1 (adversary W7: picker mutants P2, P10, P11, P16, P18 survived every test) - the
// station picker's T0-tuning claims, each with an input where the claim and its absence DIVERGE.

const { test } = require('node:test');
const assert = require('node:assert');
const radio = require('../../lib/music/radio');
const { createSeededRng } = require('../../lib/videoQuery');

const nat = (id, artist, genre, extra) => Object.assign({ id, artist, genre: genre || '', year: '1990', folderName: 'f-' + artist, source: 'native' }, extra || {});

test('P2: the seed song itself is never picked, even when the client did not exclude it', () => {
  const lib = [nat('s', 'A', 'Rock'), nat('a1', 'A', 'Rock'), nat('a2', 'A', 'Rock'), nat('r1', 'B', 'Rock'), nat('r2', 'C', 'Rock')];
  const profile = radio.buildStationProfile({ kind: 'track', value: 's' }, lib);
  for (let k = 1; k <= 30; k += 1) {
    const ids = radio.pickRadioBatch(profile, lib, { exclude: [], count: 4 }, createSeededRng(k)).map((t) => t.id);
    assert.ok(!ids.includes('s'), 'seed ' + k + ': the seed came back: ' + ids.join(' '));
  }
});

test('P11: an untagged song borrows its ARTIST\'s most common genre, else its FOLDER\'s', () => {
  const lib = [nat('u', 'A', ''), nat('a1', 'A', 'Rock'), nat('a2', 'A', 'Rock'), nat('a3', 'A', 'Jazz'),
    nat('v', 'Lone', '', { folderName: 'shared' }), nat('w1', 'Other', 'Jazz', { folderName: 'shared' }), nat('w2', 'Other2', 'Jazz', { folderName: 'shared' })];
  assert.strictEqual(radio.buildStationProfile({ kind: 'track', value: 'u' }, lib).genre, 'rock', 'the artist\'s genre');
  assert.strictEqual(radio.buildStationProfile({ kind: 'track', value: 'v' }, lib).genre, 'jazz', 'no artist genre: the folder\'s');
});

test('P10 (v1.375.0 Q3, inverted): a station with neither a genre nor a category is NOT anchored on the genre of its recent plays - the session never steers it', () => {
  // v1.368.0 borrowed the most common genre of the last 24 plays here (the Kirby -> Prince cause);
  // Dean's ruling: a station is defined by its seed only
  const lib = [nat('u0', 'Untagged', ''), nat('u1', 'Untagged', '')];
  for (let i = 0; i < 10; i += 1) lib.push(nat('r' + i, 'Rocker ' + i, 'Rock'));
  for (let i = 0; i < 30; i += 1) lib.push(nat('j' + i, 'Jazzer ' + i, 'Jazz'));
  const profile = radio.buildStationProfile({ kind: 'track', value: 'u0' }, lib);
  assert.strictEqual(profile.genre, null, 'precondition: nothing to stay close to');
  assert.strictEqual(profile.category, null);
  // the session played three Rock songs before: the old anchor made this a Rock station (0 Jazz)
  const exclude = ['u0', 'r0', 'r1', 'r2'];
  let jazz = 0; let rock = 0;
  for (let k = 1; k <= 30; k += 1) {
    const picks = radio.pickRadioBatch(profile, lib, { exclude, count: 5 }, createSeededRng(k));
    jazz += picks.filter((t) => t.genre === 'Jazz').length;
    rock += picks.filter((t) => t.genre === 'Rock').length;
  }
  assert.ok(jazz > rock, 'the session\'s Rock did not steer it: Jazz (30 songs) is drawn more than the 7 Rock left: jazz ' + jazz + ', rock ' + rock);
});

test('P16: a neighbouring genre with more bridges is drawn more often (T4 weighs by strength)', () => {
  // seed genre Shoegaze; Dreampop bridges it through 3 artists, Grunge through 1
  const lib = [nat('s', 'Seed', 'Shoegaze')];
  ['X', 'Y', 'Z'].forEach((a) => { lib.push(nat(a + 's', a, 'Shoegaze')); lib.push(nat(a + 'd', a, 'Dreampop')); });
  lib.push(nat('Ws', 'W', 'Shoegaze')); lib.push(nat('Wg', 'W', 'Grunge'));
  for (let i = 0; i < 20; i += 1) { lib.push(nat('d' + i, 'Dream ' + i, 'Dreampop')); lib.push(nat('g' + i, 'Grun ' + i, 'Grunge')); }
  const profile = radio.buildStationProfile({ kind: 'track', value: 's' }, lib);
  const nb = radio.genreNeighbours(lib);
  assert.ok(nb.get('shoegaze').get('dreampop') > nb.get('shoegaze').get('grunge'), 'precondition: Dreampop is the stronger neighbour');
  // exclude every Shoegaze and the bridges' own songs so the station must draw from T4
  const exclude = lib.filter((t) => t.genre === 'Shoegaze' || /^[XYZW][sdg]$/.test(t.id)).map((t) => t.id);
  let dream = 0; let grunge = 0;
  for (let k = 1; k <= 200; k += 1) {
    const p = radio.pickRadioBatch(profile, lib, { exclude, count: 1 }, createSeededRng(k))[0];
    if (p.genre === 'Dreampop') dream += 1; else if (p.genre === 'Grunge') grunge += 1;
  }
  assert.strictEqual(dream + grunge, 200, 'precondition: every pick is a T4 neighbour');
  assert.ok(dream / 200 > 0.65, 'Dreampop (strength 3) is drawn ~75% (50% unweighted): ' + dream + '/200');
});

test('P18: a YouTube category name on a NATIVE track is a real genre tag (only yt-dlp audio\'s categories count as untagged)', () => {
  assert.strictEqual(radio.genreKey({ genre: 'Music', source: 'native' }), 'music', 'a native "Music" tag is a genre');
  assert.strictEqual(radio.genreKey({ genre: 'Music', source: 'library' }), null, 'yt-dlp audio\'s "Music" is a category');
  assert.strictEqual(radio.genreKey({ genre: 'Music', source: 'library-chapter' }), null);
});

test('gate r2 S7: QUEUED songs are never picked but are NOT plays - they never block the seed artist by spacing', () => {
  const lib = [];
  for (let i = 0; i < 6; i += 1) lib.push(nat('a' + i, 'A', 'Rock'));
  for (let i = 0; i < 6; i += 1) lib.push(nat('r' + i, 'R' + i, 'Rock'));
  const profile = radio.buildStationProfile({ kind: 'track', value: 'a0' }, lib);
  for (let k = 1; k <= 30; k += 1) {
    const picks = radio.pickRadioBatch(profile, lib, { exclude: ['a0'], queued: ['a1', 'a2'], count: 5 }, createSeededRng(k));
    const ids = picks.map((t) => t.id);
    assert.ok(!ids.includes('a1') && !ids.includes('a2'), 'seed ' + k + ': a queued song came back: ' + ids.join(' '));
    assert.strictEqual(picks[0].artist, 'A', 'seed ' + k + ': slot 0 (a seed-artist slot) is the seed artist - two queued A songs are not two A plays');
  }
});

test('gate r2 W9: a candidate spacing skipped gets no head start - the slot after a block draws the blocked artist at its weighted share', () => {
  // the adversary's measurement: Heavy has 6 tracks, 6 others 1 each (o0 liked); the last two plays were
  // Heavy, so slot 0 blocks it; slot 1 must draw it at its fair share (~0.51), not ~0.74
  const lib = [];
  for (let i = 0; i < 6; i += 1) lib.push(nat('h' + i, 'Heavy', 'Rock', { folderName: 'h' }));
  for (let i = 0; i < 6; i += 1) lib.push(nat('o' + i, 'Other ' + i, 'Rock', { folderName: 'o' + i }));
  lib.push(nat('seed', 'Seedless', 'Rock', { folderName: 'z' }));
  lib.push(nat('p1', 'Heavy', 'Jazz', { year: '1950', folderName: 'x' }));
  lib.push(nat('p2', 'Heavy', 'Jazz', { year: '1950', folderName: 'x' }));
  const profile = radio.buildStationProfile({ kind: 'track', value: 'seed' }, lib);
  const N = 4000;
  const heavy = [0, 0, 0];
  for (let s = 1; s <= N; s += 1) {
    const picks = radio.pickRadioBatch(profile, lib, { exclude: ['seed', 'p1', 'p2'], count: 3, liked: new Set(['o0']) }, createSeededRng(s));
    picks.forEach((t, k) => { if (t.artist === 'Heavy') heavy[k] += 1; });
  }
  assert.strictEqual(heavy[0], 0, 'precondition: slot 0 blocks Heavy (the run rule)');
  const s1 = heavy[1] / N; const s2 = heavy[2] / N;
  assert.ok(s1 > 0.46 && s1 < 0.57, 'slot 1 Heavy share ~0.51 (a stale key gives ~0.74): ' + s1.toFixed(3));
  assert.ok(s2 > 0.23 && s2 < 0.33, 'slot 2 Heavy share ~0.28 (a stale key gives ~0.15): ' + s2.toFixed(3));
});
