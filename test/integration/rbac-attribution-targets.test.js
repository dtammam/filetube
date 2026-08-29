'use strict';

// [INTEGRATION] v1.128 Wave B (S2c) - census L8. GET /api/attribution-targets
// built its target list from BOTH the shared channel registry AND every
// db.metadata item's channelName/folderName. The library-sourced arm leaked
// the channel/folder names of content hidden from a restricted member (the
// attribute-channel dialog is a library-edit feature a restricted member can
// still reach). The subscription-sourced arm is the shared registry, left
// as-is. Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-attr-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, getMediaId, userStore, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, kid;
let pubRoot, hidRoot;

function vid(root, folderName, name, channelName, channelUrl) {
  const dir = path.join(root, folderName);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, 'BYTES');
  return { id: getMediaId(fp), title: name.replace(/\.\w+$/, ''), name, filePath: fp, folderName, rootFolder: root, channelName, channelUrl, type: 'video', ext: '.mp4', duration: 5, size: 5, addedAt: 1 };
}

before(async () => {
  pubRoot = path.join(DATA_DIR, 'PublicRoot');
  hidRoot = path.join(DATA_DIR, 'HiddenRoot');
  fs.mkdirSync(pubRoot, { recursive: true }); fs.mkdirSync(hidRoot, { recursive: true });

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin

  const open = vid(pubRoot, 'OpenChan', 'open.mp4', 'Open Channel', 'https://youtube.com/@open');
  const hidden = vid(hidRoot, 'SecretChan', 'secret.mp4', 'Secret Channel', 'https://youtube.com/@secret');

  saveDatabase({
    folders: [pubRoot, hidRoot], folderSettings: {},
    progress: {}, metadata: { [open.id]: open, [hidden.id]: hidden },
    viewCounts: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30, attributeControlEnabled: true }, // v1.202: OPT-IN feature, exercised ON here (the OFF answers live in attribute-flag-api.test.js)
  });

  kid = __mintTestSession({ username: 'kidattr', role: 'member' });
  userStore.setRestrictions(kid.user.id, [{ kind: 'path', value: hidRoot }]);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const getJson = (p, cookie) => fetch(`${base}${p}`, { headers: cookie ? { Cookie: cookie } : {} }).then((r) => r.json());

test('L8 /api/attribution-targets: restricted member sees no hidden channel', async () => {
  const admin = await getJson('/api/attribution-targets', undefined);
  const adminNames = admin.targets.map((t) => t.channelName);
  assert.ok(adminNames.includes('Open Channel') && adminNames.includes('Secret Channel'), 'admin sees both channels');

  const k = await getJson('/api/attribution-targets', kid.cookie);
  const kidNames = k.targets.map((t) => t.channelName);
  assert.ok(kidNames.includes('Open Channel'), 'restricted member keeps the visible channel');
  assert.ok(!kidNames.includes('Secret Channel'), 'restricted member does NOT see the hidden channel');
  assert.ok(!JSON.stringify(k).includes('@secret'), 'no hidden channel URL leaks either');
});
