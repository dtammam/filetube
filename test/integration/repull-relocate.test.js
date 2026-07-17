'use strict';

// [INTEGRATION][MANDATORY, MOVES USER FILES] v1.41.6 (Dean) --
// `relocateHydratedImportIntoChannelFolder`: the reheat's second half. Once
// v1.41.5 hydrates a MeTube-era import (a file in an ORDINARY library root, no
// `[videoid]` bracket, its only YouTube link an embedded purl tag) with its real
// channel identity, this pass physically MOVES the file into that channel's
// folder under the yt-dlp download dir, with the native
// `<title> [<videoId>].<ext>` filename -- so an import becomes
// indistinguishable from a download.
//
// This function moves USER FILES, so this suite is written adversarially: every
// way it could destroy something gets a test. The load-bearing invariants:
//   - genuine local media (no YouTube identity) is NEVER moved;
//   - the source is NEVER unlinked until the destination is verified;
//   - a destination collision is a SKIP, never a clobber;
//   - the id re-key carries progress, LIKE, thumbnail, transcode + audio
//     sidecars, subtitles and the reheat marker (the id is an md5 of the PATH --
//     see moveItemToFolder's header);
//   - the archive is appended (else the next subscription poll re-downloads it);
//   - it is idempotent, and the moved item SURVIVES the next scan.
//
// Mirrors test/integration/migrate-oneoffs.test.js's isolation pattern (own
// DATA_DIR, own process per file via `node --test`). ffmpeg/ffprobe are mocked
// at the child_process boundary (CI has no ffmpeg), like
// test/integration/repull-hydrate-rescan.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-repull-relocate-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');

const cp = require('child_process');

cp.exec = function mockExec(cmd, cb) {
  if (cmd === 'ffmpeg -version') {
    cb(null, 'ffmpeg version mock 1.0', '');
    return;
  }
  cb(new Error(`unexpected exec() call in test mock: ${cmd}`));
};

cp.execFile = function mockExecFile(bin, args, opts, cb) {
  if (typeof opts === 'function') { cb = opts; }
  if (bin === 'ffprobe') {
    cb(null, JSON.stringify({
      format: { duration: '42', tags: {} },
      streams: [
        { codec_type: 'video', codec_name: 'h264' },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    }), '');
    return;
  }
  cb(new Error(`unexpected execFile() call in test mock: ${bin}`));
};

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, loadDatabase, saveDatabase, updateDatabase, scanDirectories,
  relocateHydratedImportIntoChannelFolder, resolveRelocationTitle, transcodedPath,
  flushPendingProgress, userStore,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');
const ytdlp = require('../../lib/ytdlp');
const ytdlpArgs = require('../../lib/ytdlp/args');

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

let libraryDir; // an ORDINARY library root -- where MeTube put the file
let downloadDir; // FileTube's own yt-dlp download dir

beforeEach(() => {
  libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-relocate-lib-'));
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-relocate-dl-'));
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

// v1.42: persisted-state reads go through the sanctioned SQLite helper (a
// second, read-only connection). An EMPTY doc_kv namespace persists as zero
// rows (absent); backfill the ones this file dereferences so
// `db.progress[id]`/`db.deleteTombstones[id]`-style reads stay valid.
function readDb() {
  const db = readPersistedDatabase(DATA_DIR);
  for (const ns of ['metadata', 'progress', 'deleteTombstones']) {
    if (!db[ns]) db[ns] = {};
  }
  return db;
}

// A hydrated MeTube import, exactly as v1.41.5's reheat leaves it: in a plain
// library root, no filename bracket, but carrying a full channel identity +
// youtubeId + the reheat marker.
function seedHydratedImport(overrides = {}, dbOverrides = {}) {
  const fileName = overrides.fileName || 'Never Gonna Give You Up.mp4';
  const filePath = path.join(libraryDir, fileName);
  fs.writeFileSync(filePath, 'metube-video-bytes');
  const id = getMediaId(filePath);
  const item = {
    id, name: fileName, title: 'Never Gonna Give You Up', filePath,
    folderName: path.basename(libraryDir), rootFolder: libraryDir,
    size: fs.statSync(filePath).size, ext: path.extname(fileName), type: 'video',
    addedAt: Date.now(), duration: 213, hasThumbnail: true, artist: '',
    sourceTitle: 'Never Gonna Give You Up',
    youtubeId: VIDEO_ID,
    metadataRepulledAt: 1_800_000_000_000,
    ...CHANNEL,
    ...(overrides.item || {}),
  };
  saveDatabase({
    folders: [libraryDir],
    folderSettings: {},
    progress: {},
    metadata: { [id]: item },
    liked: [],
    deleteTombstones: {},
    // v1.42: pre-SQLite, saveDatabase was a whole-file replace, so a seed
    // implicitly wiped any ytdlp state a previous test left behind. The
    // diff-save keeps an ABSENT namespace's rows, so the seed now clears it
    // explicitly (present-but-empty deletes stale rows) -- overridable below.
    ytdlp: { allowMembersOnly: false, subscriptions: [], downloadMeta: {}, pins: [], channelAvatars: {} },
    settings: baseSettings(),
    ...dbOverrides,
  });
  return { filePath, id, fileName };
}

function expectedTarget(config, title = 'Never Gonna Give You Up', ext = '.mp4') {
  const dir = ytdlpArgs.resolveChannelDir(config, { name: CHANNEL.channelName, channelUrl: CHANNEL.channelUrl });
  return path.join(dir, `${title} [${VIDEO_ID}]${ext}`);
}

// ---- HEADLINE --------------------------------------------------------------

test('HEADLINE: a hydrated MeTube import is moved into its channel folder with the NATIVE filename shape, id re-keyed, and progress/liked/thumbnail/transcode/audio/subtitles all follow', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id: oldId } = seedHydratedImport();

  // Everything id-keyed or path-adjacent that must survive the move.
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${oldId}.jpg`), 'thumb-bytes');
  fs.mkdirSync(path.dirname(transcodedPath(oldId)), { recursive: true });
  fs.writeFileSync(transcodedPath(oldId), 'transcode-bytes');
  fs.writeFileSync(path.join(path.dirname(transcodedPath(oldId)), `${oldId}.m4a`), 'audio-bytes');
  fs.writeFileSync(path.join(libraryDir, 'Never Gonna Give You Up.en.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n');
  fs.writeFileSync(path.join(libraryDir, 'Never Gonna Give You Up.es.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHola\n');

  await updateDatabase((db) => {
    db.progress[oldId] = { timestamp: 55, duration: 213, updatedAt: '2026-07-01T00:00:00.000Z' };
    db.liked = [oldId];
    return true;
  });

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, oldId);
  assert.equal(result.status, 'moved', `expected a move, got ${result.status}: ${result.reason}`);

  const newPath = expectedTarget(config);
  const newId = getMediaId(newPath);
  assert.equal(result.newPath, newPath, 'the destination must be the SAME folder resolveChannelDir gives a subscription, with the native `<title> [<id>].<ext>` name');
  assert.equal(result.newId, newId);
  assert.ok(fs.existsSync(newPath), 'the file must physically be in the channel folder');
  assert.ok(!fs.existsSync(filePath), 'the old library path must be gone');
  assert.equal(fs.readFileSync(newPath, 'utf8'), 'metube-video-bytes', 'the bytes must be intact');

  const db = readDb();
  assert.ok(!db.metadata[oldId], 'the OLD id must be gone (the id is an md5 of the PATH)');
  const item = db.metadata[newId];
  assert.ok(item, 'the NEW path-derived id must be present');
  assert.equal(item.filePath, newPath);
  assert.equal(item.id, newId);
  assert.equal(item.name, `Never Gonna Give You Up [${VIDEO_ID}].mp4`, '`name` must follow the rename (the FR-2 bridge reads the [id] bracket back out of it)');
  assert.equal(item.folderName, 'Rick Astley', 'the sidebar folder label must be the channel');
  assert.equal(item.rootFolder, downloadDir, 'rootFolder must be re-derived -- the item crossed from a library root into the download root');
  assert.equal(item.channelUrl, CHANNEL.channelUrl, 'the hydrated identity must survive the move');
  assert.equal(item.youtubeId, VIDEO_ID);
  assert.equal(item.metadataRepulledAt, 1_800_000_000_000, 'the reheat marker must survive (else the item is re-fetched forever)');

  assert.deepStrictEqual(db.progress[newId], { timestamp: 55, duration: 213, updatedAt: '2026-07-01T00:00:00.000Z' }, 'watch progress must survive under the new id');
  assert.ok(!db.progress[oldId]);
  assert.deepStrictEqual(db.liked, [newId], 'the LIKE must survive the re-key (db.liked is an array of media ids)');

  assert.ok(fs.existsSync(path.join(THUMBNAIL_DIR, `${newId}.jpg`)), 'the thumbnail must be re-keyed');
  assert.ok(!fs.existsSync(path.join(THUMBNAIL_DIR, `${oldId}.jpg`)));
  assert.ok(fs.existsSync(transcodedPath(newId)), 'the transcode sidecar must be re-keyed');
  assert.ok(fs.existsSync(path.join(path.dirname(transcodedPath(newId)), `${newId}.m4a`)), 'the background-audio sidecar must be re-keyed');
  assert.ok(!fs.existsSync(path.join(path.dirname(transcodedPath(oldId)), `${oldId}.m4a`)));

  const channelDir = path.dirname(newPath);
  assert.ok(fs.existsSync(path.join(channelDir, `Never Gonna Give You Up [${VIDEO_ID}].en.vtt`)), 'the .en.vtt sidecar must follow, renamed onto the new basename');
  assert.ok(fs.existsSync(path.join(channelDir, `Never Gonna Give You Up [${VIDEO_ID}].es.vtt`)), 'EVERY language sidecar must follow -- not just the first one the resolver ranks');
  assert.ok(!fs.existsSync(path.join(libraryDir, 'Never Gonna Give You Up.en.vtt')));
  assert.ok(!fs.existsSync(path.join(libraryDir, 'Never Gonna Give You Up.es.vtt')));

  // The archive: load-bearing. The file now sits in a channel folder under the
  // download root, so a subscription poll of that channel would re-download it.
  const archive = fs.readFileSync(path.join(downloadDir, '.ytdlp-archive.txt'), 'utf8');
  assert.match(archive, new RegExp(`^youtube ${VIDEO_ID}$`, 'm'), 'the moved video must be recorded in the shared download archive');
});

// ---- The subscribed-channel folder trap ------------------------------------
//
// A SUBSCRIPTION's download folder is `resolveChannelDir(config, sub)` -- which
// folds `sub.name`, the name the user subscribed under (typically the @handle).
// The item carries yt-dlp's REAL channel display name. Those routinely sanitize
// differently. Relocating by `channelName` would file a subscribed channel's
// import into a PARALLEL folder while that subscription's own downloads keep
// landing in the original one: one channel, two sidebar folders, forever.

test('a SUBSCRIBED channel\'s import lands in that subscription\'s EXISTING folder (byte-identical), never a parallel channelName-derived one', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id } = seedHydratedImport();

  // The user subscribed by @handle -- so the subscription's folder is
  // "-RickAstley"-shaped, NOT "Rick Astley".
  const sub = {
    id: 'sub-1',
    channelUrl: CHANNEL.channelHandleUrl,
    channelId: CHANNEL.channelId,
    name: '@RickAstley',
    format: 'video',
    quality: 'best',
  };
  await updateDatabase((db) => {
    db.ytdlp = { allowMembersOnly: false, subscriptions: [sub], downloadMeta: {}, pins: [], channelAvatars: {} };
    return true;
  });
  const subDir = ytdlpArgs.resolveChannelDir(config, sub);
  const channelNameDir = ytdlpArgs.resolveChannelDir(config, { name: CHANNEL.channelName });
  assert.notEqual(subDir, channelNameDir, 'sanity: the two folder derivations really do differ');

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(result.status, 'moved');
  assert.equal(path.dirname(result.newPath), subDir, 'the import must land in the SUBSCRIPTION\'s own folder');
  assert.ok(!fs.existsSync(channelNameDir), 'a parallel channelName folder must never be created for a subscribed channel');
  assert.equal(readDb().metadata[getMediaId(result.newPath)].folderName, path.basename(subDir));
});

test('an UNSUBSCRIBED channel\'s import lands in a folder derived from its display name (what a one-shot download of that channel would also produce)', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id } = seedHydratedImport();
  await updateDatabase((db) => {
    // A subscription to a DIFFERENT channel must not attract this item.
    db.ytdlp = {
      allowMembersOnly: false,
      subscriptions: [{ id: 'sub-x', channelUrl: 'https://www.youtube.com/@SomeoneElse', channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz', name: '@SomeoneElse' }],
      downloadMeta: {}, pins: [], channelAvatars: {},
    };
    return true;
  });

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(result.status, 'moved');
  assert.equal(path.dirname(result.newPath), ytdlpArgs.resolveChannelDir(config, { name: CHANNEL.channelName }));
});

// ---- IDEMPOTENCE + the scan ------------------------------------------------

test('idempotent: a second reheat finds the item already under the download root and does NOT move it again', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id } = seedHydratedImport();

  const first = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(first.status, 'moved');
  const newId = first.newId;
  const newPath = first.newPath;

  const second = await relocateHydratedImportIntoChannelFolder(DEPS, config, newId);
  assert.equal(second.status, 'skipped', 'a re-run must not move the file twice');
  assert.equal(second.reason, 'already-in-download-root');
  assert.equal(readDb().metadata[newId].filePath, newPath, 'the item is untouched by the re-run');
  assert.equal(Object.keys(readDb().metadata).length, 1, 'no duplicate/ghost entry');
});

test('MANDATORY RE-KEY REGRESSION: move -> rescan -> the item survives under its new id with identity, progress and Like intact (never a delete + new-add)', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id: oldId } = seedHydratedImport();
  await updateDatabase((db) => {
    db.progress[oldId] = { timestamp: 90, duration: 213, updatedAt: '2026-07-02T00:00:00.000Z' };
    db.liked = [oldId];
    return true;
  });

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, oldId);
  assert.equal(result.status, 'moved');
  const newId = result.newId;

  // The very next scan, exactly as if the periodic timer fired right after.
  await scanDirectories();

  const db = readDb();
  assert.ok(db.metadata[newId], 'the moved item must still be indexed under its new id');
  assert.ok(!db.metadata[oldId], 'the OLD id must never be resurrected');
  assert.equal(Object.keys(db.metadata).length, 1, 'exactly one entry -- not a prune + fresh re-add');
  assert.deepStrictEqual(db.progress[newId], { timestamp: 90, duration: 213, updatedAt: '2026-07-02T00:00:00.000Z' }, 'watch progress must be byte-identical after the scan');
  assert.deepStrictEqual(db.liked, [newId], 'the Like must survive the scan');
  assert.equal(db.metadata[newId].channelUrl, CHANNEL.channelUrl, 'the identity must survive the scan');
  assert.equal(db.metadata[newId].youtubeId, VIDEO_ID);
  assert.equal(db.metadata[newId].metadataRepulledAt, 1_800_000_000_000, 'the reheat marker must survive the scan');
});

// PERSIST-GATE CHECKPOINT (the class's SEVENTH potential strike -- the sixth was
// last release). `mergeScannedMetadata` is AUTHORITATIVE FOR MEMBERSHIP: an id
// absent from the scan's own Phase-1 walk is deleted from db.metadata. A move
// that lands MID-SCAN produces exactly such an id (the file was walked at its
// OLD path), so the wholesale replace would have deleted the relocated item
// outright. The reheat is a library-wide batch with NO mutual exclusion against
// the periodic scan, so this is not a narrow race.
test('a relocation that lands MID-SCAN is not wiped by the scan\'s wholesale metadata replace', async () => {
  const config = ytdlp.parseYtdlpConfig();
  // Enough files that the scan is definitely still in Phase 1 when the move
  // lands (mirrors repull-hydrate-rescan.test.js's own mid-scan harness).
  for (let i = 0; i < 300; i++) {
    fs.writeFileSync(path.join(libraryDir, `pad-${i}.mp4`), `pad-bytes-${i}`);
  }
  const { id: oldId } = seedHydratedImport();
  await scanDirectories(); // index the padding + the import
  await updateDatabase((db) => {
    db.progress[oldId] = { timestamp: 12, duration: 213, updatedAt: '2026-07-03T00:00:00.000Z' };
    db.liked = [oldId];
    return true;
  });

  // A periodic scan starts (its Phase-1 walk sees the import at its OLD path)...
  const scanPromise = scanDirectories();
  // ...and the reheat relocates the file WHILE that scan is running.
  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, oldId);
  assert.equal(result.status, 'moved', 'sanity: the move itself succeeded');
  const newId = result.newId;
  await scanPromise; // the scan finishes and saves its (now stale) view

  const db = readDb();
  assert.ok(db.metadata[newId], 'the relocated item must SURVIVE a scan that never saw its new path');
  assert.ok(!db.metadata[oldId], 'and the old id must not be resurrected at a path where no file exists');
  assert.equal(db.metadata[newId].filePath, result.newPath);
  assert.equal(db.metadata[newId].channelUrl, CHANNEL.channelUrl, 'identity intact');
  assert.deepStrictEqual(db.progress[newId], { timestamp: 12, duration: 213, updatedAt: '2026-07-03T00:00:00.000Z' }, 'progress intact');
  assert.deepStrictEqual(db.liked, [newId], 'the Like intact');
});

// ---- INELIGIBLE: the things that must NEVER be moved ------------------------

test('genuine LOCAL MEDIA (no channel, no youtubeId) is never moved -- the file and its db entry are untouched', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const filePath = path.join(libraryDir, 'Family BBQ.mp4');
  fs.writeFileSync(filePath, 'home-video-bytes');
  const id = getMediaId(filePath);
  saveDatabase({
    folders: [libraryDir], folderSettings: {}, progress: {}, liked: [], deleteTombstones: {},
    metadata: {
      [id]: {
        id, name: 'Family BBQ.mp4', title: 'Family BBQ', filePath,
        folderName: path.basename(libraryDir), rootFolder: libraryDir,
        size: 16, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 10,
        hasThumbnail: false, artist: '',
      },
    },
    settings: baseSettings(),
  });

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no-youtube-identity');
  assert.ok(fs.existsSync(filePath), 'a home video must stay exactly where the user put it');
  assert.equal(readDb().metadata[id].filePath, filePath);
  assert.equal(fs.readdirSync(downloadDir).length, 0, 'nothing may be created in the download dir');
});

test('an item with a channel but NO valid youtubeId is never moved (the id is what makes it a YouTube video)', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id } = seedHydratedImport({ item: { youtubeId: 'not an id!' } });

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no-youtube-identity');
  assert.ok(fs.existsSync(filePath));
});

// `isSafeVideoId` (the repo-wide `?v=` param rule) accepts 1-64 safe characters,
// but `extractYtdlpVideoId` -- the READER, and what the scan re-derives an id
// from -- only recognizes the exact 11-character YouTube shape. An id that
// passes the first and fails the second would land a file whose `[bracket]` is
// decorative, silently defeating the whole point of the native filename. The
// relocator asks the reader instead of assuming, and skips.
test('an id that is charset-safe but NOT the 11-char bracket shape is never moved (the filename bracket must round-trip)', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id } = seedHydratedImport({ item: { youtubeId: 'short-id' } });

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'id-not-bracket-shaped');
  assert.ok(fs.existsSync(filePath), 'the file stays put -- a decorative bracket is not worth a move');
  assert.equal(readDb().metadata[id].filePath, filePath);
});

test('an item whose channelUrl does not survive re-validation is never moved (the persisted field is re-checked at the move boundary)', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id } = seedHydratedImport({ item: { channelUrl: 'https://evil.example.com/@notyoutube' } });

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no-youtube-identity');
  assert.ok(fs.existsSync(filePath));
});

test('an item with an EMPTY channelName is never moved (there is no folder to file it under)', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id } = seedHydratedImport({ item: { channelName: '   ' } });

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no-youtube-identity');
  assert.ok(fs.existsSync(filePath));
  assert.equal(fs.readdirSync(downloadDir).length, 0, 'no "channel" fallback folder may be created');
});

test('a NATIVE download (already under the download root) is never moved, even when its folder disagrees with its channelName', async () => {
  const config = ytdlp.parseYtdlpConfig();
  // A subscription's folder is derived from `sub.name`; `channelName` is
  // yt-dlp's real display name. Those routinely differ -- and relocating on that
  // mismatch is the library-wide-reorg hazard the v1.25 gate caught.
  const subDir = path.join(downloadDir, 'My Sub Name');
  fs.mkdirSync(subDir, { recursive: true });
  const filePath = path.join(subDir, `Some Video [${VIDEO_ID}].mp4`);
  fs.writeFileSync(filePath, 'bytes');
  const id = getMediaId(filePath);
  saveDatabase({
    folders: [], folderSettings: {}, progress: {}, liked: [], deleteTombstones: {},
    metadata: {
      [id]: {
        id, name: path.basename(filePath), title: 'Some Video', filePath,
        folderName: 'My Sub Name', rootFolder: downloadDir,
        size: 5, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 10,
        hasThumbnail: false, artist: '', youtubeId: VIDEO_ID, ...CHANNEL,
      },
    },
    settings: baseSettings(),
  });

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'already-in-download-root');
  assert.ok(fs.existsSync(filePath), 'a subscription-foldered download must never be relocated');
  assert.ok(!fs.existsSync(path.join(downloadDir, 'Rick Astley')), 'the channelName-derived folder must never even be created');
});

test('the module being DISABLED is a hard no-op: no move, no folder, no db change', async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  const config = ytdlp.parseYtdlpConfig();
  assert.equal(ytdlp.isEnabled(config), false, 'sanity: the module must be disabled');
  const { filePath, id } = seedHydratedImport();

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'module-disabled');
  assert.ok(fs.existsSync(filePath));
  assert.equal(readDb().metadata[id].filePath, filePath);
});

test('the settings toggle OFF stops the move (default is ON)', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id } = seedHydratedImport();
  await updateDatabase((db) => { db.settings.relocateHydratedImports = false; return true; });

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'setting-off');
  assert.ok(fs.existsSync(filePath), 'the file must stay put when the operator opted out');
  assert.equal(readDb().metadata[id].filePath, filePath);
});

test('an item whose file has vanished from disk is skipped, not failed (and nothing is written)', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id } = seedHydratedImport();
  fs.rmSync(filePath);

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'file-missing');
  assert.equal(readDb().metadata[id].filePath, filePath, 'the db entry is left exactly as it was');
});

// ---- COLLISION: never clobber ---------------------------------------------

test('COLLISION: a destination that already holds the same video is a SKIP -- the existing file is NOT clobbered and the import stays put', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id } = seedHydratedImport();

  // The same video, already downloaded natively into the channel folder.
  const target = expectedTarget(config);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'the-native-download-bytes');

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'destination-occupied');

  assert.equal(fs.readFileSync(target, 'utf8'), 'the-native-download-bytes', 'the pre-existing file must NOT be clobbered');
  assert.ok(fs.existsSync(filePath), 'the import must stay exactly where it was');
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'metube-video-bytes');
  assert.equal(readDb().metadata[id].filePath, filePath, 'the db entry is untouched -- no re-key on a skipped move');
});

// ---- CROSS-DEVICE (EXDEV): Dean's NAS -> local downloadDir case -------------
//
// `moveItemToFolder` moves with an atomically-exclusive `linkSync` (never a
// clobbering `renameSync`); a hard link cannot span filesystems, so the EXDEV
// fallback is the copy path. Dean's MeTube folder may well be on a NAS while the
// download dir is local, so this is the EXPECTED path there -- and the one where
// a bad copy followed by an unlinked source would be real data loss.

function exdevFs(overrides = {}) {
  // A thin proxy over the real fs: linkSync always fails EXDEV, forcing the
  // cross-device copy fallback. Everything else is genuine, so the test observes
  // real bytes on a real filesystem.
  return Object.assign(Object.create(fs), {
    linkSync() { const e = new Error('cross-device link not permitted'); e.code = 'EXDEV'; throw e; },
    ...overrides,
  });
}

test('EXDEV: the cross-device copy fallback moves the file (and its sidecars) correctly, source removed only after the copy is verified', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id: oldId } = seedHydratedImport();
  fs.writeFileSync(path.join(libraryDir, 'Never Gonna Give You Up.en.vtt'), 'WEBVTT\n');

  const deps = { ...DEPS, fs: exdevFs() };
  const result = await relocateHydratedImportIntoChannelFolder(deps, config, oldId);
  assert.equal(result.status, 'moved', `expected the EXDEV copy fallback to succeed, got: ${result.reason}`);

  const newPath = expectedTarget(config);
  assert.ok(fs.existsSync(newPath));
  assert.equal(fs.readFileSync(newPath, 'utf8'), 'metube-video-bytes', 'the copy must be byte-for-byte');
  assert.ok(!fs.existsSync(filePath), 'the source is unlinked only AFTER the destination verifies');
  assert.ok(fs.existsSync(path.join(path.dirname(newPath), `Never Gonna Give You Up [${VIDEO_ID}].en.vtt`)), 'the subtitle sidecar must cross the device boundary too');
  assert.ok(readDb().metadata[getMediaId(newPath)], 'the id re-key happened');
});

test('EXDEV: a SHORT/TORN cross-device copy never unlinks the source -- the move fails honestly and the db is untouched', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id } = seedHydratedImport();
  const before = fs.readFileSync(filePath, 'utf8');

  // The copy "succeeds" but writes a truncated destination -- a short write on a
  // full/flaky NAS. The size verification must catch it BEFORE the unlink.
  const deps = {
    ...DEPS,
    fs: exdevFs({
      copyFileSync(_src, dest) { fs.writeFileSync(dest, 'trunc'); },
    }),
  };

  const result = await relocateHydratedImportIntoChannelFolder(deps, config, id);
  assert.equal(result.status, 'failed', 'a torn copy must be reported honestly, never counted as a move');
  assert.match(result.reason, /verification failed/i);

  assert.ok(fs.existsSync(filePath), 'THE SOURCE FILE MUST STILL EXIST -- this is the data-loss line');
  assert.equal(fs.readFileSync(filePath, 'utf8'), before, 'and be byte-identical');
  assert.ok(!fs.existsSync(expectedTarget(config)), 'the bad partial destination must be cleaned up');
  const item = readDb().metadata[id];
  assert.ok(item, 'the db entry must NOT have been re-keyed');
  assert.equal(item.filePath, filePath);
});

test('a destination WRITE FAILURE (ENOSPC on the copy) never unlinks the source and never re-keys the db', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id } = seedHydratedImport();

  const deps = {
    ...DEPS,
    fs: exdevFs({
      copyFileSync() { const e = new Error('no space left on device'); e.code = 'ENOSPC'; throw e; },
    }),
  };

  const result = await relocateHydratedImportIntoChannelFolder(deps, config, id);
  assert.equal(result.status, 'failed');
  assert.ok(fs.existsSync(filePath), 'the source file must survive a failed destination write');
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'metube-video-bytes');
  assert.equal(readDb().metadata[id].filePath, filePath, 'no re-key on a failed move');
});

// ---- The deletion-tombstone hazard at the DESTINATION path ------------------
//
// v1.41.3 tombstones are keyed by media id = md5(PATH). If the user once deleted
// a file at the path we are about to move into, its tombstone is still standing
// -- and the scan's deferred-delete retry would compare our freshly-moved file's
// (older) mtime against that delete and UNLINK the file we just relocated.

test('a stale deletion tombstone at the DESTINATION path is retired by the move -- the next scan must not reap the relocated file', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id: oldId } = seedHydratedImport();
  // The imported file predates the delete (the move preserves its mtime), which
  // is exactly what makes the scan's deferred-delete retry judge it "the file
  // the user already deleted" and unlink it.
  const anHourAgo = new Date(Date.now() - 3600_000);
  fs.utimesSync(filePath, anHourAgo, anHourAgo);

  const target = expectedTarget(config);
  const targetId = getMediaId(target);
  await updateDatabase((db) => {
    // The user deleted a file at this exact path a moment ago.
    db.deleteTombstones[targetId] = { filePath: target, deletedAt: Date.now() };
    return true;
  });

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, oldId);
  assert.equal(result.status, 'moved');
  assert.equal(readDb().deleteTombstones[targetId], undefined, 'the tombstone at the destination path must be retired by a deliberate move into it');

  await scanDirectories();

  assert.ok(fs.existsSync(target), 'THE RELOCATED FILE MUST NOT BE REAPED by the scan\'s deferred-delete retry');
  assert.ok(readDb().metadata[targetId], 'and it must still be indexed');
});

// ---- The filename builder --------------------------------------------------

test('resolveRelocationTitle: prefers the reheat\'s real sourceTitle, strips path-dangerous characters, never yields an empty name', () => {
  assert.equal(
    resolveRelocationTitle({ sourceTitle: 'Rick Astley - Never Gonna Give You Up', filePath: '/x/whatever.mp4' }),
    'Rick Astley - Never Gonna Give You Up',
    'spaces and ordinary punctuation are KEPT (this is what --windows-filenames does)',
  );
  assert.equal(
    resolveRelocationTitle({ sourceTitle: 'AC/DC: Back in Black? <live>', filePath: '/x/y.mp4' }),
    'AC-DC- Back in Black- -live-',
    'every path-dangerous character is neutralized',
  );
  assert.equal(
    resolveRelocationTitle({ sourceTitle: '../../etc/passwd', filePath: '/x/y.mp4' }),
    'etc-passwd',
    'traversal sequences and separators cannot survive, and no leading dash/dot is left behind',
  );
  assert.equal(
    resolveRelocationTitle({ filePath: `/x/Some Video [${VIDEO_ID}].mp4` }),
    'Some Video',
    'with no sourceTitle it falls back to the basename with any existing [id] bracket STRIPPED -- never `Title [id] [id]`',
  );
  assert.equal(resolveRelocationTitle({ sourceTitle: '   ...   ', filePath: '/x/y.mp4' }), 'video', 'a title that sanitizes to nothing still yields a usable name');
  // Length is bounded in BYTES, not characters (NAME_MAX is 255 BYTES) -- see the
  // CJK/emoji tests below. For pure ASCII the two coincide.
  assert.equal(Buffer.byteLength(resolveRelocationTitle({ sourceTitle: 'x'.repeat(400), filePath: '/x/y.mp4' }), 'utf8'), 200, 'and it is byte-bounded (ENAMETOOLONG)');
});

test('a title that already carries an [id] bracket is not double-bracketed when the file is relocated', async () => {
  const config = ytdlp.parseYtdlpConfig();
  // A MeTube import whose filename already looks yt-dlp-ish, with no sourceTitle
  // (so the fallback path runs).
  const { id } = seedHydratedImport({
    fileName: `Never Gonna Give You Up [${VIDEO_ID}].mp4`,
    item: { sourceTitle: undefined },
  });

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(result.status, 'moved');
  assert.equal(path.basename(result.newPath), `Never Gonna Give You Up [${VIDEO_ID}].mp4`, 'exactly ONE [id] bracket');
});

test('a non-mp4 extension is preserved verbatim (an imported .mp3 stays an .mp3 -- nothing is transcoded by a move)', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id } = seedHydratedImport({
    fileName: 'Never Gonna Give You Up.mp3',
    item: { ext: '.mp3', type: 'audio' },
  });

  const result = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(result.status, 'moved');
  assert.equal(result.newPath, expectedTarget(config, 'Never Gonna Give You Up', '.mp3'));
  assert.ok(fs.existsSync(result.newPath));
});

// ===========================================================================
// GATE FIX ROUND -- the adversarial seat's repros, promoted verbatim in intent.
// Every test below FAILS with its fix reverted (mutation-tested).
// ===========================================================================

// ---- CRITICAL 1: THE SCAN DESTROYS THE RELOCATED FILE ----------------------
//
// A v1.41.3 deletion tombstone at the DESTINATION path tells the scan's
// deferred-delete retry to unlink any file it later finds there with an older
// mtime. `linkSync` (the ordinary SAME-VOLUME Docker install) preserves the inode
// and therefore the ORIGINAL mtime -- so a relocated file matches that
// description exactly. Retiring the tombstone at the END of the move (in the
// re-key mutator, AFTER the source was already unlinked) left a window in which
// the ONLY copy of the file sat at a path db.json still called deleted.
// Cruel inversion: the EXDEV/NAS path was SAFE (copyFileSync resets the mtime);
// the lethal case was the ordinary local install.

test('CRITICAL: the destination tombstone is retired BEFORE any byte moves -- at the instant the source is unlinked, db.json no longer calls the destination deleted', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id: oldId } = seedHydratedImport();
  const anHourAgo = new Date(Date.now() - 3600_000);
  fs.utimesSync(filePath, anHourAgo, anHourAgo); // older than the delete: the reap condition

  const target = expectedTarget(config);
  const targetId = getMediaId(target);
  await updateDatabase((db) => {
    db.deleteTombstones[targetId] = { filePath: target, deletedAt: Date.now() };
    return true;
  });

  // Observe the on-disk world at the exact instant the source is unlinked -- the
  // point of no return. If db.json still carried the tombstone here, a crash (or
  // merely a scan already in flight) would reap the only remaining copy.
  let atUnlink = null;
  const spyFs = Object.create(fs);
  spyFs.unlinkSync = (p) => {
    const r = fs.unlinkSync(p);
    if (p === filePath) {
      atUnlink = {
        sourceExists: fs.existsSync(filePath),
        destExists: fs.existsSync(target),
        tombstone: readDb().deleteTombstones[targetId],
      };
    }
    return r;
  };

  const res = await relocateHydratedImportIntoChannelFolder(
    { loadDatabase, updateDatabase, getMediaId, fs: spyFs }, config, oldId);
  assert.equal(res.status, 'moved');

  assert.ok(atUnlink, 'sanity: the source really was unlinked');
  assert.equal(atUnlink.sourceExists, false);
  assert.equal(atUnlink.destExists, true);
  assert.equal(atUnlink.tombstone, undefined,
    'THE LETHAL WINDOW: db.json must NOT still call the destination deleted at the moment the only other copy is removed');
});

test('CRITICAL: a CRASH between the filesystem move and the db re-key leaves the file intact -- the next scan does not reap it, and the source is still there', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id: oldId } = seedHydratedImport();
  const anHourAgo = new Date(Date.now() - 3600_000);
  fs.utimesSync(filePath, anHourAgo, anHourAgo);

  const target = expectedTarget(config);
  const targetId = getMediaId(target);
  await updateDatabase((db) => {
    db.deleteTombstones[targetId] = { filePath: target, deletedAt: Date.now() };
    return true;
  });

  // Simulate PROCESS DEATH in the window: the FIRST updateDatabase (the pre-move
  // tombstone retirement) commits for real; the re-key never lands; and -- unlike
  // an ordinary db-write failure, which rolls the destination back (its own test
  // below) -- a SIGKILL/OOM gets no chance to clean up, so the destination link
  // stays on disk. This is the worst on-disk state the window can produce.
  let calls = 0;
  const crashingUpdateDatabase = (fn) => {
    calls += 1;
    if (calls === 1) return updateDatabase(fn); // the tombstone retirement -- commits
    return Promise.reject(new Error('simulated SIGKILL before the re-key committed'));
  };
  const noCleanupFs = Object.create(fs);
  noCleanupFs.unlinkSync = (p) => (p === target ? undefined : fs.unlinkSync(p)); // the process died before it could roll back

  const res = await relocateHydratedImportIntoChannelFolder(
    { loadDatabase, updateDatabase: crashingUpdateDatabase, getMediaId, fs: noCleanupFs }, config, oldId);
  assert.equal(res.status, 'failed', 'the relocation reports failure honestly');

  // The crash-window state, on disk: the bytes exist at BOTH paths (a hard link),
  // db.json still points at the source, and the tombstone is GONE.
  assert.ok(fs.existsSync(filePath), 'the SOURCE is still in place -- it is unlinked only after a committed re-key');
  assert.ok(fs.existsSync(target), 'the destination link exists');
  assert.equal(readDb().deleteTombstones[targetId], undefined, 'the tombstone was retired BEFORE the filesystem was touched -- crashing here loses a tombstone, never a file');

  await scanDirectories();

  assert.ok(fs.existsSync(target),
    'THE RELOCATED FILE MUST SURVIVE THE SCAN. With the tombstone still live here, the scan would have unlinked it -- and on the real code path the source would already be gone, making that irreversible.');
  assert.ok(fs.existsSync(filePath), 'and the source, which the db still points at, is untouched');
});

test('CRITICAL: an IN-FLIGHT scan (holding a stale Phase-1 tombstone snapshot) does not reap a file relocated underneath it -- no crash required', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id: oldId } = seedHydratedImport();
  const anHourAgo = new Date(Date.now() - 3600_000);
  fs.utimesSync(filePath, anHourAgo, anHourAgo);

  const target = expectedTarget(config);
  const targetId = getMediaId(target);
  await updateDatabase((db) => {
    db.deleteTombstones[targetId] = { filePath: target, deletedAt: Date.now() };
    return true;
  });

  // The periodic scan starts and takes its Phase-1 snapshot -- WITH the tombstone.
  const scanPromise = scanDirectories();
  // ...and the reheat relocates the file while it runs. The scan's snapshot is now
  // stale: it still believes the destination path is a deleted file.
  const res = await relocateHydratedImportIntoChannelFolder(DEPS, config, oldId);
  assert.equal(res.status, 'moved');
  assert.equal(readDb().deleteTombstones[targetId], undefined, 'the live db has retired the tombstone');
  await scanPromise;

  assert.ok(fs.existsSync(target),
    'The in-flight scan must RE-VERIFY the tombstone against the fresh db before unlinking anything. Reaping here destroys the only copy -- the source is already gone.');
  assert.ok(readDb().metadata[getMediaId(target)], 'and the item is still indexed at its new path');
});

// ---- W-3: 120 CHARACTERS != 255 BYTES --------------------------------------

test('a long CJK title relocates successfully -- the length cap is measured in BYTES (NAME_MAX), not characters', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const cjkTitle = '実況'.repeat(70); // 140 chars; a 120-CHAR cap would emit 360 BYTES -> ENAMETOOLONG
  const { id } = seedHydratedImport({ item: { sourceTitle: cjkTitle } });

  const res = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(res.status, 'moved', `a CJK title must not ENAMETOOLONG (got ${res.status}: ${res.reason})`);
  const name = path.basename(res.newPath);
  assert.ok(Buffer.byteLength(name, 'utf8') <= 255, `the on-disk name must fit NAME_MAX: ${Buffer.byteLength(name, 'utf8')} bytes`);
  assert.ok(fs.existsSync(res.newPath));
});

test('an emoji title is truncated on a CODE-POINT boundary -- never half a surrogate pair', () => {
  const title = '🎬'.repeat(100); // 4 bytes each = 400 bytes
  const built = resolveRelocationTitle({ sourceTitle: title, filePath: '/x/y.mp4' });
  assert.ok(Buffer.byteLength(built, 'utf8') <= 200);
  assert.ok(!built.includes('�'), 'no replacement character -- the cut never split a code point');
  assert.equal([...built].every((cp) => cp === '🎬'), true, 'every surviving code point is a whole emoji');
});

// ---- W-4 / W-5: do not move what is in use ---------------------------------

test('a file that is being WATCHED (served within RECENT_STREAM_MS) is not moved -- the client would keep using the old id for the rest of the session', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id } = seedHydratedImport();

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // v1.43: auth through the real gate
  try {
    // Stream it (this is what marks the path live-watched).
    const res = await fetch(`${base}/video/${id}`, { headers: { Range: 'bytes=0-3' } });
    await res.arrayBuffer();

    const relocation = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
    assert.equal(relocation.status, 'skipped');
    assert.equal(relocation.reason, 'recently-watched');
    assert.ok(fs.existsSync(filePath), 'the file someone is watching stays exactly where it is');
    assert.equal(readDb().metadata[id].filePath, filePath);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('watch progress posted just before a move is NOT lost: pendingProgress is re-keyed onto the new id', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id: oldId } = seedHydratedImport();
  const newId = getMediaId(expectedTarget(config));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = authenticateFetch(server, base); // v1.43: auth through the real gate
  try {
    // A ping lands in the debounced pendingProgress staging map (NOT yet in db).
    const posted = await fetch(`${base}/api/progress`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: oldId, timestamp: 120, duration: 213 }),
    });
    assert.equal(posted.status, 200);

    // The reheat relocates the file underneath it. (The live-watch clause does not
    // fire here: a progress PING is not a serve.)
    const relocation = await relocateHydratedImportIntoChannelFolder(DEPS, config, oldId);
    assert.equal(relocation.status, 'moved');

    await flushPendingProgress(); // the debounce timer fires

    // v1.43: positions are per-user rows now -- the pending ping must land in
    // user_progress under the NEW id (flushPendingProgress drops any id whose
    // metadata entry is gone, so an un-re-keyed pending ping is silently
    // destroyed).
    const row = userStore.getOneProgress(auth.user.id, newId);
    assert.equal(row && row.timestamp, 120,
      'the pending ping must be flushed against the NEW id');
    assert.equal(userStore.getOneProgress(auth.user.id, oldId), null, 'and nothing is left under the dead id');
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('an item with an in-flight TRANSCODE (or audio-extract) job is not moved -- the job would be silently dropped and the item left permanently non-playable', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id } = seedHydratedImport({ item: { transcodeStatus: 'processing' } });

  const res = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(res.status, 'skipped');
  assert.equal(res.reason, 'transcode-or-audio-job-in-flight');
  assert.ok(fs.existsSync(filePath));

  // Same for a queued (not yet started) audio extraction.
  const { filePath: p2, id: id2 } = seedHydratedImport({ fileName: 'Other.mp4', item: { audioStatus: 'pending' } });
  const res2 = await relocateHydratedImportIntoChannelFolder(DEPS, config, id2);
  assert.equal(res2.status, 'skipped');
  assert.equal(res2.reason, 'transcode-or-audio-job-in-flight');
  assert.ok(fs.existsSync(p2));
});

// ---- CRITICAL 2 (end to end): the unpolled @handle subscription ------------

test('THE SPLIT-LIBRARY CRITICAL, end to end: an import whose channel is subscribed by @handle but NEVER POLLED (no channelId) still lands in that subscription\'s own folder', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id } = seedHydratedImport({
    item: { channelHandleUrl: 'https://www.youtube.com/@RickAstley' },
  });

  // EXACTLY what addSubscription writes: handle URL, no channelId.
  const sub = { id: 'sub-unpolled', channelUrl: 'https://www.youtube.com/@RickAstley', name: '@RickAstley', format: 'video', quality: 'best' };
  await updateDatabase((db) => {
    db.ytdlp = { allowMembersOnly: false, subscriptions: [sub], downloadMeta: {}, pins: [], channelAvatars: {} };
    return true;
  });
  const subDir = ytdlpArgs.resolveChannelDir(config, sub);
  const channelNameDir = ytdlpArgs.resolveChannelDir(config, { name: CHANNEL.channelName });
  assert.notEqual(subDir, channelNameDir, 'sanity: the two derivations differ');

  const res = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(res.status, 'moved');
  assert.equal(path.dirname(res.newPath), subDir, 'the import must land where that subscription downloads');
  assert.ok(!fs.existsSync(channelNameDir), 'NO parallel folder -- one channel, one folder');

  // Belt-and-braces: the validated channelId is opportunistically recorded onto
  // the subscription, so every future join is exact.
  assert.equal(readDb().ytdlp.subscriptions[0].channelId, CHANNEL.channelId);
});

test('when the subscription join is UNDECIDABLE (unpolled @handle sub, item with no handle URL), nothing is moved -- a skipped file is recoverable, a split library is not', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id } = seedHydratedImport({ item: { channelHandleUrl: undefined } });
  await updateDatabase((db) => {
    db.ytdlp = {
      allowMembersOnly: false,
      subscriptions: [{ id: 's1', channelUrl: 'https://www.youtube.com/@RickAstley', name: '@RickAstley' }],
      downloadMeta: {}, pins: [], channelAvatars: {},
    };
    return true;
  });

  const res = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(res.status, 'skipped');
  assert.equal(res.reason, 'ambiguous-subscription');
  assert.ok(fs.existsSync(filePath), 'the file stays put');
  assert.equal(fs.readdirSync(downloadDir).length, 0, 'and no folder of any kind is created');
});

test('C2-RESIDUAL (gate round 2): an id-less /c/ subscription for this channel makes the relocation SKIP -- no parallel folder is created', async () => {
  const config = ytdlp.parseYtdlpConfig();
  // A fully-hydrated item (it even has channelHandleUrl) -- which is exactly the
  // point: possessing the ITEM's handle tells you nothing about a `/c/` SUB.
  const { filePath, id } = seedHydratedImport({
    item: { channelHandleUrl: 'https://www.youtube.com/@RickAstley' },
  });

  // What the user actually added, never successfully polled -> no channelId.
  const sub = { id: 's1', channelUrl: 'https://www.youtube.com/c/RickAstley', name: 'RickAstley' };
  await updateDatabase((db) => {
    db.ytdlp = { allowMembersOnly: false, subscriptions: [sub], downloadMeta: {}, pins: [], channelAvatars: {} };
    return true;
  });
  const subDir = ytdlpArgs.resolveChannelDir(config, sub);
  const channelNameDir = ytdlpArgs.resolveChannelDir(config, { name: CHANNEL.channelName });
  assert.notEqual(subDir, channelNameDir, 'sanity: the subscription folder and the display-name folder differ');

  const res = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(res.status, 'skipped');
  assert.equal(res.reason, 'ambiguous-subscription');
  assert.ok(!fs.existsSync(channelNameDir), 'NO parallel folder: a /c/ subscription is uncomparable, so we must not guess "unsubscribed"');
  assert.ok(fs.existsSync(filePath), 'the file stays put -- recoverable; a split library would not be');
  assert.equal(fs.readdirSync(downloadDir).length, 0, 'nothing at all is created under the download root');
});

test('QA REPRO (gate round 3): an item with NO channelId, whose channel is subscribed by @handle and HAS been polled, still lands in that subscription\'s folder (the id is read out of the item\'s canonical URL)', async () => {
  const config = ytdlp.parseYtdlpConfig();
  // The item shape `sanitizeCapturedChannelMeta` produces when yt-dlp gave no
  // explicit channel_id: a canonical channelUrl and nothing else.
  const { id } = seedHydratedImport({
    item: { channelId: undefined, channelHandleUrl: undefined },
  });

  const sub = {
    id: 'sub-polled', channelUrl: 'https://www.youtube.com/@RickAstley', name: 'RickAstley',
    channelId: CHANNEL.channelId, // backfilled by its first successful poll
    format: 'video', quality: 'best',
  };
  await updateDatabase((db) => {
    db.ytdlp = { allowMembersOnly: false, subscriptions: [sub], downloadMeta: {}, pins: [], channelAvatars: {} };
    return true;
  });
  const subDir = ytdlpArgs.resolveChannelDir(config, sub);
  const channelNameDir = ytdlpArgs.resolveChannelDir(config, { name: CHANNEL.channelName });
  assert.notEqual(subDir, channelNameDir, 'sanity: the two folder derivations differ');

  const res = await relocateHydratedImportIntoChannelFolder(DEPS, config, id);
  assert.equal(res.status, 'moved');
  assert.equal(path.dirname(res.newPath), subDir,
    'the sub has an id and the item does not -- an id on ONE side decides nothing, but the item\'s canonical URL CONTAINS the id, so this must MATCH');
  assert.ok(!fs.existsSync(channelNameDir), 'NO parallel folder -- one channel, one folder');
});

test('a failed db re-key ROLLS BACK the destination -- no duplicate library item, and the original is untouched', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { filePath, id } = seedHydratedImport();
  const target = expectedTarget(config);

  // The pre-move tombstone mutator commits; the re-key mutator fails.
  let calls = 0;
  const failingUpdateDatabase = (fn) => {
    calls += 1;
    if (calls === 1) return updateDatabase(fn);
    return Promise.reject(new Error('simulated db write failure'));
  };

  const res = await relocateHydratedImportIntoChannelFolder(
    { loadDatabase, updateDatabase: failingUpdateDatabase, getMediaId }, config, id);
  assert.equal(res.status, 'failed');

  assert.ok(fs.existsSync(filePath), 'the original is untouched');
  assert.ok(!fs.existsSync(target),
    'the destination MUST be rolled back: left in place it sits in a channel folder with a native [id] name, and the next scan indexes it as a SECOND copy of the same video');
  assert.equal(readDb().metadata[id].filePath, filePath, 'and the db still points at the file that is really there');

  // The scan must therefore find exactly ONE item, not two.
  await scanDirectories();
  const paths = Object.values(readDb().metadata).map((m) => m.filePath);
  assert.deepStrictEqual(paths, [filePath], 'exactly one library item -- no duplicate');
});

test('a failed db re-key does not leave the in-flight progress ping stranded on a dead id', async () => {
  const config = ytdlp.parseYtdlpConfig();
  const { id: oldId } = seedHydratedImport();
  const newId = getMediaId(expectedTarget(config));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = authenticateFetch(server, base); // v1.43: auth through the real gate
  try {
    await fetch(`${base}/api/progress`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: oldId, timestamp: 77, duration: 213 }),
    });

    // The failure mode that matters here is `saveDatabase` throwing -- i.e. the
    // MUTATOR RUNS to completion (touching whatever it touches) and only the
    // persist fails, rolling the database back. Any state the mutator changed
    // OUTSIDE `freshDb` -- process memory -- is NOT rolled back with it.
    let calls = 0;
    const savingFailsUpdateDatabase = (fn) => {
      calls += 1;
      if (calls === 1) return updateDatabase(fn); // the pre-move tombstone retirement commits
      fn(loadDatabase()); // the re-key mutator RUNS...
      return Promise.reject(new Error('simulated saveDatabase failure')); // ...and the persist fails
    };
    const res = await relocateHydratedImportIntoChannelFolder(
      { loadDatabase, updateDatabase: savingFailsUpdateDatabase, getMediaId }, config, oldId);
    assert.equal(res.status, 'failed');

    await flushPendingProgress();

    // v1.43: per-user rows -- the db rolled back, so the ping must still be
    // keyed to the id that still exists. Re-keying the staged ping (or the
    // user_progress rows -- both live in rekeyInFlightState, which only runs
    // AFTER a committed mutator) inside the mutator would have stranded it on
    // a newId with no metadata entry, and the flush would have dropped it.
    const row = userStore.getOneProgress(auth.user.id, oldId);
    assert.equal(row && row.timestamp, 77,
      'the ping must land under the id that still exists after the rollback');
    assert.equal(userStore.getOneProgress(auth.user.id, newId), null);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});
