'use strict';

// [INTEGRATION] Wave 4 of the relational-migration arc - the app settings live
// in app_settings (one row per key) behind settingsStore. Through the REAL
// routes:
//   - POST /api/settings whose doc save FAILS leaves the table exactly as it
//     was (the write rides inSaveTransaction) and answers 500; the same POST
//     allowed to commit writes ONLY the touched keys, GET reflects it, and an
//     untouched key keeps its row;
//   - the backup bundle carries `settings` as the MERGED object (defaults
//     included, as the doc snapshot did) and a restore round-trips it;
//   - a bundle WITHOUT `settings` restores to the defaults (the doc-model
//     semantics: the bundle is the whole state);
//   - a malformed `settings` (an array, an empty key) is a 400 BEFORE the wipe
//     - the live rows survive;
//   - a bundle with an out-of-set trashRetentionDays is still a 400 (the
//     pre-existing amplifier check).

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, __resetDatabaseForTests, __failNextSaveForTests, settingsStore } = require('../../server');
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
beforeEach(async () => {
  await __resetDatabaseForTests();
  seedState({ folders: [], folderSettings: {}, liked: [], metadata: {}, settings: { scanIntervalMinutes: 60, pruneMissing: false } });
});

const post = (body) => fetch(`${base}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const restore = (bundle) => fetch(`${base}/api/admin/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) });

test('POST /api/settings: a FAILED doc save leaves the table untouched and answers 500; a clean save writes only the touched keys', async () => {
  assert.deepStrictEqual(readPersistedDatabase(DATA_DIR).settings, { scanIntervalMinutes: 60, pruneMissing: false }, 'populated');
  __failNextSaveForTests(new Error('simulated save failure'));
  const failed = await post({ scanIntervalMinutes: 720 });
  assert.strictEqual(failed.status, 500, await failed.text());
  assert.deepStrictEqual(readPersistedDatabase(DATA_DIR).settings, { scanIntervalMinutes: 60, pruneMissing: false }, 'nothing was written outside the failed transaction');
  assert.strictEqual(settingsStore.getKey('scanIntervalMinutes'), 60, 'the live read agrees');

  const ok = await post({ scanIntervalMinutes: 720 });
  const body = await ok.json();
  assert.strictEqual(ok.status, 200, JSON.stringify(body));
  assert.strictEqual(body.scanIntervalMinutes, 720, 'the response carries the merged object');
  assert.strictEqual(body.pruneMissing, false, 'an untouched key keeps its stored value in the response');
  assert.deepStrictEqual(readPersistedDatabase(DATA_DIR).settings, { scanIntervalMinutes: 720, pruneMissing: false }, 'only the touched row changed');
  const got = await (await fetch(`${base}/api/settings`)).json();
  assert.strictEqual(got.scanIntervalMinutes, 720);
  assert.strictEqual(got.pruneMissing, false);
  assert.strictEqual(got.trashRetentionDays, 30, 'a never-set key reads as its default');
});

test('backup carries `settings` MERGED (defaults included); a restore round-trips it; a bundle WITHOUT settings restores to the defaults', async () => {
  const bundle = await (await fetch(`${base}/api/admin/backup`)).json();
  delete bundle.users;
  assert.strictEqual(bundle.settings.scanIntervalMinutes, 60, 'the stored value');
  assert.strictEqual(bundle.settings.trashRetentionDays, 30, 'a default rides the bundle too (the doc snapshot was the merged object)');
  settingsStore.update({ scanIntervalMinutes: 0, pruneMissing: true });
  const r = await restore(bundle);
  assert.strictEqual(r.status, 200, await r.text());
  assert.strictEqual(settingsStore.getKey('scanIntervalMinutes'), 60, 'the bundle\'s value is back');
  assert.strictEqual(settingsStore.getKey('pruneMissing'), false);
  assert.deepStrictEqual(readPersistedDatabase(DATA_DIR).settings, bundle.settings, 'the merged object landed one row per key, verbatim');

  const without = { ...bundle };
  delete without.settings;
  const r2 = await restore(without);
  assert.strictEqual(r2.status, 200, await r2.text());
  assert.strictEqual(readPersistedDatabase(DATA_DIR).settings, undefined, 'no rows: the bundle is the whole state');
  assert.strictEqual(settingsStore.getKey('scanIntervalMinutes'), 30, 'the default applies');
});

test('restore validation: a malformed `settings` is a 400 BEFORE the wipe - the live rows survive', async () => {
  const bundle = await (await fetch(`${base}/api/admin/backup`)).json();
  delete bundle.users;
  for (const [bad, re] of [
    [['x'], /settings must be an object/],
    ['nope', /settings must be an object/],
    [{ '': 1 }, /invalid settings key/],
    [{ ['a' + String.fromCharCode(0) + 'b']: 1 }, /invalid settings key/],
    [{ trashRetentionDays: 1e-9 }, /trashRetentionDays must be one of/],
  ]) {
    const r = await restore({ ...bundle, settings: bad });
    assert.strictEqual(r.status, 400, `${JSON.stringify(bad)}: ${await r.clone().text()}`);
    assert.match((await r.json()).error, re);
    assert.deepStrictEqual(readPersistedDatabase(DATA_DIR).settings, { scanIntervalMinutes: 60, pruneMissing: false }, 'the live rows survived the refusal');
  }
});
