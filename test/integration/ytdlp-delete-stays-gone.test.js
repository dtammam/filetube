'use strict';

// [INTEGRATION] FR-I -- "deleted stays gone" (AC52). Confirmed-already-
// working per the exec plan: the module-owned `.ytdlp-archive.txt` persists
// through FileTube's own DELETE /api/videos/:id path, so a subsequent poll
// never re-downloads an already-archived video (D3, and rules.js's own
// `isArchived` doc comment). This is the explicit regression assertion for
// that guarantee -- NOT a behavior change.
//
// Boots the real app (server.js) against an isolated DATA_DIR, exactly like
// test/integration/ytdlp-crud.test.js, so the production DELETE route's own
// `loadDatabase`/`updateDatabase` and this test's directly-invoked
// `ytdlp.runPoll` share the SAME db.json -- proving the guarantee across the
// real delete code path, not a reimplemented stand-in for it.
//
// `run.runList`/`run.runDownload` are mocked at the module-method boundary
// (the same monkeypatch pattern test/integration/ytdlp-poll.test.js already
// uses) -- no real yt-dlp binary or network access. The mocked
// `runDownload` writes the completed video's id into the REAL archive file
// at its resolved path, simulating exactly what yt-dlp's own
// `--download-archive` flag does on a genuine successful download -- so the
// archive-READ side (`rules.isArchived`, via `readArchiveTextSafely`) is
// exercised for real on the second poll, never stubbed out.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0'; // manual-only: no real timer during tests

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, loadDatabase, updateDatabase, getMediaId, transcodedPath,
} = require('../../server');
const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const store = require('../../lib/ytdlp/store');
const args = require('../../lib/ytdlp/args');

const THUMBNAIL_DIR = path.join(process.env.DATA_DIR, '.thumbnails');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

// Real deps for the parts that must share state with the live app's DELETE
// route (loadDatabase/updateDatabase/getMediaId are server.js's own, bound
// to the SAME db.json this test's HTTP client talks to); scanDirectories is
// a lightweight fake (no real FFmpeg/scanner needed -- this test manually
// inserts the "downloaded" video's db.metadata row itself, exactly like
// test/unit/database.test.js's `db.metadata['new-id'] = { id: 'new-id' }`
// pattern, standing in for what the real scanner would have produced).
function makeDeps() {
  return {
    loadDatabase,
    updateDatabase,
    getMediaId,
    scanDirectories: async () => {},
  };
}

function ndjson(videos) {
  return videos.map((v) => JSON.stringify(v)).join('\n');
}

test('FR-I: a video deleted via DELETE /api/videos/:id stays gone -- the download-archive still suppresses it on the next poll (AC52)', async () => {
  const deps = makeDeps();
  const config = ytdlp.parseYtdlpConfig();

  const sub = await store.addSubscription(deps, {
    channelUrl: 'https://www.youtube.com/@fr-i-channel',
    format: 'video',
    quality: 'best',
  });

  const videoId = 'fr-i-video-1';
  const survivorVideo = { id: videoId, extractor_key: 'Youtube', availability: 'public' };

  // ---- First poll: the video is a genuine new survivor, gets "downloaded",
  // and its id is recorded into the archive -- simulating a real completed
  // yt-dlp download (`--download-archive` writes `<extractor> <id>` on
  // success; this mock writes that SAME line format to the SAME resolved
  // archive path, so the second poll below reads a real archive file, not a
  // stand-in).
  let firstPollDownloadCalls = 0;
  run.runList = async () => ({ ok: true, stdout: ndjson([survivorVideo]), stderr: '' });
  run.runDownload = async (_sub, cfg, targetIds) => {
    firstPollDownloadCalls += 1;
    assert.deepEqual(targetIds, [videoId]);
    // The real yt-dlp binary creates its own download root on first write;
    // mirror that here before appending, since nothing else in this test path
    // (runPoll never calls ensureDownloadDir) has created it yet.
    fs.mkdirSync(cfg.downloadDir, { recursive: true });
    fs.appendFileSync(args.resolveArchivePath(cfg), 'youtube fr-i-video-1\n', 'utf8');
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const firstPollResult = await ytdlp.runPoll(deps, config, sub.id);
  assert.equal(firstPollResult.started, true);
  assert.equal(firstPollDownloadCalls, 1, 'the first poll must have actually attempted the download once');

  const [afterFirstPoll] = store.listSubscriptions(deps);
  assert.ok(afterFirstPoll.lastStatus.startsWith('ok'), `expected a safe ok status, got: ${afterFirstPoll.lastStatus}`);

  // The archive must now genuinely contain the downloaded id -- this is the
  // "completed download recorded in the archive" precondition the rest of
  // this test depends on.
  const archiveTextAfterDownload = fs.readFileSync(args.resolveArchivePath(config), 'utf8');
  assert.match(archiveTextAfterDownload, /youtube fr-i-video-1/);

  // ---- Simulate the scanner having indexed the "downloaded" file: write the
  // media file itself + its db.metadata row + a thumbnail + a transcode
  // sidecar, so DELETE /api/videos/:id has real on-disk artifacts to clean up
  // -- exactly the shape a real completed download+scan would have left.
  const channelDir = args.resolveChannelDir(config, sub);
  fs.mkdirSync(channelDir, { recursive: true });
  const videoFilePath = path.join(channelDir, `${videoId}.mp4`);
  fs.writeFileSync(videoFilePath, 'not a real video, just a delete-path fixture');

  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${videoId}.jpg`), 'fake-thumb');

  const sidecarPath = transcodedPath(videoId);
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  fs.writeFileSync(sidecarPath, 'fake-transcoded-sidecar');

  await updateDatabase((db) => {
    db.metadata[videoId] = {
      id: videoId,
      filePath: videoFilePath,
      title: 'FR-I fixture video',
      hasThumbnail: true,
    };
    db.progress[videoId] = { position: 12.5 };
    return true;
  });

  // ---- Delete the downloaded video via FileTube's REAL, unmocked delete
  // path (server.js's own DELETE /api/videos/:id -- never bypassed/stubbed).
  const deleteRes = await fetch(`${base}/api/videos/${videoId}`, { method: 'DELETE' });
  assert.equal(deleteRes.status, 200);
  assert.deepEqual(await deleteRes.json(), { success: true, message: 'File deleted successfully' });

  // The real delete path's normal cleanup happened: file, thumbnail,
  // transcode sidecar, db.metadata row, and db.progress entry are all gone.
  assert.equal(fs.existsSync(videoFilePath), false, 'the media file must be removed from disk');
  assert.equal(fs.existsSync(path.join(THUMBNAIL_DIR, `${videoId}.jpg`)), false, 'the thumbnail must be removed');
  assert.equal(fs.existsSync(sidecarPath), false, 'the transcode sidecar must be removed');
  const dbAfterDelete = loadDatabase();
  assert.equal(dbAfterDelete.metadata[videoId], undefined, 'the db.metadata row must be gone');
  assert.equal(dbAfterDelete.progress[videoId], undefined, 'the db.progress entry must be gone');

  // ---- The core FR-I assertion: the delete path must NEVER have touched the
  // download-archive file -- it must still contain the deleted video's id,
  // byte-for-byte unaffected by the delete.
  const archiveTextAfterDelete = fs.readFileSync(args.resolveArchivePath(config), 'utf8');
  assert.equal(archiveTextAfterDelete, archiveTextAfterDownload, 'DELETE /api/videos/:id must never touch the download-archive file');

  // ---- Second poll: the channel listing STILL reports the same video (a
  // channel's own "Videos" tab doesn't forget a video just because the local
  // library deleted its file) -- but this time, the poll must resolve it as
  // already-archived via the REAL `rules.isArchived` read of the REAL
  // archive file, and must NEVER re-download it.
  let secondPollDownloadCalls = 0;
  run.runList = async () => ({ ok: true, stdout: ndjson([survivorVideo]), stderr: '' });
  run.runDownload = async () => {
    secondPollDownloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const secondPollResult = await ytdlp.runPoll(deps, config, sub.id);
  assert.equal(secondPollResult.started, true);
  assert.equal(secondPollDownloadCalls, 0, 'a deleted-but-still-archived video must never trigger a re-download attempt');

  const [afterSecondPoll] = store.listSubscriptions(deps);
  assert.equal(afterSecondPoll.lastStatus, 'ok: no new videos', 'the archived id must be treated as already-downloaded, not a new survivor');

  // The video is genuinely still gone from the library after the re-poll --
  // deleted stays gone, both on disk and in the db.
  assert.equal(fs.existsSync(videoFilePath), false);
  assert.equal(loadDatabase().metadata[videoId], undefined);
});

// ---- v1.36.2 (Dean: "sticky post-deletion") ----------------------------------

test('v1.36.2: deleting an UN-ARCHIVED yt-dlp item records its id in the archive during the delete -- deletion is now authoritative for staying gone', async () => {
  const config = ytdlp.parseYtdlpConfig();
  fs.mkdirSync(config.downloadDir, { recursive: true });
  const channelDir = path.join(config.downloadDir, 'Some Channel');
  fs.mkdirSync(channelDir, { recursive: true });

  // A yt-dlp-shaped file whose id was NEVER archived -- the one-off /
  // lost-archive class that used to come back on the next poll.
  const videoId = 'unarchived1';
  const filePath = path.join(channelDir, `Great Video [${videoId}].mp4`);
  fs.writeFileSync(filePath, 'video-bytes');
  // A subtitle sidecar written by --write-subs: must be cleaned up too.
  const vttPath = path.join(channelDir, `Great Video [${videoId}].en.vtt`);
  fs.writeFileSync(vttPath, 'WEBVTT\n');

  const mediaId = getMediaId(filePath);
  await updateDatabase((db) => {
    db.metadata[mediaId] = { id: mediaId, filePath, title: 'Great Video', type: 'video' };
    return true;
  });

  const archivePath = args.resolveArchivePath(config);
  const before = fs.existsSync(archivePath) ? fs.readFileSync(archivePath, 'utf8') : '';
  assert.ok(!before.includes(`youtube ${videoId}`), 'precondition: the id is NOT in the archive');

  const res = await fetch(`${base}/api/videos/${mediaId}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.ok(!fs.existsSync(filePath), 'the file is gone');
  assert.ok(!fs.existsSync(vttPath), 'the .vtt subtitle sidecar is cleaned up with it');
  const after = fs.readFileSync(archivePath, 'utf8');
  assert.ok(after.includes(`youtube ${videoId}`), 'the DELETE itself must record the id -- the next poll now skips it regardless of how it was originally downloaded');
  assert.ok(!loadDatabase().metadata[mediaId], 'the library entry is gone');
});

test('v1.36.2: deleting a plain NON-yt-dlp library file never touches the archive (scoping)', async () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-plain-lib-'));
  const filePath = path.join(libDir, 'Home Movie [notaytdlpv].mp4');
  fs.writeFileSync(filePath, 'bytes');
  const mediaId = getMediaId(filePath);
  await updateDatabase((db) => {
    db.metadata[mediaId] = { id: mediaId, filePath, title: 'Home Movie', type: 'video' };
    return true;
  });

  const config = ytdlp.parseYtdlpConfig();
  const archivePath = args.resolveArchivePath(config);
  const before = fs.existsSync(archivePath) ? fs.readFileSync(archivePath, 'utf8') : '';

  const res = await fetch(`${base}/api/videos/${mediaId}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const after = fs.existsSync(archivePath) ? fs.readFileSync(archivePath, 'utf8') : '';
  assert.equal(after, before, 'a non-download-root file must never write archive lines (its bracket-lookalike name is irrelevant)');
  fs.rmSync(libDir, { recursive: true, force: true });
});
