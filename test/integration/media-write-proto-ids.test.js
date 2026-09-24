'use strict';

// [INTEGRATION] Chapter Snap gate r2 (security-brief S-5 MEDIUM, 2026-09-24): the
// media index is a PLAIN object, so a write route that resolved the request id with
// `db.metadata[req.params.id]` found Object.prototype for `__proto__` and the inherited
// Object / Object.prototype.toString functions for `constructor` / `toString`. A
// `POST /api/videos/__proto__/chapters` then wrote `chaptersManual` onto
// Object.prototype for the whole process - every item inherited it, and the next scan's
// Phase-2 merge persisted it onto items as their OWN chapters (likes re-pointed
// library-wide). Every WRITE route in lib/media/routes.js now resolves ids through an
// own-property lookup (ownMediaItem). Bound here through the REAL routes: each hostile
// id is a 404 and NOTHING lands on a shared prototype or constructor.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-proto-ids-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, getMediaId } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-proto-ids-lib-'));
  const filePath = path.join(root, 'real.mp4');
  fs.writeFileSync(filePath, 'bytes');
  const id = getMediaId(filePath);
  seedState({
    folders: [root], folderSettings: {}, liked: [],
    // attributeControlEnabled: the attribution route is opt-in; ON so it is reachable.
    settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 0, attributeControlEnabled: true },
    metadata: { [id]: { id, name: 'real.mp4', title: 'Real', filePath, folderName: 'x', rootFolder: root, type: 'video', ext: '.mp4', duration: 10, size: 5, addedAt: 1 } },
  });
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const HOSTILE = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

function assertNothingPolluted(label) {
  for (const k of ['chaptersManual', 'width', 'height', 'channelAttributedManually', 'channelUrl', 'channelName']) {
    assert.strictEqual(({})[k], undefined, `${label}: Object.prototype.${k} stays unset`);
    assert.strictEqual(Object[k], undefined, `${label}: Object.${k} stays unset`);
    assert.strictEqual(Object.prototype.toString[k], undefined, `${label}: toString.${k} stays unset`);
  }
}

for (const id of HOSTILE) {
  test(`id "${id}": every media WRITE route answers 404 and writes nothing onto a shared prototype`, async () => {
    const enc = encodeURIComponent(id);
    const chapters = await post(`/api/videos/${enc}/chapters`, { text: '0:00 A\n1:00 B' });
    assert.strictEqual(chapters.status, 404, 'POST /chapters');
    const dims = await post(`/api/videos/${enc}/dimensions`, { width: 640, height: 360 });
    assert.strictEqual(dims.status, 404, 'POST /dimensions');
    const attr = await post(`/api/videos/${enc}/attribute-channel`, { clear: true });
    assert.strictEqual(attr.status, 404, 'POST /attribute-channel (clear)');
    const prep = await post(`/api/videos/${enc}/prepare-audio`, {});
    assert.strictEqual(prep.status, 404, 'POST /prepare-audio');
    const del = await fetch(`${base}/api/videos/${enc}`, { method: 'DELETE' });
    assert.strictEqual(del.status, 404, 'DELETE /api/videos/:id');
    assertNothingPolluted(id);
  });
}

test('discrimination: the same routes still reach a REAL item (the guard is on the id, not the route)', async () => {
  const list = await (await fetch(`${base}/api/videos?limit=5`)).json();
  const real = list.items[0];
  assert.ok(real, 'the seeded item is listed');
  const r = await post(`/api/videos/${encodeURIComponent(real.id)}/chapters`, { text: '0:00 A\n0:05 B' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual((await r.json()).chapters.map((c) => c.title), ['A', 'B']);
  assertNothingPolluted('real item');
});
