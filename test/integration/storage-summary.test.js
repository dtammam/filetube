'use strict';

// [INTEGRATION] v1.158 (Dean) - GET /api/storage-summary: the account ("You")
// menu's "Total size on disk" figure. Two invariants:
//   1. it MATCHES the Stats page's "Total size on disk" tile exactly (both are
//      computeLibraryStats(visibleMetadata).totalSizeBytes) - sourced from the
//      same function so the two numbers can never drift; and
//   2. it is VISIBILITY-SCOPED (the census marks it GATED): a restricted member
//      sees only their visible bytes, never the hidden item's size.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-storagesum-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, userStore, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, member;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // admin
  member = __mintTestSession({ username: 'storagemember', role: 'member' });

  // Two media items: an open one (100) and a restricted-folder one (400).
  saveDatabase({
    folders: [process.env.DATA_DIR], folderSettings: {}, progress: {},
    metadata: {
      open: { id: 'open', title: 'Open', name: 'open.mp4', filePath: path.join(process.env.DATA_DIR, 'Open', 'open.mp4'), folderName: 'Open', rootFolder: process.env.DATA_DIR, type: 'video', ext: '.mp4', duration: 10, size: 100, addedAt: 1 },
      adult: { id: 'adult', title: 'Adult', name: 'adult.mp4', filePath: path.join(process.env.DATA_DIR, 'Adult', 'adult.mp4'), folderName: 'Adult', rootFolder: process.env.DATA_DIR, type: 'video', ext: '.mp4', duration: 10, size: 400, addedAt: 2 },
    },
    settings: { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0 },
  });
  userStore.setRestrictions(member.user.id, [{ kind: 'folder', value: 'Adult' }]);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

const summary = (cookie) => fetch(`${base}/api/storage-summary`, cookie ? { headers: { Cookie: cookie } } : undefined).then((r) => r.json());
const stats = (cookie) => fetch(`${base}/api/stats`, cookie ? { headers: { Cookie: cookie } } : undefined).then((r) => r.json());

test('admin: total == every item AND == the Stats "Total size on disk" tile', async () => {
  const s = await summary();
  assert.equal(s.totalSizeBytes, 500, 'admin sees both items (100 + 400)');
  const st = await stats();
  assert.equal(s.totalSizeBytes, st.totalSizeBytes, 'the You-menu figure equals the Stats tile');
});

test('restricted member: total is the VISIBLE bytes only (no hidden 400), and still matches their Stats tile', async () => {
  const s = await summary(member.cookie);
  assert.equal(s.totalSizeBytes, 100, 'the restricted Adult item (400) never joins the total');
  const st = await stats(member.cookie);
  assert.equal(s.totalSizeBytes, st.totalSizeBytes, 'still equals the member\'s own Stats tile');
});
