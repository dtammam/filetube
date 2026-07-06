'use strict';

// v1.16.0 FR-3 (T3) -- POST/GET /api/settings must round-trip the new
// `autoplayNext` preference (boolean, OFF by default) exactly like
// `defaultView` (test/integration/default-view-api.test.js): it must not
// 400 as an unknown key (KNOWN_KEYS allowlist) and must persist/read back
// correctly. Isolated DATA_DIR before requiring the app, own process per
// file (node --test) -- mirrors that same file's setup.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-autoplay-next-'));
const DB_FILE = path.join(process.env.DATA_DIR, 'db.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app } = require('../../server');

const DEFAULT_SETTINGS = {
  scanIntervalMinutes: 30,
  pruneMissing: true,
  cacheMaxBytes: null,
  cacheMaxAgeDays: 30,
  defaultView: '',
  autoplayNext: false,
};

function baseSettings(overrides) {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
});

test('GET /api/settings never omits autoplayNext, and it defaults to false (OFF) on a fresh db', async () => {
  const res = await fetch(`${base}/api/settings`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.autoplayNext, false);
});

test('POST /api/settings accepts an autoplayNext key without 400ing (KNOWN_KEYS regression)', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoplayNext: true }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.autoplayNext, true);
});

test('GET /api/settings after a POST reflects the persisted autoplayNext (round-trip)', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoplayNext: true }),
  });

  const getJson = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(getJson.autoplayNext, true);

  const onDisk = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal(onDisk.settings.autoplayNext, true, 'persisted to db.json, not just returned in the response');
});

test('POST /api/settings can turn autoplayNext back OFF (explicit false)', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings({ autoplayNext: true }) });

  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoplayNext: false }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).autoplayNext, false);
});

test('POST /api/settings rejects a non-boolean autoplayNext with 400 and mutates nothing', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings({ autoplayNext: true }) });

  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoplayNext: 'yes' }),
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(typeof json.error, 'string');

  const onDisk = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.equal(onDisk.settings.autoplayNext, true, 'a rejected request must leave the prior value untouched');
});

test('POST /api/settings with an invalid autoplayNext does not partially persist alongside other valid keys in the same request', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: baseSettings() });

  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pruneMissing: false, autoplayNext: null }),
  });
  assert.equal(res.status, 400);

  const onDisk = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  assert.deepEqual(onDisk.settings, baseSettings(), 'no key from the rejected request may be persisted, not even the otherwise-valid one');
});
