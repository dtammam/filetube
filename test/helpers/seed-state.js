'use strict';

// Test seeding across the two data models (relational-migration arc, Wave 2).
//
// Until the arc finishes, a test's "state" fixture may carry BOTH doc-model
// namespaces (folders/metadata/liked/settings/...) and namespaces that have
// already become relational tables (viewCounts in Wave 1; progress and
// deleteTombstones in Wave 2). The doc-model save-lock REFUSES the relational
// keys (that refusal is the arc's net), so this helper is the one seam that
// splits a legacy-shaped fixture: relational keys go through their stores -
// the SAME API the routes use - and the rest goes through saveDatabase.
//
// Lazy `require('../../server')`: every test sets DATA_DIR before requiring
// the server, and this helper must never be the first to require it.

const RELATIONAL = {
  viewCounts: (s) => s.viewCountStore,
  progress: (s) => s.progressStore,
  deleteTombstones: (s) => s.tombstoneStore,
  trash: (s) => s.trashStore, // Wave 3
};
// Wave 4: the config singletons - same rule as above (replaced only when the
// fixture carries the key). A whole-state fixture that omits one relies on
// the suite's __resetDatabaseForTests() (which wipes every table) for the
// "absent = defaults" the whole-document save used to give; an object
// derived from loadDatabase() (which no longer carries these keys) must NOT
// wipe them on re-seed.
const DOC_SEMANTICS = {
  settings: (s) => s.settingsStore,
  folders: (s) => s.folderStore,
  folderSettings: (s) => s.folderSettingsStore,
  folderDisplayNames: (s) => s.folderDisplayNameStore,
  liked: (s) => s.likedStore,
};

function server() {
  return require('../../server');
}

// Seed a fixture: relational keys replace their tables wholesale (a fixture
// describes the whole state, exactly as saveDatabase does for the doc keys),
// the doc keys are saved as before. Returns the doc part that was saved.
function seedState(state) {
  const s = server();
  const doc = {};
  for (const key of Object.keys(state)) {
    if (RELATIONAL[key] || DOC_SEMANTICS[key]) continue;
    doc[key] = state[key];
  }
  s.saveDatabase(doc);
  for (const key of Object.keys(RELATIONAL)) {
    if (state[key] !== undefined) RELATIONAL[key](s).replaceAll(state[key]);
  }
  for (const key of Object.keys(DOC_SEMANTICS)) {
    if (state[key] !== undefined) DOC_SEMANTICS[key](s).replaceAll(state[key]);
  }
  return doc;
}

module.exports = {
  seedState,
  progressStore: () => server().progressStore,
  tombstoneStore: () => server().tombstoneStore,
  viewCountStore: () => server().viewCountStore,
  trashStore: () => server().trashStore, // Wave 3
  settingsStore: () => server().settingsStore, // Wave 4
  folderStore: () => server().folderStore, // Wave 4
  folderSettingsStore: () => server().folderSettingsStore, // Wave 4
  folderDisplayNameStore: () => server().folderDisplayNameStore, // Wave 4
  likedStore: () => server().likedStore, // Wave 4
};
