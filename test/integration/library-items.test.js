'use strict';

// [INTEGRATION] v1.159 (Dean): GET /api/library-items backs the Stats "Videos &
// audio" sortable table. It returns per-item TITLES, so the security property is
// the point: VISIBILITY-SCOPED exactly like /api/stats - a restricted member
// must never see a hidden item's title or size through it (the v1.80 leak class).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-libitems-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, userStore, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, member;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // admin
  member = __mintTestSession({ username: 'libmember', role: 'member' });

  saveDatabase({
    folders: [process.env.DATA_DIR], folderSettings: {}, progress: {},
    metadata: {
      open: { id: 'open', title: 'Open Clip', name: 'open.mp4', filePath: path.join(process.env.DATA_DIR, 'Open', 'open.mp4'), folderName: 'Open', rootFolder: process.env.DATA_DIR, type: 'video', ext: '.mp4', duration: 60, size: 100, addedAt: 1 },
      song: { id: 'song', title: 'Open Song', name: 'song.mp3', filePath: path.join(process.env.DATA_DIR, 'Open', 'song.mp3'), folderName: 'Open', rootFolder: process.env.DATA_DIR, type: 'audio', ext: '.mp3', duration: 200, size: 50, addedAt: 2 },
      adult: { id: 'adult', title: 'SECRET Adult Film', name: 'adult.mp4', filePath: path.join(process.env.DATA_DIR, 'Adult', 'adult.mp4'), folderName: 'Adult', rootFolder: process.env.DATA_DIR, type: 'video', ext: '.mp4', duration: 90, size: 400, addedAt: 3 },
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

const items = (cookie) => fetch(`${base}/api/library-items`, cookie ? { headers: { Cookie: cookie } } : undefined).then((r) => r.json());

test('admin: every item, lean shape (id/title/type/duration/size, no filePath)', async () => {
  const body = await items();
  assert.strictEqual(body.total, 3);
  const byId = Object.fromEntries(body.items.map((i) => [i.id, i]));
  assert.strictEqual(byId.open.title, 'Open Clip');
  assert.strictEqual(byId.song.type, 'audio');
  assert.strictEqual(byId.adult.durationSeconds, 90);
  assert.strictEqual(byId.adult.sizeBytes, 400);
  assert.ok(!('filePath' in byId.open), 'lean payload: no filePath leaks to the client');
});

test('restricted member: the hidden Adult item is ABSENT - no title, no size, no count', async () => {
  const body = await items(member.cookie);
  assert.strictEqual(body.total, 2, 'only the two Open items');
  const titles = body.items.map((i) => i.title);
  assert.ok(!titles.some((t) => /SECRET|Adult/.test(t)), 'the restricted title never leaks');
  assert.ok(!body.items.some((i) => i.id === 'adult'), 'the restricted item is not present at all');
});
