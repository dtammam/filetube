'use strict';

// [INTEGRATION] lib/ytdlp/run.js -- the spawn boundary itself (AC 28, and
// the "never logged" half of AC 31). `child_process.execFile` is spied by
// monkey-patching `require('child_process').execFile` (run.js references
// `cp.execFile` at call time, not a destructured import, specifically so
// this works without a mocking library or dependency injection -- see the
// comment at the top of lib/ytdlp/run.js). No real yt-dlp binary is ever
// invoked; no network is touched.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const run = require('../../lib/ytdlp/run');
const { buildYtdlpDownloadArgs } = require('../../lib/ytdlp/args');

const originalExecFile = cp.execFile;
const originalConsoleError = console.error;

let capturedCalls;
let capturedLogs;

beforeEach(() => {
  capturedCalls = [];
  capturedLogs = [];
  console.error = (...logArgs) => {
    capturedLogs.push(logArgs.map(String).join(' '));
  };
});

afterEach(() => {
  cp.execFile = originalExecFile;
  console.error = originalConsoleError;
});

function stubExecFile(behavior) {
  cp.execFile = (cmd, argv, opts, callback) => {
    capturedCalls.push({ cmd, argv, opts });
    behavior(callback);
  };
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

// ---- AC 31: cookies path never appears in any logged line ----------------

test('a failed invocation with --cookies in the args never logs the real cookies path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'super-secret-cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');

  stubExecFile((cb) => cb(new Error('non-zero exit'), '', ''));
  await run.spawnYtdlp(['--dump-json', '--cookies', cookiesFile, '--', 'https://www.youtube.com/@x']);

  const allLogs = capturedLogs.join('\n');
  assert.ok(!allLogs.includes(cookiesFile), `cookies path leaked into a log line: ${allLogs}`);
  assert.ok(!allLogs.includes('super-secret-cookies.txt'));
});

test('buildYtdlpDownloadArgs + a failed run: the real cookies path from config never reaches a log line', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(dir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'video', quality: 'best' };

  const builtArgs = buildYtdlpDownloadArgs(sub, config);
  assert.ok(builtArgs.includes(cookiesFile), 'sanity: the real path IS in the raw args before redaction');

  stubExecFile((cb) => cb(new Error('non-zero exit'), '', ''));
  await run.spawnYtdlp(builtArgs);

  const allLogs = capturedLogs.join('\n');
  assert.ok(!allLogs.includes(cookiesFile), `cookies path leaked into a log line: ${allLogs}`);
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

// ---- runList / runDownload: thin seams that build args + spawn -----------

test('runList builds list args and calls the same execFile spawn boundary', async () => {
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

test('runDownload builds download args and calls the same execFile spawn boundary', async () => {
  stubExecFile((cb) => cb(null, '', ''));
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-dl-'));
  const config = { downloadDir, cookiesFile: null };
  const sub = { channelUrl: 'https://www.youtube.com/@x', name: 'x', format: 'audio', quality: 'best' };
  const result = await run.runDownload(sub, config);
  assert.equal(result.ok, true);
  const { argv, opts } = capturedCalls[0];
  assert.ok(argv.includes('-x'));
  assert.notEqual(opts && opts.shell, true);
});
