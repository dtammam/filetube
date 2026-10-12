'use strict';
// v1.386.0 speed pass (plan docs/exec-plans/completed/2026-10-11-speed-pass.md, W1): boots the REAL server
// against a throwaway DATA_DIR seeded with a library the size of Dean's (default 23,000 native music
// tracks: ~1,900 albums by ~640 album artists, 12 tracks each, art for every album) plus one playable
// WAV in the media library (id nd1) for the player. Not part of the shipped app.
//   const s = await require('./serve').start({ tracks: 23000 }); ... await s.stop();
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function wav(seconds) {
  const rate = 8000; const n = rate * seconds; const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(20 * Math.sin(i / 8));
  return b;
}
const WORDS = ['Neon', 'Velvet', 'Paper', 'Silver', 'Hollow', 'Golden', 'Midnight', 'Electric', 'Quiet', 'Broken', 'Northern', 'Wild',
  'Glass', 'Summer', 'Lonely', 'Crystal', 'Ocean', 'Thunder', 'Little', 'Burning', 'Distant', 'Secret', 'Scarlet', 'Faded'];
const NOUNS = ['Hearts', 'Rivers', 'Lights', 'Machines', 'Gardens', 'Ghosts', 'Highways', 'Dreams', 'Echoes', 'Cities', 'Wolves',
  'Mirrors', 'Satellites', 'Horses', 'Shadows', 'Engines', 'Signals', 'Flowers', 'Stations', 'Waves'];
const GENRES = ['Rock', 'Pop', 'Electronic', 'Hip-Hop', 'Jazz', 'Classical', 'Folk', 'Soundtrack', 'R&B', 'Metal'];
const word = (i, salt) => WORDS[(i * 7 + salt) % WORDS.length] + ' ' + NOUNS[(i * 13 + salt * 3) % NOUNS.length];

async function start(opts) {
  const o = opts || {};
  const N = o.tracks === undefined ? 23000 : o.tracks;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-speed-'));
  process.env.DATA_DIR = dataDir;
  const server = require('../../server');
  const musicStore = require('../../lib/music/store');
  const lib = path.join(dataDir, 'lib');
  const musicRoot = path.join(dataDir, 'music');
  fs.mkdirSync(path.join(lib, 'tonzak'), { recursive: true });
  fs.mkdirSync(musicRoot, { recursive: true });
  const fp = path.join(lib, 'tonzak', 'nd1.wav');
  fs.writeFileSync(fp, wav(30));
  // one shared real cover so every album has art on disk (the per-row hasArt / artV stats then hit a file)
  const art = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'icons', 'icon-192.png'));
  const tracks = {};
  const PER_ALBUM = 12;
  for (let i = 0; i < N; i++) {
    const a = Math.floor(i / PER_ALBUM);
    const artistIx = Math.floor(a / 3);
    const meta = { artist: word(artistIx, 1) + ' Band', albumArtist: word(artistIx, 1) + ' Band', album: word(a, 2) + ' ' + (a + 1), title: word(i, 3) + ' ' + i, trackNo: (i % PER_ALBUM) + 1 };
    const full = path.join(musicRoot, meta.albumArtist, meta.album, String(meta.trackNo).padStart(2, '0') + ' ' + meta.title + '.mp3');
    const id = crypto.createHash('md5').update(full).digest('hex');
    const albumArtKey = crypto.createHash('md5').update(musicStore.albumKeyFor(meta)).digest('hex');
    tracks[id] = Object.assign({ id, filePath: full, rootFolder: musicRoot, folderName: meta.albumArtist, ext: '.mp3', codec: 'mp3',
      addedAt: new Date(1780000000000 + i * 60000).toISOString(), albumArtKey, durationSec: 150 + (i % 200), year: 1970 + (a % 55),
      genre: GENRES[a % GENRES.length], discNo: 1 }, meta);
  }
  fs.mkdirSync(server.ALBUMART_DIR, { recursive: true });
  const keys = new Set(Object.values(tracks).map((t) => t.albumArtKey));
  for (const k of keys) fs.writeFileSync(path.join(server.ALBUMART_DIR, k + '.jpg'), art);
  await server.updateDatabase((db) => {
    db.metadata = { nd1: { id: 'nd1', type: 'audio', title: 'Neon Arrival', name: 'nd1.wav', filePath: fp, rootFolder: lib, folderName: 'tonzak', channelName: 'Tonzak', duration: 30, hasThumbnail: false, ext: '.wav', addedAt: 1788000000000, tags: { artist: 'Tonzak', title: 'Neon Arrival', album: 'Night Drive' } } };
    server.musicDb.mutate((h) => { const ns = musicStore.ensureMusic(h); ns.folders = [musicRoot]; ns.tracks = tracks; return true; });
    return true;
  });
  const session = server.__mintTestSession({ username: 'speedadmin' });
  const http = await new Promise((resolve) => { const s = server.app.listen(o.port || 0, '127.0.0.1', () => resolve(s)); });
  if (process.env.SPEED_REQLOG) {
    const reqLog = process.env.SPEED_REQLOG;
    http.prependListener('request', (req, res) => {
      const t0 = process.hrtime.bigint();
      res.on('finish', () => { fs.appendFileSync(reqLog, JSON.stringify([Date.now(), Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10, res.statusCode, req.url]) + '\n'); });
    });
  }
  const base = 'http://127.0.0.1:' + http.address().port;
  return {
    base, port: http.address().port, session, dataDir, server, trackCount: N, albumCount: keys.size,
    cookie: { name: session.cookieName, value: encodeURIComponent(session.token) },
    async stop() { try { server.__remoteForTests.closeAll(); } catch { /* best effort */ } http.closeAllConnections?.(); await new Promise((r) => http.close(r)); },
  };
}

module.exports = { start };

// CLI: boot in this process and print one JSON line { base, port, cookie, tracks, albums }; every request is timed
// on the server (from the 'request' event to the response's 'finish') and appended to SPEED_REQLOG when set.
if (require.main === module) {
  start({ tracks: process.argv[2] ? Number(process.argv[2]) : undefined, port: Number(process.env.SPEED_PORT) || 0 }).then((s) => {
    process.stdout.write(JSON.stringify({ base: s.base, port: s.port, cookie: s.cookie, tracks: s.trackCount, albums: s.albumCount }) + '\n');
  }, (e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
}
