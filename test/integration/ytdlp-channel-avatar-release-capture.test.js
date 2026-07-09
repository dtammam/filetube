'use strict';

// [INTEGRATION] v1.24.0 C5-ytdlp/C6 (T11, Wave 3): proves the NEW plumbing
// this task added actually wires together end-to-end at the level this
// task owns -- `run.runDownload`'s `channelMeta` array (mocked here, the SAME
// monkey-patch pattern test/integration/ytdlp-poll.test.js already
// establishes) flows through `lib/ytdlp/index.js`'s `persistCapturedChannelMeta`
// into BOTH `db.ytdlp.downloadMeta` (the C5-ytdlp/C6 db.metadata bridge input)
// AND the matching subscription's own `channelAvatarUrl` (C6). No real yt-dlp
// binary or network is ever touched.
//
// This test mocks `run.runDownload` to return a channelMeta entry directly
// (the SAME shape a real captured FTCHMETA line now parses into -- see
// `parseChannelMetaLine`) so it can exercise index.js/store.js's own
// persistence plumbing in isolation, without spawning a real process.
//
// GAP THIS TEST ONCE DOCUMENTED, NOW CLOSED (T11 completion, Wave 3):
// `lib/ytdlp/run.js`'s `parseChannelMetaLine` originally did NOT surface
// `releaseDate`/`uploadDate`/`channelThumbnail` on its returned object (out
// of the original T11 task's owned-file set), so this mocked test alone
// could not prove the pipeline worked for a REAL download. See
// test/integration/ytdlp-release-avatar-bridge-e2e.test.js for the
// end-to-end proof against the REAL `parseChannelMetaLine` + the real
// server.js scan bridge.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const store = require('../../lib/ytdlp/store');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-avatar-'));
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  ytdlp.resetPollRerunStateForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFakeDeps(initialDb = {}) {
  let db = initialDb;
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
  };
}

function baseConfig(overrides = {}) {
  return {
    enabled: true,
    cookiesFile: null,
    pollMinutes: 0,
    downloadDir: tmpDir,
    version: null,
    ...overrides,
  };
}

function ndjson(videos) {
  return videos.map((v) => JSON.stringify(v)).join('\n');
}

test('runPoll: a captured channelMeta entry with releaseDate/channelThumbnail is recorded into db.ytdlp.downloadMeta AND backfills the matching subscription\'s channelAvatarUrl', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, {
    channelUrl: 'https://www.youtube.com/@somechannel',
    format: 'video',
    quality: 'best',
  });

  const survivorVideo = { id: 'survivor1', availability: 'public' };
  run.runList = async () => ({ ok: true, stdout: ndjson([survivorVideo]), stderr: '' });
  run.runDownload = async () => ({
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    channelMeta: [{
      videoId: 'survivor1',
      channelUrl: 'https://www.youtube.com/@somechannel',
      channelName: 'Some Channel',
      releaseDate: '20230615',
      channelThumbnail: 'https://yt3.ggpht.com/avatar123',
    }],
  });

  const result = await ytdlp.runPoll(deps, baseConfig());
  assert.equal(result.started, true);

  // db.ytdlp.downloadMeta is the scan-time bridge INPUT (server.js's scan
  // mutator, out of this task's scope, is what would carry it the rest of the
  // way onto db.metadata -- see this task's completion report).
  const consumed = ytdlp.consumeDownloadChannelMeta(deps.loadDatabase(), 'survivor1');
  assert.ok(consumed, 'expected a downloadMeta entry recorded for the survivor video id');
  assert.equal(consumed.releaseDate, Date.UTC(2023, 5, 15));
  assert.equal(consumed.channelAvatarUrl, 'https://yt3.ggpht.com/avatar123');

  // The subscription's OWN record is backfilled directly (fully wired within
  // this task's owned files -- index.js + store.js, no server.js involved).
  const [persistedSub] = store.listSubscriptions(deps);
  assert.equal(persistedSub.id, sub.id);
  assert.equal(persistedSub.channelAvatarUrl, 'https://yt3.ggpht.com/avatar123');
});

test('runPoll: a HOSTILE channelThumbnail (javascript: scheme) never reaches downloadMeta or the subscription record', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, {
    channelUrl: 'https://www.youtube.com/@somechannel',
    format: 'video',
    quality: 'best',
  });

  const survivorVideo = { id: 'survivor1', availability: 'public' };
  run.runList = async () => ({ ok: true, stdout: ndjson([survivorVideo]), stderr: '' });
  run.runDownload = async () => ({
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    channelMeta: [{
      videoId: 'survivor1',
      channelUrl: 'https://www.youtube.com/@somechannel',
      channelThumbnail: 'javascript:alert(document.cookie)',
    }],
  });

  await ytdlp.runPoll(deps, baseConfig());

  const consumed = ytdlp.consumeDownloadChannelMeta(deps.loadDatabase(), 'survivor1');
  assert.ok(consumed, 'the identity capture itself still succeeds -- only the hostile avatar field is dropped');
  assert.equal(Object.prototype.hasOwnProperty.call(consumed, 'channelAvatarUrl'), false);

  const [persistedSub] = store.listSubscriptions(deps);
  assert.equal(persistedSub.channelAvatarUrl, undefined);
});

test('runPoll: a survivor fallback entry (no usable print-line capture) threads the subscription\'s ALREADY-known channelAvatarUrl through', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, {
    channelUrl: 'https://www.youtube.com/@somechannel',
    format: 'video',
    quality: 'best',
  });
  // Seed the subscription with an avatar already captured by a PRIOR download.
  await store.recordSubscriptionChannelAvatar(deps, 'https://www.youtube.com/@somechannel', 'https://yt3.ggpht.com/existing');

  const survivorVideo = { id: 'survivor2', availability: 'public' };
  run.runList = async () => ({ ok: true, stdout: ndjson([survivorVideo]), stderr: '' });
  // No channelMeta at all for this download -- forces the survivor-fallback path.
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [] });

  await ytdlp.runPoll(deps, baseConfig());

  const consumed = ytdlp.consumeDownloadChannelMeta(deps.loadDatabase(), 'survivor2');
  assert.ok(consumed, 'expected the subscription-identity fallback to record a downloadMeta entry');
  assert.equal(consumed.channelUrl, 'https://www.youtube.com/@somechannel');
  assert.equal(consumed.channelAvatarUrl, 'https://yt3.ggpht.com/existing', 'the subscription\'s already-known avatar should flow onto the fallback entry too');

  const [persistedSub] = store.listSubscriptions(deps);
  assert.equal(persistedSub.id, sub.id);
  assert.equal(persistedSub.channelAvatarUrl, 'https://yt3.ggpht.com/existing', 'unchanged -- still the same, already-current avatar');
});
