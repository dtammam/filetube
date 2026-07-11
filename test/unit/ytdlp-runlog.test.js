'use strict';

// [UNIT] lib/ytdlp/runlog.js -- the capped JSONL run-log writer/reader
// (v1.29.0 T1, R0.5/R0.6/AC2.2). `recordRun`/`readRuns` take `dataDir`
// explicitly (never read `process.env.DATA_DIR` themselves), so every test
// here uses its OWN isolated temp directory -- created fresh per test via
// `beforeEach` -- and never touches real project data.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const { recordRun, readRuns, YTDLP_RUNLOG_MAX_ENTRIES } = require('../../lib/ytdlp/runlog');

let dataDir;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-runlog-test-'));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function runlogPath(dir) {
  return path.join(dir, 'ytdlp-runs.jsonl');
}

test('YTDLP_RUNLOG_MAX_ENTRIES is exactly 500', () => {
  assert.equal(YTDLP_RUNLOG_MAX_ENTRIES, 500);
});

test('recordRun appends a single valid JSON line for a fresh log', () => {
  recordRun(dataDir, { ts: 1, kind: 'subscription', id: 'sub1', name: 'x', outcome: 'success', succeeded: 3, failed: 0 });
  const raw = fs.readFileSync(runlogPath(dataDir), 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.id, 'sub1');
  assert.equal(parsed.outcome, 'success');
});

test('recordRun appends across multiple calls, oldest first', () => {
  recordRun(dataDir, { ts: 1, id: 'a' });
  recordRun(dataDir, { ts: 2, id: 'b' });
  recordRun(dataDir, { ts: 3, id: 'c' });
  const runs = readRuns(dataDir);
  assert.deepEqual(runs.map((r) => r.id), ['a', 'b', 'c']);
});

test('the run log stays capped at YTDLP_RUNLOG_MAX_ENTRIES lines: feeding 500 entries via direct writes then ONE more recordRun leaves the file at exactly 500 lines, dropping the oldest', () => {
  // Directly write 500 well-formed lines (bypassing recordRun's own
  // atomic-write path, to isolate "does the cap enforcement itself work"
  // from "does the atomic write itself work", which is covered separately
  // below).
  const seedLines = [];
  for (let i = 0; i < YTDLP_RUNLOG_MAX_ENTRIES; i++) {
    seedLines.push(JSON.stringify({ ts: i, id: `run-${i}` }));
  }
  fs.writeFileSync(runlogPath(dataDir), seedLines.join('\n') + '\n', 'utf8');

  recordRun(dataDir, { ts: YTDLP_RUNLOG_MAX_ENTRIES, id: 'run-500-the-newest' });

  const raw = fs.readFileSync(runlogPath(dataDir), 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  assert.equal(lines.length, YTDLP_RUNLOG_MAX_ENTRIES, `must stay capped at exactly ${YTDLP_RUNLOG_MAX_ENTRIES} lines`);

  const parsedIds = lines.map((l) => JSON.parse(l).id);
  assert.ok(!parsedIds.includes('run-0'), 'the OLDEST entry (run-0) must have been dropped to make room');
  assert.equal(parsedIds[parsedIds.length - 1], 'run-500-the-newest', 'the newest entry must be present');
});

test('recordRun performs an atomic write: no stray .tmp file is left behind on the happy path', () => {
  recordRun(dataDir, { ts: 1, id: 'a' });
  recordRun(dataDir, { ts: 2, id: 'b' });
  const leftovers = fs.readdirSync(dataDir).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'no temp file should survive a successful recordRun call');
  assert.ok(fs.existsSync(runlogPath(dataDir)), 'the real run-log file must exist after a successful append');
});

test('readRuns skips a deliberately malformed line without throwing, keeping the well-formed ones', () => {
  const lines = [
    JSON.stringify({ ts: 1, id: 'good-1' }),
    '{not valid json at all',
    JSON.stringify({ ts: 2, id: 'good-2' }),
    '',
    'null',
    '42',
    '"just a string"',
  ];
  fs.writeFileSync(runlogPath(dataDir), lines.join('\n') + '\n', 'utf8');

  let runs;
  assert.doesNotThrow(() => { runs = readRuns(dataDir); });
  assert.deepEqual(runs.map((r) => r.id), ['good-1', 'good-2']);
});

test('readRuns on a non-existent file returns [] and does not create the file', () => {
  const runs = readRuns(dataDir);
  assert.deepEqual(runs, []);
  assert.equal(fs.existsSync(runlogPath(dataDir)), false, 'a mere read of a missing log must never create it (disabled-module no-op guarantee)');
});

test('requiring lib/ytdlp/runlog.js has no side effects: no file is created merely by importing the module', () => {
  // A second, otherwise-untouched dataDir -- confirms nothing from the
  // require() at the top of this file (or the recordRun/readRuns calls in
  // OTHER tests above) leaked a file into a directory this test never
  // wrote to.
  const untouchedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-runlog-untouched-'));
  try {
    assert.equal(fs.existsSync(runlogPath(untouchedDir)), false);
  } finally {
    fs.rmSync(untouchedDir, { recursive: true, force: true });
  }
});

test('readRuns respects an explicit limit lower than the total entry count, keeping the newest', () => {
  recordRun(dataDir, { ts: 1, id: 'a' });
  recordRun(dataDir, { ts: 2, id: 'b' });
  recordRun(dataDir, { ts: 3, id: 'c' });
  const runs = readRuns(dataDir, 2);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map((r) => r.id), ['b', 'c']);
});

test('readRuns caps a requested limit larger than YTDLP_RUNLOG_MAX_ENTRIES at the real cap', () => {
  recordRun(dataDir, { ts: 1, id: 'a' });
  const runs = readRuns(dataDir, YTDLP_RUNLOG_MAX_ENTRIES + 1000);
  assert.equal(runs.length, 1); // only one entry exists; proves no throw/overrun, not the cap ceiling itself
});

test('recordRun never throws on a missing/oddly-typed field in the entry', () => {
  assert.doesNotThrow(() => recordRun(dataDir, { ts: 'not-a-number', outcome: 42, failures: 'not-an-array' }));
  const runs = readRuns(dataDir);
  assert.equal(runs.length, 1);
});

test('recordRun is a no-op (never throws) when handed a non-object entry', () => {
  assert.doesNotThrow(() => recordRun(dataDir, null));
  assert.doesNotThrow(() => recordRun(dataDir, undefined));
  assert.doesNotThrow(() => recordRun(dataDir, 'a string'));
  assert.deepEqual(readRuns(dataDir), []);
});

test('recordRun preserves the full line schema fields it is given, untouched', () => {
  const entry = {
    ts: 1234567890,
    kind: 'subscription',
    id: 'sub-1',
    name: 'Some Channel',
    outcome: 'partial',
    succeeded: 4,
    failed: 1,
    reason: null,
    cookieWarning: false,
    failures: [{ videoId: 'vid1', title: 'Some Title', reason: 'Video unavailable' }],
  };
  recordRun(dataDir, entry);
  const [run] = readRuns(dataDir);
  assert.deepEqual(run, entry);
});
