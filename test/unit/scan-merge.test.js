'use strict';

// [UNIT] Wave 6 (scan extraction) -- lib/scan/merge.js, required DIRECTLY:
//
//   - selectPrunableIds: the six ordered keep-guards that decide which
//     non-surviving ids a scan may reap (mount loss, unattributable root,
//     incomplete enumeration, and the pruneMissing toggle).
//   - mergeScannedMetadata: newMetadata is authoritative for MEMBERSHIP and
//     for every scan-derived field, EXCEPT lastServedAt, which only ever
//     advances (a serve recorded mid-scan is never reverted).
//
// The data-loss end of this behaviour is covered end-to-end by the prune and
// vanished-roots integration suites; these are the small per-branch cases.

const { test } = require('node:test');
const assert = require('node:assert');

const { selectPrunableIds, mergeScannedMetadata } = require('../../lib/scan/merge');

// ---- selectPrunableIds ------------------------------------------------------

const entry = (filePath, rootFolder) => ({ filePath, rootFolder });
const OPTS = (over) => Object.assign({
  missingRoots: [],
  unreadablePaths: [],
  folders: ['/media'],
  pruneMissing: true,
}, over || {});

test('selectPrunableIds (1): an id whose file SURVIVED on disk is never pruned', () => {
  const old = { keep: entry('/media/a.mp4', '/media') };
  assert.deepStrictEqual(selectPrunableIds(old, new Set(['keep']), OPTS()), []);
  // An array of surviving ids is accepted exactly like a Set.
  assert.deepStrictEqual(selectPrunableIds(old, ['keep'], OPTS()), []);
});

test('selectPrunableIds (2): MOUNT-LOSS - a missing root protects its ids at any depth', () => {
  const old = { gone: entry('/media/deep/nested/a.mp4', '/media') };
  assert.deepStrictEqual(selectPrunableIds(old, new Set(), OPTS({ missingRoots: ['/media'] })), []);
  assert.deepStrictEqual(selectPrunableIds(old, new Set(), OPTS({ missingRoots: new Set(['/media']) })), []);
});

test('selectPrunableIds (2): the mount-loss guard also fires for a LEGACY entry with no rootFolder', () => {
  const old = { gone: { filePath: '/media/a.mp4' } };
  assert.deepStrictEqual(selectPrunableIds(old, new Set(), OPTS({ missingRoots: ['/media'] })), [],
    'the root is derived via matchRootFolder for pre-backfill entries');
});

test('selectPrunableIds (3): a LEGACY entry whose derived root is null is retained (unattributable)', () => {
  const old = { orphan: { filePath: '/unconfigured/a.mp4' } }; // no rootFolder, no matching folder
  assert.deepStrictEqual(selectPrunableIds(old, new Set(), OPTS()), []);
  // ... and an entry with neither a filePath nor a rootFolder at all.
  assert.deepStrictEqual(selectPrunableIds({ blank: {} }, new Set(), OPTS()), []);
});

test('selectPrunableIds (3) is about a NULL root, not an un-configured one: an entry that still CARRIES a rootFolder removed from Settings prunes normally', () => {
  // detectVanishedRoots' own comment names this as the deliberate escape hatch
  // for a protected-but-emptied folder: drop it from Settings and its stale
  // entries fall through to normal pruning. Binding it here keeps guard (3)
  // from being quietly widened into "any root not in `folders`".
  const old = { stale: entry('/unconfigured/a.mp4', '/unconfigured') };
  assert.deepStrictEqual(selectPrunableIds(old, new Set(), OPTS({ folders: ['/media'] })), ['stale']);
});

test('selectPrunableIds (4): an unreadable-path PREFIX protects its whole subtree, at any depth', () => {
  const old = {
    shallow: entry('/media/sub/a.mp4', '/media'),
    deep: entry('/media/sub/x/y/z/b.mp4', '/media'),
    outside: entry('/media/other/c.mp4', '/media'),
  };
  const prunable = selectPrunableIds(old, new Set(), OPTS({ unreadablePaths: ['/media/sub'] }));
  assert.deepStrictEqual(prunable, ['outside'],
    'a swallowed readdir/stat error anywhere in that subtree must never read as a bulk deletion');
});

test('selectPrunableIds (4): the unreadable path may name the FILE itself', () => {
  const old = { one: entry('/media/a.mp4', '/media') };
  assert.deepStrictEqual(selectPrunableIds(old, new Set(), OPTS({ unreadablePaths: ['/media/a.mp4'] })), []);
});

test('selectPrunableIds (5): pruneMissing OFF retains every stale entry', () => {
  const old = { gone: entry('/media/a.mp4', '/media') };
  assert.deepStrictEqual(selectPrunableIds(old, new Set(), OPTS({ pruneMissing: false })), []);
});

test('selectPrunableIds (6): present + readable root + file gone + prune ON -> pruned', () => {
  const old = {
    gone: entry('/media/a.mp4', '/media'),
    alive: entry('/media/b.mp4', '/media'),
  };
  assert.deepStrictEqual(selectPrunableIds(old, new Set(['alive']), OPTS()), ['gone']);
});

test('selectPrunableIds: every guard holds BEFORE the toggle - each one alone keeps the id with prune ON', () => {
  const old = { gone: entry('/media/a.mp4', '/media') };
  const guards = [
    OPTS({ missingRoots: ['/media'] }),
    OPTS({ unreadablePaths: ['/media'] }),
  ];
  for (const opts of guards) {
    assert.deepStrictEqual(selectPrunableIds(old, new Set(), opts), [],
      `pruneMissing is ON here: the guard must not depend on the toggle (${JSON.stringify(opts)})`);
  }
  // With no guard armed the SAME input is prunable - so the assertions above
  // are about the guards, not about an input that could never be pruned.
  assert.deepStrictEqual(selectPrunableIds(old, new Set(), OPTS()), ['gone']);
});

test('selectPrunableIds: a missing opts object degrades to "keep everything" (no toggle, no folders)', () => {
  const old = { gone: entry('/media/a.mp4', '/media') };
  assert.deepStrictEqual(selectPrunableIds(old, new Set(), undefined), [],
    'pruneMissing is undefined -> falsy -> guard (5) retains');
});

// ---- mergeScannedMetadata ---------------------------------------------------

test('mergeScannedMetadata: a NEWER on-disk lastServedAt is adopted (a mid-scan serve is not reverted)', () => {
  const scanStart = Date.now() - 60_000; // dynamic, never a near-today literal
  const midScan = scanStart + 30_000;
  const fresh = { v1: { lastServedAt: midScan } };
  const scanned = { v1: { title: 'a', lastServedAt: scanStart } };
  const out = mergeScannedMetadata(fresh, scanned);
  assert.strictEqual(out.v1.lastServedAt, midScan);
  assert.strictEqual(out.v1.title, 'a', 'every other field stays the scan\'s');
});

test('mergeScannedMetadata: an OLDER on-disk lastServedAt never regresses the scan\'s value', () => {
  const now = Date.now();
  const fresh = { v1: { lastServedAt: now - 90_000 } };
  const scanned = { v1: { lastServedAt: now } };
  assert.strictEqual(mergeScannedMetadata(fresh, scanned).v1.lastServedAt, now);
});

test('mergeScannedMetadata: an on-disk timestamp fills in when the scan has none', () => {
  const served = Date.now() - 10_000;
  const out = mergeScannedMetadata({ v1: { lastServedAt: served } }, { v1: { title: 'a' } });
  assert.strictEqual(out.v1.lastServedAt, served);
});

test('mergeScannedMetadata: a non-numeric on-disk value is ignored', () => {
  const out = mergeScannedMetadata({ v1: { lastServedAt: 'yesterday' } }, { v1: { title: 'a' } });
  assert.strictEqual(out.v1.lastServedAt, undefined);
});

test('mergeScannedMetadata: newMetadata is AUTHORITATIVE for membership - a pruned id stays pruned', () => {
  const fresh = { pruned: { lastServedAt: Date.now() }, v1: {} };
  const out = mergeScannedMetadata(fresh, { v1: {} });
  assert.deepStrictEqual(Object.keys(out), ['v1'],
    'the merge must not resurrect an id the scan decided to prune');
});

test('mergeScannedMetadata: mutates and RETURNS newMetadata (the call site assigns the result)', () => {
  const scanned = { v1: {} };
  assert.strictEqual(mergeScannedMetadata({}, scanned), scanned);
});

test('mergeScannedMetadata: an id absent from the fresh read is left untouched', () => {
  const scanned = { brandNew: { title: 'n' } };
  const out = mergeScannedMetadata({}, scanned);
  assert.deepStrictEqual(out, { brandNew: { title: 'n' } });
});
