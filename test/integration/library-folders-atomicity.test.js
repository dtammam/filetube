'use strict';

// [INTEGRATION] Wave 4 of the relational-migration arc (second group) - the
// folder config lives in three tables and every write rides the doc commit.
// Adopted from the adversarial seat's pass-A probes (its mutant "both
// replaceAlls hoisted out of inSaveTransaction" survived 106 tests - only a
// regex noticed). Through the REAL route and mutator seam:
//   - POST /api/config whose doc save FAILS leaves BOTH library_folders and
//     library_folder_settings at their prior state (order included); the
//     committed POST changes both;
//   - a throw inside the SECOND replaceAll rolls back the FIRST - the list is
//     never left wiped with the map unwritten; the chain stays alive;
//   - the route can never hand replaceAll an exact duplicate: two spellings
//     that resolve alike keep the FIRST submitted spelling, and the settings
//     entry is re-keyed to it;
//   - a NUL-bearing folder / settings key never reaches a store (dropped or
//     4xx, never a 500 / a hung handler);
//   - POST /api/folders/display-name (the manual rename, in-transaction since
//     Wave 4) under a FAILED save leaves the map untouched; the clean write
//     lands; a clear under a failed save keeps the row;
//   - the notifications seed stamp (a settings row written in-transaction)
//     under a FAILED save is not stamped; the clean call stamps once.

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  app, __resetDatabaseForTests, __failNextSaveForTests, updateDatabase, inSaveTransaction,
  folderStore, folderSettingsStore, folderDisplayNameStore, settingsStore, seedNotificationHistoryOnce, getMediaId,
} = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

const NUL = String.fromCharCode(0);
let server;
let base;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});
after(async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); });
beforeEach(() => __resetDatabaseForTests());

const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const mk = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rec = (name) => ({ name, hidden: false, hiddenFromSidebar: false });
const withTimeout = (p, ms = 4000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no response within ${ms}ms (the handler hung)`)), ms))]);

test('POST /api/config: a FAILED doc save leaves BOTH the list (order included) and the map at their prior state; the committed POST changes both', async () => {
  const A = mk('ft-cfg-a-'); const B = mk('ft-cfg-b-'); const C = mk('ft-cfg-c-');
  seedState({ folders: [B, A], folderSettings: { [A]: rec('AA') }, metadata: {} });
  assert.deepStrictEqual(folderStore.list(), [B, A], 'populated');
  __failNextSaveForTests(new Error('simulated save failure'));
  const failed = await post('/api/config', { folders: [C], folderSettings: { [C]: { name: 'CC' } } });
  assert.strictEqual(failed.status, 500, await failed.text());
  assert.deepStrictEqual(folderStore.list(), [B, A], 'the list survived the failed save, in order');
  assert.deepStrictEqual(folderSettingsStore.getAll(), { [A]: rec('AA') }, 'the map survived the failed save');
  const p = readPersistedDatabase(DATA_DIR);
  assert.deepStrictEqual(p.folders, [B, A]);
  assert.deepStrictEqual(p.folderSettings, { [A]: rec('AA') });
  assert.deepStrictEqual((await (await fetch(`${base}/api/config`)).json()).folders, [B, A], 'GET agrees');

  const ok = await post('/api/config', { folders: [C, A], folderSettings: { [C]: { name: 'CC' }, [A]: { name: 'AA2', hidden: true } } });
  assert.strictEqual(ok.status, 200, await ok.text());
  assert.deepStrictEqual(folderStore.list(), [C, A]);
  assert.deepStrictEqual(folderSettingsStore.getAll(), { [C]: rec('CC'), [A]: { ...rec('AA2'), hidden: true } });
});

test('a throw inside the SECOND replaceAll rolls back the FIRST - the list is never left wiped with the map unwritten; the chain stays alive', async () => {
  const A = mk('ft-cfg-d-'); const B = mk('ft-cfg-e-');
  seedState({ folders: [A], folderSettings: { [A]: rec('AA') }, metadata: {} });
  await assert.rejects(updateDatabase(() => {
    inSaveTransaction(() => {
      folderStore.replaceAll([B]);
      folderSettingsStore.replaceAll({ ['x' + NUL + 'y']: rec('n') }); // the key the store refuses
    });
    return true;
  }), /U\+0000/);
  assert.deepStrictEqual(folderStore.list(), [A], 'the first replaceAll was rolled back with the second');
  assert.deepStrictEqual(folderSettingsStore.getAll(), { [A]: rec('AA') });
  const ok = await post('/api/config', { folders: [B], folderSettings: {} });
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(folderStore.list(), [B], 'the chain is alive');
});

test('the route never hands replaceAll a duplicate: spellings that resolve alike keep the FIRST submitted spelling and the settings key follows it; a NUL-bearing folder / key is dropped, never a 500', async () => {
  const A = mk('ft-cfg-f-');
  const withSlash = A + path.sep;
  const withDot = path.join(A, '.');
  const r = await post('/api/config', { folders: [withSlash, A, withDot, `  ${A}  `], folderSettings: { [A]: { name: 'N' }, [withDot]: { name: 'DOT' } } });
  assert.strictEqual(r.status, 200, await r.text());
  assert.deepStrictEqual(folderStore.list(), [withSlash], 'first spelling wins, stored as submitted (trimmed)');
  assert.deepStrictEqual(Object.keys(folderSettingsStore.getAll()), [withSlash], 'the settings key is re-spelled to the surviving spelling');
  assert.strictEqual(folderSettingsStore.getAll()[withSlash].name, 'DOT', 'the LAST entry for the root wins');
  const r2 = await withTimeout(post('/api/config', { folders: [A + NUL + 'x', A], folderSettings: { [A + NUL]: { name: 'nul' }, [A]: { name: 'ok' } } }));
  assert.strictEqual(r2.status, 200, await r2.text());
  assert.deepStrictEqual(folderStore.list(), [A], 'the NUL path never existed on disk - dropped by the route');
  assert.deepStrictEqual(Object.keys(folderSettingsStore.getAll()), [A]);
  assert.strictEqual((await withTimeout(post('/api/config', { folders: 'nope' }))).status, 400);
});

test('POST /api/folders/display-name: a FAILED save leaves the map untouched (set and clear); the clean write lands', async () => {
  const root = mk('ft-cfg-dn-');
  const filePath = path.join(root, 'Chan', 'a.mp4');
  fs.mkdirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, 'bytes');
  const id = getMediaId(filePath);
  seedState({
    folders: [root], folderSettings: {}, folderDisplayNames: { Chan: 'Old Name' },
    metadata: { [id]: { id, name: 'a.mp4', title: 'a', filePath, folderName: 'Chan', rootFolder: root, size: 5, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 10 } },
  });
  __failNextSaveForTests(new Error('simulated save failure'));
  const failed = await post('/api/folders/display-name', { folderName: 'Chan', name: 'New Name' });
  assert.strictEqual(failed.status, 500, await failed.text());
  assert.deepStrictEqual(folderDisplayNameStore.getAll(), { Chan: 'Old Name' }, 'a failed rename wrote nothing');
  const ok = await post('/api/folders/display-name', { folderName: 'Chan', name: 'New Name' });
  assert.strictEqual(ok.status, 200, await ok.text());
  assert.deepStrictEqual(folderDisplayNameStore.getAll(), { Chan: 'New Name' });
  __failNextSaveForTests(new Error('simulated save failure'));
  const failedClear = await post('/api/folders/display-name', { folderName: 'Chan', name: '' });
  assert.strictEqual(failedClear.status, 500);
  assert.deepStrictEqual(folderDisplayNameStore.getAll(), { Chan: 'New Name' }, 'a failed clear kept the row');
  const cleared = await post('/api/folders/display-name', { folderName: 'Chan', name: '' });
  assert.strictEqual(cleared.status, 200);
  assert.deepStrictEqual(folderDisplayNameStore.getAll(), {});
  const nul = await withTimeout(post('/api/folders/display-name', { folderName: 'Ch' + NUL + 'an', name: 'x' }));
  assert.ok(nul.status === 404 || nul.status === 400, `a NUL folder name is a 4xx, never a hang (got ${nul.status})`);
});

test('the notifications seed stamp: a FAILED save leaves it unstamped (the seed runs again); the clean call stamps once', async () => {
  seedState({ folders: [], folderSettings: {}, metadata: {} });
  assert.strictEqual(settingsStore.getKey('notificationsSeededAt'), undefined, 'populate: unstamped');
  __failNextSaveForTests(new Error('simulated save failure'));
  await assert.rejects(seedNotificationHistoryOnce(1234), /simulated save failure/);
  assert.strictEqual(settingsStore.getKey('notificationsSeededAt'), undefined, 'a failed save did not stamp');
  await seedNotificationHistoryOnce(1234);
  assert.strictEqual(settingsStore.getKey('notificationsSeededAt'), 1234, 'the clean call stamped');
  await seedNotificationHistoryOnce(9999);
  assert.strictEqual(settingsStore.getKey('notificationsSeededAt'), 1234, 'once');
});
