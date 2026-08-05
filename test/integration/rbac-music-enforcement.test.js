'use strict';

// [INTEGRATION] v1.80 RBAC T5 - MUSIC enforcement. A member restricted on a
// music root (path) is 404'd on /track + /albumart and omitted from every
// music list + the liked set; an unrestricted track and the admin are
// unaffected. Isolated DATA_DIR; own process; cleans up.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-music-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, updateDatabase, userStore, __mintTestSession } = require('../../server');
const musicStore = require('../../lib/music/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, member;
const blockedFile = path.join(DATA_DIR, 'adult.mp3');
const allowedFile = path.join(DATA_DIR, 'kids.mp3');

before(async () => {
  fs.writeFileSync(blockedFile, 'BLOCKED');
  fs.writeFileSync(allowedFile, 'ALLOWED');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks = {
      blk: { id: 'blk', title: 'Explicit', artist: 'X', album: 'A', filePath: blockedFile, rootFolder: path.join(DATA_DIR, 'adult'), folderName: 'adult', ext: '.mp3', codec: 'mp3', durationSec: 100, albumArtKey: null, addedAt: '2026-01-02T00:00:00Z' },
      ok: { id: 'ok', title: 'Nursery', artist: 'Y', album: 'B', filePath: allowedFile, rootFolder: path.join(DATA_DIR, 'kids'), folderName: 'kids', ext: '.mp3', codec: 'mp3', durationSec: 100, albumArtKey: null, addedAt: '2026-01-01T00:00:00Z' },
    };
    return true;
  });
  member = __mintTestSession({ username: 'kidmusic', role: 'member' });
  userStore.addMusicLiked(member.user.id, 'blk', '2026-08-05T00:00:00Z');
  userStore.addMusicLiked(member.user.id, 'ok', '2026-08-05T00:00:00Z');
  // Restrict the member on the "adult" music root (prefix).
  userStore.setRestrictions(member.user.id, [{ kind: 'path', value: path.join(DATA_DIR, 'adult') }]);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});
const asMember = (p) => fetch(`${base}${p}`, { headers: { Cookie: member.cookie } });
const asAdmin = (p) => fetch(`${base}${p}`);

test('MUSIC: restricted member is 404 on serve + omitted from lists; admin unaffected', async () => {
  assert.strictEqual((await asMember('/track/blk')).status, 404);
  assert.strictEqual((await asMember('/track/ok')).status, 200);
  assert.strictEqual((await asMember('/track/blk?download=1')).status, 404, 'download is not an escape');
  assert.strictEqual((await asMember('/albumart/blk')).status, 404);
  assert.strictEqual((await asMember('/api/music/blk')).status, 404);
  assert.strictEqual((await asMember('/api/music/ok')).status, 200);

  const ids = ((await (await asMember('/api/music?limit=50')).json()).items || []).map((i) => i.id);
  assert.deepStrictEqual(ids, ['ok'], '/api/music omits the restricted track');
  const liked = (await (await asMember('/api/music/liked')).json()).trackIds;
  assert.deepStrictEqual(liked, ['ok'], 'restricted track id never leaks into liked');

  // admin sees + serves both
  assert.strictEqual((await asAdmin('/track/blk')).status, 200);
  const adminIds = ((await (await asAdmin('/api/music?limit=50')).json()).items || []).map((i) => i.id).sort();
  assert.deepStrictEqual(adminIds, ['blk', 'ok']);
});
