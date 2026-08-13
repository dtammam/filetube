'use strict';

// [INTEGRATION] v1.116 (Dean) gate: the persist-gate companion to the v1.115
// name gap-fill. The LOCAL heal populates channelId (+ canonical url/avatar) onto
// items that ALREADY carry a channelUrl (the @handle fragments), so the
// `!item.channelUrl` identity-carry (server.js:5003) SKIPS them -- a heal landing
// BETWEEN a scan's Phase-1 snapshot and its Phase-2 replace would be reverted.
// This drives that interleave and asserts the healed channelId + name SURVIVE.
// Delete the T4 gap-fill (server.js ~5027) and this goes red on the channelId.
//
// End-state assertion is unconditional; the mid-scan interleave is timing-
// assisted (300 files keep the scan busy) and reported honestly.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-heal-midscan-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, loadDatabase, saveDatabase, getMediaId, scanDirectories, scanState,
  updateDatabase, recordLocalChannelHealFanout,
} = require('../../server');
const ytdlp = require('../../lib/ytdlp');
const { authenticateFetch } = require('../helpers/auth');

const UC = 'UC-6oT0FOyAqCGfdNLi4fmXA';
const HANDLE = 'https://www.youtube.com/@nestalgiamusic';
const CANON_URL = 'https://www.youtube.com/channel/' + UC;
const REAL = 'NESTALGIA';

let server; let base; let mediaDir; let victim;

function baseItem(filePath, over) {
  const st = fs.statSync(filePath);
  return Object.assign({
    id: getMediaId(filePath), name: path.basename(filePath),
    title: path.basename(filePath, path.extname(filePath)), filePath,
    folderName: path.basename(path.dirname(filePath)), size: st.size,
    ext: path.extname(filePath), type: 'video', addedAt: st.mtimeMs,
    duration: 10, hasThumbnail: false, artist: '',
  }, over);
}
async function waitIdle() {
  const s = Date.now();
  while ((scanState.scanning || scanState.rescanRequested) && Date.now() - s < 20000) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

before(async () => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-heal-midscan-media-'));
  const md = {};
  // 3 canonical siblings (real id + name) + 297 @handle fragments (bad name,
  // has the handle url, NULL channelId) -- all in ONE folder.
  for (let i = 0; i < 300; i++) {
    const f = path.join(mediaDir, `v${i}.mp4`);
    fs.writeFileSync(f, 'bytes' + i);
    const canonical = i < 3;
    const it = baseItem(f, canonical
      ? { channelName: REAL, channelId: UC, channelUrl: CANON_URL, channelHandleUrl: HANDLE, channelAvatarUrl: 'https://yt3.ggpht.com/a.jpg' }
      : { channelName: '@nestalgiamusic', channelId: null, channelUrl: HANDLE });
    md[it.id] = it;
  }
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
  saveDatabase({
    folders: [mediaDir], folderSettings: {}, progress: {}, metadata: md,
    settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 0, defaultView: '' },
  });
  victim = getMediaId(path.join(mediaDir, 'v100.mp4')); // a fragment
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

test('a local heal landing DURING a scan keeps its channelId + name through the Phase-2 merge', async () => {
  const target = ytdlp.collectLocalChannelHealTargets(loadDatabase()).find(t => t.folderKey === mediaDir);
  assert.ok(target && target.identity.channelId === UC, 'the folder is a heal target');

  const scan = scanDirectories();
  await new Promise((r) => setTimeout(r, 5));
  const duringScan = scanState.scanning;
  const n = await recordLocalChannelHealFanout({ updateDatabase }, target);
  assert.ok(n >= 1, 'the heal wrote at least the victim');
  await scan;
  await waitIdle();

  const item = loadDatabase().metadata[victim];
  assert.equal(item.channelName, REAL, `name survived (write landed ${duringScan ? 'MID-SCAN -- gap-fill exercised' : 'outside the window'})`);
  assert.equal(item.channelId, UC, 'the healed channelId survived the merge (T4 gap-fill)');
});
