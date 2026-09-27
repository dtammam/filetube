'use strict';

// [INTEGRATION] v1.339 gate r1 C1 (plan
// docs/exec-plans/active/2026-09-26-fouc-toctou-audit.md, `## Gate`): the
// T-S2 keep-guard in the scan's final mutator re-validates each prune
// candidate against the FRESH db. On 8919ba55 it kept ANY candidate that was
// live with its file on disk - so an item whose file the walk no longer
// indexes, but which still sits on disk, was never pruned again:
//
//   - a folder REMOVED in Settings (its files left on disk) - also the
//     escape hatch lib/scan/roots.js documents for a vanished-looking root;
//   - a yt-dlp download root that is no longer a scan root (the download
//     dir repointed) with the old dir's files still there;
//   - a file the walk's inclusion rule skips (a non-media extension, a
//     yt-dlp intermediate / in-flight temp name, a path inside the trash
//     directory, a symlink - the walk takes only regular-file dirents).
//
// Each prunes exactly as on the pre-S3 base (cbb6ef8d): metadata, per-user
// progress and Like, view count, frozen pre-auth position, thumbnail. The
// fix keeps a candidate only when a walk of the roots this scan WALKED would
// have indexed its file (`walkWouldInclude`, sharing the walker's own
// predicates). The restored-mid-walk keep (T-S2) is bound in
// scan-prune-toctou.test.js and scan-restore-toctou.test.js.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scanprune-scope-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, loadDatabase, scanDirectories, scanState,
  userStore, viewCountStore, progressStore, __resetDatabaseForTests,
} = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
const ISO = '2026-09-27T12:00:00.000Z';
const SETTINGS = { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0, trashRetentionDays: 30 };

let server, base, uid;

async function idle() {
  const start = Date.now();
  while ((scanState.scanning || scanState.rescanRequested) && Date.now() - start < 15000) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  uid = authenticateFetch(server, base).user.id;
});

after(async () => {
  await idle();
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  await idle();
  await __resetDatabaseForTests();
});

afterEach(async () => {
  await idle();
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
});

function entry(root, filePath) {
  const st = fs.lstatSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  return {
    id: getMediaId(filePath), name: path.basename(filePath), title: path.basename(filePath, ext), filePath,
    folderName: 'Chan', rootFolder: root, size: st.size, mtime: st.mtime.toISOString(),
    ext, type: 'video', addedAt: Date.now(), duration: 60,
  };
}

function seedUserState(id, seconds) {
  userStore.setProgress(uid, id, { timestamp: seconds, duration: 60, updatedAt: ISO });
  userStore.addLiked(uid, id, ISO);
  viewCountStore.set(id, 7);
  progressStore.set(id, { timestamp: seconds, duration: 60 });
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${id}.jpg`), `thumb-${id}`);
}

function assertPruned(id, label) {
  assert.equal(loadDatabase().metadata[id], undefined, `${label}: the metadata entry is pruned`);
  assert.equal(userStore.getOneProgress(uid, id), null, `${label}: the per-user progress is pruned`);
  assert.ok(!userStore.getLiked(uid).includes(id), `${label}: the Like is pruned`);
  assert.equal(viewCountStore.get(id), 0, `${label}: the view count is pruned`);
  assert.equal(progressStore.get(id), null, `${label}: the frozen pre-auth position is pruned`);
  assert.equal(fs.existsSync(path.join(THUMBNAIL_DIR, `${id}.jpg`)), false, `${label}: the thumbnail is pruned`);
}

function assertKept(id, seconds, label) {
  assert.ok(loadDatabase().metadata[id], `${label}: the metadata entry stays`);
  const p = userStore.getOneProgress(uid, id);
  assert.ok(p && p.timestamp === seconds, `${label}: the per-user progress stays (got ${JSON.stringify(p)})`);
  assert.equal(viewCountStore.get(id), 7, `${label}: the view count stays`);
}

function mkLibrary(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `filetube-scope-${prefix}-`));
  const chan = path.join(root, 'Chan');
  fs.mkdirSync(chan, { recursive: true });
  const file = path.join(chan, `${prefix}.mp4`);
  fs.writeFileSync(file, `${prefix}-bytes`);
  return { root, chan, file, id: getMediaId(file) };
}

test('C1: removing a configured folder whose files remain prunes its items and per-user state (the kept folder is untouched)', async () => {
  const A = mkLibrary('kept');
  const B = mkLibrary('removed');
  seedState({ folders: [A.root, B.root], folderSettings: {}, metadata: {}, settings: SETTINGS });
  await scanDirectories();
  await idle();
  assert.ok(loadDatabase().metadata[A.id], 'precondition: the kept folder indexed');
  assert.ok(loadDatabase().metadata[B.id], 'precondition: the folder-to-remove indexed');
  seedUserState(A.id, 30);
  seedUserState(B.id, 44);

  // The real Settings save: B leaves the folder list; its file stays on disk.
  const res = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folders: [A.root], folderSettings: {} }),
  });
  assert.equal(res.status, 200, 'precondition: the Settings save landed');
  await idle();
  await scanDirectories();
  await idle();

  assert.ok(fs.existsSync(B.file), 'precondition: the removed folder\'s file is still on disk');
  assertPruned(B.id, 'THE finding (removed folder)');
  assertKept(A.id, 30, 'the kept folder');
  assert.equal(fs.readFileSync(B.file, 'utf8'), 'removed-bytes', 'a prune never touches the file itself');
});

test('C1: the roots.js escape hatch - a vanished-looking root removed from Settings prunes on the next scan', async () => {
  // A seeded (not walked) removed-folder entry, as roots.js describes it: the
  // entry still carries `rootFolder`, the root is no longer configured.
  const A = mkLibrary('hatch-kept');
  const B = mkLibrary('hatch-removed');
  seedState({
    folders: [A.root], folderSettings: {},
    metadata: { [A.id]: entry(A.root, A.file), [B.id]: entry(B.root, B.file) },
    settings: SETTINGS,
  });
  seedUserState(B.id, 12);
  await scanDirectories();
  assertPruned(B.id, 'escape hatch');
  assert.ok(loadDatabase().metadata[A.id], 'the configured folder\'s item stays');
});

test('C1: a download root no longer scanned (download dir repointed) prunes the old dir\'s items even though the files remain', async () => {
  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scope-dl-old-'));
  const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scope-dl-new-'));
  const A = mkLibrary('dl-bystander');
  const file = path.join(oldDir, 'episode [abcdefghijk].mp4');
  fs.writeFileSync(file, 'episode-bytes');
  const id = getMediaId(file);
  seedState({ folders: [A.root], folderSettings: {}, metadata: {}, settings: SETTINGS });
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = oldDir;
  await scanDirectories();
  assert.ok(loadDatabase().metadata[id], 'precondition: the download root\'s file is indexed');
  assert.equal(loadDatabase().metadata[id].rootFolder, path.resolve(oldDir), 'precondition: attributed to the download root');
  seedUserState(id, 21);

  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = newDir; // the old dir is no longer a scan root
  await scanDirectories();

  assert.ok(fs.existsSync(file), 'precondition: the old download dir\'s file is still on disk');
  assertPruned(id, 'THE finding (repointed download root)');
  assert.ok(loadDatabase().metadata[A.id], 'the configured folder\'s item stays');
});

// Every case below: the root IS walked and the file IS on disk (a regular
// file unless the case says otherwise); ONLY the walk's inclusion rule
// refuses it, so each isolates one predicate of `walkWouldInclude`. A
// bystander file keeps the root from looking vanished.
const EXCLUDED = [
  ['a non-media extension', (chan) => { const f = path.join(chan, 'notes.txt'); fs.writeFileSync(f, 'n'); return f; }],
  ['a yt-dlp intermediate name', (chan) => { const f = path.join(chan, 'clip [abcdefghijk].f399.mp4'); fs.writeFileSync(f, 'n'); return f; }],
  ['an in-flight faststart temp name', (chan) => { const f = path.join(chan, 'clip.mp4.faststart.tmp.mp4'); fs.writeFileSync(f, 'n'); return f; }],
  ['a path inside the trash directory', (chan, root) => {
    const dir = path.join(root, '.filetube-trash', 'x');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'trashed.mp4');
    fs.writeFileSync(f, 'n');
    return f;
  }],
  ['a symlink (the walk takes only regular-file dirents)', (chan, root) => {
    const target = path.join(root, 'target.bin');
    fs.writeFileSync(target, 'n');
    const f = path.join(chan, 'link.mp4');
    fs.symlinkSync(target, f);
    return f;
  }],
];

for (const [label, make] of EXCLUDED) {
  test(`C1: an indexed entry whose file the walk now skips (${label}) prunes even though the file is on disk`, async () => {
    const lib = mkLibrary('excl');
    const f = make(lib.chan, lib.root);
    const id = getMediaId(f);
    seedState({
      folders: [lib.root], folderSettings: {},
      metadata: { [lib.id]: entry(lib.root, lib.file), [id]: entry(lib.root, f) },
      settings: SETTINGS,
    });
    seedUserState(id, 9);
    await scanDirectories();
    assert.ok(fs.lstatSync(f), 'precondition: the skipped file is still on disk');
    assertPruned(id, `THE finding (${label})`);
    assert.ok(loadDatabase().metadata[lib.id], 'the bystander stays');
  });
}
