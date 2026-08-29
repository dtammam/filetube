'use strict';

// [INTEGRATION] v1.202 (Dean): manual channel attribution is OPT-IN -
// `settings.attributeControlEnabled` (default OFF). Binds: the setting's
// default + boolean validation + round-trip; every attribution route (the
// target list, the per-video POST, the bulk POST) answers 404 for an ADMIN
// while off and works while on; the member RBAC answers are UNCHANGED by
// the flag (the check sits after the guard); the bulk CANCEL is reachable
// regardless (a job started while on must stay abortable).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-attribute-flag-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

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

function seed(flag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-attr-lib-'));
  const filePath = path.join(root, 'clip.mp4');
  fs.writeFileSync(filePath, 'x');
  saveDatabase({
    folders: [root], folderSettings: {}, progress: {},
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30, ...(flag === undefined ? {} : { attributeControlEnabled: flag }) },
    metadata: { vid1: { id: 'vid1', title: 'Clip', type: 'video', ext: '.mp4', filePath, folderName: path.basename(root), rootFolder: root, size: 1, addedAt: 1 } },
  });
  return root;
}
beforeEach(() => seed(undefined));

const post = (p, body, headers) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body || {}) });

test('settings: attributeControlEnabled defaults to false, rejects non-booleans, round-trips', async () => {
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).attributeControlEnabled, false);
  const bad = await post('/api/settings', { attributeControlEnabled: 'yes' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /attributeControlEnabled must be a boolean/);
  assert.equal((await post('/api/settings', { attributeControlEnabled: true })).status, 200);
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).attributeControlEnabled, true);
});

test('flag OFF (default): an ADMIN gets 404 from the target list, the per-video attribute, and the bulk attribute', async () => {
  assert.equal((await fetch(`${base}/api/attribution-targets`)).status, 404);
  assert.equal((await post('/api/videos/vid1/attribute-channel', { clear: true })).status, 404);
  assert.equal((await post('/api/videos/attribute-channel-bulk', { rootFolder: '/nope', target: {} })).status, 404);
});

test('flag ON: the same three routes are reachable again (non-404) for the admin', async () => {
  seed(true);
  assert.equal((await fetch(`${base}/api/attribution-targets`)).status, 200);
  assert.notEqual((await post('/api/videos/vid1/attribute-channel', { clear: true })).status, 404);
  assert.notEqual((await post('/api/videos/attribute-channel-bulk', { rootFolder: '/nope', target: {} })).status, 404);
});

test('flag OFF: a capability-less MEMBER still gets the RBAC answer (403), not the feature 404 - the check is after the guard', async () => {
  const member = __mintTestSession({ role: 'member', username: 'plain-member' });
  const h = { Cookie: member.cookie };
  assert.equal((await post('/api/videos/vid1/attribute-channel', { clear: true }, h)).status, 403);
  assert.equal((await post('/api/videos/attribute-channel-bulk', { rootFolder: '/nope', target: {} }, h)).status, 403);
});

test('flag OFF: the bulk CANCEL stays reachable (a job started while on must remain abortable)', async () => {
  const res = await post('/api/videos/attribute-channel-bulk/cancel', {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { cancelled: false, running: false });
});
