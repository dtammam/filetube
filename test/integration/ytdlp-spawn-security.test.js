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
  // v1.31 P0 (H0 fix): the list budget is now pacing-aware --
  // resolveListTimeoutMs(sub, config), not the blind constant. With this
  // bare config (no maxVideos/sleepRequests set) it resolves to the default
  // base (5m) + DEFAULT_MAX_VIDEOS entries' worth of paced-request headroom,
  // and must always be >= the old constant (a listing can only ever get MORE
  // budget than pre-v1.31, never less).
  assert.equal(capturedDelays[0], run.resolveListTimeoutMs(
    { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' },
    { downloadDir: '/tmp', cookiesFile: null },
  ));
  assert.ok(capturedDelays[0] >= run.DEFAULT_LIST_TIMEOUT_MS, 'the pacing-aware budget never shrinks below the old constant');
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

// v1.15.1 hotfix: a config with an explicit (parsed) downloadTimeoutMinutes
// arms the timer at THAT duration, not the fallback default -- proving the
// config value actually threads all the way to the real spawn timeout, not
// just the pure `resolveDownloadTimeoutMs` helper in isolation.
test('runDownload arms the timeout from config.downloadTimeoutMinutes when present, overriding DEFAULT_DOWNLOAD_TIMEOUT_MS', async () => {
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
    const config = { downloadDir, cookiesFile: null, downloadTimeoutMinutes: 5 };
    const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
    const resultPromise = run.runDownload(sub, config, ['vid1']);
    const child = spawnChild();
    child.emit('close', 0, null);
    result = await resultPromise;
  } finally {
    global.setTimeout = originalSetTimeout;
  }
  assert.equal(result.ok, true);
  assert.ok(capturedDelays.length >= 1, 'runDownload must arm a timer');
  assert.equal(capturedDelays[0], 5 * 60 * 1000, 'the armed delay must reflect config.downloadTimeoutMinutes, not the fallback default');
  assert.notEqual(capturedDelays[0], run.DEFAULT_DOWNLOAD_TIMEOUT_MS);
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

// ---- v1.29.0 T1 (R0.1/R0.2/R0.8): the composed `error` field on a
// non-zero-exit close promotes the real stderr reason (via `pickStderrReason`)
// instead of the generic "yt-dlp exited with code <n>" string, with the
// generic string surviving ONLY as the fallback. -----------------------

test('runDownload: a non-zero exit with a real ERROR: line on stderr composes `error` from that reason, not the generic exit-code string', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  child.stderr.emit('data', Buffer.from('ERROR: [youtube] vid1: Video unavailable\n'));
  child.emit('close', 1, null);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.error, 'ERROR: [youtube] vid1: Video unavailable');
  assert.ok(!result.error.includes('yt-dlp exited with code'), 'the real reason must replace the generic string when one is available');
});

test('runDownload: a non-zero exit with EMPTY stderr falls back to the generic "yt-dlp exited with code <n>" string', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  child.emit('close', 7, null);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.error, 'yt-dlp exited with code 7');
});

test('runDownload: a non-zero exit with stderr that has content but no ERROR: line falls back to the last non-empty stderr line', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  child.stderr.emit('data', Buffer.from('WARNING: some non-fatal notice\nunexpected termination\n'));
  child.emit('close', 1, null);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unexpected termination');
});

test('runDownload: the composed real-reason `error` field is still cookies-redacted (SF1 unaffected)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'secret-cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  child.stderr.emit('data', Buffer.from(`ERROR: [youtube] vid1: Sign in. Cookies file: ${cookiesFile}\n`));
  child.emit('close', 1, null);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.ok(!result.error.includes(cookiesFile), `cookies path leaked into the composed real-reason error: ${result.error}`);
});

// ---- v1.29.0 T1 R0.8 (HARD INVARIANT, regression lock): run.js's resolved
// object for a SIGKILL/non-zero exit with non-empty stderr carries ONLY the
// promoted reason in `error` -- it never sets, implies, or has any opinion
// on a `status`/`cancelled` field. `lib/ytdlp/index.js`'s
// `cancelledSubscriptionIds`/`cancelledOneShotJobs` override
// (index.js:1393-1408) computes `status` from this `error` string but then
// OVERWRITES it to `'cancelled'` unconditionally whenever the subscription
// id is in its own latch Set -- a check made independently of what `error`
// says. This test locks that run.js's half of the contract (the resolved
// shape) can never regress into carrying a competing status opinion, which
// is what keeps that downstream override deterministic. (The downstream
// override itself is exercised end-to-end, WITHOUT touching index.js, by
// the existing test/integration/ytdlp-subscription-cancel.test.js and
// test/integration/ytdlp-oneshot-cancel.test.js suites, which mock a
// SIGKILL settle carrying a non-empty raw error string and assert the final
// state is still 'cancelled', never an error status.) --------------------

test('R0.8 lock: a SIGKILL exit with non-empty stderr resolves { ok:false, error:<real reason> } and NO status/cancelled field of its own', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  child.stderr.emit('data', Buffer.from('ERROR: [youtube] vid1: killed mid-download\n'));
  // A real SIGKILL close: code is null, signal carries the kill reason --
  // exactly how `child.kill('SIGKILL')` settles in production (see
  // spawnYtdlpDownload's own `resultCode` fallback to `signal`).
  child.emit('close', null, 'SIGKILL');
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.error, 'ERROR: [youtube] vid1: killed mid-download', 'the real reason must still be promoted on a SIGKILL exit');
  assert.equal('status' in result, false, 'run.js must never itself decide/carry a status/cancelled opinion -- that is exclusively index.js\'s downstream latch-Set override');
  assert.equal('cancelled' in result, false);
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

// ---- v1.25 QoL (T3): probeChannel -- the one-off pre-download channel ------
// probe. SAME arg-array/`--`/no-shell:true discipline as runList/spawnYtdlp
// above; NEVER throws/rejects regardless of spawn/parse failure.

test('probeChannel builds argv (--dump-json --no-download --no-warnings --no-playlist -- <url>), calls the spawn boundary as an arg-array, never shell:true, and resolves the parsed .channel', async () => {
  const spawnChild = stubSpawn();
  const watchUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const resultPromise = run.probeChannel(watchUrl, config);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ channel: 'Some Channel' })));
  child.emit('close', 0, null);
  const channel = await resultPromise;

  assert.equal(channel, 'Some Channel');
  assert.equal(capturedSpawnCalls.length, 1);
  const { cmd, argv, opts } = capturedSpawnCalls[0];
  assert.equal(cmd, 'yt-dlp');
  assert.ok(Array.isArray(argv), 'argv must be a flat array, never a shell string');
  assert.notEqual(opts && opts.shell, true, 'shell:true must never be set');
  assert.ok(argv.includes('--dump-json'));
  assert.ok(argv.includes('--no-download'));
  assert.ok(argv.includes('--no-warnings'));
  assert.ok(argv.includes('--no-playlist'));
  // `--` must immediately precede the single positional URL -- the same
  // option-injection guard every other builder in this codebase uses.
  const sepIdx = argv.indexOf('--');
  assert.ok(sepIdx >= 0, 'a bare "--" separator must be present');
  assert.equal(argv[sepIdx + 1], watchUrl);
  assert.equal(argv[argv.length - 1], watchUrl, 'the URL must be the LAST argv element (one opaque token, never parsed/split)');
});

// ---- FIX 2 (two-reviewer gate, post-v1.25.0): probeChannel gets its own,  --
// much shorter, DEDICATED timeout (PROBE_TIMEOUT_MS, 30s) -- NOT the 5-     --
// minute DEFAULT_LIST_TIMEOUT_MS a whole-channel listing pass uses. Asserted --
// the SAME way runList's/runDownload's own timeout-threading tests above    --
// prove theirs: capture the actual delay `setTimeout` is armed with.        --

test('probeChannel arms the dedicated PROBE_TIMEOUT_MS, never the 5-minute DEFAULT_LIST_TIMEOUT_MS', async () => {
  const spawnChild = stubSpawn();
  const originalSetTimeout = global.setTimeout;
  const capturedDelays = [];
  global.setTimeout = (fn, delay, ...rest) => {
    capturedDelays.push(delay);
    return originalSetTimeout(fn, delay, ...rest);
  };
  let result;
  try {
    const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
    const resultPromise = run.probeChannel('https://www.youtube.com/watch?v=dQw4w9WgXcQ', config);
    const child = spawnChild();
    child.stdout.emit('data', Buffer.from(JSON.stringify({ channel: 'Some Channel' })));
    child.emit('close', 0, null);
    result = await resultPromise;
  } finally {
    global.setTimeout = originalSetTimeout;
  }
  assert.equal(result, 'Some Channel');
  assert.ok(capturedDelays.length >= 1, 'probeChannel must arm a timer');
  assert.equal(capturedDelays[0], run.PROBE_TIMEOUT_MS, 'the armed delay must be the dedicated probe timeout');
  assert.equal(run.PROBE_TIMEOUT_MS, 30 * 1000, 'sanity: the dedicated probe timeout is 30 seconds');
  assert.notEqual(capturedDelays[0], run.DEFAULT_LIST_TIMEOUT_MS, 'a single-video probe must never use the 5-minute whole-channel list timeout');
});

test('probeChannel: a hung probe (never resolving) is actually killed by its OWN dedicated timeout, not left to run for the full 5-minute list timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawnChild = stubSpawn();
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const resultPromise = run.probeChannel('https://www.youtube.com/watch?v=dQw4w9WgXcQ', config);
  const child = spawnChild();
  // Advance exactly to PROBE_TIMEOUT_MS (30s) -- well short of the 5-minute
  // DEFAULT_LIST_TIMEOUT_MS -- and prove the child is killed and the probe
  // settles (to null, its documented "never throws" contract) right there.
  t.mock.timers.tick(run.PROBE_TIMEOUT_MS);
  const result = await resultPromise;
  assert.equal(result, null, 'a timed-out probe resolves null, never throws/rejects');
  assert.deepEqual(child.killCalls, ['SIGKILL'], 'the dedicated probe timeout must actually kill the hung child');
});

test('probeChannel falls back to .uploader when .channel is absent, then to .channel_id when both are absent', async () => {
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };

  let spawnChild = stubSpawn();
  let resultPromise = run.probeChannel('https://www.youtube.com/watch?v=aaaaaaaaaaa', config);
  let child = spawnChild();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ channel: null, uploader: 'Some Uploader' })));
  child.emit('close', 0, null);
  assert.equal(await resultPromise, 'Some Uploader');

  spawnChild = stubSpawn();
  resultPromise = run.probeChannel('https://www.youtube.com/watch?v=bbbbbbbbbbb', config);
  child = spawnChild();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ channel: '', uploader: null, channel_id: 'UCabc123' })));
  child.emit('close', 0, null);
  assert.equal(await resultPromise, 'UCabc123');
});

test('probeChannel resolves null (never throws) when the JSON carries none of channel/uploader/channel_id', async () => {
  const spawnChild = stubSpawn();
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const resultPromise = run.probeChannel('https://www.youtube.com/watch?v=ccccccccccc', config);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ id: 'ccccccccccc', title: 'Some title' })));
  child.emit('close', 0, null);
  assert.equal(await resultPromise, null);
});

test('probeChannel resolves null (never throws) when stdout is not valid JSON', async () => {
  const spawnChild = stubSpawn();
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const resultPromise = run.probeChannel('https://www.youtube.com/watch?v=ddddddddddd', config);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from('this is not json'));
  child.emit('close', 0, null);
  assert.equal(await resultPromise, null);
});

test('probeChannel resolves null (never throws) on a spawn failure (ENOENT / binary missing)', async () => {
  const spawnChild = stubSpawn();
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const resultPromise = run.probeChannel('https://www.youtube.com/watch?v=eeeeeeeeeee', config);
  const child = spawnChild();
  child.emit('error', Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }));
  assert.equal(await resultPromise, null);
});

test('probeChannel resolves null (never throws) on a non-zero exit code', async () => {
  const spawnChild = stubSpawn();
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const resultPromise = run.probeChannel('https://www.youtube.com/watch?v=fffffffffff', config);
  const child = spawnChild();
  child.emit('close', 1, null);
  assert.equal(await resultPromise, null);
});

test('probeChannel never throws even if spawn itself throws synchronously', async () => {
  cp.spawn = () => { throw new Error('boom'); };
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const result = await run.probeChannel('https://www.youtube.com/watch?v=ggggggggggg', config);
  assert.equal(result, null);
});

test('probeChannel resolves null immediately, without spawning, when watchUrl is missing/not a string', async () => {
  const spawnChild = stubSpawn();
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  assert.equal(await run.probeChannel(undefined, config), null);
  assert.equal(await run.probeChannel(null, config), null);
  assert.equal(await run.probeChannel('', config), null);
  assert.equal(capturedSpawnCalls.length, 0, 'an invalid watchUrl must never reach the spawn boundary');
  void spawnChild;
});

test('probeChannel includes --cookies (SAME discipline as runList) when a cookies file is configured and present on disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile };

  const spawnChild = stubSpawn();
  const resultPromise = run.probeChannel('https://www.youtube.com/watch?v=hhhhhhhhhhh', config);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ channel: 'Cookie Channel' })));
  child.emit('close', 0, null);
  await resultPromise;

  const { argv } = capturedSpawnCalls[0];
  const idx = argv.indexOf('--cookies');
  assert.ok(idx >= 0, '--cookies must be present when a usable cookies file is configured');
  assert.equal(argv[idx + 1], cookiesFile);
});

// ---- v1.25 QoL bugfix: probeChannelAvatar -- the REAL channel-avatar probe.
// SAME arg-array/`--`/no-shell:true/cookies/timeout discipline as probeChannel
// above; NEVER throws/rejects regardless of spawn/parse failure. The fixture
// below is the ACTUAL `thumbnails[]` array a live yt-dlp (2026.07.04)
// `--dump-single-json --playlist-items 0` returned for a real channel
// (`/channel/<id>` form) -- a mix of wide banner crops (ids "0"-"5"/
// "banner_uncropped") and the real avatar (a sized 900x900 square, id "7",
// plus the full-res "avatar_uncropped" fallback) -- never a hand-invented
// shape.
const REAL_CHANNEL_THUMBNAILS = [
  { url: 'https://yt3.googleusercontent.com/HHgKRdNH6SWlCqxQ2aT6io-yd1f4ambPHm3Ox39UC5sUjOeIanNWsSfNIzNBGBY6bZYqKo_Fag=w1060-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj', height: 175, width: 1060, preference: -10, id: '0', resolution: '1060x175' },
  { url: 'https://yt3.googleusercontent.com/HHgKRdNH6SWlCqxQ2aT6io-yd1f4ambPHm3Ox39UC5sUjOeIanNWsSfNIzNBGBY6bZYqKo_Fag=w1138-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj', height: 188, width: 1138, preference: -10, id: '1', resolution: '1138x188' },
  { url: 'https://yt3.googleusercontent.com/HHgKRdNH6SWlCqxQ2aT6io-yd1f4ambPHm3Ox39UC5sUjOeIanNWsSfNIzNBGBY6bZYqKo_Fag=w1707-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj', height: 283, width: 1707, preference: -10, id: '2', resolution: '1707x283' },
  { url: 'https://yt3.googleusercontent.com/HHgKRdNH6SWlCqxQ2aT6io-yd1f4ambPHm3Ox39UC5sUjOeIanNWsSfNIzNBGBY6bZYqKo_Fag=w2120-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj', height: 351, width: 2120, preference: -10, id: '3', resolution: '2120x351' },
  { url: 'https://yt3.googleusercontent.com/HHgKRdNH6SWlCqxQ2aT6io-yd1f4ambPHm3Ox39UC5sUjOeIanNWsSfNIzNBGBY6bZYqKo_Fag=w2276-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj', height: 377, width: 2276, preference: -10, id: '4', resolution: '2276x377' },
  { url: 'https://yt3.googleusercontent.com/HHgKRdNH6SWlCqxQ2aT6io-yd1f4ambPHm3Ox39UC5sUjOeIanNWsSfNIzNBGBY6bZYqKo_Fag=w2560-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj', height: 424, width: 2560, preference: -10, id: '5', resolution: '2560x424' },
  { url: 'https://yt3.googleusercontent.com/HHgKRdNH6SWlCqxQ2aT6io-yd1f4ambPHm3Ox39UC5sUjOeIanNWsSfNIzNBGBY6bZYqKo_Fag=s0', id: 'banner_uncropped', preference: -5 },
  { url: 'https://yt3.googleusercontent.com/ytc/AIdro_mtE0wtRYXirpEWGKtJ_mK85JBizT2WktAw6QBpDsz-OA=s900-c-k-c0x00ffffff-no-rj', height: 900, width: 900, id: '7', resolution: '900x900' },
  { url: 'https://yt3.googleusercontent.com/ytc/AIdro_mtE0wtRYXirpEWGKtJ_mK85JBizT2WktAw6QBpDsz-OA=s0', id: 'avatar_uncropped', preference: 1 },
];
const REAL_CHANNEL_AVATAR_URL = 'https://yt3.googleusercontent.com/ytc/AIdro_mtE0wtRYXirpEWGKtJ_mK85JBizT2WktAw6QBpDsz-OA=s900-c-k-c0x00ffffff-no-rj';

test('probeChannelAvatar builds argv (--dump-single-json --playlist-items 0 --no-warnings -- <url>), arg-array, never shell:true, and resolves {avatarUrl, channelId, channelUrl} from a REAL channel fixture', async () => {
  const spawnChild = stubSpawn();
  const channelUrl = 'https://www.youtube.com/channel/UCvQ4C0f9_OWRf1uyobwqOwA';
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const resultPromise = run.probeChannelAvatar(channelUrl, config);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from(JSON.stringify({
    thumbnails: REAL_CHANNEL_THUMBNAILS,
    channel_id: 'UCvQ4C0f9_OWRf1uyobwqOwA',
    channel_url: channelUrl,
  })));
  child.emit('close', 0, null);
  const result = await resultPromise;

  assert.equal(result.avatarUrl, REAL_CHANNEL_AVATAR_URL, 'must pick the largest SQUARE thumbnail, never a wide banner crop');
  assert.equal(result.channelId, 'UCvQ4C0f9_OWRf1uyobwqOwA', 'must extract+validate the channel_id from the same dump-single-json payload');
  assert.equal(result.channelUrl, channelUrl, 'must extract+re-validate/normalize channel_url via url.validateChannelUrl');
  assert.equal(capturedSpawnCalls.length, 1);
  const { cmd, argv, opts } = capturedSpawnCalls[0];
  assert.equal(cmd, 'yt-dlp');
  assert.ok(Array.isArray(argv), 'argv must be a flat array, never a shell string');
  assert.notEqual(opts && opts.shell, true, 'shell:true must never be set');
  assert.ok(argv.includes('--dump-single-json'));
  const piIdx = argv.indexOf('--playlist-items');
  assert.ok(piIdx >= 0, '--playlist-items must be present (never enumerates a single video)');
  assert.equal(argv[piIdx + 1], '0');
  assert.ok(argv.includes('--no-warnings'));
  const sepIdx = argv.indexOf('--');
  assert.ok(sepIdx >= 0, 'a bare "--" separator must be present');
  assert.equal(argv[sepIdx + 1], channelUrl);
  assert.equal(argv[argv.length - 1], channelUrl, 'the URL must be the LAST argv element (one opaque token, never parsed/split)');
});

test('probeChannelAvatar: an @handle channel URL fixture also resolves to its largest square avatar (verified against a real @handle channel too)', async () => {
  const spawnChild = stubSpawn();
  const channelUrl = 'https://www.youtube.com/@mentaloutlaw';
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const resultPromise = run.probeChannelAvatar(channelUrl, config);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from(JSON.stringify({
    thumbnails: [
      { url: 'https://yt3.googleusercontent.com/banner=w1060-fcrop64', height: 175, width: 1060, id: '0' },
      { url: 'https://yt3.googleusercontent.com/oNt0NdpBp_fCt58T2r2cpwhzRERNoCFRLKJUmNAB4r1kpPWJd4WX_GjHIj4mKn-rtISHTwkve4k=s0', id: 'banner_uncropped', preference: -5 },
      { url: 'https://yt3.googleusercontent.com/ytc/AIdro_n6dUcc6YbkWa540dbaWzbLi44bq0h-hGNEop2BhOQ6uHY=s900-c-k-c0x00ffffff-no-rj', height: 900, width: 900, id: '7', resolution: '900x900' },
      { url: 'https://yt3.googleusercontent.com/ytc/AIdro_n6dUcc6YbkWa540dbaWzbLi44bq0h-hGNEop2BhOQ6uHY=s0', id: 'avatar_uncropped', preference: 1 },
    ],
  })));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.avatarUrl, 'https://yt3.googleusercontent.com/ytc/AIdro_n6dUcc6YbkWa540dbaWzbLi44bq0h-hGNEop2BhOQ6uHY=s900-c-k-c0x00ffffff-no-rj');
  assert.equal(result.channelId, null, 'no channel_id in this fixture -- must be null, never throw/omit the field');
});

test('probeChannelAvatar falls back to the avatar_uncropped entry when no sized square thumbnail is present', async () => {
  const spawnChild = stubSpawn();
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const resultPromise = run.probeChannelAvatar('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', config);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from(JSON.stringify({
    thumbnails: [
      { url: 'https://yt3.googleusercontent.com/wide-banner', height: 175, width: 1060, id: '0' },
      { url: 'https://yt3.googleusercontent.com/uncropped-fallback=s0', id: 'avatar_uncropped', preference: 1 },
    ],
  })));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.avatarUrl, 'https://yt3.googleusercontent.com/uncropped-fallback=s0');
});

test('probeChannelAvatar resolves null (never throws) when thumbnails carries only banner crops (no square, no avatar_uncropped)', async () => {
  const spawnChild = stubSpawn();
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const resultPromise = run.probeChannelAvatar('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', config);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from(JSON.stringify({
    thumbnails: REAL_CHANNEL_THUMBNAILS.filter((t) => t.id !== '7' && t.id !== 'avatar_uncropped'),
  })));
  child.emit('close', 0, null);
  assert.equal(await resultPromise, null);
});

test('probeChannelAvatar resolves null (never throws) when thumbnails is absent/malformed/empty', async () => {
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };

  let spawnChild = stubSpawn();
  let resultPromise = run.probeChannelAvatar('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', config);
  let child = spawnChild();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ id: 'no-thumbnails-key' })));
  child.emit('close', 0, null);
  assert.equal(await resultPromise, null);

  spawnChild = stubSpawn();
  resultPromise = run.probeChannelAvatar('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', config);
  child = spawnChild();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ thumbnails: [] })));
  child.emit('close', 0, null);
  assert.equal(await resultPromise, null);

  spawnChild = stubSpawn();
  resultPromise = run.probeChannelAvatar('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', config);
  child = spawnChild();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ thumbnails: 'not-an-array' })));
  child.emit('close', 0, null);
  assert.equal(await resultPromise, null);
});

test('probeChannelAvatar rejects a hostile/non-https avatar url via sanitizeChannelAvatarUrl (defense-in-depth)', async () => {
  const spawnChild = stubSpawn();
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const resultPromise = run.probeChannelAvatar('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', config);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from(JSON.stringify({
    thumbnails: [{ url: 'javascript:alert(document.cookie)', height: 900, width: 900, id: '7' }],
  })));
  child.emit('close', 0, null);
  assert.equal(await resultPromise, null, 'a non-https/hostile scheme must never survive sanitizeChannelAvatarUrl');
});

test('probeChannelAvatar resolves null (never throws) when stdout is not valid JSON', async () => {
  const spawnChild = stubSpawn();
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const resultPromise = run.probeChannelAvatar('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', config);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from('this is not json'));
  child.emit('close', 0, null);
  assert.equal(await resultPromise, null);
});

test('probeChannelAvatar resolves null (never throws) on a spawn failure (ENOENT / binary missing)', async () => {
  const spawnChild = stubSpawn();
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const resultPromise = run.probeChannelAvatar('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', config);
  const child = spawnChild();
  child.emit('error', Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }));
  assert.equal(await resultPromise, null);
});

test('probeChannelAvatar resolves null (never throws) on a non-zero exit code', async () => {
  const spawnChild = stubSpawn();
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const resultPromise = run.probeChannelAvatar('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', config);
  const child = spawnChild();
  child.emit('close', 1, null);
  assert.equal(await resultPromise, null);
});

test('probeChannelAvatar never throws even if spawn itself throws synchronously', async () => {
  cp.spawn = () => { throw new Error('boom'); };
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  const result = await run.probeChannelAvatar('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', config);
  assert.equal(result, null);
});

test('probeChannelAvatar resolves null immediately, without spawning, when channelUrl is missing/not a string', async () => {
  const spawnChild = stubSpawn();
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
  assert.equal(await run.probeChannelAvatar(undefined, config), null);
  assert.equal(await run.probeChannelAvatar(null, config), null);
  assert.equal(await run.probeChannelAvatar('', config), null);
  assert.equal(capturedSpawnCalls.length, 0, 'an invalid channelUrl must never reach the spawn boundary');
  void spawnChild;
});

test('probeChannelAvatar uses the dedicated PROBE_TIMEOUT_MS (not DEFAULT_LIST_TIMEOUT_MS)', async () => {
  const spawnChild = stubSpawn();
  const originalSetTimeout = global.setTimeout;
  const capturedDelays = [];
  global.setTimeout = (fn, delay, ...rest) => {
    capturedDelays.push(delay);
    return originalSetTimeout(fn, delay, ...rest);
  };
  let result;
  try {
    const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile: null };
    const resultPromise = run.probeChannelAvatar('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', config);
    const child = spawnChild();
    child.stdout.emit('data', Buffer.from(JSON.stringify({ thumbnails: REAL_CHANNEL_THUMBNAILS })));
    child.emit('close', 0, null);
    result = await resultPromise;
  } finally {
    global.setTimeout = originalSetTimeout;
  }
  assert.equal(result.avatarUrl, REAL_CHANNEL_AVATAR_URL);
  assert.ok(capturedDelays.length >= 1, 'probeChannelAvatar must arm a timer');
  assert.equal(capturedDelays[0], run.PROBE_TIMEOUT_MS, 'the armed delay must be the dedicated probe timeout');
  assert.notEqual(capturedDelays[0], run.DEFAULT_LIST_TIMEOUT_MS, 'a channel-endpoint probe must never use the 5-minute whole-channel list timeout');
});

test('probeChannelAvatar includes --cookies (SAME discipline as probeChannel/runList) when a cookies file is configured and present on disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-avatar-cookies-'));
  const cookiesFile = path.join(dir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');
  const config = { downloadDir: '/tmp/irrelevant-for-this-test', cookiesFile };

  const spawnChild = stubSpawn();
  const resultPromise = run.probeChannelAvatar('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', config);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from(JSON.stringify({ thumbnails: REAL_CHANNEL_THUMBNAILS })));
  child.emit('close', 0, null);
  await resultPromise;

  const { argv } = capturedSpawnCalls[0];
  const idx = argv.indexOf('--cookies');
  assert.ok(idx >= 0, '--cookies must be present when a usable cookies file is configured');
  assert.equal(argv[idx + 1], cookiesFile);
});

// ---- T2/FR-E: onProgress threaded through the DOWNLOAD path ----------------
//
// yt-dlp writes `--newline` progress to STDOUT during a download (the
// download path previously ignored stdout entirely). These tests prove:
// onProgress fires with parsed patches, stdout is never accumulated (SF3),
// and every pre-existing SF1/SF3/SF7/SF2/settled-once invariant on this path
// still holds now that stdout is piped.

test('runDownload: --newline is present in the built download args (download-path only)', () => {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const builtArgs = buildYtdlpDownloadArgs(sub, config, ['vid1']);
  assert.ok(builtArgs.includes('--newline'));
});

test('runDownload: onProgress fires with parsed patches for progress lines emitted on stdout', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const patches = [];
  const resultPromise = run.runDownload(sub, config, ['vid1'], { onProgress: (p) => patches.push(p) });
  const child = spawnChild();

  child.stdout.emit('data', Buffer.from('[download] Destination: /downloads/x/Some_Title [dQw4w9WgXcQ].mp4\n'));
  child.stdout.emit('data', Buffer.from('[download]  47.2% of  120.5MiB at 3.20MiB/s ETA 00:25\n'));
  child.stdout.emit('data', Buffer.from('[download] 100% of  120.50MiB in 00:00:38 at 3.13MiB/s\n'));
  child.emit('close', 0, null);
  const result = await resultPromise;

  assert.equal(result.ok, true);
  assert.equal(patches.length, 3, `expected 3 parsed progress patches, got ${JSON.stringify(patches)}`);
  assert.equal(patches[0].title, 'Some Title');
  assert.equal(patches[1].percent, 47.2);
  assert.equal(patches[2].percent, 100);
});

test('runDownload: a non-progress line on stdout produces no onProgress call (parser returns null, not a garbage patch)', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const patches = [];
  const resultPromise = run.runDownload(sub, config, ['vid1'], { onProgress: (p) => patches.push(p) });
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from('[youtube] Extracting URL: https://www.youtube.com/watch?v=dQw4w9WgXcQ\n'));
  child.emit('close', 0, null);
  await resultPromise;
  assert.equal(patches.length, 0);
});

test('runDownload: progress lines split ACROSS multiple stdout data chunks (no trailing newline per chunk) are still parsed correctly', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const patches = [];
  const resultPromise = run.runDownload(sub, config, ['vid1'], { onProgress: (p) => patches.push(p) });
  const child = spawnChild();

  const line = '[download]  75.0% of  10.0MiB at 1.00MiB/s ETA 00:05\n';
  // Split the single line across three separate 'data' events, mid-line.
  child.stdout.emit('data', Buffer.from(line.slice(0, 10)));
  child.stdout.emit('data', Buffer.from(line.slice(10, 25)));
  child.stdout.emit('data', Buffer.from(line.slice(25)));
  child.emit('close', 0, null);
  await resultPromise;

  assert.equal(patches.length, 1, 'a line split across chunk boundaries must be parsed exactly once, not zero or twice');
  assert.equal(patches[0].percent, 75);
});

test('runDownload: a final progress line with NO trailing newline before the process closes is still parsed (flush on close)', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const patches = [];
  const resultPromise = run.runDownload(sub, config, ['vid1'], { onProgress: (p) => patches.push(p) });
  const child = spawnChild();
  // No trailing "\n" -- yt-dlp's very last write before exit commonly lacks one.
  child.stdout.emit('data', Buffer.from('[download] 100% of  10.0MiB in 00:00:05 at 2.00MiB/s'));
  child.emit('close', 0, null);
  await resultPromise;
  assert.equal(patches.length, 1);
  assert.equal(patches[0].percent, 100);
});

test('runDownload: stdout is PARSED-AND-DISCARDED -- result.stdout stays "" regardless of onProgress or stream volume', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1'], { onProgress: () => {} });
  const child = spawnChild();
  const chunk = '[download]  10.0% of  10.0MiB at 1.00MiB/s ETA 00:09\n'.repeat(5000);
  for (let i = 0; i < 5; i++) child.stdout.emit('data', Buffer.from(chunk));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(result.stdout, '', 'stdout must never be accumulated on the download path, onProgress or not');
});

test('runDownload: a THROWING onProgress callback never breaks the download promise -- it still resolves cleanly', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1'], {
    onProgress: () => { throw new Error('boom from a hostile/buggy onProgress'); },
  });
  const child = spawnChild();
  assert.doesNotThrow(() => {
    child.stdout.emit('data', Buffer.from('[download]  50.0% of  10.0MiB at 1.00MiB/s ETA 00:05\n'));
  });
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true, 'a throwing onProgress must never fail/hang the download itself');
});

test('runDownload: with NO onProgress, behavior is unchanged (backward-compatible) -- resolves ok, stdout empty, no crash from piped stdout', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']); // no 4th arg at all
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from('[download]  20.0% of  10.0MiB at 1.00MiB/s ETA 00:08\n'));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(result.stdout, '');
});

// ---- SF7 (download path, stdout side): the stdout stream is now piped on --
// ---- the download path too, so it needs the exact same 'error'-settles-  --
// ---- the-promise-and-kills-the-child guard the list path already has for --
// ---- BOTH its streams. ------------------------------------------------------

test('runDownload: an "error" event on child.stdout settles the promise (never hangs, never throws) and kills the child', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  assert.doesNotThrow(() => child.stdout.emit('error', new Error('stdout stream boom')));
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ESTDOUT');
  assert.deepEqual(child.killCalls, ['SIGKILL'], 'a stdout stream error must kill the still-running child, not just settle the promise');
});

test('runDownload: a stdout stream "error" followed by a "close" does not double-resolve (settled-once guard)', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  child.stdout.emit('error', new Error('stdout stream boom'));
  child.emit('close', 0, null); // must be a no-op: the stdout error already settled it
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ESTDOUT', 'the FIRST settle (the stdout error) must win, not the later close');
  assert.deepEqual(child.killCalls, ['SIGKILL'], 'the stdout error must have killed the child exactly once');
});

// ---- FIX-3 (two-reviewer gate): onProgress dispatch must stop once the ----
// ---- download promise has already settled -- a late/buffered 'data' -------
// ---- event must never resurrect a non-terminal patch that could overwrite -
// ---- the orchestrator's own terminal state transition (a phantom entry ----
// ---- stuck non-terminal forever). ------------------------------------------

test('runDownload: FIX-3 regression -- once settled via a stream "error", a LATE stdout "data" event does not dispatch onProgress', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const patches = [];
  const resultPromise = run.runDownload(sub, config, ['vid1'], { onProgress: (p) => patches.push(p) });
  const child = spawnChild();

  // Settle the promise via a stderr stream error BEFORE any progress line
  // has arrived (mirrors a real, if rare, underlying fd/read failure).
  child.stderr.emit('error', new Error('stderr stream boom'));
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ESTDERR');

  // A buffered/late stdout chunk arriving AFTER the promise already settled
  // must NOT resurrect onProgress with a non-terminal patch -- pre-fix, this
  // dispatch was unconditional and would have overwritten the orchestrator's
  // own terminal 'error' state with a stray 'downloading' patch.
  child.stdout.emit('data', Buffer.from('[download]  55.0% of  10.0MiB at 1.00MiB/s ETA 00:05\n'));
  assert.equal(patches.length, 0, 'onProgress must never fire once the download promise has already settled');
});

test('runDownload: FIX-3 regression -- once settled via a normal "close", a LATE stdout "data" event does not dispatch onProgress again', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const patches = [];
  const resultPromise = run.runDownload(sub, config, ['vid1'], { onProgress: (p) => patches.push(p) });
  const child = spawnChild();

  child.stdout.emit('data', Buffer.from('[download]  10.0% of  10.0MiB at 1.00MiB/s ETA 00:09\n'));
  child.emit('close', 0, null);
  await resultPromise;
  assert.equal(patches.length, 1, 'sanity: the in-flight progress line received BEFORE close must still be parsed');

  // A buffered stdout chunk that arrives AFTER 'close' already fired (and
  // resolved the promise) must not dispatch a fresh onProgress call -- this
  // is the exact "phantom stuck download" mechanism FIX-3 closes: a
  // never-terminal patch landing after the orchestrator already moved on.
  child.stdout.emit('data', Buffer.from('[download]  20.0% of  10.0MiB at 1.00MiB/s ETA 00:08\n'));
  assert.equal(patches.length, 1, 'a late stdout data event after close must not fire onProgress again');
});

test('runDownload: SF1 cookies redaction still holds with onProgress attached and stdout piped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };

  const spawnChild = stubSpawn();
  const resultPromise = run.runDownload(sub, config, ['vid1'], { onProgress: () => {} });
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from('[download]  10.0% of  10.0MiB at 1.00MiB/s ETA 00:09\n'));
  child.stderr.emit('data', Buffer.from(`ERROR: Cookies file: ${cookiesFile}\n`));
  child.emit('close', 1, null);
  const result = await resultPromise;

  assert.equal(result.ok, false);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(cookiesFile), `cookies path leaked into the returned result: ${serialized}`);
  const allLogs = capturedLogs.join('\n');
  assert.ok(!allLogs.includes(cookiesFile), `cookies path leaked into a log line: ${allLogs}`);
});

test('runDownload: SF3 bounded stderr tail still holds with onProgress attached and BOTH streams under heavy volume', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const patches = [];
  const resultPromise = run.runDownload(sub, config, ['vid1'], { onProgress: (p) => patches.push(p) });
  const child = spawnChild();
  const stdoutChunk = '[download]  10.0% of  10.0MiB at 1.00MiB/s ETA 00:09\n'.repeat(2000);
  const stderrChunk = 'some diagnostic warning line\n'.repeat(2000);
  for (let i = 0; i < 20; i++) {
    child.stdout.emit('data', Buffer.from(stdoutChunk));
    child.stderr.emit('data', Buffer.from(stderrChunk));
  }
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.ok(patches.length > 0, 'onProgress must still fire under heavy volume');
  assert.ok(
    Buffer.byteLength(result.stderr, 'utf8') <= run.STDERR_TAIL_LIMIT,
    `returned stderr tail (${Buffer.byteLength(result.stderr, 'utf8')} bytes) exceeded STDERR_TAIL_LIMIT (${run.STDERR_TAIL_LIMIT})`,
  );
  assert.equal(result.stdout, '', 'stdout must still never be accumulated');
});

test('runDownload: a multibyte UTF-8 character split across two stdout Buffer chunks in a Destination line still parses an intact title', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const patches = [];
  const resultPromise = run.runDownload(sub, config, ['vid1'], { onProgress: (p) => patches.push(p) });
  const child = spawnChild();

  const line = '[download] Destination: /downloads/x/Amazing camping clip 🎬 finale [dQw4w9WgXcQ].mp4\n';
  const fullBuffer = Buffer.from(line, 'utf8');
  const emojiBytes = Buffer.from('🎬', 'utf8');
  const emojiByteIndex = fullBuffer.indexOf(emojiBytes);
  assert.ok(emojiByteIndex > 0, 'sanity: emoji must be present in the encoded buffer');
  const splitOffset = emojiByteIndex + 1; // split mid-character
  const chunk1 = fullBuffer.subarray(0, splitOffset);
  const chunk2 = fullBuffer.subarray(splitOffset);

  child.stdout.emit('data', chunk1);
  child.stdout.emit('data', chunk2);
  child.emit('close', 0, null);
  await resultPromise;

  assert.equal(patches.length, 1);
  assert.ok(!patches[0].title.includes('�'), `title was corrupted by the chunk-boundary split: ${patches[0].title}`);
  assert.equal(patches[0].title, 'Amazing camping clip 🎬 finale');
});

test('runDownload: SF2 timeout+SIGKILL still fires with onProgress attached (progress plumbing does not interfere with the timeout path)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawnChild = stubSpawn();
  const patches = [];
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/@x'], {
    timeoutMs: 5,
    killSignal: 'SIGKILL',
    onProgress: (p) => patches.push(p),
  });
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from('[download]  1.0% of  10.0MiB at 1.00MiB/s ETA 00:59\n'));
  t.mock.timers.tick(5);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ETIMEDOUT');
  assert.deepEqual(child.killCalls, ['SIGKILL']);
  assert.ok(patches.length >= 1, 'progress parsed before the timeout must still have fired');
});

test('runDownload: never sets shell:true and stdio pipes stdout+stderr (arg-array, no shell) with onProgress attached', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1'], { onProgress: () => {} });
  const child = spawnChild();
  child.emit('close', 0, null);
  await resultPromise;
  const { cmd, argv, opts } = capturedSpawnCalls[0];
  assert.equal(cmd, 'yt-dlp');
  assert.ok(Array.isArray(argv));
  assert.deepEqual(opts.stdio, ['ignore', 'pipe', 'pipe']);
  assert.notEqual(opts && opts.shell, true);
  assert.equal(opts && opts.maxBuffer, undefined);
});

// ---- v1.20.0 FR-2: --print after_move:FTCHMETA capture, end-to-end against --
// ---- the REAL spawn boundary (two-reviewer gate: proves this remains a  ----
// ---- REAL download, never --simulate, and that the captured line is    ----
// ---- parsed/bounded/never forwarded to onProgress). ------------------------

test('runDownload: the built argv includes "--print" immediately followed by an "after_move:"-prefixed literal (never a bare --print, which would imply --simulate)', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  child.emit('close', 0, null);
  await resultPromise;
  const { argv } = capturedSpawnCalls[0];
  const idx = argv.indexOf('--print');
  assert.ok(idx >= 0, 'expected --print in the real spawned argv');
  assert.ok(argv[idx + 1].startsWith('after_move:'), 'the print WHEN-prefix must be after_move: -- a bare --print implies --simulate and would skip the download');
  assert.ok(!argv.includes('--simulate'), 'the download argv must never include --simulate');
});

// Small helper mirroring the real FTCHMETA line shape (post-fix JSON format,
// see CHANNEL_META_PRINT_TEMPLATE's doc comment in lib/ytdlp/args.js) so
// these tests read as "realistic yt-dlp stdout" rather than hand-rolled
// strings.
function ftchmetaLine(fields) {
  return `FTCHMETA ${JSON.stringify(fields)}\n`;
}

test('runDownload: a genuine download still completes ok:true (--print after_move: never turns the spawn into a --simulate no-op)', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  // Realistic sequence: a progress line, then the FTCHMETA print line
  // (after_move: fires AFTER the file has been moved to its final path),
  // then a clean exit.
  child.stdout.emit('data', Buffer.from('[download] 100% of  10.0MiB in 00:00:05 at 2.00MiB/s\n'));
  child.stdout.emit('data', Buffer.from(ftchmetaLine({
    id: 'vid1',
    channel_url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channel_id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    uploader_url: 'https://www.youtube.com/@x',
    channel: 'Some Channel',
  })));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true, 'the download must still complete successfully -- --print after_move: never blocks/skips it');
  assert.equal(result.code, 0);
});

test('runDownload: a captured FTCHMETA line is parsed onto result.channelMeta and is NEVER forwarded to onProgress', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const patches = [];
  const resultPromise = run.runDownload(sub, config, ['vid1'], { onProgress: (p) => patches.push(p) });
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from('[download]  50.0% of  10.0MiB at 1.00MiB/s ETA 00:05\n'));
  child.stdout.emit('data', Buffer.from(ftchmetaLine({
    id: 'vid1',
    channel_url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channel_id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    uploader_url: 'https://www.youtube.com/@x',
    channel: 'Some Channel',
  })));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(result.channelMeta.length, 1);
  assert.deepEqual(result.channelMeta[0], {
    videoId: 'vid1',
    title: null, // v1.33 T3: absent from this payload -> normalized null, like the dates
    channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    uploaderUrl: 'https://www.youtube.com/@x',
    channelName: 'Some Channel',
    uploadDate: null,
    releaseDate: null,
  });
  // The FTCHMETA line must never be misinterpreted as a progress patch --
  // only the one real progress line above produced an onProgress call.
  assert.equal(patches.length, 1);
  assert.equal(patches[0].percent, 50);
});

test('runDownload: result.stdout stays "" even with a captured FTCHMETA line present (SF3 unaffected)', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from(ftchmetaLine({
    id: 'vid1',
    channel_url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channel_id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    uploader_url: 'https://www.youtube.com/@x',
    channel: 'Some Channel',
  })));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.stdout, '');
});

test('runDownload: a malformed/hostile-shaped FTCHMETA line is captured RAW (unvalidated) on channelMeta -- validation is store.sanitizeCapturedChannelMeta\'s job, never run.js\'s', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from(ftchmetaLine({
    id: 'vid1',
    channel_url: 'https://evil.com/@x; rm -rf /',
    channel_id: null,
    uploader_url: null,
    channel: 'Hostile Channel',
  })));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.channelMeta.length, 1);
  assert.equal(result.channelMeta[0].channelUrl, 'https://evil.com/@x; rm -rf /', 'run.js itself does no validation -- the hostile string passes through raw, to be dropped downstream by store.sanitizeCapturedChannelMeta');
});

// ---- two-reviewer-gate fix (post-release): stdout-only capture parsing +  --
// ---- injection-proof (JSON-escaped) payload, defeating capture-line       --
// ---- forgery via an embedded newline in an attacker-controlled field. -----

test('SECURITY: runDownload NEVER captures an FTCHMETA-shaped line arriving on STDERR -- only stdout is a legitimate --print destination', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  // A perfectly well-formed FTCHMETA line, but on stderr -- e.g. what a
  // multi-line, attacker-controlled video description echoed to stderr
  // could otherwise be made to contain. This must be ignored entirely: no
  // capture, and it also must not be misread as a progress patch.
  child.stderr.emit('data', Buffer.from(ftchmetaLine({
    id: 'attacker-id',
    channel_url: 'https://www.youtube.com/@attacker',
    channel_id: null,
    uploader_url: null,
    channel: 'Attacker Channel',
  })));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(result.channelMeta.length, 0, 'an FTCHMETA line on stderr must never be captured');
});

test('SECURITY: a legitimate stdout FTCHMETA line is still captured normally even when an FTCHMETA-shaped line ALSO appears on stderr (stderr is inert)', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  child.stderr.emit('data', Buffer.from(ftchmetaLine({
    id: 'attacker-id',
    channel_url: 'https://www.youtube.com/@attacker',
    channel_id: null,
    uploader_url: null,
    channel: 'Attacker Channel',
  })));
  child.stdout.emit('data', Buffer.from(ftchmetaLine({
    id: 'vid1',
    channel_url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channel_id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    uploader_url: 'https://www.youtube.com/@x',
    channel: 'Real Channel',
  })));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.channelMeta.length, 1, 'only the genuine stdout capture is ever recorded');
  assert.equal(result.channelMeta[0].videoId, 'vid1');
  assert.equal(result.channelMeta[0].channelName, 'Real Channel');
});

test('SECURITY: a forged-newline channel NAME (JSON-escaped, as real yt-dlp output always is) cannot produce a second/rogue capture entry on stdout', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  const child = spawnChild();
  // A hostile channel display name that itself contains what LOOKS LIKE a
  // second FTCHMETA line -- but because the whole print output is a single
  // JSON object, the embedded "\nFTCHMETA ..." text is JSON-escaped (the
  // raw byte stream contains the two characters backslash-n, never an
  // actual newline byte), so it can never split into a second line.
  const forgedName = 'Innocent\nFTCHMETA ' + JSON.stringify({
    id: 'other-id',
    channel_url: 'https://youtube.com/@attacker',
    channel_id: null,
    uploader_url: null,
    channel: 'attacker',
  });
  const rawLine = ftchmetaLine({
    id: 'vid1',
    channel_url: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channel_id: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    uploader_url: 'https://www.youtube.com/@x',
    channel: forgedName,
  });
  // Sanity: the only raw newline byte in the emitted chunk is the trailing
  // line terminator `ftchmetaLine` itself appends -- the forged text inside
  // the JSON string contributes none.
  assert.equal(rawLine.indexOf('\n'), rawLine.length - 1, 'the forged newline must be JSON-escaped, not a raw byte, anywhere before the line terminator');
  child.stdout.emit('data', Buffer.from(rawLine));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.channelMeta.length, 1, 'the forged embedded text must never produce a SECOND capture entry');
  assert.equal(result.channelMeta[0].videoId, 'vid1', 'the real videoId from this one line, never the forged "other-id"');
  assert.equal(result.channelMeta[0].channelUrl, 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw');
  assert.equal(result.channelMeta[0].channelName, forgedName, 'the forged text survives only as an inert display-name string');
});

// ---- v1.24.0 A2 (T14): per-item failure attribution on the spawn boundary --
// (spawnYtdlpDownload's opts.knownIds -> bounded itemFailures[], SF1/SF3) ----

test('spawnYtdlpDownload: a per-video ERROR line on stderr matching opts.knownIds is captured onto result.itemFailures', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/watch?v=vid1'], {
    knownIds: new Set(['vid1']),
  });
  const child = spawnChild();
  child.stderr.emit('data', Buffer.from('ERROR: [youtube] vid1: Video unavailable\n'));
  child.emit('close', 1, null);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.deepEqual(result.itemFailures, [{ videoId: 'vid1', reason: 'Video unavailable' }]);
});

test('spawnYtdlpDownload: opts.knownIds also accepts a plain array (not just a Set)', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/watch?v=vid1'], {
    knownIds: ['vid1'],
  });
  const child = spawnChild();
  child.stderr.emit('data', Buffer.from('ERROR: [youtube] vid1: Video unavailable\n'));
  child.emit('close', 1, null);
  const result = await resultPromise;
  assert.deepEqual(result.itemFailures, [{ videoId: 'vid1', reason: 'Video unavailable' }]);
});

test('spawnYtdlpDownload: an ERROR line whose id is NOT in opts.knownIds is still captured, but as unattributed (videoId: null) -- never dropped, never misattributed', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/watch?v=vid1'], {
    knownIds: new Set(['vid1']),
  });
  const child = spawnChild();
  child.stderr.emit('data', Buffer.from('ERROR: [youtube] someUnknownId: Sign in to confirm your age\n'));
  child.emit('close', 1, null);
  const result = await resultPromise;
  assert.deepEqual(result.itemFailures, [{ videoId: null, reason: 'Sign in to confirm your age' }]);
});

test('spawnYtdlpDownload: omitting opts.knownIds entirely is backward-compatible -- itemFailures is always present (an empty array) when nothing failed', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/watch?v=vid1']);
  const child = spawnChild();
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.deepEqual(result.itemFailures, []);
});

test('SF1: a cookies path embedded in a captured item-failure reason is redacted, exactly like every other returned string on this path', async () => {
  const spawnChild = stubSpawn();
  const cookiesPath = '/secret/path/to/cookies.txt';
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/watch?v=vid1'], {
    knownIds: new Set(['vid1']),
    cookiesPath,
  });
  const child = spawnChild();
  child.stderr.emit('data', Buffer.from(`ERROR: [youtube] vid1: could not read cookies file ${cookiesPath}\n`));
  child.emit('close', 1, null);
  const result = await resultPromise;
  assert.equal(result.itemFailures.length, 1);
  assert.ok(!result.itemFailures[0].reason.includes(cookiesPath), `cookies path survived redaction in itemFailures: ${result.itemFailures[0].reason}`);
  assert.ok(result.itemFailures[0].reason.includes('<redacted>'));
});

// FIX-6 (two-reviewer gate, post-release, SF1 hardening): pre-fix,
// `parseItemFailureLine`'s own `sanitizeReason` capped the reason at
// MAX_REASON_LENGTH (500 chars) BEFORE `redactString` ever ran on it (the
// redaction happened afterward, in run.js, on the ALREADY-capped string). A
// cookies path straddling that 500-char boundary would therefore survive
// PARTIALLY: the cap truncated the reason mid-path, and `redactString`'s
// exact-substring `.split(cookiesPath).join(...)` can never match a
// TRUNCATED occurrence of `cookiesPath`, so the truncated fragment -- a real
// chunk of the actual filesystem path -- was returned as-is. This test
// constructs exactly that straddling scenario and asserts NO fragment of the
// cookies path (of any length) survives, proving redaction now runs on the
// full line before the cap.
test('FIX-6: redaction runs on the FULL stderr line BEFORE the reason length cap -- a cookies path straddling the cap boundary is never left partially un-redacted', async () => {
  const spawnChild = stubSpawn();
  const cookiesPath = '/secret/path/to/cookies-file-for-testing.txt';
  // Pad the reason so `cookiesPath` starts well before char 500 and ends
  // well after it -- a cap-then-redact ordering would slice straight through
  // the middle of the path.
  const prefix = 'x'.repeat(480);
  const reasonText = `${prefix} ${cookiesPath}`;
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/watch?v=vid1'], {
    knownIds: new Set(['vid1']),
    cookiesPath,
  });
  const child = spawnChild();
  child.stderr.emit('data', Buffer.from(`ERROR: [youtube] vid1: ${reasonText}\n`));
  child.emit('close', 1, null);
  const result = await resultPromise;
  assert.equal(result.itemFailures.length, 1);
  const reason = result.itemFailures[0].reason;
  assert.ok(!reason.includes(cookiesPath), `the full cookies path survived: ${reason}`);
  // No partial fragment (of any length >= 10 chars) of the real path leaked
  // either -- this is the specific gap a cap-BEFORE-redact ordering opened.
  for (let len = 10; len <= cookiesPath.length; len++) {
    assert.ok(!reason.includes(cookiesPath.slice(0, len)), `a ${len}-char prefix of the cookies path leaked into the reason: ${reason}`);
  }
  assert.ok(reason.includes('<redacted>'), 'the redaction marker must still be present');
});

test('SF3: itemFailures is bounded at MAX_CAPTURED_META, the SAME cap constant channelMeta already uses -- never an unbounded buffer', async () => {
  const spawnChild = stubSpawn();
  const overflowCount = run.MAX_CAPTURED_META + 50;
  const knownIds = new Set(Array.from({ length: overflowCount }, (_, i) => `vid${i}`));
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/@x'], { knownIds });
  const child = spawnChild();
  for (let i = 0; i < overflowCount; i++) {
    child.stderr.emit('data', Buffer.from(`ERROR: [youtube] vid${i}: unavailable\n`));
  }
  child.emit('close', 1, null);
  const result = await resultPromise;
  assert.equal(result.itemFailures.length, run.MAX_CAPTURED_META, 'itemFailures must never grow past MAX_CAPTURED_META, no matter how many ERROR lines arrive');
});

test('spawnYtdlpDownload: a final ERROR line with no trailing newline before close() is still captured via the close-time flush', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/watch?v=vid1'], {
    knownIds: new Set(['vid1']),
  });
  const child = spawnChild();
  // No trailing '\n' -- yt-dlp's very last stderr write commonly has none
  // before the process exits.
  child.stderr.emit('data', Buffer.from('ERROR: [youtube] vid1: Video unavailable'));
  child.emit('close', 1, null);
  const result = await resultPromise;
  assert.deepEqual(result.itemFailures, [{ videoId: 'vid1', reason: 'Video unavailable' }]);
});

test('runDownload: knownIds is derived automatically from targetIds -- no separate opts.knownIds needed by callers', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['survivor1', 'survivor2']);
  const child = spawnChild();
  child.stderr.emit('data', Buffer.from('ERROR: [youtube] survivor2: Video unavailable\n'));
  child.emit('close', 1, null);
  const result = await resultPromise;
  assert.deepEqual(result.itemFailures, [{ videoId: 'survivor2', reason: 'Video unavailable' }]);
});

test('spawnYtdlpDownload: a captured item failure is NEVER forwarded to onProgress, and vice versa a real progress line is never captured as a failure', async () => {
  const spawnChild = stubSpawn();
  const patches = [];
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/watch?v=vid1'], {
    knownIds: new Set(['vid1']),
    onProgress: (p) => patches.push(p),
  });
  const child = spawnChild();
  child.stdout.emit('data', Buffer.from('[download]  50.0% of  10.0MiB at 1.00MiB/s ETA 00:05\n'));
  child.stderr.emit('data', Buffer.from('ERROR: [youtube] vid1: Video unavailable\n'));
  child.emit('close', 1, null);
  const result = await resultPromise;
  assert.equal(result.itemFailures.length, 1);
  assert.equal(patches.length, 1, 'only the genuine progress line should have produced an onProgress patch');
  assert.equal(patches[0].percent, 50);
});

// ---- v1.24.0 A3: opts.onChild -- the opt-in child-handle registration hook -
// (lib/ytdlp/index.js's cancel route needs a live handle to kill; this is
// the ONLY place that hook is ever invoked). --------------------------------

test('spawnYtdlpDownload: opts.onChild is invoked SYNCHRONOUSLY, exactly once, with the live child, right after a successful spawn', async () => {
  const spawnChild = stubSpawn();
  const onChildCalls = [];
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/watch?v=vid1'], {
    onChild: (child) => onChildCalls.push(child),
  });
  const child = spawnChild();
  // Registration must have already happened by the time spawn() returns --
  // no need to wait a tick.
  assert.equal(onChildCalls.length, 1, 'onChild must be called exactly once, synchronously');
  assert.equal(onChildCalls[0], child, 'onChild must receive the actual spawned child, not a copy/wrapper');
  child.emit('close', 0, null);
  await resultPromise;
});

test('spawnYtdlpDownload: the child registered via opts.onChild can actually be killed, and the resulting SIGKILL settles the download as a normal failure', async () => {
  const spawnChild = stubSpawn();
  let registeredChild = null;
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/watch?v=vid1'], {
    onChild: (child) => { registeredChild = child; },
  });
  spawnChild(); // let the spawn (and therefore onChild) actually happen
  assert.ok(registeredChild, 'onChild must have registered the live child');

  // Simulate the cancel route: kill the registered handle directly (the
  // fake child's kill() -- see makeFakeChild above -- asynchronously emits
  // 'close' with the given signal, mirroring real OS behavior).
  registeredChild.kill('SIGKILL');
  const result = await resultPromise;
  assert.equal(result.ok, false, 'a killed child must never resolve as a success');
  assert.deepEqual(registeredChild.killCalls, ['SIGKILL']);
});

test('spawnYtdlpDownload: omitting opts.onChild entirely is backward-compatible -- no throw, resolves normally', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/watch?v=vid1']);
  const child = spawnChild();
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true);
});

test('spawnYtdlpDownload: a THROWING opts.onChild callback never breaks the download -- it is caught/logged, and the promise still resolves cleanly', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/watch?v=vid1'], {
    onChild: () => { throw new Error('boom from a hostile/buggy onChild'); },
  });
  const child = spawnChild();
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true, 'a throwing onChild must never prevent the download from completing normally');
  assert.ok(capturedLogs.some((line) => line.includes('onChild callback threw')), 'the throw must be logged, not silently swallowed');
});

test('spawnYtdlpDownload: opts.onChild is never invoked when spawn itself throws synchronously (no live child to register)', async () => {
  cp.spawn = () => { throw new Error('boom'); };
  const onChildCalls = [];
  const result = await run.spawnYtdlpDownload(['--', 'https://www.youtube.com/watch?v=vid1'], {
    onChild: (child) => onChildCalls.push(child),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(onChildCalls, [], 'onChild must never fire for a spawn that never actually started');
});

test('runDownload: opts.onChild is forwarded straight through to spawnYtdlpDownload unchanged', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  let registeredChild = null;
  const resultPromise = run.runDownload(sub, config, ['vid1'], { onChild: (child) => { registeredChild = child; } });
  const child = spawnChild();
  assert.equal(registeredChild, child, 'runDownload must forward opts.onChild to spawnYtdlpDownload verbatim');
  child.emit('close', 0, null);
  await resultPromise;
});

// ---- v1.31 P0/P3: phase-named timeout reasons, list-budget scaling, stall --
// ---- watchdog (see docs/exec-plans .../2026-07-12-v1.31-ytdlp-hardening.md) -

test('v1.31 P0: a list-pass timeout reason names the phase and the ACTUAL budget applied (AC2.x)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlp(['--dump-json'], { timeoutMs: 90 * 1000, phaseLabel: 'list pass' });
  spawnChild();
  t.mock.timers.tick(90 * 1000);
  const result = await resultPromise;
  assert.equal(result.code, 'ETIMEDOUT');
  assert.equal(result.error, 'yt-dlp list pass timed out after 1.5m and was killed');
});

test('v1.31 P0: a caller that passes no phaseLabel still gets a phase-named (list pass) reason -- the bare "timed out and was killed" string no longer exists (AC2.x)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlp(['--dump-json'], { timeoutMs: 60 * 1000 });
  spawnChild();
  t.mock.timers.tick(60 * 1000);
  const result = await resultPromise;
  assert.notEqual(result.error, 'yt-dlp timed out and was killed');
  assert.equal(result.error, 'yt-dlp list pass timed out after 1m and was killed');
});

test('v1.31 P0: a download ceiling kill names the phase, the budget, and that it was the ABSOLUTE ceiling (AC2.x)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['-f', 'best'], { timeoutMs: 30 * 60 * 1000 });
  spawnChild();
  t.mock.timers.tick(30 * 60 * 1000);
  const result = await resultPromise;
  assert.equal(result.code, 'ETIMEDOUT');
  assert.equal(result.error, 'yt-dlp download timed out after 30m (absolute ceiling) and was killed');
});

test('v1.31 P0 (H0): resolveListTimeoutMs scales the list budget with maxVideos x sleepRequests and never shrinks below the configured base', () => {
  // Defaults: base 5m + DEFAULT_MAX_VIDEOS(2) * 3 req/entry * 1s = 5m + 6s.
  const sub = { channelUrl: 'https://www.youtube.com/@x' };
  assert.equal(run.resolveListTimeoutMs(sub, {}), 5 * 60 * 1000 + 2 * 3 * 1000);
  // A subscription's own maxVideos drives the scaling (25 entries, 2s sleeps).
  assert.equal(
    run.resolveListTimeoutMs({ ...sub, maxVideos: 25 }, { sleepRequests: 2 }),
    5 * 60 * 1000 + 25 * 3 * 2 * 1000,
  );
  // maxVideos: 0 ("unlimited") scales as the documented stand-in (100).
  assert.equal(
    run.resolveListTimeoutMs({ ...sub, maxVideos: 0 }, { sleepRequests: 1 }),
    5 * 60 * 1000 + 100 * 3 * 1000,
  );
  // The whole budget is capped at 60 minutes no matter how hostile the config.
  assert.equal(
    run.resolveListTimeoutMs({ ...sub, maxVideos: 10000 }, { sleepRequests: 60, listTimeoutMinutes: 60 }),
    60 * 60 * 1000,
  );
  // A bare/garbage config falls back to defaults, never throws.
  assert.doesNotThrow(() => run.resolveListTimeoutMs(null, null));
  assert.ok(run.resolveListTimeoutMs(null, null) >= 5 * 60 * 1000);
});

test('v1.31 P3: the stall watchdog kills a download that produces NO output for the idle window, with a specific phase-named reason (AC4.x)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['-f', 'best'], {
    timeoutMs: 180 * 60 * 1000, // the ceiling is far away -- the stall must fire first
    stallMs: 10 * 60 * 1000,
  });
  const child = spawnChild();
  t.mock.timers.tick(10 * 60 * 1000);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ESTALLED');
  assert.equal(result.error, 'yt-dlp download stalled -- no output for 10m and was killed');
  assert.deepEqual(child.killCalls, ['SIGKILL']);
});

test('v1.31 P3: output on EITHER stream re-arms the stall window -- a slow-but-alive download is never stall-killed (AC4.x converse)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['-f', 'best'], {
    timeoutMs: 0, // no ceiling in this test -- isolate the stall behavior
    stallMs: 10 * 60 * 1000,
  });
  const child = spawnChild();
  // Three re-arms at 9-minute intervals: each within the 10m window, so the
  // watchdog must never fire even though total elapsed (27m) is far past it.
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(9 * 60 * 1000);
    const stream = i % 2 === 0 ? child.stdout : child.stderr; // both streams prove liveness
    stream.emit('data', Buffer.from('[download]   1.0% of ~100MiB\n'));
  }
  t.mock.timers.tick(9 * 60 * 1000);
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true, `a live download must never be stall-killed (got: ${result.error})`);
  assert.deepEqual(child.killCalls, []);
});

test('v1.31 P3: stallMs 0/absent disables the watchdog entirely (pre-v1.31 ceiling-only behavior)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['-f', 'best'], { timeoutMs: 0, stallMs: 0 });
  const child = spawnChild();
  // A full hour of silence: with the watchdog off, nothing may kill it.
  t.mock.timers.tick(60 * 60 * 1000);
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.deepEqual(child.killCalls, []);
});

test('v1.31 P3: runDownload threads config.stallMinutes into the spawn as stallMs (config boundary)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null, stallMinutes: 1, downloadTimeoutMinutes: 180 };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config, ['vid1']);
  spawnChild();
  t.mock.timers.tick(60 * 1000); // one configured stall-minute of silence
  const result = await resultPromise;
  assert.equal(result.code, 'ESTALLED');
  assert.equal(result.error, 'yt-dlp download stalled -- no output for 1m and was killed');
});

test('v1.31 P6: getYtdlpVersion returns the trimmed CalVer string on success, null on failure/garbage', async () => {
  const spawnChild = stubSpawn();
  const p1 = run.getYtdlpVersion();
  const c1 = spawnChild();
  c1.stdout.emit('data', Buffer.from('2026.07.04\n'));
  c1.emit('close', 0, null);
  assert.equal(await p1, '2026.07.04');

  const p2 = run.getYtdlpVersion();
  const c2 = spawnChild();
  c2.emit('error', Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }));
  assert.equal(await p2, null);

  const p3 = run.getYtdlpVersion();
  const c3 = spawnChild();
  c3.stdout.emit('data', Buffer.from('<html>not a version</html>'));
  c3.emit('close', 0, null);
  assert.equal(await p3, null, 'version-unlike output must never pass through to the UI');
});
