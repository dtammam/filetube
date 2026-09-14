'use strict';

// [INTEGRATION] v1.42 AC4 — the WAL crash test, with a REAL `kill -9`
// (QA-gate CRITICAL: an explicitly-named AC had no automated proof; a
// JS-level throw is not an OS-level kill). A child process commits
// monotonic single-transaction bursts against the real adapter; the parent
// SIGKILLs it mid-burst, reopens the store, and asserts the recovered state
// is EXACTLY "after transaction K" for some K — WAL recovery must yield the
// last committed transaction intact and nothing torn.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { readPersistedDatabase, SQLITE_FILENAME } = require('../../lib/db/sqlite');

test('AC4: kill -9 mid-write-burst → reopen clean, last committed transaction intact, nothing torn', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-kill9-'));
  try {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'helpers', 'crash-child.js'), dataDir], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let finished = false;
    await new Promise((resolve, reject) => {
      let buffered = '';
      const timeout = setTimeout(() => reject(new Error('child never reached READY')), 15000);
      child.stdout.on('data', (chunk) => {
        buffered += chunk.toString();
        if (buffered.includes('FINISHED')) finished = true;
        if (buffered.includes('READY')) {
          clearTimeout(timeout);
          // A beat of extra burst time so the kill lands genuinely mid-write,
          // then the hard kill — no signal handler can run, exactly like an
          // OOM-kill or power-adjacent process death.
          setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 60);
        }
      });
      child.on('error', reject);
    });
    await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(finished, false, 'the kill must land mid-burst (the child must not complete its cap)');

    // A hot -wal sidecar proves the kill interrupted WAL activity; recovery
    // must cope with it either way, so its presence is informational, not
    // asserted. What IS asserted: the reopen works and the state is a clean
    // committed prefix.
    const db = readPersistedDatabase(dataDir);
    const bursts0 = db.metadata || {};
    assert.ok(Number.isInteger(bursts0.marker), 'the marker row recovered (Wave 4: two kv rows per burst, no singleton left)');
    const k = bursts0.marker;
    assert.ok(Number.isInteger(k) && k >= 5, `at least the pre-READY commits survived (K=${k})`);

    // Wave 2: the per-burst kv row is a metadata row (progress is relational now).
    const bursts = db.metadata || {};
    const keys = Object.keys(bursts);
    assert.equal(keys.length, k + 1, `exactly K=${k} burst rows + the marker — the marker row and its burst's row committed ATOMICALLY`);
    assert.equal(bursts[`p${k}`], k, 'the last committed transaction is fully intact');
    assert.equal(bursts[`p${k + 1}`], undefined, 'nothing from the killed transaction leaked');

    // And the store is fully writable after recovery (no lingering lock/hot
    // journal wedge) — reopen via the real adapter and commit once more.
    const { SqliteAdapter } = require('../../lib/db/sqlite');
    const a = new SqliteAdapter(path.join(dataDir, SQLITE_FILENAME), { log: () => {} });
    try {
      const reopened = a.load();
      reopened.metadata.marker = 'post-recovery'; // Wave 4: a kv row (no doc singleton left for this probe)
      a.save(reopened);
      assert.deepEqual(readPersistedDatabase(dataDir).metadata.marker, 'post-recovery');
    } finally {
      a.close();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
