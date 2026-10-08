'use strict';

// [INTEGRATION] v1.376.0 W6 (b) (plan docs/exec-plans/completed/2026-10-08-v1376-notify-podcasts-polish.md, W6): a scan
// must never index an album track whose cover is still being written.
//
// The race the v1.374.0 builder named: a playlist saved as an album with a Cover writes each track with yt-dlp's OWN
// art, then re-embeds the album's cover, then triggers the scan. Any other scan in between (the previous track's
// fire-and-forget scan, the periodic timer, a manual "Scan now") indexed the file with the wrong art. Here the REAL job
// (POST /api/ytdlp/download-playlist -> runPlaylistJob -> runOneShot -> the real run.runDownload spawning a fake
// yt-dlp on PATH) races the REAL scan (server.js scanDirectories over the download root). The races are held open by
// DEFERREDS, never timing (LESSONS 2): the fake yt-dlp writes the final file and then waits for a gate file before it
// prints its after_move lines and exits; the re-embed seam (cover.reembedCover) waits on a promise the test resolves.
//
// Bound here: no scan indexes the file between the moment it lands and the moment its re-embed resolves (ok, refused
// or failed); the job's own scan then indexes it with the cover; a library entry already held for a deferred path is
// RETAINED (never pruned, never re-indexed) with its sidecar thumbnail; every exit releases the claim (a cancelled
// download, a re-embed that throws).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cover-pending-'));
const DATA_DIR = process.env.DATA_DIR;
const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cover-pending-bin-'));
// The fake yt-dlp: models an audio one-off (yt-dlp source download -> FTCHSRC print -> the extract writes the final
// <stem>.mp3 -> [waits for FAKE_COVER_GATE] -> after_move prints -> exit). FAKE_COVER_STEM renames the output stem
// (a template without the [id] bracket); the final path is then reported only by FTCHDST.
const FAKE = String.raw`
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('2026.08.19\n'); process.exit(0); }
const valueOf = (flag) => { const i = argv.lastIndexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const tmpl = valueOf('-o');
const id = new URL(argv[argv.indexOf('--') + 1]).searchParams.get('v');
const prints = argv.flatMap((t, i) => (t === '--print' ? [argv[i + 1]] : []));
let full = tmpl.replace('%(title)s', 'Mr. Jambo').replace('%(id)s', id).replace('%(ext)s', 'webm');
if (process.env.FAKE_COVER_STEM) full = path.join(path.dirname(full), process.env.FAKE_COVER_STEM + '.webm');
const stem = full.slice(0, -5);
const render = (stage, filepath) => {
  for (const p of prints) {
    if (!p.startsWith(stage + ':')) continue;
    const body = p.slice(stage.length + 1);
    if (body.startsWith('FTCHMETA ')) { process.stdout.write('FTCHMETA ' + JSON.stringify({ id, title: 'Mr. Jambo' }) + '\n'); continue; }
    process.stdout.write(body.replace('%(__real_download)j', 'true').replace('%(filepath)j', JSON.stringify(filepath)) + '\n');
  }
};
fs.mkdirSync(path.dirname(full), { recursive: true });
fs.writeFileSync(full, 'SOURCE');
render('post_process', full);
const out = stem + '.mp3';
fs.writeFileSync(out, 'AUDIO-WITH-OWN-ART');
if (process.env.FAKE_COVER_LANDED) fs.writeFileSync(process.env.FAKE_COVER_LANDED, out);
const finish = () => { render('after_move', out); process.exit(0); };
if (process.env.FAKE_COVER_GATE) {
  const t = setInterval(() => { if (fs.existsSync(process.env.FAKE_COVER_GATE)) { clearInterval(t); finish(); } }, 10);
} else finish();
`;
fs.writeFileSync(path.join(binDir, 'yt-dlp'), `#!${process.execPath}\n${FAKE}`, { mode: 0o755 });
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const {
  getMediaId, loadDatabase, scanDirectories, scanState, __resetDatabaseForTests,
} = require('../../server');
const { seedState } = require('../helpers/seed-state');
const ytdlp = require('../../lib/ytdlp');
const ytdlpStoreModule = require('../../lib/ytdlp/store');
const run = require('../../lib/ytdlp/run');
const cover = require('../../lib/ytdlp/cover');
const coverPending = require('../../lib/ytdlp/coverPending');
const activity = require('../../lib/ytdlp/activity');
const pending = require('../../lib/ytdlp/pending');
const { featureStoreFor } = require('../helpers/scratch-feature-store');

const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
const SETTINGS = { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0, trashRetentionDays: 30 };
const COVER_ID = 'c1Paj8je5sM';
const VID = 'vidJambo002';
const orig = { probeChannel: run.probeChannel, probeChannelAvatar: run.probeChannelAvatar, prepareAlbumCover: cover.prepareAlbumCover, reembedCover: cover.reembedCover, releaseAlbumCover: cover.releaseAlbumCover };

let tmpDir; let gate; let landed; let reembed;
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

async function idle() {
  const start = Date.now();
  while ((scanState.scanning || scanState.rescanRequested) && Date.now() - start < 15000) await new Promise((r) => setTimeout(r, 10));
}
async function until(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('timed out waiting for ' + label);
    await new Promise((r) => setTimeout(r, 10));
  }
}

before(() => {});
after(() => { fs.rmSync(binDir, { recursive: true, force: true }); });

beforeEach(async () => {
  await idle();
  await __resetDatabaseForTests();
  coverPending.resetForTests();
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cover-pending-dl-')));
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = tmpDir;
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings: SETTINGS });
  gate = path.join(tmpDir, '.gate'); // not a media extension: never indexed
  landed = path.join(tmpDir, '.landed');
  process.env.FAKE_COVER_GATE = gate;
  process.env.FAKE_COVER_LANDED = landed;
  delete process.env.FAKE_COVER_STEM;
  run.probeChannel = async () => 'Kyle Gordon';
  run.probeChannelAvatar = async () => null;
  cover.prepareAlbumCover = async () => ({ ok: true, path: '/covers/cover.jpg', dir: '/covers' });
  cover.releaseAlbumCover = () => {};
  // the re-embed is HELD until the test resolves it (a real ffmpeg takes seconds)
  reembed = { started: deferred(), release: deferred(), outcome: 'ok' };
  cover.reembedCover = async (file) => {
    reembed.started.resolve(file);
    await reembed.release.promise;
    if (reembed.outcome === 'throw') throw new Error('boom');
    if (reembed.outcome === 'refused') return { ok: false, reason: 'the date tag changed' };
    fs.writeFileSync(file, 'AUDIO-WITH-ALBUM-COVER');
    return { ok: true };
  };
});

afterEach(async () => {
  Object.assign(run, { probeChannel: orig.probeChannel, probeChannelAvatar: orig.probeChannelAvatar });
  Object.assign(cover, { prepareAlbumCover: orig.prepareAlbumCover, reembedCover: orig.reembedCover, releaseAlbumCover: orig.releaseAlbumCover });
  try { fs.writeFileSync(gate, 'go'); } catch (_) { /* gone */ } // never leave a fake waiting
  reembed.release.resolve();
  await idle();
  ytdlp.resetPollRerunStateForTests();
  coverPending.resetForTests();
  for (const k of ['FILETUBE_YTDLP_ENABLED', 'FILETUBE_YTDLP_DOWNLOAD_DIR', 'FAKE_COVER_GATE', 'FAKE_COVER_LANDED', 'FAKE_COVER_STEM']) delete process.env[k];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function startJobApp() {
  const jobData = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cover-pending-job-'));
  const db = {};
  const deps = {
    dataDir: jobData,
    ytdlpDb: featureStoreFor(ytdlpStoreModule.FEATURE, db),
    loadDatabase, // the REAL library: R1's "a video anyone already has" reads it
    updateDatabase: (fn) => Promise.resolve(fn(db)),
    scanDirectories, // the REAL scan: the job's own trigger after the re-embed
    getMediaId,
    requireManageSubscriptions: () => true,
  };
  const app = express();
  app.use(express.json());
  ytdlp.registerRoutes(app, deps, ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: 'true', FILETUBE_YTDLP_POLL_MINUTES: '0', FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(base + '/api/ytdlp/download-playlist', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listId: 'PLUtyNbQXMTLg', title: 'Wonderful', ids: [VID], format: 'audio', quality: 'best', filetype: 'mp3',
      album: { title: 'Wonderful', artist: 'Kyle Gordon', cleanTitles: false, tracks: { [VID]: 1 }, coverId: COVER_ID } }),
  });
  assert.strictEqual(r.status, 202);
  const jobId = (await r.json()).jobId;
  return {
    base, jobId, jobData,
    settle: async () => {
      await until(() => {
        const e = activity.getSnapshot().oneShots[jobId];
        return e && ['done', 'error', 'cancelled'].includes(e.state) && !pending.readPending(jobData).some((p) => p.jobId === jobId) ? e : null;
      }, 'the job to settle');
      await idle();
    },
    close: async () => { server.closeAllConnections?.(); await new Promise((res) => server.close(res)); fs.rmSync(jobData, { recursive: true, force: true }); },
  };
}

const finalFile = () => path.join(tmpDir, 'Kyle Gordon', `Mr. Jambo [${VID}].mp3`);
const entryOf = (p) => loadDatabase().metadata[getMediaId(p)];

test('a scan while yt-dlp is still finishing the track, and another while its cover is re-embedded, both DEFER it; the job\'s own scan indexes it with the cover', async () => {
  const job = await startJobApp();
  try {
    // 1. the final file has landed (own art); yt-dlp has not printed its after_move lines yet
    const file = await until(() => (fs.existsSync(landed) ? fs.readFileSync(landed, 'utf8') : null), 'the file to land');
    assert.strictEqual(file, finalFile());
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'AUDIO-WITH-OWN-ART');
    await scanDirectories();
    assert.strictEqual(entryOf(file), undefined, 'a scan before FTCHDST does not index the pending file');
    // 2. yt-dlp finishes; the job is now inside its re-embed (held)
    fs.writeFileSync(gate, 'go');
    assert.strictEqual(await reembed.started.promise, file);
    assert.strictEqual(coverPending.isPending(file), true);
    await scanDirectories();
    assert.strictEqual(entryOf(file), undefined, 'a scan during the re-embed does not index the pending file');
    // 3. the re-embed resolves: the job releases the claim and triggers its own scan
    reembed.release.resolve();
    await job.settle();
    const e = entryOf(file);
    assert.ok(e, 'the job\'s own scan indexed the track');
    assert.strictEqual(e.size, Buffer.byteLength('AUDIO-WITH-ALBUM-COVER'), 'indexed AFTER the cover was written');
    assert.strictEqual(coverPending.pendingCount(), 0, 'the claim is released');
  } finally { await job.close(); }
});

test('a final path reported only by FTCHDST (a name without the [id] bracket) is pending from that line until the re-embed resolves', async () => {
  process.env.FAKE_COVER_STEM = 'Mr. Jambo';
  delete process.env.FAKE_COVER_GATE;
  const job = await startJobApp();
  try {
    const file = await reembed.started.promise;
    assert.strictEqual(path.basename(file), 'Mr. Jambo.mp3');
    assert.strictEqual(coverPending.isPending(file), true, 'the FTCHDST path joined the claim');
    await scanDirectories();
    assert.strictEqual(entryOf(file), undefined, 'not indexed while its cover is pending');
    reembed.release.resolve();
    await job.settle();
    assert.strictEqual(entryOf(file).size, Buffer.byteLength('AUDIO-WITH-ALBUM-COVER'));
  } finally { await job.close(); }
});

test('a library entry ALREADY held for a deferred path is retained by the scan (never pruned, never re-indexed), with its thumbnail', async () => {
  // an entry for the very path the job will write, indexed before (no youtubeId, so R1 still tags the track)
  const p = finalFile();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const id = getMediaId(p);
  const seeded = { id, name: path.basename(p), title: 'Mr. Jambo (as indexed)', filePath: p, folderName: 'Kyle Gordon', rootFolder: tmpDir,
    size: 7, ext: '.mp3', type: 'audio', addedAt: Date.now(), duration: 60, hasThumbnail: true };
  // a second, settled library file under the same root: so the root never reads as vanished (the mount-loss guard
  // would otherwise keep the deferred entry by itself and hide whether the walk's deferral reaches the prune - gate
  // mutant M4, deferredPaths dropped from selectPrunableIds, survived without it)
  const other = path.join(tmpDir, 'Other', 'Settled [vid00000099].mp3');
  fs.mkdirSync(path.dirname(other), { recursive: true });
  fs.writeFileSync(other, 'SETTLED');
  const otherId = getMediaId(other);
  const otherEntry = { id: otherId, name: path.basename(other), title: 'Settled', filePath: other, folderName: 'Other', rootFolder: tmpDir,
    size: fs.statSync(other).size, ext: '.mp3', type: 'audio', addedAt: Date.now(), duration: 60, hasThumbnail: false };
  seedState({ folders: [], folderSettings: {}, metadata: { [id]: seeded, [otherId]: otherEntry }, settings: SETTINGS });
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'thumb-as-indexed');
  const job = await startJobApp();
  try {
    await until(() => fs.existsSync(landed), 'the file to land');
    fs.writeFileSync(gate, 'go');
    await reembed.started.promise;
    // the deferral must reach the prune itself (selectPrunableIds guard 1b): the entry is never even a prune
    // CANDIDATE. Without it the final mutator's restore keep-guard (T-S2) would still keep the entry - it logs
    // "NOT pruning ... live again" - so that line is the observable (gate mutant M4 survived the outcome checks).
    const logged = [];
    const realLog = console.log;
    console.log = (...a) => { logged.push(a.join(' ')); realLog(...a); };
    try { await scanDirectories(); } finally { console.log = realLog; }
    assert.ok(!logged.some((l) => l.includes('NOT pruning') && l.includes(p)), 'the deferred entry was never a prune candidate');
    const e = entryOf(p);
    assert.ok(e, 'the deferred path\'s entry is NOT pruned');
    assert.strictEqual(e.title, 'Mr. Jambo (as indexed)', 'and not re-indexed (the file still holds its own art)');
    assert.strictEqual(e.size, 7);
    assert.strictEqual(fs.readFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), 'utf8'), 'thumb-as-indexed', 'its thumbnail is kept');
    reembed.release.resolve();
    await job.settle();
    assert.strictEqual(entryOf(p).size, Buffer.byteLength('AUDIO-WITH-ALBUM-COVER'), 'released: re-indexed with the cover');
  } finally { await job.close(); }
});

for (const outcome of ['refused', 'throw']) {
  test(`a re-embed that is ${outcome === 'throw' ? 'thrown' : 'refused'} releases the claim; the track is indexed with its own art`, async () => {
    reembed.outcome = outcome;
    delete process.env.FAKE_COVER_GATE;
    const job = await startJobApp();
    try {
      const file = await reembed.started.promise;
      await scanDirectories();
      assert.strictEqual(entryOf(file), undefined, 'deferred while the re-embed runs');
      reembed.release.resolve();
      await job.settle();
      assert.strictEqual(coverPending.pendingCount(), 0, 'released');
      assert.strictEqual(entryOf(file).size, Buffer.byteLength('AUDIO-WITH-OWN-ART'), 'indexed as it is: its own art');
    } finally { await job.close(); }
  });
}

test('a download cancelled after the file landed releases the claim; the next scan indexes what is on disk', async () => {
  const job = await startJobApp();
  try {
    const file = await until(() => (fs.existsSync(landed) ? fs.readFileSync(landed, 'utf8') : null), 'the file to land');
    assert.strictEqual(coverPending.isPending(file), true);
    const childId = await until(() => Object.keys(activity.getSnapshot().oneShots).find((k) => k !== job.jobId && activity.getSnapshot().oneShots[k].state === 'downloading'), 'the child job');
    const r = await fetch(`${job.base}/api/ytdlp/download/${childId}/cancel`, { method: 'POST' });
    assert.strictEqual(r.status, 200);
    await job.settle();
    assert.strictEqual(coverPending.pendingCount(), 0, 'the cancel released the claim');
    await scanDirectories();
    assert.ok(entryOf(file), 'not deferred any more');
  } finally { await job.close(); }
});
