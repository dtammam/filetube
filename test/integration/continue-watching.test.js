'use strict';

// [INTEGRATION] v1.72 (cap 5) - the videos "Continue watching" selection:
// GET /api/videos?filter=recent-watching. The music recent-listening
// contract ported to media: saved position > 0, most recently updated
// first, read-your-writes through the pendingProgress overlay - PLUS the
// media-only exclusion: a finished item (watched latch or >=90% live
// position) is not "in progress" and never rides the row. Actor-scoped:
// a second real session sees an empty selection.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-continuewatch-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, __mintTestSession, userStore } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, uid;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const auth = authenticateFetch(server, base);
  uid = auth.user.id;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

function seedItem(id) {
  return {
    id, title: id, filePath: `/media/${id}.mp4`, folderName: 'media',
    type: 'video', ext: '.mp4', duration: 100, size: 1000, addedAt: 5000,
  };
}

const postJson = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('recent-watching: position>0 items newest-update-first; finished (latched or >=90%) and untouched items excluded; overlay is read-your-writes', async () => {
  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: { cwA: seedItem('cwA'), cwB: seedItem('cwB'), cwC: seedItem('cwC'), cwD: seedItem('cwD'), cwE: seedItem('cwE') },
    liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
  // Committed rows with explicit update stamps: A older, E at 95% (the
  // derivation-only watched arm - never latched).
  userStore.setProgress(uid, 'cwA', { timestamp: 30, duration: 100, updatedAt: '2026-08-01T00:00:00Z' });
  userStore.setProgress(uid, 'cwE', { timestamp: 95, duration: 100, updatedAt: '2026-08-01T02:00:00Z' });
  // B: mid-progress but LATCHED (the sticky completion) - excluded.
  userStore.setProgress(uid, 'cwB', { timestamp: 40, duration: 100, updatedAt: '2026-08-01T01:00:00Z' });
  userStore.markWatched(uid, 'cwB', '2026-08-01T01:00:00Z');
  // D: the freshest signal arrives through the ROUTE (coalescer overlay,
  // not yet flushed) - must rank first without any flush.
  const ping = await postJson('/api/progress', { id: 'cwD', timestamp: 10, duration: 100 });
  assert.strictEqual(ping.status, 200);

  const body = await (await fetch(`${base}/api/videos?filter=recent-watching&limit=10`)).json();
  assert.deepStrictEqual(body.items.map((i) => i.id), ['cwD', 'cwA'],
    'overlay-fresh D first, then A; B (latch), E (>=90%), C (untouched) excluded');
  assert.strictEqual(body.total, 2);
  assert.ok(body.items.every((i) => i.progressPercent > 0), 'the page shaping carries real progress for the row bar');
});

test('recent-watching is actor-scoped: a second real session sees an empty selection', async () => {
  const second = __mintTestSession({ username: 'continueOther' });
  const r = await fetch(`${base}/api/videos?filter=recent-watching`, { headers: { Cookie: second.cookie } });
  assert.strictEqual(r.status, 200);
  const body = await r.json();
  assert.strictEqual(body.total, 0);
  assert.deepStrictEqual(body.items, []);
});
