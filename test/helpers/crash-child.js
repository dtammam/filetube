'use strict';

// Child process for the AC4 kill -9 crash test (db-crash-kill9.test.js).
// Opens the REAL adapter against argv[2]'s DATA_DIR and commits monotonic
// write bursts forever (capped defensively); the parent SIGKILLs it
// mid-burst. Each iteration commits ONE transaction that updates the
// `folders` singleton to ['/burst-<i>'] AND adds progress row p<i> = i —
// so any post-crash state must be exactly "after transaction K" for some K:
// folders names K, and progress holds exactly p1..pK. Any other shape is a
// torn/partial commit, which SQLite must never produce.
const path = require('node:path');
const { SqliteAdapter } = require('../../lib/db/sqlite');

const dataDir = process.argv[2];
const adapter = new SqliteAdapter(path.join(dataDir, 'filetube.db'), { log: () => {} });

const db = { folders: [], progress: {} };
for (let i = 1; i <= 200000; i++) {
  db.folders = [`/burst-${i}`];
  db.progress[`p${i}`] = i;
  adapter.save(db);
  if (i === 5) process.stdout.write('READY\n'); // parent arms the kill after a few real commits
}
// Defensive cap reached without being killed — exit distinctly so the parent
// can tell (and fail honestly) rather than assert against a completed run.
process.stdout.write('FINISHED\n');
