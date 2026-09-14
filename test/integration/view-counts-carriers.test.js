'use strict';

// [INTEGRATION] Wave 1 of the relational-migration arc - the gate's donated
// bindings for `media_view_counts` (lib/media/viewCounts.js), through the REAL
// routes. Each was a SURVIVING mutant or an unbound guard at the first gate
// round (adversarial W2/W3/S4, QA W1), so every case populates FIRST and then
// drives the clear / refuse axis (no vacuous floor):
//   - a HARD delete (file already gone -> the legacy mutator, not a trash
//     move) reaps the row - the trash path re-keys instead, so the existing
//     delete test was satisfied by the re-key, not the reap;
//   - purging a trashed item reaps the row under the trashId;
//   - restore validation refuses a malformed / out-of-range `viewCounts`
//     BEFORE the wipe - the live count survives every refusal - including
//     2^53 (which lands in the INTEGER column and then makes EVERY read of the
//     table throw) and 1e300;
//   - a `__proto__` view id is 404, never a prototype walk.

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { app, __resetDatabaseForTests, viewCountStore } = require('../../server');
const { seedState, trashStore  } = require('../helpers/seed-state'); // Wave 3: relational trash reads
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
const view = (id) => fetch(`${base}/api/videos/${encodeURIComponent(id)}/view`, { method: 'POST' });

test('hard delete (file already gone -> no trash move) reaps the view-count row', async () => {
  seed({ gone1: item('gone1') }); // the file does NOT exist on disk: resolver `gone` -> the legacy mutator
  assert.strictEqual((await view('gone1')).status, 200);
  assert.strictEqual(viewCountStore.get('gone1'), 1, 'precondition: a real count to reap');

  const res = await fetch(`${base}/api/videos/gone1`, { method: 'DELETE' });
  assert.strictEqual(res.status, 200, await res.text());
  const db = readPersistedDatabase(DATA_DIR);
  assert.strictEqual(db.metadata && db.metadata.gone1, undefined, 'entry removed');
  assert.deepStrictEqual(db.trash || {}, {}, 'no trash record: this was the hard-delete branch');
  assert.strictEqual(viewCountStore.get('gone1'), 0, 'the view-count row went with the item');
  assert.strictEqual(db.viewCounts, undefined, 'no orphan row in the table');
});

test('purging a trashed item reaps the view-count row under the trashId', async () => {
  fs.writeFileSync(path.join(DATA_DIR, 't1.mp4'), 'bytes');
  seed({ t1: item('t1') });
  await view('t1');
  assert.strictEqual(viewCountStore.get('t1'), 1, 'precondition');
  assert.strictEqual((await fetch(`${base}/api/videos/t1`, { method: 'DELETE' })).status, 200);
  const trashIds = Object.keys(trashStore().getAll());
  assert.strictEqual(trashIds.length, 1, 'trashed, not hard-deleted');
  const tid = trashIds[0];
  assert.strictEqual(viewCountStore.get(tid), 1, 'precondition: the count rode to the trashId');

  const purge = await fetch(`${base}/api/trash/${encodeURIComponent(tid)}`, { method: 'DELETE' });
  assert.strictEqual(purge.status, 200, await purge.text());
  assert.strictEqual(viewCountStore.get(tid), 0, 'the purge reaped the row');
  assert.strictEqual(viewCountStore.size(), 0, 'no orphan row anywhere');
});

test('restore validation: a malformed or out-of-range viewCounts is a 400 BEFORE the wipe - the live count is never touched', async () => {
  seed({ v: item('v') });
  viewCountStore.set('v', 3);
  const good = await (await fetch(`${base}/api/admin/backup`)).json();
  delete good.users;
  const NUL = String.fromCharCode(0);
  const hostile = [
    { v: -1 }, { v: 'x' }, { v: null }, { v: 1.5 }, ['x'], 'x', { '': 1 }, { ['a' + NUL + 'b']: 1 },
    { v: 9007199254740992 }, // 2^53: the read-poisoning value (adversarial W1)
    { v: 1e300 },
  ];
  for (const vc of hostile) {
    const r = await fetch(`${base}/api/admin/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...good, viewCounts: vc }),
    });
    assert.strictEqual(r.status, 400, `refused before the wipe: ${JSON.stringify(vc)} -> ${r.status} ${await r.text()}`);
    assert.strictEqual(viewCountStore.get('v'), 3, `the live count survived the refusal of ${JSON.stringify(vc)}`);
  }
  // The table is still fully readable afterwards (nothing poisoned it).
  assert.deepStrictEqual(viewCountStore.getAll(), { v: 3 });
  assert.strictEqual((await fetch(`${base}/api/admin/backup`)).status, 200, 'backup still works');
  // And a well-formed bundle still restores - the validator is not blanket-refusing.
  const ok = await fetch(`${base}/api/admin/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...good, viewCounts: { v: 8 } }),
  });
  assert.strictEqual(ok.status, 200, await ok.text());
  assert.strictEqual(viewCountStore.get('v'), 8);
});

test('a __proto__ (or other prototype-key) view id is 404 and creates no row', async () => {
  seed({ real: item('real') });
  for (const id of ['__proto__', 'constructor', 'hasOwnProperty']) {
    const r = await view(id);
    assert.strictEqual(r.status, 404, `${id} -> ${r.status}`);
  }
  assert.strictEqual(viewCountStore.size(), 0, 'no row was created');
  assert.strictEqual((await view('real')).status, 200, 'a real id still counts');
  assert.strictEqual(viewCountStore.get('real'), 1);
});
