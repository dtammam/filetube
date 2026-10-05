'use strict';

// [UNIT] v1.365.0 W3 (plan 2026-10-05-small-phones-pocket-downloads-vr): the one-off download TRACE
// (lib/ytdlp/oneshotTrace.js), an instrument for the "one-off download stuck" report. Bound here: every event
// lands as one JSONL line; the cap keeps the last TRACE_MAX_LINES; a throwing fs never escapes (the write is
// counted instead); only a URL's host is ever recorded; the export text; the ONE choke point for `state`
// events (activity.setOneShot's listener, fired on a CHANGE only, a throwing listener swallowed); and run.js's
// per-call hook, driven through a REAL child process: spawn, the child's 'exit' and its 'close' as separate
// events, in that order, never touching the download's result.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const trace = require('../../lib/ytdlp/oneshotTrace');
const activity = require('../../lib/ytdlp/activity');

const dirs = [];
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trace-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  trace.resetForTests();
  activity.setOneShotStateListener(null);
  activity.resetForTests();
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});
const lines = (d) => fs.readFileSync(trace.tracePath(d), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('record: one JSONL line per event, {t, jobId, ev, ...fields}, oldest first; the caller cannot override t/jobId/ev', () => {
  const d = tmpDir();
  trace.record(d, 'job-1', 'queued', { host: 'www.youtube.com', lane: 'youtube' });
  trace.record(d, 'job-1', 'gate-enter', { jobId: 'forged', ev: 'forged', t: 'forged' });
  const got = lines(d);
  assert.strictEqual(got.length, 2);
  assert.strictEqual(got[0].ev, 'queued');
  assert.strictEqual(got[0].host, 'www.youtube.com');
  assert.match(got[0].t, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.deepStrictEqual([got[1].jobId, got[1].ev], ['job-1', 'gate-enter']);
  assert.match(got[1].t, /^\d{4}-/);
  assert.deepStrictEqual(trace.readEntries(d).map((e) => e.ev), ['queued', 'gate-enter']);
  assert.strictEqual(trace.stats().writes, 2);
});

test('record: refuses a missing dataDir, jobId or event without writing or throwing', () => {
  const d = tmpDir();
  for (const args of [[undefined, 'j', 'ev'], ['', 'j', 'ev'], [d, '', 'ev'], [d, 'j', ''], [d, null, 'ev']]) {
    assert.doesNotThrow(() => trace.record(...args));
  }
  assert.strictEqual(fs.existsSync(trace.tracePath(d)), false);
});

test('the cap: past TRACE_TRIM_AT lines the file is rewritten to the last TRACE_MAX_LINES; the reader never returns more', () => {
  const d = tmpDir();
  for (let i = 0; i < trace.TRACE_TRIM_AT + 5; i++) trace.record(d, 'j', 'progress', { i });
  const got = lines(d);
  assert.ok(got.length <= trace.TRACE_TRIM_AT, 'file lines ' + got.length);
  assert.strictEqual(got[got.length - 1].i, trace.TRACE_TRIM_AT + 4, 'the newest line is kept');
  const read = trace.readEntries(d);
  assert.ok(read.length <= trace.TRACE_MAX_LINES);
  assert.strictEqual(read[read.length - 1].i, trace.TRACE_TRIM_AT + 4);
  assert.strictEqual(read[0].i, trace.TRACE_TRIM_AT + 5 - read.length, 'contiguous: the oldest are the ones dropped');
  // Exactly at the trim, the file holds TRACE_MAX_LINES.
  const d2 = tmpDir();
  for (let i = 0; i < trace.TRACE_TRIM_AT; i++) trace.record(d2, 'j', 'progress', { i });
  assert.strictEqual(lines(d2).length, trace.TRACE_MAX_LINES);
});

test('a throwing fs (full disk, read-only volume) never throws into the caller; the failure is counted', () => {
  const d = tmpDir();
  const boom = () => { throw new Error('ENOSPC'); };
  trace.setFsForTests({ readFileSync: boom, appendFileSync: boom, writeFileSync: boom, renameSync: boom });
  assert.doesNotThrow(() => trace.record(d, 'j', 'spawn', { pid: 1 }));
  assert.strictEqual(trace.stats().errors, 1);
  assert.strictEqual(trace.stats().writes, 0);
  assert.deepStrictEqual(trace.readEntries(d), [], 'the reader never throws either');
});

test('a torn or garbage line is skipped by the reader', () => {
  const d = tmpDir();
  trace.record(d, 'j', 'spawn', { pid: 1 });
  fs.appendFileSync(trace.tracePath(d), '{"t":"x","jobId"\n[1,2]\nnot json\n');
  trace.record(d, 'j', 'child-exit', { code: 0 });
  assert.deepStrictEqual(trace.readEntries(d).map((e) => e.ev), ['spawn', 'child-exit']);
});

test('hostOf: the host only - never a path, a query or a token', () => {
  assert.strictEqual(trace.hostOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1'), 'www.youtube.com');
  assert.strictEqual(trace.hostOf('https://user:secret@vimeo.com:8443/123?token=abc'), 'vimeo.com:8443');
  assert.strictEqual(trace.hostOf('not a url'), '');
  assert.strictEqual(trace.hostOf(null), '');
});

test('formatTraceText: a self-describing header, then one line per event, oldest first', () => {
  const text = trace.formatTraceText([
    { t: '2026-10-05T10:00:00.000Z', jobId: 'j1', ev: 'spawn', pid: 42, attempt: 1 },
    { t: '2026-10-05T10:00:05.000Z', jobId: 'j1', ev: 'child-exit', code: 0, signal: null },
  ], { serverTime: '2026-10-05T11:00:00.000Z', version: '1.365.0', writeErrors: 2 });
  const l = text.split('\n');
  assert.strictEqual(l[0], 'FileTube one-off download trace');
  assert.ok(l.includes('server time: 2026-10-05T11:00:00.000Z'));
  assert.ok(l.includes('version: 1.365.0'));
  assert.ok(l.includes('entries: 2 (trace write errors since start: 2)'));
  assert.ok(l.includes('2026-10-05T10:00:00.000Z j1 spawn pid=42 attempt=1'));
  assert.ok(l.includes('2026-10-05T10:00:05.000Z j1 child-exit code=0 signal=null'));
  assert.ok(text.indexOf('spawn') < text.indexOf('child-exit'));
  assert.match(trace.formatTraceText([], {}), /entries: 0\n/);
});

// ---- the state choke point --------------------------------------------------------------

test('activity.setOneShot fires the state listener on a CHANGE of state only, with from/to', () => {
  const seen = [];
  activity.setOneShotStateListener((c) => seen.push([c.jobId, c.from, c.to]));
  activity.setOneShot('j1', { state: 'queued' });
  activity.setOneShot('j1', { percent: 5 }); // no state change
  activity.setOneShot('j1', { state: 'downloading' });
  activity.setOneShot('j1', { state: 'downloading', percent: 40 }); // same state
  activity.setOneShot('j1', { state: 'done' });
  assert.deepStrictEqual(seen, [['j1', null, 'queued'], ['j1', 'queued', 'downloading'], ['j1', 'downloading', 'done']]);
});

test('a throwing state listener never breaks a state write', () => {
  activity.setOneShotStateListener(() => { throw new Error('boom'); });
  assert.doesNotThrow(() => activity.setOneShot('j1', { state: 'queued' }));
  assert.strictEqual(activity.getSnapshot().oneShots.j1.state, 'queued');
});

// ---- run.js: the per-call hook through a REAL child process --------------------------------

test('run.js: a real spawn traces spawn, child-exit and child-close (separately, in order), and the result is unchanged', async () => {
  const run = require('../../lib/ytdlp/run');
  const engine = require('../../lib/ytdlp/engine');
  const d = tmpDir();
  const bin = path.join(d, 'fake-ytdlp');
  fs.writeFileSync(bin, `#!${process.execPath}\nprocess.stdout.write('[download]  50.0% of 1.00MiB\\n'); setTimeout(() => process.exit(3), 20);\n`, { mode: 0o755 });
  const orig = engine.activeBinaryPath;
  engine.activeBinaryPath = () => bin;
  const events = [];
  try {
    const withTrace = await run.spawnYtdlpDownload(['--', 'x'], { timeoutMs: 10000, onTrace: (ev, f) => events.push([ev, f]) });
    const without = await run.spawnYtdlpDownload(['--', 'x'], { timeoutMs: 10000 });
    assert.deepStrictEqual(events.map((e) => e[0]), ['spawn', 'child-exit', 'child-close']);
    assert.strictEqual(events[0][1].attempt, 1);
    assert.ok(Number.isInteger(events[0][1].pid) && events[0][1].pid > 0, 'the real pid');
    assert.strictEqual(events[1][1].code, 3);
    assert.ok(events[1][1].ms >= 0);
    assert.strictEqual(events[2][1].code, 3);
    assert.ok(typeof events[2][1].msAfterExit === 'number' && events[2][1].msAfterExit >= 0, 'close is timed from the exit');
    assert.strictEqual(withTrace.ok, without.ok);
    assert.strictEqual(withTrace.code, without.code);
    // A throwing hook changes nothing either.
    const thrown = await run.spawnYtdlpDownload(['--', 'x'], { timeoutMs: 10000, onTrace: () => { throw new Error('boom'); } });
    assert.strictEqual(thrown.code, 3);
  } finally {
    engine.activeBinaryPath = orig;
  }
});

test('run.js: the stall watchdog\'s kill is traced with its reason, before the exit', async () => {
  const run = require('../../lib/ytdlp/run');
  const engine = require('../../lib/ytdlp/engine');
  const d = tmpDir();
  const bin = path.join(d, 'fake-ytdlp-hang');
  fs.writeFileSync(bin, `#!${process.execPath}\nsetTimeout(() => {}, 60000);\n`, { mode: 0o755 });
  const orig = engine.activeBinaryPath;
  engine.activeBinaryPath = () => bin;
  const events = [];
  try {
    const r = await run.spawnYtdlpDownload(['--', 'x'], { timeoutMs: 10000, stallMs: 150, onTrace: (ev, f) => events.push([ev, f]) });
    assert.strictEqual(r.ok, false);
    const names = events.map((e) => e[0]);
    assert.deepStrictEqual(names, ['spawn', 'kill', 'child-exit', 'child-close']);
    assert.strictEqual(events[1][1].why, 'stall');
    assert.strictEqual(events[2][1].signal, 'SIGKILL');
  } finally {
    engine.activeBinaryPath = orig;
  }
});

test('run.runDownload forwards the hook and numbers the subtitle retry as attempt 2 (source lock on the one wire)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'run.js'), 'utf8');
  assert.match(src, /onTrace: opts && opts\.onTrace,\n\s+attempt: skipSubtitles \? 2 : 1,/);
});

// ---- the backup bundle never carries the trace ----------------------------------------------

test('the backup bundle never carries the trace: backup.js reads only the database and the logo files', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'admin', 'backup.js'), 'utf8');
  assert.doesNotMatch(src, /oneshot-trace|oneshotTrace|ytdlp-oneshot/);
  assert.doesNotMatch(src, /readdirSync/, 'no directory sweep that could pick the file up');
  const reads = src.match(/readFileSync\(/g) || [];
  assert.strictEqual(reads.length, 1, 'the one file read is the custom logo');
  assert.match(src, /fs\.readFileSync\(customLogoPath\(variant\)\)/);
});

// ---- gate r1 (adversary W1/W2/W4/W5, qa W1) ------------------------------------------------

// A fake yt-dlp written as a node script; `body` is its source.
function fakeBin(d, name, body) {
  const bin = path.join(d, name);
  fs.writeFileSync(bin, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  return bin;
}
async function withBin(bin, fn) {
  const engine = require('../../lib/ytdlp/engine');
  const orig = engine.activeBinaryPath;
  engine.activeBinaryPath = () => bin;
  try { return await fn(require('../../lib/ytdlp/run')); } finally { engine.activeBinaryPath = orig; }
}
// The adversary's shape: the child exits at once while a grandchild holds its stdout/stderr for `ms`.
const GRANDCHILD = (ms) => `require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, ${ms})'], { stdio: ['ignore', 'inherit', 'inherit'] }); process.exit(0);`;

test('gate r1 W2: the heartbeat keeps beating after the exit until the pipes close, and says so (exited, msSinceExit)', async () => {
  const d = tmpDir();
  trace.setProgressMsForTests(20);
  const events = [];
  await withBin(fakeBin(d, 'gc', GRANDCHILD(600)), (run) => run.spawnYtdlpDownload(['--', 'x'], { timeoutMs: 10000, onTrace: (ev, f) => events.push([ev, f]) }));
  const names = events.map((e) => e[0]);
  const exitAt = names.indexOf('child-exit');
  const closeAt = names.indexOf('child-close');
  assert.ok(exitAt > 0 && closeAt > exitAt, JSON.stringify(names));
  const after = events.slice(exitAt + 1, closeAt).filter((e) => e[0] === 'progress');
  assert.ok(after.length >= 2, 'beats between exit and close: ' + after.length);
  for (const [, f] of after) {
    assert.strictEqual(f.exited, true);
    assert.ok(typeof f.msSinceExit === 'number' && f.msSinceExit >= 0, JSON.stringify(f));
  }
  assert.ok(after[after.length - 1][1].msSinceExit > after[0][1].msSinceExit, 'msSinceExit grows');
  const before = events.slice(0, exitAt).filter((e) => e[0] === 'progress');
  for (const [, f] of before) assert.deepStrictEqual([f.exited, f.msSinceExit], [false, null]);
  assert.strictEqual(names.slice(closeAt + 1).length, 0, 'nothing after close: the heartbeat stopped');
});

test('gate r1 W2: the heartbeat backs off after TRACE_PROGRESS_FAST_BEATS beats (30 s, then every 5 min)', async () => {
  assert.strictEqual(trace.progressDelayMs(1), trace.TRACE_PROGRESS_MS);
  assert.strictEqual(trace.progressDelayMs(trace.TRACE_PROGRESS_FAST_BEATS), trace.TRACE_PROGRESS_MS);
  assert.strictEqual(trace.progressDelayMs(trace.TRACE_PROGRESS_FAST_BEATS + 1), 5 * 60 * 1000, '5 min');
  // Wired: run.js schedules by it. 10 ms beats: ten in the first ~100 ms, then one per ~100 ms.
  const d = tmpDir();
  trace.setProgressMsForTests(10);
  const beats = [];
  const t0 = Date.now();
  await withBin(fakeBin(d, 'hang', 'setTimeout(() => {}, 60000);'), (run) => run.spawnYtdlpDownload(['--', 'x'], {
    timeoutMs: 10000, stallMs: 700, onTrace: (ev) => { if (ev === 'progress') beats.push(Date.now() - t0); },
  }));
  assert.ok(beats.length >= trace.TRACE_PROGRESS_FAST_BEATS + 2, 'beats: ' + beats.length);
  assert.ok(beats.length <= 25, 'backed off (no back-off would be ~70): ' + beats.length);
  const slowGap = beats[trace.TRACE_PROGRESS_FAST_BEATS + 1] - beats[trace.TRACE_PROGRESS_FAST_BEATS];
  assert.ok(slowGap >= 80, 'the gap after the fast beats: ' + slowGap + ' ms');
});

test('gate r1 X18: the heartbeat\'s msSinceOutput is measured from the LATEST output, not the spawn', async () => {
  const d = tmpDir();
  trace.setProgressMsForTests(10);
  const beats = [];
  const t0 = Date.now();
  const body = "process.stdout.write('[download]  10.0% of 1.00MiB\\n'); setTimeout(() => process.stdout.write('[download]  60.0% of 1.00MiB\\n'), 300); setTimeout(() => process.exit(0), 650);";
  await withBin(fakeBin(d, 'talk', body), (run) => run.spawnYtdlpDownload(['--', 'x'], {
    timeoutMs: 10000, onTrace: (ev, f) => { if (ev === 'progress') beats.push({ at: Date.now() - t0, f }); },
  }));
  const late = beats.filter((b) => b.at >= 420);
  assert.ok(late.length >= 1, 'a beat after the second output: ' + JSON.stringify(beats.map((b) => b.at)));
  for (const b of late) assert.ok(b.f.msSinceOutput < b.at - 200, `msSinceOutput ${b.f.msSinceOutput} at ${b.at} ms`);
  assert.strictEqual(late[late.length - 1].f.pct, 60, 'the last percent seen');
});

test('gate r1 W4: the absolute timeout\'s kill is traced with why=timeout, before the exit', async () => {
  const d = tmpDir();
  const events = [];
  const r = await withBin(fakeBin(d, 'hang2', 'setTimeout(() => {}, 60000);'), (run) => run.spawnYtdlpDownload(['--', 'x'], { timeoutMs: 200, onTrace: (ev, f) => events.push([ev, f]) }));
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(events.map((e) => e[0]).filter((n) => n !== 'progress'), ['spawn', 'kill', 'child-exit', 'child-close']);
  const kill = events.find((e) => e[0] === 'kill')[1];
  assert.deepStrictEqual([kill.why, kill.signal, kill.pid], ['timeout', 'SIGKILL', events[0][1].pid]);
});

test('gate r1 W2: the trim keeps a still-open job\'s lifecycle lines however old; a closed job\'s go', () => {
  const d = tmpDir();
  trace.record(d, 'closed', 'spawn', { pid: 1 });
  trace.record(d, 'closed', 'child-exit', { code: 0 });
  trace.record(d, 'closed', 'child-close', { code: 0 });
  trace.record(d, 'closed', 'gate-leave', { ok: true });
  for (const ev of ['queued', 'gate-wait', 'gate-enter', 'spawn', 'child-exit']) trace.record(d, 'hung', ev, { k: ev });
  for (let i = 0; i < trace.TRACE_TRIM_AT + 500; i++) trace.record(d, 'hung', 'progress', { i, exited: true });
  const file = lines(d);
  assert.ok(file.length <= trace.TRACE_TRIM_AT, 'bounded: ' + file.length);
  const fileHung = file.filter((e) => e.jobId === 'hung' && e.ev !== 'progress').map((e) => e.ev);
  assert.deepStrictEqual(fileHung, ['queued', 'gate-wait', 'gate-enter', 'spawn', 'child-exit'], 'on disk');
  const read = trace.readEntries(d);
  assert.ok(read.length <= trace.TRACE_MAX_LINES);
  assert.deepStrictEqual(read.filter((e) => e.jobId === 'hung' && e.ev !== 'progress').map((e) => e.ev), ['queued', 'gate-wait', 'gate-enter', 'spawn', 'child-exit'], 'in the export');
  assert.strictEqual(read[read.length - 1].i, trace.TRACE_TRIM_AT + 499, 'the newest beat');
  assert.ok(!read.some((e) => e.jobId === 'closed'), 'a closed job (gate-leave) is trimmed like any old line');
  // A job that reached a terminal state with every child closed is closed too; one whose child never closed is not.
  const mask = trace.keepMask([
    { jobId: 'a', ev: 'spawn' }, { jobId: 'a', ev: 'state', to: 'error' },
    { jobId: 'b', ev: 'spawn' }, { jobId: 'b', ev: 'child-close' }, { jobId: 'b', ev: 'state', to: 'done' },
    ...Array.from({ length: 6 }, () => ({ jobId: 'x', ev: 'progress' })),
  ], 8);
  // max 8: at most 2 pinned lines (max / 4), then the 6 newest.
  assert.deepStrictEqual(mask, [true, true, false, false, false, true, true, true, true, true, true], 'a (error while its child never closed) keeps its lines; b is closed');
});

test('gate r1 W2 end to end: a 1 ms heartbeat over a grandchild-held hang never trims away spawn or child-exit', async () => {
  const d = tmpDir();
  trace.setProgressMsForTests(1);
  trace.setLimitsForTests({ maxLines: 40 });
  trace.record(d, 'job-h', 'queued', { host: 'www.youtube.com' });
  trace.record(d, 'job-h', 'gate-enter');
  await withBin(fakeBin(d, 'gc2', GRANDCHILD(1500)), (run) => run.spawnYtdlpDownload(['--', 'x'], { timeoutMs: 10000, onTrace: (ev, f) => trace.record(d, 'job-h', ev, f) }));
  const got = trace.readEntries(d);
  const beats = got.filter((e) => e.ev === 'progress');
  assert.ok(trace.stats().writes > 60, 'the cap was crossed: ' + trace.stats().writes + ' writes');
  assert.ok(lines(d).length <= 41, 'the file is bounded: ' + lines(d).length);
  const order = got.filter((e) => e.ev !== 'progress').map((e) => e.ev);
  assert.deepStrictEqual(order, ['queued', 'gate-enter', 'spawn', 'child-exit', 'child-close']);
  assert.ok(beats.length > 0 && beats.every((b) => b.exited === true), 'the surviving beats say the child exited');
});

test('gate r1 W5: a full disk during a trim leaves no orphan .tmp and the file stays bounded', () => {
  const d = tmpDir();
  const enospc = {
    ...fs,
    writeFileSync(p, data, enc) {
      if (String(p).endsWith('.tmp')) {
        fs.writeFileSync(p, 'x'.repeat(4096)); // write(2) wrote part of it, then the disk filled
        const e = new Error('ENOSPC: no space left on device'); e.code = 'ENOSPC'; throw e;
      }
      return fs.writeFileSync(p, data, enc);
    },
  };
  trace.setFsForTests(enospc);
  const total = trace.TRACE_MAX_LINES * trace.TRACE_HARD_CAP_FACTOR + 300;
  for (let i = 0; i < total; i++) assert.doesNotThrow(() => trace.record(d, 'j', 'progress', { i }));
  const tmps = fs.readdirSync(d).filter((f) => f.endsWith('.tmp'));
  assert.deepStrictEqual(tmps, [], 'no orphan .tmp files');
  const n = lines(d).length;
  assert.ok(n <= trace.TRACE_MAX_LINES * trace.TRACE_HARD_CAP_FACTOR, 'bounded while trims fail: ' + n);
  assert.ok(trace.stats().errors > 0, 'the failures were counted');
});

test('gate r1 W4: the gate task traces gate-enter, then gate-leave ok:true, or ok:false on a rejection (which still propagates)', async () => {
  const ytdlp = require('../../lib/ytdlp');
  const d = tmpDir();
  assert.strictEqual(await ytdlp.traceGateTask(d, 'ok-job', async () => 7)(), 7);
  await assert.rejects(ytdlp.traceGateTask(d, 'bad-job', async () => { throw new Error('boom'); })(), /boom/);
  const got = trace.readEntries(d).map((e) => [e.jobId, e.ev, e.ok]);
  assert.deepStrictEqual(got, [['ok-job', 'gate-enter', undefined], ['ok-job', 'gate-leave', true], ['bad-job', 'gate-enter', undefined], ['bad-job', 'gate-leave', false]]);
});
