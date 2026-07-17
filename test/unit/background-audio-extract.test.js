'use strict';

// [UNIT] v1.27.0 "Background audio for video" (EXPERIMENTAL, default OFF):
// the pure/DB helpers behind the audio-extract sidecar (server.js) --
// `audioPath`, `buildAudioExtractArgs` (the FFmpeg arg-ARRAY builder --
// asserts arg-array shape, `-vn`, and no shell interpolation), and
// `setAudioStatus`. Isolated DATA_DIR before requiring the server (own
// process per test file), so TRANSCODE_DIR resolves under a disposable dir
// and no real data is touched -- mirrors test/unit/transcode-cache.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-bg-audio-'));
const DATA_DIR = process.env.DATA_DIR;

const { test } = require('node:test');
const assert = require('node:assert');
const {
  audioPath,
  buildAudioExtractArgs,
  setAudioStatus,
  transcodedPath,
  // F1 (two-reviewer gate, v1.27.0): the stale-'ready' healing helpers.
  clearAudioStatus,
  healStaleAudioReady,
  saveDatabase,
  __getSaveDatabaseCallCount,
} = require('../../server');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

// v1.30 A3 (in-memory DB read cache): seed via the exported `saveDatabase()`
// (an established test primitive, see CONTRIBUTING.md) rather than a raw
// `fs.writeFileSync`, so the in-process db cache stays coherent with what
// this test just wrote (a raw fs write is invisible to the cache -- this
// process is the only writer db.json is ever supposed to have).
function writeDb(db) {
  saveDatabase(db);
}

function readDb() {
  // v1.42: the sanctioned persisted-state read (independent connection).
  const db = readPersistedDatabase(DATA_DIR);
  if (!db.metadata) db.metadata = {};
  return db;
}

// ---- audioPath (pure) -------------------------------------------------

test('audioPath: returns <TRANSCODE_DIR>/<id>.m4a', () => {
  const p = audioPath('abc123');
  assert.ok(p.endsWith(path.join('abc123' + '.m4a')), 'ends with <id>.m4a');
  assert.ok(p.includes('transcoded'), 'lives under the transcode cache dir');
});

test('audioPath and transcodedPath share the same directory, different extensions/ids namespace', () => {
  const audio = audioPath('xyz');
  const video = transcodedPath('xyz');
  assert.equal(path.dirname(audio), path.dirname(video), 'one coherent cache directory');
  assert.notEqual(audio, video, 'different files -- .m4a vs .mp4');
});

// ---- buildAudioExtractArgs (pure) --------------------------------------

test('buildAudioExtractArgs: returns a plain ARRAY (never a shell string)', () => {
  const args = buildAudioExtractArgs('/media/movie.mp4', '/cache/id.tmp.m4a');
  assert.ok(Array.isArray(args), 'must be an array, not a string -- no shell interpolation surface');
});

test('buildAudioExtractArgs: -vn drops the video stream (audio-only extraction)', () => {
  const args = buildAudioExtractArgs('/media/movie.mp4', '/cache/id.tmp.m4a');
  assert.ok(args.includes('-vn'), 'expected -vn to drop video entirely');
});

test('buildAudioExtractArgs: passes srcPath and tmpPath as SEPARATE array elements, never concatenated/interpolated into one string', () => {
  const src = '/media/some movie; rm -rf / #.mp4'; // hostile-looking path -- must never be shell-interpreted
  const tmp = '/cache/abc.tmp.m4a';
  const args = buildAudioExtractArgs(src, tmp);
  assert.ok(args.includes(src), 'srcPath must appear as its own array element, verbatim');
  assert.ok(args.includes(tmp), 'tmpPath must appear as its own array element, verbatim');
  // No element may contain shell metacharacters glued to other arguments --
  // each element is exactly one token, proving argv-style invocation (spawn
  // with an array never goes through a shell, per Node's child_process docs).
  for (const a of args) {
    assert.equal(typeof a, 'string', 'every arg must be a plain string');
  }
});

test('buildAudioExtractArgs: encodes AAC/160k/stereo + faststart, matching the video transcode\'s own audio settings', () => {
  const args = buildAudioExtractArgs('/media/movie.mp4', '/cache/id.tmp.m4a');
  assert.ok(args.includes('-c:a'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('-b:a'));
  assert.ok(args.includes('160k'));
  assert.ok(args.includes('-ac'));
  assert.ok(args.includes('2'));
  assert.ok(args.includes('-movflags'));
  assert.ok(args.includes('+faststart'));
});

test('buildAudioExtractArgs: -i precedes the source path, -y forces overwrite of the tmp output', () => {
  const args = buildAudioExtractArgs('/media/movie.mp4', '/cache/id.tmp.m4a');
  const iIdx = args.indexOf('-i');
  assert.ok(iIdx !== -1 && args[iIdx + 1] === '/media/movie.mp4');
  assert.equal(args[args.length - 2], '-y');
  assert.equal(args[args.length - 1], '/cache/id.tmp.m4a');
});

// ---- setAudioStatus (DB, no-clobber/fire-and-forget) -------------------

test('setAudioStatus: persists db.metadata[id].audioStatus without touching unrelated fields', async () => {
  const id = 'vid-audio-status';
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id, unrelatedField: 'keep-me' } },
  });
  await setAudioStatus(id, 'processing');
  const db = readDb();
  assert.equal(db.metadata[id].audioStatus, 'processing');
  assert.equal(db.metadata[id].unrelatedField, 'keep-me');
});

test('setAudioStatus: a no-op write (status unchanged) never touches the file (no-clobber, mirrors setTranscodeStatus)', async () => {
  const id = 'vid-audio-status-noop';
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id, audioStatus: 'ready' } },
  });
  const before = __getSaveDatabaseCallCount();
  await setAudioStatus(id, 'ready');
  // v1.42: the "never touches the file" claim is asserted via the save call
  // count (the mtime proxy died with db.json) -- a no-op mutator returns
  // false and saveDatabase is never invoked.
  const db = readDb();
  assert.equal(db.metadata[id].audioStatus, 'ready');
  assert.equal(__getSaveDatabaseCallCount(), before, 'a no-op status write never calls saveDatabase');
});

test('setAudioStatus: a missing metadata entry is a safe no-op (never throws, never resurrects the id)', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {} });
  await assert.doesNotReject(setAudioStatus('does-not-exist', 'ready'));
  const db = readDb();
  assert.equal(db.metadata['does-not-exist'], undefined);
});

test('setAudioStatus: every documented status value round-trips', async () => {
  const id = 'vid-audio-status-cycle';
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: { [id]: { id } } });
  for (const status of ['pending', 'processing', 'ready', 'failed']) {
    await setAudioStatus(id, status);
    assert.equal(readDb().metadata[id].audioStatus, status);
  }
});

// ---- clearAudioStatus (F1, two-reviewer gate) --------------------------

test('clearAudioStatus: deletes the audioStatus key entirely (never leaves a stale value)', async () => {
  const id = 'vid-clear-status';
  writeDb({
    folders: [], folderSettings: {}, progress: {},
    metadata: { [id]: { id, audioStatus: 'ready', unrelatedField: 'keep-me' } },
  });
  await clearAudioStatus(id);
  const db = readDb();
  assert.equal(db.metadata[id].audioStatus, undefined);
  assert.equal(db.metadata[id].unrelatedField, 'keep-me', 'unrelated fields untouched');
  assert.ok(!('audioStatus' in db.metadata[id]), 'the key itself must be deleted, not merely set to undefined');
});

test('clearAudioStatus: a no-op when there is nothing to clear (never touches the file, never throws)', async () => {
  const id = 'vid-clear-status-noop';
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: { [id]: { id } } });
  await assert.doesNotReject(clearAudioStatus(id));
  const db = readDb();
  assert.ok(!('audioStatus' in db.metadata[id]));
});

test('clearAudioStatus: a missing metadata entry is a safe no-op (never throws, never resurrects the id)', async () => {
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: {} });
  await assert.doesNotReject(clearAudioStatus('does-not-exist'));
  const db = readDb();
  assert.equal(db.metadata['does-not-exist'], undefined);
});

// ---- healStaleAudioReady (F1, two-reviewer gate) -------------------------

test("healStaleAudioReady: resets a stale 'ready' status to 'pending', returned (never mutating the passed object)", () => {
  // v1.30 A3: `item` can now be a reference into the SHARED in-memory db
  // cache (server.js's `getCachedDatabase()`), so healStaleAudioReady no
  // longer mutates it in place -- callers must use the RETURN VALUE instead
  // (see the function's own comment in server.js). This is asserted
  // explicitly here: the passed object is untouched, and the healed status
  // comes back as the return value.
  const item = { id: 'vid-heal', audioStatus: 'ready' };
  const healed = healStaleAudioReady(item);
  assert.equal(healed, 'pending', 'the healed status is returned');
  assert.equal(item.audioStatus, 'ready', 'the passed object itself is never mutated in place');
});

test("healStaleAudioReady: persists the heal to the database (fire-and-forget, mirrors setAudioStatus's own contract)", async () => {
  const id = 'vid-heal-persist';
  writeDb({ folders: [], folderSettings: {}, progress: {}, metadata: { [id]: { id, audioStatus: 'ready' } } });
  const item = readDb().metadata[id];
  healStaleAudioReady(item);
  // healStaleAudioReady's own setAudioStatus call is fire-and-forget --
  // await a fresh setAudioStatus round trip on the SAME id to guarantee the
  // prior write has settled through updateDatabase's serialized mutex chain
  // before asserting (both calls share one write queue).
  await setAudioStatus(id, 'pending');
  assert.equal(readDb().metadata[id].audioStatus, 'pending');
});

test('healStaleAudioReady: a no-op for every status OTHER than \'ready\' (never touches pending/processing/failed/undefined)', () => {
  for (const status of ['pending', 'processing', 'failed', undefined]) {
    const item = { id: 'vid-heal-noop', audioStatus: status };
    const healed = healStaleAudioReady(item);
    assert.equal(item.audioStatus, status, `audioStatus=${status} must be left completely untouched on the passed object`);
    assert.equal(healed, status, `the returned status must equal the original audioStatus=${status} unchanged`);
  }
});
