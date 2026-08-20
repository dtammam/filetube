'use strict';

// [INTEGRATION] v1.158 (Dean) - POST /api/trash/purge-all ("Empty trash"):
// permanently purge EVERY trash item the requester can see, in one call, and
// GET /api/trash reports the total bytes that empties.
//
// This is a DESTRUCTIVE bulk route, so the security proof is the point:
//  - freedBytes/purgedCount are honest (real files gone, real sizes summed);
//  - an empty (or already-purged) trash is a harmless no-op;
//  - RBAC VISIBILITY (v1.80/v1.81): a capable-but-RESTRICTED member purges ONLY
//    their visible items and never a hidden one - not via the byte route and
//    not via the total either. (The capability gate - a member WITHOUT
//    canModifyLibrary is 403 - is bound alongside the other mutating routes in
//    rbac-write-enforcement.test.js's WRITE_ROUTES, where purge-all is listed.)

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-purgeall-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, saveDatabase, loadDatabase, userStore,
  __mintTestSession, __resetDatabaseForTests,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, member;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // admin (auto-cookie on bare fetch)
  // A member the visibility test grants modify-library to, then restricts from
  // the "Adult" folder. Minted once; survives each case's db reset (users are
  // not cleared), restrictions re-applied per-test.
  member = __mintTestSession({ username: 'purgemember', role: 'member' });
  userStore.setCanModifyLibrary(member.user.id, true);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

beforeEach(async () => { await __resetDatabaseForTests(); });

// Seed a library with one file per named folder, then trash each via the real
// DELETE route so the trash records carry a genuine snapshot (folderName, size)
// and real bytes under <ROOT>/.filetube-trash. Returns { ROOT, byFolder }.
async function seedAndTrash(folders) {
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-purgeall-lib-'));
  const metadata = {};
  const files = {};
  for (const { folder, size } of folders) {
    fs.mkdirSync(path.join(ROOT, folder), { recursive: true });
    const filePath = path.join(ROOT, folder, 'clip.mp4');
    fs.writeFileSync(filePath, 'x'.repeat(size));
    const id = getMediaId(filePath);
    metadata[id] = {
      id, name: 'clip.mp4', title: `${folder} clip`, filePath, folderName: folder,
      rootFolder: ROOT, size, ext: '.mp4', type: 'video', addedAt: 1700000000000, duration: 30,
    };
    files[folder] = { id, filePath, size };
  }
  saveDatabase({
    folders: [ROOT], folderSettings: {}, progress: {}, metadata,
    settings: { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0 },
  });
  for (const folder of Object.keys(files)) {
    const r = await fetch(`${base}/api/videos/${encodeURIComponent(files[folder].id)}`, { method: 'DELETE' });
    assert.equal((await r.json()).trashed, true, `${folder} moved to trash`);
  }
  return { ROOT, files };
}

const getTrash = (cookie) => fetch(`${base}/api/trash`, cookie ? { headers: { Cookie: cookie } } : undefined).then((r) => r.json());
const purgeAll = (cookie) => fetch(`${base}/api/trash/purge-all`, { method: 'POST', ...(cookie ? { headers: { Cookie: cookie } } : {}) });

test('happy path: GET reports total bytes; purge-all frees every visible item and its bytes', async () => {
  const { files } = await seedAndTrash([{ folder: 'Open', size: 10 }, { folder: 'Movies', size: 25 }]);

  const before = await getTrash();
  assert.equal(before.total, 2, 'both items listed');
  assert.equal(before.totalSizeBytes, 35, 'totalSizeBytes is the sum of the visible items (10 + 25)');

  const res = await purgeAll();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.purgedCount, 2, 'both purged');
  assert.equal(body.freedBytes, 35, 'freedBytes equals what GET advertised');
  assert.deepEqual(body.failures, [], 'no failures');

  const db = loadDatabase();
  assert.deepEqual(db.trash, {}, 'the trash map is empty');
  assert.ok(!fs.existsSync(files.Open.filePath) && !fs.existsSync(files.Movies.filePath), 'source files long gone');
  const after = await getTrash();
  assert.equal(after.total, 0);
  assert.equal(after.totalSizeBytes, 0);
});

test('empty trash: purge-all is a harmless no-op (success, zero counts)', async () => {
  const res = await purgeAll();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.purgedCount, 0);
  assert.equal(body.freedBytes, 0);
});

test('RBAC visibility: a restricted member purges ONLY visible items; the hidden one survives (bytes AND total)', async () => {
  await seedAndTrash([{ folder: 'Open', size: 10 }, { folder: 'Adult', size: 20 }]);
  userStore.setRestrictions(member.user.id, [{ kind: 'folder', value: 'Adult' }]);

  // The member's own view already hides the restricted item, and its bytes.
  const memberView = await getTrash(member.cookie);
  assert.equal(memberView.total, 1, 'restricted member sees only the Open item');
  assert.equal(memberView.totalSizeBytes, 10, 'the hidden item never joins the member total');
  assert.ok(!memberView.items.some((it) => it.title === 'Adult clip'), 'no restricted title leaks');

  // Purge-all as the member must touch ONLY the visible item.
  const res = await purgeAll(member.cookie);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.purgedCount, 1, 'exactly one (the visible) item purged');
  assert.equal(body.freedBytes, 10, 'only the visible bytes freed');

  const db = loadDatabase();
  const remaining = Object.values(db.trash);
  assert.equal(remaining.length, 1, 'the restricted record survives');
  assert.equal(remaining[0].item.folderName, 'Adult', 'and it is exactly the hidden one');
  assert.ok(fs.existsSync(remaining[0].trashPath), 'the restricted bytes are untouched on disk');

  // The admin still sees (and could purge) the survivor.
  const adminView = await getTrash();
  assert.equal(adminView.total, 1);
  assert.equal(adminView.items[0].title, 'Adult clip');

  userStore.setRestrictions(member.user.id, []); // reset for the next case
});
