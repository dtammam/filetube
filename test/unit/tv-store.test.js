'use strict';

// [UNIT] v1.195 TV Shows: the `db.tv` namespace owner (lib/tv/store.js). Binds the
// ensure/read shapes and the prune policy (mount-loss + errored-subtree guards),
// mirroring music-store.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const { ensureTv, readTv, selectPrunableEpisodeIds } = require('../../lib/tv/store.js');

// ---- ensureTv ---------------------------------------------------------------

test('ensureTv: backfills a missing/broken namespace to the well-formed shape', () => {
  const empty = {};
  assert.deepStrictEqual(ensureTv(empty), { folders: [], episodes: {}, settings: {} });
  assert.deepStrictEqual(empty.tv, { folders: [], episodes: {}, settings: {} }, 'mutates the db in place');

  assert.deepStrictEqual(ensureTv({ tv: null }).folders, []);
  assert.deepStrictEqual(ensureTv({ tv: [] }), { folders: [], episodes: {}, settings: {} }, 'an array is not a namespace');

  const partial = { tv: { folders: ['/a'] } };
  const out = ensureTv(partial);
  assert.deepStrictEqual(out.folders, ['/a'], 'a present key is left untouched');
  assert.deepStrictEqual(out.episodes, {}, 'missing sub-keys backfilled');
  assert.deepStrictEqual(out.settings, {});
});

test('ensureTv: a well-formed namespace is returned by reference, not replaced', () => {
  const db = { tv: { folders: ['/x'], episodes: { e1: { id: 'e1' } }, settings: { pruneMissing: true } } };
  const before = db.tv;
  const out = ensureTv(db);
  assert.strictEqual(out, before, 'same object reference (no needless churn)');
  assert.deepStrictEqual(out.episodes, { e1: { id: 'e1' } });
});

// ---- readTv (non-mutating) --------------------------------------------------

test('readTv: never writes the passed object (the read-cache invariant)', () => {
  const cached = {};
  const view = readTv(cached);
  assert.deepStrictEqual(view, { folders: [], episodes: {}, settings: {} });
  assert.deepStrictEqual(cached, {}, 'the cached db object is NOT mutated (unlike ensureTv)');

  assert.deepStrictEqual(readTv({ tv: 'garbage' }), { folders: [], episodes: {}, settings: {} });
  assert.deepStrictEqual(readTv(null), { folders: [], episodes: {}, settings: {} });
  const good = { tv: { folders: ['/a'], episodes: { e: 1 }, settings: { s: 1 } } };
  assert.deepStrictEqual(readTv(good).folders, ['/a']);
});

// ---- selectPrunableEpisodeIds ----------------------------------------------

const EPISODES = {
  keep: { id: 'keep', filePath: '/tv/House/Season 1/a.mkv', rootFolder: '/tv' },
  gone: { id: 'gone', filePath: '/tv/House/Season 1/b.mkv', rootFolder: '/tv' },
  unmounted: { id: 'unmounted', filePath: '/mnt/x/c.mkv', rootFolder: '/mnt/x' },
  errored: { id: 'errored', filePath: '/tv/House/Locked/d.mkv', rootFolder: '/tv' },
};

test('selectPrunableEpisodeIds: pruneMissing OFF prunes NOTHING (default-safe)', () => {
  assert.deepStrictEqual(selectPrunableEpisodeIds(EPISODES, new Set(['keep']), { pruneMissing: false }), []);
  assert.deepStrictEqual(selectPrunableEpisodeIds(EPISODES, new Set(['keep']), {}), [], 'unset === off');
});

test('selectPrunableEpisodeIds: ON prunes only the missing, guarding mount-loss + errored subtrees', () => {
  const surviving = new Set(['keep']); // only "keep" was found this walk
  const prunable = selectPrunableEpisodeIds(EPISODES, surviving, {
    pruneMissing: true,
    missingRoots: new Set(['/mnt/x']),     // unmounted root -> its episode is spared
    erroredDirs: ['/tv/House/Locked'],     // errored subtree -> its episode is spared
  });
  assert.deepStrictEqual(prunable.sort(), ['gone'],
    'only the genuinely-vanished file prunes; unmounted + errored are conserved');
});

test('selectPrunableEpisodeIds: a survivor is never prunable even if its root is missing', () => {
  const prunable = selectPrunableEpisodeIds(EPISODES, new Set(['keep', 'gone', 'unmounted', 'errored']), {
    pruneMissing: true, missingRoots: new Set(['/tv']),
  });
  assert.deepStrictEqual(prunable, [], 'everything survived this walk -> nothing to prune');
});
