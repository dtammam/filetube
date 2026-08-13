'use strict';

// [INTEGRATION] v1.115 (Dean, A1) "Refresh channel names" -- the REAL server.js
// deps-bridge binding, end to end. Mirrors reheat-subs-bridge.test.js: it exists
// because of the recurring presence-not-binding class (a source-lock / a
// fake-deps orchestration test would both pass even if server.js forgot to put
// `recordChannelNameBackfillFanout` on the deps object it hands registerRoutes --
// the batch counts `done` either way and the whole feature ships inert). Boots
// the REAL app + real deps bridge + real writer + real db, stubs ONLY the spawn
// boundary (`run.probeChannelAvatar`), and asserts the probed NAME actually lands
// on the library items (and NOT on manual / other-channel / good-name ones).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-name-backfill-bridge-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-name-backfill-dl-'));
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, loadDatabase, updateDatabase } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const activity = require('../../lib/ytdlp/activity');

const originalProbeChannelAvatar = run.probeChannelAvatar;
let server, base, auth;

before(async () => {
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});
after(async () => {
  run.probeChannelAvatar = originalProbeChannelAvatar;
  ytdlp.resetChannelNameBackfillStateForTests();
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_POLL_MINUTES;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  fs.rmSync(downloadDir, { recursive: true, force: true });
});
// v1.116 (QA flake observation): poll-until-done instead of a fixed sleep-then-
// assert -- the batch finishes asynchronously and a fixed flush is a latent flake.
async function waitForBackfillDone(maxMs = 5000) {
  const s = Date.now();
  for (;;) {
    const e = activity.getSnapshot().oneShots[ytdlp.CHANNEL_NAME_BACKFILL_ACTIVITY_ID];
    if (e && (e.state === 'done' || e.state === 'error' || e.state === 'cancelled')) return e;
    if (Date.now() - s > maxMs) return e;
    await new Promise((r) => setTimeout(r, 15));
  }
}

const UC_A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const URL_A = 'https://www.youtube.com/channel/' + UC_A;

test('POST /api/ytdlp/backfill-channel-names against the REAL app writes the canonical name onto every bad-name item of the probed channel, and NEVER onto manual/good/other', async () => {
  await updateDatabase((db) => {
    db.metadata = db.metadata || {};
    db.metadata.a1 = { id: 'a1', type: 'video', filePath: path.join(downloadDir, 'a1.mp4'), channelName: '', channelId: UC_A, folderName: 'AfterSkool' };
    db.metadata.a2 = { id: 'a2', type: 'video', filePath: path.join(downloadDir, 'a2.mp4'), channelName: '@AfterSkool', channelId: UC_A, folderName: 'AfterSkool' };
    db.metadata.manual = { id: 'manual', type: 'video', filePath: path.join(downloadDir, 'm.mp4'), channelName: '@AfterSkool', channelId: UC_A, channelAttributedManually: true, folderName: 'AfterSkool' };
    // v1.116: 'good' lives in its OWN subfolder so the AfterSkool (downloadDir)
    // bucket has no canonical sibling -> the local-heal phase is a no-op here and
    // this test exercises the NETWORK path in isolation (local heal has its own
    // bridge test). It still shares channelId UC_A, so the network fanout's
    // good-name guard is what protects it.
    db.metadata.good = { id: 'good', type: 'video', filePath: path.join(downloadDir, 'goodsub', 'g.mp4'), channelName: 'Already Real', channelId: UC_A, folderName: 'AfterSkool' };
    db.metadata.other = { id: 'other', type: 'video', filePath: path.join(downloadDir, 'o.mp4'), channelName: '', channelUrl: 'https://www.youtube.com/@someoneelse', folderName: 'Other' };
    db.ytdlp = db.ytdlp || {};
    // channelDir IS the channel's on-disk download folder -- the same folder the
    // A items live in -- so the pure pin re-label matches it by full path.
    db.ytdlp.pins = [{ id: 'p1', channelDir: downloadDir, label: '@AfterSkool', pinnedAt: 1 }];
    return true;
  });

  run.probeChannelAvatar = async (channelUrl) => (
    channelUrl === URL_A
      ? { avatarUrl: 'https://yt3.ggpht.com/x.jpg', channelId: UC_A, channelUrl: URL_A, channelName: 'After Skool' }
      : null
  );

  const res = await fetch(`${base}/api/ytdlp/backfill-channel-names`, { method: 'POST' });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.started, true);
  // Distinct bad-name channels with an identity: channel A (a1/a2) + the "other"
  // (url-only). The manual/good items don't add A again; "other" has no probe hit.
  assert.ok(body.total >= 1, 'at least channel A is a target');

  const entry = await waitForBackfillDone();
  assert.ok(entry, 'the activity one-shot exists');
  assert.equal(entry.state, 'done');
  assert.equal(entry.itemsUpdated, 2, 'exactly the two bad-name channel-A items written');

  const db = loadDatabase();
  assert.equal(db.metadata.a1.channelName, 'After Skool', 'empty name backfilled');
  assert.equal(db.metadata.a2.channelName, 'After Skool', '@handle name backfilled');
  assert.equal(db.metadata.manual.channelName, '@AfterSkool', 'MANUAL attribution never overwritten');
  assert.equal(db.metadata.good.channelName, 'Already Real', 'an already-good name never overwritten');
  assert.equal(db.metadata.other.channelName, '', 'a different channel (probe returned null) untouched');
  assert.equal(db.ytdlp.pins[0].label, 'After Skool', 'the channel pin snapshot was re-labelled to the real name');
});
