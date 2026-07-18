'use strict';

// [INTEGRATION] v1.44 T6: the music read/stream/art routes against the REAL
// app. Seeds db.music.tracks directly (the scanner is covered in
// music-scan.test.js) so the browse/album/artist/liked/detail/stream/art
// contracts are tested in isolation. Per-user assertions key off the minted
// session user.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-musicapi-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, updateDatabase, ALBUMART_DIR, userStore, audioPath,
  flushPendingMusicProgress, effectiveMusicProgress, __getMusicProgressFlushWriteCount,
} = require('../../server');
const musicStore = require('../../lib/music/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, user, libRoot;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  ({ user } = authenticateFetch(server, base));
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

function get(p) { return fetch(`${base}${p}`); }
function postJson(p, body) { return fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

// Build a small library on disk + in db.music.tracks. Two albums by one artist
// plus a compilation.
async function seedLibrary() {
  libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-musiclib-'));
  const mk = (rel, meta) => {
    const full = path.join(libRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'AUDIOBYTES');
    const id = require('crypto').createHash('md5').update(full).digest('hex');
    const albumArtKey = require('crypto').createHash('md5').update(musicStore.albumKeyFor(meta)).digest('hex');
    return Object.assign({ id, filePath: full, rootFolder: libRoot, ext: path.extname(full), addedAt: '2026-01-01T00:00:00.000Z', albumArtKey, durationSec: 200 }, meta);
  };
  const t1 = mk('Floyd/Wall/01 Mother.flac', { artist: 'Pink Floyd', albumArtist: 'Pink Floyd', album: 'The Wall', title: 'Mother', trackNo: 1, discNo: 1, year: 1979 });
  const t2 = mk('Floyd/Wall/02 Hey You.flac', { artist: 'Pink Floyd', albumArtist: 'Pink Floyd', album: 'The Wall', title: 'Hey You', trackNo: 2, discNo: 1, year: 1979 });
  const t3 = mk('Floyd/Animals/01 Pigs.flac', { artist: 'Pink Floyd', albumArtist: 'Pink Floyd', album: 'Animals', title: 'Pigs', trackNo: 1, discNo: 1, year: 1977 });
  await updateDatabase((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks = {}; ns.folders = [libRoot];
    for (const t of [t1, t2, t3]) ns.tracks[t.id] = t;
    return true;
  });
  return { t1, t2, t3 };
}

beforeEach(async () => {
  // Clear this user's music state between cases.
  const prog = userStore.getMusicProgress(user.id);
  const liked = userStore.getMusicLiked(user.id);
  userStore.removeMusicState([...new Set([...Object.keys(prog), ...liked])]);
});

test('T6: GET /api/music lists tracks (paginated), search + album filter + sort work', async () => {
  const { t1 } = await seedLibrary();
  let data = await (await get('/api/music')).json();
  assert.equal(data.total, 3);
  assert.equal(data.items.length, 3);
  assert.ok(!('filePath' in data.items[0]), 'filePath is NOT surfaced (path scrub)');

  // search
  data = await (await get('/api/music?search=pigs')).json();
  assert.equal(data.total, 1);
  assert.equal(data.items[0].title, 'Pigs');

  // album filter (by album key) returns that album in disc/track order
  const albumKey = musicStore.albumKeyFor(t1);
  data = await (await get(`/api/music?album=${encodeURIComponent(albumKey)}`)).json();
  assert.deepEqual(data.items.map((i) => i.title), ['Mother', 'Hey You'], 'album order');

  // pagination
  data = await (await get('/api/music?limit=1&offset=0&sort=title-asc')).json();
  assert.equal(data.items.length, 1);
  assert.equal(data.total, 3);
});

test('T6: GET /api/music/albums groups; /api/music/artists groups', async () => {
  await seedLibrary();
  const albums = await (await get('/api/music/albums')).json();
  assert.equal(albums.total, 2, 'two albums');
  const wall = albums.items.find((a) => a.album === 'The Wall');
  assert.equal(wall.trackCount, 2);
  assert.ok(typeof wall.artId === 'string', 'representative track id present');

  const artists = await (await get('/api/music/artists')).json();
  assert.equal(artists.total, 1);
  assert.equal(artists.items[0].artist, 'Pink Floyd');
  assert.equal(artists.items[0].albumCount, 2);
  assert.equal(artists.items[0].trackCount, 3);
});

test('T6: liked toggle is per-user; filter=liked reflects it; unknown track 404s', async () => {
  const { t1 } = await seedLibrary();
  let r = await postJson(`/api/music/liked/${t1.id}`);
  assert.equal(r.status, 200);
  assert.deepEqual((await (await get('/api/music/liked')).json()).trackIds, [t1.id]);
  let data = await (await get('/api/music?filter=liked')).json();
  assert.equal(data.total, 1);
  assert.equal(data.items[0].id, t1.id);
  assert.equal(data.items[0].liked, true);

  r = await fetch(`${base}/api/music/liked/${t1.id}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.deepEqual((await (await get('/api/music/liked')).json()).trackIds, []);

  r = await postJson('/api/music/liked/nonexistent');
  assert.equal(r.status, 404, 'liking an unknown track 404s');
});

test('T6: GET /api/music/:id returns the track (with liked+progress); unknown 404s', async () => {
  const { t1 } = await seedLibrary();
  userStore.setMusicProgress(user.id, t1.id, { position: 55, duration: 200, updatedAt: '2026-02-02T00:00:00Z' });
  const data = await (await get(`/api/music/${t1.id}`)).json();
  assert.equal(data.title, 'Mother');
  assert.equal(data.progress.position, 55);
  const r = await get('/api/music/nope');
  assert.equal(r.status, 404);
});

test('T6: GET /track/:id streams with a Range (206) and the right content type; missing 404s', async () => {
  const { t1 } = await seedLibrary();
  const full = await get(`/track/${t1.id}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'audio/flac');
  const ranged = await fetch(`${base}/track/${t1.id}`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(ranged.status, 206, 'range request -> 206 partial');
  assert.equal(await get('/track/nope').then((r) => r.status), 404);
});

test('T6: GET /albumart/:id serves the real art if present, else an SVG placeholder', async () => {
  const { t1 } = await seedLibrary();
  // No art file yet -> placeholder SVG.
  let res = await get(`/albumart/${t1.id}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /svg/);
  const svg = await res.text();
  assert.ok(svg.includes('The Wall'), 'placeholder carries the (escaped) album name');

  // Write a real art file for the album -> served as the image.
  fs.mkdirSync(ALBUMART_DIR, { recursive: true });
  fs.writeFileSync(path.join(ALBUMART_DIR, `${t1.albumArtKey}.jpg`), Buffer.from([0xff, 0xd8, 0xff]));
  res = await get(`/albumart/${t1.id}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /jpeg|jpg/);
});

test('T7: an ALAC track with no cached rendition answers 503 transcoding; a native track streams; a present rendition is served', async () => {
  await seedLibrary();
  // Add an ALAC track (probed codec 'alac') with no rendition yet.
  const alacFull = path.join(libRoot, 'Floyd/Wall/03 Alac.m4a');
  fs.writeFileSync(alacFull, 'ALACBYTES');
  const alacId = require('crypto').createHash('md5').update(alacFull).digest('hex');
  await updateDatabase((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks[alacId] = { id: alacId, filePath: alacFull, rootFolder: libRoot, ext: '.m4a', title: 'Alac', artist: 'Pink Floyd', album: 'The Wall', albumArtKey: 'z'.repeat(32), codec: 'alac', durationSec: 100, addedAt: '2026-01-01T00:00:00Z' };
    return true;
  });
  // No rendition on disk -> 503 (CI has no ffmpeg, so the enqueue is a no-op
  // and it STAYS 503 — the correct "would transcode" signal).
  let r = await get(`/track/${alacId}`);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'transcoding');

  // Simulate a finished rendition (audioPath = TRANSCODE_DIR/<id>.m4a) -> served.
  fs.mkdirSync(path.dirname(audioPath(alacId)), { recursive: true });
  fs.writeFileSync(audioPath(alacId), 'RENDITION');
  r = await get(`/track/${alacId}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/mp4', 'rendition served as m4a');
});

test('T6: resume pointer round-trips per user', async () => {
  const { t1 } = await seedLibrary();
  await postJson('/api/music/resume', { lastTrackId: t1.id, queueCtx: { src: 'music', album: 'x' }, position: 42 });
  const data = await (await get('/api/music/resume')).json();
  assert.equal(data.lastTrackId, t1.id);
  assert.equal(data.position, 42);
  assert.deepEqual(data.queueCtx, { src: 'music', album: 'x' });
});

test('T8: POST /api/music/progress stages (read-your-writes), coalesces many pings into ONE flush write, drops a deleted track', async () => {
  const { t1, t2 } = await seedLibrary();
  const before = __getMusicProgressFlushWriteCount();

  // Several pings across two tracks -> read-your-writes overlay before any flush.
  await postJson('/api/music/progress', { id: t1.id, position: 10, duration: 200 });
  await postJson('/api/music/progress', { id: t1.id, position: 25, duration: 200 });
  await postJson('/api/music/progress', { id: t2.id, position: 5, duration: 200 });
  assert.equal(effectiveMusicProgress(user.id, t1.id).position, 25, 'read-your-writes: latest pending value');
  // GET route reflects it too.
  assert.equal((await (await get(`/api/music/progress/${t1.id}`)).json()).position, 25);

  // One flush window commits all staged rows in a single write pass.
  await flushPendingMusicProgress();
  assert.equal(__getMusicProgressFlushWriteCount(), before + 1, '>=5:1 write-amp: N pings -> 1 flush write');
  assert.equal(userStore.getOneMusicProgress(user.id, t1.id).position, 25, 'committed');
  assert.equal(userStore.getOneMusicProgress(user.id, t2.id).position, 5);

  // A ping for a track deleted between ping and flush is dropped, not resurrected.
  await postJson('/api/music/progress', { id: t1.id, position: 99, duration: 200 });
  await updateDatabase((db) => { delete musicStore.ensureMusic(db).tracks[t1.id]; return true; });
  await flushPendingMusicProgress();
  // t1's committed position stays at the last pre-delete flush (25), never 99.
  const after = userStore.getOneMusicProgress(user.id, t1.id);
  assert.ok(after === null || after.position === 25, 'deleted-track ping did not resurrect/overwrite');
});
