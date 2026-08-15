'use strict';

// [INTEGRATION] v1.126 - per-channel-folder display names (Dean: "Playlist:
// nestalgiamusic" on surfaces whose items can never self-heal). Binds:
//  - POST /api/folders/display-name: capability 403 (flag-less member),
//    VISIBILITY 404 (capable member restricted from the folder - neutral),
//    unknown-folder 404, write + clear semantics (empty name deletes).
//  - GET /api/config carries folderDisplayNames (the client's one vehicle).
//  - GET /api/channels: an unhealable folder's group name resolves through the
//    map (channelName still wins where present - the fallback ORDER).
// Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fdn-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, userStore, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, flagless, writerRestricted, writerPathRestricted;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin via patched global fetch

  saveDatabase({
    folders: [], folderSettings: {}, folderDisplayNames: {}, progress: {},
    metadata: {
      // An UNHEALABLE folder: no channelName anywhere -> /api/channels name
      // falls back to the raw folderName until the map supplies one.
      u1: { id: 'u1', title: 'Clip A', filePath: path.join(DATA_DIR, 'rawdir', 'a.mp4'), folderName: 'rawdir', rootFolder: DATA_DIR, type: 'video', ext: '.mp4', addedAt: 10 },
      u2: { id: 'u2', title: 'Clip B', filePath: path.join(DATA_DIR, 'rawdir', 'b.mp4'), folderName: 'rawdir', rootFolder: DATA_DIR, type: 'video', ext: '.mp4', addedAt: 11 },
      // A HEALED folder: channelName present -> the map must NOT override it.
      h1: { id: 'h1', title: 'Song', channelName: 'NESTALGIA', filePath: path.join(DATA_DIR, 'healed', 'c.mp4'), folderName: 'healed', rootFolder: DATA_DIR, type: 'video', ext: '.mp4', addedAt: 12 },
    },
    liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });

  flagless = __mintTestSession({ username: 'nocaps', role: 'member' });
  userStore.setCanManageSubscriptions(flagless.user.id, false);

  // Capable-but-restricted by FOLDER kind: holds library-write, but 'rawdir' is
  // hidden - only the VISIBILITY axis can refuse the rename.
  writerRestricted = __mintTestSession({ username: 'blockedwriter', role: 'member' });
  userStore.setCanModifyLibrary(writerRestricted.user.id, true);
  userStore.setRestrictions(writerRestricted.user.id, [{ kind: 'folder', value: 'rawdir' }]);

  // Capable-but-restricted by PATH kind (the kid-account/root fail-safe lane):
  // the descriptor a `folder`-kind restriction catches does NOT carry filePath,
  // so a bare-folderName check would MISS this - both gate seats' CRITICAL. The
  // whole DATA_DIR root is blocked, so every item is hidden from this member.
  writerPathRestricted = __mintTestSession({ username: 'pathwriter', role: 'member' });
  userStore.setCanModifyLibrary(writerPathRestricted.user.id, true);
  userStore.setRestrictions(writerPathRestricted.user.id, [{ kind: 'path', value: DATA_DIR }]);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const rename = (body, cookie) => fetch(`${base}/api/folders/display-name`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

test('GATING: flag-less member 403s; capable-but-restricted member 404s (neutral); unknown folder 404s', async () => {
  assert.strictEqual((await rename({ folderName: 'rawdir', name: 'X' }, flagless.cookie)).status, 403, 'capability axis');
  const hidden = await rename({ folderName: 'rawdir', name: 'X' }, writerRestricted.cookie);
  assert.strictEqual(hidden.status, 404, 'visibility axis - restricted folder');
  const missing = await rename({ folderName: 'no-such-folder', name: 'X' }, writerRestricted.cookie);
  assert.strictEqual(missing.status, 404, 'unknown folder');
  const missingBody = await missing.json(); // captured once - Response bodies read only once
  assert.deepStrictEqual(await hidden.json(), missingBody, 'hidden and missing are indistinguishable (neutral 404)');
  // PATH-kind restriction (both seats' CRITICAL): a member who cannot SEE the
  // folder's items must not rename it, and must get the SAME neutral 404 -
  // the bare-folderName descriptor missed this axis entirely.
  const pathHidden = await rename({ folderName: 'rawdir', name: 'PWNED' }, writerPathRestricted.cookie);
  assert.strictEqual(pathHidden.status, 404, 'path-restricted member is refused (visibility axis, full descriptor)');
  assert.deepStrictEqual(await pathHidden.json(), missingBody, 'path-hidden == missing (no existence oracle)');
  // The blocked writes must not have landed (none of the three refused paths).
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.deepStrictEqual(cfg.folderDisplayNames, {}, 'no mapping written by refused requests');
});

test('BOUND: a display name over 150 chars is truncated at storage (not stored whole)', async () => {
  const huge = 'z'.repeat(5000);
  assert.strictEqual((await rename({ folderName: 'rawdir', name: huge })).status, 200);
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.strictEqual(cfg.folderDisplayNames.rawdir.length, 150, 'stored name is capped at 150 chars');
  await rename({ folderName: 'rawdir', name: '' }); // cleanup for the next test
});

test('WRITE + VEHICLE + ORDER: admin renames; /api/config carries it; /api/channels uses it ONLY as the fallback', async () => {
  assert.strictEqual((await rename({ folderName: 'rawdir', name: 'Saturday Uploads' })).status, 200);
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.deepStrictEqual(cfg.folderDisplayNames, { rawdir: 'Saturday Uploads' }, 'the map rides the config payload');

  const channels = (await (await fetch(`${base}/api/channels`)).json()).channels;
  const raw = channels.find((c) => c.folder === 'rawdir');
  const healed = channels.find((c) => c.folder === 'healed');
  assert.strictEqual(raw && raw.name, 'Saturday Uploads', 'unhealable folder takes the mapped name');
  assert.strictEqual(healed && healed.name, 'NESTALGIA', 'a captured channelName still WINS over any mapping');

  // Overriding a healed folder's map entry must not displace its channelName.
  assert.strictEqual((await rename({ folderName: 'healed', name: 'Wrong Name' })).status, 200);
  const again = (await (await fetch(`${base}/api/channels`)).json()).channels.find((c) => c.folder === 'healed');
  assert.strictEqual(again && again.name, 'NESTALGIA', 'fallback order holds after mapping a healed folder');
});

test('CLEAR: an empty name deletes the mapping; clearing a non-existent mapping is a clean 200', async () => {
  assert.strictEqual((await rename({ folderName: 'rawdir', name: '' })).status, 200);
  const cfg = await (await fetch(`${base}/api/config`)).json();
  assert.ok(!('rawdir' in cfg.folderDisplayNames), 'mapping cleared');
  assert.strictEqual((await rename({ folderName: 'rawdir', name: '' })).status, 200, 'idempotent clear');
});
