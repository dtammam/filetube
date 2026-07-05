'use strict';

// Isolated DATA_DIR before requiring the server (own process per test file), so
// TRANSCODE_DIR resolves under a disposable dir and no real data is touched.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));

const { test } = require('node:test');
const assert = require('node:assert');
const {
  scanIntervalMs,
  selectAgedOut,
  selectPrunableIds,
  mergeScannedMetadata,
  transcodeCacheSize,
  effectiveCacheCap,
  TRANSCODE_CACHE_MAX_BYTES,
} = require('../../server');

// ---- scanIntervalMs ----

test('scanIntervalMs: 0 means Off -> null', () => {
  assert.equal(scanIntervalMs(0), null);
});

test('scanIntervalMs: each recognized minute value maps to the right ms', () => {
  assert.equal(scanIntervalMs(30), 1800000);
  assert.equal(scanIntervalMs(60), 3600000);
  assert.equal(scanIntervalMs(360), 21600000);
  assert.equal(scanIntervalMs(720), 43200000);
  assert.equal(scanIntervalMs(1440), 86400000);
});

test('scanIntervalMs: unrecognized/missing/negative values fall back to the 30m default', () => {
  for (const bad of [undefined, null, 15, 45, -30, 999999]) {
    assert.equal(scanIntervalMs(bad), 1800000, `${bad} should fall back to 30m default`);
  }
});

// ---- selectAgedOut ----

const af = (p, extra) => ({ path: p, ...extra });

test('selectAgedOut: D3 invariant - a fresh lastServedAt beats a stale atimeMs (not aged out)', () => {
  const now = 1_000_000_000_000;
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
  const files = [
    af('/data/transcoded/a.mp4', { lastServedAt: now - 1000, atimeMs: now - (60 * 24 * 60 * 60 * 1000) }),
  ];
  // atimeMs alone (60 days old) would be aged out under a 30-day cutoff, but the
  // recorded lastServedAt (1 second ago) is authoritative and must win.
  assert.deepEqual(selectAgedOut(files, maxAgeMs, now), []);
});

test('selectAgedOut: falls back to atimeMs when lastServedAt is absent', () => {
  const now = 1_000_000_000_000;
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
  const stale = af('/data/transcoded/stale.mp4', { atimeMs: now - (60 * 24 * 60 * 60 * 1000) });
  const fresh = af('/data/transcoded/fresh.mp4', { atimeMs: now - 1000 });
  assert.deepEqual(selectAgedOut([stale, fresh], maxAgeMs, now), ['/data/transcoded/stale.mp4']);
});

test('selectAgedOut: never returns a *.tmp.mp4 path even if it looks aged out', () => {
  const now = 1_000_000_000_000;
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
  const tmp = af('/data/transcoded/busy.tmp.mp4', { atimeMs: now - (60 * 24 * 60 * 60 * 1000) });
  assert.deepEqual(selectAgedOut([tmp], maxAgeMs, now), []);
});

test('selectAgedOut: never returns a protectedPaths member (single, array, or Set)', () => {
  const now = 1_000_000_000_000;
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
  const old = { atimeMs: now - (60 * 24 * 60 * 60 * 1000) };
  const single = af('/a.mp4', old);
  const viaArray = af('/b.mp4', old);
  const viaSet = af('/c.mp4', old);

  assert.deepEqual(selectAgedOut([single], maxAgeMs, now, '/a.mp4'), []);
  assert.deepEqual(selectAgedOut([viaArray], maxAgeMs, now, ['/b.mp4']), []);
  assert.deepEqual(selectAgedOut([viaSet], maxAgeMs, now, new Set(['/c.mp4'])), []);
});

test('selectAgedOut: maxAgeMs of 0/falsy returns [] (retention Off)', () => {
  const now = 1_000_000_000_000;
  const old = af('/a.mp4', { atimeMs: now - (365 * 24 * 60 * 60 * 1000) });
  assert.deepEqual(selectAgedOut([old], 0, now), []);
  assert.deepEqual(selectAgedOut([old], null, now), []);
  assert.deepEqual(selectAgedOut([old], undefined, now), []);
});

// ---- selectPrunableIds ----
// New options-object contract: selectPrunableIds(oldMetadata, survivingIds,
// { missingRoots, unreadablePaths, folders, pruneMissing }).

test('selectPrunableIds: MOUNT-LOSS GUARD - an entry under a missing root is retained regardless of the toggle', () => {
  const oldMetadata = {
    id1: { rootFolder: '/mnt/movies' },
  };
  // pruneMissing true would normally prune a gone file, but /mnt/movies is
  // entirely missing (unmounted) at scan time -> guard must retain it anyway.
  assert.deepEqual(
    selectPrunableIds(oldMetadata, [], { missingRoots: ['/mnt/movies'], pruneMissing: true }),
    []
  );
  // Also holds with pruneMissing false (redundant but confirms guard fires first).
  assert.deepEqual(
    selectPrunableIds(oldMetadata, [], { missingRoots: ['/mnt/movies'], pruneMissing: false }),
    []
  );
});

test('selectPrunableIds: pruneMissing true + root present + file gone -> id IS pruned', () => {
  const oldMetadata = {
    id1: { rootFolder: '/mnt/movies' },
  };
  assert.deepEqual(
    selectPrunableIds(oldMetadata, [], { missingRoots: [], pruneMissing: true }),
    ['id1']
  );
});

test('selectPrunableIds: pruneMissing false + root present + file gone -> id NOT pruned', () => {
  const oldMetadata = {
    id1: { rootFolder: '/mnt/movies' },
  };
  assert.deepEqual(
    selectPrunableIds(oldMetadata, [], { missingRoots: [], pruneMissing: false }),
    []
  );
});

test('selectPrunableIds: a surviving id is never pruned', () => {
  const oldMetadata = {
    id1: { rootFolder: '/mnt/movies' },
    id2: { rootFolder: '/mnt/movies' },
  };
  assert.deepEqual(
    selectPrunableIds(oldMetadata, ['id1'], { missingRoots: [], pruneMissing: true }),
    ['id2']
  );
});

test('selectPrunableIds: accepts survivingIds/missingRoots/unreadablePaths as Sets as well as arrays', () => {
  const oldMetadata = {
    id1: { rootFolder: '/mnt/a' },
    id2: { rootFolder: '/mnt/b' },
  };
  assert.deepEqual(
    selectPrunableIds(oldMetadata, new Set(['id1']), {
      missingRoots: new Set(['/mnt/b']),
      unreadablePaths: new Set(),
      pruneMissing: true,
    }),
    []
  );
});

test('selectPrunableIds: (i) nested-mount drop - file under a PRESENT top root but its subdir is unreadable -> retained', () => {
  const oldMetadata = {
    id1: { rootFolder: '/mnt/movies', filePath: '/mnt/movies/nested/sub/gone.mp4' },
  };
  assert.deepEqual(
    selectPrunableIds(oldMetadata, [], {
      missingRoots: [], // /mnt/movies itself is present
      unreadablePaths: ['/mnt/movies/nested/sub'], // but this subdir could not be enumerated
      pruneMissing: true,
    }),
    [],
    'a file under an unreadable subtree must never be mistaken for a deletion, even under a present root'
  );
});

test('selectPrunableIds: (ii) unreadable-prefix retains at any depth, not just an exact-path match', () => {
  const oldMetadata = {
    id1: { rootFolder: '/mnt/movies', filePath: '/mnt/movies/a/b/c/d.mp4' },
    id2: { rootFolder: '/mnt/movies', filePath: '/mnt/movies/other/e.mp4' },
  };
  assert.deepEqual(
    selectPrunableIds(oldMetadata, [], {
      missingRoots: [],
      unreadablePaths: ['/mnt/movies/a'],
      pruneMissing: true,
    }),
    ['id2'],
    'only the entry under the unreadable prefix is retained; an unrelated present-root file still prunes'
  );
});

test('selectPrunableIds: (iii) legacy falsy-rootFolder entry under a missing/unresolvable root -> retained', () => {
  const oldMetadata = {
    id1: { rootFolder: null, filePath: '/mnt/legacy/old.mp4' }, // pre-backfill entry
  };
  assert.deepEqual(
    selectPrunableIds(oldMetadata, [], {
      missingRoots: ['/mnt/legacy'],
      folders: ['/mnt/legacy'],
      pruneMissing: true,
    }),
    [],
    'derived root (/mnt/legacy) is missing -> retained despite the falsy stored rootFolder'
  );
});

test('selectPrunableIds: (iii companion) legacy falsy-rootFolder entry under a PRESENT, attributable root + file gone -> pruned', () => {
  const oldMetadata = {
    id1: { rootFolder: null, filePath: '/mnt/present/old.mp4' },
  };
  assert.deepEqual(
    selectPrunableIds(oldMetadata, [], {
      missingRoots: [],
      folders: ['/mnt/present'],
      pruneMissing: true,
    }),
    ['id1'],
    'once a root can be attributed and is present, a legacy entry prunes like any other -- no over-retention'
  );
});

test('selectPrunableIds: an entry whose root cannot be attributed to any configured folder is retained (conservative)', () => {
  const oldMetadata = {
    id1: { rootFolder: null, filePath: '/somewhere/unrelated/old.mp4' },
  };
  assert.deepEqual(
    selectPrunableIds(oldMetadata, [], {
      missingRoots: [],
      folders: ['/mnt/present'], // does not match /somewhere/unrelated
      pruneMissing: true,
    }),
    []
  );
});

// ---- mergeScannedMetadata ----

test('mergeScannedMetadata: fresh lastServedAt newer than scanned -> adopts fresh (never regresses on-disk value)', () => {
  const freshMetadata = { id1: { lastServedAt: 2000 } };
  const newMetadata = { id1: { id: 'id1', lastServedAt: 1000 } };
  const merged = mergeScannedMetadata(freshMetadata, newMetadata);
  assert.equal(merged.id1.lastServedAt, 2000);
});

test('mergeScannedMetadata: scanned lastServedAt newer than fresh -> keeps scanned value', () => {
  const freshMetadata = { id1: { lastServedAt: 1000 } };
  const newMetadata = { id1: { id: 'id1', lastServedAt: 2000 } };
  const merged = mergeScannedMetadata(freshMetadata, newMetadata);
  assert.equal(merged.id1.lastServedAt, 2000);
});

test('mergeScannedMetadata: a new scanned entry with no prior fresh entry is unchanged', () => {
  const freshMetadata = {};
  const newMetadata = { id1: { id: 'id1', lastServedAt: 500 } };
  const merged = mergeScannedMetadata(freshMetadata, newMetadata);
  assert.deepEqual(merged, { id1: { id: 'id1', lastServedAt: 500 } });
});

test('mergeScannedMetadata: a fresh entry absent from newMetadata (pruned this scan) is omitted', () => {
  const freshMetadata = { id1: { lastServedAt: 1000 }, id2: { lastServedAt: 2000 } };
  const newMetadata = { id2: { id: 'id2', lastServedAt: 2000 } }; // id1 was pruned
  const merged = mergeScannedMetadata(freshMetadata, newMetadata);
  assert.deepEqual(Object.keys(merged), ['id2']);
});

test('mergeScannedMetadata: fresh entry has no lastServedAt -> scanned value (even absent) is left as-is', () => {
  const freshMetadata = { id1: {} };
  const newMetadata = { id1: { id: 'id1' } };
  const merged = mergeScannedMetadata(freshMetadata, newMetadata);
  assert.equal(merged.id1.lastServedAt, undefined);
});

// ---- transcodeCacheSize ----

test('transcodeCacheSize: sums non-.tmp.mp4 file sizes in a dir, excluding .tmp.mp4', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-size-'));
  fs.writeFileSync(path.join(dir, 'a.mp4'), Buffer.alloc(100));
  fs.writeFileSync(path.join(dir, 'b.mp4'), Buffer.alloc(250));
  fs.writeFileSync(path.join(dir, 'busy.tmp.mp4'), Buffer.alloc(9999));
  fs.writeFileSync(path.join(dir, 'ignored.txt'), Buffer.alloc(500));
  assert.equal(transcodeCacheSize(dir), 350);
});

test('transcodeCacheSize: returns 0 for a non-existent directory', () => {
  assert.equal(transcodeCacheSize('/no/such/dir/anywhere'), 0);
});

// ---- effectiveCacheCap ----

test('effectiveCacheCap: returns the UI cacheMaxBytes when it is a positive integer', () => {
  assert.equal(effectiveCacheCap({ cacheMaxBytes: 12345 }), 12345);
});

test('effectiveCacheCap: falls back to TRANSCODE_CACHE_MAX_BYTES for null/0/negative/absent', () => {
  assert.equal(effectiveCacheCap({ cacheMaxBytes: null }), TRANSCODE_CACHE_MAX_BYTES);
  assert.equal(effectiveCacheCap({ cacheMaxBytes: 0 }), TRANSCODE_CACHE_MAX_BYTES);
  assert.equal(effectiveCacheCap({ cacheMaxBytes: -100 }), TRANSCODE_CACHE_MAX_BYTES);
  assert.equal(effectiveCacheCap({}), TRANSCODE_CACHE_MAX_BYTES);
  assert.equal(effectiveCacheCap(undefined), TRANSCODE_CACHE_MAX_BYTES);
});
