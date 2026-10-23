'use strict';

// [INTEGRATION] v1.394.0 W3: Reheat (per item and library-wide) refreshes the comments snapshot.
// The REAL route -> reheatOneItem -> run.repullItemMetaAndSubs runs; only cp.spawn is stubbed (the
// yt-dlp --dump-json answer), and the snapshot lands in a REAL media_source_comments table. The
// dumped comments are the REAL ones the pinned yt-dlp returned on the dev box
// (test/fixtures/ytdlp-comments). R9 is driven from a POPULATED row every time: a failed, partial or
// R7-off reheat must leave the old snapshot byte-identical.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const ytdlpStoreModule = require('../../lib/ytdlp/store');
const engine = require('../../lib/ytdlp/engine');
const { featureStoreFor, docView } = require('../helpers/scratch-feature-store');
const run = require('../../lib/ytdlp/run');
const activity = require('../../lib/ytdlp/activity');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const { createSourceCommentStore } = require('../../lib/media/sourceComments');

const FIX = path.join(__dirname, '..', 'fixtures', 'ytdlp-comments');
const REAL = JSON.parse(fs.readFileSync(path.join(FIX, 'ftcomments-jNQXAC9IVRw.txt'), 'utf8').trim().slice('FTCOMMENTS '.length));
const VID = 'jNQXAC9IVRw';
const MEDIA_ID = 'media-' + VID;
const OLD = { state: 'ok', fetchedAt: '2026-01-01T00:00:00.000Z', comments: [{ id: 'old', text: 'the old snapshot', author: 'Earlier' }] };

const originalSpawn = cp.spawn;
const originalProbe = run.probeChannelAvatar;
const originalConsoleError = console.error;
let tmpDir, adapter, commentStore, spawns;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-reheat-comments-'));
  adapter = new SqliteAdapter(path.join(tmpDir, SQLITE_FILENAME), { log: () => {} });
  commentStore = createSourceCommentStore(adapter);
  spawns = [];
  run.probeChannelAvatar = async () => null;
  console.error = () => {};
  ytdlp.resetRepullMetadataStateForTests();
  activity.resetForTests();
});
afterEach(() => {
  cp.spawn = originalSpawn;
  run.probeChannelAvatar = originalProbe;
  console.error = originalConsoleError;
  ytdlp.resetRepullMetadataStateForTests();
  activity.resetForTests();
  ytdlp.armYtdlpTimer(ytdlp.parseYtdlpConfig({}));
  adapter.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// answer(argv) -> { stdout, stderr, code } for each yt-dlp spawn.
function stubSpawn(answer) {
  cp.spawn = (cmd, argv) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit('close', null, 'SIGTERM'));
    spawns.push({ argv, at: Date.now() });
    const a = answer(argv) || { code: 0 };
    setImmediate(() => {
      if (a.stdout) child.stdout.emit('data', Buffer.from(a.stdout));
      if (a.stderr) child.stderr.emit('data', Buffer.from(a.stderr));
      setImmediate(() => { child.emit('exit', a.code, null); child.emit('close', a.code, null); });
    });
    return child;
  };
}
const dump = (extra) => JSON.stringify({ id: VID, title: 'Me at the zoo', channel_url: 'https://www.youtube.com/channel/UC4QobU6STFB0P71PMvOGN5A', ...extra });
const metaSpawns = () => spawns.filter((s) => s.argv.includes('--dump-json'));

function makeItem(videoId = VID) {
  return { mediaId: 'media-' + videoId, filePath: `/downloads/chan/Some Video [${videoId}].mp4`, videoId, watchUrl: `https://www.youtube.com/watch?v=${videoId}`, inDownloadRoot: true, alreadyRepulled: false };
}
function makeDeps(items) {
  const db = { metadata: Object.fromEntries(items.map((it) => [it.mediaId, { filePath: it.filePath, title: 'Old' }])) };
  const recordCalls = [];
  const deps = {
    ytdlpDb: featureStoreFor(ytdlpStoreModule.FEATURE, db),
    loadDatabase: () => docView(db, featureStoreFor(ytdlpStoreModule.FEATURE, db)),
    updateDatabase: (fn) => Promise.resolve(fn(db)),
    scanDirectories: async () => {},
    getMediaId: (i) => crypto.createHash('md5').update(i).digest('hex'),
    enumerateRepullableItems: () => ({ items, eligible: items.length, ineligible: 0, withSourceId: items.length }),
    recordRepulledItemMeta: async (d, mediaId, meta) => { recordCalls.push({ mediaId, meta }); return true; },
    planImportRelocation: () => ({ action: 'skip', reason: 'already-in-download-root' }),
    dataDir: tmpDir,
    sourceCommentStore: commentStore,
    reheatCommentsGapMs: 0,
  };
  return { deps, recordCalls };
}
async function startApp(deps) {
  const app = express();
  app.use(express.json());
  ytdlp.registerRoutes(app, deps, ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: 'true', FILETUBE_YTDLP_POLL_MINUTES: '0', FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); } };
}
const flush = (ms = 60) => new Promise((r) => setTimeout(r, ms));
async function reheatOne(deps) {
  const { base, close } = await startApp(deps);
  try {
    const res = await fetch(`${base}/api/ytdlp/repull-metadata/item/${encodeURIComponent(MEDIA_ID)}`, { method: 'POST' });
    assert.strictEqual(res.status, 202);
    await flush();
  } finally { await close(); }
}

test('success: the reheat replaces the old snapshot with the real top 10; ONE youtube extractor-args element', async () => {
  commentStore.apply(MEDIA_ID, OLD);
  stubSpawn((argv) => (argv.includes('--dump-json') ? { stdout: dump({ comment_count: REAL.comment_count, comments: REAL.comments }), code: 0 } : { code: 0 }));
  const { deps } = makeDeps([makeItem()]);
  await reheatOne(deps);
  const argv = metaSpawns()[0].argv;
  assert.ok(argv.includes('--get-comments') && argv.includes('--no-write-info-json'));
  const yt = argv.filter((v, i) => argv[i - 1] === '--extractor-args' && v.startsWith('youtube:'));
  assert.deepStrictEqual(yt, ['youtube:max_comments=10,all,0;comment_sort=top'], 'one element, the joined comment args');
  const row = commentStore.get(MEDIA_ID);
  assert.strictEqual(row.state, 'ok');
  assert.strictEqual(row.comments.length, 10);
  assert.strictEqual(row.comments[0].author, '@SanDiegoZoo');
});

test('R9 failure: a failed comments-on dump re-runs ONCE without comments; the metadata still refreshes and the old snapshot is kept', async () => {
  commentStore.apply(MEDIA_ID, OLD);
  stubSpawn((argv) => {
    if (!argv.includes('--dump-json')) return { code: 0 };
    if (argv.includes('--get-comments')) return { stderr: 'ERROR: [youtube] ' + VID + ': Unable to download API page: HTTP Error 403: Forbidden\n', code: 1 };
    return { stdout: dump({ title: 'Refreshed title' }), code: 0 };
  });
  const { deps, recordCalls } = makeDeps([makeItem()]);
  await reheatOne(deps);
  const metas = metaSpawns();
  assert.strictEqual(metas.length, 2, 'exactly one re-run');
  assert.ok(metas[0].argv.includes('--get-comments') && !metas[1].argv.includes('--get-comments'));
  assert.ok(!metas[1].argv.some((v) => /max_comments|comment_sort/.test(v)), 'the re-run carries no comment args');
  assert.strictEqual(recordCalls[0].meta.sourceTitle, 'Refreshed title', 'the reheat itself still landed');
  assert.deepStrictEqual(commentStore.get(MEDIA_ID), OLD, 'the old snapshot is untouched');
});

test('R9 partial: an interrupted list (no comment_count) keeps the old snapshot; zero comments keeps it too', async () => {
  for (const extra of [{ comments: REAL.comments.slice(0, 4) }, { comments: [], comment_count: 0 }]) {
    commentStore.apply(MEDIA_ID, OLD);
    spawns = [];
    stubSpawn((argv) => (argv.includes('--dump-json') ? { stdout: dump(extra), code: 0 } : { code: 0 }));
    const { deps } = makeDeps([makeItem()]);
    await reheatOne(deps);
    assert.strictEqual(metaSpawns().length, 1);
    assert.deepStrictEqual(commentStore.get(MEDIA_ID), OLD, JSON.stringify(extra).slice(0, 60));
  }
});

test('comments disabled at the source (both keys absent, measured): the snapshot becomes the disabled state', async () => {
  commentStore.apply(MEDIA_ID, OLD);
  stubSpawn((argv) => (argv.includes('--dump-json') ? { stdout: dump({}), code: 0 } : { code: 0 }));
  const { deps } = makeDeps([makeItem()]);
  await reheatOne(deps);
  assert.strictEqual(commentStore.get(MEDIA_ID).state, 'disabled');
});

test('R7 off: the reheat never asks, and the row stays exactly as it was', async () => {
  commentStore.apply(MEDIA_ID, OLD);
  engine.setSaveComments({ dataDir: tmpDir, enabled: false });
  stubSpawn((argv) => (argv.includes('--dump-json') ? { stdout: dump({ comment_count: REAL.comment_count, comments: REAL.comments }), code: 0 } : { code: 0 }));
  const { deps } = makeDeps([makeItem()]);
  await reheatOne(deps);
  assert.ok(!metaSpawns()[0].argv.includes('--get-comments'));
  assert.ok(!metaSpawns()[0].argv.some((v) => /max_comments/.test(v)));
  assert.deepStrictEqual(commentStore.get(MEDIA_ID), OLD);
});

test('library-wide: every item is asked; a comments-on item is followed by the pacing gap (R3)', async () => {
  const items = [makeItem('aaaaaaaaaaa'), makeItem('bbbbbbbbbbb')];
  stubSpawn((argv) => (argv.includes('--dump-json') ? { stdout: dump({ comment_count: REAL.comment_count, comments: REAL.comments }), code: 0 } : { code: 0 }));
  const { deps } = makeDeps(items);
  deps.reheatCommentsGapMs = 300;
  const { base, close } = await startApp(deps);
  try {
    assert.strictEqual((await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' })).status, 202);
    await flush(900);
  } finally { await close(); }
  const metas = metaSpawns();
  assert.strictEqual(metas.length, 2);
  assert.ok(metas.every((m) => m.argv.includes('--get-comments')));
  assert.ok(metas[1].at - metas[0].at >= 280, 'the second item waited the gap (' + (metas[1].at - metas[0].at) + ' ms)');
  for (const it of items) assert.strictEqual(commentStore.get(it.mediaId).comments.length, 10);
});

test('REHEAT_COMMENTS_GAP_MS is the download lane\'s --sleep-interval default (2 s)', () => {
  assert.strictEqual(ytdlp.REHEAT_COMMENTS_GAP_MS, 2000);
});
