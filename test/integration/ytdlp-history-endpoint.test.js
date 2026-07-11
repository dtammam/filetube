'use strict';

// [INTEGRATION] v1.29.0 T9 (R4.1-R4.4): the gated `GET /api/subscriptions/
// history` route -- reads the T0/T1 capped JSONL run log (`lib/ytdlp/
// runlog.js`) and returns `{ entries: [...] }` newest-first, capped at
// `YTDLP_RUNLOG_MAX_ENTRIES` regardless of what is on disk, degrading to an
// empty list rather than throwing. Registered directly against a bare
// `express()` app via `ytdlp.registerRoutes` (mirrors
// test/integration/ytdlp-status-endpoint.test.js's lightweight harness --
// this route needs no real subscription/download machinery, just a
// `deps.dataDir` pointing at an isolated temp directory and, for a couple of
// fixture-shaped tests, direct `recordRun`/raw-file writes into it).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const runlog = require('../../lib/ytdlp/runlog');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-history-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFakeDeps(dataDir) {
  const db = { ytdlp: { subscriptions: [], pins: [] } };
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
    dataDir,
  };
}

function enabledConfig(overrides = {}) {
  return ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir,
    ...overrides,
  });
}

async function startTestApp(deps, config) {
  const app = express();
  app.use(express.json());
  ytdlp.registerRoutes(app, deps, config);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function runEntry(overrides = {}) {
  return {
    ts: new Date().toISOString(),
    kind: 'subscription',
    id: 'sub-1',
    name: 'Some Channel',
    outcome: 'success',
    succeeded: 1,
    failed: 0,
    reason: '',
    cookieWarning: false,
    failures: [],
    ...overrides,
  };
}

// ---- Missing file -> {entries: []}, never a throw -------------------------

test('GET /api/subscriptions/history returns { entries: [] } when no run-log file exists yet', async () => {
  const server = await startTestApp(makeFakeDeps(tmpDir), enabledConfig());
  try {
    const res = await fetch(`${server.base}/api/subscriptions/history`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { entries: [] });
    assert.equal(fs.existsSync(path.join(tmpDir, 'ytdlp-runs.jsonl')), false, 'a mere read must never create the file');
  } finally {
    await server.close();
  }
});

// ---- AC2.3: entries are returned newest-first ------------------------------

test('AC2.3: GET /api/subscriptions/history returns run-log entries newest-first', async () => {
  runlog.recordRun(tmpDir, runEntry({ id: 'oldest-run', ts: '2026-01-01T00:00:00.000Z' }));
  runlog.recordRun(tmpDir, runEntry({ id: 'middle-run', ts: '2026-01-02T00:00:00.000Z' }));
  runlog.recordRun(tmpDir, runEntry({ id: 'newest-run', ts: '2026-01-03T00:00:00.000Z' }));

  const server = await startTestApp(makeFakeDeps(tmpDir), enabledConfig());
  try {
    const res = await fetch(`${server.base}/api/subscriptions/history`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.entries.map((e) => e.id), ['newest-run', 'middle-run', 'oldest-run']);
  } finally {
    await server.close();
  }
});

// ---- AC2.3: durability across a simulated restart --------------------------

test('AC2.3: a run recorded before this process/server started still appears, newest-first, after a simulated restart', async () => {
  // "Before the current server process started": record straight to disk,
  // completely independent of any running app/server instance.
  runlog.recordRun(tmpDir, runEntry({ id: 'pre-restart-run', ts: '2020-06-01T00:00:00.000Z' }));

  // Simulated restart: a BRAND NEW express app, a BRAND NEW deps object, and
  // a fresh `registerRoutes` call -- no shared in-memory state with the
  // `recordRun` call above whatsoever, exactly like a real process restart.
  // Only the on-disk `dataDir` ties the two together.
  const server = await startTestApp(makeFakeDeps(tmpDir), enabledConfig());
  try {
    // A run recorded AFTER the "restart" too, to prove ordering survives
    // the restart boundary as well.
    runlog.recordRun(tmpDir, runEntry({ id: 'post-restart-run', ts: '2026-01-01T00:00:00.000Z' }));

    const res = await fetch(`${server.base}/api/subscriptions/history`);
    const body = await res.json();
    assert.deepEqual(body.entries.map((e) => e.id), ['post-restart-run', 'pre-restart-run']);
  } finally {
    await server.close();
  }
});

// ---- AC2.4: disabled module -> route absent, no history served ------------

test('AC2.4: with the module disabled, GET /api/subscriptions/history 404s and no history is served', async () => {
  // A run-log entry may already exist on disk (e.g. from before the module
  // was disabled) -- the ROUTE itself must still be entirely unreachable.
  runlog.recordRun(tmpDir, runEntry({ id: 'should-never-be-served' }));

  const disabledConfig = ytdlp.parseYtdlpConfig({});
  const server = await startTestApp(makeFakeDeps(tmpDir), disabledConfig);
  try {
    const res = await fetch(`${server.base}/api/subscriptions/history`);
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

// ---- R4.3: the reader cap is respected, even against a manually-inflated --
// ---- on-disk file -----------------------------------------------------------

test('R4.3: the route never returns more than YTDLP_RUNLOG_MAX_ENTRIES entries, even when the log file is manually inflated beyond the cap', async () => {
  const runlogPath = path.join(tmpDir, 'ytdlp-runs.jsonl');
  const inflatedCount = runlog.YTDLP_RUNLOG_MAX_ENTRIES + 25;
  const lines = [];
  for (let i = 0; i < inflatedCount; i += 1) {
    lines.push(JSON.stringify(runEntry({ id: `inflated-${i}`, ts: new Date(2020, 0, 1, 0, 0, i).toISOString() })));
  }
  fs.writeFileSync(runlogPath, lines.join('\n') + '\n', 'utf8');

  const server = await startTestApp(makeFakeDeps(tmpDir), enabledConfig());
  try {
    const res = await fetch(`${server.base}/api/subscriptions/history`);
    const body = await res.json();
    assert.equal(body.entries.length, runlog.YTDLP_RUNLOG_MAX_ENTRIES, 'must never exceed the cap even against an inflated file');
    // Newest-first: the LAST-written line (`inflated-<inflatedCount - 1>`) must be first.
    assert.equal(body.entries[0].id, `inflated-${inflatedCount - 1}`);
  } finally {
    await server.close();
  }
});

// ---- Optional bounded ?limit= query ----------------------------------------

test('an optional ?limit= query returns fewer, still newest-first, entries', async () => {
  for (let i = 0; i < 10; i += 1) {
    runlog.recordRun(tmpDir, runEntry({ id: `limit-${i}`, ts: new Date(2026, 0, 1, 0, 0, i).toISOString() }));
  }

  const server = await startTestApp(makeFakeDeps(tmpDir), enabledConfig());
  try {
    const res = await fetch(`${server.base}/api/subscriptions/history?limit=3`);
    const body = await res.json();
    assert.deepEqual(body.entries.map((e) => e.id), ['limit-9', 'limit-8', 'limit-7']);
  } finally {
    await server.close();
  }
});

test('a non-numeric/invalid ?limit= falls back to the full cap rather than throwing', async () => {
  runlog.recordRun(tmpDir, runEntry({ id: 'invalid-limit-run' }));

  const server = await startTestApp(makeFakeDeps(tmpDir), enabledConfig());
  try {
    const res = await fetch(`${server.base}/api/subscriptions/history?limit=not-a-number`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.entries.map((e) => e.id), ['invalid-limit-run']);
  } finally {
    await server.close();
  }
});

// ---- Degrade, never crash (RELIABILITY.md) ---------------------------------

test('a missing deps.dataDir degrades to { entries: [] } instead of throwing', async () => {
  const deps = makeFakeDeps(undefined);
  const server = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${server.base}/api/subscriptions/history`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { entries: [] });
  } finally {
    await server.close();
  }
});
