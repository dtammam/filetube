'use strict';

// [UNIT] tech-debt #202's structural guard (v1.266). Requiring server.js OPENS a
// database at require time; a test file that does so WITHOUT first pointing
// DATA_DIR somewhere private opens the repo-root filetube.db, and `node --test`
// runs files in parallel, so several such files race on `PRAGMA journal_mode =
// WAL` and one dies with SQLITE_BUSY - the transient crash that killed a whole
// file twice (v1.263 dual-Node, v1.265 gate).
//
// This net is DYNAMIC (the v1.250 shell-parity lesson: enumerate the tree each
// run, never a hardcoded list, with fail-safe floors so a broken glob cannot
// pass vacuously) and it binds ORDER, not just presence: the isolation must come
// BEFORE the server require, or it is too late to matter.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TEST_ROOT = path.join(__dirname, '..');
const DIRS = ['unit', 'integration'];

// adversarial S1: PER-DIRECTORY floors. A single global floor had 3-10x slack, so
// dropping 'integration' from DIRS entirely (losing 212 files incl. the one
// isolated offender) sailed through. Each directory now carries its own.
const DIR_FLOORS = { unit: 380, integration: 180 };

function testFilesByDir() {
  const out = {};
  for (const d of DIRS) {
    const dir = path.join(TEST_ROOT, d);
    out[d] = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => path.join(dir, f))
      : [];
  }
  return out;
}

// adversarial W2 (both escapes MEASURED - each created a repo-root db with the
// guard green): the require must match ANY quote style (there is no `quotes`
// eslint rule to stop a respelling), and the isolation must be an ASSIGNMENT -
// a bare `const prior = process.env.DATA_DIR` read satisfied a mention-check.
const SERVER_REQUIRE = /require\(\s*['"`]\.\.\/\.\.\/server(\.js)?['"`]\s*\)/;
const ISOLATE_REQUIRE = /require\(\s*['"`]\.\.\/helpers\/isolate-data-dir['"`]\s*\)/;
const DATA_DIR_ASSIGN = /process\.env\.DATA_DIR\s*=[^=]/;

test('#202: every test file that requires server.js isolates DATA_DIR FIRST (dynamic, per-directory fail-safe floors)', () => {
  const byDir = testFilesByDir();
  for (const [d, floor] of Object.entries(DIR_FLOORS)) {
    assert.ok((byDir[d] || []).length >= floor,
      `fail-safe floor: test/${d} expected >=${floor} files, found ${(byDir[d] || []).length} (a lost directory must not pass vacuously)`);
  }
  const files = Object.values(byDir).flat();

  let checked = 0;
  const offenders = [];
  for (const file of files) {
    if (path.basename(file) === path.basename(__filename)) continue; // this guard quotes the needles as literals
    const src = fs.readFileSync(file, 'utf8');
    const serverMatch = src.match(SERVER_REQUIRE);
    if (!serverMatch) continue; // this file never opens a db
    const serverAt = serverMatch.index;
    checked++;

    const isolateMatch = src.match(ISOLATE_REQUIRE);
    const envMatch = src.match(DATA_DIR_ASSIGN);
    const earliest = Math.min(
      isolateMatch ? isolateMatch.index : Infinity,
      envMatch ? envMatch.index : Infinity,
    );
    if (!Number.isFinite(earliest)) {
      offenders.push(`${path.basename(file)}: requires server.js with NO DATA_DIR isolation`);
    } else if (earliest > serverAt) {
      offenders.push(`${path.basename(file)}: isolates DATA_DIR AFTER requiring server.js (too late - the db is already open)`);
    }
  }

  assert.ok(checked >= 20, `fail-safe floor: expected >=20 server-requiring files, checked ${checked}`);
  assert.deepStrictEqual(offenders, [], 'files that open a db without isolating it first:\n  ' + offenders.join('\n  '));
});

test('#202: the connection opens with a busy timeout BEFORE any lock-taking statement', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'db', 'sqlite.js'), 'utf8');
  const openAt = src.indexOf('function openConnection(');
  assert.ok(openAt > -1, 'openConnection exists');
  const body = src.slice(openAt, openAt + 400);
  assert.match(body, /PRAGMA busy_timeout = \$\{BUSY_TIMEOUT_MS\}/, 'the busy timeout is set at open (default is ZERO - instant SQLITE_BUSY on any contention)');
  const timeoutAt = body.indexOf('busy_timeout');
  const fkAt = body.indexOf('foreign_keys');
  assert.ok(timeoutAt < fkAt, 'the timeout is set FIRST, so every later statement is covered by it');
  assert.match(src, /const BUSY_TIMEOUT_MS = 5000;/, 'the value is pinned (a drop to 0 restores the bug)');
});

test('#202: the busy timeout is BEHAVIOURALLY in effect on a real connection (adversarial W1: source text proves presence, not binding)', () => {
  const os = require('node:os');
  const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-busyprobe-'));
  const adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  try {
    const read = adapter.sql.prepare('PRAGMA busy_timeout').get();
    const value = read.timeout !== undefined ? read.timeout : Object.values(read)[0];
    assert.strictEqual(Number(value), 5000, 'SQLite itself reports the timeout - a never-executed pragma string cannot fake this');
  } finally {
    adapter.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#202: a journal-mode switch RETRIES on SQLITE_BUSY (adversarial CRITICAL-1: the busy handler does NOT cover a mode change)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'db', 'sqlite.js'), 'utf8');
  assert.match(src, /function switchJournalMode\(sql, pragma, budgetMs\)/, 'the bounded retry helper exists');
  // Spelling-tolerant, but NOT toothless. My first relaxation matched bare words
  // against an UN-STRIPPED slice, so the word 'errcode' in this function's own
  // COMMENT satisfied it - deleting the guard line outright stayed green (and
  // made the retry loop forever on ANY error, hanging the run rather than
  // failing it). Strip comments first - the v1.50/v1.77/v1.133 lesson - then
  // bind the guard line's SHAPE: both axes plus the rethrow, any spelling.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const fnAt = stripped.indexOf('function switchJournalMode');
  assert.ok(fnAt > -1, 'the retry helper exists');
  const body = stripped.slice(fnAt, stripped.indexOf('\n}', fnAt));
  assert.match(body, /if \(.*errcode.*deadline.*\) throw err;/,
    'the retry gates on the error CODE and a deadline, and rethrows otherwise (delete either conjunct and this reds)');
  assert.match(src, /if \(!sleepSync\(25\)\) throw err;/, 'the wait SLEEPS, and if it CANNOT sleep it rethrows rather than reinstating the hot spin (my probe caught the first cut burning 100% CPU for the whole budget)');
  assert.match(src, /Atomics\.wait\(new Int32Array\(new SharedArrayBuffer\(4\)\), 0, 0, ms\)/, 'a real synchronous sleep, not a spin');
  assert.ok(!/sql\.prepare\('PRAGMA journal_mode = WAL'\)\.get\(\)/.test(src), 'no bare un-retried WAL switch remains');
  assert.ok(!/sql\.exec\('PRAGMA journal_mode = DELETE'\)/.test(src), 'no bare un-retried DELETE switch remains');
});


test('#202: the isolation helper REDIRECTS even when DATA_DIR is already exported (adversarial CRITICAL-2 - the conditional made it inert)', () => {
  const os = require('node:os');
  const cp = require('node:child_process');
  const operator = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-operator-'));
  try {
    // A child with DATA_DIR EXPORTED - the shape that made the first cut inert
    // (and, measured by the seat, migrated an operator's real db + created an admin).
    const helper = path.join(__dirname, '..', 'helpers', 'isolate-data-dir.js');
    const out = cp.execFileSync(process.execPath, ['-e', `require(${JSON.stringify(helper)}); console.log(process.env.DATA_DIR);`], {
      env: { ...process.env, DATA_DIR: operator },
      encoding: 'utf8',
    }).trim();
    assert.notStrictEqual(out, operator, 'the helper must OVERRIDE an exported DATA_DIR - restore the `if (!process.env.DATA_DIR)` and this reds');
    assert.ok(out.includes('filetube-isolated-'), `redirected to a private temp dir, got: ${out}`);
    assert.strictEqual(fs.readdirSync(operator).length, 0, 'the operator directory is never touched');
    fs.rmSync(out, { recursive: true, force: true }); // the child runs without the tmp-cleanup preload
  } finally {
    fs.rmSync(operator, { recursive: true, force: true });
  }
});


test('#202 CRITICAL-1 BEHAVIOURAL: a journal-mode switch really does ride out a cross-process lock (source locks alone let a budget-0 or requoted revert through)', () => {
  const os = require('node:os');
  const cp = require('node:child_process');
  // Raw access goes through the adapter's sanctioned test door - the source lock's
  // contract is that every SQLite API touch lives in lib/db/sqlite.js, and dodging
  // it with a respelling would be the exact porosity this wave keeps closing.
  const { SqliteAdapter, SQLITE_FILENAME, __openRawForTests } = require('../../lib/db/sqlite');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-c1bind-'));
  const dbPath = path.join(dir, SQLITE_FILENAME);
  const marker = path.join(dir, 'holding');
  let child;
  try {
    // Seed in DELETE mode so opening REQUIRES a journal-mode CHANGE - the statement
    // SQLite refuses to apply the busy handler to.
    const seed = __openRawForTests(dbPath);
    seed.exec('PRAGMA journal_mode = DELETE');
    seed.exec('CREATE TABLE hold(x)');
    seed.close();

    // A cross-process writer: the parent's retry BLOCKS its own loop, so a file
    // marker is the only workable handshake (an in-process holder could never release).
    const adapterPath = require.resolve('../../lib/db/sqlite');
    const holderSrc = `
      const { __openRawForTests } = require(${JSON.stringify(adapterPath)});
      const fs = require('node:fs');
      const db = __openRawForTests(${JSON.stringify(dbPath)});
      db.exec('PRAGMA busy_timeout = 0');
      db.exec('BEGIN IMMEDIATE');
      db.exec('INSERT INTO hold VALUES(1)');
      fs.writeFileSync(${JSON.stringify(marker)}, '1');
      setTimeout(() => { db.exec('COMMIT'); db.close(); process.exit(0); }, 1200);
    `;
    child = cp.spawn(process.execPath, ['-e', holderSrc], { stdio: 'ignore' });

    const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const waitStart = Date.now();
    while (!fs.existsSync(marker) && Date.now() - waitStart < 5000) sleep(20);
    assert.ok(fs.existsSync(marker), 'the holder took the write lock');

    const t0 = Date.now();
    const cpu0 = process.cpuUsage();
    const adapter = new SqliteAdapter(dbPath, { log: () => {} });
    const elapsed = Date.now() - t0;
    const cpu = process.cpuUsage(cpu0);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    adapter.close();
    assert.ok(elapsed >= 150, `the open WAITED for the lock (${elapsed}ms) - an un-retried switch returns errcode 5 in ~0ms`);
    // Adversarial N4: wall time alone cannot tell a SLEEP from a SPIN - a hot loop
    // waits just as long while pinning a core (measured 99.9% CPU vs 0.7%). This is
    // the one property the anti-spin hardening exists for, so it gets measured, not
    // asserted by the presence of an Atomics.wait call somewhere in the file.
    assert.ok(cpuMs < elapsed / 2, `the wait SLEPT rather than spun (${cpuMs.toFixed(1)}ms CPU over ${elapsed}ms wall) - a spin burns ~100%`);
  } finally {
    try { if (child) child.kill(); } catch (_) { /* already gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('#202 (QA S2): a failed open CLOSES its connection - no leaked handle, no orphan lock', () => {
  const os = require('node:os');
  const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-leak-'));
  const dbPath = path.join(dir, SQLITE_FILENAME);
  try {
    // A file that is not a database at all: the open path throws AFTER
    // openConnection has handed back a live handle.
    fs.writeFileSync(dbPath, 'this is not a sqlite file');
    // Count FILE DESCRIPTORS, which is the property that actually leaks. My
    // first version deleted the file and reopened the path, which makes a NEW
    // inode - and SQLite's locks are advisory anyway, so a second connection
    // opens a held db routinely. It could not fail. (Measured: fd delta 0
    // shipped vs 1 with the constructor's try/catch removed.)
    const fdDir = '/proc/self/fd';
    const countFds = () => fs.readdirSync(fdDir).length;
    const haveFds = fs.existsSync(fdDir); // Linux/Docker - where the app runs
    const before = haveFds ? countFds() : 0;
    assert.throws(() => new SqliteAdapter(dbPath, { log: () => {} }), 'the malformed db throws out of the constructor');
    if (haveFds) {
      assert.strictEqual(countFds(), before, 'the failed open CLOSED its handle - no leaked descriptor (remove the constructor try/catch and this reds)');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
