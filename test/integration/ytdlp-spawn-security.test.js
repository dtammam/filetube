'use strict';

// [INTEGRATION] lib/ytdlp/run.js -- the spawn boundary itself (AC 28, and
// the "never logged"/"never returned" halves of AC 31, plus the SF1-SF3
// security-fix-round regressions, plus the v1.11.1 hotfix that moved the
// LIST path from `execFile`+`maxBuffer` to `spawn`+streaming).
// `child_process.spawn` is spied by monkey-patching
// `require('child_process').spawn` (run.js references `cp.spawn` at call
// time, not a destructured import, specifically so this works without a
// mocking library or dependency injection -- see the comment at the top of
// lib/ytdlp/run.js). No real yt-dlp binary is ever invoked; no network is
// touched.

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const run = require('../../lib/ytdlp/run');
const rules = require('../../lib/ytdlp/rules');
const { buildYtdlpDownloadArgs } = require('../../lib/ytdlp/args');

const originalSpawn = cp.spawn;
const originalConsoleError = console.error;

let capturedSpawnCalls;
let capturedLogs;

beforeEach(() => {
  capturedSpawnCalls = [];
  capturedLogs = [];
  console.error = (...logArgs) => {
    capturedLogs.push(logArgs.map(String).join(' '));
  };
});

afterEach(() => {
  cp.spawn = originalSpawn;
  console.error = originalConsoleError;
});

// A minimal fake child process: an EventEmitter with `.stdout`/`.stderr`
// streams (also EventEmitters) and a `.kill()` spy, close enough to the real
// `ChildProcess` shape for both `spawnYtdlp` (list path) and
// `spawnYtdlpDownload` (download path) to drive.
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal);
    // Mirrors real OS behavior: a kill() eventually produces a 'close' event
    // (asynchronously, never synchronously) -- lets tests exercise the
    // real timeout->kill->clean-resolve path end-to-end.
    setImmediate(() => child.emit('close', null, signal));
  };
  return child;
}

function stubSpawn(onCall) {
  cp.spawn = (cmd, argv, opts) => {
    const child = makeFakeChild();
    capturedSpawnCalls.push({ cmd, argv, opts, child });
    if (onCall) onCall(child, { cmd, argv, opts });
    return child;
  };
  return () => capturedSpawnCalls[capturedSpawnCalls.length - 1].child;
}

// ---- AC 28: arg-array spawn, NEVER shell:true, even under a hostile URL ---
// ---- (LIST path: spawnYtdlp, run.runList) ----------------------------------

test('spawnYtdlp calls spawn with ("yt-dlp", <array>, opts) and never {shell:true}', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlp(['--dump-json', '--', 'https://www.youtube.com/@x']);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from('{}'));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(capturedSpawnCalls.length, 1);
  const { cmd, argv, opts } = capturedSpawnCalls[0];
  assert.equal(cmd, 'yt-dlp');
  assert.ok(Array.isArray(argv));
  assert.notEqual(opts && opts.shell, true, 'shell:true must never be set');
});

test('spawnYtdlp passes a shell-metacharacter-laden string as a single argv element -- never shell:true, even when the string is deliberately hostile', async () => {
  const spawnChild = stubSpawn();
  // validateChannelUrl would reject this upstream (see ytdlp-url.test.js) --
  // this test proves the LOW-LEVEL spawn boundary itself is arg-array-only
  // regardless of content, i.e. defense-in-depth: even if validation were
  // somehow bypassed, spawn with an array never lets a shell interpret these
  // characters.
  const hostileUrl = 'https://youtube.com/@x; rm -rf /';
  const resultPromise = run.spawnYtdlp(['--dump-json', '--', hostileUrl]);
  const child = spawnChild();
  child.emit('close', 0, null);
  await resultPromise;
  const { cmd, argv, opts } = capturedSpawnCalls[0];
  assert.equal(cmd, 'yt-dlp');
  assert.ok(Array.isArray(argv));
  assert.equal(argv[argv.length - 1], hostileUrl, 'the hostile string is one opaque argv element, never parsed/split');
  assert.notEqual(opts && opts.shell, true);
});

test('spawnYtdlp with a "--exec"-style hostile string is still an arg-array call, never shell:true', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlp(['--', '--exec=whoami']);
  const child = spawnChild();
  child.emit('close', 0, null);
  await resultPromise;
  const { argv, opts } = capturedSpawnCalls[0];
  assert.ok(Array.isArray(argv));
  assert.notEqual(opts && opts.shell, true);
});

test('spawnYtdlp resolves a structured error result (never throws) when the child reports a spawn failure (ENOENT)', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlp(['--version']);
  const child = spawnChild();
  child.emit('error', Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }));
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
});

test('spawnYtdlp resolves a structured error result (never throws) on a non-zero exit code', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlp(['--dump-json', '--', 'https://www.youtube.com/@x']);
  const child = spawnChild();
  child.emit('close', 1, null);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 1);
});

test('spawnYtdlp never throws even if spawn itself throws synchronously', async () => {
  cp.spawn = () => { throw new Error('boom'); };
  const result = await run.spawnYtdlp(['--version']);
  assert.equal(result.ok, false);
});

// ---- SF1: cookies path never appears in a log line NOR in the returned ----
// ---- result, proven against realistic yt-dlp stderr output that embeds  ----
// ---- the cookies path (the LIST path pipes stderr into a bounded tail   ----
// ---- rather than handing back a raw Node execFile error.message, but    ----
// ---- the redaction guarantee must hold identically).                   ----

test('SF1: cookies path embedded in yt-dlp stderr output never reaches console.error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'secret-cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');

  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlp(['--dump-json', '--cookies', cookiesFile, '--', 'https://www.youtube.com/@x'], {
    cookiesPath: cookiesFile,
  });
  const child = spawnChild();
  child.stderr.emit('data', Buffer.from(`ERROR: [youtube] some-video-id: Sign in to confirm your age. Cookies file: ${cookiesFile}\n`));
  child.emit('close', 1, null);
  await resultPromise;

  const allLogs = capturedLogs.join('\n');
  assert.ok(!allLogs.includes(cookiesFile), `cookies path leaked into a log line: ${allLogs}`);
});

test('SF1: cookies path embedded in yt-dlp stderr output never appears in the RETURNED result (any field)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'secret-cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');

  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlp(['--dump-json', '--cookies', cookiesFile, '--', 'https://www.youtube.com/@x'], {
    cookiesPath: cookiesFile,
  });
  const child = spawnChild();
  child.stderr.emit('data', Buffer.from(`ERROR: [youtube] some-video-id: Sign in to confirm your age. Cookies file: ${cookiesFile}\n`));
  child.emit('close', 1, null);
  const result = await resultPromise;

  assert.equal(result.ok, false);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(cookiesFile), `cookies path leaked into the returned result: ${serialized}`);
  // A guard for T4: this is the exact value it would persist via
  // setSubscriptionStatus -> db.json -> GET /api/subscriptions.
  assert.ok(!String(result.error).includes(cookiesFile));
});

test('SF1: the sync-throw path never logs nor returns a cookies path embedded in the thrown error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'secret-cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');

  cp.spawn = () => {
    throw new Error(`Failed to exec yt-dlp --cookies ${cookiesFile}: EMFILE`);
  };
  const result = await run.spawnYtdlp(['--dump-json', '--cookies', cookiesFile, '--', 'https://www.youtube.com/@x'], {
    cookiesPath: cookiesFile,
  });

  assert.equal(result.ok, false);
  const allLogs = capturedLogs.join('\n');
  assert.ok(!allLogs.includes(cookiesFile), `cookies path leaked into a log line (sync throw): ${allLogs}`);
  assert.ok(!JSON.stringify(result).includes(cookiesFile), `cookies path leaked into the returned result (sync throw): ${JSON.stringify(result)}`);
});

test('buildYtdlpDownloadArgs + a failed run: the real cookies path from config never reaches a log line or the returned result', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };

  const builtArgs = buildYtdlpDownloadArgs(sub, config, ['vid1']);
  assert.ok(builtArgs.includes(cookiesFile), 'sanity: the real path IS in the raw args before redaction');

  const spawnChild = stubSpawn();
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  child.emit('close', 1, null);
  const result = await resultPromise;

  assert.equal(result.ok, false);
  const allLogs = capturedLogs.join('\n');
  assert.ok(!allLogs.includes(cookiesFile), `cookies path leaked into a log line: ${allLogs}`);
  assert.ok(!JSON.stringify(result).includes(cookiesFile), `cookies path leaked into the returned result: ${JSON.stringify(result)}`);
});

// ---- checkYtdlpAvailable: never throws, reflects success/failure ----------

test('checkYtdlpAvailable resolves true on a clean --version success', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.checkYtdlpAvailable();
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from('2024.01.01'));
  child.emit('close', 0, null);
  assert.equal(await resultPromise, true);
});

test('checkYtdlpAvailable resolves false (never throws) when the binary is missing', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.checkYtdlpAvailable();
  const child = spawnChild();
  child.emit('error', Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }));
  assert.equal(await resultPromise, false);
});

// ---- SF2: non-zero timeout + killSignal are always armed (LIST path) -----

test('spawnYtdlp arms a NON-ZERO timeout that calls child.kill(killSignal) by default', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlp(['--dump-json'], { timeoutMs: 5 });
  const child = spawnChild();
  t.mock.timers.tick(5);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ETIMEDOUT');
  assert.deepEqual(child.killCalls, ['SIGKILL'], 'the default killSignal must be SIGKILL');
});

test('spawnYtdlp lets an explicit opts.timeoutMs/killSignal override the default (still non-zero)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlp(['--dump-json'], { timeoutMs: 1234, killSignal: 'SIGTERM' });
  const child = spawnChild();
  t.mock.timers.tick(1234);
  const result = await resultPromise;
  assert.equal(result.code, 'ETIMEDOUT');
  assert.deepEqual(child.killCalls, ['SIGTERM']);
});

test('runList arms the (non-zero) list timeout (DEFAULT_LIST_TIMEOUT_MS) by default', async () => {
  const spawnChild = stubSpawn();
  const originalSetTimeout = global.setTimeout;
  const capturedDelays = [];
  global.setTimeout = (fn, delay, ...rest) => {
    capturedDelays.push(delay);
    return originalSetTimeout(fn, delay, ...rest);
  };
  let result;
  try {
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
    const config = { downloadDir, cookiesFile: null };
    const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
    const resultPromise = run.runList(sub, config);
    const child = spawnChild();
    child.emit('close', 0, null);
    result = await resultPromise;
  } finally {
    global.setTimeout = originalSetTimeout;
  }
  assert.equal(result.ok, true);
  assert.ok(capturedDelays.length >= 1, 'runList must arm a timer');
  assert.ok(capturedDelays[0] > 0, 'the list timeout must be non-zero (0 is unbounded)');
  assert.equal(capturedDelays[0], run.DEFAULT_LIST_TIMEOUT_MS);
});

test('runDownload arms a NON-ZERO download timeout (DEFAULT_DOWNLOAD_TIMEOUT_MS) by default', async () => {
  const spawnChild = stubSpawn();
  const originalSetTimeout = global.setTimeout;
  const capturedDelays = [];
  global.setTimeout = (fn, delay, ...rest) => {
    capturedDelays.push(delay);
    return originalSetTimeout(fn, delay, ...rest);
  };
  let result;
  try {
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
    const config = { downloadDir, cookiesFile: null };
    const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
    const resultPromise = run.runDownload(sub, config, ['vid1']);
    const child = spawnChild();
    child.emit('close', 0, null);
    result = await resultPromise;
  } finally {
    global.setTimeout = originalSetTimeout;
  }
  assert.equal(result.ok, true);
  assert.equal(capturedSpawnCalls.length, 1);
  assert.ok(capturedDelays.length >= 1, 'runDownload must arm a timer');
  assert.ok(capturedDelays[0] > 0, 'the download timeout must be non-zero (0 is unbounded)');
  assert.equal(capturedDelays[0], run.DEFAULT_DOWNLOAD_TIMEOUT_MS);
});

test('spawnYtdlp: a simulated timeout resolves cleanly, never hangs, and never leaks the cookies path', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');

  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlp(['--dump-json', '--cookies', cookiesFile, '--', 'https://www.youtube.com/@x'], {
    cookiesPath: cookiesFile,
    timeoutMs: 10,
  });
  spawnChild();
  t.mock.timers.tick(10);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ETIMEDOUT');
  assert.ok(!JSON.stringify(result).includes(cookiesFile));
});

test('spawnYtdlpDownload: a real (short) timeout fires its own kill() and resolves cleanly with ETIMEDOUT, never hangs', async (t) => {
  // This test drives lib/ytdlp/run.js's `.unref()`'d download timeout. In
  // PRODUCTION that `.unref()` is correct and load-bearing (a real child
  // process keeps the event loop alive on its own, so the unref'd timer still
  // fires -- see the module comment in lib/ytdlp/run.js). But here the
  // `child` is a fake `EventEmitter` (stubSpawn's `makeFakeChild`), not a real
  // OS process/handle, so nothing else keeps the loop alive while awaiting
  // `resultPromise`: on Node 22 the loop can drain and exit BEFORE the unref'd
  // 5ms timer fires, hanging this test forever (it never hung on Node 24,
  // which happened to keep the loop alive long enough -- pure timing luck,
  // not a guarantee). Using node:test's fake timers makes the timeout fire
  // deterministically (via `.tick()`) regardless of what else is keeping the
  // loop alive, on every Node version -- while still genuinely exercising the
  // real timeout -> kill() -> 'close' -> ETIMEDOUT-resolve path end to end
  // (the fake child's `kill()` still schedules a real, un-mocked
  // `setImmediate` 'close' event, which IS enough on its own to keep the loop
  // alive for that one microtask).
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/@x'], { timeoutMs: 5, killSignal: 'SIGKILL' });
  const child = spawnChild();
  t.mock.timers.tick(5);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ETIMEDOUT');
  assert.deepEqual(child.killCalls, ['SIGKILL'], 'the timeout must actually call child.kill(), not just leave the child running');
});

// ---- v1.11.1 hotfix regression: the LIST path used to go through execFile --
// ---- + a fixed 10MB maxBuffer, which made Node SIGTERM the child (and the --
// ---- whole poll fail) the instant a channel's --dump-json output exceeded --
// ---- it -- this is the exact production bug (subscribing to a real, large --
// ---- channel failed with "stdout maxBuffer length exceeded"). It MUST     --
// ---- fail against the old execFile+maxBuffer code and pass now.          --

test('runList/spawnYtdlp resolves ok with ALL videos parsed when stdout is much larger than the old 10MB execFile maxBuffer, streamed across many chunks', async () => {
  const OLD_MAX_BUFFER = 10 * 1024 * 1024; // the old (now-removed) 10MB cap
  const VIDEO_COUNT = 3000;
  const lines = [];
  for (let i = 0; i < VIDEO_COUNT; i++) {
    // Pad each record so the TOTAL stdout comfortably exceeds the old cap
    // (VIDEO_COUNT * ~4KB padding is well over 10MB).
    lines.push(JSON.stringify({
      id: `vid${i}`,
      extractor_key: 'Youtube',
      availability: 'public',
      padding: 'x'.repeat(4000),
    }));
  }
  const fullNdjson = lines.join('\n') + '\n';
  assert.ok(Buffer.byteLength(fullNdjson) > OLD_MAX_BUFFER, 'sanity: the simulated stdout must exceed the old 10MB maxBuffer');

  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null, maxVideos: 0 };
  const sub = { channelUrl: 'https://www.youtube.com/@campingwithsteve', name: 'campingwithsteve', format: 'video', quality: 'best' };

  const spawnChild = stubSpawn();
  const resultPromise = run.runList(sub, config);
  const child = spawnChild();

  // Emit in many small-ish chunks (never a single write) to exercise the
  // streaming/partial-line-buffering path, not just a single large 'data'
  // event.
  const CHUNK_SIZE = 65536;
  for (let offset = 0; offset < fullNdjson.length; offset += CHUNK_SIZE) {
    child.stdout.emit('data', Buffer.from(fullNdjson.slice(offset, offset + CHUNK_SIZE)));
  }
  child.emit('close', 0, null);

  const result = await resultPromise;
  assert.equal(result.ok, true, 'a large listing must resolve ok, never an ETIMEDOUT/maxBuffer-style failure');
  assert.notEqual(result.code, 'ETIMEDOUT');

  const videos = rules.parseYtdlpVideoList(result.stdout);
  assert.equal(videos.length, VIDEO_COUNT, 'every video in the oversized listing must still be parsed');
});

// ---- REGRESSION: a multibyte UTF-8 character split across a stdout       --
// ---- chunk boundary must decode intact, never as U+FFFD. Pre-fix,        --
// ---- `spawnYtdlp`'s stdout handler decoded each raw Buffer chunk         --
// ---- INDEPENDENTLY (`stdoutChunks.push(chunk.toString())`), so a         --
// ---- multi-byte character (an emoji/CJK character in a real YouTube      --
// ---- title -- extremely common) split across two chunks decoded to       --
// ---- U+FFFD on BOTH sides, silently corrupting the title even though     --
// ---- `JSON.parse` still succeeds. This test emits the split as REAL,     --
// ---- pre-encoded Buffers sliced at a mid-character byte offset (not      --
// ---- strings) and MUST fail against the old per-chunk-toString() code.   --

test('spawnYtdlp: a multibyte UTF-8 character split across two stdout Buffer chunks decodes intact (no U+FFFD corruption)', async () => {
  const title = 'Amazing camping clip 🎬 finale';
  const json = JSON.stringify({ id: 'vid1', extractor_key: 'Youtube', availability: 'public', title });
  const fullBuffer = Buffer.from(`${json}\n`, 'utf8');

  // U+1F3AC (CLAPPER BOARD) is 4 bytes in UTF-8. Find its first byte and
  // split the buffer ONE byte past it, so chunk 1 ends with only the
  // LEADING byte of the character and chunk 2 carries the 3 continuation
  // bytes -- exactly the boundary a naive per-chunk `chunk.toString()`
  // would corrupt (each half decodes to U+FFFD independently).
  const emojiBytes = Buffer.from('🎬', 'utf8');
  const emojiByteIndex = fullBuffer.indexOf(emojiBytes);
  assert.ok(emojiByteIndex > 0, 'sanity: the emoji must be present in the encoded buffer');
  const splitOffset = emojiByteIndex + 1;

  const chunk1 = fullBuffer.subarray(0, splitOffset);
  const chunk2 = fullBuffer.subarray(splitOffset);
  assert.ok(chunk1.length > 0 && chunk2.length > 0, 'sanity: both chunks must be non-empty');

  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null, maxVideos: 0 };
  const sub = { channelUrl: 'https://www.youtube.com/@campingwithsteve', name: 'campingwithsteve', format: 'video', quality: 'best' };

  const spawnChild = stubSpawn();
  const resultPromise = run.runList(sub, config);
  const child = spawnChild();

  // Emit the split as two SEPARATE 'data' events -- real Buffers, never
  // strings -- so the stdout handler must buffer/join the raw bytes rather
  // than decode each event independently.
  child.stdout.emit('data', chunk1);
  child.stdout.emit('data', chunk2);
  child.emit('close', 0, null);

  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.ok(!result.stdout.includes('�'), `stdout was corrupted by the chunk-boundary split: ${result.stdout}`);

  const videos = rules.parseYtdlpVideoList(result.stdout);
  assert.equal(videos.length, 1);
  assert.equal(videos[0].title, title, 'the multibyte title must survive a chunk-boundary split intact');
});

// ---- SF7: an 'error' event on the piped stdout OR stderr stream must     --
// ---- settle the promise, not throw (an EventEmitter with zero 'error'    --
// ---- listeners throws synchronously, which would otherwise hang this     --
// ---- promise forever). The LIST path pipes BOTH streams (unlike the      --
// ---- download path, which ignores stdout), so both need the guard. Each  --
// ---- handler must also `child.kill()` the still-running child BEFORE     --
// ---- resolving -- otherwise, since `clear()` has already disarmed the    --
// ---- timeout timer, a stream-'error' while the child is alive would      --
// ---- orphan it with nothing left to reap it (a process leak).            --

test('spawnYtdlp: an "error" event on child.stdout settles the promise (never hangs, never throws) and kills the child', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlp(['--dump-json', '--', 'https://www.youtube.com/@x']);
  const child = spawnChild();
  assert.doesNotThrow(() => child.stdout.emit('error', new Error('stream boom')));
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ESTDOUT');
  assert.deepEqual(child.killCalls, ['SIGKILL'], 'a stdout stream error must kill the still-running child, not just settle the promise');
});

test('spawnYtdlp: an "error" event on child.stderr settles the promise (never hangs, never throws) and kills the child', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlp(['--dump-json', '--', 'https://www.youtube.com/@x']);
  const child = spawnChild();
  assert.doesNotThrow(() => child.stderr.emit('error', new Error('stream boom')));
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ESTDERR');
  assert.deepEqual(child.killCalls, ['SIGKILL'], 'a stderr stream error must kill the still-running child, not just settle the promise');
});

test('spawnYtdlpDownload: an "error" event on child.stderr settles the promise (never hangs, never throws) and kills the child', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/@x']);
  const child = spawnChild();
  assert.doesNotThrow(() => child.stderr.emit('error', new Error('stream boom')));
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ESTDERR');
  assert.deepEqual(child.killCalls, ['SIGKILL'], 'a stderr stream error must kill the still-running child, not just settle the promise');
});

test('runDownload: an "error" event on child.stderr settles the promise (never hangs, never throws) and kills the child', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  assert.doesNotThrow(() => child.stderr.emit('error', new Error('stream boom')));
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.deepEqual(child.killCalls, ['SIGKILL'], 'a stderr stream error must kill the still-running child, not just settle the promise');
});

test('spawnYtdlpDownload: a stderr stream "error" followed by a "close" does not double-resolve', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/@x']);
  const child = spawnChild();
  child.stderr.emit('error', new Error('stream boom'));
  // A 'close' arriving afterwards (e.g. the process still exits normally)
  // must be a no-op -- the `settled` guard must prevent a second resolve
  // (which, on a Promise, would simply be silently ignored, but proves the
  // guard itself is in place rather than relying on that Promise behavior).
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ESTDERR', 'the FIRST settle (the stderr error) must win, not the later close');
  assert.deepEqual(child.killCalls, ['SIGKILL'], 'the stderr error must have killed the child exactly once');
});

test('runDownload: a non-zero exit code resolves a structured, redacted failure (never throws)', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  child.emit('close', 1, null);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 1);
});

test('runDownload: a synchronous spawn ENOENT (binary missing) resolves cleanly, never throws', async () => {
  cp.spawn = () => {
    throw Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' });
  };
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const result = await run.runDownload(sub, config, ['vid1']);
  assert.equal(result.ok, false);
});

test('runDownload: an "error" event from the child (e.g. ENOENT after spawn) resolves cleanly, never hangs', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  child.emit('error', Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }));
  const result = await resultPromise;
  assert.equal(result.ok, false);
});

// ---- SF3: the DOWNLOAD path uses `spawn` (not `execFile`+maxBuffer) so a --
// ---- long progress stream on stderr can never SIGTERM the child ----------

test('runDownload uses child_process.spawn (arg-array, no shell), NOT execFile -- no maxBuffer risk on stderr', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'audio', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  child.emit('close', 0, null);
  await resultPromise;

  assert.equal(capturedSpawnCalls.length, 1);
  const { cmd, argv, opts } = capturedSpawnCalls[0];
  assert.equal(cmd, 'yt-dlp');
  assert.ok(Array.isArray(argv));
  assert.ok(argv.includes('-x'));
  assert.notEqual(opts && opts.shell, true);
  // No maxBuffer is passed to spawn (it doesn't accept one) -- confirming
  // there is nothing here that could ever SIGTERM the child over stderr size.
  assert.equal(opts && opts.maxBuffer, undefined);
});

test('runDownload survives a stderr progress stream far larger than the old 10MB execFile maxBuffer without failing', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  // Simulate a much-larger-than-10MB stream of progress lines on stderr --
  // this must never itself cause a failure (there is no buffer to overflow).
  const chunk = 'download progress line\n'.repeat(2000);
  for (let i = 0; i < 20; i++) {
    child.stderr.emit('data', Buffer.from(chunk));
  }
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true);
  // SF3's whole point: the returned stderr tail must stay BOUNDED regardless
  // of how much the process printed (40,000+ progress lines here) -- never
  // grow with the process's lifetime the way an unbounded accumulator would.
  assert.ok(
    Buffer.byteLength(result.stderr, 'utf8') <= run.STDERR_TAIL_LIMIT,
    `returned stderr tail (${Buffer.byteLength(result.stderr, 'utf8')} bytes) exceeded STDERR_TAIL_LIMIT (${run.STDERR_TAIL_LIMIT})`,
  );
});

// ---- runList: thin seam that builds args + spawns via cp.spawn -----------

test('runList builds list args and calls the spawn boundary', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runList(sub, config);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from('{}'));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true);
  const { cmd, argv, opts } = capturedSpawnCalls[0];
  assert.equal(cmd, 'yt-dlp');
  assert.equal(argv[argv.length - 1], 'https://www.youtube.com/@x');
  assert.notEqual(opts && opts.shell, true);
});
