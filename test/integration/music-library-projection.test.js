'use strict';

// [INTEGRATION] Wave G - projecting library audio (db.metadata type 'audio') into
// the Music read APIs, behind the opt-in master toggle. Binds: OFF => zero
// projection (default); ON => eligible audio appears in /api/music /albums
// /artists with its own media routes; the genre default + per-folder override;
// dedup (a file in both roots appears once, native wins); and the MEDIA RBAC
// gate (a restricted member never sees a blocked projected track). Isolated
// DATA_DIR, own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-musicproj-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, updateDatabase, userStore, __mintTestSession } = require('../../server');
const musicStore = require('../../lib/music/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, actingUser, member;

// A media root that will hold the projected audio; a "blocked" subtree the
// member is restricted from.
const ROOT = path.join(DATA_DIR, 'ytdlp');
const blockedRoot = path.join(ROOT, 'blockedchan');

// Mirrors the real data: the embedded artist tag is a clean channel name,
// distinct from the on-disk folder SLUG (e.g. artist 'NESTALGIA' in folder
// 'nestalgiamusic').
function audioItem(id, folderName, genre, artistName, extra) {
  const filePath = path.join(ROOT, folderName, `${id}.mp3`);
  return Object.assign({
    id, type: 'audio', title: `${id} title`, name: `${id}.mp3`,
    filePath, rootFolder: ROOT, folderName, channelName: artistName,
    duration: 123.5, hasThumbnail: true, ext: '.mp3',
    addedAt: 1788000000000, tags: { title: `${id} title`, artist: artistName, date: '2026', genre },
  }, extra || {});
}

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  actingUser = auth.user;
  saveDatabase({ folders: [ROOT], folderSettings: {}, progress: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => {
    // Library audio: NESTALGIA (genre Gaming - needs a mark), Tonzak (genre
    // Music - default on), Zarchivo (genre Comedy - default off), a blocked-
    // subtree Music item for the RBAC test, and a dedup collision.
    db.metadata = {
      nest1: audioItem('nest1', 'nestalgiamusic', 'Gaming', 'NESTALGIA'),
      tonzak1: audioItem('tonzak1', 'Tonzak', 'Music', 'Tonzak'),
      zarch1: audioItem('zarch1', 'zarchivo', 'Comedy', 'Zarchivo'),
      blk1: Object.assign(audioItem('blk1', 'blockedchan', 'Music', 'Blocked'), { filePath: path.join(blockedRoot, 'blk1.mp3') }),
      dup1: audioItem('dup1', 'Tonzak', 'Music', 'Tonzak'), // same id as a native track below
    };
    const ns = musicStore.ensureMusic(db);
    ns.folders = [ROOT];
    ns.tracks = {
      // A native music track whose id collides with a projected audio id (dup1).
      dup1: { id: 'dup1', title: 'NATIVE dup', artist: 'Real Artist', albumArtist: 'Real Artist', album: 'Real Album', filePath: path.join(ROOT, 'native/dup1.flac'), rootFolder: ROOT, folderName: 'native', ext: '.flac', codec: 'flac', durationSec: 300, albumArtKey: null, addedAt: '2026-01-01T00:00:00.000Z' },
    };
    db.music.channels = { nestalgiamusic: 'on' }; // Dean flips the Gaming music channel on
    return true;
  });
  member = __mintTestSession({ username: 'kidproj', role: 'member' });
  userStore.setRestrictions(member.user.id, [{ kind: 'path', value: blockedRoot }]);

  // Seed real thumbnail sidecars (THUMBNAIL_DIR is created at server boot) so
  // the /albumart fallback has bytes to serve for a projected track.
  const thumbDir = path.join(DATA_DIR, '.thumbnails');
  fs.writeFileSync(path.join(thumbDir, 'nest1.jpg'), 'JPEGBYTES-NEST');
  fs.writeFileSync(path.join(thumbDir, 'blk1.jpg'), 'JPEGBYTES-BLK');
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const get = (p, cookie) => fetch(`${base}${p}`, cookie ? { headers: { Cookie: cookie } } : undefined);
// null => clear the mirror (absent === off); 'on'/'off' => set it.
const setToggle = (userId, val) => userStore.setSettingsJson(userId, val === null ? {} : { musicIncludesLibrary: val });

test('master toggle OFF (default): Music shows ONLY native tracks - zero projection', async () => {
  setToggle(actingUser.id, null); // absent => off
  const music = await (await get('/api/music')).json();
  const ids = music.items.map((i) => i.id).sort();
  assert.deepStrictEqual(ids, ['dup1'], 'only the native track; no projected audio');
  const artists = await (await get('/api/music/artists')).json();
  assert.deepStrictEqual(artists.items.map((a) => a.artist).sort(), ['Real Artist'], 'no projected artists when off');
});

test('master toggle ON: eligible library audio appears with its own media routes', async () => {
  setToggle(actingUser.id, 'on');
  const music = await (await get('/api/music')).json();
  const byId = new Map(music.items.map((i) => [i.id, i]));
  assert.ok(byId.has('nest1'), 'NESTALGIA (marked on) is projected in');
  assert.ok(byId.has('tonzak1'), 'Tonzak (genre Music) is projected in by default');
  assert.ok(!byId.has('zarch1'), 'Zarchivo (genre Comedy, no mark) stays OUT');

  const nest = byId.get('nest1');
  assert.strictEqual(nest.source, 'library', 'the client branches on this');
  assert.strictEqual(nest.streamSrc, '/video/nest1', 'streams the mp3 from the media byte route');
  assert.strictEqual(nest.artUrl, '/thumbnail/nest1');
  assert.strictEqual(nest.progressEndpoint, '/api/progress');
  assert.strictEqual(nest.artist, 'NESTALGIA');
  assert.strictEqual(nest.album, '', 'untitled album (no album tag)');
  assert.ok(!('filePath' in nest), 'path scrub still holds for projected items');
});

test('ON: the artist grid gains the projected channels as artists', async () => {
  setToggle(actingUser.id, 'on');
  const artists = await (await get('/api/music/artists')).json();
  const names = artists.items.map((a) => a.artist);
  assert.ok(names.includes('NESTALGIA'), 'NESTALGIA is an artist');
  assert.ok(names.includes('Tonzak'), 'Tonzak channel is an artist');
  assert.ok(names.includes('Real Artist'), 'the native track artist is still there');
  assert.ok(!names.includes('Zarchivo'), 'Comedy channel is not an artist');
});

test('dedup: a projected id colliding with a native track appears ONCE (native wins)', async () => {
  setToggle(actingUser.id, 'on');
  const music = await (await get('/api/music')).json();
  const dups = music.items.filter((i) => i.id === 'dup1');
  assert.strictEqual(dups.length, 1, 'dup1 appears exactly once');
  assert.strictEqual(dups[0].title, 'NATIVE dup', 'the native music track wins the collision, not the projection');
  assert.notStrictEqual(dups[0].source, 'library', 'the surviving row is the native track');
});

test('grid art: /albumart/:id falls back to the media thumbnail for a projected track', async () => {
  // A projected album/artist tile requests /albumart/<mediaId>; there is no
  // album-art file, so it must serve the media thumbnail (real imagery).
  const res = await get('/albumart/nest1');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /image\/jpeg/, 'serves the jpg thumbnail, not the SVG placeholder');
  assert.strictEqual(await res.text(), 'JPEGBYTES-NEST');
});

test('grid art RBAC: a restricted member gets the placeholder, never the blocked thumbnail', async () => {
  const res = await get('/albumart/blk1', member.cookie);
  assert.match(res.headers.get('content-type') || '', /image\/svg\+xml/, 'restricted -> placeholder SVG, no thumbnail leak');
  assert.notStrictEqual(await res.text(), 'JPEGBYTES-BLK', 'the blocked thumbnail bytes never reach the member');
});

test('MEDIA RBAC: a restricted member never sees a blocked projected track', async () => {
  setToggle(member.user.id, 'on');
  // blk1 is genre Music (default-on) but lives under the member-restricted path.
  const music = await (await get('/api/music', member.cookie)).json();
  assert.ok(!music.items.some((i) => i.id === 'blk1'), 'the restricted subtree audio is gated OUT for the member');
  assert.ok(music.items.some((i) => i.id === 'tonzak1'), 'an unrestricted projected track is still visible');
});

// ---- T5: the per-folder mark read/write routes ----

const postJson = (p, body, cookie) => fetch(`${base}${p}`, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: JSON.stringify(body),
});

test('GET /api/folders/music-flag reflects the override, the genre default, and hasAudio', async () => {
  const nest = await (await get('/api/folders/music-flag?folderName=nestalgiamusic')).json();
  assert.deepStrictEqual({ hasAudio: nest.hasAudio, override: nest.override, effective: nest.effective },
    { hasAudio: true, override: 'on', effective: true }, 'NESTALGIA: marked on');
  const tonzak = await (await get('/api/folders/music-flag?folderName=Tonzak')).json();
  assert.deepStrictEqual({ override: tonzak.override, effective: tonzak.effective },
    { override: null, effective: true }, 'Tonzak: unset, genre Music -> effective on');
  const zarch = await (await get('/api/folders/music-flag?folderName=zarchivo')).json();
  assert.deepStrictEqual({ override: zarch.override, effective: zarch.effective },
    { override: null, effective: false }, 'Zarchivo: unset, genre Comedy -> effective off');
  const none = await (await get('/api/folders/music-flag?folderName=native')).json();
  assert.strictEqual(none.hasAudio, false, 'a folder with no library audio -> hasAudio:false (toggle not shown)');
});

test('POST /api/folders/music-flag toggles a channel (admin); a plain member is 403; then restores', async () => {
  setToggle(actingUser.id, 'on');
  // Member without can_modify_library cannot write the shared mark.
  assert.strictEqual((await postJson('/api/folders/music-flag', { folderName: 'Tonzak', music: 'off' }, member.cookie)).status, 403);
  // Admin turns Tonzak OFF -> it leaves Music; GET reflects the override.
  assert.strictEqual((await postJson('/api/folders/music-flag', { folderName: 'Tonzak', music: 'off' })).status, 200);
  const afterOff = await (await get('/api/folders/music-flag?folderName=Tonzak')).json();
  assert.strictEqual(afterOff.override, 'off');
  assert.ok(!(await (await get('/api/music')).json()).items.some((i) => i.id === 'tonzak1'), 'Tonzak audio left Music when marked off');
  // Bad value is rejected; a nonexistent folder is a neutral 404.
  assert.strictEqual((await postJson('/api/folders/music-flag', { folderName: 'Tonzak', music: 'maybe' })).status, 400);
  assert.strictEqual((await postJson('/api/folders/music-flag', { folderName: 'nope', music: 'on' })).status, 404);
  // Clear -> back to the genre default (restore state for any later run).
  assert.strictEqual((await postJson('/api/folders/music-flag', { folderName: 'Tonzak', music: null })).status, 200);
  assert.strictEqual((await (await get('/api/folders/music-flag?folderName=Tonzak')).json()).override, null, 'cleared back to default');
});
