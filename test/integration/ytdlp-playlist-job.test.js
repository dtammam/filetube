'use strict';

// [INTEGRATION] v1.370.0 W3 (plan docs/exec-plans/active/2026-10-06-v1370-playlist-picker.md, R7, R8, R9):
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

// ---- gate r1 --------------------------------------------------------------------------------------------
test('gate r1 W3: Cancel KILLS the video running now (its process), and that video is neither done nor failed', async () => {
  const ids = [1, 2, 3].map(ID);
  const kills = [];
  run.runDownload = async (sub, cfg, vids, opts) => {
    calls.push({ id: vids[0], folder: sub.name });
    return new Promise((resolve) => {
      const child = { pid: 4242, kill: () => { kills.push(vids[0]); resolve({ ok: false, code: null, stdout: '', stderr: '', error: 'killed' }); } };
      if (opts && typeof opts.onChild === 'function') opts.onChild(child);
      if (vids[0] !== ids[1]) setTimeout(() => resolve({ ok: true, code: 0, stdout: '', stderr: '' }), 5);
    });
  };
  const app = await startApp(makeDeps());
  try {
    const { jobId } = await (await post(app.base, '/api/ytdlp/download-playlist', job(ids))).json();
    const until = Date.now() + 5000;
    while (calls.length < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual((await post(app.base, `/api/ytdlp/download/${jobId}/cancel`, {})).status, 200);
    const e = await settle(jobId);
    assert.deepStrictEqual(kills, [ids[1]], 'the running video\'s process was killed');
    assert.strictEqual(e.state, 'cancelled');
    assert.strictEqual(e.done, 1);
    assert.deepStrictEqual(e.failedIds, [], 'the stopped video is not a failure');
    assert.deepStrictEqual(calls.map((c) => c.id), ids.slice(0, 2), 'nothing after it starts');
  } finally { await app.close(); }
});

test('gate r1 W3: a video another job is already downloading is WAITED for, never written twice', async () => {
  const ids = [1, 2].map(ID);
  let release;
  const held = new Promise((r) => { release = r; });
  run.runDownload = async (sub, cfg, vids) => {
    calls.push({ id: vids[0], folder: sub.name });
    if (vids[0] === ids[0] && calls.filter((c) => c.id === ids[0]).length === 1) await held;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
  const app = await startApp(makeDeps());
  try {
    const one = await post(app.base, '/api/ytdlp/download', { url: `https://www.youtube.com/watch?v=${ids[0]}`, format: 'video', quality: 'best' });
    assert.strictEqual(one.status, 202);
    const until = Date.now() + 5000;
    while (!calls.length && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
    const { jobId } = await (await post(app.base, '/api/ytdlp/download-playlist', job(ids))).json();
    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(calls.filter((c) => c.id === ids[0]).length, 1, 'the playlist waits instead of a second writer');
    release();
    const e = await settle(jobId);
    assert.strictEqual(calls.filter((c) => c.id === ids[0]).length, 1, 'one download of that video in all');
    assert.strictEqual(e.done, 2, 'the joined video counts as done');
  } finally { await app.close(); }
});

test('gate r1 W1: the stuck sweep leaves a RUNNING playlist job alone (no process of its own, its row moves between videos)', async () => {
  const ids = [1, 2].map(ID);
  let release;
  const held = new Promise((r) => { release = r; });
  run.runDownload = async (sub, cfg, vids) => { calls.push({ id: vids[0] }); await held; return { ok: true, code: 0, stdout: '', stderr: '' }; };
  const app = await startApp(makeDeps());
  try {
    const { jobId } = await (await post(app.base, '/api/ytdlp/download-playlist', job(ids))).json();
    const until = Date.now() + 5000;
    while (!calls.length && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
    ytdlp.sweepStuckOneShots(Date.now() + 11 * 60 * 1000);
    assert.strictEqual(activity.getSnapshot().oneShots[jobId].state, 'downloading', 'not swept while it runs');
    release();
    await settle(jobId);
  } finally { await app.close(); }
});

test('gate r1 W2: a full pending file refuses a playlist (503) instead of dropping an accepted one-off; a job\'s progress is rewritten IN PLACE', async () => {
  for (let i = 0; i < pending.MAX_PENDING_ONESHOTS; i++) pending.addPending(dataDir, { jobId: 'one-' + i, url: 'https://www.youtube.com/watch?v=' + ID(i), format: 'video' });
  const app = await startApp(makeDeps());
  try {
    const res = await post(app.base, '/api/ytdlp/download-playlist', job([ID(900)]));
    assert.strictEqual(res.status, 503);
    assert.strictEqual(pending.readPending(dataDir).length, pending.MAX_PENDING_ONESHOTS);
    assert.ok(pending.readPending(dataDir).every((e) => /^one-/.test(e.jobId)), 'every accepted one-off still persisted');
  } finally { await app.close(); }
  fs.writeFileSync(path.join(dataDir, pending.PENDING_FILENAME), '[]');
  pending.addPending(dataDir, { jobId: 'pl', kind: 'playlist', ids: ['a'] });
  pending.addPending(dataDir, { jobId: 'after', url: 'u' });
  pending.updatePending(dataDir, { jobId: 'pl', kind: 'playlist', ids: ['a'], doneIds: ['a'] });
  assert.deepStrictEqual(pending.readPending(dataDir).map((e) => e.jobId), ['pl', 'after'], 'rewritten in place, never moved to the end');
  pending.updatePending(dataDir, { jobId: 'never-added', kind: 'playlist' });
  assert.ok(!pending.readPending(dataDir).some((e) => e.jobId === 'never-added'), 'an absent job is never resurrected');
});

test('gate r1 W2: a RUNNING job rewrites its own pending entry in place after each video (never moved past a later one-off)', async () => {
  const ids = [1, 2].map(ID);
  let release;
  const held = new Promise((r) => { release = r; });
  // the later one-off is held too, so it stays in the file while the playlist moves
  run.runDownload = async (sub, cfg, vids) => { calls.push({ id: vids[0] }); if (vids[0] === ids[1] || vids[0] === ID(99)) await held; return { ok: true, code: 0, stdout: '', stderr: '' }; };
  pending.addPending(dataDir, { jobId: 'job-order', kind: 'playlist', listId: LIST, title: 'T', ids, doneIds: [], failedIds: [], format: 'video', quality: 'best', createdAt: '2026-10-07T00:00:00.000Z' });
  pending.addPending(dataDir, { jobId: 'later-one-off', url: 'https://www.youtube.com/watch?v=' + ID(99), format: 'video' });
  ytdlp.requeuePendingOneShots(Object.assign(makeDeps(), {}), config());
  const until = Date.now() + 5000;
  const doneOf = () => ((pending.readPending(dataDir).find((e) => e.jobId === 'job-order') || {}).doneIds || []).length;
  while (doneOf() < 1 && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
  const mid = pending.readPending(dataDir);
  assert.deepStrictEqual(mid.map((e) => e.jobId), ['job-order', 'later-one-off'], 'the job is still first: rewritten in place');
  assert.deepStrictEqual(mid.find((e) => e.jobId === 'job-order').doneIds, [ids[0]], 'its progress is written');
  release();
  await settle('job-order');
});

test('gate r2: a FULL pending file refuses a one-off too (503) - even when the heavy queue is under its cap because a playlist video waits on another job', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  run.runDownload = async (sub, cfg, vids) => { calls.push({ id: vids[0] }); await held; return { ok: true, code: 0, stdout: '', stderr: '' }; };
  const app = await startApp(makeDeps());
  try {
    // X downloads (held); a playlist of X waits on it (joined: outside the queue)
    assert.strictEqual((await post(app.base, '/api/ytdlp/download', { url: `https://www.youtube.com/watch?v=${ID(1)}`, format: 'video' })).status, 202);
    const until = Date.now() + 5000;
    while (!calls.length && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual((await post(app.base, '/api/ytdlp/download-playlist', job([ID(1)]))).status, 202);
    // fill the file to its cap with accepted entries written directly (the queue stays short)
    const have = pending.readPending(dataDir).length;
    for (let i = 0; i < pending.MAX_PENDING_ONESHOTS - have; i++) pending.addPending(dataDir, { jobId: 'fill-' + i, url: 'https://www.youtube.com/watch?v=' + ID(500 + i), format: 'video' });
    const before = pending.readPending(dataDir).map((e) => e.jobId);
    const res = await post(app.base, '/api/ytdlp/download', { url: `https://www.youtube.com/watch?v=${ID(999)}`, format: 'video' });
    assert.strictEqual(res.status, 503, 'the one-off is refused, not accepted and then dropped off the file');
    assert.deepStrictEqual(pending.readPending(dataDir).map((e) => e.jobId), before, 'every accepted job still persisted');
  } finally { release(); await new Promise((r) => setTimeout(r, 50)); await app.close(); }
});
