'use strict';

// [INTEGRATION] v1.365.0 W3 (plan 2026-10-05-small-phones-pocket-downloads-vr): the one-off download trace, end
// to end. A REAL one-off through the real route, the real shared gate and a real child process (a stub yt-dlp on
// PATH, the ytdlp-oneshot-keep-mine.test.js pattern) leaves, in order, queued -> gate-enter -> state
// queued->downloading -> spawn -> child-exit -> child-close -> state downloading->done -> gate-leave in
// <dataDir>/ytdlp-oneshot-trace.jsonl, with only the URL HOST recorded. The export route answers an admin with
// an attachment, refuses a member (403), and fails CLOSED when no admin gate is wired. The status snapshot
// carries the server's `now` (the client's age clock).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trace-bin-'));
const FAKE = String.raw`
const fs = require('fs');
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('2026.08.19\n'); process.exit(0); }
const tmpl = argv[argv.indexOf('-o') + 1];
const target_url = argv[argv.indexOf('--') + 1];
const id = new URL(target_url).searchParams.get('v');
const target = tmpl.replace('%(title)s', 'Trace Video').replace('%(id)s', id).replace('%(ext)s', 'mp4');
fs.mkdirSync(require('path').dirname(target), { recursive: true });
process.stdout.write('[download]  50.0% of 1.00MiB at 1.00MiB/s ETA 00:01\n');
fs.writeFileSync(target, 'BYTES');
const prints = argv.flatMap((t, i) => (t === '--print' ? [argv[i + 1]] : []));
for (const p of prints) {
  if (!p.startsWith('after_move:')) continue;
  const body = p.slice('after_move:'.length);
  if (body.includes('%(__real_download)j')) process.stdout.write(body.replace('%(__real_download)j', 'true') + '\n');
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
const activity = require('../../lib/ytdlp/activity');
const pending = require('../../lib/ytdlp/pending');
const trace = require('../../lib/ytdlp/oneshotTrace');

const originalProbeChannel = run.probeChannel;
const originalProbeChannelAvatar = run.probeChannelAvatar;
const VIDEO_ID = 'dQw4w9WgXcQ';

let tmpDir;
let dataDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trace-dl-'));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trace-data-'));
  run.probeChannel = async () => null;
  run.probeChannelAvatar = async () => null;
});
afterEach(() => {
  run.probeChannel = originalProbeChannel;
  run.probeChannelAvatar = originalProbeChannelAvatar;
  ytdlp.resetPollRerunStateForTests();
  activity.setOneShotStateListener(null);
  trace.resetForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});
after(() => fs.rmSync(binDir, { recursive: true, force: true }));

function makeDeps(extra) {
  const db = {};
  return {
    dataDir,
    ytdlpDb: featureStoreFor(ytdlpStoreModule.FEATURE, db),
    loadDatabase: () => docView(db, featureStoreFor(ytdlpStoreModule.FEATURE, db)),
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
    // Header-driven roles: the route's own gate wiring is what is under test here.
    requireAdmin: (req, res) => {
      if (req.get('x-role') === 'admin') return true;
      res.status(403).json({ error: 'Admins only' });
      return false;
    },
    ...(extra || {}),
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
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); },
  };
}
async function waitForSettled(jobId) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    const entry = activity.getSnapshot().oneShots[jobId];
    if (entry && ['done', 'error', 'cancelled'].includes(entry.state) && !pending.readPending(dataDir).some((e) => e.jobId === jobId)) return entry;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('never settled: ' + JSON.stringify(activity.getSnapshot().oneShots[jobId]));
}

test('a real one-off leaves the full lifecycle in the trace, in order, with only the URL host', async () => {
  const { base, close } = await startApp(makeDeps());
  try {
    const res = await fetch(`${base}/api/ytdlp/download`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${VIDEO_ID}&si=SECRETSHARETOKEN`, folder: 'Trace Folder' }),
    });
    assert.strictEqual(res.status, 202);
    const { jobId } = await res.json();
    const entry = await waitForSettled(jobId);
    assert.strictEqual(entry.state, 'done', JSON.stringify(entry));
    // gate-leave is written after runOneShot's promise settles: wait for it.
    const until = Date.now() + 5000;
    while (Date.now() < until && !trace.readEntries(dataDir).some((e) => e.ev === 'gate-leave')) await new Promise((r) => setTimeout(r, 20));
    const evs = trace.readEntries(dataDir).filter((e) => e.jobId === jobId);
    const names = evs.map((e) => (e.ev === 'state' ? `state:${e.from}->${e.to}` : e.ev));
    const order = ['state:null->queued', 'queued', 'gate-wait', 'gate-enter', 'state:queued->downloading', 'spawn', 'child-exit', 'child-close', 'state:downloading->done', 'gate-leave'];
    let at = -1;
    for (const want of order) {
      const i = names.indexOf(want, at + 1);
      assert.ok(i > at, `${want} after position ${at} in ${JSON.stringify(names)}`);
      at = i;
    }
    const q = evs.find((e) => e.ev === 'queued');
    assert.deepStrictEqual([q.host, q.lane], ['www.youtube.com', 'youtube']);
    assert.strictEqual(evs.find((e) => e.ev === 'gate-leave').ok, true);
    assert.strictEqual(evs.find((e) => e.ev === 'spawn').attempt, 1);
    const raw = fs.readFileSync(trace.tracePath(dataDir), 'utf8');
    assert.ok(!raw.includes(VIDEO_ID), 'never the video id or path');
    assert.ok(!raw.includes('SECRETSHARETOKEN'), 'never a query token');
    assert.ok(!raw.includes('http'), 'never a URL');
  } finally {
    await close();
  }
});

test('GET /api/ytdlp/oneshot-trace.txt: an admin gets an attachment; a member is refused 403 with no trace text', async () => {
  trace.record(dataDir, 'job-x', 'spawn', { pid: 7, attempt: 1 });
  const { base, close } = await startApp(makeDeps());
  try {
    const member = await fetch(`${base}/api/ytdlp/oneshot-trace.txt`, { headers: { 'x-role': 'member' } });
    assert.strictEqual(member.status, 403);
    assert.ok(!(await member.text()).includes('job-x'));
    const admin = await fetch(`${base}/api/ytdlp/oneshot-trace.txt`, { headers: { 'x-role': 'admin' } });
    assert.strictEqual(admin.status, 200);
    assert.match(admin.headers.get('content-type'), /^text\/plain/);
    assert.match(admin.headers.get('content-disposition'), /^attachment; filename="filetube-download-trace-\d{4}-\d\d-\d\dT[\d-]+Z\.txt"$/);
    const text = await admin.text();
    assert.match(text, /^FileTube one-off download trace\n/);
    assert.match(text, /\nserver time: \d{4}-/);
    assert.match(text, /\nversion: \d+\.\d+\.\d+/);
    assert.match(text, /\nentries: 1\n/);
    assert.match(text, / job-x spawn pid=7 attempt=1\n/);
  } finally {
    await close();
  }
});

test('the trace route FAILS CLOSED when no admin gate is wired (nobody reads it)', async () => {
  const deps = makeDeps();
  delete deps.requireAdmin;
  const { base, close } = await startApp(deps);
  try {
    const r = await fetch(`${base}/api/ytdlp/oneshot-trace.txt`, { headers: { 'x-role': 'admin' } });
    assert.strictEqual(r.status, 403);
  } finally {
    await close();
  }
});

test('the status snapshot carries the server clock `now` (the client ages rows on it)', async () => {
  const { base, close } = await startApp(makeDeps());
  try {
    const before = Date.now();
    const body = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.strictEqual(typeof body.now, 'string');
    const t = Date.parse(body.now);
    assert.ok(t >= before - 5 && t <= Date.now() + 5, body.now);
  } finally {
    await close();
  }
});

test('cancel: a cancel of a queued job with no child is traced (cancel-requested, then the state change)', async () => {
  const { base, close } = await startApp(makeDeps());
  try {
    activity.setOneShot('job-q', { state: 'queued', label: 'F' });
    const r = await fetch(`${base}/api/ytdlp/download/job-q/cancel`, { method: 'POST' });
    assert.strictEqual(r.status, 200);
    const evs = trace.readEntries(dataDir).filter((e) => e.jobId === 'job-q').map((e) => (e.ev === 'state' ? `state:${e.from}->${e.to}` : e.ev));
    assert.deepStrictEqual(evs.slice(-2), ['cancel-requested', 'state:queued->cancelled']);
    const unknown = await fetch(`${base}/api/ytdlp/download/no-such-job/cancel`, { method: 'POST' });
    assert.strictEqual(unknown.status, 404);
    assert.ok(!trace.readEntries(dataDir).some((e) => e.jobId === 'no-such-job'), 'an unknown id never writes a line');
  } finally {
    await close();
  }
});
