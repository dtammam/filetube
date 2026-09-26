'use strict';

// [INTEGRATION] v1.339 (L1, M2): GET /albumart/:id?s=<px> - the SIZED album-art
// rendition, against the REAL app with the stub-ffmpeg-on-PATH harness
// (pre-extract-audio.test.js's pattern - CI has no ffmpeg). The stub writes a
// recognizable body to its last argument (the tmp output) and logs one line per
// rendition spawn, so a test can tell the rendition from the original by BYTES and
// count ffmpeg jobs exactly. Binds: an allowlisted size serves the rendition and
// caches it (the second request spawns nothing); concurrent requests share ONE
// spawn (single-flight); a non-allowlisted size serves the original with zero
// spawns; the RBAC 404 is unchanged (and spawns nothing); ffmpeg missing from PATH
// or failing falls back to the original; a newer source regenerates; the
// library-audio thumbnail branch is sized too; the Cache-Control axis is unchanged.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ffmpeg-art-'));
const spawnLog = path.join(binDir, 'spawns.log');
const failFlag = path.join(binDir, 'fail');
fs.writeFileSync(path.join(binDir, 'ffmpeg'), `#!/bin/bash
if [[ "$1" == "-version" ]]; then echo "ffmpeg version 0.0-filetube-test-stub"; exit 0; fi
echo "spawn $*" >> "${spawnLog}"
if [[ -f "${failFlag}" ]]; then echo "stub failure" >&2; exit 1; fi
sleep 0.3
last="\${@: -1}"
printf 'RENDITION-BYTES' > "$last"
exit 0
`, { mode: 0o755 });
const ORIGINAL_PATH = process.env.PATH;
process.env.PATH = `${binDir}${path.delimiter}${ORIGINAL_PATH}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-albumart-rendition-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, ALBUMART_DIR, userStore, musicDb, __mintTestSession } = require('../../server');
const musicStore = require('../../lib/music/store');
const { authenticateFetch } = require('../helpers/auth');

const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
const SIZED_DIR = path.join(ALBUMART_DIR, 'sized');
const ORIGINAL = Buffer.from('ORIGINAL-COVER-BYTES');

let server, base, auth, member, libRoot, blockedRoot;
let tWall, tHidden, tNoArt;

function spawns() {
  try { return fs.readFileSync(spawnLog, 'utf8').split('\n').filter(Boolean).length; } catch (_) { return 0; }
}
async function getBody(p, cookie) {
  const res = await fetch(`${base}${p}`, cookie ? { headers: { Cookie: cookie } } : undefined);
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, text: buf.toString('utf8') };
}
async function waitForFfmpegProbe() {
  // server.js flips ffmpegAvailable from an async `exec('ffmpeg -version')` at boot.
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const { text } = await getBody(`/albumart/${tWall.id}?s=512`);
    if (text === 'RENDITION-BYTES') return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the stub ffmpeg was never detected');
}

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-albumart-lib-'));
  blockedRoot = path.join(libRoot, 'Blocked');
  const mk = (rel, meta) => {
    const full = path.join(libRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'AUDIOBYTES');
    const id = require('crypto').createHash('md5').update(full).digest('hex');
    const albumArtKey = require('crypto').createHash('md5').update(musicStore.albumKeyFor(meta)).digest('hex');
    return Object.assign({ id, filePath: full, rootFolder: libRoot, ext: '.flac', addedAt: '2026-01-01T00:00:00.000Z', albumArtKey, durationSec: 200 }, meta);
  };
  tWall = mk('Floyd/Wall/01 Mother.flac', { artist: 'Pink Floyd', albumArtist: 'Pink Floyd', album: 'The Wall', title: 'Mother', trackNo: 1 });
  tHidden = mk('Blocked/Secret/01 Hush.flac', { artist: 'Nobody', albumArtist: 'Nobody', album: 'Secret', title: 'Hush', trackNo: 1 });
  tNoArt = mk('Floyd/Animals/01 Pigs.flac', { artist: 'Pink Floyd', albumArtist: 'Pink Floyd', album: 'Animals', title: 'Pigs', trackNo: 1 });
  await updateDatabase(() => musicDb.mutate((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks = {}; ns.folders = [libRoot];
    for (const t of [tWall, tHidden, tNoArt]) ns.tracks[t.id] = t;
    return true;
  }));
  fs.mkdirSync(ALBUMART_DIR, { recursive: true });
  fs.writeFileSync(path.join(ALBUMART_DIR, `${tWall.albumArtKey}.jpg`), ORIGINAL);
  fs.writeFileSync(path.join(ALBUMART_DIR, `${tHidden.albumArtKey}.jpg`), ORIGINAL);
  member = __mintTestSession({ username: 'artkid', role: 'member' });
  userStore.setRestrictions(member.user.id, [{ kind: 'path', value: blockedRoot }]);
  await waitForFfmpegProbe();
});

after(async () => {
  process.env.PATH = ORIGINAL_PATH;
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(libRoot, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
});

test('L1: an allowlisted size serves the rendition, caches it, and the second request spawns NOTHING', async () => {
  const before0 = spawns();
  const first = await getBody(`/albumart/${tWall.id}?s=256`);
  assert.equal(first.res.status, 200);
  assert.equal(first.text, 'RENDITION-BYTES', 'the sized rendition, not the original, is served');
  assert.equal(first.res.headers.get('cache-control'), 'private, max-age=86400', 'the SAME private cache axis as the original');
  assert.match(first.res.headers.get('content-type'), /jpeg/);
  assert.equal(spawns() - before0, 1, 'exactly one ffmpeg job for the first request');
  assert.ok(fs.existsSync(path.join(SIZED_DIR, `${tWall.albumArtKey}-256.jpg`)), 'cached as <key>-<size>.jpg under the sized dir');
  assert.deepEqual(fs.readdirSync(SIZED_DIR).filter((f) => f.includes('.tmp')), [], 'no tmp file left behind (tmp + rename)');
  const second = await getBody(`/albumart/${tWall.id}?s=256`);
  assert.equal(second.text, 'RENDITION-BYTES');
  assert.equal(spawns() - before0, 1, 'the cache hit spawns no second ffmpeg');
  // The original is untouched and still served without the size param.
  const plain = await getBody(`/albumart/${tWall.id}`);
  assert.equal(plain.text, ORIGINAL.toString(), 'no ?s -> the stored original, byte-identical');
});

test('L1: concurrent requests for one key + size share ONE ffmpeg (single-flight)', async () => {
  const before0 = spawns();
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => getBody(`/albumart/${tWall.id}?s=128`)));
  for (const r of [a, b, c]) assert.equal(r.text, 'RENDITION-BYTES');
  assert.equal(spawns() - before0, 1, 'three in-flight requests, one spawn');
});

test('L1: a size outside the allowlist serves the original and spawns nothing', async () => {
  const before0 = spawns();
  for (const q of ['300', '256abc', '0256', '-1', '', '1e3']) {
    const r = await getBody(`/albumart/${tWall.id}?s=${encodeURIComponent(q)}`);
    assert.equal(r.res.status, 200, `s=${q}`);
    assert.equal(r.text, ORIGINAL.toString(), `s=${q} -> the original`);
  }
  const arr = await getBody(`/albumart/${tWall.id}?s=128&s=256`);
  assert.equal(arr.text, ORIGINAL.toString(), 'a repeated param (an array) is not a size');
  assert.equal(spawns() - before0, 0, 'no ffmpeg for a non-rendition request');
});

test('L1: RBAC - a hidden track 404s with or without ?s, and spawns nothing', async () => {
  const before0 = spawns();
  const sized = await getBody(`/albumart/${tHidden.id}?s=256`, member.cookie);
  assert.equal(sized.res.status, 404, 'restricted track -> 404 at the sized route');
  const plain = await getBody(`/albumart/${tHidden.id}`, member.cookie);
  assert.equal(plain.res.status, 404, 'and at the plain route (unchanged)');
  assert.equal(spawns() - before0, 0, 'a refused request never starts ffmpeg');
  // Positive control: the same member sees a visible track's rendition.
  const ok = await getBody(`/albumart/${tWall.id}?s=256`, member.cookie);
  assert.equal(ok.text, 'RENDITION-BYTES');
});

test('L1: a track with no art file keeps the SVG placeholder under ?s (nothing to scale)', async () => {
  const before0 = spawns();
  const r = await getBody(`/albumart/${tNoArt.id}?s=128`);
  assert.equal(r.res.status, 200);
  assert.match(r.res.headers.get('content-type'), /svg/);
  assert.equal(r.res.headers.get('cache-control'), 'private, max-age=3600');
  assert.equal(spawns() - before0, 0);
});

test('L1: ffmpeg missing from PATH falls back to the original; a failing ffmpeg too, and is not re-spawned', async () => {
  // Missing: the spawn itself fails (ENOENT) - the original is served.
  process.env.PATH = ORIGINAL_PATH.split(path.delimiter).filter((d) => !fs.existsSync(path.join(d, 'ffmpeg'))).join(path.delimiter);
  try {
    const before0 = spawns();
    // s=512 was generated during before() (the ffmpeg-probe wait): a cached rendition needs no ffmpeg.
    const r = await getBody(`/albumart/${tWall.id}?s=512`);
    assert.equal(r.text, 'RENDITION-BYTES', 'an already-cached rendition needs no ffmpeg');
    // A fresh key (Animals now gets an art file) with no ffmpeg reachable:
    fs.writeFileSync(path.join(ALBUMART_DIR, `${tNoArt.albumArtKey}.jpg`), ORIGINAL);
    const miss = await getBody(`/albumart/${tNoArt.id}?s=256`);
    assert.equal(miss.res.status, 200);
    assert.equal(miss.text, ORIGINAL.toString(), 'no ffmpeg on PATH -> the original file');
    assert.equal(spawns() - before0, 0, 'the stub never ran');
  } finally {
    process.env.PATH = `${binDir}${path.delimiter}${ORIGINAL_PATH}`;
  }
  // Failing: the stub exits 1 - the original is served, and the failure is remembered.
  fs.writeFileSync(failFlag, '1');
  try {
    const before1 = spawns();
    const fail1 = await getBody(`/albumart/${tNoArt.id}?s=128`);
    assert.equal(fail1.text, ORIGINAL.toString(), 'a failing ffmpeg -> the original file');
    assert.equal(spawns() - before1, 1);
    const fail2 = await getBody(`/albumart/${tNoArt.id}?s=128`);
    assert.equal(fail2.text, ORIGINAL.toString());
    assert.equal(spawns() - before1, 1, 'a remembered failure is not re-spawned per request');
    assert.ok(!fs.existsSync(path.join(SIZED_DIR, `${tNoArt.albumArtKey}-128.jpg`)), 'no rendition written on failure');
  } finally {
    fs.unlinkSync(failFlag);
  }
});

test('L1: a source NEWER than its rendition regenerates it (re-extracted art is never served stale)', async () => {
  await getBody(`/albumart/${tWall.id}?s=256`); // ensure cached
  const cached = path.join(SIZED_DIR, `${tWall.albumArtKey}-256.jpg`);
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(cached, old, old);
  const src = path.join(ALBUMART_DIR, `${tWall.albumArtKey}.jpg`);
  fs.utimesSync(src, new Date(), new Date());
  const before0 = spawns();
  const r = await getBody(`/albumart/${tWall.id}?s=256`);
  assert.equal(r.text, 'RENDITION-BYTES');
  assert.equal(spawns() - before0, 1, 'the stale rendition was regenerated');
});

test('L1: the library-audio thumbnail branch is sized too (cache key t-<media id>), RBAC unchanged', async () => {
  const mediaRoot = path.join(DATA_DIR, 'media');
  const item = {
    id: 'libaud1', type: 'audio', title: 'Lib audio', name: 'libaud1.mp3', filePath: path.join(mediaRoot, 'chan', 'libaud1.mp3'),
    rootFolder: mediaRoot, folderName: 'chan', duration: 100, hasThumbnail: true, ext: '.mp3', addedAt: 1788000000000,
  };
  await updateDatabase((db) => { db.metadata = Object.assign({}, db.metadata, { libaud1: item }); return true; });
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(path.join(THUMBNAIL_DIR, 'libaud1.jpg'), ORIGINAL);
  const before0 = spawns();
  const r = await getBody('/albumart/libaud1?s=128');
  assert.equal(r.res.status, 200);
  assert.equal(r.text, 'RENDITION-BYTES');
  assert.equal(r.res.headers.get('cache-control'), 'private, max-age=86400');
  assert.equal(spawns() - before0, 1);
  assert.ok(fs.existsSync(path.join(SIZED_DIR, 't-libaud1-128.jpg')));
  const chapter = await getBody('/albumart/libaud1::c2?s=128');
  assert.equal(chapter.text, 'RENDITION-BYTES', 'a chapter id resolves to the SAME base-file rendition');
  assert.equal(spawns() - before0, 1, 'and shares its cache (no second spawn)');
  // A library item the member may not see: the thumbnail branch never serves it (the
  // placeholder, exactly as without ?s) and never starts ffmpeg for it.
  const hidden = Object.assign({}, item, { id: 'libaud2', name: 'libaud2.mp3', filePath: path.join(blockedRoot, 'libaud2.mp3') });
  await updateDatabase((db) => { db.metadata = Object.assign({}, db.metadata, { libaud2: hidden }); return true; });
  fs.writeFileSync(path.join(THUMBNAIL_DIR, 'libaud2.jpg'), ORIGINAL);
  const before1 = spawns();
  const refused = await getBody('/albumart/libaud2?s=128', member.cookie);
  assert.match(refused.res.headers.get('content-type'), /svg/, 'a hidden library item -> the placeholder, never its thumbnail');
  assert.equal(spawns() - before1, 0, 'and no ffmpeg for it');
  const admin = await getBody('/albumart/libaud2?s=128');
  assert.equal(admin.text, 'RENDITION-BYTES', 'positive control: the admin gets the rendition');
});

test('L1 TOCTOU: a track removed WHILE its rendition is generating 404s (the gate re-runs after the await)', async () => {
  const full = path.join(libRoot, 'Race', '01 Run.flac');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'AUDIOBYTES');
  const race = { id: 'race0000race0000race0000race0000', filePath: full, rootFolder: libRoot, ext: '.flac', addedAt: '2026-01-01T00:00:00.000Z', albumArtKey: 'racekey0racekey0racekey0racekey0', durationSec: 10, title: 'Run', artist: 'R', album: 'Race' };
  await updateDatabase(() => musicDb.mutate((db) => { musicStore.ensureMusic(db).tracks[race.id] = race; return true; }));
  fs.writeFileSync(path.join(ALBUMART_DIR, `${race.albumArtKey}.jpg`), ORIGINAL);
  const before0 = spawns();
  const pending = getBody(`/albumart/${race.id}?s=256`);
  // Event order, not a guess: wait until the route is INSIDE the rendition await (the
  // stub has started - it sleeps 0.3s before writing), then remove the track.
  const started = Date.now();
  while (spawns() === before0 && Date.now() - started < 5000) await new Promise((r) => setTimeout(r, 10));
  assert.equal(spawns() - before0, 1, 'the request reached the rendition await');
  await updateDatabase(() => musicDb.mutate((db) => { delete musicStore.ensureMusic(db).tracks[race.id]; return true; }));
  const r = await pending;
  assert.equal(r.res.status, 404, 'the post-await re-check refuses a track that vanished mid-request');
});

test('L1 dedup: tracks sharing a cover carry ONE artId across list, albums, artists, detail and queue - never a hidden representative', async () => {
  const wallKey = tWall.albumArtKey;
  const meta = { artist: 'Pink Floyd', albumArtist: 'Pink Floyd', album: 'The Wall', albumArtKey: wallKey, ext: '.flac', addedAt: '2026-01-01T00:00:00.000Z', durationSec: 100 };
  const mkT = (id, dir, n) => {
    const full = path.join(dir, `${id}.flac`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, 'AUDIOBYTES');
    return Object.assign({ id, filePath: full, rootFolder: libRoot, title: `Song ${n}`, trackNo: n }, meta);
  };
  // The hidden track sorts FIRST (lowest id), so an unfiltered pick would choose it.
  const hid = mkT('aaaa0000aaaa0000aaaa0000aaaa0000', path.join(blockedRoot, 'Wall'), 1);
  const v1 = mkT('bbbb0000bbbb0000bbbb0000bbbb0000', path.join(libRoot, 'Floyd', 'Wall2'), 2);
  const v2 = mkT('cccc0000cccc0000cccc0000cccc0000', path.join(libRoot, 'Floyd', 'Wall2'), 3);
  await updateDatabase(() => musicDb.mutate((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks = {};
    for (const t of [hid, v1, v2]) ns.tracks[t.id] = t;
    return true;
  }));
  const asMember = (p, init) => fetch(`${base}${p}`, Object.assign({}, init, { headers: Object.assign({ Cookie: member.cookie }, (init && init.headers) || {}) }));

  const wall = (items) => items.filter((i) => i.album === 'The Wall'); // the seeded library-audio item projects too
  const memberList = { items: wall((await (await asMember('/api/music?limit=100')).json()).items) };
  assert.deepEqual(memberList.items.map((i) => i.id).sort(), [v1.id, v2.id], 'the member sees only the visible tracks');
  assert.deepEqual(memberList.items.map((i) => i.artId), [v1.id, v1.id], 'both visible tracks share ONE art id - the lowest VISIBLE id');
  const adminList = { items: wall((await (await fetch(`${base}/api/music?limit=100`)).json()).items) };
  assert.equal(adminList.items.length, 3);
  assert.ok(adminList.items.every((i) => i.artId === hid.id), 'the admin (who sees all three) gets the overall lowest id - the pick is per viewer');

  // A search filter narrows the rows, never the representative (same URL on every surface).
  const searched = await (await asMember('/api/music?search=Song%203')).json();
  assert.deepEqual(searched.items.map((i) => i.artId), [v1.id]);

  const albums = { items: wall((await (await asMember('/api/music/albums')).json()).items) };
  assert.equal(albums.items.length, 1);
  assert.equal(albums.items[0].artId, v1.id, 'the album card uses the SAME art id as its song rows');
  const artists = await (await asMember('/api/music/artists')).json();
  assert.deepEqual(artists.items.find((a) => a.artist === 'Pink Floyd').artIds, [v1.id], 'the artist mosaic too');

  const detail = await (await asMember(`/api/music/${v2.id}`)).json();
  assert.equal(detail.artId, v1.id, 'the track detail (a ?play= deep link) carries the same art id');
  const hiddenDetail = await asMember(`/api/music/${hid.id}`);
  assert.equal(hiddenDetail.status, 404);

  const added = await asMember('/api/queue/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaId: v2.id, kind: 'track' }) });
  assert.equal(added.status, 200);
  const queue = await (await asMember('/api/queue')).json();
  const entry = queue.entries.find((e) => e.mediaId === v2.id);
  assert.equal(entry.item.artUrl, `/albumart/${v1.id}?s=256`, 'the queue row keys on the visible representative, at the row size');

  // Every artId the member received resolves for the member (never the 404 a hidden pick would give).
  const art = await asMember(`/albumart/${v1.id}?s=128`);
  assert.equal(art.status, 200);
});
