'use strict';

// [INTEGRATION] v1.115 (Dean, A1) gate round -- the load-bearing test the
// adversarial seat demanded (WARNING-1). A "Refresh channel names" backfill
// commits a real channelName to the LIVE db BETWEEN a scan's Phase-1 snapshot
// and its Phase-2 wholesale `db.metadata = newMetadata` replace. Without the
// persist-gate gap-fill at server.js:5022, the stale snapshot REVERTS the
// backfill -- the persist-gate/stale-snapshot class's Nth strike. This test
// drives exactly that interleave and asserts the backfilled name SURVIVES.
//
// The seed items carry a channelUrl on purpose: that makes the `!item.channelUrl`
// identity-carry (server.js:5003) SKIP them, so ONLY the new name gap-fill can
// save the write. Delete server.js:5022-5026 and this goes red.
//
// End-state assertion holds unconditionally; the mid-scan interleave is
// timing-assisted (300 files keep the scan busy) and reported honestly.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-name-midscan-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, loadDatabase, saveDatabase, getMediaId, scanDirectories, scanState,
  updateDatabase, recordChannelNameBackfillFanout,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

const UC = 'UCzzzzzzzzzzzzzzzzzzzzzz';
const CHANNEL_URL = 'https://www.youtube.com/channel/' + UC;
const REAL_NAME = 'Marques Brownlee';

let server; let base; let mediaDir; let victim;

function baseItem(filePath) {
  const st = fs.statSync(filePath);
  return {
    id: getMediaId(filePath), name: path.basename(filePath),
    title: path.basename(filePath, path.extname(filePath)), filePath,
    folderName: path.basename(path.dirname(filePath)), size: st.size,
    ext: path.extname(filePath), type: 'video', addedAt: st.mtimeMs,
    duration: 10, hasThumbnail: false, artist: '',
    // Bad name (empty) but a KNOWN identity -- the exact shape the backfill
    // enumerator targets, and the shape that defeats the !item.channelUrl carry.
    channelName: '', channelId: UC, channelUrl: CHANNEL_URL,
  };
}

async function waitIdle() {
  const s = Date.now();
  while ((scanState.scanning || scanState.rescanRequested) && Date.now() - s < 20000) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

before(async () => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-name-midscan-media-'));
  const md = {};
  for (let i = 0; i < 300; i++) {
    const f = path.join(mediaDir, `v${i}.mp4`);
    fs.writeFileSync(f, 'bytes' + i);
    const it = baseItem(f);
    md[it.id] = it;
  }
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
  saveDatabase({
    folders: [mediaDir], folderSettings: {}, progress: {}, metadata: md,
    settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 0, defaultView: '' },
  });
  victim = getMediaId(path.join(mediaDir, 'v0.mp4'));
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

test('a channel-name backfill landing DURING a scan survives the Phase-2 merge (persist-gate gap-fill)', async () => {
  const scan = scanDirectories();
  await new Promise((r) => setTimeout(r, 5));
  const duringScan = scanState.scanning;
  // The REAL writer, same path the endpoint uses: fan the real name onto every
  // bad-name item of channel UC via the serialized updateDatabase.
  const n = await recordChannelNameBackfillFanout({ updateDatabase }, { channelId: UC }, { channelName: REAL_NAME });
  assert.ok(n >= 1, 'the backfill wrote at least the victim item');
  await scan;
  await waitIdle();
  const item = loadDatabase().metadata[victim];
  assert.equal(item.channelName, REAL_NAME,
    `backfilled name survived (write landed ${duringScan ? 'MID-SCAN -- gap-fill exercised' : 'outside the window'})`);
  assert.equal(item.channelId, UC, 'identity intact');
});
