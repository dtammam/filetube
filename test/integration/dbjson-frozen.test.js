'use strict';

// [INTEGRATION] The legacy db.json beside a live server: frozen AND
// invisible. v1.42's AC2 locked "imported ONCE at first boot, then never
// touched again"; Wave 7 of the relational-migration arc removed the import
// itself, so the lock is now the stronger one the Wave 0 slim gate asked for
// (S7): server.js ITSELF boots - the real require-time openAdapter, not the
// adapter seam alone - with a garbage db.json beside filetube.db, serves the
// database's rows, and a representative workout of every write path leaves
// the garbage byte-identical. A source lock on server.js is evadable by an
// indirect spelling; a boot that would have been FATAL had the file been
// parsed is not.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-frozen-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');

// The pre-boot state, written BEFORE the server require like a real upgrade:
// a seeded filetube.db (what a v1.42-v1.295 boot left behind) and, beside it,
// a db.json that is NOT JSON - the old importer would have refused to boot on
// it; the Wave 7 server must not notice it.
const { SqliteAdapter, SQLITE_FILENAME, readPersistedDatabase } = require('../../lib/db/sqlite');
{
  const a = new SqliteAdapter(path.join(DATA_DIR, SQLITE_FILENAME), { log: () => {} });
  try {
    a.save({ metadata: { vid1: { id: 'vid1', name: 'clip.mp4', title: 'Clip', type: 'video', ext: '.mp4', filePath: '/media/clip.mp4', duration: 60, folderName: 'Media' } } });
  } finally { a.close(); }
}
const GARBAGE = '{ this is not JSON - the v1.42 importer would have aborted boot on me';
fs.writeFileSync(DB_FILE, GARBAGE, 'utf8');
const HASH_AT_BOOT = crypto.createHash('sha256').update(fs.readFileSync(DB_FILE)).digest('hex');

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, flushPendingProgress, viewCountStore, loadDatabase } = require('../../server');
const { folderSettingsStore } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

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

test('S7: server.js booted beside a garbage db.json (which the old importer would have refused), serves the database\'s rows, and left the file byte-identical', () => {
  assert.equal(hashNow(), HASH_AT_BOOT, 'boot never wrote the file');
  assert.equal(fs.readFileSync(DB_FILE, 'utf8'), GARBAGE, 'and never repaired or replaced it');
  assert.equal(loadDatabase().metadata.vid1.title, 'Clip', 'the seeded row is what the server serves');
  assert.equal(readPersistedDatabase(DATA_DIR).metadata.vid1.title, 'Clip');
});

test('a representative workout of every write path leaves db.json byte-identical', async () => {
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
  folderSettingsStore().set('/x', { name: 'X', hidden: false });

  assert.equal(viewCountStore.get('vid1'), 1, 'the writes really landed (in SQLite - the media_view_counts table since Wave 1)');
  assert.equal(hashNow(), HASH_AT_BOOT, 'db.json byte-identical through the whole workout');
  assert.equal(fs.readFileSync(DB_FILE, 'utf8'), GARBAGE);
});
