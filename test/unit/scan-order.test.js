'use strict';

// [UNIT] v1.94.1 - orderScannedByRecency: the scan processes files NEWEST-first
// so the default home view (recency-ordered) gets its sidecars generated first.
// Divergent fixtures: the input order is deliberately NOT the expected output
// order, so a missing/reversed sort fails.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scanorder-'));

const { test } = require('node:test');
const assert = require('node:assert');
const { orderScannedByRecency, getMediaId } = require('../../server');

test('orders by fileInfo.addedAt DESC when the db has no record', () => {
  // input order (a,b,c) is NOT the recency order, so this binds the sort.
  const files = new Map([
    ['/m/a.mp4', { addedAt: 100, ext: '.mp4' }],
    ['/m/b.mp4', { addedAt: 300, ext: '.mp4' }],
    ['/m/c.mp4', { addedAt: 200, ext: '.mp4' }],
  ]);
  const ordered = orderScannedByRecency(files, {});
  assert.deepStrictEqual(ordered.map(e => e.fp), ['/m/b.mp4', '/m/c.mp4', '/m/a.mp4'], '300,200,100');
  // carries the fileInfo through unchanged (the loop destructures fileInfo).
  assert.strictEqual(ordered[0].fileInfo.addedAt, 300);
});

test('the PERSISTED addedAt (home sort key) wins over a new file`s derived addedAt', () => {
  const xId = getMediaId('/m/x.mp4');
  const metadata = { [xId]: { addedAt: 999 } }; // x was added long-known as newest
  const files = new Map([
    ['/m/x.mp4', { addedAt: 1 }],   // stale walk-time addedAt - must be ignored
    ['/m/y.mp4', { addedAt: 500 }], // new file, db doesn't know it
  ]);
  const ordered = orderScannedByRecency(files, metadata);
  assert.strictEqual(ordered[0].fp, '/m/x.mp4', 'x wins on its persisted addedAt 999, not its info.addedAt 1');
});

test('falls back to mtime, then 0, when no addedAt exists', () => {
  const files = new Map([
    ['/m/nomtime.mp4', {}],                 // recency 0 -> last
    ['/m/mtimeonly.mp4', { mtimeMs: 42 }],  // recency 42
    ['/m/added.mp4', { addedAt: 10 }],       // recency 10
  ]);
  const ordered = orderScannedByRecency(files, {});
  assert.deepStrictEqual(ordered.map(e => e.fp), ['/m/mtimeonly.mp4', '/m/added.mp4', '/m/nomtime.mp4'], '42,10,0');
});

test('empty / junk metadata is tolerated (never throws)', () => {
  const files = new Map([['/m/a.mp4', { addedAt: 5 }]]);
  assert.strictEqual(orderScannedByRecency(files, null)[0].fp, '/m/a.mp4');
  assert.strictEqual(orderScannedByRecency(new Map(), {}).length, 0);
});
