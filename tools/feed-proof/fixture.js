'use strict';
/* global document */
// v1.381.0 Feed, TikTok style: the shared fixture of tools/feed-proof/layout.js and gestures.js - a real library with one item
// of every card kind (a reading book, an unstarted book with a cover and a description, a landscape and a portrait video in
// progress with thumbnails, a podcast episode with show art, a liked song), real media files encoded with Playwright's ffmpeg.
// `seed(server, browser, REPO)` fills it; `seedUser(server, user, fx)` gives the user their places.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LONG_VIDEO_TITLE = 'The Complete History of Every Lighthouse on the Northern Atlantic Coast, Part 3: Storms, Keepers and the Long Winter of 1887';
const PORTRAIT_TITLE = 'Morning espresso at the harbour cafe, one take';
const EPISODE_TITLE = 'Episode 214: Why the oldest maps of the coast got the islands wrong, and what the surveyors learned from it';
const SONG_TITLE = 'Weightless (Live at the Old Harbour Hall)';
const BOOK_TITLE = 'The Lighthouse Keeper\'s Almanac of Small Weathers';
const NEW_BOOK_TITLE = 'A Field Guide to Quiet Places';
const PROSE = [
  'The keeper climbed the stair at dusk as he had done every evening for eleven years, counting the steps out of habit rather than need, and at the top he stood for a moment with his hand on the cold brass of the rail and looked out at the water.',
  'There was weather coming. He could tell by the colour of the light more than by anything the glass said.',
  'His wife had laughed at him for it the first winter, and then the second winter she had stopped laughing, because the glass had been wrong four times and he had been right every time, and the boats that listened to him had come home.',
  'He lit the lamp.',
  'Below him the town was settling into its evening, the windows going yellow one after another along the harbour road, a dog barking somewhere behind the chandlery, the last of the gulls arguing over the fish market roofs. It was the hour he liked best, when the work of the day was finished and the work of the night had not yet properly begun, and he could stand in the lantern room with the great lens turning slowly around him and think about nothing at all.',
  'Tonight, though, he thought about the letter.',
  'It had come that morning on the mail boat, a thin envelope with a government seal, and he had not opened it. He knew what it said, or he thought he did. They had been talking for years about an automatic light, a lamp that would not need a keeper, and every year the talk came a little closer to being a plan.',
  'He put his hand in his coat pocket and felt the envelope there, and left it where it was.',
];
const chapter = (n) => `<h1>Chapter ${n}: The Long Winter</h1>` + Array.from({ length: 6 }, () => PROSE.map((p) => `<p>${p}</p>`).join('')).join('');

async function makeImage(browser, file, w, h, label, hue) {
  const pg = await browser.newPage({ viewport: { width: w, height: h } });
  await pg.setContent(`<body style="margin:0"><div style="width:${w}px;height:${h}px;background:linear-gradient(135deg,hsl(${hue},60%,45%),hsl(${(hue + 60) % 360},55%,22%));display:flex;align-items:center;justify-content:center;font:bold ${Math.round(Math.min(w, h) / 7)}px sans-serif;color:#fff;text-align:center">${label}</div></body>`);
  fs.writeFileSync(file, await pg.screenshot({ type: 'jpeg', quality: 80 }));
  await pg.close();
}

// A real WebM (colour frames), encoded with Playwright's ffmpeg (the card-player proof's recipe), cached per size.
async function makeWebm(browser, file, w, h, hue) {
  const cache = path.join(os.tmpdir(), `ft-feed-layout-${w}x${h}-v1.webm`);
  if (!fs.existsSync(cache)) {
    const root = path.join(os.homedir(), '.cache', 'ms-playwright');
    const ffbin = fs.readdirSync(root).filter((d) => d.startsWith('ffmpeg-')).sort().reverse().map((d) => path.join(root, d, 'ffmpeg-linux')).find((f) => fs.existsSync(f));
    const pg = await browser.newPage({ viewport: { width: w, height: h } });
    const ff = require('node:child_process').spawn(ffbin, ['-y', '-f', 'image2pipe', '-framerate', '2', '-c:v', 'mjpeg', '-i', 'pipe:0', '-c:v', 'libvpx', '-b:v', '300k', '-g', '10', '-r', '2', cache], { stdio: ['pipe', 'ignore', 'inherit'] });
    const done = new Promise((res, rej) => { ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))); });
    await pg.setContent(`<body style="margin:0"><div id=d style="width:${w}px;height:${h}px;font:bold ${Math.round(Math.min(w, h) / 5)}px sans-serif;color:#fff;display:flex;align-items:center;justify-content:center"></div></body>`);
    for (let f = 0; f < 120; f++) {
      await pg.evaluate(([n, hu]) => { const d = document.getElementById('d'); d.style.background = 'hsl(' + ((hu + n * 3) % 360) + ',60%,38%)'; d.textContent = String(n / 2); }, [f, hue]);
      const jpg = await pg.screenshot({ type: 'jpeg', quality: 70 });
      if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end(); await done; await pg.close();
  }
  fs.copyFileSync(cache, file);
}

// 60 s of 8 kHz mono silence: a real, playable WAV for the podcast and the song.
function makeWav(file) {
  const rate = 8000; const n = rate * 60; const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(file, buf);
}

async function seed(server, browser, REPO) {
  const { updateDatabase, scanBooks, booksDb, podcastsDb, musicDb } = server;
  const { seedState } = require(path.join(REPO, 'test/helpers/seed-state'));
  const { buildEpub } = require(path.join(REPO, 'test/helpers/build-zip'));
  const podcastStore = require(path.join(REPO, 'lib/podcasts/store'));
  const musicStore = require(path.join(REPO, 'lib/music/store'));
  const D = process.env.DATA_DIR;
  const clips = path.join(D, 'Clips'); fs.mkdirSync(clips, { recursive: true });
  const thumbs = path.join(D, '.thumbnails'); fs.mkdirSync(thumbs, { recursive: true });
  await makeWebm(browser, path.join(clips, 'land.webm'), 640, 360, 200);
  await makeWebm(browser, path.join(clips, 'port.webm'), 360, 640, 20);
  await makeImage(browser, path.join(thumbs, 'land1.jpg'), 640, 360, 'Lighthouses', 200);
  await makeImage(browser, path.join(thumbs, 'port1.jpg'), 360, 640, 'Espresso', 20);
  const item = (id, file, title, w, h) => ({ id, title, filePath: path.join(clips, file), folderName: 'Clips', rootFolder: D, type: 'video', ext: '.webm', duration: 60, size: fs.statSync(path.join(clips, file)).size, addedAt: Date.now(), channelName: 'Harbour Films', width: w, height: h, hasThumbnail: true });
  const metadata = { land1: item('land1', 'land.webm', LONG_VIDEO_TITLE, 640, 360), port1: item('port1', 'port.webm', PORTRAIT_TITLE, 360, 640) };
  seedState({ folders: [D], folderSettings: {}, metadata, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });

  const booksDir = path.join(D, 'Books'); fs.mkdirSync(booksDir, { recursive: true });
  const coverFile = path.join(D, 'cover.jpg');
  await makeImage(browser, coverFile, 400, 600, 'Quiet<br>Places', 140);
  fs.writeFileSync(path.join(booksDir, 'almanac.epub'), buildEpub({ title: BOOK_TITLE, author: 'Margaret Ellison-Hale', chapters: [chapter(1), chapter(2), chapter(3)] }));
  fs.writeFileSync(path.join(booksDir, 'quiet.epub'), buildEpub({
    title: NEW_BOOK_TITLE, author: 'Tomas Riedel', chapters: [chapter(1), chapter(2)], coverData: fs.readFileSync(coverFile),
    opfExtra: '<dc:description>A walking companion to the overlooked corners of the coast: tide pools, boathouses, the backs of churches, the ends of piers. Riedel spent four years on foot and wrote down what he heard when nothing much was happening. Part field guide, part diary, part argument for slowing down, it is a book to read one place at a time, and then to go and find the next place yourself. With forty drawings by the author and a short note on how to be quiet in company.</dc:description>',
  }));
  await updateDatabase(() => booksDb.mutate((db) => { require(path.join(REPO, 'lib/books/store')).ensureBooks(db).folders = [booksDir]; return true; }));
  await scanBooks();
  const books = {}; for (const b of Object.values(booksDb.read().items)) books[b.title] = b.id;

  const sub = 'c'.repeat(32);
  const showDir = path.join(D, 'podcasts', 'Coastlines'); fs.mkdirSync(showDir, { recursive: true });
  await makeImage(browser, path.join(showDir, 'cover.jpg'), 600, 600, 'Coast<br>lines', 30);
  makeWav(path.join(showDir, 'ep214.wav'));
  const trkDir = path.join(D, 'music'); fs.mkdirSync(trkDir, { recursive: true });
  makeWav(path.join(trkDir, 'weightless.wav'));
  let epId = null;
  await updateDatabase(() => {
    podcastsDb.mutate((h) => {
      const p = podcastStore.ensurePodcasts(h); p.subscriptions = []; p.episodes = {};
      podcastStore.reduceAddSubscription(p, { id: sub, name: 'Coastlines with Ada Mercer', feedUrl: 'https://e.com/c.xml', showDirName: 'Coastlines' });
      podcastStore.reduceUpsertEpisodes(p, sub, [{ guid: 'ep214', title: EPISODE_TITLE, pubDateMs: 1000, durationSec: 60 }], 'pending', 5000);
      epId = podcastStore.episodeIdFor(sub, 'ep214');
      podcastStore.reduceEpisodeDownloaded(p, epId, { fileName: 'ep214.wav', filePath: path.join(showDir, 'ep214.wav'), bytes: fs.statSync(path.join(showDir, 'ep214.wav')).size, nowMs: 6000 });
      const s = p.subscriptions.find((x) => x.id === sub); if (s) s.showDirName = 'Coastlines';
      return true;
    });
    musicDb.mutate((h) => {
      musicStore.ensureMusic(h).tracks = { trk1: { id: 'trk1', title: SONG_TITLE, artist: 'The Night Ferries', album: 'Harbour Lights', filePath: path.join(trkDir, 'weightless.wav'), rootFolder: D, folderName: 'music', ext: '.wav', codec: 'pcm_s16le', durationSec: 60, albumArtKey: null, addedAt: '2026-01-01T00:00:00Z' } };
      return true;
    });
    return true;
  });
  return { books, epId, sub };
}


function seedUser(server, user, fx) {
  const { userStore } = server;
  const now = new Date().toISOString();
  userStore.setProgress(user.id, 'land1', { timestamp: 6, duration: 60, updatedAt: now });
  userStore.setProgress(user.id, 'port1', { timestamp: 4, duration: 60, updatedAt: now });
  userStore.setPodcastProgress(user.id, fx.epId, { position: 10, duration: 60, updatedAt: now });
  userStore.setBookProgress(user.id, fx.books[BOOK_TITLE], { locator: { kind: 'epub', cfi: '', spineIndex: 0, blockIndex: 3 }, percent: 5, updatedAt: now });
  userStore.addBookLiked(user.id, fx.books[NEW_BOOK_TITLE], now);
  userStore.addMusicLiked(user.id, 'trk1', now);
}

module.exports = { seed, seedUser, BOOK_TITLE, NEW_BOOK_TITLE, LONG_VIDEO_TITLE };
