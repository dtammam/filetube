'use strict';

// [UNIT] v1.393.0 W4 (plan 2026-10-20-listing-overflow, R5): an exception that reaches the process's
// uncaughtException handler is written to the download trace (kind `uncaught`), not only logged. Before, a throw
// inside a child-process listener left one container-log line and a wedged queue; now the next one is readable in
// Settings > Troubleshooting > Download trace without docker access. Bound: the handler logs AND records, bounded
// and never throwing; the record survives a trim; a REAL process installing the handler records a throw that
// escapes a timer and keeps running; server.js installs THIS handler (presence is not binding: a log-only handler
// there fails the wiring test).

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const trace = require('../../lib/ytdlp/oneshotTrace');

const dirs = [];
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-uncaught-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  trace.resetForTests();
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

test('R5 the handler logs AND records: name, code, message, the first stack lines (bounded)', () => {
  const d = tmpDir();
  const logged = [];
  const handler = trace.makeUncaughtHandler(d, (...a) => logged.push(a));
  const err = Object.assign(new RangeError('Cannot create a string longer than 0x1fffffe8 characters'), { code: 'ERR_STRING_TOO_LONG' });
  handler(err);
  assert.strictEqual(logged.length, 1);
  assert.strictEqual(logged[0][0], 'Uncaught exception:');
  assert.strictEqual(logged[0][1], err);
  const [e] = trace.readEntries(d);
  assert.strictEqual(e.jobId, 'process');
  assert.strictEqual(e.ev, 'uncaught');
  assert.strictEqual(e.name, 'RangeError');
  assert.strictEqual(e.code, 'ERR_STRING_TOO_LONG');
  assert.match(e.message, /longer than 0x1fffffe8/);
  assert.ok(e.stack.split(' | ').length <= trace.UNCAUGHT_STACK_LINES, e.stack);
  assert.match(e.stack, /RangeError/);
  const text = trace.formatTraceText([e], {});
  assert.match(text, / process uncaught name=RangeError code=ERR_STRING_TOO_LONG message=Cannot create/);
});

test('R5 bounded and never throwing: a huge message is cut, a non-Error and null are recorded, a throwing log sink and a dead fs do not escape', () => {
  const d = tmpDir();
  const handler = trace.makeUncaughtHandler(d, () => { throw new Error('log sink down'); });
  assert.doesNotThrow(() => handler(new Error('x'.repeat(100000))));
  assert.doesNotThrow(() => handler('a string was thrown'));
  assert.doesNotThrow(() => handler(null));
  assert.doesNotThrow(() => handler(undefined));
  const got = trace.readEntries(d);
  assert.strictEqual(got.length, 4);
  assert.ok(got[0].message.length <= 300);
  assert.strictEqual(got[1].message, 'a string was thrown');
  trace.setFsForTests({ ...fs, appendFileSync() { throw new Error('disk full'); }, readFileSync: fs.readFileSync });
  assert.doesNotThrow(() => trace.makeUncaughtHandler(d)(new Error('y')));
  assert.doesNotThrow(() => trace.makeUncaughtHandler('', () => {})(new Error('no dataDir')));
});

test('R5 the record survives a trim (a flood of progress lines cannot push the crash evidence out)', () => {
  const d = tmpDir();
  trace.setLimitsForTests({ maxLines: 40, trimAt: 60 });
  trace.makeUncaughtHandler(d, () => {})(new Error('the one that matters'));
  for (let i = 0; i < 200; i++) trace.record(d, 'job-' + (i % 5), 'progress', { i });
  assert.ok(trace.readEntries(d).some((e) => e.ev === 'uncaught' && e.message === 'the one that matters'));
});

test('R5 reachable: a REAL process with the handler installed records a throw that escapes a timer, and keeps running', () => {
  const d = tmpDir();
  const script = path.join(tmpDir(), 'child.js');
  fs.writeFileSync(script, `
    const trace = require(${JSON.stringify(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'oneshotTrace'))});
    process.on('uncaughtException', trace.makeUncaughtHandler(process.argv[2], () => {}));
    setTimeout(() => { throw Object.assign(new RangeError('escaped a listener'), { code: 'ERR_STRING_TOO_LONG' }); }, 5);
    setTimeout(() => { console.log('still alive'); }, 60);
  `);
  const r = spawnSync(process.execPath, [script, d], { encoding: 'utf8', timeout: 10000 });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /still alive/);
  const [e] = trace.readEntries(d);
  assert.deepStrictEqual([e.jobId, e.ev, e.code, e.message], ['process', 'uncaught', 'ERR_STRING_TOO_LONG', 'escaped a listener']);
});

test('R5 wiring: server.js installs the trace-recording handler, not a log-only one', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  const installs = [...src.matchAll(/process\.on\('uncaughtException',([^;]*)\);/g)].map((m) => m[1]);
  assert.strictEqual(installs.length, 1, 'exactly one uncaughtException handler is installed');
  assert.match(installs[0], /oneshotTrace'\)\.makeUncaughtHandler\(DATA_DIR\)/);
});
