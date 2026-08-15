'use strict';

// [INTEGRATION] v1.128 Wave B (S3, census L9) - the shared queue reader.
// shapedQueue(db, req) now drops entries the requester cannot see (silent-drop,
// like a dead id - oracle-free), and POST /api/queue/items visibility-checks
// the id, returning the SAME 404 as a missing one. A restricted member with a
// hidden item queued before the restriction must never get it echoed back with
// its title/path, and must not be able to probe a hidden id via insert.
// Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-queue-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, getMediaId, userStore, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, kid;
let pubRoot, hidRoot, openId, hiddenId;

function vid(root, folderName, name) {
  const dir = path.join(root, folderName);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, 'BYTES');
  return { id: getMediaId(fp), title: name.replace(/\.\w+$/, ''), name, filePath: fp, folderName, rootFolder: root, type: 'video', ext: '.mp4', duration: 5, size: 5, addedAt: 1 };
}

before(async () => {
  pubRoot = path.join(DATA_DIR, 'PublicRoot');
  hidRoot = path.join(DATA_DIR, 'HiddenRoot');
  fs.mkdirSync(pubRoot, { recursive: true }); fs.mkdirSync(hidRoot, { recursive: true });

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin

  const open = vid(pubRoot, 'Fam', 'openclip.mp4');
  const hidden = vid(hidRoot, 'Vault', 'SECRETCLIP.mp4');
  openId = open.id; hiddenId = hidden.id;
  saveDatabase({
    folders: [pubRoot, hidRoot], folderSettings: {},
    progress: {}, metadata: { [open.id]: open, [hidden.id]: hidden },
    viewCounts: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });

  kid = __mintTestSession({ username: 'kidqueue', role: 'member' });
  userStore.setRestrictions(kid.user.id, [{ kind: 'path', value: hidRoot }]);
  // Pre-seed the restricted member's queue with BOTH ids (as if queued before
  // the restriction, or via a restored bundle).
  userStore.setQueue(kid.user.id, [
    { uid: 'u1', mediaId: openId, kind: 'media' },
    { uid: 'u2', mediaId: hiddenId, kind: 'media' },
  ], 'u1', Date.now());
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const getQueue = (cookie) => fetch(`${base}/api/queue`, { headers: cookie ? { Cookie: cookie } : {} }).then((r) => r.json());
const addItem = (cookie, mediaId) => fetch(`${base}/api/queue/items`, {
  method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: JSON.stringify({ mediaId }),
});

test('L9 read: a restricted member never sees the hidden queued entry or its title/path', async () => {
  const q = await getQueue(kid.cookie);
  const ids = q.entries.map((e) => e.mediaId);
  assert.deepStrictEqual(ids, [openId], 'only the visible entry survives the shaped queue');
  const text = JSON.stringify(q);
  assert.ok(!text.includes('SECRETCLIP'), 'no hidden title');
  assert.ok(!text.includes(hidRoot), 'no hidden path');
});

test('L9 insert: adding a hidden id 404s exactly like a nonexistent one (no oracle)', async () => {
  const hidStatus = (await addItem(kid.cookie, hiddenId)).status;
  const missingStatus = (await addItem(kid.cookie, 'deadbeefdeadbeefdeadbeefdeadbeef')).status;
  assert.strictEqual(hidStatus, 404, 'hidden id insert -> 404');
  assert.strictEqual(missingStatus, 404, 'missing id insert -> 404');
  assert.strictEqual(hidStatus, missingStatus, 'the two are indistinguishable');
  // The visible id still inserts.
  assert.strictEqual((await addItem(kid.cookie, openId)).status, 200, 'visible id inserts fine');
});

test('L9: an ADMIN sees BOTH queued entries (the reader still works)', async () => {
  userStore.setQueue(auth.user.id, [
    { uid: 'a1', mediaId: openId, kind: 'media' },
    { uid: 'a2', mediaId: hiddenId, kind: 'media' },
  ], 'a1', Date.now());
  const q = await getQueue(undefined);
  assert.deepStrictEqual(q.entries.map((e) => e.mediaId).sort(), [openId, hiddenId].sort(), 'admin sees both');
});
