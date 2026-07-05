'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { tokenize, rankRelated } = require('../../public/js/common.js');

test('tokenize + rankRelated: exported for Node (require-safe)', () => {
  assert.equal(typeof tokenize, 'function');
  assert.equal(typeof rankRelated, 'function');
});

// ---- similar-above-unrelated -----------------------------------------------

test('rankRelated: ranks title/filename-similar items above unrelated ones', () => {
  const current = { id: 'cur', title: 'Big Buck Bunny Trailer', filePath: '/lib/big-buck-bunny-trailer.mp4', folderName: 'Movies', addedAt: 1000 };
  const similar = { id: 'sim', title: 'Big Buck Bunny Full Movie', filePath: '/lib/bbb-full.mp4', folderName: 'Movies', addedAt: 500 };
  const unrelated = { id: 'unr', title: 'Completely Different Topic', filePath: '/lib/xyz.mp4', folderName: 'Random', addedAt: 999 };

  const result = rankRelated(current, [current, similar, unrelated]);

  assert.deepEqual(result.map((i) => i.id), ['sim', 'unr']);
});

test('rankRelated: a shared folder alone ranks above a token-disjoint, different-folder item', () => {
  const current = { id: 'cur', title: 'Alpha', filePath: '/lib/alpha.mp4', folderName: 'Vacation', addedAt: 1000 };
  const sameFolder = { id: 'fld', title: 'Zzz Unrelated Name', filePath: '/lib/zzz.mp4', folderName: 'Vacation', addedAt: 100 };
  const otherFolder = { id: 'oth', title: 'Qqq Also Unrelated', filePath: '/lib/qqq.mp4', folderName: 'Other', addedAt: 900 };

  const result = rankRelated(current, [current, sameFolder, otherFolder]);

  assert.deepEqual(result.map((i) => i.id), ['fld', 'oth']);
});

// ---- self-exclusion ---------------------------------------------------------

test('rankRelated: never includes the current item in its output', () => {
  const current = { id: 'cur', title: 'Same Title', filePath: '/lib/same.mp4', folderName: 'F', addedAt: 1000 };
  const other = { id: 'other', title: 'Same Title', filePath: '/lib/same2.mp4', folderName: 'F', addedAt: 900 };

  const result = rankRelated(current, [current, other]);

  assert.ok(!result.some((i) => i.id === current.id));
  assert.deepEqual(result.map((i) => i.id), ['other']);
});

// ---- W_CHANNEL guard: no spurious "Library" collision bonus ----------------

test('rankRelated: two items both missing artist+folderName do NOT get a W_CHANNEL bonus from colliding on the bare "Library" default', () => {
  // Neither `current` nor `collisionItem` has an artist or a folderName, so
  // resolveChannelName() falls back to the literal 'Library' string for both
  // — without the guard, that bare default would collide and spuriously earn
  // W_CHANNEL, hoisting a token-disjoint, ancient item into the "similar"
  // bucket ahead of a token-disjoint but far more recent item that merely
  // happens to have an (unrelated) real folderName.
  const current = { id: 'cur', title: 'Current Title Words', filePath: '/lib/cur.mp4', addedAt: 500 };
  const collisionItem = { id: 'col', title: 'Totally Unrelated Alpha', filePath: '/lib/col.mp4', addedAt: 1 };
  const namedFolderItem = { id: 'zoo', title: 'Totally Unrelated Beta', filePath: '/lib/zoo.mp4', folderName: 'Zoo', addedAt: 1000 };

  const result = rankRelated(current, [current, collisionItem, namedFolderItem]);

  // Both candidates share zero tokens with `current` and score 0 overall, so
  // neither lands in the "similar" bucket — both fall to the recency
  // fallback, ordered purely by addedAt DESC: the far more recent
  // `namedFolderItem` (1000) comes before the ancient `collisionItem` (1).
  assert.deepEqual(result.map((i) => i.id), ['zoo', 'col']);
});

// ---- deterministic + stable tie-break --------------------------------------

test('rankRelated: equal-score candidates tie-break by addedAt DESC then id ASC, deterministically', () => {
  const current = { id: 'cur', title: 'Widget', filePath: '/lib/widget.mp4', folderName: 'F', addedAt: 1000 };
  // Three candidates with identical shared-token score (1 shared token "widget", no folder/channel match).
  const a = { id: 'b-item', title: 'Widget A', filePath: '/lib/a.mp4', folderName: 'G', addedAt: 500 };
  const b = { id: 'a-item', title: 'Widget B', filePath: '/lib/b.mp4', folderName: 'G', addedAt: 500 }; // same addedAt as a, lower id
  const c = { id: 'c-item', title: 'Widget C', filePath: '/lib/c.mp4', folderName: 'G', addedAt: 700 }; // newest -> first

  const allItems = [current, a, b, c];
  const result1 = rankRelated(current, allItems);
  const result2 = rankRelated(current, allItems);

  // c has the newest addedAt (700) so it wins first; a and b tie on addedAt (500)
  // so id ASC breaks the tie: 'a-item' < 'b-item'.
  assert.deepEqual(result1.map((i) => i.id), ['c-item', 'a-item', 'b-item']);
  assert.deepEqual(result1.map((i) => i.id), result2.map((i) => i.id), 'repeated calls are identical');
});

// ---- fallback below floor ---------------------------------------------------

test('rankRelated: pads with most-recent items when fewer than SIMILAR_FLOOR are genuinely similar', () => {
  const current = { id: 'cur', title: 'Unique Keyword Zephyr', filePath: '/lib/zephyr.mp4', folderName: 'F', addedAt: 1000 };
  // Only 2 similar (share "zephyr"), plus 9 completely unrelated items with distinct addedAt.
  const similar1 = { id: 'sim1', title: 'Zephyr Part Two', filePath: '/lib/zephyr2.mp4', folderName: 'F', addedAt: 50 };
  const similar2 = { id: 'sim2', title: 'Zephyr Remix', filePath: '/lib/zephyr3.mp4', folderName: 'F', addedAt: 40 };

  const unrelated = [];
  for (let i = 0; i < 9; i++) {
    unrelated.push({ id: 'unr' + i, title: 'Something Else Entirely ' + i, filePath: '/lib/other' + i + '.mp4', folderName: 'Other', addedAt: 100 + i });
  }

  const allItems = [current, similar1, similar2, ...unrelated];
  const result = rankRelated(current, allItems);

  assert.equal(result.length, 10, 'never empty, capped at RESULT_COUNT (10)');
  // Similar items must appear first (score > 0), most-recent-unrelated fills the rest.
  assert.deepEqual(result.slice(0, 2).map((i) => i.id), ['sim1', 'sim2']);
  // The most recent unrelated items (addedAt DESC) should fill the remaining 8 slots.
  const recentIds = result.slice(2).map((i) => i.id);
  assert.deepEqual(recentIds, ['unr8', 'unr7', 'unr6', 'unr5', 'unr4', 'unr3', 'unr2', 'unr1']);
});

// ---- tokenization: stopwords + short tokens are not similarity signals ----

test('tokenize: drops stopwords and tokens shorter than 2 chars', () => {
  const tokens = tokenize('The A of I to In on for With Feat Ft Official Video Audio HD');
  assert.deepEqual([...tokens], []);
});

test('tokenize: keeps meaningful tokens, lowercased and deduped', () => {
  const tokens = tokenize('The Matrix Reloaded (Official Video)');
  assert.deepEqual([...tokens].sort(), ['matrix', 'reloaded']);
});

test('rankRelated: items sharing only stopwords/short tokens are NOT treated as similar', () => {
  const current = { id: 'cur', title: 'The Best of A Video', filePath: '/lib/cur.mp4', folderName: 'F', addedAt: 1000 };
  const stopwordOnly = { id: 'sw', title: 'The A of In On For', filePath: '/lib/sw.mp4', folderName: 'G', addedAt: 5 };
  const genuinelySimilar = { id: 'gs', title: 'Best Compilation Episode', filePath: '/lib/gs.mp4', folderName: 'H', addedAt: 4 };

  const result = rankRelated(current, [current, stopwordOnly, genuinelySimilar]);

  // 'best' is shared and meaningful -> genuinelySimilar ranks first;
  // stopwordOnly shares zero meaningful tokens and no folder/channel, so it
  // falls into the fallback/recent tail, after the genuinely similar item.
  assert.equal(result[0].id, 'gs');
});

// ---- shared embedded-metadata tags (real /api/videos shape = object) ------

test('rankRelated: items sharing an artist in their tags OBJECT rank as similar despite different titles/folders', () => {
  const current = {
    id: 'cur', title: 'Sunset Boulevard', filePath: '/lib/a/sunset.mp3', folderName: 'FolderA',
    tags: { artist: 'The Wandering Souls', album: 'Echoes' }, addedAt: 1000
  };
  const similarByArtist = {
    id: 'sim', title: 'Midnight Rain', filePath: '/lib/b/midnight.mp3', folderName: 'FolderB',
    tags: { artist: 'The Wandering Souls', album: 'Nightfall' }, addedAt: 500
  };
  const unrelated = {
    id: 'unr', title: 'Completely Different Topic', filePath: '/lib/c/xyz.mp3', folderName: 'FolderC',
    tags: { artist: 'Some Other Artist', album: 'Nothing Related' }, addedAt: 999
  };

  const result = rankRelated(current, [current, similarByArtist, unrelated]);

  assert.deepEqual(result.map((i) => i.id), ['sim', 'unr']);
});

test('rankRelated: items sharing an album in their tags OBJECT rank as similar', () => {
  const current = {
    id: 'cur', title: 'Track One', filePath: '/lib/a/track1.mp3', folderName: 'FolderA',
    tags: { artist: 'Artist A', album: 'Greatest Hits Collection' }, addedAt: 1000
  };
  const similarByAlbum = {
    id: 'sim', title: 'Track Two', filePath: '/lib/b/track2.mp3', folderName: 'FolderB',
    tags: { artist: 'Artist B', album: 'Greatest Hits Collection' }, addedAt: 500
  };
  const unrelated = {
    id: 'unr', title: 'Something Else', filePath: '/lib/c/other.mp3', folderName: 'FolderC',
    tags: { artist: 'Artist C', album: 'Unrelated Release' }, addedAt: 999
  };

  const result = rankRelated(current, [current, similarByAlbum, unrelated]);

  assert.deepEqual(result.map((i) => i.id), ['sim', 'unr']);
});

test('rankRelated/tokenize: tags handled defensively whether object, array, string, or null (never throws)', () => {
  const current = { id: 'cur', title: 'Anything', tags: { artist: 'X' }, addedAt: 1 };
  const items = [
    current,
    { id: 'obj', title: 'Item Obj', tags: { artist: 'Y', comment: 42 } }, // non-string value ignored
    { id: 'arr', title: 'Item Arr', tags: ['legacy', 'array', 'shape'] },
    { id: 'str', title: 'Item Str', tags: 'a plain string tag' },
    { id: 'null-tags', title: 'Item Null', tags: null },
    { id: 'no-tags', title: 'Item None' }
  ];

  let result;
  assert.doesNotThrow(() => {
    result = rankRelated(current, items);
  });
  assert.ok(!result.some((i) => i.id === 'cur'));
  assert.equal(result.length, 5);
});

// ---- edge cases --------------------------------------------------------------

test('rankRelated: empty allItems returns []', () => {
  const current = { id: 'cur', title: 'Anything', addedAt: 1 };
  assert.deepEqual(rankRelated(current, []), []);
});

test('rankRelated: a library of one (only the current item) returns []', () => {
  const current = { id: 'cur', title: 'Anything', addedAt: 1 };
  assert.deepEqual(rankRelated(current, [current]), []);
});

test('rankRelated: items missing tags/artist/folderName/filePath do not throw and preserve guarantees', () => {
  const current = { id: 'cur', title: 'Sparse Item' }; // no tags/artist/folderName/filePath/addedAt
  const others = [
    { id: 'o1', title: 'Sparse Item Two' }, // missing folderName/filePath/tags/artist/addedAt too
    { id: 'o2' }, // missing title entirely
    { id: 'o3', title: 'Another', tags: null, artist: undefined, folderName: undefined, filePath: undefined },
  ];

  let result;
  assert.doesNotThrow(() => {
    result = rankRelated(current, [current, ...others]);
  });
  assert.ok(!result.some((i) => i.id === 'cur'), 'self-exclusion preserved');
  assert.ok(result.length > 0, 'never-empty guarantee preserved');
  assert.ok(result.length <= 10);
});

test('rankRelated: result length is capped at RESULT_COUNT (10) even with a large library', () => {
  const current = { id: 'cur', title: 'Popular Keyword', addedAt: 10000 };
  const items = [current];
  for (let i = 0; i < 25; i++) {
    items.push({ id: 'item' + i, title: 'Popular Keyword Variant ' + i, filePath: '/lib/f' + i + '.mp4', folderName: 'F', addedAt: 1000 - i });
  }

  const result = rankRelated(current, items);
  assert.equal(result.length, 10);
});
