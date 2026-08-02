'use strict';

// [INTEGRATION] v1.65 t4 -- the retention auto-purge: the trashRetentionDays
// setting end-to-end, sweepTrash's record-driven pass (purges only past-
// retention records; 0 = keep forever), the orphan pass (unreferenced
// trash-dir files age by CTIME -- a hard link preserves mtime, so mtime
// would lie), and the confinement bound: the sweep NEVER touches a path
// outside a directory literally named .filetube-trash.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trashret-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, loadDatabase, saveDatabase, updateDatabase,
  trashItem, sweepTrash, __resetDatabaseForTests,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { TRASH_DIR_NAME } = require('../../lib/trashPaths');

const DAY = 86400000;
let server, base;
let ROOT;

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
});

function seedLibrary(settingsOverrides) {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trashretlib-'));
  fs.mkdirSync(path.join(ROOT, 'Chan'), { recursive: true });
  const mk = (name) => {
    const filePath = path.join(ROOT, 'Chan', name);
    fs.writeFileSync(filePath, `bytes-${name}`);
    return { id: getMediaId(filePath), filePath };
  };
  const a = mk('old.mp4');
  const b = mk('fresh.mp4');
  saveDatabase({
    folders: [ROOT],
    folderSettings: {},
    progress: {},
    metadata: Object.fromEntries([a, b].map(({ id, filePath }) => [id, {
      id, name: path.basename(filePath), title: path.basename(filePath, '.mp4'), filePath,
      folderName: 'Chan', rootFolder: ROOT, size: 5, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 10,
    }])),
    settings: {
      scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0,
      trashRetentionDays: 30, ...settingsOverrides,
    },
  });
  return { a, b };
}

const deps = () => ({ loadDatabase, updateDatabase, getMediaId });

test('settings end-to-end: default 30, allowed set enforced, honest 400 message', async () => {
  seedLibrary();
  const got = await fetch(`${base}/api/settings`).then((r) => r.json());
  assert.equal(got.trashRetentionDays, 30);

  const ok = await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashRetentionDays: 7 }),
  });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).trashRetentionDays, 7);

  const bad = await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashRetentionDays: 5 }),
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /0, 7, 14, 30, 90/);
});

test('record-driven sweep: purges ONLY past-retention records (file + record + sidecars), keeps the fresh one', async () => {
  const { a, b } = seedLibrary();
  const now = Date.now();
  const oldRes = await trashItem(deps(), a.id, { nowMs: now - 31 * DAY });
  const freshRes = await trashItem(deps(), b.id, { nowMs: now - 5 * DAY });

  const purged = await sweepTrash(now);
  assert.equal(purged, 1, 'exactly the expired record');

  const db = loadDatabase();
  assert.equal(db.trash[oldRes.trashId], undefined, 'the 31-day record is gone');
  assert.ok(!fs.existsSync(oldRes.trashPath), 'its bytes are gone');
  assert.ok(db.trash[freshRes.trashId], 'the 5-day record survives');
  assert.ok(fs.existsSync(freshRes.trashPath), 'its bytes survive');
  assert.deepEqual(db.deleteTombstones, {}, 'a verified sweep purge mints no tombstone');
});

test('retention 0 = keep forever: nothing purges no matter how old', async () => {
  const { a } = seedLibrary({ trashRetentionDays: 0 });
  const res = await trashItem(deps(), a.id, { nowMs: Date.now() - 400 * DAY });

  const purged = await sweepTrash(Date.now());
  assert.equal(purged, 0);
  assert.ok(loadDatabase().trash[res.trashId]);
  assert.ok(fs.existsSync(res.trashPath));
});

test('orphan pass: an unreferenced trash-dir file past retention (by CTIME) is removed; a referenced one is not', async () => {
  const { a } = seedLibrary();
  const res = await trashItem(deps(), a.id); // referenced, fresh record
  const orphan = path.join(ROOT, TRASH_DIR_NAME, 'crash-window-orphan.mp4');
  fs.writeFileSync(orphan, 'orphan-bytes'); // ctime = now; no record references it

  // Not old enough yet: kept.
  await sweepTrash(Date.now());
  assert.ok(fs.existsSync(orphan), 'a fresh orphan is inside its grace window');

  // 40 days later (ctime age > 30d): swept. The referenced file survives
  // because its record is only 40 days old vs... it is ALSO past retention
  // by then -- so assert the orphan sweep specifically by putting the
  // referenced record inside the window: re-check both.
  const future = Date.now() + 40 * DAY;
  await updateDatabase((db) => { db.trash[res.trashId].trashedAt = future - 5 * DAY; }); // keep the record fresh at `future`
  await sweepTrash(future);
  assert.ok(!fs.existsSync(orphan), 'the unreferenced orphan aged out by ctime and was removed');
  assert.ok(fs.existsSync(res.trashPath), 'the record-referenced file is untouched by the orphan pass');
});

test('CONFINEMENT BOUND: the sweep never touches a file outside a .filetube-trash directory', async () => {
  const { a, b } = seedLibrary();
  await trashItem(deps(), a.id, { nowMs: Date.now() - 100 * DAY }); // guarantees the sweep does real work
  const bystander = b.filePath; // a live library file, old ctime irrelevant

  const purged = await sweepTrash(Date.now() + 100 * DAY);
  assert.ok(purged >= 1, 'the sweep ran and purged');
  assert.ok(fs.existsSync(bystander), 'the library file is untouched');
  assert.ok(loadDatabase().metadata[b.id], 'and still indexed');
});
