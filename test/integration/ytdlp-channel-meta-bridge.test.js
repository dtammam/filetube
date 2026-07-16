'use strict';

// [INTEGRATION] v1.20.0 FR-2 -- the scan-time bridge: server.js's
// extractYtdlpVideoId + ytdlp.consumeDownloadChannelMeta, wired into the
// EXISTING Phase-2 `updateDatabase(fresh => ...)` scan mutator. Proves,
// against the REAL server.js scan path (not a re-implementation):
//   - A file rooted under the yt-dlp module's own download dir, whose
//     filename embeds a video id already seeded in
//     `db.ytdlp.downloadMeta[videoId]`, gets that identity attached onto
//     its `db.metadata[id]` entry (channelUrl/channelHandleUrl/channelId/
//     channelName).
//   - The consumed downloadMeta entry is DELETED (read-validate-delete,
//     bounded growth) -- it does not linger after being consumed.
//   - A NON-yt-dlp file (outside any download root) NEVER gets channel
//     fields attached, even if its filename happens to embed the exact
//     same bracketed id shape.
//   - A seeded downloadMeta entry with a HOSTILE channelUrl never reaches
//     db.metadata (defense-in-depth re-validation in consumeDownloadChannelMeta).
//
// Isolated DATA_DIR before requiring the app, per the established pattern
// (test/integration/ytdlp-scan-root.test.js).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, scanDirectories, loadDatabase, updateDatabase, getMediaId } = require('../../server');
const store = require('../../lib/ytdlp/store');

let server;
let downloadDir;

before(async () => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-bridge-'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
});

after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

test('a scanned yt-dlp download gets channelUrl/channelName/channelId/channelHandleUrl attached from a seeded downloadMeta entry, and the entry is consumed (deleted)', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const filePath = path.join(downloadDir, 'Amazing Video Title [dQw4w9WgXcQ].mp4');
    fs.writeFileSync(filePath, 'not a real video');

    await updateDatabase((db) => {
      const ns = store.ensureYtdlp(db);
      ns.downloadMeta.dQw4w9WgXcQ = {
        channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
        channelHandleUrl: 'https://www.youtube.com/@RickAstley',
        channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
        channelName: 'Rick Astley',
        capturedAt: Date.now(),
      };
    });

    await scanDirectories();

    const id = getMediaId(filePath);
    const db = loadDatabase();
    const item = db.metadata[id];
    assert.ok(item, 'sanity: the file must be indexed');
    assert.equal(item.channelUrl, 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw');
    assert.equal(item.channelHandleUrl, 'https://www.youtube.com/@RickAstley');
    assert.equal(item.channelId, 'UCuAXFkgsw1L7xaCfnd5JJOw');
    assert.equal(item.channelName, 'Rick Astley');

    // Consumed -- the map entry must no longer exist after the scan indexed it.
    const ns = store.ensureYtdlp(loadDatabase());
    assert.equal(ns.downloadMeta.dQw4w9WgXcQ, undefined, 'a consumed downloadMeta entry must be deleted (bounded growth)');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('a lookup MISS (no seeded downloadMeta entry for this video id) leaves the item with no channel identity, never an error', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const filePath = path.join(downloadDir, 'No Capture Available [zzzzzzzzzz1].mp4');
    fs.writeFileSync(filePath, 'not a real video');

    await scanDirectories();

    const id = getMediaId(filePath);
    const db = loadDatabase();
    const item = db.metadata[id];
    assert.ok(item, 'sanity: the file must still be indexed');
    assert.equal(item.channelUrl, undefined, 'no downloadMeta entry existed -- the item must simply have no channel identity');
    assert.equal(item.channelName, undefined);
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('a NON-yt-dlp file (outside any download root) NEVER gets channel fields attached, even with a matching seeded downloadMeta entry for the same bracketed id', async () => {
  const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-bridge-library-'));
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    // Coincidentally the exact same bracketed-id shape, but OUTSIDE the
    // yt-dlp module's own download root.
    const libraryFilePath = path.join(libraryDir, 'My Home Movie [dQw4w9WgXcQ].mp4');
    fs.writeFileSync(libraryFilePath, 'not a real video');

    await updateDatabase((db) => {
      db.folders = [libraryDir];
      const ns = store.ensureYtdlp(db);
      ns.downloadMeta.dQw4w9WgXcQ = {
        channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
        channelName: 'Rick Astley',
        capturedAt: Date.now(),
      };
    });

    await scanDirectories();

    const id = getMediaId(libraryFilePath);
    const db = loadDatabase();
    const item = db.metadata[id];
    assert.ok(item, 'sanity: the library file must still be indexed');
    assert.equal(item.channelUrl, undefined, 'a non-yt-dlp-rooted file must NEVER get channel fields attached, regardless of its filename shape');
    assert.equal(item.channelName, undefined);

    // The seeded entry must be left UNTOUCHED (never consumed by a
    // non-yt-dlp-rooted file) -- still available for the ACTUAL yt-dlp
    // download under downloadDir, if any.
    const ns = store.ensureYtdlp(loadDatabase());
    assert.ok(ns.downloadMeta.dQw4w9WgXcQ, 'the downloadMeta entry must not be consumed by a file outside the download root');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    fs.rmSync(libraryDir, { recursive: true, force: true });
    await updateDatabase((db) => { db.folders = []; return true; });
  }
});

test('a seeded downloadMeta entry with a HOSTILE channelUrl never reaches db.metadata (defense-in-depth re-validation), and is still consumed', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const filePath = path.join(downloadDir, 'Hostile Capture [hostileId12].mp4');
    fs.writeFileSync(filePath, 'not a real video');

    await updateDatabase((db) => {
      const ns = store.ensureYtdlp(db);
      // Simulate a somehow-corrupted persisted entry (bypassing the
      // capture-time sanitizer entirely) to prove the SCAN-TIME bridge
      // re-validates independently, never trusting a stored value blindly.
      ns.downloadMeta.hostileId12 = {
        channelUrl: 'https://evil.com/@x; rm -rf /',
        channelName: 'Hostile',
        capturedAt: Date.now(),
      };
    });

    await scanDirectories();

    const id = getMediaId(filePath);
    const db = loadDatabase();
    const item = db.metadata[id];
    assert.ok(item, 'sanity: the file must still be indexed');
    assert.equal(item.channelUrl, undefined, 'a hostile channelUrl must never be attached to db.metadata, even from a persisted downloadMeta entry');

    const ns = store.ensureYtdlp(loadDatabase());
    assert.equal(ns.downloadMeta.hostileId12, undefined, 'the entry must still be consumed (deleted) even though it failed re-validation');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

// ---- v1.41.13 (universal one-offs): the non-YouTube scan bridge -------------

test('a scanned NON-YouTube download gets sourceExtractor/sourceId + channelName (pseudo-channel) from a universal downloadMeta entry, keyed by rendered basename, and survives a rescan', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const basename = 'A Vimeo Film [Vimeo=76979871].mp4';
    const filePath = path.join(downloadDir, basename);
    fs.writeFileSync(filePath, 'not a real video');

    await updateDatabase((db) => {
      const ns = store.ensureYtdlp(db);
      // Universal entries are keyed by the rendered on-disk BASENAME (design D5).
      ns.downloadMeta[basename] = {
        universal: true,
        sourceExtractor: 'Vimeo',
        sourceId: '76979871',
        channelName: 'Some Studio',
        capturedAt: Date.now(),
      };
    });

    await scanDirectories();

    const id = getMediaId(filePath);
    let item = loadDatabase().metadata[id];
    assert.ok(item, 'sanity: the non-YouTube file is indexed');
    assert.equal(item.sourceExtractor, 'Vimeo');
    assert.equal(item.sourceId, '76979871');
    assert.equal(item.channelName, 'Some Studio', 'the pseudo-channel label (D7) is attached');
    assert.equal(item.channelUrl, undefined, 'no YouTube channelUrl for a non-YouTube item');
    assert.equal(item.youtubeId, undefined, 'a real non-YouTube item never gets a youtubeId');

    // Consumed, and the identity SURVIVES a second (unchanged-item) scan.
    assert.equal(store.ensureYtdlp(loadDatabase()).downloadMeta[basename], undefined, 'universal entry consumed');
    await scanDirectories();
    item = loadDatabase().metadata[id];
    assert.equal(item.sourceExtractor, 'Vimeo', 'source identity survives the rescan (persist checkpoint)');
    assert.equal(item.sourceId, '76979871');
    assert.equal(item.channelName, 'Some Studio');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('D1a: a proxy-host YouTube download ([Youtube=id] bracket) ALSO gets youtubeId set (Share/reheat identity restored)', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const basename = 'Proxied Clip [Youtube=dQw4w9WgXcQ].mp4';
    const filePath = path.join(downloadDir, basename);
    fs.writeFileSync(filePath, 'not a real video');

    await scanDirectories();

    const id = getMediaId(filePath);
    const item = loadDatabase().metadata[id];
    assert.ok(item, 'sanity: indexed');
    assert.equal(item.youtubeId, 'dQw4w9WgXcQ', 'D1a: the real YouTube id is recovered from the [Youtube=id] bracket');
    assert.equal(item.sourceExtractor, 'Youtube', 'and the source is recorded');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});
