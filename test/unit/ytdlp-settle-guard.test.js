'use strict';

// [UNIT] v1.393.0 W1 (plan 2026-10-20-listing-overflow, R1): a settle body that throws after its latch is set
// must still settle the promise. Production: `Buffer.toString` on more than 512 MB of list output threw
// ERR_STRING_TOO_LONG inside spawnYtdlp's 'close' handler; the throw escaped to server.js's log-only
// uncaughtException handler, the promise never resolved, and the heavy gate stayed held for hours.
// Every settle site is driven here with an injected throw (a console.error that throws is reached by every failure
// path's log line, which sits AFTER the latch); each must resolve ESETTLE, never leave
// an uncaught exception, and the NEXT gate job must run.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const engine = require('../../lib/ytdlp/engine');
const run = require('../../lib/ytdlp/run');
const { runExclusive, isHeavyJobActive } = require('../../lib/heavyGate');

const dirs = [];
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-settle-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

function fakeBin(d, name, body) {
  const bin = path.join(d, name);
  fs.writeFileSync(bin, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  return bin;
}
async function withBin(bin, fn) {
  const orig = engine.activeBinaryPath;
  engine.activeBinaryPath = () => bin;
  try { return await fn(); } finally { engine.activeBinaryPath = orig; }
}
// A log sink that throws on yt-dlp's own failure lines (they are written AFTER the settle latch on every path).
// The guard's own line is let through so only the site under test throws.
async function withThrowingLog(fn) {
  const orig = console.error;
  console.error = (...a) => {
    if (typeof a[0] === 'string' && a[0].startsWith('yt-dlp ') && !a[0].startsWith('yt-dlp settle threw')) {
      throw new Error('injected: log sink threw');
    }
    return orig.apply(console, a);
  };
  try { return await fn(); } finally { console.error = orig; }
}
// Capture uncaught exceptions for the duration of fn (node:test's own listener is parked meanwhile).
async function captureUncaught(fn) {
  const saved = process.listeners('uncaughtException');
  const seen = [];
  process.removeAllListeners('uncaughtException');
  process.on('uncaughtException', (e) => seen.push(e));
  try {
    const value = await fn();
    await new Promise((r) => setImmediate(r));
    return { value, seen };
  } finally {
    process.removeAllListeners('uncaughtException');
    for (const l of saved) process.on('uncaughtException', l);
  }
}
// Resolves with the promise's value, or the string 'WEDGED' when it has not settled in `ms`.
function within(p, ms = 4000) {
  let timer;
  const wedged = new Promise((r) => { timer = setTimeout(() => r('WEDGED'), ms); });
  return Promise.race([p, wedged]).finally(() => clearTimeout(timer));
}

// A job queued BEHIND the one under test must run: the gate is released.
async function assertGateFree(first) {
  let nextRan = false;
  const a = runExclusive(() => first());
  const b = runExclusive(async () => { nextRan = true; });
  const result = await within(a);
  await within(b);
  assert.strictEqual(nextRan, true, 'the next gate job never ran: the gate is wedged');
  assert.strictEqual(isHeavyJobActive(), false, 'the gate is still held');
  return result;
}
function assertESettle(result, site) {
  assert.notStrictEqual(result, 'WEDGED', 'the promise never settled (' + site + ')');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'ESETTLE', JSON.stringify(result));
  assert.match(result.error, new RegExp(site));
}

// A fake child with piped streams, for the stream-'error' sites a real child cannot be made to hit.
function fakeChild() {
  const child = new EventEmitter();
  child.pid = undefined;
  child.stdout = Object.assign(new EventEmitter(), { destroy() {} });
  child.stderr = Object.assign(new EventEmitter(), { destroy() {} });
  child.kill = () => true;
  return child;
}
async function withFakeSpawn(child, fn) {
  const orig = cp.spawn;
  cp.spawn = () => child;
  try { return await fn(); } finally { cp.spawn = orig; }
}

test('R1 spawnYtdlp finish: the real ERR_STRING_TOO_LONG throw at the decode (the production wedge) resolves ESETTLE and frees the gate', async () => {
  const d = tmpDir();
  const bin = fakeBin(d, 'ok', "process.stdout.write('OVERFLOW-MARKER\\n');");
  const marker = Buffer.from('OVERFLOW-MARKER\n');
  const origToString = Buffer.prototype.toString;
  Buffer.prototype.toString = function patched(...a) {
    if (this.length === marker.length && this.equals(marker)) {
      throw Object.assign(new RangeError('Cannot create a string longer than 0x1fffffe8 characters'), { code: 'ERR_STRING_TOO_LONG' });
    }
    return origToString.apply(this, a);
  };
  try {
    const { value, seen } = await captureUncaught(() => withBin(bin, () => assertGateFree(() => run.spawnYtdlp(['--dump-json', 'x'], { timeoutMs: 10000 }))));
    assertESettle(value, 'finish');
    assert.match(value.error, /longer than/);
    assert.deepStrictEqual(seen.map((e) => e.message), [], 'nothing may escape to uncaughtException');
  } finally {
    Buffer.prototype.toString = origToString;
  }
});

test('R1 spawnYtdlp finish: a throw on the failure path (non-zero exit) resolves ESETTLE', async () => {
  const d = tmpDir();
  const bin = fakeBin(d, 'bad', 'process.exit(3);');
  const { value, seen } = await captureUncaught(() => withThrowingLog(() => withBin(bin, () => assertGateFree(() => run.spawnYtdlp(['--dump-json', 'x'], { timeoutMs: 10000 })))));
  assertESettle(value, 'finish');
  assert.deepStrictEqual(seen, []);
});

test('R1 spawnYtdlp error handler: a spawn failure whose reporting throws resolves ESETTLE', async () => {
  const d = tmpDir();
  const { value, seen } = await captureUncaught(() => withThrowingLog(() => withBin(path.join(d, 'does-not-exist'), () => assertGateFree(() => run.spawnYtdlp(['--dump-json', 'x'], { timeoutMs: 10000 })))));
  assertESettle(value, 'error');
  assert.deepStrictEqual(seen, []);
});

for (const stream of ['stdout', 'stderr']) {
  test(`R1 spawnYtdlp ${stream} stream error handler: a throw while reporting resolves ESETTLE`, async () => {
    const child = fakeChild();
    const { value, seen } = await captureUncaught(() => withThrowingLog(() => withFakeSpawn(child, () => assertGateFree(async () => {
      const p = run.spawnYtdlp(['--dump-json', 'x'], { timeoutMs: 10000 });
      child[stream].emit('error', new Error('boom'));
      return p;
    }))));
    assertESettle(value, `${stream}-error`);
    assert.deepStrictEqual(seen, []);
  });

  test(`R1 spawnYtdlpDownload ${stream} stream error handler: a throw while reporting resolves ESETTLE, keeping the result shape`, async () => {
    const child = fakeChild();
    const { value, seen } = await captureUncaught(() => withThrowingLog(() => withFakeSpawn(child, () => assertGateFree(async () => {
      const p = run.spawnYtdlpDownload(['--', 'x'], { timeoutMs: 10000 });
      child[stream].emit('error', new Error('boom'));
      return p;
    }))));
    assertESettle(value, `${stream}-error`);
    assert.deepStrictEqual([value.channelMeta, value.itemFailures], [[], []]);
    assert.deepStrictEqual(seen, []);
  });
}

test('R1 spawnYtdlpDownload finish: a throw on the failure path resolves ESETTLE, keeping the result shape', async () => {
  const d = tmpDir();
  const bin = fakeBin(d, 'bad', 'process.exit(3);');
  const { value, seen } = await captureUncaught(() => withThrowingLog(() => withBin(bin, () => assertGateFree(() => run.spawnYtdlpDownload(['--', 'x'], { timeoutMs: 10000 })))));
  assertESettle(value, 'finish');
  assert.deepStrictEqual([value.channelMeta, value.itemFailures], [[], []]);
  assert.deepStrictEqual(seen, []);
});

test('R1 spawnYtdlpDownload error handler: a spawn failure whose reporting throws resolves ESETTLE', async () => {
  const d = tmpDir();
  const { value, seen } = await captureUncaught(() => withThrowingLog(() => withBin(path.join(d, 'does-not-exist'), () => assertGateFree(() => run.spawnYtdlpDownload(['--', 'x'], { timeoutMs: 10000 })))));
  assertESettle(value, 'error');
  assert.deepStrictEqual(seen, []);
});

test('R1 engine.runEngineProcess: a throw while building the close result resolves ESETTLE', async () => {
  const d = tmpDir();
  const bin = fakeBin(d, 'hang', 'setTimeout(() => {}, 60000);');
  const phaseLabel = { toString() { throw new Error('injected: label threw'); } };
  const { value, seen } = await captureUncaught(() => assertGateFree(() => engine.runEngineProcess(bin, [], { timeoutMs: 50, phaseLabel })));
  assert.notStrictEqual(value, 'WEDGED', 'the engine process promise never settled');
  assert.strictEqual(value.ok, false);
  assert.strictEqual(value.code, 'ESETTLE');
  assert.deepStrictEqual(seen, []);
});
