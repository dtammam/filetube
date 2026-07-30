'use strict';

// [INTEGRATION] v1.56 "Reheat sub counts" -- the REAL server.js deps-bridge
// binding, end to end.
//
// THIS FILE EXISTS BECAUSE OF THE RECURRING presence-not-binding CLASS
// (v1.41.4 "the seat that forgot to CALL the shared helper", v1.44's "a
// source-lock proves PRESENCE, not runtime BINDING", v1.47.4's headline fix
// shipped as dead code): ytdlp-reheat-subs-endpoint.test.js proves the batch
// orchestration against a FAKE deps object whose fanout is a spy, and
// reheat-subs-fanout.test.js proves the real writer against a fake db --
// neither would fail if server.js simply forgot to put
// `recordChannelFollowerCountFanout` on the deps object it hands
// `ytdlp.registerRoutes` (the batch counts the channel `done` either way and
// the whole feature ships inert). So this file boots the REAL app (real
// registerRoutes call, real deps bridge, real writer, real db in an isolated
// DATA_DIR), stubs ONLY the spawn boundary (`run.probeChannelFollowerCount`),
// and asserts the probed count actually LANDS on the library items.
//
// Isolated DATA_DIR + ytdlp env BEFORE requiring the app, per the
// established pattern (test/integration/ytdlp-pins.test.js): registerRoutes'
// config is captured once at server.js's own require-time call.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-reheat-subs-bridge-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0'; // manual-only: no real timer during tests
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-reheat-subs-dl-'));
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, loadDatabase, updateDatabase } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const activity = require('../../lib/ytdlp/activity');

const originalProbeChannelFollowerCount = run.probeChannelFollowerCount;

let server;
let base;
let auth;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});

after(async () => {
  run.probeChannelFollowerCount = originalProbeChannelFollowerCount;
  ytdlp.resetReheatSubsStateForTests();
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_POLL_MINUTES;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

function flush(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const UC_A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const URL_A = 'https://www.youtube.com/channel/' + UC_A;

test('POST /api/ytdlp/reheat-sub-counts against the REAL app stamps sourceFollowerCount(+CapturedAt) onto every item of the probed channel', async () => {
  await updateDatabase((db) => {
    db.metadata = db.metadata || {};
    db.metadata.vidA1 = { id: 'vidA1', filePath: path.join(downloadDir, 'a1.mp4'), channelId: UC_A, channelUrl: URL_A };
    db.metadata.vidA2 = { id: 'vidA2', filePath: path.join(downloadDir, 'a2.mp4'), channelUrl: URL_A }; // no channelId -- URL-fallback lane
    db.metadata.vidOther = { id: 'vidOther', filePath: path.join(downloadDir, 'o.mp4'), channelUrl: 'https://www.youtube.com/@someoneelse' };
    return true;
  });

  run.probeChannelFollowerCount = async (channelUrl) => (
    channelUrl === URL_A
      ? { followerCount: 123456, channelId: UC_A, channelUrl: URL_A }
      : null
  );

  const beforeMs = Date.now();
  const res = await fetch(`${base}/api/ytdlp/reheat-sub-counts`, { method: 'POST' });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.started, true);
  assert.ok(body.total >= 2, 'both distinct channels must be enumerated as targets');

  await flush(60);

  const entry = activity.getSnapshot().oneShots[ytdlp.REHEAT_SUBS_ACTIVITY_ID];
  assert.ok(entry, 'the activity one-shot must exist');
  assert.equal(entry.state, 'done');
  assert.equal(entry.itemsUpdated, 2, 'the REAL fan-out writer must have stamped exactly the two channel-A items');

  const db = loadDatabase();
  assert.equal(db.metadata.vidA1.sourceFollowerCount, 123456);
  assert.equal(db.metadata.vidA2.sourceFollowerCount, 123456, 'the channelId-less item must land via the URL-fallback match');
  assert.ok(db.metadata.vidA1.sourceFollowerCountCapturedAt >= beforeMs, 'capture date must be stamped as a unit with the count');
  assert.equal(db.metadata.vidOther.sourceFollowerCount, undefined, 'the un-probed channel must stay untouched (its probe returned null)');
});
