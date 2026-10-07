'use strict';

// v1.368.0 music radio, T0 tuning: genre neighbours (lib/music/radio.js genreNeighbours). Production
// (T0) had 53 primary genres but only 34 of 488 tagged artists spanning two, so artist bridges alone
// left a rare genre nothing close and its station fell to T7 (21.1% of picks). A shared word makes a
// family; a neighbour's neighbour is a weak (0.25) neighbour; generic words never link.

const { test } = require('node:test');
const assert = require('node:assert');
const radio = require('../../lib/music/radio');

const track = (id, genre, artist) => ({ id, genre, artist, source: 'native' });
const row = (nb, g) => Object.fromEntries([...(nb.get(g) || new Map())]);

test('a shared word of 3+ letters makes a family; a generic word or a short token never does', () => {
  const nb = radio.genreNeighbours([
    track('a', 'Grunge Rock', 'A'), track('b', 'Folk Rock', 'B'), track('c', 'Jazz', 'C'),
    track('d', 'Electronic Dance Music', 'D'), track('e', 'Music', 'E'), track('f', 'R&B', 'F'), track('g', 'R&B Soul', 'G'),
  ]);
  assert.deepStrictEqual(row(nb, 'grunge rock'), { 'folk rock': 1 });
  assert.deepStrictEqual(row(nb, 'jazz'), {}, 'no family, no bridge');
  assert.deepStrictEqual(row(nb, 'electronic dance music'), {}, '"music" is generic: no link to a "Music" tag');
  assert.deepStrictEqual(row(nb, 'r&b soul'), {}, 'r / b are under 3 letters');
});

test('an artist bridge adds strength on top of a family; a neighbour\'s neighbour is 0.25', () => {
  const nb = radio.genreNeighbours([
    track('a', 'Grunge Rock', 'X'), track('b', 'Folk Rock', 'X'), // family AND bridged by X: 2
    track('c', 'Folk Rock', 'Y'), track('d', 'Country', 'Y'), // Folk Rock ~ Country by Y
  ]);
  assert.deepStrictEqual(row(nb, 'grunge rock'), { 'folk rock': 2, country: 0.25 });
  assert.deepStrictEqual(row(nb, 'country'), { 'folk rock': 1, 'grunge rock': 0.25 });
});

test('the family reaches tierOf: a rare-genre station draws its family (T4) before the rest (T7)', () => {
  const list = [track('s', 'Grunge Rock', 'Seed'), track('f', 'Folk Rock', 'Other'), track('j', 'Jazz', 'Jazzer')];
  const profile = radio.buildStationProfile({ kind: 'track', value: 's' }, list);
  const nb = radio.genreNeighbours(list);
  assert.strictEqual(radio.tierOf(list[1], profile, nb), 4);
  assert.strictEqual(radio.tierOf(list[2], profile, nb), 7);
});
