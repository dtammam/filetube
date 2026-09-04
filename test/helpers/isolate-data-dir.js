'use strict';

// v1.266 (tech-debt #202, trigger fired twice): requiring server.js OPENS a
// database as a side effect (server.js:153 resolves DATA_DIR at require time and
// the adapter opens immediately). A unit file that requires server.js only for
// its PURE helpers therefore opened the REPO-ROOT filetube.db - and because
// `node --test` runs files in parallel, several processes raced to run
// `PRAGMA journal_mode = WAL` (a statement needing a brief exclusive lock),
// so whichever lost died instantly with SQLITE_BUSY. That was the transient
// "database is locked" crash that killed a whole file (and swallowed its
// remaining subtests) in v1.263's dual-Node and v1.265's gate.
//
// Requiring THIS module first points DATA_DIR at a fresh temp directory, so the
// file gets its own database and can never contend - nor touch real data.
// It must be required BEFORE any require of server.js (or anything that reaches
// the adapter); the dynamic guard in test/unit/test-isolation-parity.test.js
// enforces exactly that ordering across the whole tree.
//
// (adversarial S4) `npm test` preloads test/helpers/tmp-cleanup.js, which reaps
// these dirs; a bare `node --test <file>` leaves one behind, exactly like the
// ~190 files that inline the same mkdtemp. Not worth its own machinery.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// UNCONDITIONAL, matching the ~190 other server-requiring test files (adversarial
// CRITICAL-2): a conditional "only if unset" made this inert whenever DATA_DIR was
// exported - the seat measured these very files then migrating an operator's v19
// database to v20 (bricking it for the older build via the rollback floor) and
// creating a `testadmin` admin, with the new guard green throughout. No consumer
// reads DATA_DIR, so there was never a caller the conditional served.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-isolated-'));

module.exports = { DATA_DIR: process.env.DATA_DIR };
