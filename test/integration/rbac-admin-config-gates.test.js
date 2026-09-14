'use strict';

// [INTEGRATION] Wave 7b R2 gate (adversarial S6): two admin-only WRITE gates
// that no test bound - `requireAdmin` on POST /api/config (the library roots)
// and on POST /api/settings (the instance settings). The seat neutered each
// gate and every rbac suite stayed green, at v1.297.0 too (pre-existing), so a
// member could have rewritten the roots or the settings unnoticed. Both routes
// now live in lib/config/routes.js and cross the gate through deps; this binds
// the gate's EFFECT (a member gets 403 and nothing changes; an admin gets 200),
// not its presence.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-config-gates-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, __mintTestSession, settingsStore } = require('../../server');
const { seedState, folderStore } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
let member;
let root;

before(async () => {
  root = path.join(DATA_DIR, 'Root');
  fs.mkdirSync(root, { recursive: true });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // the admin session on the default fetch
  seedState({ folders: [root], folderSettings: { [root]: { name: 'Root' } }, metadata: {}, settings: { scanIntervalMinutes: 30 } });
  member = __mintTestSession({ username: 'plainmember', role: 'member' });
});
after(async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); });

const post = (url, body, cookie) => fetch(`${base}${url}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

test('POST /api/config: a member is refused (403) and the roots are untouched; the admin succeeds', async () => {
  const before = folderStore().list();
  const other = path.join(DATA_DIR, 'Other');
  fs.mkdirSync(other, { recursive: true });
  const r = await post('/api/config', { folders: [other] }, member.cookie);
  assert.strictEqual(r.status, 403, await r.text());
  assert.deepStrictEqual(folderStore().list(), before, 'the roots did not change');
  const ok = await post('/api/config', { folders: [root] });
  assert.strictEqual(ok.status, 200, await ok.text());
});

test('POST /api/settings: a member is refused (403) and the settings are untouched; the admin succeeds', async () => {
  const before = settingsStore.getKey('scanIntervalMinutes');
  const r = await post('/api/settings', { scanIntervalMinutes: 60 }, member.cookie);
  assert.strictEqual(r.status, 403, await r.text());
  assert.strictEqual(settingsStore.getKey('scanIntervalMinutes'), before, 'the setting did not change');
  const ok = await post('/api/settings', { scanIntervalMinutes: 60 });
  assert.strictEqual(ok.status, 200, await ok.text());
  assert.strictEqual(settingsStore.getKey('scanIntervalMinutes'), 60);
});
