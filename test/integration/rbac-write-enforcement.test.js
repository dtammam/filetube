'use strict';

// [INTEGRATION] v1.81 write-RBAC - the security proof for content MUTATION. A
// member WITHOUT canModifyLibrary (and not admin) must be 403 on every
// content-mutating route (video delete/move/chapters/attribute-channel, trash
// restore/purge, all three scans, cache-clear, podcast episode delete), while
// admin AND a granted member pass the gate, AND the member's OWN personal-state
// routes stay untouched. Binds AC1/AC2 and attack surfaces W1/W2/W4/W5. Isolated
// DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-write-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, loadDatabase, userStore, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, plain, granted;

const vidFile = path.join(DATA_DIR, 'clip.mp4');

before(async () => {
  fs.writeFileSync(vidFile, 'CLIPBYTES');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin

  saveDatabase({
    folders: [DATA_DIR], folderSettings: {}, progress: {},
    metadata: {
      vid: { id: 'vid', title: 'A Clip', name: 'clip.mp4', filePath: vidFile, folderName: 'Clips', channelName: 'Clips', rootFolder: DATA_DIR, type: 'video', ext: '.mp4', duration: 10, size: 9, addedAt: 10 },
    },
    viewCounts: { vid: 1 },
    trash: { t1: { originalId: 'vid2', originalPath: path.join(DATA_DIR, 'old.mp4'), rootFolder: DATA_DIR, trashedAt: 5,
      item: { id: 'vid2', title: 'Trashed', name: 'old.mp4', filePath: path.join(DATA_DIR, 'old.mp4'), folderName: 'Clips', rootFolder: DATA_DIR, type: 'video', ext: '.mp4' } } },
    liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });

  // `plain`: a minted member defaults canModifyLibrary:false. The mint ALSO sets
  // canManageSubscriptions:true - which makes `plain` the W4 case exactly (a
  // subscription manager who is NOT trusted to delete content).
  plain = __mintTestSession({ username: 'plainwriter', role: 'member' });
  assert.strictEqual(userStore.getById(plain.user.id).canModifyLibrary, false, 'baseline: plain cannot modify');
  assert.strictEqual(userStore.getById(plain.user.id).canManageSubscriptions, true, 'baseline: plain CAN manage subs (W4 setup)');
  // `granted`: an admin has ticked the modify-library box.
  granted = __mintTestSession({ username: 'grantedwriter', role: 'member' });
  userStore.setCanModifyLibrary(granted.user.id, true);
  // Personal state the member owns (for the AC2/W5 checks).
  userStore.addLiked(plain.user.id, 'vid', '2026-08-05T00:00:00Z');
  userStore.setProgress(plain.user.id, 'vid', { timestamp: 3, duration: 10, updatedAt: '2026-08-05T00:00:00Z' });
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const req = (method, p, cookie, body) => fetch(`${base}${p}`, {
  method,
  headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: body === undefined ? undefined : JSON.stringify(body),
});

// Every content-mutating route + a valid-ish body (the body only matters for the
// admin/granted paths, where a non-403 status proves the gate let them through).
const WRITE_ROUTES = [
  ['DELETE', '/api/videos/vid', undefined],
  ['POST', '/api/videos/vid/move', { targetFolder: 'Other' }],
  ['POST', '/api/videos/vid/chapters', { text: '0:00 Intro' }],
  ['POST', '/api/videos/vid/attribute-channel', { channelUrl: 'https://youtube.com/@x' }],
  // gate fix round: the BULK attribute sibling + its cancel (both were ungated).
  ['POST', '/api/videos/attribute-channel-bulk', { preview: false }],
  ['POST', '/api/videos/attribute-channel-bulk/cancel', undefined],
  ['POST', '/api/trash/t1/restore', undefined],
  ['DELETE', '/api/trash/t1', undefined],
  ['POST', '/api/scan', undefined],
  ['POST', '/api/books/scan', undefined],
  ['POST', '/api/music/scan', undefined],
  ['POST', '/api/cache/clear', undefined],
  ['DELETE', '/api/podcasts/episodes/nope', undefined], // W4: content delete, moved to this gate
];

test('W1/AC1: a member WITHOUT canModifyLibrary is 403 on every content-mutating route', async () => {
  for (const [method, p, body] of WRITE_ROUTES) {
    const s = (await req(method, p, plain.cookie, body)).status;
    assert.strictEqual(s, 403, `${method} ${p} -> 403 for a capability-less member (got ${s})`);
  }
});

test('W1 integrity: after the refused DELETE, the item is byte-unchanged in the library', async () => {
  // The 403 above must have been a NO-OP, not a delete that also errored.
  const db = loadDatabase();
  assert.ok(db.metadata.vid, 'the video record still exists after the refused delete');
  assert.strictEqual(fs.existsSync(vidFile), true, 'the file is still on disk');
  assert.ok(db.trash.t1, 'the trashed item was neither restored nor purged');
});

test('W2 guard-order: the capability gate runs BEFORE the existence oracle (403, not 404, on a missing id)', async () => {
  // A capability-less member must not be able to probe which ids exist: the
  // guard is the FIRST line, so a nonexistent id still 403s (never 404).
  assert.strictEqual((await req('DELETE', '/api/videos/does-not-exist', plain.cookie)).status, 403, 'delete missing id -> 403 not 404');
  assert.strictEqual((await req('POST', '/api/videos/does-not-exist/move', plain.cookie, { targetFolder: 'x' })).status, 403, 'move missing id -> 403 not 404');
  assert.strictEqual((await req('POST', '/api/videos/does-not-exist/chapters', plain.cookie, { text: '0:00 x' })).status, 403, 'chapters missing id -> 403 not 404');
});

test('W4: a subscription-manager who lacks canModifyLibrary is 403 on episode delete (the moved gate)', async () => {
  // `plain` has canManageSubscriptions:true but canModifyLibrary:false. Under
  // v1.80 episode delete rode the subs gate (so plain COULD have deleted); v1.81
  // moves it to the content gate, so plain is now correctly refused.
  assert.strictEqual((await req('DELETE', '/api/podcasts/episodes/nope', plain.cookie)).status, 403, 'subs-manager cannot delete an episode');
});

test('AC1: the ADMIN and a GRANTED member pass the capability gate on every route', async () => {
  // A non-403 status (200/400/404 on body/state) proves the gate let them
  // THROUGH - only the write-capability gate returns 403 on these routes.
  for (const who of [{ n: 'admin', c: undefined }, { n: 'granted member', c: granted.cookie }]) {
    for (const [method, p, body] of WRITE_ROUTES) {
      // Re-seed the trashed item each pass so restore/purge have a fresh target.
      const s = (await req(method, p, who.c, body)).status;
      assert.notStrictEqual(s, 403, `${who.n}: ${method} ${p} passed the gate (got ${s})`);
      if (p === '/api/trash/t1/restore' || p === '/api/trash/t1') {
        saveDatabase({ ...loadDatabase(), trash: { t1: { originalId: 'vid2', originalPath: path.join(DATA_DIR, 'old.mp4'), rootFolder: DATA_DIR, trashedAt: 5,
          item: { id: 'vid2', title: 'Trashed', name: 'old.mp4', filePath: path.join(DATA_DIR, 'old.mp4'), folderName: 'Clips', rootFolder: DATA_DIR, type: 'video', ext: '.mp4' } } } });
      }
    }
  }
});

test('AC2/W5: the capability-less member\'s OWN personal-state routes are UNAFFECTED (non-403)', async () => {
  // These mutate the member's own state, not the shared library, and must stay
  // open - the write gate must NOT have accidentally caught them.
  assert.notStrictEqual((await req('POST', '/api/videos/vid/view', plain.cookie)).status, 403, 'view ping ungated');
  assert.notStrictEqual((await req('POST', '/api/videos/vid/dimensions', plain.cookie, { width: 1920, height: 1080 })).status, 403, 'dimensions backfill ungated');
  assert.notStrictEqual((await req('DELETE', '/api/liked/vid', plain.cookie)).status, 403, 'un-like ungated');
  assert.notStrictEqual((await req('DELETE', '/api/history/vid', plain.cookie)).status, 403, 'history delete ungated');
  assert.notStrictEqual((await req('DELETE', '/api/queue', plain.cookie)).status, 403, 'queue clear ungated');
});
