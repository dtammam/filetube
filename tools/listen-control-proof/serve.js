'use strict';
// Boots the REAL server (real routes, real auth gate) against a throwaway DATA_DIR seeded with a
// few playable WAV "songs" (no ffmpeg needed), and mints one admin session. Used by the v1.348
// Listen Control proof and the toolbar measurement. Not part of the shipped app.
//   const { start } = require('./serve'); const s = await start(); ... await s.stop();
// Options: seconds (clip length), port, count (v1.354: seed that many EXTRA songs beside the three, all
// hardlinks to one tiny WAV; titles span A-Z in title order, the last 500 are "Z Bulk" songs by the
// artist "Zed Band" in the genre "Zydeco", so anything past a 10,000 cut reads as missing).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-proof-'));
  process.env.DATA_DIR = dataDir;
  const root = path.join(dataDir, 'ytdlp');
  const ids = ['song1', 'song2', 'song3'];
  fs.mkdirSync(path.join(root, 'Proof Band'), { recursive: true });
  ids.forEach((id, i) => fs.writeFileSync(path.join(root, 'Proof Band', id + '.wav'), wav(o.seconds || 90, 330 + i * 110)));
  const count = Math.max(0, Math.floor(Number(o.count) || 0));
  const bulk = [];
  if (count) {
    const dir = path.join(root, 'Bulk Band');
    fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, 'bulk-base.wav');
    fs.writeFileSync(base, wav(1, 440));
    const zFrom = Math.max(0, count - 500);
    for (let i = 0; i < count; i++) {
      const id = 'bulk' + String(i).padStart(6, '0');
      const file = path.join(dir, id + '.wav');
      fs.linkSync(base, file);
      const z = i >= zFrom;
      const letter = z ? 'Z' : String.fromCharCode(65 + Math.floor((i * 25) / Math.max(1, zFrom)));
      bulk.push({ id, file, z, title: letter + ' Bulk ' + String(i).padStart(6, '0') });
    }
  }
  const server = require('../../server');
  const { seedState } = require('../../test/helpers/seed-state');
  const musicStore = require('../../lib/music/store');
  seedState({ folders: [root], folderSettings: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await server.updateDatabase((db) => {
    db.metadata = {};
    ids.forEach((id, i) => {
      db.metadata[id] = {
        id, type: 'audio', title: 'Proof Song ' + (i + 1), name: id + '.wav', filePath: path.join(root, 'Proof Band', id + '.wav'),
        rootFolder: root, folderName: 'Proof Band', channelName: 'Proof Band', duration: o.seconds || 90, hasThumbnail: false, ext: '.wav',
        addedAt: 1788000000000 + i, tags: { title: 'Proof Song ' + (i + 1), artist: 'Proof Band', album: 'Proof Album', track: i + 1, date: '2026', genre: 'Music' },
      };
    });
    bulk.forEach((b, i) => {
      db.metadata[b.id] = {
        id: b.id, type: 'audio', title: b.title, name: b.id + '.wav', filePath: b.file,
        rootFolder: root, folderName: 'Bulk Band', channelName: 'Bulk Band', duration: 1, hasThumbnail: false, ext: '.wav',
        addedAt: 1787000000000 + i, tags: { title: b.title, artist: b.z ? 'Zed Band' : 'Bulk Band', album: b.z ? 'Zed Album' : 'Bulk Album', track: (i % 20) + 1, date: '2026', genre: b.z ? 'Zydeco' : 'Music' },
      };
    });
    server.musicDb.mutate((h) => { musicStore.ensureMusic(h).folders = [root]; return true; });
    return true;
  });
  const session = server.__mintTestSession({ username: 'proofadmin' });
  const http = await new Promise((resolve) => { const s = server.app.listen(o.port || 0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + http.address().port;
  return {
    base, session, ids, dataDir,
    cookie: { name: session.cookieName, value: encodeURIComponent(session.token), url: base },
    async stop() { try { server.__remoteForTests.closeAll(); } catch { /* best effort */ } http.closeAllConnections?.(); await new Promise((r) => http.close(r)); },
  };
}

module.exports = { start };
