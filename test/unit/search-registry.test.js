'use strict';

// [UNIT] Wave B - the provider registry logic against FAKE deps (db + gates).
// Binds, per provider: (1) the RBAC gate is applied - a gate returning false
// hides the item; (2) rank.matchTier gates inclusion; (3) the normalized shape
// (resultType/kind/id/title/identityText/recency). runSearch blends across
// providers, filters by chip, and returns [] for an empty query. The REAL-app
// leak proof is rbac-census.test.js; this is the logic bind.

const { test } = require('node:test');
const assert = require('node:assert');
const { runSearch, normalizeChip } = require('../../lib/search/registry.js');

// A fake db seeded with one matching + one non-matching item per namespace,
// plus one item each namespace's gate will BLOCK.
function fakeDb() {
  return {
    metadata: {
      v1: { id: 'v1', type: 'video', title: 'Dune Trailer', channelName: 'Legendary', folderName: 'Movies', addedAt: 10, filePath: '/m/v1' },
      v2: { id: 'v2', type: 'video', title: 'Unrelated', channelName: 'X', folderName: 'Movies', addedAt: 9, filePath: '/m/v2' },
      vBlocked: { id: 'vBlocked', type: 'video', title: 'Dune Secret', channelName: 'Y', folderName: 'Blocked', addedAt: 8, filePath: '/blocked/v' },
      a1: { id: 'a1', type: 'audio', title: 'Dune Podcast Rip', channelName: 'Z', folderName: 'Audio', addedAt: 7, filePath: '/m/a1' },
    },
    music: { tracks: {
      t1: { id: 't1', title: 'Song', artist: 'Dune Band', album: 'A', addedAt: 5, filePath: '/mu/t1' },
      tBlocked: { id: 'tBlocked', title: 'Dune Anthem', artist: 'B', addedAt: 4, filePath: '/blocked/t' },
    } },
    podcasts: {
      subscriptions: [
        { id: 's1', name: 'The Dune Cast', author: 'Host', episodeCount: 3 },
        { id: 'sBlocked', name: 'Dune Blocked Show', author: 'H2' },
      ],
      episodes: {
        e1: { id: 'e1', subId: 's1', title: 'Dune Deep Dive', pubDateMs: 100, filePath: '/pod/e1', status: 'downloaded' },
        eBlocked: { id: 'eBlocked', subId: 'sBlocked', title: 'Dune Hidden Ep', pubDateMs: 90, filePath: '/blocked/e', status: 'downloaded' },
        ePending: { id: 'ePending', subId: 's1', title: 'Dune Pending Ep', pubDateMs: 80, filePath: '', status: 'pending' },
        eTrashed: { id: 'eTrashed', subId: 's1', title: 'Dune Trashed Ep', pubDateMs: 70, filePath: '/pod/etr', status: 'trashed' },
      },
    },
    books: { items: {
      b1: { id: 'b1', title: 'Dune', author: 'Frank Herbert', addedAt: 3, filePath: '/bk/b1' },
      bBlocked: { id: 'bBlocked', title: 'Dune Messiah', author: 'FH', addedAt: 2, filePath: '/blocked/b' },
    } },
  };
}

// Gates that block anything whose path/subId marks it blocked.
function fakeGates(db) {
  const tvEpisodes = [
    { id: 'tv1', showId: 'sh1', showName: 'Dune Prophecy', title: 'The Sisterhood', seasonNum: 1, episodeNum: 1, addedAt: 20, filePath: '/tv/1', rootFolder: '/tv' },
    { id: 'tv2', showId: 'sh2', showName: 'Other Show', title: 'Dune Reference', seasonNum: 1, episodeNum: 1, addedAt: 19, filePath: '/tv/2', rootFolder: '/tv' },
  ];
  return {
    mediaVisibleTo: (req, item) => !String(item.filePath).startsWith('/blocked/'),
    trackVisibleTo: (req, t) => !String(t.filePath).startsWith('/blocked/'),
    podcastVisibleTo: (req, x) => x.subId !== 'sBlocked' && !String(x.filePath || '').startsWith('/blocked/'),
    bookVisibleTo: (req, b) => !String(b.filePath).startsWith('/blocked/'),
    tvVisibleEpisodes: () => tvEpisodes, // pre-filtered by definition
  };
}

function deps() {
  const db = fakeDb();
  return { db, gates: fakeGates(db), buildWatchUrl: () => 'https://yt/watch?v=x' };
}

const req = { user: { id: 1, role: 'admin' } };

test('every provider applies its RBAC gate - a blocked item never appears', () => {
  for (const [chip, blockedId] of [['videos', 'vBlocked'], ['music', 'tBlocked'], ['podcasts', 'sBlocked'], ['podcasts', 'eBlocked'], ['books', 'bBlocked']]) {
    const ids = runSearch('dune', chip, req, deps()).map((r) => r.id);
    assert.ok(!ids.includes(blockedId), `${chip}: blocked id ${blockedId} must not leak (got ${ids})`);
  }
});

test('a provider whose gate rejects EVERYTHING yields nothing (RBAC is really consulted)', () => {
  const d = deps();
  d.gates.bookVisibleTo = () => false;
  const ids = runSearch('dune', 'books', req, d).map((r) => r.id);
  assert.deepStrictEqual(ids, [], 'all books hidden when the gate says no');
});

test('match gating: only rank.matchTier hits are returned', () => {
  const ids = runSearch('dune', 'videos', req, deps()).map((r) => r.id);
  assert.ok(ids.includes('v1'), 'the Dune video matches');
  assert.ok(!ids.includes('v2'), 'the unrelated video is excluded');
});

test('normalized shape: resultType/kind/title/identityText/recency per type', () => {
  const byType = {};
  for (const r of runSearch('dune', 'all', req, deps())) byType[r.resultType] = byType[r.resultType] || r;
  assert.strictEqual(byType.video.kind, undefined, 'video is the media path (no kind)');
  assert.strictEqual(byType.audio.resultType, 'audio');
  assert.strictEqual(byType.music.kind, 'track');
  assert.strictEqual(byType['podcast-show'].kind, 'podcast-show');
  assert.strictEqual(byType['podcast-episode'].kind, 'podcast', 'episodes reuse the existing podcast card kind');
  assert.strictEqual(byType['tv-show'].kind, 'tv-show');
  assert.strictEqual(byType['tv-episode'].kind, 'tv-episode');
  assert.strictEqual(byType.book.kind, 'book');
  assert.strictEqual(byType.book.title, 'Dune');
  assert.strictEqual(byType.book.identityText, 'Frank Herbert');
});

test('tv shows derive from VISIBLE episodes only, and both tv granularities appear', () => {
  const results = runSearch('dune', 'shows', req, deps());
  const types = results.map((r) => r.resultType);
  assert.ok(types.includes('tv-show'), 'a tv-show (Dune Prophecy) surfaces');
  assert.ok(types.includes('tv-episode'), 'a tv-episode (Dune Reference) surfaces');
});

test('chip filter narrows to one chip; all blends every provider', () => {
  const music = runSearch('dune', 'music', req, deps());
  assert.ok(music.every((r) => r.resultType === 'music'), 'music chip -> only music');
  const all = runSearch('dune', 'all', req, deps());
  const kinds = new Set(all.map((r) => r.resultType));
  assert.ok(kinds.size >= 5, `all blends many types, saw ${[...kinds]}`);
});

test('podcast episodes: ONLY downloaded ones surface (pending/trashed/tombstone never - gate WARNING 1)', () => {
  const ids = runSearch('dune', 'podcasts', req, deps()).map((r) => r.id);
  assert.ok(ids.includes('e1'), 'a downloaded episode surfaces');
  assert.ok(!ids.includes('ePending'), 'a pending episode (never on disk) is excluded');
  assert.ok(!ids.includes('eTrashed'), 'a user-deleted (trashed) episode never resurfaces its title');
});

test('recency uses toRecency: ISO-string addedAt orders newest-first within a tier (gate WARNING 2)', () => {
  // Two exact-title music hits with ISO-string addedAt (the real store shape).
  // IDs are chosen so lexical order OPPOSES recency (the gate's presence-not-
  // binding note): 'trkAA' is OLDER, 'trkZZ' is NEWER. Recency-desc must give
  // [trkZZ, trkAA]; the OLD Number(ISO)->0 code zeroes both -> id-asc ->
  // [trkAA, trkZZ], the opposite, so this test genuinely reds without the fix.
  const d = deps();
  d.db.music.tracks = {
    trkAA: { id: 'trkAA', title: 'Zephyr', artist: 'A', filePath: '/mu/o', addedAt: '2024-01-01T00:00:00Z' },
    trkZZ: { id: 'trkZZ', title: 'Zephyr', artist: 'B', filePath: '/mu/n', addedAt: '2026-08-01T00:00:00Z' },
  };
  const ids = runSearch('zephyr', 'music', req, d).map((r) => r.id);
  assert.deepStrictEqual(ids, ['trkZZ', 'trkAA'], 'newer ISO addedAt first, opposing the id-tiebreak that the zeroed-recency bug fell through to');
});

test('empty/whitespace query -> [] (no full-library dump)', () => {
  for (const q of ['', '   ']) {
    assert.deepStrictEqual(runSearch(q, 'all', req, deps()), [], `q=${JSON.stringify(q)}`);
  }
});

test('normalizeChip: unknown -> all', () => {
  assert.strictEqual(normalizeChip('videos'), 'videos');
  assert.strictEqual(normalizeChip('bogus'), 'all');
  assert.strictEqual(normalizeChip(undefined), 'all');
});

test('blended ranking: an exact-title book outranks a substring-title video (cross-type)', () => {
  // 'dune' -> book 'Dune' (tier 0) must precede video 'Dune Trailer' (tier 1).
  const out = runSearch('dune', 'all', req, deps());
  const bookIdx = out.findIndex((r) => r.id === 'b1');
  const vidIdx = out.findIndex((r) => r.id === 'v1');
  assert.ok(bookIdx >= 0 && vidIdx >= 0 && bookIdx < vidIdx, `exact book (b1@${bookIdx}) before prefix video (v1@${vidIdx})`);
});
