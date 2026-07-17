'use strict';

// v1.14.0 item 4 -- POST/GET /api/settings must round-trip the new
// `defaultView` preference (a folder path/key, or '' for "Most Recent")
// instead of 400ing it as an unknown key, per the KNOWN_KEYS allowlist
// gotcha. Isolated DATA_DIR before requiring the app, own process per file
// (node --test) -- mirrors test/integration/settings-cache-api.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-default-view-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, __resetDatabaseForTests } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

const DEFAULT_SETTINGS = {
  scanIntervalMinutes: 30,
  pruneMissing: true,
  cacheMaxBytes: null,
  cacheMaxAgeDays: 30,
  defaultView: '',
};

function baseSettings(overrides) {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

// v1.30 A3 (in-memory DB read cache): seed via the exported `saveDatabase()`
// (an established test primitive, see CONTRIBUTING.md) rather than a raw
// `fs.writeFileSync`, so the in-process db cache stays coherent.
function writeDb(db) {
  saveDatabase(db);
}

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

beforeEach(async () => {
  // v1.42: SQLite replaced db.json; the sanctioned between-test reset.
  await __resetDatabaseForTests();
});

test('GET /api/settings never omits defaultView, and it defaults to "" (Most Recent) on a fresh db', async () => {
  const res = await fetch(`${base}/api/settings`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.defaultView, '');
});

test('POST /api/settings accepts a defaultView key without 400ing (KNOWN_KEYS regression)', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultView: '/media/music' }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.defaultView, '/media/music');
});

test('GET /api/settings after a POST reflects the persisted defaultView (round-trip)', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultView: '/media/music' }),
  });

  const getJson = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(getJson.defaultView, '/media/music');

  const onDisk = readPersistedDatabase(process.env.DATA_DIR);
  assert.equal(onDisk.settings.defaultView, '/media/music', 'persisted to db.json, not just returned in the response');
});

test('POST /api/settings rejects a non-string defaultView with 400 and mutates nothing', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings({ defaultView: '/media/keep' }) });

  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultView: 123 }),
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(typeof json.error, 'string');

  const onDisk = readPersistedDatabase(process.env.DATA_DIR);
  assert.equal(onDisk.settings.defaultView, '/media/keep', 'a rejected request must leave the prior value untouched');
});

test('POST /api/settings accepts an empty-string defaultView (explicit reset to Most Recent)', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings({ defaultView: '/media/music' }) });

  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultView: '' }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).defaultView, '');
});

test('POST /api/settings with an invalid defaultView does not partially persist alongside other valid keys in the same request', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pruneMissing: false, defaultView: null }),
  });
  assert.equal(res.status, 400);

  const onDisk = readPersistedDatabase(process.env.DATA_DIR);
  assert.deepEqual(onDisk.settings, baseSettings(), 'no key from the rejected request may be persisted, not even the otherwise-valid one');
});
