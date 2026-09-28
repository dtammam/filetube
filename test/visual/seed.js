#!/usr/bin/env node
'use strict';
// Synthetic fixture seeder for the visual and geometry checks (UI professionalism
// pass, D10.2/D10.5). Builds a DATA_DIR from nothing: no copy of a real library,
// no real creators, no ffmpeg. Everything a surface needs to render populated is
// generated here: library videos (with drawn thumbnails), two channels with
// channel identity (one subscribed with notify on, one not), yt-dlp subscriptions,
// music (3 artists x 2 albums x 4 tracks), podcasts (2 shows x 5 episodes),
// books (two shelves: 6 EPUBs with drawn covers + 1 cover-less PDF, two in progress,
// one liked, one shelf pinned), notifications, a queue and watch progress.
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
// SEED_NOW (ms) pins the fixture's clock: every stamped row, including the ones the real
// routes stamp below (watch progress), is written at SEED_NOW + seconds, via clock-shim.js.
// Unset, the seed uses the real clock (manual runs). test/visual/run.js always pins it.
if (Number(process.env.SEED_NOW) > 0 && !process.env.FILETUBE_CLOCK_MS) {
  process.env.FILETUBE_CLOCK_MS = String(Number(process.env.SEED_NOW));
  require('./clock-shim.js');
}
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
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

// ---- books: tiny valid EPUBs (a stored zip, drawn PNG covers) and one PDF ----
// The real scanner indexes them (scanBooks), so covers, titles, authors and the spine
// come from the same code path a real library takes; the reader opens them with epub.js.
function zipStored(entries) {
  const locals = []; const centrals = []; let off = 0;
  for (const { name, data } of entries) {
    const nm = Buffer.from(name, 'utf8'); const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(10, 4); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(10, 6); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, data); centrals.push(ch, nm);
    off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PROSE = [
  'The harbor was quiet before the boats came in, and the lamps along the quay burned a steady yellow against the fog.',
  'She kept the ledger open on the bench beside the window, adding a line for every ship that passed the breakwater.',
  'Nobody asked why the lighthouse keeper wrote letters he never sent; the drawer simply filled, one envelope at a time.',
  'By the third winter the canal had frozen twice, and the old ferryman taught the children to read the ice by its colour.',
  'There is a kind of patience that only a tide can teach, and the town had learned it slowly, over a hundred years.',
];
function epubBook(n, title, author, chapters) {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:filetube-visual-fixture:${n}</dc:identifier>
<dc:title>${xmlEsc(title)}</dc:title><dc:creator>${xmlEsc(author)}</dc:creator><dc:language>en</dc:language>
<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
${chapters.map((_, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine>${chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine>
</package>
`;
  const page = (head, body) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${xmlEsc(head)}</title></head><body>${body}</body></html>
`;
  const nav = page('Contents', `<nav epub:type="toc"><h1>Contents</h1><ol>${chapters.map((c, i) => `<li><a href="c${i + 1}.xhtml">${xmlEsc(c)}</a></li>`).join('')}</ol></nav>`);
  const files = [
    { name: 'mimetype', data: Buffer.from('application/epub+zip') },
    { name: 'META-INF/container.xml', data: Buffer.from('<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n') },
    { name: 'OEBPS/content.opf', data: Buffer.from(opf) },
    { name: 'OEBPS/nav.xhtml', data: Buffer.from(nav) },
    { name: 'OEBPS/cover.png', data: drawImage(300 + n, 200, 300) },
  ];
  chapters.forEach((c, i) => {
    const paras = Array.from({ length: 14 }, (_, k) => `<p>${PROSE[(i + k) % PROSE.length]}</p>`).join('');
    files.push({ name: `OEBPS/c${i + 1}.xhtml`, data: Buffer.from(page(c, `<h2>${xmlEsc(c)}</h2>${paras}`)) });
  });
  return zipStored(files);
}
// A one-page PDF with a line of text (xref offsets computed, so pdf.js opens it cleanly).
function pdfBook(text) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'];
  const stream = `BT /F1 18 Tf 48 520 Td (${text}) Tj ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
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

  // The watch page (UI pass sweep S3). The subscribed fixture video carries a description long
  // enough to clamp and a caption sidecar (so its action bar shows Transcript); the
  // unsubscribed one carries REAL captured view and subscriber counts (they show in every era,
  // where the mock counts of the other videos show only in the retro eras, D8.1).
  const harborFirst = meta[byChannel['Harbor Workshop'][0]];
  harborFirst.tags = { description: 'The bench came out of a school workshop in 1958 and spent forty years in a garage. '
    + 'In this first part we strip it, flatten the top and find out what is worth saving.\n\n'
    + 'Chapters, tools and timber are listed on the channel page. Part two covers the vise hardware, the '
    + 'finish and the drawer runners, and part three is the build log for the tool rack behind it.' };
  harborFirst.hasSubtitles = true;
  fs.mkdirSync(path.dirname(harborFirst.filePath), { recursive: true });
  fs.writeFileSync(harborFirst.filePath.replace(/\.mp4$/, '.en.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nA fixture caption line.\n');
  Object.assign(meta[byChannel['Northbound Field Notes'][0]], {
    sourceViewCount: 18342, sourceViewCountCapturedAt: NOW - 20 * 86400e3,
    sourceFollowerCount: 48200, sourceFollowerCountCapturedAt: NOW - 20 * 86400e3,
  });

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

  // yt-dlp subscriptions: one matches the library channel (notify on, 3 new), three are remote-only
  // (one paused with a long name, one whose last check failed).
  const sub = (id, name, url, order, extra) => Object.assign({ id, channelUrl: url, name, format: 'video', quality: 'best', maxVideos: 5,
    maxDurationSeconds: null, minDurationSeconds: null, paused: false, skipShorts: false, pushBell: false, filetype: 'mp4', cutoffDate: null,
    order, addedAt: new Date(NOW - 30 * 86400e3).toISOString(), lastCheckedAt: new Date(NOW - 3600e3).toISOString(), lastStatus: 'ok', libraryPlace: 'default' }, extra || {});
  ytdlpDb.replaceAll({ allowMembersOnly: false, downloadMeta: {}, channelAvatars: {}, pins: [],
    subscriptions: [
      sub('sub-harbor', 'Harbor Workshop', CHANNELS[0][1], 0, { pushBell: true, lastStatus: 'ok: downloaded 3 new video(s)' }),
      sub('sub-tidewater', 'The Tidewater Set', 'https://www.youtube.com/@tidewaterset', 1, { format: 'audio' }),
      sub('sub-orchard', 'Glass Orchard Workshop - long channel name for wrapping', 'https://www.youtube.com/@glassorchard', 2, { paused: true }),
      // A failed last check (the row's "Check failed" line, UI pass S5 / D8.9).
      sub('sub-lantern', 'Lantern Street Studio', 'https://www.youtube.com/@lanternstreet', 3,
        { lastCheckedAt: new Date(NOW - 2 * 3600e3).toISOString(), lastStatus: 'error: HTTP Error 403: Forbidden' }),
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
  // pollMinutes 0 = manual only: no feed-poll timer arms, so a long-running fixture server
  // never re-checks the (unreachable) feeds and rewrites their status lines (step 3's
  // determinism note: a status line changed under a server that had run for over an hour).
  podcastsDb.replaceAll({ settings: { pollMinutes: 0 }, episodes, subscriptions: shows.map(([id, name, author], i) => ({ id, name, author, showDirName: name,
    feedUrlDisplay: `https://feeds.example.com/${id}`, feedHost: 'feeds.example.com', description: `${name} - a fixture show.`, paused: false,
    backfill: 5, order: i, addedAt: NOW - 60 * 86400e3, lastCheckedAt: NOW - 3600e3, lastStatus: 'ok' })) });

  // Notifications: 6 unread rows for the subscribed channel's newest items.
  const harbor = byChannel['Harbor Workshop'];
  settingsStore.set('notificationsSeededAt', NOW);
  let notifications = userStore.recordNotifications(harbor.slice(0, 6).map((mediaId, i) => ({ mediaId, createdAt: NOW - (i + 1) * 2 * 3600e3 })));
  // UI pass S4: the panel's other row kinds - a podcast episode (show art as its avatar), a
  // downloader-engine event (admin-only; the seed user is the admin) and a READ media row from
  // another channel - older than the six, so the Harbor rows stay on top.
  notifications += userStore.recordNotifications([
    { mediaId: 'pod-harbor-e1', kind: 'podcast', createdAt: NOW - 13 * 3600e3 },
    { mediaId: 'engine:updated:2026.9.20', kind: 'engine', createdAt: NOW - 20 * 3600e3 },
    { mediaId: byChannel['Northbound Field Notes'][1], createdAt: NOW - 26 * 3600e3 },
  ]);
  const seedAdmin = userStore.getByUsername(USER);
  const readRow = seedAdmin && userStore.listNotifications(seedAdmin.id).items.find((r) => r.mediaId === byChannel['Northbound Field Notes'][1]);
  if (!readRow || !userStore.markNotificationRead(seedAdmin.id, readRow.id, NOW)) console.error('seed: could not mark the read notification');

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
  // Books, through the real routes and the real scanner: the config (admin), a scan,
  // reading progress on two (the Continue shelf), a like and a pinned shelf.
  const booksRoot = path.join(DATA, 'bookslib');
  const BOOKS = [
    ['Harbor Library', 'The Lamplighter\'s Ledger', 'Mara Quill', ['The Quay at Dusk', 'Ledger Lines', 'A Ship Past the Breakwater']],
    ['Harbor Library', 'Salt and Signal', 'Tobin Arle', ['Morning Fog', 'The Signal Box', 'Low Water']],
    ['Harbor Library', 'Letters from the Lighthouse', 'Ines Varro', ['The First Letter', 'Winter Keepers']],
    ['Harbor Library', 'A Field Guide to Quiet Harbors, with a Title Long Enough to Wrap', 'Harbor Workshop Press', ['Introduction', 'Moorings']],
    ['Night Reading', 'The Frozen Canal', 'Petra Lund', ['Ice Colours', 'The Ferryman', 'Thaw']],
    ['Night Reading', 'Northbound, Slowly', 'Oriel Vance', ['Departure', 'The Rail Line']],
  ];
  BOOKS.forEach(([shelf, title, author, chapters], n) => {
    const dir = path.join(booksRoot, shelf);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${title.replace(/[^A-Za-z0-9]+/g, '_')}.epub`), epubBook(n, title, author, chapters));
  });
  fs.writeFileSync(path.join(booksRoot, 'Night Reading', 'Tide_Tables_1987.pdf'), pdfBook('Tide Tables, 1987 - a fixture PDF'));
  await post('/api/books/config', { folders: [booksRoot] });
  // The config route starts its own scan (a concurrent scanBooks() only queues a
  // follow-up), so wait for the index to hold every file.
  let bookList = { items: [] };
  for (let i = 0; i < 100 && bookList.items.length < BOOKS.length + 1; i++) {
    await new Promise((r) => setTimeout(r, 100));
    bookList = await fetch(`${base}/api/books?sort=title-asc&limit=50`, { headers: { Cookie: ck } }).then((r) => r.json());
  }
  if (bookList.items.length !== BOOKS.length + 1) { postFailures++; console.error('seed: books indexed', bookList.items.length); }
  const bookByTitle = Object.fromEntries(bookList.items.map((b) => [b.title, b.id]));
  // The scanner stamps addedAt with the real clock at scan time, so two books indexed in the
  // same millisecond tied and their order (the default newest-first sort, search recency) flipped
  // between runs: 48 shots changed on a re-capture of an identical tree. Pin each one, an hour
  // apart in BOOKS order (the PDF last), the way the videos and music are pinned above.
  const bookOrder = [...BOOKS.map((b) => b[1]), 'Tide Tables 1987']; // the PDF indexes by its file name
  const bookIdSet = new Set(bookList.items.map((b) => b.id));
  await updateDatabase(() => s.booksDb.mutate((db) => {
    const ns = require(path.join(REPO, 'lib', 'books', 'store')).ensureBooks(db);
    for (const b of bookList.items) {
      const n = bookOrder.indexOf(b.title);
      if (n === -1 || !ns.items[b.id]) throw new Error(`seed: cannot pin addedAt for book "${b.title}"`);
      ns.items[b.id].addedAt = new Date(NOW - 200 * 86400e3 - n * 3600e3).toISOString();
    }
    return bookIdSet.size > 0;
  }));
  // Bind the pin at RUN time, not just in source: every book must now hold its own addedAt
  // (a tie is exactly the flake this fixes), or the seed fails.
  const pinnedAt = Object.values(s.booksDb.read().items || {}).map((b) => b.addedAt);
  if (pinnedAt.length !== bookOrder.length || new Set(pinnedAt).size !== pinnedAt.length) {
    throw new Error(`seed: book addedAt not pinned to distinct values (${pinnedAt.join(', ')})`);
  }
  const readingBook = bookByTitle['The Lamplighter\'s Ledger'];
  await post(`/api/books/${encodeURIComponent(readingBook)}/progress`, { locator: { kind: 'epub', cfi: 'epubcfi(/6/4!/4/2/1:0)', spineIndex: 1 }, percent: 38 });
  await post(`/api/books/${encodeURIComponent(bookByTitle['The Frozen Canal'])}/progress`, { locator: { kind: 'epub', cfi: 'epubcfi(/6/6!/4/2/1:0)', spineIndex: 2 }, percent: 71 });
  await s.flushPendingBookProgress();
  await post(`/api/books/liked/${encodeURIComponent(readingBook)}`, {});
  await post('/api/books/pins', { dir: path.join(booksRoot, 'Harbor Library'), label: 'Harbor Library' });
  // One pinned subscription (the Subscriptions rows show pinned and unpinned side by side).
  await post('/api/subscriptions/pins', { channelDir: path.join(DATA, 'ytdlp-downloads', 'Harbor Workshop'), label: 'Harbor Workshop' });
  server.close();

  // viewNow: the wall clock the server (start-server.sh, clock-shim.js) and the browser
  // (capture.js installPinnedClock) start at - one hour after the seed, so every seeded
  // row, route-stamped ones included, is in the past and reads the same relative date.
  const fixtures = { dataDir: DATA, seededAt: NOW, viewNow: NOW + 3600e3, pinned: Number(process.env.SEED_NOW) > 0, user: USER, password: PASSWORD,
    video: harbor[0], videoUnsub: byChannel['Northbound Field Notes'][0], track: musicIds[0],
    // the resume toast's video (D8.2): the seed stores its progress through its OWN minted session,
    // which is not the capture login's user, so a probe routes GET /api/progress/<it> to a position
    // past the threshold (the S3 probe does) - on its own it resumes nothing
    videoResume: home[1],
    book: readingBook, bookShelf: path.join(booksRoot, 'Harbor Library'),
    counts: { videos: Object.values(meta).filter((m) => m.type === 'video').length, musicTracks: musicIds.length,
      podcastEpisodes: Object.keys(episodes).length, books: bookList.items.length, notifications } };
  fs.writeFileSync(path.join(DATA, 'fixtures.json'), JSON.stringify(fixtures, null, 1));
  console.log(JSON.stringify(fixtures));
  setTimeout(() => process.exit(postFailures ? 1 : 0), 500);
})().catch((e) => { console.error(e); process.exit(1); });
