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
      nest1: audioItem('nest1', 'nestalgiamusic', 'Gaming', 'NESTALGIA', { channelAvatarUrl: 'https://yt3.googleusercontent.com/nestalgia-avatar.jpg' }),
      // v1.221: a chaptered "full album" mix in the (marked-on) NESTALGIA channel.
      djmix1: audioItem('djmix1', 'nestalgiamusic', 'Music', 'NESTALGIA', { duration: 1800, chapters: [{ startTime: 0, title: 'Intro' }, { startTime: 300, title: 'Track A' }, { startTime: 900, title: 'Track B' }] }),
      tonzak1: audioItem('tonzak1', 'Tonzak', 'Music', 'Tonzak'),
      zarch1: audioItem('zarch1', 'zarchivo', 'Comedy', 'Zarchivo'),
      blk1: Object.assign(audioItem('blk1', 'blockedchan', 'Music', 'Blocked'), { filePath: path.join(blockedRoot, 'blk1.mp3') }),
      dup1: audioItem('dup1', 'Tonzak', 'Music', 'Tonzak'), // same id as a native track below
      // A MIXED channel (the real NESTALGIA scenario): 1 Music + 2 Gaming in ONE
      // folder -> minority music -> NOT auto; unmarked shows NOTHING (not the 1
      // Music track); a mark brings ALL 3. v1.211 all-or-nothing.
      mx1: audioItem('mx1', 'mixedchan', 'Music', 'MixedChan'),
      mx2: audioItem('mx2', 'mixedchan', 'Gaming', 'MixedChan'),
      mx3: audioItem('mx3', 'mixedchan', 'Gaming', 'MixedChan'),
      // A PARTIALLY-visible channel: 2 items visible to everyone + 1 under the
      // member-restricted blocked subtree. The channels list's audioCount must be
      // the VISIBLE count per user (2 for the member, 3 for admin) - never an
      // oracle for the restricted item.
      pc1: audioItem('pc1', 'partialchan', 'Gaming', 'PartialChan'),
      pc2: audioItem('pc2', 'partialchan', 'Gaming', 'PartialChan'),
      pc3: Object.assign(audioItem('pc3', 'partialchan', 'Gaming', 'PartialChan'), { filePath: path.join(blockedRoot, 'pc3.mp3') }),
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
  fs.writeFileSync(path.join(thumbDir, 'djmix1.jpg'), 'JPEGBYTES-DJMIX'); // v1.222: the chaptered file's thumbnail
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

test('v1.242 UNCONDITIONAL projection: with NO setting, EVERY audio item projects into Music (Dean: "anything audio-only")', async () => {
  setToggle(actingUser.id, null); // no opt-in setting at all - the old default-OFF gate is retired
  const music = await (await get('/api/music')).json();
  const ids = music.items.map((i) => i.id);
  assert.ok(ids.includes('dup1'), 'the native track');
  assert.ok(ids.includes('nest1'), 'NESTALGIA audio projects - no opt-in needed');
  assert.ok(ids.includes('tonzak1'), 'Tonzak (genre Music) projects');
  assert.ok(ids.includes('zarch1'), 'Zarchivo (genre Comedy) ALSO projects now - genre no longer gates');
  const artists = await (await get('/api/music/artists')).json();
  const names = artists.items.map((a) => a.artist);
  assert.ok(names.includes('Real Artist'), 'native artist present');
  assert.ok(names.includes('NESTALGIA'), 'projected channels are artists without any toggle');
});

test('v1.242: every projected library audio item carries its own media routes', async () => {
  const music = await (await get('/api/music')).json();
  const byId = new Map(music.items.map((i) => [i.id, i]));
  assert.ok(byId.has('nest1') && byId.has('tonzak1') && byId.has('zarch1'), 'all audio present unconditionally');
  const nest = byId.get('nest1');
  assert.strictEqual(nest.source, 'library', 'the client branches on this');
  assert.strictEqual(nest.streamSrc, '/video/nest1', 'streams the mp3 from the media byte route');
  assert.strictEqual(nest.artUrl, '/thumbnail/nest1');
  assert.strictEqual(nest.progressEndpoint, '/api/progress');
  assert.strictEqual(nest.artist, 'NESTALGIA');
  assert.strictEqual(nest.album, '', 'untitled album (no album tag)');
  assert.ok(!('filePath' in nest), 'path scrub still holds for projected items');
});

test('v1.242: the artist grid gains EVERY audio channel as an artist (genre no longer gates)', async () => {
  const artists = await (await get('/api/music/artists')).json();
  const names = artists.items.map((a) => a.artist);
  assert.ok(names.includes('NESTALGIA'), 'NESTALGIA is an artist');
  assert.ok(names.includes('Tonzak'), 'Tonzak channel is an artist');
  assert.ok(names.includes('Real Artist'), 'the native track artist is still there');
  assert.ok(names.includes('Zarchivo'), 'the Comedy channel is now an artist too - all audio projects');
});

test('redesign S1: the artist grid carries the CHANNEL avatar for circles ("" for a native artist)', async () => {
  setToggle(actingUser.id, 'on');
  const artists = (await (await get('/api/music/artists')).json()).items;
  const nest = artists.find((a) => a.artist === 'NESTALGIA');
  assert.strictEqual(nest.avatarUrl, 'https://yt3.googleusercontent.com/nestalgia-avatar.jpg', 'NESTALGIA carries its channel avatar for the round tile');
  const native = artists.find((a) => a.artist === 'Real Artist');
  assert.strictEqual(native.avatarUrl, '', 'a native-only artist has no channel avatar -> "" (client falls back to the mosaic)');
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

// v1.222 slice 1: a VIRTUAL chapter-track (id `<mediaId>::c<idx>`) has no file of
// its own; /albumart strips the suffix so its tile/card/recent-tile shows the ONE
// shared file's thumbnail instead of the grey placeholder.
test('v1.222 slice 1: /albumart/<chapterId> resolves to the shared file thumbnail (was the grey placeholder)', async () => {
  const res = await get('/albumart/' + encodeURIComponent('djmix1::c1'));
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /image\/jpeg/, 'serves the file jpg, not the SVG placeholder');
  assert.strictEqual(await res.text(), 'JPEGBYTES-DJMIX', 'the chapter tile shows the shared file picture');
});

test('v1.222 slice 1 RBAC: a chapter-shaped id of a BLOCKED file still 404s to the placeholder (no strip-around-RBAC)', async () => {
  const res = await get('/albumart/' + encodeURIComponent('blk1::c2'), member.cookie);
  assert.match(res.headers.get('content-type') || '', /image\/svg\+xml/, 'the base item is re-gated after the strip - no blocked thumbnail leak');
  assert.notStrictEqual(await res.text(), 'JPEGBYTES-BLK', 'the blocked bytes never reach the member via a chapter id');
});

test('MEDIA RBAC: a restricted member never sees a blocked projected track', async () => {
  setToggle(member.user.id, 'on');
  // blk1 is genre Music (default-on) but lives under the member-restricted path.
  const music = await (await get('/api/music', member.cookie)).json();
  assert.ok(!music.items.some((i) => i.id === 'blk1'), 'the restricted subtree audio is gated OUT for the member');
  assert.ok(music.items.some((i) => i.id === 'tonzak1'), 'an unrestricted projected track is still visible');
});

test('MEDIA gate KIND: a FOLDER and a video-LIBRARY restriction gate projected audio out (bind media vs track)', async () => {
  // The projection MUST use mediaVisibleTo (kind 'media'), NOT trackVisibleTo
  // (kind 'track'). A path restriction (the test above) is enforced identically
  // for BOTH kinds, so it does NOT distinguish them. folder-kind (visibility.js:
  // 68, media-only) and library:'video'-kind (via KIND_TO_LIBRARY: media->video,
  // track->music) ARE media-only - so these bind the gate KIND: under a
  // trackVisibleTo mutant the folder/video-library restriction would not apply and
  // the channel would LEAK into Music. (Adversarial gate WARNING 1.)
  const fm = __mintTestSession({ username: 'gatekind', role: 'member' });
  userStore.setSettingsJson(fm.user.id, { musicIncludesLibrary: 'on' });

  // (a) folder-kind restriction on the projected channel folder (nest1 is marked on).
  userStore.setRestrictions(fm.user.id, [{ kind: 'folder', value: 'nestalgiamusic' }]);
  let music = await (await get('/api/music', fm.cookie)).json();
  assert.ok(!music.items.some((i) => i.id === 'nest1'), 'a FOLDER-restricted channel is gated OUT of Music (proves the media gate, not track)');
  assert.ok(music.items.some((i) => i.id === 'tonzak1'), 'an unrestricted projected channel is still visible under a folder restriction');
  // (a2) the /albumart grid-art fallback uses the SAME media gate KIND: a
  // folder-restricted member gets the placeholder, never nest1's thumbnail bytes
  // (binds the fallback's gate kind - adversarial MUTANT J).
  const art = await get('/albumart/nest1', fm.cookie);
  assert.match(art.headers.get('content-type') || '', /image\/svg\+xml/, 'folder-restricted -> placeholder SVG, not the thumbnail');
  assert.notStrictEqual(await art.text(), 'JPEGBYTES-NEST', 'the folder-restricted thumbnail bytes never leak via /albumart');

  // (b) whole video-LIBRARY restriction: ALL projected audio (kind media -> video)
  // vanishes; native music tracks (kind track -> music) remain.
  userStore.setRestrictions(fm.user.id, [{ kind: 'library', value: 'video' }]);
  music = await (await get('/api/music', fm.cookie)).json();
  assert.ok(!music.items.some((i) => i.source === 'library'), 'a video-library restriction removes ALL projected audio from Music');
  assert.ok(music.items.some((i) => i.id === 'dup1'), 'native music tracks are unaffected (kind track -> music library)');
});

test('v1.215 (Dean device): a played LIBRARY track shows in recent-listening via its MEDIA-store position; a native track via the music store', async () => {
  setToggle(actingUser.id, 'on');
  // A projected library track saves progress to the MEDIA store (/api/progress);
  // a native track to the music store (/api/music/progress). recent-listening
  // must merge BOTH, or a downloaded artist you just played (Dean's NESTALGIA)
  // never appears. nest1's progressEndpoint is '/api/progress' (asserted above),
  // so this is the real wire path the music player uses for a library track.
  await postJson('/api/progress', { id: 'nest1', timestamp: 42, duration: 200 });
  await postJson('/api/music/progress', { id: 'dup1', position: 30, duration: 300 });
  const recent = await (await get('/api/music?filter=recent-listening')).json();
  const ids = recent.items.map((i) => i.id);
  assert.ok(ids.includes('nest1'), 'the PLAYED library track appears in recent-listening (media-store position merged in)');
  assert.ok(ids.includes('dup1'), 'the played native track still appears (music store, unbroken)');
  const nest = recent.items.find((i) => i.id === 'nest1');
  // Normalized to the music {position} shape (the media store keys it `timestamp`).
  assert.ok(nest.progress && nest.progress.position === 42, 'the library track carries its media-store resume position (42), normalized to {position}');
  // A library track the user has NOT played is absent (proves the filter still
  // gates on a real saved position, not "every projected track").
  assert.ok(!ids.includes('tonzak1'), 'an unplayed projected track is NOT in recent-listening');
});

test('v1.221 chapter-albums: a chaptered download projects as N chapter-tracks (one Album, seek offsets), via /api/music', async () => {
  setToggle(actingUser.id, 'on');
  const music = await (await get('/api/music')).json();
  const chapters = music.items.filter((i) => typeof i.id === 'string' && i.id.indexOf('djmix1::c') === 0);
  assert.strictEqual(chapters.length, 3, 'the 3-chapter mix expands into 3 virtual tracks');
  assert.deepStrictEqual(chapters.map((c) => c.title).sort(), ['Intro', 'Track A', 'Track B']);
  const intro = chapters.find((c) => c.title === 'Intro');
  assert.strictEqual(intro.source, 'library-chapter', 'carries the chapter marker');
  assert.strictEqual(intro.streamSrc, '/video/djmix1', 'every chapter streams the ONE file');
  assert.strictEqual(intro.chapterStartSec, 0, 'and its seek offset');
  assert.strictEqual(chapters.find((c) => c.title === 'Track B').chapterStartSec, 900, 'chapter B seeks to 900s');
  assert.ok(music.items.some((i) => i.id === 'nest1'), 'a non-chaptered download (nest1) stays a single track');
  // The chapters group into ONE album (they share the file title).
  const albums = (await (await get('/api/music/albums')).json()).items;
  assert.ok(albums.some((a) => a.trackCount === 3), 'the mix is one album with its 3 chapters as tracks');
});

test('v1.223: a projected library album carries a real (ISO) addedAt via /api/music/albums - so "newest" surfaces new downloads', async () => {
  setToggle(actingUser.id, 'on');
  const albums = (await (await get('/api/music/albums?sort=newest')).json()).items;
  // Every projected album (chaptered or single) must have a non-empty addedAt -
  // the numeric-media-epoch was dropped to '' before v1.223, sinking new downloads.
  const nest = albums.find((a) => a.artist === 'NESTALGIA');
  assert.ok(nest, 'a projected NESTALGIA album is present');
  assert.ok(typeof nest.addedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(nest.addedAt),
    'its addedAt is a real ISO timestamp (not the empty string that buried it in newest)');
  // The same normalized field drives artist "newest" too (gate SUGGESTION).
  const artists = (await (await get('/api/music/artists?sort=newest')).json()).items;
  const na = artists.find((a) => a.artist === 'NESTALGIA');
  assert.ok(na && typeof na.addedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(na.addedAt),
    'a projected artist carries a real ISO addedAt for "newest" artists too');
});

test('v1.221 search: each chapter TITLE surfaces as a playable music result via /api/search (chapters as song names)', async () => {
  setToggle(actingUser.id, 'on');
  const res = await (await get('/api/search?q=' + encodeURIComponent('Track A') + '&type=music')).json();
  const hit = res.items.find((i) => i.title === 'Track A');
  assert.ok(hit, 'the chapter title "Track A" is a findable music result');
  assert.strictEqual(hit.resultType, 'music');
  assert.strictEqual(hit.source, 'library-chapter', 'plays via the music player');
  assert.strictEqual(hit.id, 'djmix1::c1');
  assert.strictEqual(hit.chapterStartSec, 300, 'carries the seek offset so a search-tap plays that chapter');
  assert.strictEqual(hit.streamSrc, '/video/djmix1', 'streams the one file');
});

test('v1.242 search: chapter tracks appear in music search with NO setting (projection is unconditional)', async () => {
  setToggle(actingUser.id, null); // no opt-in setting
  const res = await (await get('/api/search?q=' + encodeURIComponent('Track A') + '&type=music')).json();
  assert.ok(res.items.some((i) => i.id === 'djmix1::c1'), 'the chapter surfaces in search without any toggle');
});

// GATE CRITICAL (both seats): a search-tap / deep-link resolves the tapped id via
// GET /api/music/:id BEFORE playing (the client re-resolves when the track is not
// in recent-listening - and a chapter, whose progress is never saved, is NEVER in
// recent-listening). The route only read the NATIVE store, so every chapter (and
// never-played library single) search-tap 404'd and played nothing. It must now
// resolve a projected id from the same opt-in projection - RBAC + toggle gated.
test('v1.221 GATE FIX: GET /api/music/:id resolves a projected CHAPTER id (the search-tap/deep-link play entry)', async () => {
  setToggle(actingUser.id, 'on');
  const res = await get('/api/music/' + encodeURIComponent('djmix1::c1'));
  assert.strictEqual(res.status, 200, 'the chapter id resolves (was 404 = a dead search-tap)');
  const t = await res.json();
  assert.strictEqual(t.id, 'djmix1::c1');
  assert.strictEqual(t.source, 'library-chapter');
  assert.strictEqual(t.chapterStartSec, 300, 'carries the seek so the tap plays THAT chapter');
  assert.strictEqual(t.streamSrc, '/video/djmix1', 'plays the shared file');
  assert.ok(t.albumKey, 'and an albumKey so the tap drills into its album');
});

test('v1.221 GATE FIX: GET /api/music/:id resolves a projected library SINGLE (never-played download) too', async () => {
  setToggle(actingUser.id, 'on');
  const res = await get('/api/music/nest1'); // a non-chaptered projected download
  assert.strictEqual(res.status, 200, 'a downloaded single resolves for the search-tap');
  assert.strictEqual((await res.json()).source, 'library', 'the library marker rides so it streams from /video');
});

test('v1.242: the resolve is UNCONDITIONAL - a projected id resolves with NO setting (RBAC still applies, next test)', async () => {
  setToggle(actingUser.id, null); // no opt-in setting
  assert.strictEqual((await get('/api/music/' + encodeURIComponent('djmix1::c1'))).status, 200, 'chapter resolves without any toggle');
  assert.strictEqual((await get('/api/music/nest1')).status, 200, 'library single resolves without any toggle');
});

test('v1.221 GATE FIX: the resolve is RBAC-gated - a member restricted from the file cannot resolve its chapters', async () => {
  const fm = __mintTestSession({ username: 'chapgate', role: 'member' });
  userStore.setSettingsJson(fm.user.id, { musicIncludesLibrary: 'on' });
  userStore.setRestrictions(fm.user.id, [{ kind: 'folder', value: 'nestalgiamusic' }]); // djmix1 lives here
  // Admin (toggle on) CAN resolve it - proves the 404 below is RBAC, not absence.
  setToggle(actingUser.id, 'on');
  assert.strictEqual((await get('/api/music/' + encodeURIComponent('djmix1::c1'))).status, 200, 'admin resolves the chapter');
  assert.strictEqual((await get('/api/music/' + encodeURIComponent('djmix1::c1'), fm.cookie)).status, 404, 'the restricted member cannot resolve the blocked file\'s chapter');
});

// v1.222 slice 4: a chapter play records to the MEDIA store under the BASE file id
// (the client saves currentTime, already file-absolute). Recently-played then
// collapses the file's N chapters to ONE entry - the chapter you were in - so the
// artist reaches the home row and the entry resumes at the saved file position.
test('v1.222 slice 4: a chapter play collapses to ONE Recently-played entry (the chapter you were in) with resume', async () => {
  setToggle(actingUser.id, 'on');
  // Played to file-absolute 450s, inside chapter "Track A" [300, 900).
  const save = await postJson('/api/progress', { id: 'djmix1', timestamp: 450, duration: 1800 });
  assert.strictEqual(save.status, 200, 'the base file id is a real media id -> the save is accepted (never the synthetic ::c id that 404s)');
  const recent = await (await get('/api/music?filter=recent-listening&limit=60')).json();
  const chapters = recent.items.filter((i) => typeof i.id === 'string' && i.id.indexOf('djmix1::c') === 0);
  assert.strictEqual(chapters.length, 1, 'the file collapses to ONE recent entry, not all 3 chapters');
  const hit = chapters[0];
  assert.strictEqual(hit.title, 'Track A', 'the entry is the chapter CONTAINING the saved position');
  assert.strictEqual(hit.artist, 'NESTALGIA', 'so the artist reaches the home Recently-played row');
  assert.strictEqual(hit.progress.resumeSec, 450, 'carries the absolute file position for a resume-tap');
  assert.strictEqual(hit.progress.position, 150, 'the bar shows the within-chapter offset (450 - 300)');
  assert.strictEqual(hit.progress.duration, 600, 'over the chapter span, not the whole file');
});

test('v1.242 opt-OUT: a MIXED channel shows ALL its audio by default; an explicit OFF mark hides the whole channel', async () => {
  // Default (no mark) -> ALL of mixedchan projects now (genre/majority no longer gates).
  let music = await (await get('/api/music')).json();
  let mixIds = music.items.filter((i) => ['mx1', 'mx2', 'mx3'].includes(i.id)).map((i) => i.id).sort();
  assert.deepStrictEqual(mixIds, ['mx1', 'mx2', 'mx3'], 'the whole channel projects by default (all audio is in)');
  // The explicit OFF mark is the surviving opt-out -> the whole channel disappears, then restore.
  assert.strictEqual((await postJson('/api/folders/music-flag', { folderName: 'mixedchan', music: 'off' })).status, 200);
  music = await (await get('/api/music')).json();
  assert.ok(!music.items.some((i) => ['mx1', 'mx2', 'mx3'].includes(i.id)), 'an OFF mark hides the whole channel (the opt-out)');
  await postJson('/api/folders/music-flag', { folderName: 'mixedchan', music: null });
});

test('v1.242 GET /api/music/channels: every channel is IN by default (opt-out); auto:true, effective on-unless-off', async () => {
  const data = await (await get('/api/music/channels')).json();
  const byFolder = new Map(data.channels.map((c) => [c.folderName, c]));
  // Tonzak: unset -> in by default.
  assert.deepStrictEqual({ auto: byFolder.get('Tonzak').auto, override: byFolder.get('Tonzak').override, effective: byFolder.get('Tonzak').effective },
    { auto: true, override: null, effective: true }, 'Tonzak: in by default');
  // NESTALGIA: explicitly marked on -> in.
  assert.strictEqual(byFolder.get('nestalgiamusic').effective, true, 'NESTALGIA (marked on): in');
  // mixedchan: unset -> now IN (genre/majority no longer gates); count honest.
  assert.deepStrictEqual({ effective: byFolder.get('mixedchan').effective, audioCount: byFolder.get('mixedchan').audioCount },
    { effective: true, audioCount: 3 }, 'mixedchan: in by default now, 3 tracks');
  // Zarchivo (Comedy, unset): now IN too - all audio projects unless opted out.
  assert.strictEqual(byFolder.get('zarchivo').effective, true, 'Comedy channel: in by default (opt-out model)');
});

test('GET /api/music/channels is visibility-scoped: a restricted member never sees the blocked channel', async () => {
  const adminList = await (await get('/api/music/channels')).json();
  assert.ok(adminList.channels.some((c) => c.folderName === 'blockedchan'), 'admin sees the blocked channel');
  const memberList = await (await get('/api/music/channels', member.cookie)).json();
  assert.ok(!memberList.channels.some((c) => c.folderName === 'blockedchan'), 'a channel with no VISIBLE audio is not listed for the restricted member');
  assert.ok(memberList.channels.some((c) => c.folderName === 'Tonzak'), 'an unrestricted channel is still listed');
  // audioCount is the VISIBLE count, per user - a PARTIALLY-restricted channel
  // reports only what each viewer can see (never an oracle for the hidden item).
  const adminPartial = adminList.channels.find((c) => c.folderName === 'partialchan');
  const memberPartial = memberList.channels.find((c) => c.folderName === 'partialchan');
  assert.strictEqual(adminPartial.audioCount, 3, 'admin sees all 3 of the partial channel');
  assert.strictEqual(memberPartial.audioCount, 2, 'the member sees only the 2 visible items, not the blocked one');
});

// ---- T5: the per-folder mark read/write routes ----

const postJson = (p, body, cookie) => fetch(`${base}${p}`, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: JSON.stringify(body),
});

test('v1.242 GET /api/folders/music-flag: in-unless-off (opt-out), the override, and hasAudio', async () => {
  const nest = await (await get('/api/folders/music-flag?folderName=nestalgiamusic')).json();
  assert.deepStrictEqual({ hasAudio: nest.hasAudio, override: nest.override, effective: nest.effective },
    { hasAudio: true, override: 'on', effective: true }, 'NESTALGIA: marked on -> in');
  const tonzak = await (await get('/api/folders/music-flag?folderName=Tonzak')).json();
  assert.deepStrictEqual({ override: tonzak.override, effective: tonzak.effective },
    { override: null, effective: true }, 'Tonzak: unset -> in by default');
  const zarch = await (await get('/api/folders/music-flag?folderName=zarchivo')).json();
  assert.deepStrictEqual({ override: zarch.override, effective: zarch.effective },
    { override: null, effective: true }, 'Zarchivo: unset -> now IN (opt-out model, no genre gate)');
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
  // Clear -> back to the channel-majority default (restore state for any later run).
  assert.strictEqual((await postJson('/api/folders/music-flag', { folderName: 'Tonzak', music: null })).status, 200);
  assert.strictEqual((await (await get('/api/folders/music-flag?folderName=Tonzak')).json()).override, null, 'cleared back to default');
});

// ---- T6: the master toggle through the REAL settings endpoint ----

test('v1.242: projection is INDEPENDENT of the retired musicIncludesLibrary setting (unconditional both ways)', async () => {
  // The old opt-in no longer gates projection. Whatever the setting says, all audio projects.
  assert.strictEqual((await postJson('/api/me/settings', { musicIncludesLibrary: null })).status, 200);
  assert.ok((await (await get('/api/music')).json()).items.some((i) => i.id === 'tonzak1'), 'audio projects with the setting absent');
  assert.strictEqual((await postJson('/api/me/settings', { musicIncludesLibrary: 'on' })).status, 200);
  assert.ok((await (await get('/api/music')).json()).items.some((i) => i.id === 'tonzak1'), 'and with it on - the setting no longer drives projection');
});
