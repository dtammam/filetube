'use strict';

// [INTEGRATION][MOVES USER FILES -- but this file DRIVES the DRY RUN] v1.41.7
// (Dean has NO media backup) -- the "Preview changes" DRY-RUN plan.
//
// WHY THIS EXISTS: Dean cannot back up his media, so before he runs the reheat's
// bulk, irreversible relocation he needs to SEE exactly what it will do. The
// preview computes the full move/skip plan from EXISTING db state only. This
// suite locks the three properties that make it trustworthy:
//   1. it MOVES nothing, WRITES nothing, and SPAWNS nothing -- db.json is
//      byte-identical after a preview, and no child process is ever created;
//   2. it CANNOT DRIFT from the executor -- the SAME fixtures driven through
//      BOTH `planImportRelocation` (the shared decision the preview uses) and
//      `relocateHydratedImportIntoChannelFolder` (the executor) agree on every
//      move/skip outcome (THE most important test here);
//   3. the hardlink-vs-copy classification is correct for same-device and
//      cross-device (the latter simulated by stubbing `statSync().dev`).
//
// Mirrors test/integration/repull-relocate.test.js's isolation pattern.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-reloc-preview-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
const DATA_DIR = process.env.DATA_DIR;
const DB_FILE = path.join(DATA_DIR, 'db.json');
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

const cp = require('child_process');
cp.exec = function mockExec(cmd, cb) {
  if (cmd === 'ffmpeg -version') { cb(null, 'ffmpeg version mock 1.0', ''); return; }
  cb(new Error(`unexpected exec() call in test mock: ${cmd}`));
};

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  getMediaId, loadDatabase, saveDatabase, updateDatabase,
  planImportRelocation, buildImportRelocationPreview, classifyMetadataEffect,
  relocateHydratedImportIntoChannelFolder, enumerateRepullableItems,
  __getLoadDatabaseCallCount,
} = require('../../server');
const ytdlp = require('../../lib/ytdlp');

const VIDEO_ID = 'dQw4w9WgXcQ';
const CHANNEL = {
  channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
  channelHandleUrl: 'https://www.youtube.com/@RickAstley',
  channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
  channelName: 'Rick Astley',
};

function baseSettings(overrides) {
  return {
    scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0,
    defaultView: '', autoplayNext: false, relocateHydratedImports: true, ...overrides,
  };
}

const DEPS = { loadDatabase, updateDatabase, getMediaId };

let libraryDir;
let downloadDir;

beforeEach(() => {
  libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-relocp-lib-'));
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-relocp-dl-'));
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  fs.rmSync(libraryDir, { recursive: true, force: true });
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

// A hydrated MeTube import (in a plain library root, full identity + youtubeId),
// plus optional extra items and db/item overrides.
function seedDb({ item = {}, dbOverrides = {}, writeFile = true } = {}) {
  const fileName = item.fileName || 'Never Gonna Give You Up.mp4';
  const filePath = path.join(item.dir || libraryDir, fileName);
  if (writeFile) fs.writeFileSync(filePath, 'metube-video-bytes');
  const id = getMediaId(filePath);
  const record = {
    id, name: fileName, title: 'Never Gonna Give You Up', filePath,
    folderName: path.basename(item.dir || libraryDir), rootFolder: item.dir || libraryDir,
    size: writeFile ? fs.statSync(filePath).size : 0, ext: path.extname(fileName), type: 'video',
    addedAt: Date.now(), duration: 213, hasThumbnail: false, artist: '',
    sourceTitle: 'Never Gonna Give You Up', youtubeId: VIDEO_ID, metadataRepulledAt: 1_800_000_000_000,
    ...CHANNEL, ...(item.record || {}),
  };
  saveDatabase({
    folders: [libraryDir], folderSettings: {}, progress: {},
    metadata: { [id]: record }, liked: [], deleteTombstones: {},
    settings: baseSettings(dbOverrides.settings), ...dbOverrides,
  });
  return { filePath, id };
}

// ---- 1. NO write, NO spawn, db.json byte-identical -------------------------

test('a preview MOVES nothing, WRITES nothing, and SPAWNS nothing -- db.json is byte-identical afterward', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath } = seedDb();

  const before = fs.readFileSync(DB_FILE); // raw bytes

  // Spy every child_process spawn primitive -- a preview must create NO process.
  const spawnCalls = { n: 0 };
  const origSpawn = cp.spawn;
  const origSpawnSync = cp.spawnSync;
  const origExecFile = cp.execFile;
  cp.spawn = (...a) => { spawnCalls.n += 1; return origSpawn(...a); };
  cp.spawnSync = (...a) => { spawnCalls.n += 1; return origSpawnSync(...a); };
  cp.execFile = (...a) => { spawnCalls.n += 1; return origExecFile(...a); };
  try {
    const preview = buildImportRelocationPreview(DEPS, config);
    assert.equal(preview.summary.moveCount, 1, 'the hydrated import should be planned as a move');
    assert.equal(preview.moves[0].destinationPath !== undefined, true);
  } finally {
    cp.spawn = origSpawn;
    cp.spawnSync = origSpawnSync;
    cp.execFile = origExecFile;
  }

  assert.equal(spawnCalls.n, 0, 'a preview must never spawn a child process');
  assert.ok(fs.existsSync(filePath), 'the source file must be untouched');
  assert.deepEqual(fs.readFileSync(DB_FILE), before, 'db.json must be byte-identical after a preview (no write of any kind)');
});

// ---- 2. ANTI-DRIFT: preview decision == executor behavior ------------------
//
// THE most important test. Drive the same fixtures through BOTH the shared
// decision the preview renders (`planImportRelocation`) AND the real executor
// (`relocateHydratedImportIntoChannelFolder`), and assert they agree on every
// move/skip outcome. A preview that disagrees with the executor is worse than no
// preview at all.

const CHANNEL_DIR = () => path.join(downloadDir, 'Rick Astley');

async function assertPlanMatchesExecutor(config, id, { expect, expectReason }) {
  // ANTI-DRIFT on the METADATA dimension too: the preview's metadataEffect comes
  // from `classifyMetadataEffect`, and the batch gates its metadata pass on
  // `enumerateRepullableItems`' `alreadyRepulled` -- the SAME `!!metadataRepulledAt`
  // predicate. Assert they agree for this item BEFORE anything moves (a move
  // re-keys the id).
  const db = loadDatabase();
  const enumMap = new Map(enumerateRepullableItems(db, config).items.map((it) => [it.mediaId, it]));
  const metaEffect = classifyMetadataEffect(db.metadata[id]);
  const enumEntry = enumMap.get(id);
  if (enumEntry) {
    assert.equal(
      metaEffect === 'up-to-date', enumEntry.alreadyRepulled === true,
      "the preview's metadata effect must agree with the batch's alreadyRepulled gate (no drift)"
    );
  }

  // Read the shared decision (what the preview renders) BEFORE executing.
  const plan = planImportRelocation(DEPS, config, id);
  // The plan carries metadataEffect for every per-item decision; the GLOBAL
  // gates (module-disabled / no-download-root / setting-off) return before
  // reading the item, and the preview resolves those via the SAME
  // classifyMetadataEffect fallback -- so assert equality only when the plan
  // exposed it.
  if (plan.metadataEffect !== undefined) {
    assert.equal(plan.metadataEffect, metaEffect, 'plan.metadataEffect must equal classifyMetadataEffect(item)');
  }
  // Then run the real executor (which mutates only on an actual move).
  const exec = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);

  if (expect === 'move') {
    assert.equal(plan.action, 'move', 'plan must classify this as a MOVE');
    assert.equal(exec.status, 'moved', 'executor must actually MOVE it');
  } else if (expect === 'failed') {
    assert.equal(plan.status, 'failed', 'plan must flag a hard failure');
    assert.equal(exec.status, 'failed', 'executor must FAIL it');
  } else {
    assert.equal(plan.action, 'skip', 'plan must classify this as a SKIP');
    assert.equal(exec.status, 'skipped', 'executor must SKIP it');
    if (expectReason) {
      assert.equal(plan.reason, expectReason, 'plan reason must match the expected skip reason');
      assert.equal(exec.reason, expectReason, 'executor reason must match the plan reason (no drift)');
    }
  }
}

test('anti-drift: a clean hydrated import -- plan says MOVE, executor MOVES', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id } = seedDb();
  await assertPlanMatchesExecutor(config, id, { expect: 'move' });
});

test('anti-drift: genuine local media (no channel identity) -- plan SKIPS no-youtube-identity, executor SKIPS the same', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id } = seedDb({ item: { record: { channelUrl: undefined, channelName: undefined, youtubeId: undefined } } });
  await assertPlanMatchesExecutor(config, id, { expect: 'skip', expectReason: 'no-youtube-identity' });
});

test('anti-drift: the relocation setting OFF -- plan SKIPS setting-off, executor SKIPS the same', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id } = seedDb({ dbOverrides: { settings: { relocateHydratedImports: false } } });
  await assertPlanMatchesExecutor(config, id, { expect: 'skip', expectReason: 'setting-off' });
});

test('anti-drift: an item already IN a download root -- plan SKIPS already-in-download-root, executor SKIPS the same', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id } = seedDb({ item: { dir: downloadDir } });
  await assertPlanMatchesExecutor(config, id, { expect: 'skip', expectReason: 'already-in-download-root' });
});

test('anti-drift: destination already occupied -- plan SKIPS destination-occupied, executor SKIPS the same', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id } = seedDb();
  // Pre-create the exact native-named file in the channel folder.
  fs.mkdirSync(CHANNEL_DIR(), { recursive: true });
  fs.writeFileSync(path.join(CHANNEL_DIR(), `Never Gonna Give You Up [${VIDEO_ID}].mp4`), 'already-here');
  await assertPlanMatchesExecutor(config, id, { expect: 'skip', expectReason: 'destination-occupied' });
});

// ---- 3. hardlink vs copy classification ------------------------------------

test('classification: same-filesystem source+destination classify as a HARD LINK (no bytes copied)', () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id } = seedDb(); // libraryDir + downloadDir are both under os.tmpdir() -> same device
  const plan = planImportRelocation(DEPS, config, id);
  assert.equal(plan.action, 'move');
  assert.equal(plan.transfer, 'hardlink', 'same-device move must be classified hardlink');
  assert.equal(plan.sameDevice, true);
});

test('classification: cross-filesystem source vs destination classify as a COPY (simulated via a stubbed statSync dev)', () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id, filePath } = seedDb();

  // A deps.fs whose statSync reports a DIFFERENT device for the source file (on
  // the "NAS") than for the destination tree (local). Everything else is real.
  const crossDevFs = Object.assign({}, fs, {
    statSync(p, opts) {
      const real = fs.statSync(p, opts);
      const onNas = path.resolve(p) === path.resolve(filePath);
      return Object.assign(Object.create(Object.getPrototypeOf(real)), real, { dev: onNas ? 111 : 222 });
    },
  });

  const plan = planImportRelocation({ loadDatabase, updateDatabase, getMediaId, fs: crossDevFs }, config, id);
  assert.equal(plan.action, 'move');
  assert.equal(plan.transfer, 'copy', 'differing device ids must be classified as a cross-filesystem COPY');
  assert.equal(plan.sameDevice, false);
  assert.equal(plan.sizeBytes, fs.statSync(filePath).size, 'the plan must report the source size for the copy-bytes total');
});

// ---- 4. the whole-library preview shape ------------------------------------

test('the preview groups moves and skips and rolls up the summary counts', () => {
  const config = ytdlp.parseYtdlpConfig();
  // One movable import + one genuine local file, in one db.
  const movable = path.join(libraryDir, 'Never Gonna Give You Up.mp4');
  fs.writeFileSync(movable, 'metube-video-bytes');
  const movableId = getMediaId(movable);
  const localFile = path.join(libraryDir, 'Home Video.mp4');
  fs.writeFileSync(localFile, 'home-bytes');
  const localId = getMediaId(localFile);

  saveDatabase({
    folders: [libraryDir], folderSettings: {}, progress: {},
    metadata: {
      [movableId]: {
        id: movableId, name: 'Never Gonna Give You Up.mp4', title: 'Never Gonna Give You Up',
        filePath: movable, folderName: path.basename(libraryDir), rootFolder: libraryDir,
        size: fs.statSync(movable).size, ext: '.mp4', type: 'video', addedAt: Date.now(),
        duration: 213, hasThumbnail: false, artist: '', sourceTitle: 'Never Gonna Give You Up',
        youtubeId: VIDEO_ID, metadataRepulledAt: 1_800_000_000_000, ...CHANNEL,
      },
      [localId]: {
        id: localId, name: 'Home Video.mp4', title: 'Home Video', filePath: localFile,
        folderName: path.basename(libraryDir), rootFolder: libraryDir, size: fs.statSync(localFile).size,
        ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 30, hasThumbnail: false, artist: '',
      },
    },
    liked: [], deleteTombstones: {}, settings: baseSettings(),
  });

  const preview = buildImportRelocationPreview(DEPS, config);
  assert.equal(preview.summary.totalItems, 2);
  assert.equal(preview.summary.moveCount, 1);
  assert.equal(preview.summary.skipCount, 1);
  assert.equal(preview.moves.length, 1);
  assert.equal(preview.moves[0].mediaId, movableId);
  assert.equal(preview.moves[0].category, 'move-hardlink', 'same-fs move rows carry the hardlink category');
  assert.equal(preview.moves[0].metadataEffect, 'up-to-date', 'an already-reheated import will not have its metadata refreshed again');
  assert.equal(preview.skips.length, 1);
  assert.equal(preview.skips[0].mediaId, localId);
  assert.equal(preview.skips[0].reason, 'no-youtube-identity', 'a home video with no YouTube identity is honest local media');
  assert.equal(preview.skips[0].category, 'untouched', 'genuine local media is the "untouched" category');
  assert.equal(preview.summary.untouchedCount, 1);
});

// ---- 5. the metadata dimension: category 3 (metadata-only, file untouched) --

test('category 3: an already-in-root but NOT-yet-reheated item is reported metadata-only (file stays put, metadata may refresh) -- and the executor does NOT move its file', async () => {
  const config = ytdlp.parseYtdlpConfig();
  // A native download: full identity, already under the download root, but no
  // reheat marker yet -> the batch would run a metadata pass but NOT relocate it.
  const { id, filePath } = seedDb({ item: { dir: downloadDir, record: { metadataRepulledAt: undefined } } });

  const preview = buildImportRelocationPreview(DEPS, config);
  assert.equal(preview.summary.moveCount, 0, 'nothing moves');
  assert.equal(preview.summary.metadataOnlyCount, 1);
  const row = preview.skips[0];
  assert.equal(row.category, 'metadata-only', 'a hydratable file that stays put is category 3');
  assert.equal(row.reason, 'already-in-download-root');
  assert.equal(row.metadataEffect, 'may-refresh', 'no reheat marker -> its metadata may be refreshed');

  // And the executor genuinely leaves the FILE where it is.
  const exec = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(exec.status, 'skipped');
  assert.equal(exec.reason, 'already-in-download-root');
  assert.ok(fs.existsSync(filePath), 'the file must NOT be moved for a category-3 item');
});

test('metadata anti-drift: metadataEffect up-to-date iff enumerateRepullableItems marks the item alreadyRepulled', () => {
  const config = ytdlp.parseYtdlpConfig();
  const hydrated = seedDb({ item: { fileName: 'Hydrated.mp4', record: { metadataRepulledAt: 1_800_000_000_000 } } });
  // A second, un-reheated item in the same db.
  const fresh = path.join(libraryDir, 'Fresh.mp4');
  fs.writeFileSync(fresh, 'x');
  const freshId = getMediaId(fresh);
  const db = loadDatabase();
  db.metadata[freshId] = {
    id: freshId, name: 'Fresh.mp4', title: 'Fresh', filePath: fresh, folderName: path.basename(libraryDir),
    rootFolder: libraryDir, size: 1, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 1,
    hasThumbnail: false, artist: '', youtubeId: VIDEO_ID, ...CHANNEL,
  };
  saveDatabase(db);

  const enumMap = new Map(enumerateRepullableItems(loadDatabase(), config).items.map((it) => [it.mediaId, it]));
  for (const mediaId of [hydrated.id, freshId]) {
    const effect = classifyMetadataEffect(loadDatabase().metadata[mediaId]);
    const entry = enumMap.get(mediaId);
    assert.ok(entry, 'the item must be enumerated');
    assert.equal(effect === 'up-to-date', entry.alreadyRepulled === true, 'metadataEffect must track alreadyRepulled exactly');
  }
});

test('the preview labels an un-hydrated (id but no channel) item as would-hydrate-first', () => {
  const config = ytdlp.parseYtdlpConfig();
  // Has a valid youtubeId but NO channel identity yet -- a reheat would hydrate
  // it first, so its destination is unknown until then.
  seedDb({ item: { record: { channelUrl: undefined, channelName: undefined, channelId: undefined, channelHandleUrl: undefined } } });
  const preview = buildImportRelocationPreview(DEPS, config);
  assert.equal(preview.summary.moveCount, 0);
  assert.equal(preview.skips.length, 1);
  assert.equal(preview.skips[0].reason, 'would-hydrate-first');
  assert.equal(preview.skips[0].category, 'would-hydrate-first');
  assert.equal(preview.summary.wouldHydrateCount, 1);
});

// ---- 6. PERF: the preview loads the db O(1) times, not O(N) ----------------
//
// v1.41.7 gate fix (QA WARNING 1 -- the blocker): `planImportRelocation` used to
// call `loadDatabase()` (readFileSync + full JSON.parse) once PER ITEM, freezing
// the whole (synchronous) server for ~11 s on a 2000-item library. The fix
// threads the already-loaded snapshot in. This locks it: N items -> exactly ONE
// load, not N.

test('PERF: buildImportRelocationPreview loads the database ONCE regardless of item count (no per-item re-parse)', () => {
  const config = ytdlp.parseYtdlpConfig();
  // Seed a library of N movable imports in one db.
  const N = 25;
  const metadata = {};
  for (let i = 0; i < N; i++) {
    const fp = path.join(libraryDir, `Video ${i}.mp4`);
    fs.writeFileSync(fp, `bytes-${i}`);
    const id = getMediaId(fp);
    metadata[id] = {
      id, name: `Video ${i}.mp4`, title: `Video ${i}`, filePath: fp,
      folderName: path.basename(libraryDir), rootFolder: libraryDir, size: fs.statSync(fp).size,
      ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 1, hasThumbnail: false, artist: '',
      sourceTitle: `Video ${i}`, youtubeId: VIDEO_ID, metadataRepulledAt: 1_800_000_000_000, ...CHANNEL,
    };
  }
  saveDatabase({
    folders: [libraryDir], folderSettings: {}, progress: {},
    metadata, liked: [], deleteTombstones: {}, settings: baseSettings(),
  });

  const before = __getLoadDatabaseCallCount();
  const preview = buildImportRelocationPreview(DEPS, config);
  const after = __getLoadDatabaseCallCount();

  assert.equal(preview.summary.totalItems, N, 'all N items are considered');
  assert.equal(after - before, 1, `the preview must load the db EXACTLY once for ${N} items (was O(N) before the fix)`);
});

// ---- 7. anti-drift, TABLE-DRIVEN over the skip reasons ---------------------
//
// v1.41.7 gate SUGGESTION (adversarial): drift is structurally impossible (one
// shared decision), but a future edit to the executor's status/reason mapping in
// one branch wouldn't be caught by only the happy-path reasons. Table-drive it.

const SKIP_REASON_CASES = [
  {
    name: 'file-missing',
    seed: () => seedDb({ writeFile: false }),
    expect: 'skip', expectReason: 'file-missing',
  },
  {
    name: 'id-not-bracket-shaped',
    seed: () => seedDb({ item: { record: { youtubeId: 'shortid' } } }),
    expect: 'skip', expectReason: 'id-not-bracket-shaped',
  },
  {
    name: 'transcode-or-audio-job-in-flight',
    seed: () => seedDb({ item: { record: { transcodeStatus: 'processing' } } }),
    expect: 'skip', expectReason: 'transcode-or-audio-job-in-flight',
  },
  {
    name: 'ambiguous-subscription',
    seed: () => seedDb({ dbOverrides: { ytdlp: { subscriptions: [{ id: 's1', name: 'x', channelUrl: 'https://www.youtube.com/c/SomeParallelName' }] } } }),
    expect: 'skip', expectReason: 'ambiguous-subscription',
  },
];

for (const tc of SKIP_REASON_CASES) {
  test(`anti-drift (table): ${tc.name} -- plan and executor agree`, async () => {
    const config = ytdlp.parseYtdlpConfig();
    const { id } = tc.seed();
    await assertPlanMatchesExecutor(config, id, { expect: tc.expect, expectReason: tc.expectReason });
  });
}

// ---- 8. MUTATION TEST: the perf fix (db snapshot) did NOT change the decision -
//
// The whole risk of the O(1) fix is that threading a snapshot in could diverge
// from the executor's fresh read. Assert the decision is byte-identical whether
// the db is loaded fresh (executor style) or handed in as a snapshot (preview
// style) -- same logic, only the source differs.

test('MUTATION: planImportRelocation yields the IDENTICAL decision with a fresh load vs a threaded snapshot', () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id: moveId } = seedDb();
  const db = loadDatabase();

  const fresh = planImportRelocation(DEPS, config, moveId);            // executor style: loads fresh
  const snap = planImportRelocation(DEPS, config, moveId, db);         // preview style: uses the snapshot
  assert.deepEqual(snap, fresh, 'the snapshot path must produce the SAME decision as a fresh load (no drift)');
  assert.equal(fresh.action, 'move');

  // And for a skip decision too.
  const { id: skipId } = seedDb({ item: { dir: downloadDir } });
  const db2 = loadDatabase();
  assert.deepEqual(
    planImportRelocation(DEPS, config, skipId, db2),
    planImportRelocation(DEPS, config, skipId),
    'snapshot vs fresh must agree on skip decisions too'
  );
});
