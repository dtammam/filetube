'use strict';

// [INTEGRATION] v1.339 S1 (T-S1, Dean's D1 "Keep mine"), through the REAL
// spawn boundary: POST /api/ytdlp/download -> launchOneShotJob -> runOneShot
// -> run.runDownload -> spawnYtdlpDownload -> a FAKE `yt-dlp` on PATH (the
// stub-binary-on-PATH harness ytdlp-break-early-exit.test.js uses -- CI has
// no yt-dlp). Nothing between the route and the child is stubbed except the
// channel probes (network).
//
// The fake is FAITHFUL to the yt-dlp behavior this slice depends on, each
// point verified at primary source (yt-dlp master YoutubeDL.py
// existing_file / process_info, downloader/common.py download(),
// __init__.py's `quiet = ... bool(opts.forceprint)`) and measured against a
// real yt-dlp 2026.08.19:
//   - target already on disk + `--force-overwrites`: the existing file is
//     os.remove()d BEFORE the download starts (existing_file, overwrites on);
//   - target already on disk, no overwrite flag: it is KEPT, nothing is
//     downloaded, exit 0; the after_move prints still fire and
//     `%(__real_download)j` renders `false` (`true` on a real download);
//   - `[download] <file> has already been downloaded` is a to_screen line,
//     and any `--print` implies `--quiet`, so it is printed ONLY when the argv
//     carries no --print (never, for FileTube's argv);
//   - a failing download leaves its `.part`; a failing post-processor on a
//     kept file leaves a `.temp.<ext>` and never writes the original;
//   - `overwrites` resolves config files first, then the command line, last
//     option wins (FAKE_YTDLP_CONFIG_ARGS models a user yt-dlp config -- we do
//     not pass --ignore-config).
// Because the fake keys on the REAL argv, re-adding `--force-overwrites` to
// args.js, or dropping the FTCHREAL print, turns these tests red.
// NOT modelled (disclosed): on a kept file real yt-dlp still runs the embed
// post-processors (--embed-metadata/-thumbnail/-chapters), which re-mux it to
// a `.temp` file and os.replace it over the original after ffmpeg succeeds --
// so in production the kept file's bytes/inode can change (its media is
// stream-copied, never deleted). The byte-identical/same-inode assertions
// below therefore prove FileTube's own guarantee (no delete-first, no cleanup
// of a final file), not that yt-dlp never re-embeds metadata.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-keepmine-bin-'));
const FAKE = String.raw`
const fs = require('fs');
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('2026.08.19\n'); process.exit(0); }
if (process.env.FAKE_YTDLP_LOG) fs.appendFileSync(process.env.FAKE_YTDLP_LOG, JSON.stringify(argv) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const gate = process.env.FAKE_YTDLP_GATE;
  if (gate) {
    const until = Date.now() + 20000;
    while (!fs.existsSync(gate) && Date.now() < until) await sleep(20);
  }
  const tmpl = argv[argv.indexOf('-o') + 1];
  const target_url = argv[argv.indexOf('--') + 1];
  const id = new URL(target_url).searchParams.get('v');
  const title = 'Some Video';
  const target = tmpl.replace('%(title)s', title).replace('%(id)s', id).replace('%(ext)s', 'mp4');
  const prints = argv.flatMap((t, i) => (t === '--print' ? [argv[i + 1]] : []));
  // yt-dlp's dest='overwrites': config-file options first, then the command
  // line (CLI > config), last one wins; only True means delete-first.
  const cfgArgs = (process.env.FAKE_YTDLP_CONFIG_ARGS || '').split(' ').filter(Boolean);
  let overwrites = null;
  for (const t of [...cfgArgs, ...argv]) {
    if (t === '--force-overwrites' || t === '--yes-overwrites') overwrites = true;
    else if (t === '--no-force-overwrites') overwrites = null;
    else if (t === '-w' || t === '--no-overwrites') overwrites = false;
  }
  const force = overwrites === true;
  const mode = process.env.FAKE_YTDLP_MODE || 'ok';
  let real;
  if (fs.existsSync(target) && !force) {
    if (prints.length === 0) process.stdout.write('[download] ' + target + ' has already been downloaded\n');
    real = false;
    if (mode === 'fail') {
      fs.writeFileSync(target.replace(/\.mp4$/, '.temp.mp4'), 'post-processor temp');
      process.stderr.write('ERROR: Postprocessing: Conversion failed!\n');
      process.exit(1);
    }
  } else {
    if (fs.existsSync(target)) fs.unlinkSync(target);
    fs.mkdirSync(require('path').dirname(target), { recursive: true }); // yt-dlp creates the output dir
    fs.writeFileSync(target + '.part', 'PARTIAL');
    if (mode === 'fail') {
      process.stderr.write('ERROR: [youtube] ' + id + ': HTTP Error 403: Forbidden\n');
      process.exit(1);
    }
    fs.writeFileSync(target + '.part', 'FRESHLY DOWNLOADED BYTES');
    fs.renameSync(target + '.part', target);
    real = true;
  }
  for (const p of prints) {
    if (!p.startsWith('after_move:')) continue;
    const body = p.slice('after_move:'.length);
    if (body.includes('%(__real_download)j')) process.stdout.write(body.replace('%(__real_download)j', String(real)) + '\n');
    else if (body.startsWith('FTCHMETA ')) process.stdout.write('FTCHMETA ' + JSON.stringify({ id, title }) + '\n');
  }
  process.exit(0);
})();
`;
fs.writeFileSync(path.join(binDir, 'yt-dlp'), `#!${process.execPath}\n${FAKE}`, { mode: 0o755 });
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const ytdlpStoreModule = require('../../lib/ytdlp/store');
const { featureStoreFor, docView } = require('../helpers/scratch-feature-store');
const run = require('../../lib/ytdlp/run');
const args = require('../../lib/ytdlp/args');
const activity = require('../../lib/ytdlp/activity');
const pending = require('../../lib/ytdlp/pending');

const originalProbeChannel = run.probeChannel;
const originalProbeChannelAvatar = run.probeChannelAvatar;

const VIDEO_ID = 'dQw4w9WgXcQ';
const VIDEO_URL = `https://youtu.be/${VIDEO_ID}`;
const FOLDER = 'Keep Mine';
const ORIGINAL_BYTES = Buffer.from('THE ONLY COPY -- Dean\'s library file, bytes that must survive');

let tmpDir;
let dataDir;
let logPath;
let gatePath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-keepmine-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-keepmine-data-'));
  logPath = path.join(dataDir, 'spawns.log');
  gatePath = path.join(dataDir, 'gate');
  process.env.FAKE_YTDLP_LOG = logPath;
  delete process.env.FAKE_YTDLP_GATE;
  delete process.env.FAKE_YTDLP_MODE;
  delete process.env.FAKE_YTDLP_CONFIG_ARGS;
  run.probeChannel = async () => null;
  run.probeChannelAvatar = async () => null;
});

afterEach(() => {
  run.probeChannel = originalProbeChannel;
  run.probeChannelAvatar = originalProbeChannelAvatar;
  ytdlp.resetPollRerunStateForTests();
  delete process.env.FAKE_YTDLP_LOG;
  delete process.env.FAKE_YTDLP_GATE;
  delete process.env.FAKE_YTDLP_MODE;
  delete process.env.FAKE_YTDLP_CONFIG_ARGS;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

after(() => {
  fs.rmSync(binDir, { recursive: true, force: true });
});

function makeDeps() {
  const db = {};
  const scanCalls = [];
  return {
    dataDir,
    ytdlpDb: featureStoreFor(ytdlpStoreModule.FEATURE, db),
    loadDatabase: () => docView(db, featureStoreFor(ytdlpStoreModule.FEATURE, db)),
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => { scanCalls.push(Date.now()); },
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
    scanCalls,
  };
}

function config() {
  return ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir,
  });
}

async function startApp(deps, cfg) {
  const app = express();
  app.use(express.json());
  ytdlp.registerRoutes(app, deps, cfg);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function postDownload(base, body) {
  const res = await fetch(`${base}/api/ytdlp/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function targetPath(cfg) {
  return path.join(args.resolveChannelDir(cfg, { name: FOLDER }), `Some Video [${VIDEO_ID}].mp4`);
}

function seedLibraryFile(cfg) {
  const p = targetPath(cfg);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, ORIGINAL_BYTES);
  return p;
}

function downloadSpawns() {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((argv) => argv.includes('-o'));
}

// Wait for the job's TERMINAL activity state AND for its launch chain to have
// settled (the pending entry removed -- the chain's very last act), so no
// straggler child or write can outlive the test.
async function waitForSettled(jobId) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const entry = activity.getSnapshot().oneShots[jobId];
    const stillPending = pending.readPending(dataDir).some((e) => e.jobId === jobId);
    if (entry && ['done', 'error', 'cancelled'].includes(entry.state) && !stillPending) return entry;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`job ${jobId} never settled: ${JSON.stringify(activity.getSnapshot().oneShots[jobId])}`);
}

// ---- (b) already in the library: success, "Already in your library", file byte-identical

test('S1 (b): a one-off whose file is already in the library finishes as a SUCCESS flagged alreadyInLibrary, and the library file is byte-identical (same inode) afterwards', async () => {
  const deps = makeDeps();
  const cfg = config();
  const libraryFile = seedLibraryFile(cfg);
  const inodeBefore = fs.statSync(libraryFile).ino;
  const { base, close } = await startApp(deps, cfg);
  try {
    const res = await postDownload(base, { url: VIDEO_URL, folder: FOLDER });
    assert.strictEqual(res.status, 202);
    const entry = await waitForSettled(res.body.jobId);

    assert.strictEqual(entry.state, 'done', `never a failure: ${JSON.stringify(entry)}`);
    assert.strictEqual(entry.alreadyInLibrary, true, 'the done entry carries the flag both status renderers turn into "Already in your library"');
    assert.ok(fs.readFileSync(libraryFile).equals(ORIGINAL_BYTES), 'the library copy is byte-identical');
    assert.strictEqual(fs.statSync(libraryFile).ino, inodeBefore, 'same inode -- never deleted and rewritten');

    const spawns = downloadSpawns();
    assert.strictEqual(spawns.length, 1, 'the download pass really ran through the spawn boundary');
    assert.ok(!spawns[0].includes('--force-overwrites'), 'the real argv carries no overwrite flag');
    assert.ok(deps.scanCalls.length >= 1, 'a scan trigger is fine (indexing only)');
  } finally {
    await close();
  }
});

test('S1 (b) control: a FRESH one-off (nothing on disk) is a plain success -- alreadyInLibrary is NOT set -- and a repeat afterwards is "already in your library" with the fresh file untouched', async () => {
  const deps = makeDeps();
  const cfg = config();
  const { base, close } = await startApp(deps, cfg);
  try {
    const first = await postDownload(base, { url: VIDEO_URL, folder: FOLDER });
    const firstEntry = await waitForSettled(first.body.jobId);
    assert.strictEqual(firstEntry.state, 'done');
    assert.strictEqual(firstEntry.alreadyInLibrary, undefined, 'a real download is never labelled already-present');
    const downloaded = fs.readFileSync(targetPath(cfg));
    assert.strictEqual(downloaded.toString(), 'FRESHLY DOWNLOADED BYTES');

    // The first job is terminal, so this is a NEW job (never joined to a done one).
    const second = await postDownload(base, { url: VIDEO_URL, folder: FOLDER });
    assert.notStrictEqual(second.body.jobId, first.body.jobId);
    assert.notStrictEqual(second.body.joined, true);
    const secondEntry = await waitForSettled(second.body.jobId);
    assert.strictEqual(secondEntry.state, 'done');
    assert.strictEqual(secondEntry.alreadyInLibrary, true);
    assert.ok(fs.readFileSync(targetPath(cfg)).equals(downloaded));
    assert.strictEqual(downloadSpawns().length, 2);
    assert.strictEqual(ytdlp.inflightOneShotTargetCountForTests(), 0, 'every settled job released its single-flight target (no leak)');
  } finally {
    await close();
  }
});

test('S1 (b): a user yt-dlp CONFIG carrying --force-overwrites cannot switch delete-first back on -- the one-off argv resets it on the command line', async () => {
  process.env.FAKE_YTDLP_CONFIG_ARGS = '--force-overwrites';
  const deps = makeDeps();
  const cfg = config();
  const libraryFile = seedLibraryFile(cfg);
  const inodeBefore = fs.statSync(libraryFile).ino;
  const { base, close } = await startApp(deps, cfg);
  try {
    const res = await postDownload(base, { url: VIDEO_URL, folder: FOLDER });
    const entry = await waitForSettled(res.body.jobId);
    assert.strictEqual(entry.state, 'done');
    assert.strictEqual(entry.alreadyInLibrary, true);
    assert.ok(fs.readFileSync(libraryFile).equals(ORIGINAL_BYTES), 'byte-identical despite the config');
    assert.strictEqual(fs.statSync(libraryFile).ino, inodeBefore);
  } finally {
    await close();
  }
});

// ---- (c) a FAILED one-off never touches a pre-existing same-name file ------

test('S1 (c): a one-off that FAILS (exit 1 after partial output) leaves the pre-existing same-name library file untouched, reports an honest error, and its temp is cleaned', async () => {
  process.env.FAKE_YTDLP_MODE = 'fail';
  const deps = makeDeps();
  const cfg = config();
  const libraryFile = seedLibraryFile(cfg);
  const inodeBefore = fs.statSync(libraryFile).ino;
  const { base, close } = await startApp(deps, cfg);
  try {
    const res = await postDownload(base, { url: VIDEO_URL, folder: FOLDER });
    const entry = await waitForSettled(res.body.jobId);

    assert.strictEqual(entry.state, 'error', 'the failure is reported honestly');
    assert.ok(fs.existsSync(libraryFile), 'the only copy still exists');
    assert.ok(fs.readFileSync(libraryFile).equals(ORIGINAL_BYTES), 'byte-identical');
    assert.strictEqual(fs.statSync(libraryFile).ino, inodeBefore, 'same inode');
    const leftovers = fs.readdirSync(path.dirname(libraryFile)).filter((n) => n !== path.basename(libraryFile));
    assert.deepStrictEqual(leftovers, [], 'the failed run\'s intermediate was cleaned; nothing else in the folder was removed or added');
    assert.strictEqual(downloadSpawns().length, 1, 'anti-vacuity: the failing download really ran');
  } finally {
    await close();
  }
});

// ---- (d) single-flight: two concurrent one-offs for one id -> ONE child ----

test('S1 (d): two concurrent one-offs for the same video spawn exactly ONE yt-dlp child -- the second request JOINS the first job (same jobId, no second pending entry)', async () => {
  process.env.FAKE_YTDLP_GATE = gatePath; // hold the first child open
  const deps = makeDeps();
  const cfg = config();
  const { base, close } = await startApp(deps, cfg);
  try {
    const first = await postDownload(base, { url: VIDEO_URL, folder: FOLDER });
    const second = await postDownload(base, { url: `https://www.youtube.com/watch?v=${VIDEO_ID}`, folder: FOLDER });
    assert.strictEqual(first.status, 202);
    assert.strictEqual(second.status, 202);
    assert.strictEqual(second.body.jobId, first.body.jobId, 'the second request joins the in-flight job');
    assert.strictEqual(second.body.joined, true);
    assert.strictEqual(pending.readPending(dataDir).length, 1, 'one durable job, not two');

    fs.writeFileSync(gatePath, '');
    const entry = await waitForSettled(first.body.jobId);
    assert.strictEqual(entry.state, 'done');
    // Give any (mutant) second job every chance to reach its spawn.
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(downloadSpawns().length, 1, 'exactly ONE yt-dlp writer for the target');
  } finally {
    fs.writeFileSync(gatePath, '');
    await close();
  }
});

test('S1 (d) control: an AUDIO one-off for the same id is a different target and is NOT joined to an in-flight video job', async () => {
  process.env.FAKE_YTDLP_GATE = gatePath;
  const deps = makeDeps();
  const cfg = config();
  const { base, close } = await startApp(deps, cfg);
  try {
    const video = await postDownload(base, { url: VIDEO_URL, folder: FOLDER });
    const audio = await postDownload(base, { url: VIDEO_URL, folder: FOLDER, format: 'audio' });
    assert.strictEqual(audio.status, 202);
    assert.notStrictEqual(audio.body.jobId, video.body.jobId);
    assert.notStrictEqual(audio.body.joined, true);
    fs.writeFileSync(gatePath, '');
    await waitForSettled(video.body.jobId);
    await waitForSettled(audio.body.jobId);
  } finally {
    fs.writeFileSync(gatePath, '');
    await close();
  }
});

test('S1 (d) control: a job already TERMINAL while its chain is still wedged (the stuck-sweep flipped it to error) is never joined -- a re-request starts a fresh job', async () => {
  // Isolates the terminal-state arm of joinableOneShotJobId: no cancel latch,
  // and the first job's chain never settles (a folder probe that never
  // returns -- outside the download gate, so no later test queues behind
  // it), so its target stays registered. Without the state check every later
  // request for this video would join a dead job forever.
  const deps = makeDeps();
  const cfg = config();
  let probes = 0;
  run.probeChannel = () => { probes += 1; return new Promise(() => {}); };
  const { base, close } = await startApp(deps, cfg);
  try {
    const first = await postDownload(base, { url: VIDEO_URL });
    const until = Date.now() + 5000;
    while (probes === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(probes, 1, 'anti-vacuity: the first job is wedged in its probe');
    const joinedWhileLive = await postDownload(base, { url: VIDEO_URL });
    assert.strictEqual(joinedWhileLive.body.jobId, first.body.jobId, 'anti-vacuity: a LIVE wedged job is joined');
    // What sweepStuckOneShots writes for a childless, stale entry.
    activity.setOneShot(first.body.jobId, { state: 'error', error: 'stuck' });
    const again = await postDownload(base, { url: VIDEO_URL });
    assert.strictEqual(again.status, 202);
    assert.notStrictEqual(again.body.jobId, first.body.jobId, 'a terminal job is never joined');
    assert.notStrictEqual(again.body.joined, true);
  } finally {
    await close();
  }
});

test('S1 (d) control: after a CANCEL, a re-request starts a fresh job (a cancelled job is never joined)', async () => {
  process.env.FAKE_YTDLP_GATE = gatePath;
  const deps = makeDeps();
  const cfg = config();
  const { base, close } = await startApp(deps, cfg);
  try {
    const first = await postDownload(base, { url: VIDEO_URL, folder: FOLDER });
    const cancel = await fetch(`${base}/api/ytdlp/download/${first.body.jobId}/cancel`, { method: 'POST' });
    assert.strictEqual(cancel.status, 200);
    const again = await postDownload(base, { url: VIDEO_URL, folder: FOLDER });
    assert.strictEqual(again.status, 202);
    assert.notStrictEqual(again.body.jobId, first.body.jobId, 'a cancelled job is never joined');
    fs.writeFileSync(gatePath, '');
    await waitForSettled(first.body.jobId);
    const entry = await waitForSettled(again.body.jobId);
    assert.strictEqual(entry.state, 'done');
  } finally {
    fs.writeFileSync(gatePath, '');
    await close();
  }
});
