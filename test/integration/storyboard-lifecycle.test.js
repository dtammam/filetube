'use strict';

// [INTEGRATION] v1.92 storyboard sprites - the id-keyed .sb.jpg sidecar must
// FOLLOW the media id through the destructive lifecycle (trash -> restore ->
// purge) against the REAL app + routes, exactly like the thumbnail/transcode
// sidecars. Binds three of the six lifecycle re-key/unlink sites the gate
// flagged as correct-but-untested; deleting any of those lines turns a case
// here red (trash re-key -> case 1; restore re-key -> case 2; purge unlink ->
// case 3). Move/prune remain copy-fidelity of the adjacent proven lines.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-sb-lifecycle-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, getMediaId, saveDatabase, storyboardPath, __resetDatabaseForTests } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

const DESC = { v: 1, interval: 3, count: 30, cols: 10, rows: 3, tileW: 160, tileH: 90 };
let server, base, ROOT;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(async () => { await __resetDatabaseForTests(); });

function seedWithSprite() {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-sblib-'));
  fs.mkdirSync(path.join(ROOT, 'Chan'), { recursive: true });
  const filePath = path.join(ROOT, 'Chan', 'movie.mp4');
  fs.writeFileSync(filePath, 'movie-bytes');
  const id = getMediaId(filePath);
  saveDatabase({
    folders: [ROOT], folderSettings: {}, progress: {},
    metadata: {
      [id]: {
        id, name: 'movie.mp4', title: 'The Movie', filePath, folderName: 'Chan',
        rootFolder: ROOT, size: 11, ext: '.mp4', type: 'video', addedAt: 1700000000000, duration: 90,
        storyboard: { ...DESC },
      },
    },
    settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 0 },
  });
  // the on-disk sprite sidecar
  fs.mkdirSync(path.dirname(storyboardPath(id)), { recursive: true });
  fs.writeFileSync(storyboardPath(id), 'SPRITE-BYTES');
  return { id, filePath };
}

const delVideo = (id) => fetch(`${base}/api/videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
const restore = (tid) => fetch(`${base}/api/trash/${encodeURIComponent(tid)}/restore`, { method: 'POST' });
const purge = (tid) => fetch(`${base}/api/trash/${encodeURIComponent(tid)}`, { method: 'DELETE' });

test('storyboard sidecar follows the id through trash -> restore -> purge (no leak, no orphan)', async () => {
  const { id } = seedWithSprite();
  assert.ok(fs.existsSync(storyboardPath(id)), 'precondition: sprite present under the original id');

  // 1) TRASH: the sprite re-keys original -> trashId.
  const tid = (await (await delVideo(id)).json()).trashId;
  assert.ok(tid && tid !== id, 'trash produced a distinct trashId');
  assert.equal(fs.existsSync(storyboardPath(id)), false, 'sprite no longer under the original id after trash');
  assert.ok(fs.existsSync(storyboardPath(tid)), 'sprite re-keyed to the trashId (follows the item into trash)');
  assert.equal(fs.readFileSync(storyboardPath(tid), 'utf8'), 'SPRITE-BYTES', 'same sprite bytes, just re-keyed');

  // 2) RESTORE: the sprite re-keys trashId -> original.
  const resBody = await (await restore(tid)).json();
  assert.equal(resBody.restoredId, id, 'restored under the original id');
  assert.ok(fs.existsSync(storyboardPath(id)), 'sprite restored to the original id');
  assert.equal(fs.existsSync(storyboardPath(tid)), false, 'no trashId sprite left behind after restore');

  // 3) PURGE: re-trash, then purge -> the sprite is unlinked (no leak).
  const tid2 = (await (await delVideo(id)).json()).trashId;
  assert.ok(fs.existsSync(storyboardPath(tid2)), 'sprite under the new trashId before purge');
  const pr = await purge(tid2);
  assert.equal(pr.status, 200);
  assert.equal(fs.existsSync(storyboardPath(tid2)), false, 'purge unlinks the sprite - no orphaned .sb.jpg leak');
  assert.equal(fs.existsSync(storyboardPath(id)), false, 'and nothing lingers under the original id either');
});
