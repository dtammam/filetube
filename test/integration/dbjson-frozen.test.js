'use strict';

// [INTEGRATION] v1.42 AC2 — the parallel-run contract's ongoing lock:
// db.json is imported ONCE at first boot and then NEVER touched again, no
// matter how much the instance writes. "Byte-identical after a week of use"
// can't literally run a week in CI, so this locks the MECHANISM: a real
// import boot followed by a representative workout of every write path,
// with a byte-hash comparison at each checkpoint. Nothing in the v1.42
// codebase writes the db.json path anymore (only the import READS it); this
// test exists so a future regression that re-introduces a writer fails
// loudly instead of silently breaking the old-tag instance sharing the file.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-frozen-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');

// The pre-boot fixture: a realistic legacy-shaped db.json the boot must
// import — written BEFORE the server require, like a real upgrade.
const FIXTURE = {
  folders: [],
  folderSettings: {},
  progress: { vid1: { timestamp: 10, duration: 60 } },
  metadata: { vid1: { id: 'vid1', name: 'clip.mp4', title: 'Clip', type: 'video', ext: '.mp4', filePath: '/media/clip.mp4', duration: 60, folderName: 'Media', viewCount: 3 } },
  settings: { defaultView: 'grid' },
};
fs.writeFileSync(DB_FILE, JSON.stringify(FIXTURE, null, 2), 'utf8');
const HASH_AT_BOOT = crypto.createHash('sha256').update(fs.readFileSync(DB_FILE)).digest('hex');

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, loadDatabase, flushPendingProgress } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // v1.43: auth through the real gate
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const hashNow = () => crypto.createHash('sha256').update(fs.readFileSync(DB_FILE)).digest('hex');

test('AC2: the boot imported db.json (with the viewCounts extraction) and left it byte-identical', () => {
  assert.equal(hashNow(), HASH_AT_BOOT, 'import reads, never writes');
  const db = readPersistedDatabase(DATA_DIR);
  assert.equal(db.metadata.vid1.title, 'Clip', 'imported');
  assert.equal(db.metadata.vid1.viewCount, undefined, 'embedded count extracted off the item');
  assert.equal(db.viewCounts.vid1, 3, 'and into its own namespace');
});

test('AC2: a representative workout of every write path leaves db.json byte-identical', async () => {
  // settings write
  assert.equal((await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ defaultView: '' }),
  })).status, 200);
  // like + unlike
  assert.equal((await fetch(`${base}/api/liked/vid1`, { method: 'POST' })).status, 200);
  // progress ping + flush
  assert.equal((await fetch(`${base}/api/progress`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'vid1', timestamp: 33, duration: 60 }),
  })).status, 200);
  await flushPendingProgress();
  // view ping
  assert.equal((await fetch(`${base}/api/videos/vid1/view`, { method: 'POST' })).status, 200);
  // a direct mutator for good measure
  await updateDatabase((db) => { db.folderSettings['/x'] = { name: 'X', hidden: false }; return true; });

  assert.equal(loadDatabase().viewCounts.vid1, 4, 'the writes really landed (in SQLite)');
  assert.equal(hashNow(), HASH_AT_BOOT, 'db.json byte-identical through the whole workout — the old-tag instance sharing it is safe');
});
