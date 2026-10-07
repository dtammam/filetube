'use strict';

// v1.368.0 music radio: a DJ-set chapter is spaced by its SET, not its channel (Dean's ruling
// 2026-10-06, "stay on the channel"). A chapter's artist field is the channel name, every chapter a
// different song; production run 2 (tools/radio-sim/new-picker-9c14ae15-2026-10-06.txt) measured
// untagged DJ-channel stations leaving the channel after 3 chapters for random picks (T7 70.6% at the
// 1-hour p90). The fixtures use the projected chapter shape (`<file>::c<n>`, source library-chapter).

const { test } = require('node:test');
const assert = require('node:assert');
const radio = require('../../lib/music/radio');
const { createSeededRng } = require('../../lib/videoQuery');

function chapters(file, n, channel, genre) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push({ id: file + '::c' + i, artist: channel, albumArtist: channel, album: file, folderName: channel.toLowerCase(), source: 'library-chapter', genre: genre || '', chapterStartSec: i * 240 });
  return out;
}
const setOf = (id) => id.replace(/::c\d+$/, '');

// an untagged DJ channel with 4 sets, plus 30 tagged native tracks by 10 artists (what T7 would draw)
const LIB = [
  ...chapters('setA', 12, 'Bare DJ'), ...chapters('setB', 12, 'Bare DJ'), ...chapters('setC', 12, 'Bare DJ'), ...chapters('setD', 12, 'Bare DJ'),
  ...Array.from({ length: 30 }, (_, i) => ({ id: 'n' + i, artist: 'Artist ' + (i % 10), genre: ['Rock', 'Jazz', 'Pop'][i % 3], year: '1990', folderName: 'f' + (i % 10), source: 'native' })),
];

// a channel with 10 sets of 6: enough sets for the hourly cap (3 per set in 24 plays) to hold unrelaxed
const WIDE = [...'ABCDEFGHIJ'].flatMap((L) => chapters('wide' + L, 6, 'Wide DJ')).concat(LIB.filter((t) => t.source === 'native'));

function session(seedId, batches, rngSeed, lib) {
  const list = lib || LIB;
  const profile = radio.buildStationProfile({ kind: 'track', value: seedId }, list);
  const played = [seedId];
  const rng = createSeededRng(rngSeed);
  for (let b = 0; b < batches; b += 1) {
    const picks = radio.pickRadioBatch(profile, list, { exclude: played.slice(-200), count: 5 }, rng);
    played.push(...picks.map((t) => t.id));
  }
  return played;
}

test('a station from an untagged DJ-set chapter stays on its channel while the channel has chapters', () => {
  for (let s = 1; s <= 20; s += 1) {
    const played = session('setA::c0', 6, s); // 31 plays, under the channel's 48 chapters
    const off = played.filter((id) => !id.includes('::c'));
    assert.deepStrictEqual(off, [], 'seed ' + s + ': left the channel: ' + off.join(' '));
  }
});

test('a channel with only 4 sets relaxes the hourly cap, never the 2-in-a-row rule, before leaving', () => {
  for (let s = 1; s <= 20; s += 1) {
    const played = session('setB::c3', 6, s);
    for (let i = 2; i < played.length; i += 1) {
      const a = setOf(played[i]);
      assert.ok(!(a === setOf(played[i - 1]) && a === setOf(played[i - 2])), `seed ${s}: 3 in a row from ${a} at ${i}`);
    }
  }
});

test('with enough sets: never 3 in a row and at most 3 in any 24 plays from one SET, all on the channel', () => {
  for (let s = 1; s <= 20; s += 1) {
    const played = session('wideB::c3', 6, s, WIDE);
    let checked = 0;
    assert.deepStrictEqual(played.filter((id) => !id.includes('::c')), [], 'seed ' + s + ' stayed on the channel');
    for (let i = 2; i < played.length; i += 1) {
      const a = setOf(played[i]);
      assert.ok(!(a === setOf(played[i - 1]) && a === setOf(played[i - 2])), `seed ${s}: 3 in a row from ${a} at ${i}`);
    }
    for (let i = 0; i + 24 <= played.length; i += 1) {
      const counts = {};
      for (const id of played.slice(i, i + 24)) counts[setOf(id)] = (counts[setOf(id)] || 0) + 1;
      const top = Math.max(...Object.values(counts));
      assert.ok(top <= radio.ARTIST_WINDOW_MAX, `seed ${s}: a set played ${top} times in plays ${i}-${i + 23}: ${JSON.stringify(counts)}`);
      checked += 1;
    }
    assert.ok(checked >= 8, 'precondition: the window check ran (' + checked + ')');
  }
});

test('a tagged artist is still spaced by its artist (the set rule is for chapters only)', () => {
  const lib = [...Array.from({ length: 10 }, (_, i) => ({ id: 'a' + i, artist: 'Solo', genre: 'Rock', year: '1990', source: 'native' })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: 'b' + i, artist: 'Other ' + i, genre: 'Rock', year: '1990', source: 'native' }))];
  const profile = radio.buildStationProfile({ kind: 'track', value: 'a0' }, lib);
  const picks = radio.pickRadioBatch(profile, lib, { exclude: ['a0', 'a1'], count: 1 }, createSeededRng(1));
  assert.notStrictEqual(picks[0].artist, 'Solo', 'the 3rd Solo in a row is refused');
});
