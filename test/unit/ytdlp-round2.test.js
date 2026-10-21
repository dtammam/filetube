'use strict';

// [UNIT] v1.393.0 gate round 2 (plan 2026-10-20-listing-overflow): the bindings the first gate round found
// missing. Each test names the guard it pins; the mutants are recorded in the plan's Evidence.

const { test, afterEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const engine = require('../../lib/ytdlp/engine');
const run = require('../../lib/ytdlp/run');
const rules = require('../../lib/ytdlp/rules');
const trace = require('../../lib/ytdlp/oneshotTrace');
const gate = require('../../lib/heavyGate');

const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));

const dirs = [];
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-round2-u-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  trace.resetForTests();
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await tick(20); }
  throw new Error('timed out waiting');
}
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
async function withLog(sink, fn) {
  const orig = console.error;
  console.error = sink;
  try { return await fn(); } finally { console.error = orig; }
}
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
function within(p, ms = 4000) {
  let timer;
  const wedged = new Promise((r) => { timer = setTimeout(() => r('WEDGED'), ms); });
  return Promise.race([p, wedged]).finally(() => clearTimeout(timer));
}

test('R3 spawnYtdlpDownload refuses to spawn from an abandoned gate job (EABANDONED), like spawnYtdlp', async () => {
  const d = tmpDir();
  const bin = fakeBin(d, 'bin', `require('fs').writeFileSync(${JSON.stringify(path.join(d, 'ran'))}, 'x');`);
  let wake;
  const woken = new Promise((r) => { wake = r; });
  let late;
  await withLog(() => {}, () => withBin(bin, async () => {
    const a = gate.runExclusive(async () => {
      await woken;
      late = await run.spawnYtdlpDownload(['--', 'x'], { timeoutMs: 5000 });
    }, { kind: 'channel', label: 'hung', budgetMs: 100, onBudgetExceeded: () => true });
    await a; // released at its budget
    wake();
    await until(() => late);
  }));
  assert.strictEqual(late.code, 'EABANDONED', JSON.stringify(late));
  assert.strictEqual(fs.existsSync(path.join(d, 'ran')), false, 'nothing was spawned');
});

test('R3 killAllLiveYtdlp answers false while a group is still alive (it does not claim a kill it has not seen), then true', async () => {
  const d = tmpDir();
  const bin = fakeBin(d, 'hang', `require('fs').writeFileSync(${JSON.stringify(path.join(d, 'pid'))}, String(process.pid));\nsetInterval(() => {}, 1000);`);
  await withBin(bin, async () => {
    const p = run.spawnYtdlp(['x'], { timeoutMs: 600000 });
    const pid = Number(await until(() => (fs.existsSync(path.join(d, 'pid')) ? fs.readFileSync(path.join(d, 'pid'), 'utf8') : null)));
    assert.ok(alive(pid));
    assert.strictEqual(await run.killAllLiveYtdlp(0), false, 'a group is still registered');
    assert.strictEqual(await run.killAllLiveYtdlp(5000), true);
    assert.strictEqual(alive(pid), false);
    await p;
  });
});

test('R1 spawnYtdlpDownload exit-grace path: a throw while settling late resolves ESETTLE', async () => {
  const child = fakeChild();
  const { value, seen } = await captureUncaught(() => withLog((...a) => {
    if (typeof a[0] === 'string' && a[0].startsWith('yt-dlp ') && !a[0].startsWith('yt-dlp settle threw')) throw new Error('injected');
  }, () => withFakeSpawn(child, async () => {
    const p = run.spawnYtdlpDownload(['--', 'x'], { timeoutMs: 600000, exitGraceMs: 50 });
    child.emit('exit', 3, null); // 'close' never comes: the pipe-holder shape
    return within(p);
  })));
  assert.notStrictEqual(value, 'WEDGED');
  assert.strictEqual(value.code, 'ESETTLE', JSON.stringify(value));
  assert.deepStrictEqual(seen, []);
});

test('R1 engine.runEngineProcess child error handler: a throw while building the result resolves ESETTLE', async () => {
  const child = fakeChild();
  const err = { get message() { throw new Error('injected'); } };
  const { value, seen } = await captureUncaught(() => withFakeSpawn(child, async () => {
    const p = engine.runEngineProcess('x', [], { timeoutMs: 60000 });
    child.emit('error', err);
    return within(p);
  }));
  assert.notStrictEqual(value, 'WEDGED');
  assert.strictEqual(value.code, 'ESETTLE');
  assert.deepStrictEqual(seen, []);
});

test('R1 engine.runEngineProcess: a grandchild holding the pipes does not wedge the gate (settles at the exit grace; a timeout kill likewise)', async () => {
  const d = tmpDir();
  // The child exits at once but leaves a grandchild holding stdout open for 20 s.
  const bin = fakeBin(d, 'holder', `require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true }).unref();`);
  const t0 = Date.now();
  const r = await within(engine.runEngineProcess(bin, [], { timeoutMs: 30000, exitGraceMs: 300 }), 5000);
  assert.notStrictEqual(r, 'WEDGED', 'the engine promise never settled: a pipe-holding grandchild wedges it');
  assert.ok(Date.now() - t0 < 5000);
  assert.strictEqual(r.code, 0);
  // Timeout path: the direct child hangs, is SIGKILLed, and a grandchild still holds the pipe.
  const bin2 = fakeBin(d, 'holder2', `require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true }).unref();\nsetInterval(() => {}, 1000);`);
  const r2 = await within(engine.runEngineProcess(bin2, [], { timeoutMs: 200, exitGraceMs: 300, phaseLabel: 'x' }), 5000);
  assert.notStrictEqual(r2, 'WEDGED');
  assert.strictEqual(r2.timedOut, true);
});

test('R2 collector end() flushes a last line that has no trailing newline (and counts nothing as skipped)', () => {
  const c = run.makeSlimListCollector(run.LIST_KEEP_FIELDS);
  c.push(Buffer.from('{"id":"a","pad":"x"}\n{"id":"b","title":"last"}'));
  c.end();
  assert.deepStrictEqual(rules.parseYtdlpVideoList(c.text()), [{ id: 'a' }, { id: 'b', title: 'last' }]);
  assert.strictEqual(c.stats().skippedLines, 0);
});

test('R1 a log sink that throws on EVERY line (the guard\'s own included) still resolves ESETTLE', async () => {
  const child = fakeChild();
  const { value, seen } = await captureUncaught(() => withLog(() => { throw new Error('sink down'); }, () => withFakeSpawn(child, async () => {
    const p = run.spawnYtdlp(['--dump-json', 'x'], { timeoutMs: 10000 });
    child.stdout.emit('error', new Error('boom'));
    return within(p);
  })));
  assert.notStrictEqual(value, 'WEDGED');
  assert.strictEqual(value.code, 'ESETTLE');
  assert.deepStrictEqual(seen, []);
});

test('R1 the ESETTLE message redacts the cookies path', async () => {
  const d = tmpDir();
  const cookies = '/secret/dir/cookies.txt';
  const bin = fakeBin(d, 'ok', "process.stdout.write('MARK\\n');");
  const marker = Buffer.from('MARK\n');
  const orig = Buffer.prototype.toString;
  Buffer.prototype.toString = function patched(...a) {
    if (this.length === marker.length && this.equals(marker)) throw new Error(`cannot read ${cookies} now`);
    return orig.apply(this, a);
  };
  try {
    const r = await withBin(bin, () => withLog(() => {}, () => within(run.spawnYtdlp(['--dump-json', 'x'], { timeoutMs: 10000, cookiesPath: cookies }))));
    assert.strictEqual(r.code, 'ESETTLE', JSON.stringify(r));
    assert.doesNotMatch(r.error, /secret|cookies\.txt/);
    assert.match(r.error, /<redacted>/);
  } finally {
    Buffer.prototype.toString = orig;
  }
});

test('R5 the uncaught record is scrubbed: URL tokens reduced to the host, cookies paths dropped, control characters (log injection) flattened', () => {
  const d = tmpDir();
  const handler = trace.makeUncaughtHandler(d, () => {});
  const err = new Error('fetch https://example.com/path?token=SECRET123 failed using /data/cookies.txt\nFAKE-LINE injected\u0000');
  err.stack = `Error: ${err.message}\n    at https://example.com/a?k=SECRET456 (x.js:1:1)`;
  handler(err);
  const [e] = trace.readEntries(d);
  const blob = JSON.stringify(e);
  assert.doesNotMatch(blob, /SECRET123|SECRET456|cookies\.txt|token=/);
  assert.match(e.message, /example\.com/);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(e.message, /[\u0000-\u001f]/);
  assert.doesNotMatch(trace.formatTraceText([e], {}), /\nFAKE-LINE/);
});

test('R1 spawnYtdlp exit-grace path: a throw while settling late resolves ESETTLE', async () => {
  const child = fakeChild();
  const { value, seen } = await captureUncaught(() => withLog((...a) => {
    if (typeof a[0] === 'string' && a[0].startsWith('yt-dlp ') && !a[0].startsWith('yt-dlp settle threw')) throw new Error('injected');
  }, () => withFakeSpawn(child, async () => {
    const p = run.spawnYtdlp(['--dump-json', 'x'], { timeoutMs: 600000, exitGraceMs: 50 });
    child.emit('exit', 3, null);
    return within(p);
  })));
  assert.notStrictEqual(value, 'WEDGED');
  assert.strictEqual(value.code, 'ESETTLE', JSON.stringify(value));
  assert.deepStrictEqual(seen, []);
});
