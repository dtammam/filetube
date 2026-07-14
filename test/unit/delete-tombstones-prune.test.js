'use strict';

// [UNIT] v1.41.3: pruneDeleteTombstones -- the growth bounds of the deletion
// tombstone map (age-out + FIFO cap + malformed-entry hygiene). Pure/in-place;
// `now` injected (near-today literals rot -- the v1.37.0 lesson).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tomb-prune-'));

const { test } = require('node:test');
const assert = require('node:assert');
const { pruneDeleteTombstones, DELETE_TOMBSTONE_CAP, DELETE_TOMBSTONE_MAX_AGE_MS } = require('../../server');

const NOW = 1_800_000_000_000; // fixed epoch-ms anchor; every age below is an offset

test('entries older than the max age are dropped; fresh ones survive', () => {
  const t = {
    old: { filePath: '/a', deletedAt: NOW - DELETE_TOMBSTONE_MAX_AGE_MS - 1 },
    fresh: { filePath: '/b', deletedAt: NOW - 1000 },
  };
  pruneDeleteTombstones(t, NOW);
  assert.deepStrictEqual(Object.keys(t), ['fresh']);
});

test('malformed entries (missing/typo deletedAt) are dropped', () => {
  const t = {
    a: null,
    b: { filePath: '/b' },
    c: { filePath: '/c', deletedAt: 'yesterday' },
    ok: { filePath: '/ok', deletedAt: NOW },
  };
  pruneDeleteTombstones(t, NOW);
  assert.deepStrictEqual(Object.keys(t), ['ok']);
});

test('FIFO cap: oldest entries beyond the cap are evicted, newest kept', () => {
  const t = {};
  const total = DELETE_TOMBSTONE_CAP + 25;
  for (let i = 0; i < total; i++) {
    // i=0 oldest ... i=total-1 newest, all within the age window.
    t[`id${i}`] = { filePath: `/f${i}`, deletedAt: NOW - (total - i) * 1000 };
  }
  pruneDeleteTombstones(t, NOW);
  const ids = Object.keys(t);
  assert.strictEqual(ids.length, DELETE_TOMBSTONE_CAP);
  assert.ok(!t.id0 && !t.id24, 'the 25 oldest evicted');
  assert.ok(t.id25 && t[`id${total - 1}`], 'newest survivors intact');
});

test('at or under the cap, nothing is evicted', () => {
  const t = {};
  for (let i = 0; i < DELETE_TOMBSTONE_CAP; i++) {
    t[`id${i}`] = { filePath: `/f${i}`, deletedAt: NOW - i };
  }
  pruneDeleteTombstones(t, NOW);
  assert.strictEqual(Object.keys(t).length, DELETE_TOMBSTONE_CAP);
});
