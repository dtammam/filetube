'use strict';

// [INTEGRATION] v1.53 gate round (adversarial M6/M7 + QA S2): the Phase-2
// mirror's two arms under a MID-SCAN write, ported from the adversarial
// seat's runnable repro. The END-STATE assertions hold unconditionally
// (attribution survives a concurrent scan; a clear is never resurrected);
// the mid-scan interleave itself is timing-assisted (300 files keep the
// scan busy) and REPORTED honestly rather than assumed -- when the write
// happens to land outside the scan window the test still binds the final
// state, just not the specific arm.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-attrib-midscan-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, loadDatabase, saveDatabase, getMediaId, scanDirectories, scanState,
} = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

const TARGET = {
  channelUrl: 'https://www.youtube.com/channel/UCzzzzzzzzzzzzzzzzzzzzzz',
  channelName: 'Mïdscan Channel',
  channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz',
};

let server; let base; let mediaDir; let victim;

function baseItem(filePath) {
  const st = fs.statSync(filePath);
  return {
    id: getMediaId(filePath), name: path.basename(filePath),
    title: path.basename(filePath, path.extname(filePath)), filePath,
    folderName: path.basename(path.dirname(filePath)), size: st.size,
    ext: path.extname(filePath), type: 'video', addedAt: st.mtimeMs,
    duration: 10, hasThumbnail: false, artist: '',
  };
}

async function waitIdle() {
  const s = Date.now();
  while ((scanState.scanning || scanState.rescanRequested) && Date.now() - s < 20000) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

before(async () => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-attrib-midscan-media-'));
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
    settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 0, defaultView: '', attributeControlEnabled: true }, // v1.202: OPT-IN feature, exercised ON here
  });
  victim = getMediaId(path.join(mediaDir, 'v0.mp4'));
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

function post(body) {
  return fetch(`${base}/api/videos/${victim}/attribute-channel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('an attribution landing DURING a scan survives the merge (the adopt arm)', async () => {
  const scan = scanDirectories();
  await new Promise((r) => setTimeout(r, 5));
  const duringScan = scanState.scanning;
  assert.equal((await post({ target: TARGET })).status, 200);
  await scan;
  await waitIdle();
  const item = loadDatabase().metadata[victim];
  assert.equal(item.channelUrl, TARGET.channelUrl, `attribution survived (write landed ${duringScan ? 'MID-SCAN -- adopt arm exercised' : 'outside the window'})`);
  assert.equal(item.channelAttributedManually, true);
});

test('a CLEAR landing DURING a scan is never resurrected by the stale snapshot (the clear arm)', async () => {
  const scan = scanDirectories();
  await new Promise((r) => setTimeout(r, 5));
  const duringScan = scanState.scanning;
  assert.equal((await post({ clear: true })).status, 200);
  await scan;
  await waitIdle();
  const item = loadDatabase().metadata[victim];
  assert.equal(item.channelUrl, undefined, `the cleared identity stayed cleared (write landed ${duringScan ? 'MID-SCAN -- clear arm exercised' : 'outside the window'})`);
  assert.equal(item.channelAttributedManually, undefined);
  assert.equal(item.channelName, undefined);
});
