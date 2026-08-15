'use strict';

// [INTEGRATION] v1.128 Wave B (S2b) - the report/status read surfaces
// (census L5-L7). /api/scan-status leaked full-library counts + pending
// transcode TITLES; /api/duplicates(.csv) emitted abs filePaths + counts over
// raw db.metadata. Both are member-reachable (scan-status feeds the library
// page; duplicates renders on the member stats page), so both are FILTERED to
// the requester's visible set, not admin-gated. Admin + unrestricted member
// see the byte-identical full report. Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-report-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, getMediaId, userStore, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, kid, unrestricted;
let pubRoot, hidRoot;

function vid(root, folderName, name, extra = {}) {
  const dir = path.join(root, folderName);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, 'BYTES');
  return { id: getMediaId(fp), title: name.replace(/\.\w+$/, ''), name, filePath: fp, folderName, rootFolder: root, type: 'video', ext: '.mp4', duration: 5, size: 5, addedAt: 1, ...extra };
}

before(async () => {
  pubRoot = path.join(DATA_DIR, 'PublicRoot');
  hidRoot = path.join(DATA_DIR, 'HiddenRoot');
  fs.mkdirSync(pubRoot, { recursive: true }); fs.mkdirSync(hidRoot, { recursive: true });

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin

  // Two visible copies of "dupe.mp4" (a name-dup among visible items) + one
  // HIDDEN pending-transcode item with a telltale title.
  const openA = vid(pubRoot, 'Fam', 'dupe.mp4');
  const openB = vid(pubRoot, 'Fam2', 'dupe.mp4');
  const hidden = vid(hidRoot, 'Vault', 'SECRETMOVIE.avi', { needsTranscode: true, transcodeStatus: 'pending' });
  const hiddenDupe = vid(hidRoot, 'Vault2', 'dupe.mp4');

  saveDatabase({
    folders: [pubRoot, hidRoot], folderSettings: {},
    progress: {}, metadata: { [openA.id]: openA, [openB.id]: openB, [hidden.id]: hidden, [hiddenDupe.id]: hiddenDupe },
    viewCounts: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });

  kid = __mintTestSession({ username: 'kidreport', role: 'member' });
  userStore.setRestrictions(kid.user.id, [{ kind: 'path', value: hidRoot }]);
  unrestricted = __mintTestSession({ username: 'freereport', role: 'member' });
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const getJson = (p, cookie) => fetch(`${base}${p}`, { headers: cookie ? { Cookie: cookie } : {} }).then((r) => r.json());
const getText = (p, cookie) => fetch(`${base}${p}`, { headers: cookie ? { Cookie: cookie } : {} }).then((r) => r.text());

test('L5 /api/scan-status: restricted member sees scoped counts + no hidden transcode title', async () => {
  const admin = await getJson('/api/scan-status', undefined);
  assert.strictEqual(admin.fileCount, 4, 'admin sees all 4 items');
  assert.strictEqual(admin.folderCount, 2, 'admin sees both roots');
  assert.ok(admin.transcodeNames.includes('SECRETMOVIE'), 'admin sees the pending transcode title');

  const free = await getJson('/api/scan-status', unrestricted.cookie);
  assert.strictEqual(free.fileCount, 4, 'unrestricted member: full count');
  assert.strictEqual(free.folderCount, 2, 'unrestricted member: full folder count');

  const k = await getJson('/api/scan-status', kid.cookie);
  assert.strictEqual(k.fileCount, 2, 'restricted: only the 2 visible items');
  assert.strictEqual(k.folderCount, 1, 'restricted: only the visible root');
  assert.deepStrictEqual(k.transcodeNames, [], 'restricted: the hidden pending transcode is not named');
  assert.ok(!JSON.stringify(k).includes('SECRETMOVIE'), 'no hidden title anywhere');
});

test('L6 /api/duplicates: restricted member sees only dupes among visible items', async () => {
  const admin = await getJson('/api/duplicates', undefined);
  // 3 files named dupe.mp4 across visible+hidden -> one name group for admin.
  const adminNameGroup = admin.nameGroups.find((g) => g.key === 'dupe.mp4');
  assert.ok(adminNameGroup && adminNameGroup.items.length === 3, 'admin: all 3 dupe.mp4 grouped');

  const k = await getJson('/api/duplicates', kid.cookie);
  const kidNameGroup = k.nameGroups.find((g) => g.key === 'dupe.mp4');
  assert.ok(kidNameGroup && kidNameGroup.items.length === 2, 'restricted: only the 2 VISIBLE dupe.mp4');
  assert.ok(!JSON.stringify(k).includes(hidRoot), 'no hidden abs path in the report');
  assert.ok(!JSON.stringify(k).includes('Vault'), 'no hidden folder in the report');
});

test('L7 /api/duplicates.csv: restricted member CSV carries no hidden path', async () => {
  const adminCsv = await getText('/api/duplicates.csv', undefined);
  assert.ok(adminCsv.includes(hidRoot), 'admin CSV includes the hidden path');
  const kidCsv = await getText('/api/duplicates.csv', kid.cookie);
  assert.ok(!kidCsv.includes(hidRoot), 'restricted CSV excludes the hidden path');
  assert.ok(!kidCsv.includes('SECRETMOVIE'), 'restricted CSV excludes hidden titles');
});
