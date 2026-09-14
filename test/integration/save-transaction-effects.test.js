'use strict';

// [INTEGRATION] Wave 2 of the relational-migration arc - the in-save-transaction
// hook (`inSaveTransaction`, server.js) that keeps a relational write ATOMIC
// with the doc commit it belongs to, through the REAL routes:
//   - a hard delete (metadata-only item, no trash move) mints its tombstone
//     and removes the frozen progress row in the SAME transaction as the
//     metadata removal: when that save is made to FAIL, nothing of the three
//     lands (the v1.41.3 "mint in the same mutator" contract, kept across two
//     tables) - populate first, then drive the failure axis;
//   - a mutator effect that throws rolls back the doc change it rode with;
//   - a mutator that queues effects and then returns false rejects loudly;
//   - inSaveTransaction outside a mutator tick throws;
//   - a mutator with NO doc change but an effect still commits the effect
//     (the move's destination-tombstone retirement shape).

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  app, loadDatabase, updateDatabase, __resetDatabaseForTests, __failNextSaveForTests,
  progressStore, tombstoneStore, inSaveTransaction,
} = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

let server;
let base;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => __resetDatabaseForTests());

const item = (id) => ({
  id, title: id, name: `${id}.mp4`, filePath: path.join(DATA_DIR, `${id}.mp4`), folderName: 'M',
  rootFolder: DATA_DIR, type: 'video', ext: '.mp4', duration: 10, size: 1, addedAt: 1,
});
const seed = (metadata) => seedState({
  folders: [DATA_DIR], folderSettings: {}, liked: [], metadata,
  settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30, trashRetentionDays: 30 },
});

test('hard delete: the tombstone mint + the progress removal ride the metadata removal\'s transaction - a FAILED save lands none of the three', async () => {
  seed({ gone1: item('gone1') }); // file absent on disk -> resolver `gone` -> the legacy mutator (tombstone path)
  progressStore.set('gone1', { timestamp: 7, duration: 10 });
  assert.strictEqual(tombstoneStore.size(), 0, 'precondition: no tombstone yet');

  __failNextSaveForTests(new Error('simulated save failure'));
  const failed = await fetch(`${base}/api/videos/gone1`, { method: 'DELETE' });
  assert.strictEqual(failed.status, 500, 'the delete reports the failed persist');
  const db = readPersistedDatabase(DATA_DIR);
  assert.ok(db.metadata && db.metadata.gone1, 'the entry is still there (doc rows untouched)');
  assert.strictEqual(tombstoneStore.size(), 0, 'NO tombstone was minted outside the failed transaction');
  assert.deepStrictEqual(progressStore.get('gone1'), { timestamp: 7, duration: 10 }, 'the progress row survived with its item');

  // The same delete, allowed to commit: all three change together.
  const ok = await fetch(`${base}/api/videos/gone1`, { method: 'DELETE' });
  assert.strictEqual(ok.status, 200, await ok.text());
  const after1 = readPersistedDatabase(DATA_DIR);
  assert.strictEqual(after1.metadata && after1.metadata.gone1, undefined, 'entry removed');
  assert.ok(tombstoneStore.get('gone1'), 'tombstone minted in the same commit');
  assert.strictEqual(tombstoneStore.get('gone1').filePath, path.join(DATA_DIR, 'gone1.mp4'));
  assert.strictEqual(progressStore.get('gone1'), undefined, 'the progress row went with the item');
});

test('a throwing in-save effect rolls back the doc change it rode with (and the chain stays alive)', async () => {
  seed({ v: item('v') });
  await assert.rejects(updateDatabase((db) => {
    db.metadata.v.title = 'changed';
    inSaveTransaction(() => { tombstoneStore.set('v', { filePath: '/x', deletedAt: 1 }); throw new Error('effect boom'); });
    return true;
  }), /effect boom/);
  assert.strictEqual(loadDatabase().metadata.v.title, 'v', 'the doc change rolled back');
  assert.strictEqual(tombstoneStore.has('v'), false, 'the relational write rolled back');
  // the chain is not wedged
  await updateDatabase((db) => { db.metadata.v.title = 'after'; return true; });
  assert.strictEqual(loadDatabase().metadata.v.title, 'after');
});

test('a mutator that queues effects but returns false rejects loudly (effects are never silently dropped); outside a mutator the hook throws', async () => {
  seed({ v: item('v') });
  await assert.rejects(updateDatabase(() => {
    inSaveTransaction(() => tombstoneStore.set('v', { filePath: '/x', deletedAt: 1 }));
    return false;
  }), /queued inSaveTransaction effects but returned false/);
  assert.strictEqual(tombstoneStore.has('v'), false);
  assert.throws(() => inSaveTransaction(() => {}), /only valid inside an updateDatabase mutator/);
});

test('a mutator with NO doc change and one effect still commits the effect (the destination-tombstone retirement shape)', async () => {
  seed({ v: item('v') });
  tombstoneStore.set('dest', { filePath: '/dest', deletedAt: 1 });
  const result = await updateDatabase(() => {
    if (!tombstoneStore.has('dest')) return false;
    inSaveTransaction(() => tombstoneStore.remove('dest'));
    return true;
  });
  assert.strictEqual(result, true);
  assert.strictEqual(tombstoneStore.has('dest'), false, 'retired inside a real transaction despite zero doc rows changing');
});
