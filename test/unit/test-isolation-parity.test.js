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

function testFiles() {
  const out = [];
  for (const d of DIRS) {
    const dir = path.join(TEST_ROOT, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.test.js')) out.push(path.join(dir, f));
    }
  }
  return out;
}

test('#202: every test file that requires server.js isolates DATA_DIR FIRST (dynamic, fail-safe floors)', () => {
  const files = testFiles();
  assert.ok(files.length >= 200, `fail-safe floor: expected >=200 test files, found ${files.length} (a broken walk must not pass vacuously)`);

  let checked = 0;
  const offenders = [];
  for (const file of files) {
    if (path.basename(file) === path.basename(__filename)) continue; // this guard quotes the needles as literals
    const src = fs.readFileSync(file, 'utf8');
    // The require that opens a db. Match both spellings actually used in-tree.
    const serverAt = Math.min(
      ...["require('../../server')", "require('../../server.js')"]
        .map((needle) => { const i = src.indexOf(needle); return i === -1 ? Infinity : i; }),
    );
    if (!Number.isFinite(serverAt)) continue; // this file never opens a db
    checked++;

    const isolateAt = src.indexOf("require('../helpers/isolate-data-dir')");
    const envAt = src.indexOf('process.env.DATA_DIR');
    const earliest = Math.min(
      isolateAt === -1 ? Infinity : isolateAt,
      envAt === -1 ? Infinity : envAt,
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
