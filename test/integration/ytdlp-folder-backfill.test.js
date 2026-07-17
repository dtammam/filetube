'use strict';

// [INTEGRATION] v1.22.0 FR-2 -- the retroactive, folder-based Subscribe-button
// backfill: a second, sibling pass in server.js's Phase-2 `updateDatabase`
// scan mutator, NOT scoped to `freshlyScannedIds` (see
// test/integration/ytdlp-channel-meta-bridge.test.js for the v1.20.0
// first-scan bridge this is additive to). Proves, against the REAL scan
// path (not a re-implementation):
//   - AC16: an item that was indexed BEFORE its subscription even existed
//     (simulating a pre-v1.20 download, or the AC20 periodic-scan race) gets
//     `channelUrl`/`channelName` backfilled on a LATER scan, once a matching
//     subscription's channelDir is configured -- proving this is NOT scoped
//     to freshlyScannedIds.
//   - AC80: once backfilled, the real creator name (not a generic folder
//     label) is what `db.metadata[id].channelName` holds -- the field
//     `resolveChannelName` (common.js) already ranks first.
//   - AC17: an item that ALREADY has a captured channelUrl (from the
//     existing freshlyScannedIds bridge) is NEVER overwritten, even when a
//     different subscription's channelDir would otherwise match its folder.
//   - A non-yt-dlp file under an ordinary library folder is NEVER backfilled,
//     even if it happens to sit in a same-named subfolder.
//   - AC18: a hand-edited/corrupted subscription record whose channelUrl
//     fails re-validation is never backfilled onto db.metadata.
//   - AC21: with no subscriptions configured, the pass is a total no-op.
//   - AC81: the v1.19 save-to-device button's underlying route
//     (`/video/:id?download=1`) is NOT gated for a re-associated/backfilled
//     item -- regression-lock.
//
// Isolated DATA_DIR before requiring the app, per the established pattern
// (test/integration/ytdlp-channel-meta-bridge.test.js).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, scanDirectories, loadDatabase, updateDatabase, getMediaId } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const store = require('../../lib/ytdlp/store');
const args = require('../../lib/ytdlp/args');

let server;
let base;
let downloadDir;

before(async () => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-folder-backfill-'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // v1.43: auth through the real gate
});

after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

function ytdlpDeps() {
  return { updateDatabase, getMediaId };
}

test('AC16/AC20/AC80: an item indexed BEFORE its subscription existed (pre-v1.20 / periodic-scan-race gap) gets channelUrl+channelName backfilled on a LATER scan -- proving the pass is NOT scoped to freshlyScannedIds', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const channelDir = args.resolveChannelDir({ downloadDir }, { name: 'Retro Creator' });
    fs.mkdirSync(channelDir, { recursive: true });
    const filePath = path.join(channelDir, 'Old Upload [aaaaaaaaaa1].mp4');
    fs.writeFileSync(filePath, 'not a real video');

    // First scan: NO subscription configured yet -- the file is indexed with
    // no channel identity (exactly like a pre-v1.20 download, or a file the
    // periodic auto-scan won the race on before downloadMeta was written).
    await scanDirectories();
    const id = getMediaId(filePath);
    let db = loadDatabase();
    assert.ok(db.metadata[id], 'sanity: the file must be indexed');
    assert.equal(db.metadata[id].channelUrl, undefined, 'sanity: no subscription exists yet -- no identity to backfill');

    // Now the matching subscription is added (its channelDir resolves to the
    // SAME folder the file already lives in).
    await store.addSubscription(ytdlpDeps(), {
      channelUrl: 'https://www.youtube.com/@retrocreator',
      name: 'Retro Creator',
    });

    // Second scan: the file is UNCHANGED on disk (same size/mtime), so it
    // takes the `reusable` fast path, NOT freshlyScannedIds -- proving the
    // backfill pass revisits an already-indexed item.
    await scanDirectories();
    db = loadDatabase();
    const item = db.metadata[id];
    assert.equal(item.channelUrl, 'https://www.youtube.com/@retrocreator');
    assert.equal(item.channelName, 'Retro Creator', 'AC80: channelName must be written so the real creator name displays (resolveChannelName ranks it first)');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    await updateDatabase((db) => { const ns = store.ensureYtdlp(db); ns.subscriptions = []; return true; });
  }
});

test('AC17: an item that ALREADY has a captured channelUrl is NEVER overwritten, even when a different subscription\'s channelDir would otherwise match its folder', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const channelDir = args.resolveChannelDir({ downloadDir }, { name: 'Existing Identity Channel' });
    fs.mkdirSync(channelDir, { recursive: true });
    const filePath = path.join(channelDir, 'Video [bbbbbbbbbb1].mp4');
    fs.writeFileSync(filePath, 'not a real video');

    // Seed a downloadMeta entry so the FIRST scan's freshlyScannedIds bridge
    // captures a genuine channelUrl for this item.
    await updateDatabase((db) => {
      const ns = store.ensureYtdlp(db);
      ns.downloadMeta.bbbbbbbbbb1 = {
        channelUrl: 'https://www.youtube.com/channel/UCoriginal00000000000000',
        channelName: 'Original Creator',
        capturedAt: Date.now(),
      };
    });
    await scanDirectories();
    const id = getMediaId(filePath);
    let db = loadDatabase();
    assert.equal(db.metadata[id].channelUrl, 'https://www.youtube.com/channel/UCoriginal00000000000000', 'sanity: the first-scan bridge must have captured the original identity');

    // Now add a DIFFERENT subscription whose channelDir happens to match
    // this same folder (name coincidentally resolves to the same sanitized
    // directory name) -- the never-overwrite guard must win regardless.
    await store.addSubscription(ytdlpDeps(), {
      channelUrl: 'https://www.youtube.com/@differentcreator',
      name: 'Existing Identity Channel',
    });

    await scanDirectories();
    db = loadDatabase();
    const item = db.metadata[id];
    assert.equal(item.channelUrl, 'https://www.youtube.com/channel/UCoriginal00000000000000', 'AC17: an item that already has channelUrl must never be overwritten by the folder-based backfill');
    assert.equal(item.channelName, 'Original Creator');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    await updateDatabase((db) => { const ns = store.ensureYtdlp(db); ns.subscriptions = []; return true; });
  }
});

test('a non-yt-dlp file under an ordinary library folder is NEVER backfilled, even sitting in a same-named subfolder', async () => {
  const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-backfill-library-'));
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    await store.addSubscription(ytdlpDeps(), {
      channelUrl: 'https://www.youtube.com/@librarycoincidence',
      name: 'Library Coincidence',
    });

    // A library folder that happens to share the exact sanitized name the
    // subscription's channelDir would resolve to, but OUTSIDE the yt-dlp
    // download root entirely.
    const coincidentalDir = path.join(libraryDir, 'Library Coincidence');
    fs.mkdirSync(coincidentalDir, { recursive: true });
    const filePath = path.join(coincidentalDir, 'Home Movie [cccccccccc1].mp4');
    fs.writeFileSync(filePath, 'not a real video');

    await updateDatabase((db) => { db.folders = [libraryDir]; return true; });
    await scanDirectories();

    const id = getMediaId(filePath);
    const db = loadDatabase();
    const item = db.metadata[id];
    assert.ok(item, 'sanity: the library file must still be indexed');
    assert.equal(item.channelUrl, undefined, 'a non-yt-dlp-rooted file must NEVER get channel fields attached, regardless of folder-name coincidence');
    assert.equal(item.channelName, undefined);
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    fs.rmSync(libraryDir, { recursive: true, force: true });
    await updateDatabase((db) => { db.folders = []; const ns = store.ensureYtdlp(db); ns.subscriptions = []; return true; });
  }
});

test('AC18: a hand-edited/corrupted subscription channelUrl that fails re-validation is never backfilled onto db.metadata', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    // Bypass validateSubscriptionInput/addSubscription entirely to simulate
    // a corrupted persisted record.
    await updateDatabase((db) => {
      const ns = store.ensureYtdlp(db);
      ns.subscriptions.push({
        id: 'hostile-sub',
        channelUrl: 'https://evil.com/@x; rm -rf /',
        name: 'Hostile Channel',
      });
    });

    const channelDir = args.resolveChannelDir({ downloadDir }, { name: 'Hostile Channel' });
    fs.mkdirSync(channelDir, { recursive: true });
    const filePath = path.join(channelDir, 'Video [dddddddddd1].mp4');
    fs.writeFileSync(filePath, 'not a real video');

    await scanDirectories();

    const id = getMediaId(filePath);
    const db = loadDatabase();
    const item = db.metadata[id];
    assert.ok(item, 'sanity: the file must still be indexed');
    assert.equal(item.channelUrl, undefined, 'a channelUrl failing re-validation must never be attached to db.metadata');
    assert.equal(item.channelName, undefined);
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    await updateDatabase((db) => { const ns = store.ensureYtdlp(db); ns.subscriptions = []; return true; });
  }
});

test('AC21: with no subscriptions configured, the folder-based backfill pass is a total no-op', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const filePath = path.join(downloadDir, 'No Subscriptions Yet [eeeeeeeeee1].mp4');
    fs.writeFileSync(filePath, 'not a real video');

    await scanDirectories();

    const id = getMediaId(filePath);
    const db = loadDatabase();
    const item = db.metadata[id];
    assert.ok(item, 'sanity: the file must still be indexed');
    assert.equal(item.channelUrl, undefined);
    assert.equal(item.channelName, undefined);
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('AC81 (regression-lock): the save-to-device route (/video/:id?download=1) is NOT gated for a re-associated/backfilled item', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const channelDir = args.resolveChannelDir({ downloadDir }, { name: 'Downloadable Creator' });
    fs.mkdirSync(channelDir, { recursive: true });
    const filePath = path.join(channelDir, 'Downloadable Video [ffffffffff1].mp4');
    fs.writeFileSync(filePath, 'DOWNLOADABLE-BYTES');

    await scanDirectories();
    await store.addSubscription(ytdlpDeps(), {
      channelUrl: 'https://www.youtube.com/@downloadablecreator',
      name: 'Downloadable Creator',
    });
    await scanDirectories();

    const id = getMediaId(filePath);
    const db = loadDatabase();
    const item = db.metadata[id];
    assert.equal(item.channelUrl, 'https://www.youtube.com/@downloadablecreator', 'sanity: the item must actually be backfilled for this to be a meaningful regression-lock');

    const res = await fetch(`${base}/video/${id}?download=1`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'DOWNLOADABLE-BYTES');
    assert.match(res.headers.get('content-disposition'), /^attachment;/, 'AC81: the download route must render/serve identically for a backfilled/yt-dlp-associated item -- no new gating');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    await updateDatabase((db) => { const ns = store.ensureYtdlp(db); ns.subscriptions = []; return true; });
  }
});
