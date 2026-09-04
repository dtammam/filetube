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
  assert.match(src, /if \(!err \|\| err\.errcode !== 5 \|\| Date\.now\(\) >= deadline\) throw err;/, 'it retries ONLY on SQLITE_BUSY and ONLY within the budget - anything else rethrows at once');
  assert.match(src, /sleepSync\(25\); \/\/ SQLITE_BUSY: wait, don't burn the CPU/, 'the wait SLEEPS (my own probe caught the first cut hot-looping at 100% CPU for the whole budget)');
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
  } finally {
    fs.rmSync(operator, { recursive: true, force: true });
  }
});
