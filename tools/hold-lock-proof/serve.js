'use strict';
/* global document */
// Boots the REAL server (real routes, real auth gate) against a throwaway DATA_DIR seeded with one playable
// WebM video and one WAV song, and mints one admin session. Used by the v1.358 hold-lock probes. The WebM is
// encoded with the ffmpeg binary Playwright ships (VP8, raw frames piped in), so no system ffmpeg is needed.
//   const { start } = require('./serve'); const s = await start(); ... await s.stop();
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

function playwrightFfmpeg() {
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  const dirs = fs.readdirSync(root).filter((d) => d.startsWith('ffmpeg-')).sort().reverse();
  for (const d of dirs) { const f = path.join(root, d, 'ffmpeg-linux'); if (fs.existsSync(f)) return f; }
  throw new Error('no Playwright ffmpeg found under ' + root);
}

// Frames are JPEGs screenshotted from a Playwright page (the shipped ffmpeg can decode MJPEG only), piped to
// ffmpeg's image2pipe and encoded to VP8, so the clip has real duration and cues. Cached under os.tmpdir().
async function webm(file, seconds) {
  const cache = path.join(os.tmpdir(), 'ft-hold-clip-' + seconds + '.webm');
  if (fs.existsSync(cache)) { fs.copyFileSync(cache, file); return; }
  const pw = require(require.resolve('playwright', { paths: [path.join(__dirname, '..', 'capture'), '/home/coder/projects/filetube/tools/capture'] }));
  const br = await pw.chromium.launch();
  const pg = await br.newPage({ viewport: { width: 320, height: 180 } });
  const fps = 10; const frames = seconds * fps;
  const ff = require('node:child_process').spawn(playwrightFfmpeg(), ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0', '-c:v', 'libvpx', '-b:v', '200k', '-g', '10', cache], { stdio: ['pipe', 'ignore', 'inherit'] });
  const done = new Promise((res, rej) => { ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))); });
  await pg.setContent('<body style="margin:0"><div id=d style="width:320px;height:180px;font:48px monospace;color:#fff"></div></body>');
  for (let f = 0; f < frames; f++) {
    await pg.evaluate((n) => { const d = document.getElementById('d'); d.style.background = 'hsl(' + ((n * 7) % 360) + ',70%,40%)'; d.textContent = String(Math.floor(n / 10)); }, f);
    const jpg = await pg.screenshot({ type: 'jpeg', quality: 60 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end(); await done; await br.close();
  fs.copyFileSync(cache, file);
}

function wav(seconds, hz) {
  const rate = 8000; const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / rate) * 6000), 44 + i * 2);
  return buf;
}

async function start(opts) {
  const o = opts || {};
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-hold-'));
  process.env.DATA_DIR = dataDir;
  const root = path.join(dataDir, 'media');
  fs.mkdirSync(path.join(root, 'Proof'), { recursive: true });
  const vfile = path.join(root, 'Proof', 'clip1.webm');
  const afile = path.join(root, 'Proof', 'song1.wav');
  await webm(vfile, o.seconds || 120);
  fs.writeFileSync(afile, wav(o.seconds || 120, 330));
  const server = require('../../server');
  const { seedState } = require('../../test/helpers/seed-state');
  seedState({ folders: [root], folderSettings: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await server.updateDatabase((db) => {
    db.metadata = {};
    db.metadata.clip1 = { id: 'clip1', type: 'video', title: 'Proof Clip', name: 'clip1.webm', filePath: vfile, rootFolder: root, folderName: 'Proof', channelName: 'Proof', duration: o.seconds || 120, hasThumbnail: false, ext: '.webm', addedAt: 1788000000000 };
    db.metadata.song1 = { id: 'song1', type: 'audio', title: 'Proof Song', name: 'song1.wav', filePath: afile, rootFolder: root, folderName: 'Proof', channelName: 'Proof', duration: o.seconds || 120, hasThumbnail: false, ext: '.wav', addedAt: 1788000000001, tags: { title: 'Proof Song', artist: 'Proof', album: 'Proof Album', track: 1 } };
    return true;
  });
  const session = server.__mintTestSession({ username: 'proofadmin' });
  const http = await new Promise((resolve) => { const s = server.app.listen(o.port || 0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + http.address().port;
  return {
    base, session, dataDir,
    cookie: { name: session.cookieName, value: encodeURIComponent(session.token), url: base },
    async stop() { try { server.__remoteForTests.closeAll(); } catch { /* best effort */ } http.closeAllConnections?.(); await new Promise((r) => http.close(r)); },
  };
}

module.exports = { start };
