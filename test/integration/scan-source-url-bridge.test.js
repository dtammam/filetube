'use strict';

// [INTEGRATION] v1.338 (Dean: "non-YouTube things supported by YT DLP should have generally
// first-class experiences"; plan docs/exec-plans/active/2026-09-26-first-class-any-site.md D1-D4):
// a download from another site saves the page it came from as `sourceUrl`, so Share works on every
// surface. This drives the REAL scan (scanDirectories) over real files in a yt-dlp download root and
// binds every persist-gate checkpoint (LESSONS 9) on its own: the capture bridge (terminal write),
// the re-init carry-forward, the Phase-2 gap-fill, the schema-only backfill in BOTH reuse arms, and
// the new-file tag fallback. The carry-forward and the Phase-2 gap-fill mask each other on a plain
// changed-file rescan (the scan-view-count-bridge lesson), so each has an isolating test.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The new-file fallback needs a REAL media file the scan's own probe reads tags from; the server finds
// ffmpeg / ffprobe BY NAME at boot, so the binary's directory joins PATH before the app loads
// (FILETUBE_TEST_FFMPEG points at one on this box). Without one that test SKIPS and says so.
function findFfmpeg() {
  const explicit = process.env.FILETUBE_TEST_FFMPEG;
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, 'ffmpeg');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (_) { /* next */ }
  }
  return null;
}
const FFMPEG = findFfmpeg();
if (FFMPEG) process.env.PATH = path.dirname(FFMPEG) + path.delimiter + process.env.PATH;

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-sourceurl-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { scanDirectories, loadDatabase, updateDatabase, getMediaId, ytdlpDb } = require('../../server');
const store = require('../../lib/ytdlp/store');

const PAGE = 'https://www.reddit.com/r/videos/comments/abc123/a_clip/';
let downloadDir;

before(() => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-sourceurl-dl-'));
});

after(() => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
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

function seedUniversalCapture(basename, extra) {
  return updateDatabase(() => ytdlpDb.mutate((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta[basename] = {
      universal: true, sourceExtractor: 'Reddit', sourceId: basename.slice(0, 6),
      channelName: 'someone', capturedAt: Date.now(), ...extra,
    };
  }));
}

// ---- the capture bridge (terminal write) ----------------------------------------

test('capture: a universal download gets sourceUrl from its capture, and it survives an unchanged rescan', () => withYtdlpEnv(async () => {
  const base = 'Captured Clip [Reddit=cap001].mp4';
  const filePath = path.join(downloadDir, base);
  fs.writeFileSync(filePath, 'not a real video');
  await seedUniversalCapture(base, { sourceUrl: PAGE });
  await scanDirectories();
  const id = getMediaId(filePath);
  assert.equal(loadDatabase().metadata[id].sourceExtractor, 'Reddit', 'precondition: the universal bridge fired');
  assert.equal(loadDatabase().metadata[id].sourceUrl, PAGE);
  assert.equal(store.ensureYtdlp(loadDatabase()).downloadMeta[base], undefined, 'the capture was consumed');
  await scanDirectories();
  assert.equal(loadDatabase().metadata[id].sourceUrl, PAGE, 'an unchanged rescan keeps it');
}));

test('capture: a HOSTILE stored link never reaches the item (re-checked at consume), and the capture is still consumed', () => withYtdlpEnv(async () => {
  const base = 'Hostile Clip [Reddit=hos001].mp4';
  const filePath = path.join(downloadDir, base);
  fs.writeFileSync(filePath, 'not a real video');
  await seedUniversalCapture(base, { sourceUrl: 'https://www.reddit.com/r/‮gpj.exe' });
  await scanDirectories();
  const item = loadDatabase().metadata[getMediaId(filePath)];
  assert.equal(item.sourceExtractor, 'Reddit', 'precondition: the bridge fired');
  assert.notEqual(item.sourceUrl, 'https://www.reddit.com/r/‮gpj.exe');
  assert.equal(typeof item.sourceUrl === 'string' && item.sourceUrl.includes('‮'), false, 'no hidden-character link on the item');
}));

// ---- the carriers ------------------------------------------------------------------

test('a saved link survives a CHANGED file (carry-forward OR the Phase-2 gap-fill: the outcome)', () => withYtdlpEnv(async () => {
  const base = 'Re-encoded Clip [Reddit=chg001].mp4';
  const filePath = path.join(downloadDir, base);
  fs.writeFileSync(filePath, 'original bytes');
  await seedUniversalCapture(base, { sourceUrl: PAGE });
  await scanDirectories();
  const id = getMediaId(filePath);
  assert.equal(loadDatabase().metadata[id].sourceUrl, PAGE, 'precondition');
  fs.writeFileSync(filePath, 'a completely different, much longer set of bytes than before');
  await scanDirectories();
  assert.equal(loadDatabase().metadata[id].sourceUrl, PAGE, 'the link survives a re-encode');
}));

test('the re-init carry-forward ALONE keeps the link when the Phase-2 gap-fill cannot', () => withYtdlpEnv(async () => {
  // A concurrent writer STRIPS the link off the live row, so at merge time the gap-fill's source has
  // nothing; only the carry-forward (from the Phase-1 snapshot) can keep it. The strip MUST be enqueued
  // in the SAME synchronous turn as scanDirectories() (the scan-view-count-bridge ordering rule): do
  // not put an await between the two calls.
  const base = 'Carry Only Clip [Reddit=car001].mp4';
  const filePath = path.join(downloadDir, base);
  fs.writeFileSync(filePath, 'original bytes');
  await seedUniversalCapture(base, { sourceUrl: PAGE });
  await scanDirectories();
  const id = getMediaId(filePath);
  assert.equal(loadDatabase().metadata[id].sourceUrl, PAGE, 'precondition');
  fs.writeFileSync(filePath, 'changed bytes, so the scan re-inits this item from scratch');
  const scan = scanDirectories();
  const strip = updateDatabase((db) => {
    if (db.metadata[id]) delete db.metadata[id].sourceUrl;
    return true;
  });
  await Promise.all([scan, strip]);
  assert.equal(loadDatabase().metadata[id].sourceUrl, PAGE, 'the carry-forward kept it');
}));

test('the Phase-2 gap-fill ALONE adopts a link written MID-SCAN (the persist-gate checkpoint: any live-row writer during the scan)', () => withYtdlpEnv(async () => {
  // The item has no link (its file carries none: backfill null). A writer adds one to the live row in the
  // same synchronous turn as the scan; the scan's own snapshot has null, so only the gap-fill keeps it.
  const base = 'Midscan Clip [Reddit=mid001].mp4';
  const filePath = path.join(downloadDir, base);
  fs.writeFileSync(filePath, 'bytes');
  await seedUniversalCapture(base, {});
  await scanDirectories();
  const id = getMediaId(filePath);
  assert.equal(loadDatabase().metadata[id].sourceUrl ?? null, null, 'precondition: no link yet');
  const scan = scanDirectories();
  const write = updateDatabase((db) => {
    if (db.metadata[id]) db.metadata[id].sourceUrl = PAGE;
    return true;
  });
  await Promise.all([scan, write]);
  assert.equal(loadDatabase().metadata[id].sourceUrl, PAGE, 'the mid-scan link survived the final merge');
}));

// ---- the schema-only backfill (past downloads) --------------------------------------

async function seedSettled(filePath, fields) {
  const id = getMediaId(filePath);
  const size = fs.statSync(filePath).size;
  await updateDatabase((db) => {
    db.metadata[id] = {
      id, name: path.basename(filePath), filePath, folderName: path.basename(path.dirname(filePath)),
      ext: path.extname(filePath), size, type: 'video', title: 'Settled', addedAt: 1700000000000,
      duration: 1, releaseDate: 1700000000000, youtubeId: null, ...fields,
    };
    return true;
  });
  return id;
}

for (const arm of ['reuse (codec fields present)', 'legacy codec backfill (codec fields absent)']) {
  const codec = arm.startsWith('reuse') ? { videoCodec: 'h264', audioCodec: 'aac' } : {};
  test(`backfill, ${arm}: a past download takes its link from the persisted comment tag`, () => withYtdlpEnv(async () => {
    const tag = arm.startsWith('reuse') ? 'bf1' : 'bf2';
    const filePath = path.join(downloadDir, `Past Clip ${tag} [Reddit=${tag}xyz].mp4`);
    fs.writeFileSync(filePath, 'settled bytes');
    const id = await seedSettled(filePath, { ...codec, sourceExtractor: 'Reddit', sourceId: `${tag}xyz`, tags: { comment: PAGE } });
    await scanDirectories();
    assert.equal(loadDatabase().metadata[id].sourceUrl, PAGE);
  }));
  test(`backfill, ${arm}: a comment that is NOT a link marks the attempt with null, once`, () => withYtdlpEnv(async () => {
    const tag = arm.startsWith('reuse') ? 'nl1' : 'nl2';
    const filePath = path.join(downloadDir, `Described Clip ${tag} [Facebook=${tag}xyz].mp4`);
    fs.writeFileSync(filePath, 'settled bytes');
    const id = await seedSettled(filePath, { ...codec, sourceExtractor: 'Facebook', sourceId: `${tag}xyz`, tags: { comment: 'A description, not a link' } });
    await scanDirectories();
    const item = loadDatabase().metadata[id];
    assert.ok(Object.prototype.hasOwnProperty.call(item, 'sourceUrl'), 'the attempt is recorded');
    assert.equal(item.sourceUrl, null);
  }));
}

test('backfill: a YouTube item (even a proxy-host one with sourceExtractor Youtube) and a plain file never get sourceUrl', () => withYtdlpEnv(async () => {
  const yt = path.join(downloadDir, 'Proxy Clip [Youtube=dQw4w9WgXcQ].mp4');
  fs.writeFileSync(yt, 'settled bytes');
  const ytId = await seedSettled(yt, { videoCodec: 'h264', audioCodec: 'aac', sourceExtractor: 'Youtube', sourceId: 'dQw4w9WgXcQ', youtubeId: 'dQw4w9WgXcQ', tags: { comment: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });
  const plain = path.join(downloadDir, 'Home Movie.mp4');
  fs.writeFileSync(plain, 'settled bytes');
  const plainId = await seedSettled(plain, { videoCodec: 'h264', audioCodec: 'aac', tags: { comment: PAGE } });
  await scanDirectories();
  const db = loadDatabase();
  assert.equal(Object.prototype.hasOwnProperty.call(db.metadata[ytId], 'sourceUrl'), false, 'a YouTube item keeps its watchUrl route');
  assert.equal(Object.prototype.hasOwnProperty.call(db.metadata[plainId], 'sourceUrl'), false, 'a plain file is not a download from another site');
}));

test('a hostile comment tag never becomes a saved link (the backfill runs the strict check)', () => withYtdlpEnv(async () => {
  const filePath = path.join(downloadDir, 'Planted Clip [Reddit=pl1xyz].mp4');
  fs.writeFileSync(filePath, 'settled bytes');
  const id = await seedSettled(filePath, { videoCodec: 'h264', audioCodec: 'aac', sourceExtractor: 'Reddit', sourceId: 'pl1xyz', tags: { comment: 'javascript:alert(1)' } });
  await scanDirectories();
  assert.equal(loadDatabase().metadata[id].sourceUrl, null);
}));

test('the new-file fallback: a download from another site with NO capture takes its link from its own comment tag (a real MP4, the real probe)', { skip: FFMPEG ? false : 'no ffmpeg binary (set FILETUBE_TEST_FFMPEG)' }, () => withYtdlpEnv(async () => {
  // yt-dlp's `--embed-metadata` writes webpage_url into `comment` (MP4 keeps only `comment`); no capture is
  // bridged (a download from before v1.338, or one whose capture was lost), so only the fallback fills it.
  const filePath = path.join(downloadDir, 'New Clip [Reddit=new001].mp4');
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=160x90:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-metadata', `comment=${PAGE}`, filePath]);
  await new Promise((r) => setTimeout(r, 300)); // the server's boot-time ffmpeg check is async
  await scanDirectories();
  const item = loadDatabase().metadata[getMediaId(filePath)];
  assert.equal(item.sourceExtractor, 'Reddit', 'precondition: the bracket gave it its source identity');
  assert.equal(item.tags && item.tags.comment, PAGE, 'precondition: the probe persisted the comment tag');
  assert.equal(item.sourceUrl, PAGE);
}));
