'use strict';

// [UNIT] v1.195 TV Shows: the PURE parse + grouping core (lib/tv/parse.js). Built
// to Dean's on-disk convention: <Show>/<Season N|Specials>/<Show SxxEyy - Title>.
// These bind the parser against his real filenames and the best-effort fallbacks.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseSeasonFolder,
  parseEpisodeFilename,
  cleanTitle,
  groupShows,
  groupSeasons,
  seasonLabel,
} = require('../../lib/tv/parse.js');

// ---- parseSeasonFolder ------------------------------------------------------

test('parseSeasonFolder: recognizes Season N / Specials, folds the rest to Extras (null)', () => {
  assert.strictEqual(parseSeasonFolder('Season 2'), 2, 'Dean\'s exact form');
  assert.strictEqual(parseSeasonFolder('Season 02'), 2, 'zero-padded');
  assert.strictEqual(parseSeasonFolder('season2'), 2, 'no space, lowercase');
  assert.strictEqual(parseSeasonFolder('SEASON 10'), 10);
  assert.strictEqual(parseSeasonFolder('Specials'), 0, 'Specials -> season 0');
  assert.strictEqual(parseSeasonFolder('specials'), 0);
  assert.strictEqual(parseSeasonFolder('Season 0'), 0);
  assert.strictEqual(parseSeasonFolder('Season 00'), 0);
  assert.strictEqual(parseSeasonFolder('Bloopers'), null, 'unrecognized -> Extras bucket');
  assert.strictEqual(parseSeasonFolder('Behind the Scenes'), null);
  assert.strictEqual(parseSeasonFolder('Season Finale'), null, 'not a number -> null');
  assert.strictEqual(parseSeasonFolder(''), null);
  assert.strictEqual(parseSeasonFolder(null), null);
  assert.strictEqual(parseSeasonFolder(42), null, 'non-string tolerated');
});

// ---- parseEpisodeFilename ---------------------------------------------------

test('parseEpisodeFilename: Dean\'s exact convention "House MD S02E22 - Forever.mp4"', () => {
  assert.deepStrictEqual(parseEpisodeFilename('House MD S02E22 - Forever.mp4'),
    { seasonNum: 2, episodeNum: 22, title: 'Forever' });
});

test('parseEpisodeFilename: SxxEyy variants + the title-less and no-token fallbacks', () => {
  assert.deepStrictEqual(parseEpisodeFilename('House MD S02E22.mp4'),
    { seasonNum: 2, episodeNum: 22, title: '' }, 'no " - Title" -> empty title (UI shows Episode N)');
  assert.deepStrictEqual(parseEpisodeFilename('s1e5.mkv'),
    { seasonNum: 1, episodeNum: 5, title: '' }, 'bare lowercase token');
  assert.deepStrictEqual(parseEpisodeFilename('HOUSE MD S2E22 - Forever'),
    { seasonNum: 2, episodeNum: 22, title: 'Forever' }, 'no extension, uppercase, single-digit');
  assert.deepStrictEqual(parseEpisodeFilename('Show S02.E03 - The.Mistake.avi'),
    { seasonNum: 2, episodeNum: 3, title: 'The Mistake' }, 'S02.E03 separator + dotted title -> spaces');
  assert.deepStrictEqual(parseEpisodeFilename('Some Random Clip.mp4'),
    { seasonNum: null, episodeNum: null, title: 'Some Random Clip' }, 'no SxxEyy -> Extras, still named');
  assert.deepStrictEqual(parseEpisodeFilename('bonus_featurette.mkv'),
    { seasonNum: null, episodeNum: null, title: 'bonus featurette' }, 'underscored no-token name cleans to spaces');
  assert.deepStrictEqual(parseEpisodeFilename('S.W.A.T S01E01 - Pilot.mp4'),
    { seasonNum: 1, episodeNum: 1, title: 'Pilot' }, 'interior dots in the show name never confuse the ext strip');
  assert.deepStrictEqual(parseEpisodeFilename(''), { seasonNum: null, episodeNum: null, title: '' });
  assert.deepStrictEqual(parseEpisodeFilename(null), { seasonNum: null, episodeNum: null, title: '' }, 'non-string tolerated');
});

test('cleanTitle: strips a leading separator run; only dot/underscore-splits a spaceless name', () => {
  assert.strictEqual(cleanTitle(' - Forever'), 'Forever');
  assert.strictEqual(cleanTitle('  Forever '), 'Forever');
  assert.strictEqual(cleanTitle('The.Mistake'), 'The Mistake');
  assert.strictEqual(cleanTitle('Already Spaced.Name'), 'Already Spaced.Name', 'a name WITH spaces keeps its dots');
  assert.strictEqual(cleanTitle(''), '');
});

// ---- groupShows -------------------------------------------------------------

function ep(id, showId, showName, seasonNum, episodeNum, addedAt) {
  return { id, showId, showName, seasonNum, episodeNum, title: `ep${episodeNum}`, addedAt };
}

test('groupShows: one card per show, A-Z (O1), counts, earliest-episode poster, latest addedAt', () => {
  const episodes = {
    a: ep('a', 'sh-house', 'House MD', 2, 22, 100),
    b: ep('b', 'sh-house', 'House MD', 1, 1, 90),
    c: ep('c', 'sh-house', 'House MD', 2, 1, 110),
    d: ep('d', 'sh-alias', 'Alias', 1, 1, 200),
    e: ep('e', 'sh-house', 'House MD', 0, 1, 50), // a special -> distinct season
  };
  const cards = groupShows(episodes);
  assert.strictEqual(cards.length, 2, 'two distinct shows');
  assert.strictEqual(cards[0].name, 'Alias', 'A before H (alphabetical, O1)');
  assert.strictEqual(cards[1].name, 'House MD');
  const house = cards[1];
  assert.strictEqual(house.episodeCount, 4);
  assert.strictEqual(house.seasonCount, 3, 'seasons 1, 2, and Specials(0) are three');
  assert.strictEqual(house.latestAddedAt, 110, 'newest addedAt across the show');
  assert.strictEqual(house.posterEpisodeId, 'b', 'poster = earliest (season 1, ep 1)');
});

test('groupShows: tolerates an array input and skips episodes with no showId', () => {
  const arr = [ep('a', 'x', 'X', 1, 1, 1), { id: 'z', showId: '', showName: 'nope', seasonNum: 1, episodeNum: 1 }];
  const cards = groupShows(arr);
  assert.strictEqual(cards.length, 1);
  assert.strictEqual(cards[0].id, 'x');
});

// ---- groupSeasons -----------------------------------------------------------

test('groupSeasons: regular seasons ascending, then Specials(0), then Extras(null); episodes by number', () => {
  const episodes = [
    ep('a', 'sh', 'Show', 2, 22, 1),
    ep('b', 'sh', 'Show', 1, 2, 1),
    ep('c', 'sh', 'Show', 1, 1, 1),
    ep('d', 'sh', 'Show', 0, 1, 1),           // special
    { id: 'e', showId: 'sh', showName: 'Show', seasonNum: null, episodeNum: null, title: 'Gag reel' }, // extra
    ep('f', 'other', 'Other', 1, 1, 1),       // different show, excluded
  ];
  const seasons = groupSeasons(episodes, 'sh');
  assert.deepStrictEqual(seasons.map((s) => s.label), ['Season 1', 'Season 2', 'Specials', 'Extras'],
    'regular seasons ascending, Specials after, Extras last');
  assert.deepStrictEqual(seasons[0].episodes.map((e) => e.id), ['c', 'b'], 'season 1 ordered by episode number');
  assert.strictEqual(seasons[3].episodes[0].id, 'e', 'the unnumbered extra lands in Extras');
});

test('seasonLabel: the three shapes', () => {
  assert.strictEqual(seasonLabel(3), 'Season 3');
  assert.strictEqual(seasonLabel(0), 'Specials');
  assert.strictEqual(seasonLabel(null), 'Extras');
});
