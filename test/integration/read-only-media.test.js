'use strict';

// [INTEGRATION] v1.42 T6 — the beta safe-mode lever (AC8, design review
// F1/F10). FILETUBE_READ_ONLY_MEDIA=1 is armed BEFORE the server require
// (module-load const, own process per test file): every shared-state
// mutation refuses with an honest 403 and mutates NOTHING, the scan's
// tombstone-retry never unlinks (the imported-prod-tombstone destroy
// scenario), and per-instance operations stay fully live. The no-flag
// regression legs are the rest of the suite: every other test file runs
// these same surfaces unflagged.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-romedia-'));
process.env.FILETUBE_READ_ONLY_MEDIA = '1';
process.env.FILETUBE_YTDLP_ENABLED = '1'; // routes must exist to prove they refuse
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, saveDatabase, getMediaId, scanDirectories, __resetDatabaseForTests,
} = require('../../server');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

let server;
let base;
let libDir;

before(async () => {
  libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-romedia-lib-'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(libDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await __resetDatabaseForTests();
  for (const name of fs.readdirSync(libDir)) fs.rmSync(path.join(libDir, name), { force: true });
});

function seedVideo(fileName) {
  const filePath = path.join(libDir, fileName);
  fs.writeFileSync(filePath, 'video-bytes');
  const id = getMediaId(filePath);
  saveDatabase({
    folders: [libDir], folderSettings: {}, progress: {},
    metadata: {
      [id]: {
        id, name: fileName, title: fileName, filePath,
        folderName: path.basename(libDir), size: 11, ext: path.extname(fileName),
        type: 'video', addedAt: new Date().toISOString(), duration: 12,
        hasThumbnail: false, rootFolder: libDir, videoCodec: 'h264',
        audioCodec: 'aac', needsTranscode: false,
        releaseDate: new Date().toISOString(), youtubeId: null,
      },
    },
    liked: [], deleteTombstones: {},
    settings: { scanIntervalMinutes: 30, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
  return { filePath, id };
}

async function expectRefused(res) {
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.readOnlyMedia, true);
  assert.match(body.error, /read-only media mode/);
}

test('DELETE /api/videos/:id refuses with 403 and mutates NOTHING (file + db + tombstones untouched)', async () => {
  const { filePath, id } = seedVideo('protected [aaaaaaaaaaa].mp4');
  const before = readPersistedDatabase(DATA_DIR);

  await expectRefused(await fetch(`${base}/api/videos/${id}`, { method: 'DELETE' }));

  assert.ok(fs.existsSync(filePath), 'file untouched');
  assert.deepEqual(readPersistedDatabase(DATA_DIR), before, 'persisted state byte-identical');
});

test('POST /api/videos/:id/move refuses with 403 and moves nothing', async () => {
  const { filePath, id } = seedVideo('stay-put [bbbbbbbbbbb].mp4');
  await expectRefused(await fetch(`${base}/api/videos/${id}/move`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetFolder: 'Elsewhere' }),
  }));
  assert.ok(fs.existsSync(filePath), 'file untouched');
});

test('every yt-dlp shared-state route refuses: repull-all, repull-one, skip, one-off download, reheat', async () => {
  seedVideo('any [ccccccccccc].mp4');
  await expectRefused(await fetch(`${base}/api/subscriptions/repull`, { method: 'POST' }));
  await expectRefused(await fetch(`${base}/api/subscriptions/some-id/repull`, { method: 'POST' }));
  await expectRefused(await fetch(`${base}/api/subscriptions/some-id/skip`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: 'aaaaaaaaaaa' }),
  }));
  await expectRefused(await fetch(`${base}/api/ytdlp/download`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }),
  }));
  await expectRefused(await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' }));
});

test('AC8 scan leg (review F1): a tombstone-matched file survives the scan — not unlinked, not indexed, tombstone kept', async () => {
  // The exact imported-prod-tombstone shape: the file exists on disk with an
  // mtime OLDER than deletedAt (yt-dlp --mtime back-dates fresh downloads,
  // so this is realistic, not contrived), the id is NOT in metadata (deleted
  // per the imported state), and the tombstone is pending.
  const fileName = 'prod-live-file [ddddddddddd].mp4';
  const filePath = path.join(libDir, fileName);
  fs.writeFileSync(filePath, 'prod-bytes');
  const id = getMediaId(filePath);
  const deletedAt = Date.now();
  fs.utimesSync(filePath, (deletedAt - 60000) / 1000, (deletedAt - 60000) / 1000);
  saveDatabase({
    folders: [libDir], folderSettings: {}, progress: {}, metadata: {}, liked: [],
    deleteTombstones: { [id]: { filePath, deletedAt } },
    settings: { scanIntervalMinutes: 30, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });

  await scanDirectories();

  assert.ok(fs.existsSync(filePath), 'the shared file is NOT unlinked');
  const db = readPersistedDatabase(DATA_DIR);
  assert.ok(db.deleteTombstones && db.deleteTombstones[id], 'the tombstone is KEPT (un-consumed — it is prod\'s to retire)');
  assert.equal((db.metadata || {})[id], undefined, 'the file is NOT indexed (per the imported state it is deleted)');
});

test('AC8: the scheduled poll tick is a logged NO-OP under the flag (runPoll never invoked)', () => {
  const ytdlpModule = require('../../lib/ytdlp/index');
  // Deps that would throw loudly if the tick did ANY real work — the
  // read-only branch must return before touching them.
  const poisonDeps = new Proxy({}, { get() { throw new Error('scheduledPollTick touched deps under FILETUBE_READ_ONLY_MEDIA'); } });
  const lines = [];
  const realLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const config = require('../../lib/ytdlp/config').parseYtdlpConfig(process.env);
    assert.equal(config.readOnlyMedia, true, 'precondition: env parsed into config');
    ytdlpModule.scheduledPollTick(poisonDeps, config); // must not throw
    ytdlpModule.scheduledPollTick(poisonDeps, config); // and logs only ONCE per process
  } finally {
    console.log = realLog;
  }
  const skipLines = lines.filter((l) => l.includes('scheduled polls are DISABLED'));
  assert.equal(skipLines.length <= 1, true, 'the skip line logs at most once per process (no per-tick noise)');
  assert.ok(lines.length === 0 || skipLines.length === 1, 'when anything logged, it is the once-per-process skip line');
});

test('AC8: the boot one-off migrator is a logged no-op under the flag (no db read, no file moves)', async () => {
  const { migrateOneOffsIntoChannelFolders } = require('../../server');
  // Poison deps again: the guard must return BEFORE any db access.
  const poisonDeps = new Proxy({}, { get() { throw new Error('migrateOneOffsIntoChannelFolders touched deps under FILETUBE_READ_ONLY_MEDIA'); } });
  const lines = [];
  const realLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  let summary;
  try {
    summary = await migrateOneOffsIntoChannelFolders(poisonDeps, { enabled: true });
  } finally {
    console.log = realLog;
  }
  assert.deepEqual(summary, { moved: 0, skipped: 0, errors: 0, collisions: 0 });
  assert.ok(lines.some((l) => l.includes('one-off migration skipped')), 'the skip is logged');
});

test('per-instance operations stay fully live: likes, progress, settings', async () => {
  const { id } = seedVideo('still-usable [eeeeeeeeeee].mp4');

  const like = await fetch(`${base}/api/liked/${id}`, { method: 'POST' });
  assert.equal(like.status, 200, 'likes work');

  const ping = await fetch(`${base}/api/progress`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, timestamp: 5, duration: 12 }),
  });
  assert.equal(ping.status, 200, 'progress works');

  const settings = await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultView: 'grid' }),
  });
  assert.equal(settings.status, 200, 'settings work');
});
