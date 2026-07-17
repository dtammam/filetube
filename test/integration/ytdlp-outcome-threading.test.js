'use strict';

// [INTEGRATION] v1.29.0 T3: outcome threading + run-log emit + cutoff
// broadening + cookie-warning compute (lib/ytdlp/index.js's
// `runSubscriptionCycle`/`processSubscription`/`runOneShot`), plus the
// `dataDir` threading from server.js's real deps bundles into
// `lib/ytdlp/runlog.js`'s `recordRun`. Boots the REAL `server.js` app
// against an isolated temp `DATA_DIR` (per CONTRIBUTING's isolated-DATA_DIR
// pattern, mirroring test/integration/ytdlp-crud.test.js) so:
//   - AC1.2/1.3 can be proven with a genuine on-disk round-trip (read
//     db.json directly off disk, after dropping the ephemeral `activity`
//     map, rather than trusting any in-memory state a lighter fake-deps
//     harness could accidentally satisfy for the wrong reason);
//   - AC2.1/AC-FM-C's run-log assertions read the REAL
//     `ytdlp-runs.jsonl` this `dataDir` threading is what makes reachable
//     at all (a bare fake-deps harness with no `dataDir` would silently
//     no-op `recordRun`, per its own contract).
// `run.runList`/`run.runDownload` are monkey-patched (no real yt-dlp binary
// or network is ever touched), exactly like every other ytdlp test file.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-outcome-'));
const RUNLOG_FILE = path.join(process.env.DATA_DIR, 'ytdlp-runs.jsonl');
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0'; // manual-only: no real timer during tests

const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  app, loadDatabase, updateDatabase, scanDirectories, getMediaId,
} = require('../../server');
const { readPersistedDatabase } = require('../../lib/db/sqlite');
const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const store = require('../../lib/ytdlp/store');
const activity = require('../../lib/ytdlp/activity');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;

let server;
let base;
let downloadDir;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  activity.resetForTests();
  ytdlp.resetPollRerunStateForTests();
  if (downloadDir) fs.rmSync(downloadDir, { recursive: true, force: true });
  downloadDir = undefined;
  // Each test's own AC2.1-style assertion ("exactly one new line") must not
  // be polluted by an earlier test's entries.
  try { fs.rmSync(RUNLOG_FILE, { force: true }); } catch { /* ignore */ }
});

// The SAME deps shape server.js threads into `ytdlp.registerRoutes`/
// `ytdlp.startBackground` (real disk-backed loadDatabase/updateDatabase,
// PLUS `dataDir` -- this is the exact T3 wiring under test).
function testDeps() {
  return {
    loadDatabase, updateDatabase, scanDirectories, getMediaId, dataDir: process.env.DATA_DIR,
  };
}

function baseConfig(overrides = {}) {
  if (!downloadDir) downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-outcome-dl-'));
  return ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_DOWNLOAD_DIR: downloadDir,
    ...overrides,
  });
}

function ndjson(videos) {
  return videos.map((v) => JSON.stringify(v)).join('\n');
}

async function addSub(overrides = {}) {
  return store.addSubscription(testDeps(), {
    channelUrl: 'https://www.youtube.com/@outcome-thread',
    format: 'video',
    quality: 'best',
    ...overrides,
  });
}

function readRunlogLines() {
  if (!fs.existsSync(RUNLOG_FILE)) return [];
  return fs.readFileSync(RUNLOG_FILE, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

// v1.42: persisted-state reads go through the sanctioned SQLite helper (a
// second, read-only connection -- never the live in-memory state, exactly the
// "read off disk" posture these ACs demand). An empty `ytdlp.downloadMeta`
// persists as zero rows (absent), hence the backfill.
function readPersistedDb() {
  const db = readPersistedDatabase(process.env.DATA_DIR);
  if (!db.ytdlp) db.ytdlp = {};
  if (!db.ytdlp.downloadMeta) db.ytdlp.downloadMeta = {};
  return db;
}

// ---- AC1.2/1.3: the real failure reason persists in lastStatus, and -------
// ---- survives a simulated restart (read off disk, activity map cleared) ---

test('AC1.2/1.3: a failed run\'s real reason persists in lastStatus and survives a simulated restart', async () => {
  const sub = await addSub({ channelUrl: 'https://www.youtube.com/@ac1-restart' });
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'restart-v1', availability: 'public' }]), stderr: '' });
  run.runDownload = async () => ({
    ok: false,
    code: 1,
    stdout: '',
    stderr: '',
    error: 'ERROR: [youtube] restart-v1: Sign in to confirm your age',
  });

  await ytdlp.runPoll(testDeps(), baseConfig(), sub.id);

  // AC1.1 sanity: the live snapshot already carries the real reason.
  const liveRes = await fetch(`${base}/api/subscriptions/status`);
  const liveSnap = await liveRes.json();
  assert.ok(
    liveSnap.subscriptions[sub.id].error.includes('Sign in to confirm your age'),
    `expected the real reason live, got: ${liveSnap.subscriptions[sub.id].error}`,
  );

  // Simulate a restart: drop the ephemeral (in-process-only) activity map --
  // exactly what a real process restart does -- then read the PERSISTED
  // value directly off db.json on disk, never through the live map.
  activity.resetForTests();
  const persisted = readPersistedDb();
  const record = persisted.ytdlp.subscriptions.find((s) => s.id === sub.id);
  assert.ok(record, 'the subscription must still exist in db.json after the simulated restart');
  assert.ok(record.lastStatus.startsWith('error:'), `expected an error status, got: ${record.lastStatus}`);
  assert.ok(
    record.lastStatus.includes('Sign in to confirm your age'),
    `expected the real reason to have survived to disk, got: ${record.lastStatus}`,
  );
  assert.ok(!record.lastStatus.includes('exited with code'), 'must not be the generic exit-code message');
});

// ---- AC2.1: exactly one run-log line per completed run, valid JSON --------

test('AC2.1: exactly one run-log line is appended per completed run, valid JSON, with outcome/counts/reason', async () => {
  const sub = await addSub({ channelUrl: 'https://www.youtube.com/@ac2-runlog' });
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'runlog-v1', availability: 'public' }]), stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  await ytdlp.runPoll(testDeps(), baseConfig(), sub.id);

  const lines = readRunlogLines();
  const forThisSub = lines.filter((line) => line.id === sub.id);
  assert.equal(forThisSub.length, 1, 'exactly one run-log line for this one completed run');
  const entry = forThisSub[0];
  assert.equal(entry.kind, 'subscription');
  assert.equal(entry.outcome, 'success');
  assert.equal(entry.succeeded, 1);
  assert.equal(entry.failed, 0);
  assert.equal(entry.reason, '');
  assert.equal(entry.cookieWarning, false);
  assert.deepEqual(entry.failures, []);
  assert.ok(typeof entry.ts === 'string' && !Number.isNaN(Date.parse(entry.ts)), 'ts must be a valid ISO timestamp');
});

// ---- AC5.x + AC-FM-B: a 9/10 run resolves to partial, end to end ----------

test('AC5.x/AC-FM-B: a 9/10 run resolves to partial, persists both counts + the real reason, and records downloadMeta for the 9 succeeded ids but NOT the 1 failed id (tech-debt #17)', async () => {
  const sub = await addSub({ channelUrl: 'https://www.youtube.com/@ac5-ninetenths' });
  const ids = Array.from({ length: 10 }, (_, i) => `nt-vid${i + 1}`);
  const videos = ids.map((id) => ({ id, availability: 'public' }));
  run.runList = async () => ({ ok: true, stdout: ndjson(videos), stderr: '' });
  run.runDownload = async () => ({
    ok: false,
    code: 1,
    stdout: '',
    stderr: '',
    error: 'yt-dlp exited with code 1',
    itemFailures: [{ videoId: 'nt-vid10', reason: 'Video unavailable' }],
  });

  await ytdlp.runPoll(testDeps(), baseConfig(), sub.id);

  const [record] = store.listSubscriptions(testDeps()).filter((s) => s.id === sub.id);
  assert.ok(record.lastStatus.startsWith('partial:'), `expected a partial: status, got: ${record.lastStatus}`);
  assert.ok(record.lastStatus.includes('9'), `expected the succeeded count (9), got: ${record.lastStatus}`);
  assert.ok(record.lastStatus.includes('1 failed'), `expected the failed count (1 failed), got: ${record.lastStatus}`);
  assert.ok(record.lastStatus.includes('Video unavailable'), `expected the real reason, got: ${record.lastStatus}`);

  const db = readPersistedDb();
  for (const id of ids.slice(0, 9)) {
    assert.ok(db.ytdlp.downloadMeta[id], `expected a downloadMeta entry for succeeded id ${id}`);
  }
  assert.ok(!db.ytdlp.downloadMeta['nt-vid10'], 'the failed id must NOT get a downloadMeta entry (tech-debt #17)');

  const liveSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
  assert.equal(liveSnap.subscriptions[sub.id].outcome, 'partial', 'the live entry must render distinctly as partial (R3a.6)');

  const lines = readRunlogLines();
  const entry = lines.find((line) => line.id === sub.id);
  assert.equal(entry.outcome, 'partial');
  assert.equal(entry.succeeded, 9);
  assert.equal(entry.failed, 1);
  assert.ok(entry.reason.includes('Video unavailable'));

  // Design's explicit Risk tradeoff: a partial run still made progress, so
  // the cutoff advances (unlike a channel-level total failure, which must
  // NOT advance -- covered by a dedicated case below).
  assert.equal(record.cutoffDate, store.formatYyyymmdd(Date.now()), 'a partial outcome must still advance the cutoff');
});

// ---- GF2: the zero-attributed shape now resolves to `error`, not `partial` --
//
// GF1's fix (dedup-by-reason then reserve-1) misclassified this EXACT shape
// (2 unattributed failures against 2 targets, zero attributed) as `partial`,
// which reopened `runSubscriptionCycle`'s `partial` arm --and therefore
// `recordSurvivorChannelMetaFallback` -- for a channel with NO evidence any
// target actually survived. The adversarial delta re-gate's CRITICAL flagged
// this as exactly the phantom-success masking direction the wave exists to
// prevent (generic templated yt-dlp stderr, e.g. the 429 bot-check text, is
// byte-for-byte identical across DISTINCT videos, so "the same text twice"
// carries zero proof of anything having succeeded). GF2's zero-attributed
// override (this file's F1 fix) resolves this exact shape to `error`
// instead: `runSubscriptionCycle`'s `error` arm runs, and
// `recordSurvivorChannelMetaFallback` correctly does NOT run for it --
// accepted, since there is no evidence of success to record metadata for.
test('GF2: the zero-attributed shape (2 unattributed failures, 2 targets) resolves to error -- no survivor-meta fallback recorded, no phantom success', async () => {
  const sub = await addSub({ channelUrl: 'https://www.youtube.com/@gf2-f1-zero-attributed', cutoffDate: '20200101' });
  const ids = ['gf2-a', 'gf2-b'];
  const videos = ids.map((id) => ({ id, availability: 'public' }));
  run.runList = async () => ({ ok: true, stdout: ndjson(videos), stderr: '' });
  // The exact GF1/GF2 F1 gate repro's shape: two UNATTRIBUTED failures
  // (neither videoId matches a known survivor id) against two targets.
  run.runDownload = async () => ({
    ok: false,
    code: 1,
    stdout: '',
    stderr: '',
    error: 'yt-dlp exited with code 1',
    itemFailures: [{ videoId: null, reason: 'r1' }, { videoId: null, reason: 'r2' }],
  });

  await ytdlp.runPoll(testDeps(), baseConfig(), sub.id);

  const [record] = store.listSubscriptions(testDeps()).filter((s) => s.id === sub.id);
  assert.ok(record.lastStatus.startsWith('error:'), `expected the GF2 zero-attributed override to reach 'error:', got: ${record.lastStatus}`);

  const db = readPersistedDb();
  for (const id of ids) {
    assert.ok(!db.ytdlp.downloadMeta[id], `expected NO downloadMeta for either id ${id} -- zero attributed evidence means no proven survivor`);
  }

  const lines = readRunlogLines();
  const entry = lines.find((line) => line.id === sub.id);
  assert.equal(entry.outcome, 'error');
  assert.equal(entry.succeeded, 0);
  assert.equal(entry.failed, 2);

  // The cutoff-freeze benefit falls out of the error classification
  // automatically (no index.js change needed) -- Retry keeps working, since
  // the failed window stays reachable via --dateafter.
  assert.equal(record.cutoffDate, '20200101', 'the zero-attributed error outcome must never advance the cutoff');
});

// ---- Cutoff-advance interaction: total failure must NOT advance -----------

test('a channel-level total failure (nothing succeeded) does NOT advance the cutoff, unlike a partial', async () => {
  const sub = await addSub({ channelUrl: 'https://www.youtube.com/@ac5-totalfail', cutoffDate: '20200101' });
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'tf-v1', availability: 'public' }]), stderr: '' });
  run.runDownload = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: 'Sign in to confirm you\'re not a bot' });

  await ytdlp.runPoll(testDeps(), baseConfig(), sub.id);

  const [record] = store.listSubscriptions(testDeps()).filter((s) => s.id === sub.id);
  assert.equal(record.cutoffDate, '20200101', 'a total failure must never advance the cutoff (the high-value retry case)');

  const lines = readRunlogLines();
  const entry = lines.find((line) => line.id === sub.id);
  assert.equal(entry.outcome, 'error');
  assert.equal(entry.succeeded, 0);
  assert.equal(entry.failed, 1);
});

// ---- AC-FM-C: cookie-missing warning, server side --------------------------

test('AC-FM-C: a configured-but-missing cookies file surfaces cookieWarning:true in both the live status and the run-log line', async () => {
  const sub = await addSub({ channelUrl: 'https://www.youtube.com/@ac-fm-c-warn' });
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'cw-v1', availability: 'public' }]), stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const missingCookiesPath = path.join(process.env.DATA_DIR, 'does-not-exist-cookies.txt');
  const config = baseConfig({ FILETUBE_YTDLP_COOKIES_FILE: missingCookiesPath });

  await ytdlp.runPoll(testDeps(), config, sub.id);

  const liveSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
  assert.equal(
    liveSnap.subscriptions[sub.id].warning,
    true,
    'the live activity entry must carry warning:true for a configured-but-missing cookies file',
  );

  const lines = readRunlogLines();
  const entry = lines.find((line) => line.id === sub.id);
  assert.equal(entry.cookieWarning, true);

  // Additive, not a new failure (R3c.3): the run must still be a clean
  // success -- the warning changes nothing about the outcome.
  assert.equal(entry.outcome, 'success');
});

test('AC-FM-C baseline: no cookies file configured at all produces no warning, live or run-log', async () => {
  const sub = await addSub({ channelUrl: 'https://www.youtube.com/@ac-fm-c-nowarn' });
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'ncw-v1', availability: 'public' }]), stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  await ytdlp.runPoll(testDeps(), baseConfig(), sub.id);

  const liveSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
  assert.ok(!liveSnap.subscriptions[sub.id].warning, 'no cookies file configured at all -> no warning');

  const lines = readRunlogLines();
  const entry = lines.find((line) => line.id === sub.id);
  assert.equal(entry.cookieWarning, false);
});

// ---- R0.8 lock: a cancelled run still settles 'cancelled', never a --------
// ---- synthesized error/partial, even with stderr already attributed -------

test('R0.8: a cancelled run still persists lastStatus "cancelled" and records outcome "cancelled" in the run-log, even when a per-item failure already landed before the SIGKILL', async () => {
  const sub = await addSub({ channelUrl: 'https://www.youtube.com/@r0-8-cancel-lock' });

  let registeredChild = null;
  let resolveDownload;
  run.runList = async () => ({
    ok: true,
    stdout: ndjson([{ id: 'cancel-c1', availability: 'public' }, { id: 'cancel-c2', availability: 'public' }]),
    stderr: '',
  });
  run.runDownload = (_sub, _cfg, _targetIds, opts) => {
    if (opts && typeof opts.onChild === 'function') {
      registeredChild = { killCalls: [], kill(signal) { this.killCalls.push(signal); } };
      opts.onChild(registeredChild);
    }
    return new Promise((resolve) => { resolveDownload = resolve; });
  };

  const pollPromise = ytdlp.runPoll(testDeps(), baseConfig(), sub.id);
  // Give the sequential loop a moment to reach the download stage and
  // register the fake child via onChild.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(registeredChild, 'onChild must have registered a fake child by now');

  const cancelRes = await fetch(`${base}/api/subscriptions/${sub.id}/cancel`, { method: 'POST' });
  assert.equal(cancelRes.status, 200);
  assert.deepEqual(await cancelRes.json(), { cancelled: true, id: sub.id });
  assert.deepEqual(registeredChild.killCalls, ['SIGKILL']);

  // R0.8's new edge case (v1.29.0 T3, now that `partial` exists): an
  // attributed per-item failure ALREADY landed for cancel-c1 before the
  // SIGKILL reached cancel-c2 -- this must still settle 'cancelled', never
  // be miscomputed as 'partial'/'error' from that leftover stderr.
  resolveDownload({
    ok: false,
    code: null,
    signal: 'SIGKILL',
    stdout: '',
    stderr: '',
    error: 'yt-dlp was killed',
    itemFailures: [{ videoId: 'cancel-c1', reason: 'Video unavailable' }],
  });
  await pollPromise;

  const [record] = store.listSubscriptions(testDeps()).filter((s) => s.id === sub.id);
  assert.equal(record.lastStatus, 'cancelled', 'a cancelled run must never persist a synthesized error/partial status');

  const lines = readRunlogLines();
  const entry = lines.find((line) => line.id === sub.id);
  assert.equal(entry.outcome, 'cancelled');
  assert.equal(entry.reason, 'cancelled');
});

// ---- One-shot side: the SAME single terminal run-log line contract --------
// `folder` is supplied explicitly in every request below so the background
// worker skips `run.probeChannel`/`run.probeChannelAvatar` entirely (an
// explicit folder short-circuits `resolveOneOffFolder` -- see that
// function's own doc comment) -- these tests exercise the run-log/outcome
// wiring, not channel-probe behavior, which is covered elsewhere.

async function postOneShotDownload(body) {
  return fetch(`${base}/api/ytdlp/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitForOneShotTerminal(jobId) {
  let snap;
  for (let i = 0; i < 50; i += 1) {
    snap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    const entry = snap.oneShots[jobId];
    if (entry && (entry.state === 'done' || entry.state === 'error' || entry.state === 'cancelled')) return entry;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return snap.oneShots[jobId];
}

test('runOneShot success: emits a single run-log line with kind "one-shot" and outcome "success"', async () => {
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [] });

  const res = await postOneShotDownload({ url: 'https://youtu.be/dQw4w9WgXcQ', folder: 'Outcome One-Shot Success' });
  assert.equal(res.status, 202);
  const { jobId } = await res.json();

  const finalEntry = await waitForOneShotTerminal(jobId);
  assert.equal(finalEntry.state, 'done', 'the one-shot must have settled to done within the bounded wait');

  const lines = readRunlogLines();
  const entry = lines.find((line) => line.kind === 'one-shot' && line.id === jobId);
  assert.ok(entry, 'expected a one-shot run-log line for this job');
  assert.equal(entry.outcome, 'success');
  assert.equal(entry.succeeded, 1);
  assert.equal(entry.failed, 0);
  assert.equal(entry.reason, '');
});

test('runOneShot error: emits a single run-log line with kind "one-shot" and outcome "error", carrying the real reason', async () => {
  run.runDownload = async () => ({
    ok: false, code: 1, stdout: '', stderr: '', error: 'ERROR: [youtube] dQw4w9WgXcQ: Video unavailable',
  });

  const res = await postOneShotDownload({ url: 'https://youtu.be/dQw4w9WgXcQ', folder: 'Outcome One-Shot Error' });
  assert.equal(res.status, 202);
  const { jobId } = await res.json();

  const finalEntry = await waitForOneShotTerminal(jobId);
  assert.equal(finalEntry.state, 'error');

  const lines = readRunlogLines();
  const entry = lines.find((line) => line.kind === 'one-shot' && line.id === jobId);
  assert.ok(entry, 'expected a one-shot run-log line for this job');
  assert.equal(entry.outcome, 'error');
  assert.equal(entry.succeeded, 0);
  assert.equal(entry.failed, 1);
  assert.ok(entry.reason.includes('Video unavailable'), `expected the real reason, got: ${entry.reason}`);
});
