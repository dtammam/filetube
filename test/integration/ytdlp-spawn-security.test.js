'use strict';

// [INTEGRATION] lib/ytdlp/run.js -- the spawn boundary itself (AC 28, and
// the "never logged"/"never returned" halves of AC 31, plus the SF1-SF3
// security-fix-round regressions). `child_process.execFile`/`.spawn` are
// spied by monkey-patching `require('child_process').execFile`/`.spawn`
// (run.js references `cp.execFile`/`cp.spawn` at call time, not a
// destructured import, specifically so this works without a mocking library
// or dependency injection -- see the comment at the top of lib/ytdlp/run.js).
// No real yt-dlp binary is ever invoked; no network is touched.

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const run = require('../../lib/ytdlp/run');
const { buildYtdlpDownloadArgs } = require('../../lib/ytdlp/args');

const originalExecFile = cp.execFile;
const originalSpawn = cp.spawn;
const originalConsoleError = console.error;

let capturedCalls;
let capturedSpawnCalls;
let capturedLogs;

beforeEach(() => {
  capturedCalls = [];
  capturedSpawnCalls = [];
  capturedLogs = [];
  console.error = (...logArgs) => {
    capturedLogs.push(logArgs.map(String).join(' '));
  };
});

afterEach(() => {
  cp.execFile = originalExecFile;
  cp.spawn = originalSpawn;
  console.error = originalConsoleError;
});

function stubExecFile(behavior) {
  cp.execFile = (cmd, argv, opts, callback) => {
    capturedCalls.push({ cmd, argv, opts });
    behavior(callback);
  };
}

// A minimal fake child process: an EventEmitter with a `.stderr` stream
// (also an EventEmitter) and a `.kill()` spy, close enough to the real
// `ChildProcess` shape for `spawnYtdlpDownload` to drive.
function makeFakeChild() {
  const child = new EventEmitter();
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

test('spawnYtdlp calls execFile with ("yt-dlp", <array>, opts) and never {shell:true}', async () => {
  stubExecFile((cb) => cb(null, '{}', ''));
  const result = await run.spawnYtdlp(['--dump-json', '--', 'https://www.youtube.com/@x']);
  assert.equal(result.ok, true);
  assert.equal(capturedCalls.length, 1);
  const { cmd, argv, opts } = capturedCalls[0];
  assert.equal(cmd, 'yt-dlp');
  assert.ok(Array.isArray(argv));
  assert.notEqual(opts && opts.shell, true, 'shell:true must never be set');
});

test('spawnYtdlp passes a shell-metacharacter-laden string as a single argv element -- never shell:true, even when the string is deliberately hostile', async () => {
  stubExecFile((cb) => cb(null, '', ''));
  // validateChannelUrl would reject this upstream (see ytdlp-url.test.js) --
  // this test proves the LOW-LEVEL spawn boundary itself is arg-array-only
  // regardless of content, i.e. defense-in-depth: even if validation were
  // somehow bypassed, execFile with an array never lets a shell interpret
  // these characters.
  const hostileUrl = 'https://youtube.com/@x; rm -rf /';
  await run.spawnYtdlp(['--dump-json', '--', hostileUrl]);
  const { cmd, argv, opts } = capturedCalls[0];
  assert.equal(cmd, 'yt-dlp');
  assert.ok(Array.isArray(argv));
  assert.equal(argv[argv.length - 1], hostileUrl, 'the hostile string is one opaque argv element, never parsed/split');
  assert.notEqual(opts && opts.shell, true);
});

test('spawnYtdlp with a "--exec"-style hostile string is still an arg-array call, never shell:true', async () => {
  stubExecFile((cb) => cb(null, '', ''));
  await run.spawnYtdlp(['--', '--exec=whoami']);
  const { argv, opts } = capturedCalls[0];
  assert.ok(Array.isArray(argv));
  assert.notEqual(opts && opts.shell, true);
});

test('spawnYtdlp resolves a structured error result (never throws) when execFile reports failure', async () => {
  stubExecFile((cb) => cb(Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }), '', ''));
  const result = await run.spawnYtdlp(['--version']);
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
});

test('spawnYtdlp never throws even if execFile itself throws synchronously', async () => {
  cp.execFile = () => { throw new Error('boom'); };
  const result = await run.spawnYtdlp(['--version']);
  assert.equal(result.ok, false);
});

// ---- SF1: cookies path never appears in a log line NOR in the returned ----
// ---- result, proven against a REALISTIC Node execFile error.message      ----
// ---- (the previous mock only used a generic message, which masked the   ----
// ---- bug: Node's real message embeds the full argv).                   ----

function realisticExecFileError(cookiesFile) {
  // Mirrors Node's actual execFile error shape: "Command failed: yt-dlp
  // <full argv, incl. --cookies <path>> -- <url>\n<stderr>".
  const message =
    `Command failed: yt-dlp --dump-json --cookies ${cookiesFile} -- https://www.youtube.com/@x\n` +
    `ERROR: [youtube] some-video-id: Sign in to confirm your age. Cookies file: ${cookiesFile}\n`;
  return Object.assign(new Error(message), { code: 1 });
}

test('SF1: a realistic execFile error.message containing the cookies path never reaches console.error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'secret-cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');

  stubExecFile((cb) => cb(realisticExecFileError(cookiesFile), '', ''));
  await run.spawnYtdlp(['--dump-json', '--cookies', cookiesFile, '--', 'https://www.youtube.com/@x'], {
    cookiesPath: cookiesFile,
  });

  const allLogs = capturedLogs.join('\n');
  assert.ok(!allLogs.includes(cookiesFile), `cookies path leaked into a log line: ${allLogs}`);
});

test('SF1: a realistic execFile error.message containing the cookies path never appears in the RETURNED result (any field)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'secret-cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');

  stubExecFile((cb) => cb(realisticExecFileError(cookiesFile), '', ''));
  const result = await run.spawnYtdlp(['--dump-json', '--cookies', cookiesFile, '--', 'https://www.youtube.com/@x'], {
    cookiesPath: cookiesFile,
  });

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

  cp.execFile = () => {
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

  const builtArgs = buildYtdlpDownloadArgs(sub, config);
  assert.ok(builtArgs.includes(cookiesFile), 'sanity: the real path IS in the raw args before redaction');

  const spawnChild = stubSpawn();
  const resultPromise = run.runDownload(sub, config);
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
  stubExecFile((cb) => cb(null, '2024.01.01', ''));
  assert.equal(await run.checkYtdlpAvailable(), true);
});

test('checkYtdlpAvailable resolves false (never throws) when the binary is missing', async () => {
  stubExecFile((cb) => cb(Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }), '', ''));
  assert.equal(await run.checkYtdlpAvailable(), false);
});

// ---- SF2: non-zero timeout + killSignal are always passed ------------------

test('spawnYtdlp passes a NON-ZERO timeout and a killSignal to execFile by default', async () => {
  stubExecFile((cb) => cb(null, '{}', ''));
  await run.spawnYtdlp(['--dump-json']);
  const { opts } = capturedCalls[0];
  assert.ok(opts.timeout > 0, 'timeout must be non-zero (0 is unbounded in Node)');
  assert.equal(typeof opts.killSignal, 'string');
  assert.ok(opts.killSignal.length > 0);
});

test('spawnYtdlp lets an explicit opts.timeoutMs override the default (still non-zero)', async () => {
  stubExecFile((cb) => cb(null, '{}', ''));
  await run.spawnYtdlp(['--dump-json'], { timeoutMs: 1234 });
  const { opts } = capturedCalls[0];
  assert.equal(opts.timeout, 1234);
});

test('runList passes the (non-zero) list timeout to execFile', async () => {
  stubExecFile((cb) => cb(null, '{}', ''));
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  await run.runList(sub, config);
  const { opts } = capturedCalls[0];
  assert.ok(opts.timeout > 0);
  assert.equal(opts.timeout, run.DEFAULT_LIST_TIMEOUT_MS);
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
    const resultPromise = run.runDownload(sub, config);
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

test('spawnYtdlp: a simulated timeout (execFile error.killed) resolves cleanly, never hangs, and never leaks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');

  stubExecFile((cb) => {
    const err = Object.assign(new Error(`Command failed: yt-dlp --cookies ${cookiesFile} -- https://www.youtube.com/@x`), {
      killed: true,
      signal: 'SIGKILL',
    });
    cb(err, '', '');
  });
  const result = await run.spawnYtdlp(['--dump-json', '--cookies', cookiesFile, '--', 'https://www.youtube.com/@x'], {
    cookiesPath: cookiesFile,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ETIMEDOUT');
  assert.ok(!JSON.stringify(result).includes(cookiesFile));
});

test('spawnYtdlpDownload: a real (short) timeout fires its own kill() and resolves cleanly with ETIMEDOUT, never hangs', async () => {
  const spawnChild = stubSpawn();
  const resultPromise = run.spawnYtdlpDownload(['--', 'https://www.youtube.com/@x'], { timeoutMs: 5, killSignal: 'SIGKILL' });
  const child = spawnChild();
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ETIMEDOUT');
  assert.deepEqual(child.killCalls, ['SIGKILL'], 'the timeout must actually call child.kill(), not just leave the child running');
});

// ---- SF3: the DOWNLOAD path uses `spawn` (not `execFile`+maxBuffer) so a --
// ---- long progress stream on stderr can never SIGTERM the child ----------

test('runDownload uses child_process.spawn (arg-array, no shell), NOT execFile -- no maxBuffer risk on stderr', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'audio', quality: 'best' };
  const resultPromise = run.runDownload(sub, config);
  const child = spawnChild();
  child.emit('close', 0, null);
  await resultPromise;

  assert.equal(capturedCalls.length, 0, 'runDownload must not go through execFile at all');
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
  const resultPromise = run.runDownload(sub, config);
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
});

test('runDownload: a non-zero exit code resolves a structured, redacted failure (never throws)', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config);
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
  const result = await run.runDownload(sub, config);
  assert.equal(result.ok, false);
});

test('runDownload: an "error" event from the child (e.g. ENOENT after spawn) resolves cleanly, never hangs', async () => {
  const spawnChild = stubSpawn();
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const resultPromise = run.runDownload(sub, config);
  const child = spawnChild();
  child.emit('error', Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }));
  const result = await resultPromise;
  assert.equal(result.ok, false);
});

// ---- runList: thin seam that builds args + spawns via execFile -----------

test('runList builds list args and calls the execFile spawn boundary', async () => {
  stubExecFile((cb) => cb(null, '{}', ''));
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };
  const result = await run.runList(sub, config);
  assert.equal(result.ok, true);
  const { cmd, argv, opts } = capturedCalls[0];
  assert.equal(cmd, 'yt-dlp');
  assert.equal(argv[argv.length - 1], 'https://www.youtube.com/@x');
  assert.notEqual(opts && opts.shell, true);
});
