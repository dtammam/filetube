'use strict';

// [INTEGRATION] v1.42 T5 — instance backup/restore (AC6 + design review
// F5/F6). GET /api/admin/backup exports a schema-versioned JSON bundle of
// every persisted namespace + the custom logo bytes; POST /api/admin/restore
// wipe-and-replaces inside one transaction with full coherency (coalescers
// cleared, cache invalidated) and strict refuse-don't-drop validation.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-backup-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, saveDatabase, loadDatabase, pendingProgress, flushPendingProgress,
  scanDirectories,
  __resetDatabaseForTests,
  __getPersistedStateEpoch,
} = require('../../server');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await __resetDatabaseForTests();
  for (const f of ['custom-logo.bin', 'custom-logo-dark.bin']) {
    try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch { /* fine */ }
  }
});

// A 1x1 PNG — real magic bytes so the logo upload route's sniffer accepts it.
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082',
  'hex'
);

function fullState() {
  return {
    folders: ['/media/videos'],
    folderSettings: { '/media/videos': { name: 'Videos', hidden: false } },
    progress: { vid1: { timestamp: 42, duration: 100 } },
    metadata: { vid1: { id: 'vid1', name: 'clip.mp4', title: 'Clip', type: 'video', ext: '.mp4', filePath: '/media/videos/clip.mp4', duration: 100, folderName: 'Videos' } },
    liked: ['vid1'],
    deleteTombstones: { gone1: { filePath: '/media/videos/gone.mp4', deletedAt: 1752600000000 } },
    viewCounts: { vid1: 9 },
    settings: { defaultView: 'grid' },
    books: {
      folders: ['/media/books'],
      items: { bk1: { id: 'bk1', title: 'A Book', filePath: '/media/books/a.epub', format: 'epub' } },
      progress: { bk1: { locator: { kind: 'epub', cfi: 'x' }, percent: 40, updatedAt: 't' } },
      pins: [], settings: {}, audio: {},
    },
    ytdlp: {
      allowMembersOnly: false,
      subscriptions: [{ id: 'sub1', channelUrl: 'https://youtube.com/@x', name: 'X', paused: false }],
      downloadMeta: {}, pins: [], channelAvatars: {},
    },
  };
}

async function getBackup() {
  const res = await fetch(`${base}/api/admin/backup`);
  assert.equal(res.status, 200);
  return res.json();
}

async function postRestore(bundle) {
  return fetch(`${base}/api/admin/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundle),
  });
}

test('AC6: backup -> wipe -> restore -> deep-equal (every namespace round-trips, users reserved empty)', async () => {
  saveDatabase(fullState());
  const beforeState = loadDatabase();

  const bundle = await getBackup();
  assert.equal(bundle.schema, 'filetube-backup-v1');
  assert.ok(bundle.exportedAt && bundle.appVersion);
  assert.deepEqual(bundle.users, [], 'users section reserved from day one');
  assert.deepEqual(bundle.viewCounts, { vid1: 9 }, 'viewCounts is a first-class bundle namespace');

  await __resetDatabaseForTests(); // the wipe
  assert.deepEqual(readPersistedDatabase(DATA_DIR), {}, 'precondition: store empty');

  const res = await postRestore(bundle);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).restoredNamespaces.sort(), Object.keys(fullState()).sort());

  assert.deepEqual(loadDatabase(), beforeState, 'restored state deep-equals the pre-wipe load');
});

test('logo bytes round-trip: upload -> backup -> delete -> restore brings back bytes AND mime; absent variant unlinks stale bin (F6)', async () => {
  saveDatabase(fullState());
  // Upload a light logo through the real route (magic-byte sniffer included).
  const up = await fetch(`${base}/api/settings/logo`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: PNG_BYTES,
  });
  assert.equal(up.status, 200);
  // Plant a STALE dark variant directly (simulates an old dark logo the
  // bundle being restored does not carry).
  fs.writeFileSync(path.join(DATA_DIR, 'custom-logo-dark.bin'), Buffer.from('stale-dark'));

  const bundle = await getBackup();
  assert.equal(bundle.customLogo.light.mime, 'image/png');
  assert.equal(Buffer.from(bundle.customLogo.light.b64, 'base64').compare(PNG_BYTES), 0, 'exact bytes exported');
  assert.equal(bundle.customLogo.dark, undefined, 'no dark mime key -> no dark export');

  // Delete the logo, then restore the bundle.
  await fetch(`${base}/api/settings/logo`, { method: 'DELETE' });
  assert.equal((await fetch(`${base}/logo`)).status, 404, 'precondition: logo gone');

  const res = await postRestore(bundle);
  assert.equal(res.status, 200);

  const served = await fetch(`${base}/logo`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type').split(';')[0], 'image/png');
  assert.equal(Buffer.from(await served.arrayBuffer()).compare(PNG_BYTES), 0, 'restored bytes serve byte-identical');
  assert.ok(!fs.existsSync(path.join(DATA_DIR, 'custom-logo-dark.bin')), 'stale dark bin unlinked by the restore');
});

test('F5 coherency: a progress ping staged BEFORE the restore never lands after it, and a zero-write read serves restored data', async () => {
  saveDatabase(fullState());
  // Stage (do not flush) a ping.
  const ping = await fetch(`${base}/api/progress`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'vid1', timestamp: 77, duration: 100 }),
  });
  assert.equal(ping.status, 200);
  assert.ok(pendingProgress.has('vid1'), 'precondition: ping staged');

  const bundle = await getBackup();
  const res = await postRestore(bundle);
  assert.equal(res.status, 200);
  assert.ok(!pendingProgress.has('vid1'), 'the restore cleared the staged ping');

  // Zero intervening writes: the very next read serves restored data.
  const read = await fetch(`${base}/api/progress/vid1`);
  assert.equal((await read.json()).timestamp, 42, 'restored position, not the stale ping');

  // Even an explicit flush now must not land the pre-restore ping.
  await flushPendingProgress();
  assert.equal(loadDatabase().progress.vid1.timestamp, 42, 'the pre-restore ping never lands');
});

test('validation refuses: wrong schema, unknown bundle key, non-empty users, oversized/invalid logo', async () => {
  saveDatabase(fullState());
  const good = await getBackup();

  assert.equal((await postRestore({ ...good, schema: 'filetube-backup-v99' })).status, 400);
  assert.equal((await postRestore({ ...good, mysteryKey: 1 })).status, 400);
  const withUsers = { ...good, users: [{ username: 'admin' }] };
  const resUsers = await postRestore(withUsers);
  assert.equal(resUsers.status, 400);
  assert.match((await resUsers.json()).error, /users arrive in v1.43/, 'a v1.43 bundle is refused loudly, never lossily');
  assert.equal((await postRestore({ ...good, customLogo: { light: { mime: 'image/svg+xml', b64: 'AA==' } } })).status, 400, 'mime outside the allowlist refused');
  assert.equal((await postRestore({ ...good, customLogo: { blue: { mime: 'image/png', b64: 'AA==' } } })).status, 400, 'unknown variant refused');
  const spoofed = await postRestore({ ...good, customLogo: { light: { mime: 'image/png', b64: Buffer.from('<svg>not a png</svg>').toString('base64') } } });
  assert.equal(spoofed.status, 400, 'a false mime claim over non-matching bytes is refused (magic-byte sniff, same bar as the upload route)');
  assert.match((await spoofed.json()).error, /magic-byte/);

  // Nothing above may have modified state.
  assert.deepEqual(readPersistedDatabase(DATA_DIR).folders, ['/media/videos'], 'state untouched by refused restores');
  assert.deepEqual(readPersistedDatabase(DATA_DIR).metadata.vid1.title, 'Clip', 'metadata untouched by refused restores');
});

test('W4: a wipe/restore landing MID-SCAN aborts the scan\'s stale merge — the replaced state survives', async () => {
  // The race the design-delta gate flagged: the scan's Phase-1 walk runs
  // OUTSIDE the write lock; if a restore wipes-and-replaces between the walk
  // and the final merge, mergeScannedMetadata (authoritative for membership)
  // would overwrite the restored library with the scan's pre-restore view.
  // The epoch guard makes the merge refuse instead. Ordering here is
  // DETERMINISTIC, not timing-based: the wipe is enqueued on the write chain
  // in the same tick scanDirectories starts its (await-laden) walk, so it
  // always commits before the scan's final mutator reaches the chain.
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-w4-lib-'));
  fs.writeFileSync(path.join(libDir, 'walker.mp4'), 'bytes-the-scan-would-index');
  saveDatabase({ ...fullState(), folders: [libDir] });

  const epochBefore = __getPersistedStateEpoch();
  const scanPromise = scanDirectories();     // Phase-1 walk starts (async)
  await __resetDatabaseForTests();           // the wipe — enqueued FIRST on the chain
  await scanPromise;                         // scan's final merge must self-discard

  assert.equal(__getPersistedStateEpoch(), epochBefore + 1, 'the wipe bumped the epoch');
  assert.deepEqual(readPersistedDatabase(DATA_DIR), {},
    'the scan\'s stale merge was DISCARDED — it did not resurrect pre-wipe state or index the walked file over the wipe');
  fs.rmSync(libDir, { recursive: true, force: true });
});

test('a restore that fails mid-populate ROLLS BACK completely (prior state intact, 500 surfaces)', async () => {
  saveDatabase(fullState());
  const beforeSnap = readPersistedDatabase(DATA_DIR);

  const bundle = await getBackup();
  bundle.books = 'not-an-object'; // importParsedJson throws inside the exclusive section
  const res = await postRestore(bundle);
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /rolled back/);

  assert.deepEqual(readPersistedDatabase(DATA_DIR), beforeSnap, 'wipe + partial populate fully rolled back');
});
