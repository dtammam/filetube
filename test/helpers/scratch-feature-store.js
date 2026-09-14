'use strict';

// Wave 5 of the relational-migration arc: the content modules read and write
// their namespaces through a FEATURE STORE handed in as a dep (`deps.tvDb`,
// `deps.ytdlpDb`, ...). A harness that used to fake the doc object
// (`loadDatabase: () => db`, `updateDatabase: (fn) => fn(db)`) hands the
// module a REAL store on a scratch SQLite database instead - the same code
// path production runs, minus server.js. Two shapes:
//   - scratchFeatureStore(FEATURE, ns): a fresh database per call (independent
//     stores in one test);
//   - sharedScratchStore(FEATURE): one database per test FILE, re-seeded by
//     `seed(ns)` (tests in a file run sequentially; ~100ms saved per call).
// Scratch directories are removed at process exit.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');

const dirs = [];
process.on('exit', () => {
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

function openScratchAdapter(prefix = 'ft-scratch-store-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
}

function scratchFeatureStore(FEATURE, ns) {
  const adapter = openScratchAdapter(`ft-${FEATURE.name}-store-`);
  const store = FEATURE.createStore(adapter);
  if (ns) store.replaceAll(ns);
  store.__adapter = adapter;
  return store;
}

function sharedScratchStore(FEATURE) {
  let store = null;
  return {
    seed(ns) {
      if (!store) store = scratchFeatureStore(FEATURE);
      store.replaceAll(ns || {});
      return store;
    },
    get store() { return store; },
  };
}

// A doc-shaped VIEW for the module helpers that read both db.metadata and the
// namespace through one object: the doc WITH the store's snapshot attached
// (in place - a harness that assigns `db.metadata = ...` after building its
// deps must keep hitting the same object, as the old fake did; the namespace
// key is a snapshot, so a harness that wants to seed it writes through the
// store: `deps.ytdlpDb.mutate(...)` / `replaceAll(...)`).
function docView(doc, store) {
  doc[store.name] = store.read();
  return doc;
}

// The one-line harness conversion: `featureStoreFor(FEATURE, db)` hands back a
// store seeded from the fixture's namespace key (`db.ytdlp` for ytdlp) - ONE
// scratch database per feature per process, re-seeded whenever a NEW fixture
// object shows up (a harness builds one per test; tests in a file run
// sequentially). The fixture keeps its key; the doc VIEW overrides it with the
// store's rows, so a read through `loadDatabase()` sees what the module wrote.
const sharedByFeature = new Map();
function featureStoreFor(FEATURE, db) {
  let entry = sharedByFeature.get(FEATURE.name);
  if (!entry) { entry = { store: scratchFeatureStore(FEATURE), current: null }; sharedByFeature.set(FEATURE.name, entry); }
  if (entry.current !== db) {
    entry.store.replaceAll((db && db[FEATURE.name]) || {});
    entry.current = db;
  }
  return entry.store;
}

module.exports = { openScratchAdapter, scratchFeatureStore, sharedScratchStore, docView, featureStoreFor };
