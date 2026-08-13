'use strict';

// [INTEGRATION] v1.116 (Dean): the "Refresh channel names" endpoint runs the
// LOCAL heal phase FIRST, end to end against the REAL app + real deps bridge +
// real writer + real db. Proves the recordLocalChannelHealFanout wiring is
// actually on the deps object (presence-not-binding class) and that an AUDIO
// (music) channel's @handle fragments adopt the canonical sibling's identity
// UNIT (id+name+url+avatar) with NO network probe.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-heal-bridge-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-heal-dl-'));
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, loadDatabase, updateDatabase } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const activity = require('../../lib/ytdlp/activity');

const originalProbe = run.probeChannelAvatar;
let server, base, auth, probeCalls = 0;

before(async () => {
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});
after(async () => {
  run.probeChannelAvatar = originalProbe;
  ytdlp.resetChannelNameBackfillStateForTests();
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_POLL_MINUTES;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  fs.rmSync(downloadDir, { recursive: true, force: true });
});
const flush = (ms = 80) => new Promise((r) => setTimeout(r, ms));

const UC = 'UC-6oT0FOyAqCGfdNLi4fmXA';
const HANDLE = 'https://www.youtube.com/@nestalgiamusic';
const CANON_URL = 'https://www.youtube.com/channel/' + UC;
const CH = path.join(downloadDir, 'nestalgiamusic');

test('the endpoint LOCALLY heals an audio channel fragment (id+name+avatar) with no probe', async () => {
  await updateDatabase((db) => {
    db.metadata = db.metadata || {};
    // canonical sibling: real id + name + avatar.
    db.metadata.good = { id: 'good', type: 'audio', filePath: path.join(CH, 'g.mp3'), channelName: 'NESTALGIA', channelId: UC, channelUrl: CANON_URL, channelHandleUrl: HANDLE, channelAvatarUrl: 'https://yt3.ggpht.com/a.jpg', folderName: 'nestalgiamusic' };
    // fragments: @handle name, null id, only the handle url.
    db.metadata.b1 = { id: 'b1', type: 'audio', filePath: path.join(CH, 'b1.mp3'), channelName: '@nestalgiamusic', channelId: null, channelUrl: HANDLE, folderName: 'nestalgiamusic' };
    db.metadata.b2 = { id: 'b2', type: 'audio', filePath: path.join(CH, 'b2.mp3'), channelName: '', channelId: null, channelUrl: HANDLE, folderName: 'nestalgiamusic' };
    // a manual fragment in the same folder must be left alone.
    db.metadata.man = { id: 'man', type: 'audio', filePath: path.join(CH, 'm.mp3'), channelName: '@nestalgiamusic', channelId: null, channelUrl: HANDLE, channelAttributedManually: true, folderName: 'nestalgiamusic' };
    return true;
  });

  probeCalls = 0;
  run.probeChannelAvatar = async () => { probeCalls += 1; return null; };

  const res = await fetch(`${base}/api/ytdlp/backfill-channel-names`, { method: 'POST' });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.healChannels, 1, 'one channel is locally healable');

  await flush(100);

  const entry = activity.getSnapshot().oneShots[ytdlp.CHANNEL_NAME_BACKFILL_ACTIVITY_ID];
  assert.ok(entry, 'activity one-shot exists');
  assert.equal(entry.state, 'done');
  assert.equal(entry.healedItems, 2, 'the two fragments healed');
  assert.equal(probeCalls, 0, 'NO network probe was needed (all bad items healed locally)');

  const db = loadDatabase();
  for (const k of ['b1', 'b2']) {
    assert.equal(db.metadata[k].channelName, 'NESTALGIA', `${k} name healed`);
    assert.equal(db.metadata[k].channelId, UC, `${k} channelId adopted from the sibling`);
    assert.equal(db.metadata[k].channelUrl, CANON_URL, `${k} canonical url adopted`);
    assert.equal(db.metadata[k].channelAvatarUrl, 'https://yt3.ggpht.com/a.jpg', `${k} avatar adopted`);
  }
  assert.equal(db.metadata.man.channelName, '@nestalgiamusic', 'manual attribution untouched');
  assert.equal(db.metadata.man.channelId, null, 'manual identity untouched');
  assert.equal(db.metadata.good.channelName, 'NESTALGIA', 'canonical unchanged');
});
