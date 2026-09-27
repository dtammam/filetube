'use strict';

// [INTEGRATION] v1.339 gate r1 C2 (Dean's D1 "Keep mine", the AUDIO half),
// through the REAL spawn boundary: POST /api/ytdlp/download -> runOneShot ->
// run.runDownload -> spawnYtdlpDownload -> a FAKE `yt-dlp` on PATH. Nothing
// between the route and the child is stubbed except the channel probes.
//
// The fake models the yt-dlp 2026.08.19 behavior C2 is about, each point read
// at SOURCE (site-packages/yt_dlp of the pinned version) and measured with the
// real binary + ffmpeg against a local HTTP server:
//   - format: an extract-audio run defaults to `bestaudio/best` ONLY when
//     keepvideo is off (__init__.py:594-596); otherwise the generic default
//     is `bestvideo*+bestaudio/best` (YoutubeDL.py:2340). An explicit -f wins.
//     On a combined-formats site `bestaudio/best` resolves to the one
//     combined .mp4; on YouTube to the audio-only .webm (FAKE_YTDLP_SITE).
//   - existing_video_file (YoutubeDL.py:3472-3479, default_overwrite=False):
//     the CONVERTED name (`<stem>.<final_ext>`, final_ext = --audio-format,
//     __init__.py:778-782) is checked first, then `<stem>.<selected ext>`;
//     an existing file there is used as the download instead of fetching.
//   - the single-file branch (YoutubeDL.py:3583-3591): picked-up file == the
//     output name -> the downloader reports it already downloaded,
//     `__real_download` False (downloader/common.py:434-455); picked-up file
//     == the converted name -> `__real_download` is never assigned (prints NA).
//   - `post_process:` prints fire before any post-processor with filepath =
//     the downloaded/picked-up file (YoutubeDL.py:3830-3833, 3848-3852);
//     `after_move:` prints see the final file (:3853-3855).
//   - FFmpegExtractAudioPP converts to `<stem>.<audio-format>` and returns the
//     source as its original (postprocessor/ffmpeg.py:476-535); run_pp DELETES
//     it unless -k/--keep-video, which keeps it instead (YoutubeDL.py:3820-3827).
// So on the pre-fix argv (no -k) the fake deletes the library video exactly as
// the real binary did, and these tests are red there.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-audiokeep-bin-'));
const FAKE = String.raw`
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('2026.08.19\n'); process.exit(0); }
if (process.env.FAKE_YTDLP_LOG) fs.appendFileSync(process.env.FAKE_YTDLP_LOG, JSON.stringify(argv) + '\n');
const valueOf = (flag) => { const i = argv.lastIndexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const tmpl = valueOf('-o');
const id = new URL(argv[argv.indexOf('--') + 1]).searchParams.get('v');
const title = 'Some Video';
const prints = argv.flatMap((t, i) => (t === '--print' ? [argv[i + 1]] : []));
let overwrites = null;
let keepvideo = false;
for (const t of argv) {
  if (t === '--force-overwrites' || t === '--yes-overwrites') overwrites = true;
  else if (t === '--no-force-overwrites') overwrites = null;
  else if (t === '-k' || t === '--keep-video') keepvideo = true;
  else if (t === '--no-keep-video') keepvideo = false;
}
const audio = argv.includes('-x');
const audioFormat = audio ? valueOf('--audio-format') : null;
let format = valueOf('-f');
if (audio && !keepvideo && format === null) format = 'bestaudio/best';
if (format === null) format = 'bestvideo*+bestaudio/best';
const site = process.env.FAKE_YTDLP_SITE || 'combined';
const AUDIO_ONLY = { combined: null, youtube: 'webm', m4a: 'm4a' }[site];
const ext = format.startsWith('bestaudio') && AUDIO_ONLY ? AUDIO_ONLY : 'mp4';
if (process.env.FAKE_YTDLP_FMTLOG) fs.appendFileSync(process.env.FAKE_YTDLP_FMTLOG, format + ' -> ' + ext + '\n');
const full = tmpl.replace('%(title)s', title).replace('%(id)s', id).replace('%(ext)s', ext);
const stem = full.slice(0, -path.extname(full).length);
const converted = audioFormat ? stem + '.' + audioFormat : full;
let dl = null;
let real; // undefined = never assigned (prints NA)
const candidates = [...new Set([converted, full])];
if (overwrites === true) {
  for (const f of candidates) if (fs.existsSync(f)) fs.unlinkSync(f);
} else {
  dl = candidates.find((f) => fs.existsSync(f)) || null;
}
if (dl === null || dl === full) {
  if (dl === full) {
    real = false;
  } else {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full + '.part', 'FRESH ' + ext + ' BYTES');
    fs.renameSync(full + '.part', full);
    real = true;
  }
  dl = full;
}
const render = (stage, info) => {
  for (const p of prints) {
    if (!p.startsWith(stage + ':')) continue;
    const body = p.slice(stage.length + 1);
    if (body.startsWith('FTCHMETA ')) { process.stdout.write('FTCHMETA ' + JSON.stringify({ id, title }) + '\n'); continue; }
    process.stdout.write(body
      .replace('%(__real_download)j', info.real === undefined ? 'NA' : String(info.real))
      .replace('%(filepath)j', JSON.stringify(info.filepath)) + '\n');
  }
};
render('post_process', { filepath: dl, real });
let filepath = dl;
if (audio && path.extname(dl).slice(1) !== audioFormat) {
  const out = stem + '.' + audioFormat;
  fs.writeFileSync(out, 'AUDIO MADE FROM ' + path.basename(dl) + ': ' + fs.readFileSync(dl).toString());
  if (!keepvideo) fs.unlinkSync(dl);
  filepath = out;
}
render('after_move', { filepath, real });
// v1.339 F4: model an operator config whose raw-title --print lets a hostile
// title FORGE sentinel lines. FAKE_YTDLP_FORGE = { create: [paths written
// fresh first], chunks: [stdout writes, each its own pipe read (a pause
// between them)] }.
if (process.env.FAKE_YTDLP_FORGE) {
  const forge = JSON.parse(process.env.FAKE_YTDLP_FORGE);
  for (const f of forge.create || []) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'FRESH FILE THE FORGED LINE NAMES');
  }
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (const chunk of forge.chunks || []) {
    process.stdout.write(chunk);
    Atomics.wait(pause, 0, 0, 150);
  }
}
process.exit(0);
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
const FOLDER = 'Audio Keep';
const LIBRARY_BYTES = Buffer.from('THE ONLY COPY -- the user\'s library file, bytes that must survive');

let tmpDir;
let dataDir;
let logPath;
let fmtLogPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-audiokeep-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-audiokeep-data-'));
  logPath = path.join(dataDir, 'spawns.log');
  fmtLogPath = path.join(dataDir, 'formats.log');
  process.env.FAKE_YTDLP_LOG = logPath;
  process.env.FAKE_YTDLP_FMTLOG = fmtLogPath;
  delete process.env.FAKE_YTDLP_SITE;
  delete process.env.FAKE_YTDLP_FORGE;
  run.probeChannel = async () => null;
  run.probeChannelAvatar = async () => null;
});

afterEach(() => {
  run.probeChannel = originalProbeChannel;
  run.probeChannelAvatar = originalProbeChannelAvatar;
  ytdlp.resetPollRerunStateForTests();
  delete process.env.FAKE_YTDLP_LOG;
  delete process.env.FAKE_YTDLP_FMTLOG;
  delete process.env.FAKE_YTDLP_SITE;
  delete process.env.FAKE_YTDLP_FORGE;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

after(() => {
  fs.rmSync(binDir, { recursive: true, force: true });
});

function makeDeps() {
  const db = {};
  return {
    dataDir,
    ytdlpDb: featureStoreFor(ytdlpStoreModule.FEATURE, db),
    loadDatabase: () => docView(db, featureStoreFor(ytdlpStoreModule.FEATURE, db)),
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
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

async function download(base, body) {
  const res = await fetch(`${base}/api/ytdlp/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.strictEqual(res.status, 202);
  const json = await res.json();
  return waitForSettled(json.jobId);
}

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

function folderPath(cfg) {
  return args.resolveChannelDir(cfg, { name: FOLDER });
}

function fileIn(cfg, ext) {
  return path.join(folderPath(cfg), `Some Video [${VIDEO_ID}].${ext}`);
}

function seed(cfg, ext, bytes = LIBRARY_BYTES) {
  const p = fileIn(cfg, ext);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  return { path: p, ino: fs.statSync(p).ino };
}

function listing(cfg) {
  return fs.readdirSync(folderPath(cfg)).sort();
}

function downloadSpawns() {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((argv) => argv.includes('-o'));
}

function assertKept(seeded, what) {
  assert.ok(fs.existsSync(seeded.path), `${what} still exists`);
  assert.ok(fs.readFileSync(seeded.path).equals(LIBRARY_BYTES), `${what} is byte-identical`);
  assert.strictEqual(fs.statSync(seeded.path).ino, seeded.ino, `${what} keeps its inode (never deleted and rewritten)`);
}

// ---- C2: an audio one-off never deletes a file already in the library ------

test('C2: an AUDIO one-off for a URL whose VIDEO (.mp4) is already in the folder keeps the video byte-identical, adds the mp3, and reads "Done" (never "Already in your library")', async () => {
  const deps = makeDeps();
  const cfg = config();
  const video = seed(cfg, 'mp4');
  const { base, close } = await startApp(deps, cfg);
  try {
    const entry = await download(base, { url: VIDEO_URL, folder: FOLDER, format: 'audio' });
    assert.strictEqual(entry.state, 'done', JSON.stringify(entry));
    assertKept(video, 'the library video');
    assert.deepStrictEqual(listing(cfg), [`Some Video [${VIDEO_ID}].mp3`, `Some Video [${VIDEO_ID}].mp4`]);
    assert.match(fs.readFileSync(fileIn(cfg, 'mp3'), 'utf8'), /^AUDIO MADE FROM .*\.mp4: THE ONLY COPY/, 'the mp3 was made from the library video (the C2 mechanism really ran)');
    assert.strictEqual(entry.alreadyInLibrary, undefined, 'a new file was just created: the status must not say "Already in your library"');
    assert.strictEqual(downloadSpawns().length, 1);
  } finally {
    await close();
  }
});

test('C2: YouTube shape -- an existing .webm video plus an mp3 request (bestaudio resolves to the audio-only webm) keeps the webm', async () => {
  process.env.FAKE_YTDLP_SITE = 'youtube';
  const deps = makeDeps();
  const cfg = config();
  const webm = seed(cfg, 'webm');
  const { base, close } = await startApp(deps, cfg);
  try {
    const entry = await download(base, { url: VIDEO_URL, folder: FOLDER, format: 'audio' });
    assert.strictEqual(entry.state, 'done', JSON.stringify(entry));
    assertKept(webm, 'the library webm');
    assert.deepStrictEqual(listing(cfg), [`Some Video [${VIDEO_ID}].mp3`, `Some Video [${VIDEO_ID}].webm`]);
    assert.strictEqual(entry.alreadyInLibrary, undefined);
  } finally {
    await close();
  }
});

test('C2: an existing .m4a (an earlier audio one-off) plus an mp3 request keeps the m4a', async () => {
  process.env.FAKE_YTDLP_SITE = 'm4a';
  const deps = makeDeps();
  const cfg = config();
  const m4a = seed(cfg, 'm4a');
  const { base, close } = await startApp(deps, cfg);
  try {
    const entry = await download(base, { url: VIDEO_URL, folder: FOLDER, format: 'audio' });
    assert.strictEqual(entry.state, 'done', JSON.stringify(entry));
    assertKept(m4a, 'the library m4a');
    assert.deepStrictEqual(listing(cfg), [`Some Video [${VIDEO_ID}].m4a`, `Some Video [${VIDEO_ID}].mp3`]);
  } finally {
    await close();
  }
});

test('C2: the mp3 AND the video both already there -- both kept, nothing converted or removed', async () => {
  const deps = makeDeps();
  const cfg = config();
  const video = seed(cfg, 'mp4');
  const mp3 = seed(cfg, 'mp3');
  const { base, close } = await startApp(deps, cfg);
  try {
    const entry = await download(base, { url: VIDEO_URL, folder: FOLDER, format: 'audio' });
    assert.strictEqual(entry.state, 'done', JSON.stringify(entry));
    assertKept(video, 'the library video');
    assertKept(mp3, 'the library mp3');
    assert.deepStrictEqual(listing(cfg), [`Some Video [${VIDEO_ID}].mp3`, `Some Video [${VIDEO_ID}].mp4`]);
  } finally {
    await close();
  }
});

// ---- a FRESH audio one-off still leaves no intermediate behind -------------

test('C2 control: a FRESH audio one-off (empty folder, combined-formats site) ends with ONLY the mp3 -- the .mp4 it downloaded to convert is removed', async () => {
  const deps = makeDeps();
  const cfg = config();
  const { base, close } = await startApp(deps, cfg);
  try {
    const entry = await download(base, { url: VIDEO_URL, folder: FOLDER, format: 'audio' });
    assert.strictEqual(entry.state, 'done', JSON.stringify(entry));
    assert.deepStrictEqual(listing(cfg), [`Some Video [${VIDEO_ID}].mp3`], 'no source video left behind');
    assert.match(fs.readFileSync(fileIn(cfg, 'mp3'), 'utf8'), /^AUDIO MADE FROM .*\.mp4: FRESH mp4 BYTES/, 'anti-vacuity: an mp4 really was downloaded and converted');
    assert.strictEqual(entry.alreadyInLibrary, undefined, 'a real download');
  } finally {
    await close();
  }
});

test('C2 control: a FRESH audio one-off on YouTube downloads the AUDIO-ONLY stream (the format stays bestaudio/best under -k) and leaves only the mp3', async () => {
  process.env.FAKE_YTDLP_SITE = 'youtube';
  const deps = makeDeps();
  const cfg = config();
  const { base, close } = await startApp(deps, cfg);
  try {
    const entry = await download(base, { url: VIDEO_URL, folder: FOLDER, format: 'audio' });
    assert.strictEqual(entry.state, 'done', JSON.stringify(entry));
    assert.deepStrictEqual(fs.readFileSync(fmtLogPath, 'utf8').trim().split('\n'), ['bestaudio/best -> webm'], 'never the full video format');
    assert.deepStrictEqual(listing(cfg), [`Some Video [${VIDEO_ID}].mp3`]);
  } finally {
    await close();
  }
});

// ---- S1 still holds for a VIDEO one-off ------------------------------------

test('S1 regression: a VIDEO one-off whose file is already there keeps it byte-identical and reads "Already in your library" (no -k, no source print on the video argv)', async () => {
  const deps = makeDeps();
  const cfg = config();
  const video = seed(cfg, 'mp4');
  const { base, close } = await startApp(deps, cfg);
  try {
    const entry = await download(base, { url: VIDEO_URL, folder: FOLDER });
    assert.strictEqual(entry.state, 'done', JSON.stringify(entry));
    assert.strictEqual(entry.alreadyInLibrary, true);
    assertKept(video, 'the library video');
    assert.deepStrictEqual(listing(cfg), [`Some Video [${VIDEO_ID}].mp4`]);
    const [argv] = downloadSpawns();
    assert.ok(!argv.includes('-k'), 'the video argv never carries -k');
    assert.ok(!argv.includes(args.ONE_OFF_AUDIO_SOURCE_PRINT_TEMPLATE));
  } finally {
    await close();
  }
});

// ---- v1.339 F4 (security r2 LOW / INFO): forged FTCHSRC / FTCHDST lines ----
//
// An operator yt-dlp config with its own raw-title `--print` lets a hostile
// title print ANY line on stdout. The forged pair below passes the pure
// planner (real true, a final with the same dir + stem, under the root) --
// only the on-disk creation-time / folder fence (and, for the over-long
// line, the splitter) stand between it and a library file.

const forgedPair = (srcPath, dstPath) => [`FTCHSRC true ${JSON.stringify(srcPath)}\n`, `FTCHDST ${JSON.stringify(dstPath)}\n`];

// Let every seeded library file pre-date the job by more than the allowance.
const outlastSkew = () => new Promise((r) => setTimeout(r, ytdlp.ONE_OFF_SOURCE_CLOCK_SKEW_MS + 300));

function seedAt(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, LIBRARY_BYTES);
  return { path: p, ino: fs.statSync(p).ino };
}

test('F4: forged lines naming a PRE-EXISTING library file in ANOTHER folder under the root -- it stays byte-identical; the genuine fresh intermediate is still cleaned', async () => {
  const deps = makeDeps();
  const cfg = config();
  const otherDir = args.resolveChannelDir(cfg, { name: 'Other Folder' });
  const victim = seedAt(path.join(otherDir, 'Victim Song [vvvvvvvvvvv].mp4'));
  const victimMp3 = seedAt(path.join(otherDir, 'Victim Song [vvvvvvvvvvv].mp3'));
  await outlastSkew();
  process.env.FAKE_YTDLP_FORGE = JSON.stringify({ chunks: forgedPair(victim.path, victimMp3.path) });
  const { base, close } = await startApp(deps, cfg);
  try {
    const entry = await download(base, { url: VIDEO_URL, folder: FOLDER, format: 'audio' });
    assert.strictEqual(entry.state, 'done', JSON.stringify(entry));
    assertKept(victim, 'the other folder\'s library video');
    assertKept(victimMp3, 'the other folder\'s library mp3');
    assert.deepStrictEqual(listing(cfg), [`Some Video [${VIDEO_ID}].mp3`], 'the genuine fresh mp4 is still removed');
    assert.match(fs.readFileSync(fileIn(cfg, 'mp3'), 'utf8'), /FRESH mp4 BYTES/, 'anti-vacuity: a real fresh download happened');
  } finally {
    await close();
  }
});

test('F4: forged lines naming a PRE-EXISTING file in the job\'s OWN folder, with a FRESH forged final beside it -- only the creation-time rule holds, and it keeps the file', async () => {
  const deps = makeDeps();
  const cfg = config();
  const victim = seedAt(path.join(folderPath(cfg), 'Victim Song [vvvvvvvvvvv].mp4'));
  const freshFinal = path.join(folderPath(cfg), 'Victim Song [vvvvvvvvvvv].mp3');
  await outlastSkew();
  process.env.FAKE_YTDLP_FORGE = JSON.stringify({ create: [freshFinal], chunks: forgedPair(victim.path, freshFinal) });
  const { base, close } = await startApp(deps, cfg);
  try {
    const entry = await download(base, { url: VIDEO_URL, folder: FOLDER, format: 'audio' });
    assert.strictEqual(entry.state, 'done', JSON.stringify(entry));
    assertKept(victim, 'the same-folder library video');
    assert.deepStrictEqual(listing(cfg), [`Some Video [${VIDEO_ID}].mp3`, 'Victim Song [vvvvvvvvvvv].mp3', 'Victim Song [vvvvvvvvvvv].mp4']);
  } finally {
    await close();
  }
});

test('F4: forged lines naming a file created DURING the job in ANOTHER folder (a concurrent download\'s fresh pair) -- the job\'s own-folder fence keeps it', async () => {
  const deps = makeDeps();
  const cfg = config();
  const otherDir = args.resolveChannelDir(cfg, { name: 'Other Folder' });
  const fresh = path.join(otherDir, 'Concurrent [ccccccccccc].mp4');
  const freshMp3 = path.join(otherDir, 'Concurrent [ccccccccccc].mp3');
  process.env.FAKE_YTDLP_FORGE = JSON.stringify({ create: [fresh, freshMp3], chunks: forgedPair(fresh, freshMp3) });
  const { base, close } = await startApp(deps, cfg);
  try {
    const entry = await download(base, { url: VIDEO_URL, folder: FOLDER, format: 'audio' });
    assert.strictEqual(entry.state, 'done', JSON.stringify(entry));
    assert.ok(fs.existsSync(fresh), 'another folder\'s fresh file is outside this job\'s folder');
    assert.deepStrictEqual(listing(cfg), [`Some Video [${VIDEO_ID}].mp3`], 'the genuine fresh mp4 is still removed');
  } finally {
    await close();
  }
});

// A VALID FTCHSRC line exactly run.STDERR_TAIL_LIMIT chars long (the path is
// padded with `/.` segments, which path.resolve folds away, plus one JSON `\/`
// for parity): the 4096-char tail a keep-the-tail splitter parsed.
function exactCapLine(prefix, p) {
  const cap = run.STDERR_TAIL_LIMIT;
  const need = cap - (prefix + JSON.stringify(p)).length;
  let lit = JSON.stringify(path.dirname(p) + '/.'.repeat(Math.floor(need / 2)) + '/' + path.basename(p));
  if (need % 2 === 1) lit = lit.replace('/', '\\/');
  const line = prefix + lit;
  assert.strictEqual(line.length, cap);
  return line;
}

test('F4: an over-long stdout line whose last 4096 chars are a valid FTCHSRC line is never parsed (the file it names survives even though every fence would pass)', async () => {
  const deps = makeDeps();
  const cfg = config();
  // A file the job's own run creates fresh, in the job's own folder: were the
  // tail parsed, the creation-time and folder fences would both pass it.
  const bystander = path.join(folderPath(cfg), 'Bystander [bbbbbbbbbbb].mp4');
  const bystanderMp3 = path.join(folderPath(cfg), 'Bystander [bbbbbbbbbbb].mp3');
  const tail = exactCapLine('FTCHSRC true ', bystander);
  const parsed = run.parseAudioSourceLine(tail);
  assert.ok(parsed && parsed.real === true && path.resolve(parsed.path) === bystander, 'anti-vacuity: the tail alone is a valid FTCHSRC line naming the bystander');
  process.env.FAKE_YTDLP_FORGE = JSON.stringify({
    create: [bystander, bystanderMp3],
    chunks: ['x'.repeat(1000) + tail, '\n', `FTCHDST ${JSON.stringify(bystanderMp3)}\n`],
  });
  const { base, close } = await startApp(deps, cfg);
  try {
    const entry = await download(base, { url: VIDEO_URL, folder: FOLDER, format: 'audio' });
    assert.strictEqual(entry.state, 'done', JSON.stringify(entry));
    assert.ok(fs.existsSync(bystander), 'the over-long line was dropped whole, never parsed');
    assert.deepStrictEqual(listing(cfg), ['Bystander [bbbbbbbbbbb].mp3', 'Bystander [bbbbbbbbbbb].mp4', `Some Video [${VIDEO_ID}].mp3`], 'the genuine fresh mp4 is still removed');
  } finally {
    await close();
  }
});
