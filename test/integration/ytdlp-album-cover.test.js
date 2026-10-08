'use strict';

// [INTEGRATION] v1.374.0 (d) one cover art for a saved album (plan docs/exec-plans/active/2026-10-08-v1374-music-pass-cover.md,
// R1, R2): POST /api/ytdlp/download-playlist with album.coverId over the REAL one-off pipeline (launchOneShotJob ->
// runExclusive -> runOneShot). The network seams are stubbed (run.probeChannel, run.runDownload - which writes a REAL file
// and returns the FTCHSRC / FTCHDST lines a clean audio exit carries), and so are the cover module's two tool-facing calls
// (prepareAlbumCover, reembedCover), so the wiring is bound here: the ORDER against the scan, the R1 rule, once-per-job,
// the failure posture, the pending round trip. The re-embed itself is bound in test/unit/ytdlp-cover.test.js; the real
// yt-dlp + ffmpeg end to end is the plan's evidence.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const ytdlpStoreModule = require('../../lib/ytdlp/store');
const run = require('../../lib/ytdlp/run');
const cover = require('../../lib/ytdlp/cover');
const activity = require('../../lib/ytdlp/activity');
const pending = require('../../lib/ytdlp/pending');
const { featureStoreFor, docView } = require('../helpers/scratch-feature-store');

const orig = { runDownload: run.runDownload, probeChannel: run.probeChannel, prepareAlbumCover: cover.prepareAlbumCover, reembedCover: cover.reembedCover, releaseAlbumCover: cover.releaseAlbumCover };
const LIST = 'PLUtyNbQXMTLg';
const ID = (n) => ('vid' + String(n).padStart(8, '0')).slice(0, 11);
const COVER_ID = 'c1Paj8je5sM';

let tmpDir; let dataDir; let calls; let prepared; let reembeds; let released; let downloadShape;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cover-job-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cover-job-data-'));
  calls = []; prepared = []; reembeds = []; released = []; downloadShape = (r) => r;
  run.probeChannel = async () => 'Kyle Gordon';
  // a clean audio exit: the file on disk (written NOW, so it is fresh) and the lines run.js parses from it
  run.runDownload = async (sub, cfg, ids) => {
    const folder = path.join(tmpDir, sub.name);
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `Song [${ids[0]}].mp3`);
    fs.writeFileSync(file, 'AUDIO-WITH-OWN-ART');
    calls.push({ id: ids[0], file });
    return downloadShape({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [], alreadyDownloaded: false,
      sourceFiles: [{ real: true, path: path.join(folder, `Song [${ids[0]}].webm`) }], finalFiles: [file] }, file);
  };
  cover.prepareAlbumCover = async (id) => { prepared.push(id); return { ok: true, path: '/covers/cover.jpg', dir: '/covers' }; };
  cover.reembedCover = async (file, coverPath) => {
    reembeds.push({ file, coverPath });
    await new Promise((r) => setTimeout(r, 30)); // a real ffmpeg takes a while: a scan triggered first would win the race
    fs.writeFileSync(file, 'AUDIO-WITH-ALBUM-COVER');
    return { ok: true };
  };
  cover.releaseAlbumCover = (c) => { released.push(c); };
});
afterEach(() => {
  Object.assign(run, { runDownload: orig.runDownload, probeChannel: orig.probeChannel });
  Object.assign(cover, { prepareAlbumCover: orig.prepareAlbumCover, reembedCover: orig.reembedCover, releaseAlbumCover: orig.releaseAlbumCover });
  ytdlp.resetPollRerunStateForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeDeps(scanSeen) {
  const db = {};
  return {
    dataDir,
    ytdlpDb: featureStoreFor(ytdlpStoreModule.FEATURE, db),
    loadDatabase: () => docView(db, featureStoreFor(ytdlpStoreModule.FEATURE, db)),
    updateDatabase: (fn) => Promise.resolve(fn(db)),
    // the scan, at the moment the job triggers it: what each downloaded file holds (the scan reads the cover then)
    scanDirectories: async () => { if (scanSeen) scanSeen.push(calls.map((c) => [c.id, fs.readFileSync(c.file, 'utf8')])); },
    getMediaId: (s) => s,
    requireManageSubscriptions: () => true,
  };
}
function config() {
  return ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: 'true', FILETUBE_YTDLP_POLL_MINUTES: '0', FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir });
}
async function startApp(deps) {
  const app = express();
  app.use(express.json());
  ytdlp.registerRoutes(app, deps, config());
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); } };
}
const post = (base, p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function settle(jobId, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const e = activity.getSnapshot().oneShots[jobId];
    if (e && ['done', 'error', 'cancelled'].includes(e.state) && !pending.readPending(dataDir).some((p) => p.jobId === jobId)) return e;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('never settled: ' + JSON.stringify(activity.getSnapshot().oneShots[jobId]));
}
const ALBUM = (ids, extra) => Object.assign({ title: 'Brat', artist: 'Charli xcx', cleanTitles: false, tracks: Object.fromEntries(ids.map((id, i) => [id, i + 1])) }, extra || {});
const job = (ids, album) => ({ listId: LIST, title: 'Brat', ids, format: 'audio', quality: 'best', filetype: 'mp3', album });
const startJob = async (app, body) => { const r = await post(app.base, '/api/ytdlp/download-playlist', body); assert.strictEqual(r.status, 202); return (await r.json()).jobId; };

test('the cover is written into each track BEFORE the job triggers the scan (the scan reads the embedded cover)', async () => {
  const ids = [1, 2].map(ID);
  const seen = [];
  const app = await startApp(makeDeps(seen));
  try {
    const e = await settle(await startJob(app, job(ids, ALBUM(ids, { coverId: COVER_ID }))));
    assert.strictEqual(e.state, 'done');
  } finally { await app.close(); }
  assert.deepStrictEqual(reembeds.map((r) => [path.basename(r.file), r.coverPath]), ids.map((id) => [`Song [${id}].mp3`, '/covers/cover.jpg']));
  assert.strictEqual(seen.length, 2, 'one scan trigger per track');
  assert.deepStrictEqual(seen[0], [[ids[0], 'AUDIO-WITH-ALBUM-COVER']], 'track 1 already had the cover when its scan was triggered');
  assert.deepStrictEqual(seen[1], [[ids[0], 'AUDIO-WITH-ALBUM-COVER'], [ids[1], 'AUDIO-WITH-ALBUM-COVER']]);
});

test('a crash orphan (.ftcover-<pid>-<12hex>.tmp) in the album\'s folder is swept by the next cover job there; nothing else is', async () => {
  const ids = [1].map(ID);
  const folder = path.join(tmpDir, 'Kyle Gordon');
  fs.mkdirSync(folder, { recursive: true });
  const orphan = path.join(folder, '.ftcover-4242-0123456789ab.tmp');
  const keep = path.join(folder, 'Earlier song [vid00000099].mp3');
  fs.writeFileSync(orphan, 'half-written');
  fs.writeFileSync(keep, 'kept');
  const app = await startApp(makeDeps());
  try { await settle(await startJob(app, job(ids, ALBUM(ids, { coverId: COVER_ID })))); } finally { await app.close(); }
  assert.strictEqual(reembeds.length, 1);
  assert.strictEqual(fs.existsSync(orphan), false, 'the orphan is gone');
  assert.strictEqual(fs.readFileSync(keep, 'utf8'), 'kept', 'a library file beside it is untouched');
});

test('the cover is fetched ONCE per job (not per track), for the picked id, and released when the job ends', async () => {
  const ids = [1, 2, 3].map(ID);
  const app = await startApp(makeDeps());
  try { await settle(await startJob(app, job(ids, ALBUM(ids, { coverId: COVER_ID })))); } finally { await app.close(); }
  assert.deepStrictEqual(prepared, [COVER_ID]);
  assert.strictEqual(reembeds.length, 3);
  assert.deepStrictEqual(released, [{ ok: true, path: '/covers/cover.jpg', dir: '/covers' }]);
});

test('R1: a video ANY library already has gets no cover (no album work at all); a job whose every track is known fetches nothing', async () => {
  const ids = [1, 2, 3].map(ID);
  const deps = makeDeps();
  const realLoad = deps.loadDatabase;
  deps.loadDatabase = () => Object.assign({}, realLoad(), { metadata: { m1: { youtubeId: ids[1], filePath: '/x/b.mp3' } } });
  const app = await startApp(deps);
  try { await settle(await startJob(app, job(ids, ALBUM(ids, { coverId: COVER_ID })))); } finally { await app.close(); }
  assert.deepStrictEqual(reembeds.map((r) => path.basename(r.file)), [`Song [${ids[0]}].mp3`, `Song [${ids[2]}].mp3`]);
  prepared = []; reembeds = [];
  const deps2 = makeDeps();
  deps2.loadDatabase = () => ({ metadata: { a: { youtubeId: ids[0] }, b: { youtubeId: ids[1] } } });
  const app2 = await startApp(deps2);
  try { await settle(await startJob(app2, job(ids.slice(0, 2), ALBUM(ids.slice(0, 2), { coverId: COVER_ID })))); } finally { await app2.close(); }
  assert.deepStrictEqual(prepared, [], 'nothing to cover: nothing fetched');
  assert.deepStrictEqual(reembeds, []);
});

test('a cover fetch that fails is tried once, every track keeps its own art, and the job succeeds', async () => {
  const ids = [1, 2].map(ID);
  cover.prepareAlbumCover = async (id) => { prepared.push(id); return { ok: false, reason: 'maxresdefault.jpg: HTTP 404; hqdefault.jpg: HTTP 404' }; };
  const app = await startApp(makeDeps());
  let e;
  try { e = await settle(await startJob(app, job(ids, ALBUM(ids, { coverId: COVER_ID })))); } finally { await app.close(); }
  assert.strictEqual(e.state, 'done');
  assert.strictEqual(e.done, 2);
  assert.deepStrictEqual(prepared, [COVER_ID], 'once, not per track');
  assert.deepStrictEqual(reembeds, []);
  assert.deepStrictEqual(released, [], 'nothing to release');
  calls.forEach((c) => assert.strictEqual(fs.readFileSync(c.file, 'utf8'), 'AUDIO-WITH-OWN-ART'));
});

test('a re-embed that fails (or throws) never fails the track', async () => {
  const ids = [1, 2].map(ID);
  let n = 0;
  cover.reembedCover = async () => { n += 1; if (n === 1) return { ok: false, reason: 'ffmpeg failed (1)' }; throw new Error('boom'); };
  const app = await startApp(makeDeps());
  let e;
  try { e = await settle(await startJob(app, job(ids, ALBUM(ids, { coverId: COVER_ID })))); } finally { await app.close(); }
  assert.strictEqual(e.state, 'done');
  assert.strictEqual(e.done, 2);
});

test('no cover picked = today\'s job: nothing fetched, nothing rewritten', async () => {
  const ids = [1, 2].map(ID);
  const app = await startApp(makeDeps());
  try { await settle(await startJob(app, job(ids, ALBUM(ids)))); } finally { await app.close(); }
  assert.deepStrictEqual(prepared, []);
  assert.deepStrictEqual(reembeds, []);
});

test('only THIS job\'s fresh download is rewritten: a kept file (FTCHREAL false), a source yt-dlp did not download, or a failed run is never touched', async () => {
  const ids = [1, 2, 3, 4].map(ID);
  downloadShape = (r, file) => {
    const id = path.basename(file).slice(6, 17);
    if (id === ids[0]) return Object.assign(r, { alreadyDownloaded: true });
    if (id === ids[1]) return Object.assign(r, { sourceFiles: [{ real: false, path: r.sourceFiles[0].path }] });
    if (id === ids[2]) return { ok: false, code: 1, stdout: '', stderr: '', error: 'yt-dlp exited with code 1', channelMeta: [], itemFailures: [] };
    return r;
  };
  const app = await startApp(makeDeps());
  try { await settle(await startJob(app, job(ids, ALBUM(ids, { coverId: COVER_ID })))); } finally { await app.close(); }
  assert.deepStrictEqual(reembeds.map((r) => path.basename(r.file)), [`Song [${ids[3]}].mp3`]);
});

test('a malformed coverId is a 400 with the album error and queues nothing; a valid id outside the ticked rows is accepted', async () => {
  const ids = [1].map(ID);
  const app = await startApp(makeDeps());
  try {
    for (const bad of ['https://evil.example/x.jpg', '../x', 7]) {
      const r = await post(app.base, '/api/ytdlp/download-playlist', job(ids, ALBUM(ids, { coverId: bad })));
      assert.strictEqual(r.status, 400);
      assert.strictEqual((await r.json()).error, 'Invalid album cover');
    }
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(pending.readPending(dataDir).length, 0);
    await settle(await startJob(app, job(ids, ALBUM(ids, { coverId: COVER_ID }))));
  } finally { await app.close(); }
  assert.deepStrictEqual(prepared, [COVER_ID]);
});

test('the cover is persisted with the album (the entry rewritten after a video too), the activity row carries it for Retry, and a restart resumes WITH it', async () => {
  const ids = [1, 2, 3].map(ID);
  const slow = run.runDownload;
  run.runDownload = async (...a) => { await new Promise((r) => setTimeout(r, 120)); return slow(...a); };
  const app = await startApp(makeDeps());
  let jobId;
  try {
    jobId = await startJob(app, job(ids, ALBUM(ids, { coverId: COVER_ID })));
    assert.strictEqual(pending.readPending(dataDir).find((p) => p.kind === 'playlist').album.coverId, COVER_ID, 'the fresh entry');
    const until = Date.now() + 5000;
    let saved;
    while (Date.now() < until) {
      saved = pending.readPending(dataDir).find((p) => p.kind === 'playlist');
      if (saved && saved.doneIds.length >= 1) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(saved && saved.doneIds.length >= 1);
    assert.strictEqual(saved.album.coverId, COVER_ID, 'the entry rewritten after a video');
    const e = await settle(jobId);
    assert.strictEqual(e.album.coverId, COVER_ID, 'the row (Retry posts it back)');
  } finally { await app.close(); }
  run.runDownload = slow;
  prepared = []; reembeds = [];
  pending.addPending(dataDir, { jobId: 'job-cover-restart', kind: 'playlist', listId: LIST, title: 'Brat', ids, doneIds: [ids[0]], failedIds: [], format: 'audio', quality: 'best', filetype: 'mp3', album: ALBUM(ids, { coverId: COVER_ID }), createdAt: '2026-10-08T00:00:00.000Z' });
  ytdlp.requeuePendingOneShots(makeDeps(), config());
  await settle('job-cover-restart');
  assert.deepStrictEqual(prepared, [COVER_ID]);
  assert.deepStrictEqual(reembeds.map((r) => path.basename(r.file)), [`Song [${ids[1]}].mp3`, `Song [${ids[2]}].mp3`]);
});

test('a tampered pending entry (a URL as the cover) is dropped on restart, never fetched', async () => {
  const ids = [1].map(ID);
  pending.addPending(dataDir, { jobId: 'job-cover-bad', kind: 'playlist', listId: LIST, title: 'Brat', ids, doneIds: [], failedIds: [], format: 'audio', quality: 'best', album: ALBUM(ids, { coverId: 'http://169.254.169.254/latest' }), createdAt: '2026-10-08T00:00:00.000Z' });
  ytdlp.requeuePendingOneShots(makeDeps(), config());
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(pending.readPending(dataDir).length, 0, 'dropped');
  assert.deepStrictEqual(calls, []);
  assert.deepStrictEqual(prepared, []);
});

// ---- albumCoverTargets: which finals may be rewritten (real files) ----
test('albumCoverTargets: a fresh file this job downloaded, in its folder - and nothing else', () => {
  const cfg = config();
  const folder = path.join(tmpDir, 'Kyle Gordon');
  fs.mkdirSync(folder, { recursive: true });
  const jobStartMs = Date.now() - 1000;
  const file = path.join(folder, 'Song [vid00000001].mp3');
  fs.writeFileSync(file, 'x');
  const result = (extra) => Object.assign({ ok: true, alreadyDownloaded: false, sourceFiles: [{ real: true, path: path.join(folder, 'Song [vid00000001].webm') }], finalFiles: [file] }, extra || {});
  const at = (r, o) => ytdlp.albumCoverTargets(r, cfg, Object.assign({ jobStartMs, outputDir: folder }, o || {}));
  assert.deepStrictEqual(at(result()), [file], 'the control');
  assert.deepStrictEqual(at(result({ sourceFiles: [{ real: true, path: file }] })), [file], 'an m4a kept as downloaded (source = final)');
  assert.deepStrictEqual(at(result({ ok: false })), [], 'a failed run');
  assert.deepStrictEqual(at(result({ alreadyDownloaded: true })), [], 'yt-dlp kept a file already there');
  assert.deepStrictEqual(at(result({ sourceFiles: [{ real: false, path: path.join(folder, 'Song [vid00000001].webm') }] })), [], 'a source that was already on disk');
  assert.deepStrictEqual(at(result({ sourceFiles: [{ real: null, path: path.join(folder, 'Song [vid00000001].webm') }] })), [], 'NA is never "ours"');
  assert.deepStrictEqual(at(result({ sourceFiles: [{ real: true, path: path.join(folder, 'Other [vid00000002].webm') }] })), [], 'a source of another stem');
  assert.deepStrictEqual(at(result({ sourceFiles: [] })), [], 'no source line');
  assert.deepStrictEqual(at(result(), { jobStartMs: Date.now() + 60000 }), [], 'a file older than the job');
  assert.deepStrictEqual(at(result(), { outputDir: path.join(tmpDir, 'Elsewhere') }), [], 'outside the job\'s folder');
  assert.deepStrictEqual(at(result(), { outputDir: undefined }), [], 'no known folder');
  const outside = path.join(os.tmpdir(), `filetube-cover-outside-${process.pid}.mp3`);
  fs.writeFileSync(outside, 'x');
  try {
    assert.deepStrictEqual(at(result({ finalFiles: [outside], sourceFiles: [{ real: true, path: outside }] }), { outputDir: path.dirname(outside) }), [], 'outside the download root');
  } finally { fs.rmSync(outside, { force: true }); }
  const link = path.join(folder, 'Link [vid00000003].mp3');
  fs.symlinkSync(file, link);
  assert.deepStrictEqual(at(result({ finalFiles: [link], sourceFiles: [{ real: true, path: link }] })), [], 'a symlink');
  assert.deepStrictEqual(at(result({ finalFiles: [file, file] })), [file], 'once');
  assert.deepStrictEqual(ytdlp.albumCoverTargets(null, cfg, { jobStartMs, outputDir: folder }), []);
});
