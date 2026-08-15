'use strict';

// [INTEGRATION] v1.127 Wave A - the security proof for BULK-route visibility.
// External review round 2's HIGH: /api/videos/attribute-channel-bulk gated
// capability (v1.81) but never VISIBILITY, so a capable-but-restricted member
// could preview counts for, rewrite, and physically RELOCATE media hidden from
// them. These tests bind the fix across all three restriction shapes the
// v1.126 gate round taught us to test TOGETHER (folder-kind, PATH-kind,
// allowlist mode - folder-kind-only passed while the PATH-kind bug was live),
// and prove filesystem NON-mutation for the hidden file while an admin run
// proves the move machinery itself is alive (no vacuous green). Deleting the
// `bulkItemVisible` filter in selectWork turns the preview counts red.
// Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-bulkvis-'));
const DATA_DIR = process.env.DATA_DIR;
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, saveDatabase, loadDatabase, updateDatabase, getMediaId, userStore, __mintTestSession,
} = require('../../server');
const store = require('../../lib/ytdlp/store');
const activity = require('../../lib/ytdlp/activity');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth;
let writerFolder, writerPath, writerAllow;
let mediaDir, publicDir, hiddenDir, downloadDir;
let pubFile, hidFile, pubId, hidId;

const TARGET = {
  channelUrl: 'https://www.youtube.com/channel/UCbulkvisibilityzzzzzzzz',
  channelName: 'Bulk Vïsibility Channel',
  channelId: 'UCbulkvisibilityzzzzzzzz',
};

function seedItem(filePath) {
  const stats = fs.statSync(filePath);
  return {
    id: getMediaId(filePath), name: path.basename(filePath),
    title: path.basename(filePath, path.extname(filePath)),
    filePath, folderName: path.basename(path.dirname(filePath)),
    rootFolder: mediaDir, size: stats.size, ext: path.extname(filePath),
    type: 'video', addedAt: stats.mtimeMs, duration: 10, hasThumbnail: false, artist: '',
  };
}

before(async () => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-bulkvis-media-'));
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-bulkvis-dl-'));
  publicDir = path.join(mediaDir, 'Family Clips');
  hiddenDir = path.join(mediaDir, 'Vault');
  fs.mkdirSync(publicDir); fs.mkdirSync(hiddenDir);
  pubFile = path.join(publicDir, 'Pübliç Clip.mp4');
  hidFile = path.join(hiddenDir, 'Hïdden Clip.mp4');
  fs.writeFileSync(pubFile, 'PUBLIC-BYTES');
  fs.writeFileSync(hidFile, 'HIDDEN-BYTES');

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin

  const pub = seedItem(pubFile);
  const hid = seedItem(hidFile);
  pubId = pub.id; hidId = hid.id;
  saveDatabase({
    folders: [mediaDir], folderSettings: {}, progress: {},
    metadata: { [pub.id]: pub, [hid.id]: hid },
    viewCounts: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });

  // Three capable-but-restricted members - all HAVE the write capability, all
  // are blocked from the Vault by a different restriction SHAPE.
  writerFolder = __mintTestSession({ username: 'wfolder', role: 'member' });
  userStore.setCanModifyLibrary(writerFolder.user.id, true);
  userStore.setRestrictions(writerFolder.user.id, [{ kind: 'folder', value: 'Vault' }]);
  writerPath = __mintTestSession({ username: 'wpath', role: 'member' });
  userStore.setCanModifyLibrary(writerPath.user.id, true);
  userStore.setRestrictions(writerPath.user.id, [{ kind: 'path', value: hiddenDir }]);
  writerAllow = __mintTestSession({ username: 'wallow', role: 'member' });
  userStore.setCanModifyLibrary(writerAllow.user.id, true);
  userStore.setRestrictions(writerAllow.user.id, [
    { kind: 'mode', value: 'allowlist' },
    { kind: 'path', value: publicDir },
  ]);
});
after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  for (const d of [DATA_DIR, mediaDir, downloadDir]) fs.rmSync(d, { recursive: true, force: true });
});

const bulk = (cookie, body) => fetch(`${base}/api/videos/attribute-channel-bulk`, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: JSON.stringify(body),
});

async function waitForMoverDone(maxWaitMs = 10000) {
  const start = Date.now();
  let entry = null;
  while (Date.now() - start < maxWaitMs) {
    entry = activity.getSnapshot().oneShots && activity.getSnapshot().oneShots['attribute-bulk'];
    if (entry && (entry.state === 'done' || entry.state === 'error')) return entry;
    await new Promise((r) => setTimeout(r, 50));
  }
  return entry;
}

test('preview: every restricted shape sees ONLY its visible item; admin sees both', async () => {
  const body = { root: mediaDir, target: TARGET, preview: true };
  const adminPv = await (await bulk(undefined, body)).json();
  assert.strictEqual(adminPv.matched, 2, 'admin preview counts both items');
  for (const [name, who] of [['folder-kind', writerFolder], ['path-kind', writerPath], ['allowlist', writerAllow]]) {
    const pv = await (await bulk(who.cookie, body)).json();
    assert.strictEqual(pv.matched, 1, `${name}: the hidden item is not counted (got ${pv.matched})`);
    assert.strictEqual(pv.resuming, 0, `${name}: nothing resumable leaks either`);
  }
});

test('execute (metadata-only): a path-restricted writer attributes ONLY the visible item', async () => {
  const run = await (await bulk(writerPath.cookie, { root: mediaDir, target: TARGET })).json();
  assert.strictEqual(run.attributed, 1, 'exactly the one visible item was attributed');
  const db = loadDatabase();
  assert.strictEqual(db.metadata[pubId].channelAttributedManually, true, 'visible item carries the manual flag');
  assert.strictEqual(db.metadata[pubId].channelUrl, TARGET.channelUrl, 'visible item got the identity');
  assert.strictEqual(db.metadata[hidId].channelUrl, undefined, 'hidden item was NOT attributed');
  assert.strictEqual(db.metadata[hidId].channelAttributedManually, undefined, 'hidden item carries no manual flag');
});

test('relocate: the hidden stranded item is invisible to the restricted writer and its FILE never moves', async () => {
  // Make the hidden item a stranded-resume candidate - manually attributed to
  // TARGET, sitting outside the channel folder. For an ADMIN this is exactly
  // what the mover exists to relocate; for the restricted writer it must not
  // even be visible as work.
  await updateDatabase((db) => {
    const hid = db.metadata[hidId];
    hid.channelUrl = TARGET.channelUrl;
    hid.channelName = TARGET.channelName;
    hid.channelId = TARGET.channelId;
    hid.channelAttributedManually = true;
    const ns = store.ensureYtdlp(db);
    if (!ns.subscriptions.some((s) => s.channelUrl === TARGET.channelUrl)) {
      ns.subscriptions.push({ id: 'subBulkVis', channelUrl: TARGET.channelUrl, channelId: TARGET.channelId, name: TARGET.channelName, order: 1 });
    }
    return true;
  });
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;

  // Admin preview proves BOTH items are genuine relocation work right now
  // (visible pub: attributed in the previous test, outside the channel folder;
  // hidden: the stranded fixture above) - so the restricted run below is
  // skipping the hidden one because of VISIBILITY, not because it was never
  // movable (no vacuous green).
  const adminPv = await (await bulk(undefined, { root: mediaDir, target: TARGET, relocate: true, preview: true })).json();
  assert.strictEqual(adminPv.resuming, 2, 'admin sees both stranded items as resumable');

  const run = await (await bulk(writerPath.cookie, { root: mediaDir, target: TARGET, relocate: true })).json();
  assert.strictEqual(run.resuming, 1, 'restricted writer resumes only the visible item');
  const entry = await waitForMoverDone();
  assert.strictEqual(entry.state, 'done', 'the mover finished');
  assert.strictEqual(entry.moved, 1, 'exactly one file moved');

  const db = loadDatabase();
  // A move re-keys the record (ids are path-derived) - find the moved item by
  // name, the M23 pattern from attribution.test.js.
  const movedPub = Object.values(db.metadata).find((x) => x && x.name === 'Pübliç Clip.mp4');
  assert.ok(movedPub && !movedPub.filePath.startsWith(publicDir), 'visible file physically left its folder');
  assert.strictEqual(db.metadata[hidId].filePath, hidFile, 'hidden item record still points at the original path');
  assert.strictEqual(fs.existsSync(hidFile), true, 'hidden file is still on disk where it was');
  assert.strictEqual(fs.readFileSync(hidFile, 'utf8'), 'HIDDEN-BYTES', 'hidden file bytes are untouched');
});

test('the same run by an ADMIN moves the hidden item - the machinery is alive, visibility was the only guard', async () => {
  const run = await (await bulk(undefined, { root: mediaDir, target: TARGET, relocate: true })).json();
  assert.strictEqual(run.resuming, 1, 'admin resumes the hidden stranded item');
  const entry = await waitForMoverDone();
  assert.strictEqual(entry.state, 'done');
  assert.strictEqual(entry.moved, 1, 'the hidden file moved for the admin');
  const db = loadDatabase();
  const movedHid = Object.values(db.metadata).find((x) => x && x.name === 'Hïdden Clip.mp4');
  assert.ok(movedHid && !movedHid.filePath.startsWith(hiddenDir), 'hidden file physically relocated by the unrestricted run');
});
