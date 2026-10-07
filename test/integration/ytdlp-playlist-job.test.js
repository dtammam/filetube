'use strict';

// [INTEGRATION] v1.369.0 W3 (plan docs/exec-plans/active/2026-10-06-v1369-playlist-picker.md, R7, R8, R9):
// POST /api/ytdlp/download-playlist runs the picked videos as ONE job - one activity row with exact counts and
// the failed ids, one Cancel, a restart that resumes the remainder - over the REAL one-off pipeline
// (launchOneShotJob -> the channel probe -> runExclusive -> runOneShot). Only the two network seams are
// stubbed: run.probeChannel (the channel name per video, R8) and run.runDownload (succeeds or fails per id).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const ytdlpStoreModule = require('../../lib/ytdlp/store');
const run = require('../../lib/ytdlp/run');
const activity = require('../../lib/ytdlp/activity');
const pending = require('../../lib/ytdlp/pending');
const { featureStoreFor, docView } = require('../helpers/scratch-feature-store');

const orig = { runDownload: run.runDownload, probeChannel: run.probeChannel };
const LIST = 'PLUtyNbQXMTLg';
const ID = (n) => ('vid' + String(n).padStart(8, '0')).slice(0, 11); // 11-char safe ids

let tmpDir; let dataDir; let calls; let live; let maxLive; let failIds; let holdMs;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pljob-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pljob-data-'));
  calls = []; live = 0; maxLive = 0; failIds = new Set(); holdMs = 5;
  run.probeChannel = async (watchUrl) => 'Chan ' + new URL(watchUrl).searchParams.get('v').slice(-1);
  run.runDownload = async (sub, cfg, ids) => {
    live += 1; maxLive = Math.max(maxLive, live);
    calls.push({ id: ids[0], folder: sub.name });
    await new Promise((r) => setTimeout(r, holdMs));
    live -= 1;
    return failIds.has(ids[0]) ? { ok: false, code: 1, stdout: '', stderr: '', error: 'yt-dlp exited with code 1' } : { ok: true, code: 0, stdout: '', stderr: '' };
  };
});
afterEach(() => {
  Object.assign(run, orig);
  ytdlp.resetPollRerunStateForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeDeps() {
  const db = {};
  return {
    dataDir,
    ytdlpDb: featureStoreFor(ytdlpStoreModule.FEATURE, db),
    loadDatabase: () => docView(db, featureStoreFor(ytdlpStoreModule.FEATURE, db)),
    updateDatabase: (fn) => Promise.resolve(fn(db)),
    scanDirectories: async () => {},
    getMediaId: (s) => s,
    requireManageSubscriptions: (req, res) => {
      if (req.get('x-test-role') === 'member') { res.status(403).json({ error: 'Forbidden' }); return false; }
      return true;
    },
  };
}
function config() {
  return ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: 'true', FILETUBE_YTDLP_POLL_MINUTES: '0', FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir });
}
async function startApp(deps, opts = {}) {
  const app = express();
  app.use(express.json());
  if (opts.token) app.use((req, _res, next) => { req.auditActor = 'api-token'; next(); });
  ytdlp.registerRoutes(app, deps, config());
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); } };
}
const post = (base, p, body, headers) => fetch(base + p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify(body) });
async function settle(jobId, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const e = activity.getSnapshot().oneShots[jobId];
    if (e && ['done', 'error', 'cancelled'].includes(e.state) && !pending.readPending(dataDir).some((p) => p.jobId === jobId)) return e;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('never settled: ' + JSON.stringify(activity.getSnapshot().oneShots[jobId]));
}
const job = (ids, extra) => Object.assign({ listId: LIST, title: 'Kyle Gordon Is Everywhere', ids, format: 'video', quality: 'best' }, extra || {});

test('W3: one job - exact counts, the failed ids together, one row; each video in ITS channel folder (R8); one at a time', async () => {
  const ids = [1, 2, 3, 4, 5].map(ID);
  failIds = new Set([ids[1], ids[3]]);
  const app = await startApp(makeDeps());
  try {
    const res = await post(app.base, '/api/ytdlp/download-playlist', job(ids));
    assert.strictEqual(res.status, 202);
    const { jobId, total } = await res.json();
    assert.strictEqual(total, 5);
    const e = await settle(jobId);
    assert.strictEqual(e.kind, 'playlist');
    assert.strictEqual(e.state, 'error', 'a failed video keeps the row up (sticky) with its Retry');
    assert.strictEqual(e.title, 'Kyle Gordon Is Everywhere');
    assert.strictEqual(e.total, 5);
    assert.strictEqual(e.done, 3);
    assert.deepStrictEqual(e.failedIds, [ids[1], ids[3]]);
    assert.strictEqual(e.error, '2 of 5 could not be downloaded');
    assert.deepStrictEqual(calls.map((c) => c.id), ids, 'every picked video, in order');
    assert.deepStrictEqual(calls.map((c) => c.folder), ids.map((id) => 'Chan ' + id.slice(-1)), 'each into its own channel folder (the one-off probe)');
    assert.strictEqual(maxLive, 1, 'one video at a time (the heavy queue never holds N of them)');
    const rows = Object.entries(activity.getSnapshot().oneShots).filter(([k, v]) => k.startsWith(jobId) && !v.parent);
    assert.deepStrictEqual(rows.map(([k]) => k), [jobId], 'ONE row the client draws; every video entry names its parent');
    assert.ok(Object.entries(activity.getSnapshot().oneShots).filter(([, v]) => v.parent === jobId).length === 5);
  } finally { await app.close(); }
});

test('W3 (R7): 60 videos are accepted as ONE job, never refused by the one-off queue cap (50)', async () => {
  const ids = Array.from({ length: 60 }, (_, i) => ID(i + 1));
  holdMs = 0;
  const app = await startApp(makeDeps());
  try {
    const res = await post(app.base, '/api/ytdlp/download-playlist', job(ids));
    assert.strictEqual(res.status, 202);
    const e = await settle((await res.json()).jobId, 30000);
    assert.strictEqual(e.done, 60);
    assert.strictEqual(calls.length, 60);
  } finally { await app.close(); }
});

test('W3: Cancel stops the job AND the video running now; nothing after it starts; the row reads cancelled', async () => {
  const ids = [1, 2, 3, 4].map(ID);
  holdMs = 300;
  const app = await startApp(makeDeps());
  try {
    const { jobId } = await (await post(app.base, '/api/ytdlp/download-playlist', job(ids))).json();
    const until = Date.now() + 5000;
    while (calls.length < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
    const c = await post(app.base, `/api/ytdlp/download/${jobId}/cancel`, {});
    assert.strictEqual(c.status, 200);
    const e = await settle(jobId);
    assert.strictEqual(e.state, 'cancelled');
    await new Promise((r) => setTimeout(r, 400));
    assert.strictEqual(calls.length, 2, 'no video starts after the Cancel');
  } finally { await app.close(); }
});

test('W3: a restart resumes the REMAINDER of a persisted job (done and failed ids kept, never re-run)', async () => {
  const ids = [1, 2, 3, 4].map(ID);
  pending.addPending(dataDir, { jobId: 'job-restart', kind: 'playlist', listId: LIST, title: 'T', ids, doneIds: [ids[0]], failedIds: [ids[1]], format: 'video', quality: 'best', createdAt: '2026-10-07T00:00:00.000Z' });
  ytdlp.requeuePendingOneShots(makeDeps(), config());
  const e = await settle('job-restart');
  assert.deepStrictEqual(calls.map((c) => c.id), [ids[2], ids[3]]);
  assert.strictEqual(e.done, 3);
  assert.deepStrictEqual(e.failedIds, [ids[1]]);
});

test('W3: a tampered pending playlist (a hostile id) is dropped on restart, never spawned', async () => {
  pending.addPending(dataDir, { jobId: 'job-bad', kind: 'playlist', listId: LIST, title: 'T', ids: ['ok_id_00001', 'x;rm -rf /'], format: 'video' });
  ytdlp.requeuePendingOneShots(makeDeps(), config());
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(calls.length, 0);
  assert.ok(!pending.readPending(dataDir).some((p) => p.jobId === 'job-bad'));
});

test('W3: the boundary - a bad list, no ids, a hostile id, too many ids, a bad format are 400; duplicates collapse', async () => {
  const app = await startApp(makeDeps());
  try {
    for (const [body, err] of [
      [job([ID(1)], { listId: 'PL;rm' }), 'Invalid playlist'],
      [job([]), 'Choose at least one video'],
      [job([ID(1), 'bad id;x']), 'Invalid video id'],
      [job([ID(1), 42]), 'Invalid video id'],
      [job(Array.from({ length: 1001 }, (_, i) => ID(i))), 'At most 1000 videos at a time'],
      [job([ID(1)], { format: 'exe' }), "format must be 'audio' or 'video'"],
    ]) {
      const res = await post(app.base, '/api/ytdlp/download-playlist', body);
      assert.strictEqual(res.status, 400, err);
      assert.strictEqual((await res.json()).error, err);
    }
    const res = await post(app.base, '/api/ytdlp/download-playlist', job([ID(1), ID(1), ID(2)]));
    const body = await res.json();
    assert.strictEqual(body.total, 2);
    await settle(body.jobId); // never leave a job running into the next test
  } finally { await app.close(); }
});

test('W3 (R9, R10): the API token gains no route here (403), a member without Manage subscriptions gets 403; neither queues', async () => {
  const tok = await startApp(makeDeps(), { token: true });
  try {
    const r = await post(tok.base, '/api/ytdlp/download-playlist', job([ID(1)]));
    assert.strictEqual(r.status, 403);
  } finally { await tok.close(); }
  const app = await startApp(makeDeps());
  try {
    const r = await post(app.base, '/api/ytdlp/download-playlist', job([ID(1)]), { 'x-test-role': 'member' });
    assert.strictEqual(r.status, 403);
  } finally { await app.close(); }
  assert.strictEqual(pending.readPending(dataDir).length, 0);
  assert.strictEqual(calls.length, 0);
});
