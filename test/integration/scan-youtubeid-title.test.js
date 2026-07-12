'use strict';

// [INTEGRATION] v1.33 T1/T2/T3 -- the scan-time halves of the release-date/
// Share/emoji-title trust chain, against the REAL server.js scan path:
//
//   T1: `youtubeId` persisted at scan -- from the filename's `[id]` bracket
//       (yt-dlp-rooted files only), with the probed-once `null` marker on
//       bracket-less files; schema-only backfill for items that predate the
//       field (bracket, or the already-persisted `comment` tag -- never a
//       fresh probe).
//   T3: a seeded downloadMeta `sourceTitle` (the real, emoji-intact title
//       captured off yt-dlp's --print line) supersedes the filename-derived
//       display title at the bridge, and survives a later rescan.
//   T2: GET /api/videos/:id exposes `watchUrl` for an item with a youtubeId
//       and omits it otherwise.
//
// Isolated DATA_DIR before requiring the app, per the established pattern
// (test/integration/ytdlp-channel-meta-bridge.test.js).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytid-title-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, scanDirectories, loadDatabase, updateDatabase, getMediaId } = require('../../server');
const store = require('../../lib/ytdlp/store');

let server;
let base;
let downloadDir;

before(async () => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytid-dl-'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

function withYtdlpEnv(fn) {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  return fn().finally(() => {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  });
}

test('scan: a bracketed yt-dlp download gets youtubeId persisted; a bracket-less one gets the explicit null marker', () => withYtdlpEnv(async () => {
  const bracketedPath = path.join(downloadDir, 'Bracketed Video [dQw4w9WgXcQ].mp4');
  fs.writeFileSync(bracketedPath, 'not a real video');
  const plainPath = path.join(downloadDir, 'Metube Style Import.mp4');
  fs.writeFileSync(plainPath, 'not a real video');

  await scanDirectories();

  const db = loadDatabase();
  const bracketed = db.metadata[getMediaId(bracketedPath)];
  const plain = db.metadata[getMediaId(plainPath)];
  assert.ok(bracketed && plain, 'sanity: both files indexed');
  assert.equal(bracketed.youtubeId, 'dQw4w9WgXcQ');
  assert.ok(Object.prototype.hasOwnProperty.call(plain, 'youtubeId'), 'the field must be PRESENT (probed-once convention)');
  assert.equal(plain.youtubeId, null, 'bracket-less with no embedded source URL -> explicit null');
}));

test('scan: schema-only youtubeId backfill for a pre-existing item -- bracket, or the already-persisted comment tag; attempted exactly once', () => withYtdlpEnv(async () => {
  // Seed two ALREADY-INDEXED entries (no youtubeId field at all -- predates
  // v1.33) whose files exist on disk so they take the reuse fast-path.
  const bracketedPath = path.join(downloadDir, 'Old Bracketed [aaaaaaaaaaa].mp4');
  fs.writeFileSync(bracketedPath, 'v');
  const commentPath = path.join(downloadDir, 'Old Metube Import.mp4');
  fs.writeFileSync(commentPath, 'v');
  const bracketedId = getMediaId(bracketedPath);
  const commentId = getMediaId(commentPath);

  await updateDatabase((db) => {
    const seed = (id, filePath, extra) => {
      db.metadata[id] = {
        id, name: path.basename(filePath), title: path.basename(filePath, '.mp4'), filePath,
        folderName: path.basename(downloadDir), size: fs.statSync(filePath).size, ext: '.mp4',
        type: 'video', addedAt: Date.now(), duration: 10, hasThumbnail: false, artist: '',
        videoCodec: null, audioCodec: null, releaseDate: 1000, rootFolder: downloadDir,
        ...extra,
      };
    };
    seed(bracketedId, bracketedPath, {});
    seed(commentId, commentPath, { tags: { comment: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' } });
  });

  await scanDirectories();

  const db = loadDatabase();
  assert.equal(db.metadata[bracketedId].youtubeId, 'aaaaaaaaaaa', 'bracket backfill on the reuse fast-path');
  assert.equal(db.metadata[commentId].youtubeId, 'bbbbbbbbbbb', 'comment-tag (embedded source URL) backfill, no fresh probe');
}));

test('bridge: a seeded downloadMeta sourceTitle supersedes the filename-derived display title (emoji intact) and survives a rescan', () => withYtdlpEnv(async () => {
  const filePath = path.join(downloadDir, 'Never_Gonna_Give_You_Up [ccccccccccc].mp4');
  fs.writeFileSync(filePath, 'not a real video');
  const realTitle = 'Never Gonna Give You Up 🎵🕺 (Official Video)';

  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta.ccccccccccc = {
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelName: 'Rick Astley',
      sourceTitle: realTitle,
      capturedAt: Date.now(),
    };
  });

  await scanDirectories();

  const id = getMediaId(filePath);
  let item = loadDatabase().metadata[id];
  assert.equal(item.sourceTitle, realTitle);
  assert.equal(item.title, realTitle, 'the display title IS the captured real title, not the underscore-folded filename');
  assert.equal(item.youtubeId, 'ccccccccccc');

  // A later rescan (file unchanged -> reuse fast-path) must not revert it.
  await scanDirectories();
  item = loadDatabase().metadata[id];
  assert.equal(item.title, realTitle, 'the captured title survives subsequent rescans');
}));

test('GET /api/videos/:id: exposes watchUrl for an item with a youtubeId, omits it otherwise', () => withYtdlpEnv(async () => {
  const withIdPath = path.join(downloadDir, 'Shareable [ddddddddddd].mp4');
  fs.writeFileSync(withIdPath, 'v');
  const withoutIdPath = path.join(downloadDir, 'Not Shareable.mp4');
  fs.writeFileSync(withoutIdPath, 'v');

  await scanDirectories();

  const withIdRes = await fetch(`${base}/api/videos/${getMediaId(withIdPath)}`);
  assert.equal(withIdRes.status, 200);
  const withId = await withIdRes.json();
  assert.equal(withId.watchUrl, 'https://www.youtube.com/watch?v=ddddddddddd');

  const withoutIdRes = await fetch(`${base}/api/videos/${getMediaId(withoutIdPath)}`);
  assert.equal(withoutIdRes.status, 200);
  const withoutId = await withoutIdRes.json();
  assert.ok(!('watchUrl' in withoutId), 'no youtubeId -> no watchUrl field at all');
}));

test('GET /api/videos/:id: a garbage persisted youtubeId never yields a watchUrl (buildWatchUrl re-validates)', () => withYtdlpEnv(async () => {
  const filePath = path.join(downloadDir, 'Corrupted Field.mp4');
  fs.writeFileSync(filePath, 'v');
  await scanDirectories();
  const id = getMediaId(filePath);
  await updateDatabase((db) => {
    if (db.metadata[id]) db.metadata[id].youtubeId = '"><script>bad';
  });

  const res = await fetch(`${base}/api/videos/${id}`);
  const body = await res.json();
  assert.ok(!('watchUrl' in body), 'an unsafe id must never be turned into a shareable URL');
}));
