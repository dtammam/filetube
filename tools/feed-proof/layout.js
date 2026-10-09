'use strict';
/* global document, window, getComputedStyle */
// v1.381.0 Feed, TikTok style (plan docs/exec-plans/active/2026-10-09-feed-tiktok.md, W1 + W2): the MEASURED layout.
// Boots the real server on a real library with one item of every card kind (a reading book, an unstarted book with a
// cover and a description, a landscape video and a portrait video in progress with thumbnails, a podcast episode with
// show art, a liked song), opens /feed in a real browser at 390 x 844 and 320 x 568 (DPR 3, touch), walks the real
// stack card by card and reads back, per card: the rects of the card, the kind line, the title, the HUD (ring, time,
// Done), the media layer, the overlay; every element inside the card that SCROLLS (scrollHeight > clientHeight with
// overflow auto / scroll: the D6 "no scroll trap" count); text that overflows the card; the HUD's overlap with the
// title and the overlay. W1: on Home the other-device card shows (a real ping from another device), in the Feed it and
// the download chip are display:none, and back on Home the card is shown again. Screenshots of each card go to outDir.
//
//   node tools/feed-proof/layout.js <repoRoot> <outDir> [chromium|webkit|both] [390x844,320x568]
// Not a CI gate: a proof tool (like tools/feed-proof/card-player.js).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT_DIR = path.resolve(process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'ft-feed-layout-')));
const ENGINES = (process.argv[4] || 'chromium') === 'both' ? ['chromium', 'webkit'] : [process.argv[4] || 'chromium'];
const VIEWPORTS = (process.argv[5] || '390x844,320x568').split(',').map((v) => { const [w, h] = v.split('x').map(Number); return { w, h }; });
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-feedlayout-'));
process.env.PROGRESS_FLUSH_MS = '50';
fs.mkdirSync(OUT_DIR, { recursive: true });

const pw = require(require.resolve('playwright', { paths: [path.join(REPO, 'tools/capture'), '/home/coder/projects/filetube/tools/capture'] }));

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

async function seed(server, browser) {
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

// Everything the plan's section 7 asks for, read in the page for the ACTIVE card.
function measureInPage() {
  const R = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const overlap = (a, b) => (a && b ? Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) : 0);
  const card = document.querySelector('.feed-card[data-active]');
  if (!card) return null;
  const q = (s) => card.querySelector(s);
  const cardR = R(card);
  const scrollers = [];
  const spills = [];
  // the blurred backdrop is scaled past the card on purpose (the blur's soft edge) and clipped by the media layer
  card.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) scrollers.push({ cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className), scrollH: el.scrollHeight, clientH: el.clientHeight });
    const r = R(el);
    if (r && cs.visibility !== 'hidden' && !el.classList.contains('feed-card__backdrop') && (r.y + r.h > cardR.y + cardR.h + 1 || r.y < cardR.y - 1) && !el.closest('[hidden]')) spills.push({ cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 40), tag: el.tagName, r });
  });
  const title = q('.feed-card__title');
  const lh = title ? parseFloat(getComputedStyle(title).lineHeight) : 0;
  const hud = document.getElementById('feed-hud');
  const overlay = q('.feed-card__overlay');
  const media = q('.feed-card__media') || q('.feed-card__slot') || q('.feed-card__art') || q('.feed-card__poster');
  const host = document.getElementById('player-wrapper');
  const video = document.getElementById('media-player');
  const out = {
    kind: card.getAttribute('data-kind') + (card.hasAttribute('data-new-book') ? ':new' : '') + (card.hasAttribute('data-portrait') ? ':portrait' : ''),
    card: cardR,
    kindLine: R(q('.feed-card__kind')),
    title: R(title),
    titleLines: title && lh ? Math.round(title.getBoundingClientRect().height / lh) : null,
    titleClipped: title ? title.scrollHeight > title.clientHeight + 1 : null,
    meta: R(q('.feed-card__meta')),
    hud: R(hud), ring: R(document.getElementById('feed-ring-btn')), done: R(document.getElementById('feed-done-btn')),
    overlay: R(overlay),
    media: R(media),
    art: R(q('.feed-card__art')), poster: R(q('.feed-card__poster')), slot: R(q('.feed-card__slot')), cover: R(q('.feed-card__cover')),
    text: R(q('.feed-card__text:not(.feed-card__taste)')), desc: R(q('.feed-card__desc')), actions: R(q('.feed-card__actions')),
    host: host && card.contains(host) ? R(host) : null,
    video: video && card.contains(video) ? Object.assign(R(video) || {}, { fit: getComputedStyle(video).objectFit, vw: video.videoWidth, vh: video.videoHeight }) : null,
    controlsVisible: host && card.contains(host) ? Array.from(host.querySelectorAll('.player-controls, .controls-bar, .player-bar')).some((c) => { const r = c.getBoundingClientRect(); return r.height > 0 && getComputedStyle(c).visibility !== 'hidden' && getComputedStyle(c).opacity !== '0'; }) : null,
    // a classic (non-overlay) scrollbar on the stack narrows every card by its width (desktop engines; iOS overlays it)
    stackScrollbar: (() => { const st = document.getElementById('feed-stack'); return st ? st.offsetWidth - st.clientWidth : null; })(),
    scrollers,
    spills: spills.slice(0, 8),
    spillCount: spills.length,
  };
  out.hudOverTitle = overlap(out.hud, out.title);
  out.hudOverKind = overlap(out.hud, out.kindLine);
  out.hudOverOverlay = overlap(out.hud, out.overlay);
  out.hudOverText = overlap(out.hud, out.text);
  return out;
}

async function main() {
  const server = require(path.join(REPO, 'server.js'));
  const { app, __mintTestSession, userStore } = server;
  const helper = await pw.chromium.launch();
  const fx = await seed(server, helper);
  await helper.close();
  const listening = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${listening.address().port}`;
  const { cookie, user } = __mintTestSession();
  const now = new Date().toISOString();
  userStore.setProgress(user.id, 'land1', { timestamp: 6, duration: 60, updatedAt: now });
  userStore.setProgress(user.id, 'port1', { timestamp: 4, duration: 60, updatedAt: now });
  userStore.setPodcastProgress(user.id, fx.epId, { position: 10, duration: 60, updatedAt: now });
  userStore.setBookProgress(user.id, fx.books[BOOK_TITLE], { locator: { kind: 'epub', cfi: '', spineIndex: 0, blockIndex: 3 }, percent: 5, updatedAt: now });
  userStore.addBookLiked(user.id, fx.books[NEW_BOOK_TITLE], now);
  userStore.addMusicLiked(user.id, 'trk1', now);
  const results = [];

  for (const engine of ENGINES) {
    for (const vp of VIEWPORTS) {
      const browser = await pw[engine].launch({ args: engine === 'chromium' ? ['--autoplay-policy=no-user-gesture-required'] : [] });
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 3, isMobile: engine === 'chromium', hasTouch: true });
      await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1].split(';')[0], url: base }]);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e && e.message)));
      const tag = `${engine}-${vp.w}x${vp.h}`;

      // W1: another device is watching the landscape clip (a real progress ping with a device identity)
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await page.evaluate(async () => { await fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'land1', timestamp: 7, duration: 60, deviceId: 'probe-other-phone', deviceLabel: 'Kitchen iPad' }) }); });
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => { const c = document.getElementById('handoff-card'); return c && !c.hidden; }, null, { timeout: 15000 }).catch(() => {});
      const chipOn = () => { if (typeof window.injectDownloadStatusChip === 'function') window.injectDownloadStatusChip(); const c = document.getElementById('dl-status-chip'); if (c) c.hidden = false; return !!c; };
      await page.evaluate(chipOn);
      await page.waitForTimeout(300);
      const disp = () => ({ handoff: (() => { const c = document.getElementById('handoff-card'); return c ? (c.hidden ? 'hidden-attr' : getComputedStyle(c).display) : 'absent'; })(), chip: (() => { const c = document.getElementById('dl-status-chip'); return c ? (c.hidden ? 'hidden-attr' : getComputedStyle(c).display) : 'absent'; })(), view: document.body.getAttribute('data-view') });
      const w1Home = await page.evaluate(disp);
      await page.evaluate(() => window.FileTube.navigate('/feed'));
      await page.waitForSelector('#feed-picker-choices button[data-minutes="10"]', { timeout: 15000 });
      await page.evaluate(chipOn);
      const w1Feed = await page.evaluate(disp);

      await page.click('#feed-picker-choices button[data-minutes="10"]');
      await page.waitForSelector('.feed-card[data-active]', { timeout: 15000 });
      const cards = [];
      const seen = new Set();
      for (let i = 0; i < 14 && seen.size < 6; i++) {
        const has = await page.evaluate((n) => { const c = document.querySelectorAll('.feed-card')[n]; if (!c) return false; c.scrollIntoView({ block: 'start' }); return true; }, i);
        if (!has) { await page.waitForTimeout(800); const again = await page.evaluate((n) => !!document.querySelectorAll('.feed-card')[n], i); if (!again) break; await page.evaluate((n) => document.querySelectorAll('.feed-card')[n].scrollIntoView({ block: 'start' }), i); }
        await page.waitForFunction((n) => { const c = document.querySelectorAll('.feed-card')[n]; return c && c.hasAttribute('data-active'); }, i, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1800);
        const m = await page.evaluate(measureInPage);
        if (!m || m.kind === 'notice') continue;
        const key = m.kind;
        if (seen.has(key)) continue;
        seen.add(key);
        const shot = path.join(OUT_DIR, `${tag}-${key.replace(/:/g, '-')}.png`);
        await page.screenshot({ path: shot });
        cards.push(Object.assign({ shot: path.basename(shot) }, m));
      }
      await page.evaluate(() => window.FileTube.navigate('/'));
      await page.waitForFunction(() => document.body.getAttribute('data-view') === 'home', null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);
      const w1Back = await page.evaluate(disp);
      await browser.close();
      const w1 = { home: w1Home, feed: w1Feed, back: w1Back };
      const row = { engine, viewport: `${vp.w}x${vp.h}`, w1, cards, errors };
      results.push(row);
      console.log(`== ${tag} W1 home=${JSON.stringify(w1Home)} feed=${JSON.stringify(w1Feed)} back=${JSON.stringify(w1Back)}${errors.length ? ' errors=' + JSON.stringify(errors) : ''}`);
      for (const c of cards) {
        console.log(`  ${c.kind.padEnd(16)} card=${JSON.stringify(c.card)} title=${JSON.stringify(c.title)} lines=${c.titleLines} hud=${JSON.stringify(c.hud)} hudOverTitle=${c.hudOverTitle} hudOverText=${c.hudOverText} overlay=${JSON.stringify(c.overlay)} media=${JSON.stringify(c.media)} art=${JSON.stringify(c.art)} poster=${JSON.stringify(c.poster)} host=${JSON.stringify(c.host)} video=${JSON.stringify(c.video)} controls=${c.controlsVisible} sb=${c.stackScrollbar} scrollers=${c.scrollers.length}${c.scrollers.length ? JSON.stringify(c.scrollers) : ''} spills=${c.spillCount}`);
      }
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'layout.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const kinds = results.map((r) => r.cards.length);
  console.log(`SUMMARY layout: ${results.length} runs, cards per run ${JSON.stringify(kinds)}, scrollers ${results.reduce((n, r) => n + r.cards.reduce((m, c) => m + c.scrollers.length, 0), 0)}, hudOverTitle>0 ${results.reduce((n, r) => n + r.cards.filter((c) => c.hudOverTitle > 0).length, 0)}, out ${OUT_DIR}`);
  listening.closeAllConnections?.();
  await new Promise((resolve) => listening.close(resolve));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(2); });
