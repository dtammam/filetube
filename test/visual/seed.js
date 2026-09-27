#!/usr/bin/env node
'use strict';
// Synthetic fixture seeder for the visual and geometry checks (UI professionalism
// pass, D10.2/D10.5). Builds a DATA_DIR from nothing: no copy of a real library,
// no real creators, no ffmpeg. Everything a surface needs to render populated is
// generated here: library videos (with drawn thumbnails), two channels with
// channel identity (one subscribed with notify on, one not), yt-dlp subscriptions,
// music (3 artists x 2 albums x 4 tracks), podcasts (2 shows x 5 episodes),
// notifications, a queue and watch progress.
//
//   node test/visual/seed.js [--data DIR]      (fnm Node 22 on PATH)
//
// DIR defaults to $VISUAL_DATA_DIR, else <os tmpdir>/filetube-visual-data. The
// dir is WIPED and rebuilt, so the seeder refuses a non-empty dir it did not
// create (no marker file). Writes <DIR>/fixtures.json (the ids the capture and
// geometry scripts navigate to; ids hash the file path, so they differ per DIR)
// and prints it. Then serve it with test/visual/start-server.sh.
//
// Adapted from the 2026-09-27 audit's baseline seed, which copied a local dev
// database; this one is self-contained so CI can run it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const png = require('../../tools/capture/png.js');

const REPO = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const dataArg = argv.indexOf('--data');
const DATA = path.resolve(dataArg !== -1 ? argv[dataArg + 1]
  : (process.env.VISUAL_DATA_DIR || path.join(os.tmpdir(), 'filetube-visual-data')));
const MARKER = '.filetube-visual-seed';
const USER = 'testadmin';
const PASSWORD = 'visual-capture-pw';

// ---- the wipe guard: only a dir this seeder made (or an empty/absent one) ----
if (fs.existsSync(DATA)) {
  const entries = fs.readdirSync(DATA);
  if (entries.length && !entries.includes(MARKER)) {
    console.error(`seed: refusing to wipe ${DATA}: not empty and not a seeded dir (no ${MARKER})`);
    process.exit(1);
  }
}
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(path.join(DATA, '.thumbnails'), { recursive: true });
fs.writeFileSync(path.join(DATA, MARKER), 'made by test/visual/seed.js; safe to delete\n');

// ---- drawn images (PNG bytes; browsers sniff the type, the .jpg name is the app's) ----
function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
// A deterministic "scene": a two-tone gradient, a horizon band and a disc, from one index.
function drawImage(i, width, height) {
  const data = Buffer.alloc(width * height * 4);
  const h1 = (i * 47) % 360; const h2 = (h1 + 40 + (i * 13) % 80) % 360;
  const top = hsl(h1, 0.55, 0.62); const bot = hsl(h2, 0.5, 0.28); const disc = hsl((h1 + 180) % 360, 0.6, 0.7);
  const cx = width * (0.25 + ((i * 29) % 50) / 100); const cy = height * 0.42; const r = Math.min(width, height) * 0.16;
  const horizon = height * (0.58 + ((i * 7) % 20) / 100);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y / (height - 1);
      let c = [0, 1, 2].map((k) => Math.round(top[k] * (1 - t) + bot[k] * t));
      if (y > horizon) c = c.map((v) => Math.round(v * 0.62));
      const d = Math.hypot(x - cx, y - cy);
      if (d < r) c = disc; else if (d < r + 1.5) c = c.map((v, k) => Math.round((v + disc[k]) / 2));
      const o = (y * width + x) * 4;
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }
  }
  return png.encode({ width, height, data });
}
const THUMB = (i) => drawImage(i, 320, 180);
const SQUARE = (i) => drawImage(i, 300, 300);

function silentWav(sec) {
  const n = 8000 * sec;
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  b.fill(128, 44);
  return b;
}

process.env.DATA_DIR = DATA;
process.env.FILETUBE_YTDLP_ENABLED = 'true';
const s = require(path.join(REPO, 'server')); // creates filetube.db
const { updateDatabase, getMediaId, settingsStore, folderStore, ytdlpDb, podcastsDb, userStore } = s;

// The admin account: reset-admin on a db with zero users creates the first admin
// (the real auth stack; WAL makes its write visible to this process at once).
execFileSync(process.execPath, [path.join(REPO, 'scripts', 'reset-admin.js'), USER], {
  env: { ...process.env, DATA_DIR: DATA, FILETUBE_NEW_PASSWORD: PASSWORD }, stdio: 'inherit',
});

// Fictional library. Each channel folder: [folder, channelUrl|null, titles].
const LIB = path.join(DATA, 'library');
const CHANNELS = [
  ['Harbor Workshop', 'https://www.youtube.com/@harborworkshop', [
    'Restoring a 1950s workbench, part one', 'Sharpening chisels the slow way', 'The shop tour, one year on',
    'Building a tool chest without screws', 'Why I stopped buying clamps', 'A dovetail you can cut in ten minutes',
    'Finishing oils compared on oak', 'Fixing a warped tabletop', 'The mallet I use every day', 'Q&A: tools, timber and time']],
  ['Northbound Field Notes', 'https://www.youtube.com/@northboundfieldnotes', [
    'A week on the northern coast', 'The lighthouse nobody visits', 'Walking the old rail line',
    'Night sky over the salt flats', 'What the tide leaves behind', 'Mapping a forgotten canal']],
  ['Home Videos', null, [
    'Garden in spring', 'Birthday at the lake', 'First snow of the year', 'Kitchen timelapse',
    'The long drive north', 'Beach at sunset, unedited, with a title long enough to wrap onto a third line on a phone']],
];

(async () => {
  const NOW = Number(process.env.SEED_NOW) || Date.now();
  settingsStore.set('scanIntervalMinutes', 0);
  settingsStore.set('pruneMissing', false);
  fs.mkdirSync(LIB, { recursive: true });
  folderStore.replaceAll([LIB]);

  let img = 0;
  const meta = {};
  const byChannel = {};
  for (const [folder, url, titles] of CHANNELS) {
    byChannel[folder] = [];
    titles.forEach((title, k) => {
      const fp = path.join(LIB, folder, `${title}.mp4`);
      const id = getMediaId(fp);
      fs.writeFileSync(path.join(DATA, '.thumbnails', `${id}.jpg`), THUMB(img++));
      meta[id] = { id, name: path.basename(fp), title, filePath: fp, folderName: folder, rootFolder: LIB,
        size: 40e6 + k * 1.3e6, ext: '.mp4', type: 'video', needsTranscode: false, hasThumbnail: true,
        duration: 240 + ((k * 397) % 1900) + 0.5, addedAt: NOW - (k + 1) * 26 * 3600e3 - img * 60e3,
        ...(url ? { channelUrl: url, channelName: folder } : {}) };
      byChannel[folder].push(id);
    });
  }

  // Music: 3 artists x 2 albums x 4 tracks as library audio.
  const musicRoot = path.join(DATA, 'musiclib');
  const wav = silentWav(240);
  const ARTISTS = [['Halden Arcs', ['Night Transit', 'Sodium Lamps']], ['Marrow Lane', ['Paper Harbor', 'Lowlight']],
    ['Oriel Vance', ['Glass Orchard', 'Northbound']]];
  const musicIds = [];
  let t = 0;
  ARTISTS.forEach(([artist, albums], ai) => albums.forEach((album, bi) => {
    const art = SQUARE(100 + ai * 2 + bi);
    for (let k = 1; k <= 4; k++) {
      const fp = path.join(musicRoot, artist, album, `0${k} Track ${k}.wav`);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, wav);
      const id = getMediaId(fp);
      fs.writeFileSync(path.join(DATA, '.thumbnails', `${id}.jpg`), art);
      const song = `${album} ${k === 1 ? '' : 'Part ' + k}`.trim();
      meta[id] = { id, type: 'audio', title: song, name: path.basename(fp), filePath: fp,
        rootFolder: musicRoot, folderName: artist, channelName: artist, duration: 180 + k * 23, hasThumbnail: true, ext: '.wav', size: wav.length,
        addedAt: NOW - 400 * 86400e3 - (t++) * 3600e3,
        tags: { title: song, artist, album, albumArtist: artist, track: String(k), genre: 'Ambient', date: String(2012 + ai) } };
      musicIds.push(id);
    }
  }));
  await updateDatabase((db) => { Object.assign(db.metadata, meta); return true; });

  // yt-dlp subscriptions: one matches the library channel (notify on), two are remote-only.
  const sub = (id, name, url, order, extra) => Object.assign({ id, channelUrl: url, name, format: 'video', quality: 'best', maxVideos: 5,
    maxDurationSeconds: null, minDurationSeconds: null, paused: false, skipShorts: false, pushBell: false, filetype: 'mp4', cutoffDate: null,
    order, addedAt: new Date(NOW - 30 * 86400e3).toISOString(), lastCheckedAt: new Date(NOW - 3600e3).toISOString(), lastStatus: 'ok', libraryPlace: 'default' }, extra || {});
  ytdlpDb.replaceAll({ allowMembersOnly: false, downloadMeta: {}, channelAvatars: {}, pins: [],
    subscriptions: [
      sub('sub-harbor', 'Harbor Workshop', CHANNELS[0][1], 0, { pushBell: true }),
      sub('sub-tidewater', 'The Tidewater Set', 'https://www.youtube.com/@tidewaterset', 1, { format: 'audio' }),
      sub('sub-orchard', 'Glass Orchard Workshop - long channel name for wrapping', 'https://www.youtube.com/@glassorchard', 2, { paused: true }),
    ] });

  // Podcasts: 2 shows x 5 downloaded episodes with drawn cover art.
  const podRoot = path.join(DATA, 'podcasts');
  const shows = [['pod-harbor', 'Harbor Lights Radio', 'Marrow Lane'], ['pod-signal', 'Signal Box Sessions', 'Oriel Vance']];
  const episodes = {};
  shows.forEach(([id, name], si) => {
    const dir = path.join(podRoot, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cover.jpg'), SQUARE(200 + si));
    for (let e = 1; e <= 5; e++) {
      const fp = path.join(dir, `ep${e}.mp3`);
      fs.writeFileSync(fp, wav);
      const eid = `${id}-e${e}`;
      episodes[eid] = { id: eid, subId: id, guid: eid, title: `Episode ${6 - e}: ${['The long way round', 'Lamps and ledgers', 'A quiet engine', 'Northbound, again', 'Pilot'][e - 1]}`,
        description: 'A fixture episode description long enough to wrap onto a second line in the list view.', link: null,
        pubDateMs: NOW - e * 7 * 86400e3, durationSec: 1800 + e * 311, status: 'downloaded', bytes: wav.length, downloadedAt: NOW - e * 7 * 86400e3, filePath: fp };
    }
  });
  podcastsDb.replaceAll({ settings: {}, episodes, subscriptions: shows.map(([id, name, author], i) => ({ id, name, author, showDirName: name,
    feedUrlDisplay: `https://feeds.example.com/${id}`, feedHost: 'feeds.example.com', description: `${name} - a fixture show.`, paused: false,
    backfill: 5, order: i, addedAt: NOW - 60 * 86400e3, lastCheckedAt: NOW - 3600e3, lastStatus: 'ok' })) });

  // Notifications: 6 unread rows for the subscribed channel's newest items.
  const harbor = byChannel['Harbor Workshop'];
  settingsStore.set('notificationsSeededAt', NOW);
  const notifications = userStore.recordNotifications(harbor.slice(0, 6).map((mediaId, i) => ({ mediaId, createdAt: NOW - (i + 1) * 2 * 3600e3 })));

  // Per-user state through the real routes (in-process, before any READONLY): a 3-item
  // queue (the header queue icon + panel) and watch progress on 3 videos (Continue watching / History).
  const server = await new Promise((r) => { const sv = s.app.listen(0, '127.0.0.1', () => r(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ck = s.__mintTestSession().cookie.split(';')[0];
  let postFailures = 0;
  const post = (u, body) => fetch(base + u, { method: 'POST', headers: { Cookie: ck, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => { if (!r.ok) { postFailures++; console.error('seed POST', u, r.status, await r.text()); } });
  for (const mediaId of harbor.slice(1, 4)) await post('/api/queue/items', { mediaId, position: 'end', kind: 'media' });
  const home = byChannel['Home Videos'];
  for (const [i, id] of home.slice(0, 3).entries()) {
    const d = meta[id].duration;
    await post('/api/progress', { id, timestamp: Math.round(d * (0.2 + i * 0.25)), duration: d });
  }
  server.close();

  const fixtures = { dataDir: DATA, seededAt: NOW, user: USER, password: PASSWORD,
    video: harbor[0], videoUnsub: byChannel['Northbound Field Notes'][0], track: musicIds[0],
    counts: { videos: Object.values(meta).filter((m) => m.type === 'video').length, musicTracks: musicIds.length,
      podcastEpisodes: Object.keys(episodes).length, notifications } };
  fs.writeFileSync(path.join(DATA, 'fixtures.json'), JSON.stringify(fixtures, null, 1));
  console.log(JSON.stringify(fixtures));
  setTimeout(() => process.exit(postFailures ? 1 : 0), 500);
})().catch((e) => { console.error(e); process.exit(1); });
