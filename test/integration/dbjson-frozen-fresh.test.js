'use strict';

// [INTEGRATION] Wave 7 of the relational-migration arc, the arm the wave
// CHANGED, at the server.js level (adversarial seat W1 of the Wave 7a gate:
// with filetube.db present, v1.295 behaves identically to v1.296 - only this
// arm discriminates the wave). A DATA_DIR holding ONLY a pre-v1.42 db.json -
// no filetube.db - boots server.js into an EMPTY library: nothing imported
// into any table, the legacy view count not adopted, the file byte-identical.
// v1.42-v1.295 would have imported the fixture here (this test is RED on
// v1.295, measured); v1.296 does not even look at it.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-frozen-fresh-'));
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');

// A VALID legacy fixture, written BEFORE the server require like a real upgrade.
const FIXTURE = {
  folders: [],
  folderSettings: {},
  progress: { vid1: { timestamp: 10, duration: 60 } },
  metadata: { vid1: { id: 'vid1', name: 'clip.mp4', title: 'Clip', type: 'video', ext: '.mp4', filePath: '/media/clip.mp4', duration: 60, folderName: 'Media', viewCount: 3 } },
  settings: { defaultView: 'grid' },
};
fs.writeFileSync(DB_FILE, JSON.stringify(FIXTURE, null, 2), 'utf8');
const HASH_AT_BOOT = crypto.createHash('sha256').update(fs.readFileSync(DB_FILE)).digest('hex');

const { test } = require('node:test');
const assert = require('node:assert');
const { loadDatabase, viewCountStore } = require('../../server');
const { readPersistedDatabase, SQLITE_FILENAME } = require('../../lib/db/sqlite');

const hashNow = () => crypto.createHash('sha256').update(fs.readFileSync(DB_FILE)).digest('hex');

test('Wave 7: a DATA_DIR with ONLY db.json boots server.js into an EMPTY library; the file is never read and stays byte-identical', () => {
  assert.ok(fs.existsSync(path.join(DATA_DIR, SQLITE_FILENAME)), 'a fresh database was created');
  assert.deepStrictEqual(readPersistedDatabase(DATA_DIR), {}, 'nothing was imported into any table');
  assert.deepStrictEqual(loadDatabase().metadata, {}, 'the served library is empty');
  assert.strictEqual(viewCountStore.get('vid1'), 0, 'the legacy embedded view count was not imported either');
  assert.strictEqual(hashNow(), HASH_AT_BOOT, 'db.json byte-identical');
  assert.strictEqual(fs.readFileSync(DB_FILE, 'utf8'), JSON.stringify(FIXTURE, null, 2), 'no rename, no rewrite');
  assert.deepStrictEqual(fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('db.json')), ['db.json'], 'no tmp or sidecar beside it');
});
