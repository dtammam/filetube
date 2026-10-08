'use strict';

// [INTEGRATION] v1.376.0 W6 (c) (plan docs/exec-plans/completed/2026-10-08-v1376-notify-podcasts-polish.md, W6): every
// payload that hands the client a Music art id or art URL carries the VERSION of that picture (lib/music/artVersion.js),
// so a changed cover is a new URL and the browser can never keep painting the old one (measured: Mr. Jambo's row kept
// the old art from the browser cache, `private, max-age=86400`, under an unchanged URL).
//
// Over the REAL app: /api/music (song rows; a projected library track's artUrl too), /api/music/albums (artV),
// /api/music/artists (artVs), /api/music/:id, the queue (artUrl), /api/search (track results), /api/liked (track
// cards), the home feed resolver (thumbnailUrl). A rewritten thumbnail / album art moves the version everywhere; an
// untouched picture keeps its version. RBAC: a restricted member never receives an id (nor a version) for a hidden
// item, a member's versions for what they CAN see equal the admin's (nothing per-user leaks through them), and
// /albumart?v= still 404s a hidden item. The served bytes and Cache-Control do not depend on `v`.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-art-version-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const server0 = require('../../server');
const { app, updateDatabase, ALBUMART_DIR, userStore, musicDb, __mintTestSession, resolveHomeItem, loadDatabase, resolveHandoffTarget } = server0;
const musicStore = require('../../lib/music/store');
const artVersion = require('../../lib/music/artVersion');
const { authenticateFetch } = require('../helpers/auth');

const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
let server, base, auth, member, libRoot, blockedRoot, tWall, tHidden, lib1, libHidden;

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const setTime = (file, ms) => fs.utimesSync(file, ms / 1000, ms / 1000);
const statV = (file) => artVersion.versionOfStat(fs.statSync(file));
const asMember = (p) => fetch(`${base}${p}`, { headers: { Cookie: member.cookie } });
const json = async (p, cookie) => (await (cookie ? asMember(p) : fetch(`${base}${p}`))).json();

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-art-version-lib-'));
  blockedRoot = path.join(libRoot, 'Blocked');
  const mk = (rel, meta) => {
    const full = path.join(libRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'AUDIOBYTES');
    return Object.assign({ id: md5(full), filePath: full, rootFolder: libRoot, ext: '.flac', addedAt: '2026-01-01T00:00:00.000Z', albumArtKey: md5(musicStore.albumKeyFor(meta)), durationSec: 200 }, meta);
  };
  tWall = mk('Floyd/Wall/01 Mother.flac', { artist: 'Pink Floyd', albumArtist: 'Pink Floyd', album: 'The Wall', title: 'Mother', trackNo: 1 });
  tHidden = mk('Blocked/Secret/01 Hush.flac', { artist: 'Nobody', albumArtist: 'Nobody', album: 'Secret', title: 'Hush', trackNo: 1 });
  await updateDatabase(() => musicDb.mutate((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks = {}; ns.folders = [libRoot];
    for (const t of [tWall, tHidden]) ns.tracks[t.id] = t;
    return true;
  }));
  fs.mkdirSync(ALBUMART_DIR, { recursive: true });
  // every fixture picture gets its OWN mtime: a version is mtime + size, and two files written in one millisecond with
  // the same size share a version string, which made the RBAC test below fail by chance (PR #115, ci (24))
  const put = (file, bytes, ms) => { fs.writeFileSync(file, bytes); setTime(file, ms); };
  put(path.join(ALBUMART_DIR, `${tWall.albumArtKey}.jpg`), 'WALL-COVER', 1_789_999_000_000);
  put(path.join(ALBUMART_DIR, `${tHidden.albumArtKey}.jpg`), 'SECRET-COVER', 1_789_999_001_000);
  // two yt-dlp library audio items (projected into Music; art = their thumbnail), one under the blocked root
  const mediaRoot = path.join(libRoot, 'yt');
  const item = (id, dir, title) => ({ id, type: 'audio', title, name: `${id}.mp3`, filePath: path.join(dir, `${id}.mp3`), rootFolder: libRoot, folderName: 'Kyle Gordon',
    duration: 100, hasThumbnail: true, ext: '.mp3', addedAt: 1788000000000, tags: { album: 'Wonderful', albumartist: 'Kyle Gordon', artist: 'Kyle Gordon', title } });
  lib1 = item('libjambo1', path.join(mediaRoot, 'Kyle Gordon'), 'Mr. Jambo');
  libHidden = item('libhidden', path.join(blockedRoot, 'yt'), 'Hidden Song');
  await updateDatabase((db) => { db.metadata = Object.assign({}, db.metadata, { [lib1.id]: lib1, [libHidden.id]: libHidden }); return true; });
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
  fs.writeFileSync(path.join(THUMBNAIL_DIR, `${lib1.id}.jpg`), 'OWN-ART');
  setTime(path.join(THUMBNAIL_DIR, `${lib1.id}.jpg`), 1_790_000_000_000);
  put(path.join(THUMBNAIL_DIR, `${libHidden.id}.jpg`), 'HIDDEN-ART', 1_789_999_002_000);
  member = __mintTestSession({ username: 'artv', role: 'member' });
  userStore.setRestrictions(member.user.id, [{ kind: 'path', value: blockedRoot }]);
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(libRoot, { recursive: true, force: true });
});

const byId = (items, id) => items.find((i) => i.id === id);

test('/api/music: each song row carries its picture\'s version (native: the album art file; projected: the thumbnail, on its artUrl too)', async () => {
  const items = (await json('/api/music?limit=100')).items;
  const wall = byId(items, tWall.id);
  const jambo = byId(items, lib1.id);
  assert.strictEqual(wall.artV, statV(path.join(ALBUMART_DIR, `${tWall.albumArtKey}.jpg`)));
  assert.strictEqual(jambo.artV, statV(path.join(THUMBNAIL_DIR, `${lib1.id}.jpg`)));
  assert.strictEqual(jambo.artUrl, `/thumbnail/${lib1.id}?v=${encodeURIComponent(jambo.artV)}`, 'the Now Playing / pop-out art URL is versioned too');
  const one = await json(`/api/music/${lib1.id}`);
  assert.strictEqual(one.artV, jambo.artV, '/api/music/:id (a ?play= deep link) carries the same version');
});

test('a changed cover is a NEW version on every surface that hands out its art id; an untouched one keeps its version', async () => {
  const thumb = path.join(THUMBNAIL_DIR, `${lib1.id}.jpg`);
  const list0 = (await json('/api/music?limit=100')).items;
  // (the album and artist cards as the MEMBER sees them: one visible song, so the card's art id is Mr. Jambo's)
  const albums0 = (await json('/api/music/albums', true)).items;
  const artists0 = (await json('/api/music/artists', true)).items;
  const v0 = byId(list0, lib1.id).artV;
  const wallV0 = byId(list0, tWall.id).artV;
  const kgAlbum0 = albums0.find((a) => a.album === 'Wonderful');
  const kgArtist0 = artists0.find((a) => a.artist === 'Kyle Gordon');
  assert.strictEqual(kgAlbum0.artId, lib1.id);
  assert.strictEqual(kgAlbum0.artV, v0, 'the album card carries the version of ITS art id');
  assert.deepStrictEqual(kgArtist0.artIds, [lib1.id]);
  assert.deepStrictEqual(kgArtist0.artVs, [v0], 'the artist mosaic: one version per artId, in order');
  // the scan re-extracts the thumbnail after the album cover was embedded
  fs.writeFileSync(thumb, 'ALBUM-COVER-BYTES'); setTime(thumb, 1_790_000_100_000);
  const list1 = (await json('/api/music?limit=100')).items;
  const v1 = byId(list1, lib1.id).artV;
  assert.ok(v1 && v1 !== v0, 'the song row\'s version moved');
  assert.strictEqual(byId(list1, tWall.id).artV, wallV0, 'an untouched cover keeps its version (its cache stays good)');
  assert.strictEqual((await json('/api/music/albums', true)).items.find((a) => a.album === 'Wonderful').artV, v1);
  assert.deepStrictEqual((await json('/api/music/artists', true)).items.find((a) => a.artist === 'Kyle Gordon').artVs, [v1]);
  // the admin's mosaic: every tile's version is the version of THAT tile's picture
  const adminArtist = (await json('/api/music/artists')).items.find((a) => a.artist === 'Kyle Gordon');
  assert.deepStrictEqual(adminArtist.artVs, adminArtist.artIds.map((id) => statV(path.join(THUMBNAIL_DIR, `${id}.jpg`))));
});

test('the queue, search, Liked and the home feed hand out versioned art too', async () => {
  const wallV = statV(path.join(ALBUMART_DIR, `${tWall.albumArtKey}.jpg`));
  // queue: a native track entry's artUrl
  const add = await fetch(`${base}/api/queue/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaId: tWall.id, kind: 'track' }) });
  assert.strictEqual(add.status, 200, await add.clone().text());
  const q = await json('/api/queue');
  const entry = q.entries.find((e) => e.mediaId === tWall.id);
  assert.strictEqual(entry.item.artUrl, `/albumart/${tWall.id}?s=256&v=${encodeURIComponent(wallV)}`);
  // search: a track result
  const found = (await json('/api/search?q=Mother')).items.find((r) => r.kind === 'track' && r.id === tWall.id);
  assert.strictEqual(found.artV, wallV);
  const foundLib = (await json('/api/search?q=Jambo')).items.find((r) => r.kind === 'track' && r.id === lib1.id);
  assert.ok(foundLib && foundLib.artV, 'a projected track result too');
  assert.strictEqual(foundLib.artUrl, `/thumbnail/${lib1.id}?v=${encodeURIComponent(foundLib.artV)}`);
  // Liked: a liked native track's card
  assert.strictEqual((await fetch(`${base}/api/music/liked/${tWall.id}`, { method: 'POST' })).status, 200);
  const liked = (await json('/api/liked?limit=100')).items.find((i) => i.kind === 'track' && i.id === tWall.id);
  assert.strictEqual(liked.artV, wallV);
  // the home feed / Continue row resolver
  const home = resolveHomeItem(loadDatabase(), tWall.id, 'track', 0);
  assert.strictEqual(home.thumbnailUrl, `/albumart/${tWall.id}?v=${encodeURIComponent(wallV)}`);
});

test('RBAC: a member never receives a hidden item\'s id or version; their versions equal the admin\'s; /albumart?v= still refuses a hidden item', async () => {
  const mine = (await json('/api/music?limit=100', true)).items;
  assert.strictEqual(byId(mine, tHidden.id), undefined);
  assert.strictEqual(byId(mine, libHidden.id), undefined);
  const hiddenVs = [statV(path.join(ALBUMART_DIR, `${tHidden.albumArtKey}.jpg`)), statV(path.join(THUMBNAIL_DIR, `${libHidden.id}.jpg`))];
  // anti-vacuity floor: the check below means something only if each hidden version is unique among the fixture's four
  const fixtureVs = [path.join(ALBUMART_DIR, `${tWall.albumArtKey}.jpg`), path.join(ALBUMART_DIR, `${tHidden.albumArtKey}.jpg`), path.join(THUMBNAIL_DIR, `${lib1.id}.jpg`), path.join(THUMBNAIL_DIR, `${libHidden.id}.jpg`)].map(statV);
  assert.strictEqual(new Set(fixtureVs).size, 4, `the four fixture pictures have pairwise distinct versions (${fixtureVs.join(', ')})`);
  const sent = JSON.stringify([mine, (await json('/api/music/albums', true)).items, (await json('/api/music/artists', true)).items]);
  for (const v of hiddenVs) assert.ok(!sent.includes(v), `a hidden picture's version (${v}) never reaches the member`);
  const admin = (await json('/api/music?limit=100')).items;
  for (const row of mine) assert.strictEqual(row.artV, byId(admin, row.id).artV, `the same version for ${row.title} (derived from the picture alone)`);
  const refused = await asMember(`/albumart/${tHidden.id}?v=${encodeURIComponent(hiddenVs[0])}`);
  assert.strictEqual(refused.status, 404, 'a version never opens a hidden item');
  const refusedLib = await asMember(`/albumart/${libHidden.id}?v=x`);
  assert.match(refusedLib.headers.get('content-type'), /svg/, 'a hidden library item -> the placeholder');
});

test('/albumart serves the same bytes and Cache-Control with or without v (the version only changes the URL)', async () => {
  const plain = await fetch(`${base}/albumart/${tWall.id}`);
  const versioned = await fetch(`${base}/albumart/${tWall.id}?v=anything`);
  assert.strictEqual(plain.status, 200);
  assert.strictEqual(versioned.status, 200);
  assert.strictEqual(Buffer.from(await versioned.arrayBuffer()).toString(), Buffer.from(await plain.arrayBuffer()).toString());
  assert.strictEqual(versioned.headers.get('cache-control'), 'private, max-age=86400');
  assert.strictEqual(plain.headers.get('cache-control'), 'private, max-age=86400');
});

test('/albumart with a hostile id (NUL-prefixed, prototype keys, empty chapter) answers the placeholder, never a 500 or another item\'s art', async () => {
  const nul = String.fromCharCode(0);
  for (const id of [nul + tWall.id, tWall.id + nul, '__proto__', 'constructor', '::c1', `${lib1.id}::c`]) {
    const r = await fetch(`${base}/albumart/${encodeURIComponent(id)}?v=x`);
    assert.strictEqual(r.status, 200, JSON.stringify(id));
    assert.match(r.headers.get('content-type'), /svg/, `${JSON.stringify(id)} -> the placeholder`);
  }
});

// Gate r1 (adversary suggestion): the Listen Control card's art (resolveHandoffTarget) carries the version too -
// reverting it to the bare /albumart URL passed every test before.
test('the Listen Control (handoff) target of a song carries its picture\'s version, and a changed cover moves it', async () => {
  const albumArt = path.join(ALBUMART_DIR, `${tWall.albumArtKey}.jpg`);
  const t0 = resolveHandoffTarget(loadDatabase(), { kind: 'track', mediaId: tWall.id, duration: 0 });
  assert.strictEqual(t0.thumbnailUrl, `/albumart/${tWall.id}?v=${encodeURIComponent(statV(albumArt))}`);
  fs.writeFileSync(albumArt, 'NEW-WALL-COVER'); setTime(albumArt, 1_790_000_200_000);
  const t1 = resolveHandoffTarget(loadDatabase(), { kind: 'track', mediaId: tWall.id, duration: 0 });
  assert.notStrictEqual(t1.thumbnailUrl, t0.thumbnailUrl, 'a new cover is a new URL');
  assert.strictEqual(t1.thumbnailUrl, `/albumart/${tWall.id}?v=${encodeURIComponent(statV(albumArt))}`);
});
