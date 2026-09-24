'use strict';

// [INTEGRATION] M3 chapter likes (v1.317, wave decisions D9-D12): "the ability to
// Like a given chapter as a 'song'" (Dean). A chaptered audio file is ONE media
// item whose chapters are music rows keyed `<mediaId>::c<n>`; a like on one of
// them lives in the MEDIA like store (user_liked) under that chapter id. Through
// the REAL app and routes, this file binds every acceptance line of
// docs/exec-plans/completed/2026-09-23-chapter-likes.md:
//   AC1  the row is stored under `<id>::c2`; the base FILE is NOT liked;
//   AC2  GET /api/liked lists a track-shaped entry and counts it in `total`;
//   AC3  the music row / resolve flag `liked` reads the media store, per chapter;
//   AC4  every malformed / out-of-range / non-audio / non-chaptered id 404s
//        and leaves NO row (the existence check is the REAL expansion);
//   AC5  the MEDIA-kind RBAC gate (a `{kind:'folder'}` restriction, which the
//        track gate cannot express) blocks the write (404, no oracle) and hides
//        the member's own row from the listing;
//   AC6  trash carries the like to `<trashId>::c2`, restore carries it back,
//        purge sheds it (the data-loss class: no orphan, no ghost);
//   AC7  a move carries EVERY user's chapter likes under the new id;
//   AC8  the backup bundle round-trips the longer key;
//   AC12 the member's /api/stats inventory counts a chapter like by its base.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapter-likes-'));
const DATA_DIR = process.env.DATA_DIR;
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, loadDatabase, userStore, __resetDatabaseForTests, __mintTestSession, __clearUsersForTests,
} = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const libraryAudio = require('../../lib/music/libraryAudio');

let server, base, admin;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  admin = authenticateFetch(server, base);
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(async () => { await __resetDatabaseForTests(); });

const SETTINGS = { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0, trashRetentionDays: 30 };

// Five embedded chapters over a 300s file: spans 60s each, chapter 2 starts at 120.
const FIVE = [
  { startTime: 0, title: 'Opening' }, { startTime: 60, title: 'Second Song' }, { startTime: 120, title: 'Third Song' },
  { startTime: 180, title: 'Fourth Song' }, { startTime: 240, title: 'Closer' },
];
// Chapter 1 has a garbage start: expandAudioToTracks SKIPS it but keeps the ORIGINAL
// index on the survivors (::c0, ::c2, ::c3) - so `::c1` is NOT a valid like target
// even though 1 < chapters.length.
const GAPPY = [
  { startTime: 0, title: 'A' }, { startTime: 'garbage', title: 'B' }, { startTime: 100, title: 'C' }, { startTime: 200, title: 'D' },
];

// A real library on disk (trash/move/purge move real bytes), two folders so the
// `{kind:'folder'}` restriction and the move both have a destination.
function seedLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapter-likes-lib-'));
  fs.mkdirSync(path.join(root, 'Chan'));
  fs.mkdirSync(path.join(root, 'Other'));
  const mk = (rel, extra) => {
    const filePath = path.join(root, rel);
    fs.writeFileSync(filePath, 'bytes-' + rel);
    const id = getMediaId(filePath);
    return {
      id, name: path.basename(rel), title: extra.title || path.basename(rel, path.extname(rel)), filePath,
      folderName: rel.split(path.sep)[0], channelName: extra.channelName || 'NESTALGIA', rootFolder: root,
      size: 10, addedAt: 1700000000000, hasThumbnail: true, ...extra,
    };
  };
  const mix = mk(path.join('Chan', 'mix.mp3'), { ext: '.mp3', type: 'audio', duration: 300, title: 'The Mix', chapters: FIVE });
  const single = mk(path.join('Chan', 'single.mp3'), { ext: '.mp3', type: 'audio', duration: 90, title: 'Single' });
  const gappy = mk(path.join('Chan', 'gappy.mp3'), { ext: '.mp3', type: 'audio', duration: 300, title: 'Gappy', chapters: GAPPY });
  const vid = mk(path.join('Chan', 'film.mp4'), { ext: '.mp4', type: 'video', duration: 300, title: 'Film', chapters: FIVE });
  const items = { [mix.id]: mix, [single.id]: single, [gappy.id]: gappy, [vid.id]: vid };
  seedState({ folders: [root], folderSettings: {}, settings: SETTINGS, liked: [], metadata: items });
  // The chapter ids under test come from the REAL projection, never hand-typed.
  const mixTracks = libraryAudio.expandAudioToTracks(mix, () => FIVE);
  assert.strictEqual(mixTracks.length, 5, 'precondition: the mix expands to five chapter rows');
  const gappyTracks = libraryAudio.expandAudioToTracks(gappy, () => GAPPY);
  assert.deepStrictEqual(gappyTracks.map((t) => t.id), [gappy.id + '::c0', gappy.id + '::c2', gappy.id + '::c3'], 'precondition: the gappy file skips index 1');
  return { root, mix, single, gappy, vid, c2: mixTracks[2].id, c1: mixTracks[1].id, c3: mixTracks[3].id };
}

const get = (p, cookie) => fetch(`${base}${p}`, cookie ? { headers: { Cookie: cookie } } : undefined);
const json = async (p, cookie) => (await get(p, cookie)).json();
const post = (p, cookie) => fetch(`${base}${p}`, { method: 'POST', headers: cookie ? { Cookie: cookie, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }, body: '{}' });
const del = (p, cookie) => fetch(`${base}${p}`, { method: 'DELETE', headers: cookie ? { Cookie: cookie } : {} });
const enc = encodeURIComponent;

test('AC1/AC3: liking chapter 2 of a 5-chapter file stores `<id>::c2`, the FILE stays unliked, and the music rows read the flag per chapter from the MEDIA store', async () => {
  const L = seedLibrary();
  const r = await post(`/api/liked/${enc(L.c2)}`);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { success: true, liked: true });
  assert.deepStrictEqual(userStore.getLiked(admin.user.id), [L.c2], 'stored under the chapter id, nothing else');
  assert.deepStrictEqual(userStore.getMusicLiked(admin.user.id), [], 'NOT in the music-native store (D9)');

  // The base file is NOT liked on any media surface.
  assert.strictEqual((await json(`/api/videos/${enc(L.mix.id)}`)).liked, false, '/api/videos/:id: the file is not liked');
  const listed = (await json('/api/videos?limit=50')).items.find((i) => i.id === L.mix.id);
  assert.strictEqual(listed.liked, false, '/api/videos list: the file is not liked');

  // The music rows: chapter 2 liked, its siblings and the plain file not.
  const music = (await json('/api/music?limit=50')).items;
  const byId = Object.fromEntries(music.map((t) => [t.id, t]));
  assert.strictEqual(byId[L.c2].liked, true, 'the chapter-2 row is liked');
  assert.strictEqual(byId[L.c1].liked, false, 'the chapter-1 row is not');
  assert.strictEqual(byId[L.c3].liked, false, 'the chapter-3 row is not');
  assert.strictEqual(byId[L.single.id].liked, false, 'the plain audio file is not');
  assert.strictEqual((await json(`/api/music/${enc(L.c2)}`)).liked, true, 'GET /api/music/:chapterId resolves liked:true');
  assert.strictEqual((await json(`/api/music/${enc(L.c1)}`)).liked, false, 'GET /api/music/:otherChapter resolves liked:false');
  assert.deepStrictEqual((await json('/api/music?filter=liked&limit=50')).items.map((t) => t.id), [L.c2], 'filter=liked sees the chapter through the media store');

  // A plain projected file's like is the FILE's media like (D11: the base file's like stays for non-chapter items).
  assert.strictEqual((await post(`/api/liked/${enc(L.single.id)}`)).status, 200);
  assert.strictEqual((await json(`/api/music/${enc(L.single.id)}`)).liked, true, 'a plain library row reads the file like from the media store');

  // Idempotent re-add, then unlike.
  assert.strictEqual((await post(`/api/liked/${enc(L.c2)}`)).status, 200);
  assert.deepStrictEqual(userStore.getLiked(admin.user.id).filter((id) => id === L.c2), [L.c2], 'no duplicate row');
  assert.strictEqual((await del(`/api/liked/${enc(L.c2)}`)).status, 200);
  assert.ok(!userStore.getLiked(admin.user.id).includes(L.c2), 'DELETE removes the chapter row');
  assert.ok(userStore.getLiked(admin.user.id).includes(L.single.id), 'and leaves the sibling file like alone');
});

test('AC2: GET /api/liked lists the chapter as a track-shaped entry (chapter title, span, art, album = the file) and counts it in total', async () => {
  const L = seedLibrary();
  await post(`/api/liked/${enc(L.c2)}`);
  userStore.setProgress(admin.user.id, L.mix.id, { timestamp: 150, duration: 300, updatedAt: '2026-09-23T00:00:00.000Z' }); // 30s into chapter 2
  const res = await json('/api/liked?limit=50');
  assert.strictEqual(res.total, 1, 'the sidebar count (total) includes the chapter');
  assert.strictEqual(res.items.length, 1);
  const e = res.items[0];
  assert.strictEqual(e.kind, 'track');
  assert.strictEqual(e.source, 'library-chapter');
  assert.strictEqual(e.id, L.c2);
  assert.strictEqual(e.mediaId, L.mix.id);
  assert.strictEqual(e.title, 'Third Song', 'title = the CHAPTER title');
  // album = whatever Music shows as the album for that chapter (the REAL projection's
  // value - projectAudioItem derives the file title through musicTags, so it is the
  // tag/filename-derived title, not the media record's `title` field).
  const real = libraryAudio.expandAudioToTracks(L.mix, () => FIVE)[2];
  assert.strictEqual(e.album, real.album, 'album = the projection\'s album (the file)');
  assert.strictEqual(e.artist, real.artist);
  assert.strictEqual(e.artist, 'NESTALGIA');
  assert.strictEqual(e.type, 'audio');
  assert.strictEqual(e.duration, 60, 'duration = the chapter span');
  assert.strictEqual(e.chapterStartSec, 120);
  assert.strictEqual(e.hasArt, true, 'art = the base item thumbnail');
  assert.strictEqual(e.liked, true);
  assert.strictEqual(e.addedAt, 1700000000000);
  assert.strictEqual(e.progress, 30, 'progress = the file position placed within the chapter');
  assert.strictEqual(e.progressPercent, 50);
  assert.ok(!res.items.some((i) => i.id === L.mix.id), 'the base file is NOT listed');
  // The format filter treats it as audio.
  assert.strictEqual((await json('/api/liked?format=audio&limit=50')).total, 1);
  assert.strictEqual((await json('/api/liked?format=video&limit=50')).total, 0);
});

test('AC4: out-of-range, skipped-invalid, non-chaptered, video, malformed and NUL-bearing ids all 404 and leave NO row', async () => {
  const L = seedLibrary();
  const bad = [
    [`${L.mix.id}::c5`, 'index out of range (5 chapters: 0..4)'],
    [`${L.mix.id}::c99`, 'index far out of range'],
    [`${L.gappy.id}::c1`, 'a chapter the expansion SKIPPED (garbage start) is not likeable'],
    [`${L.single.id}::c0`, 'a non-chaptered audio file has no chapter rows'],
    [`${L.vid.id}::c1`, 'a VIDEO item is not a chapter album (audio only)'],
    [`${L.mix.id}::c`, 'bare suffix'],
    [`${L.mix.id}::cx`, 'non-integer index'],
    [`${L.mix.id}::c-1`, 'negative index'],
    [`${L.mix.id}::c2::c1`, 'double suffix (base `<id>::c2` is not an item)'],
    [`${L.mix.id}\u0000::c2`, 'NUL before the suffix'],
    [`${L.mix.id}::c2\u0000`, 'NUL after the suffix'],
    ['nope::c0', 'unknown base'],
    ['::c0', 'empty base'],
  ];
  for (const [id, why] of bad) {
    const r = await post(`/api/liked/${enc(id)}`);
    assert.strictEqual(r.status, 404, `${why}: ${JSON.stringify(id)}`);
  }
  assert.deepStrictEqual(userStore.getLiked(admin.user.id), [], 'no row reached the table');
  // Discrimination: the valid siblings of the rejected ids ARE accepted.
  assert.strictEqual((await post(`/api/liked/${enc(L.gappy.id + '::c2')}`)).status, 200, 'the gappy file\'s surviving chapter 2 is likeable');
  assert.strictEqual((await post(`/api/liked/${enc(L.mix.id + '::c4')}`)).status, 200, 'the last chapter (index 4) is in range');
  assert.deepStrictEqual(userStore.getLiked(admin.user.id).sort(), [L.gappy.id + '::c2', L.mix.id + '::c4'].sort());
});

test('AC5/AC12: the MEDIA-kind RBAC gate ({kind:"folder"}) blocks a restricted member\'s chapter like (404, no oracle) and hides their own row from the listing; the member inventory counts a visible chapter like', async () => {
  const L = seedLibrary();
  const member = __mintTestSession({ username: 'kiddo', role: 'member' });
  // A FOLDER restriction is enforced by mediaVisibleTo (media kind) and cannot
  // be expressed by the track gate - so a green here binds the MEDIA gate.
  userStore.setRestrictions(member.user.id, [{ kind: 'folder', value: 'Chan' }]);
  assert.strictEqual((await post(`/api/liked/${enc(L.c2)}`, member.cookie)).status, 404, 'restricted write -> 404 (never 200, never a 403 oracle)');
  assert.deepStrictEqual(userStore.getLiked(member.user.id), [], 'nothing persisted');
  // A pre-existing row (liked before the restriction) never leaks back to them.
  userStore.addLiked(member.user.id, L.c2, '2026-09-23T00:00:00.000Z');
  const hidden = await json('/api/liked?limit=50', member.cookie);
  assert.deepStrictEqual(hidden.items, [], 'the restricted member sees no chapter entry');
  assert.strictEqual(hidden.total, 0, 'and the count does not leak it');
  assert.strictEqual((await json('/api/stats', member.cookie)).inventory.liked, 0, 'inventory.liked excludes a chapter like on a restricted file');
  // Admin (unrestricted) still lists their own.
  await post(`/api/liked/${enc(L.c2)}`);
  assert.deepStrictEqual((await json('/api/liked?limit=50')).items.map((i) => i.id), [L.c2], 'the admin\'s own entry is unaffected');
  // Lift the restriction: the SAME member can now like a chapter (discrimination)
  // and their inventory counts it by the base file.
  userStore.setRestrictions(member.user.id, []);
  assert.strictEqual((await post(`/api/liked/${enc(L.c3)}`, member.cookie)).status, 200, 'unrestricted member likes a chapter');
  assert.deepStrictEqual((await json('/api/liked?limit=50', member.cookie)).items.map((i) => i.id).sort(), [L.c2, L.c3].sort());
  assert.strictEqual((await json('/api/stats', member.cookie)).inventory.liked, 2, 'inventory.liked counts chapter likes on visible files');
  assert.strictEqual((await del(`/api/liked/${enc(L.c3)}`, member.cookie)).status, 200);
  assert.deepStrictEqual(userStore.getLiked(member.user.id), [L.c2]);
});

test('AC6: trash carries the chapter like to `<trashId>::c2` (and it leaves the listing), restore carries it back, purge sheds it - no orphan, no ghost', async () => {
  const L = seedLibrary();
  const member = __mintTestSession({ username: 'second', role: 'member' });
  await post(`/api/liked/${enc(L.c2)}`);
  userStore.addLiked(member.user.id, L.c3, '2026-09-23T00:00:00.000Z');
  userStore.addLiked(member.user.id, L.single.id, '2026-09-23T00:00:00.000Z'); // a sibling file: must NOT be touched

  const tr = await del(`/api/videos/${enc(L.mix.id)}`);
  assert.strictEqual(tr.status, 200);
  const { trashId } = await tr.json();
  assert.ok(trashId && trashId !== L.mix.id, 'trashed under a trash id');
  assert.deepStrictEqual(userStore.getLiked(admin.user.id), [`${trashId}::c2`], 'the admin\'s chapter like followed the file into the trash');
  assert.deepStrictEqual(userStore.getLiked(member.user.id).sort(), [`${trashId}::c3`, L.single.id].sort(), 'every user\'s chapter like followed; the sibling file like untouched');
  assert.strictEqual((await json('/api/liked?limit=50')).total, 0, 'a trashed file\'s chapter is not listed (no ghost)');
  assert.strictEqual((await post(`/api/liked/${enc(L.c2)}`)).status, 404, 'the old id is gone: no re-like of a trashed chapter');

  const rs = await post(`/api/trash/${enc(trashId)}/restore`);
  assert.strictEqual(rs.status, 200);
  assert.strictEqual((await rs.json()).restoredId, L.mix.id);
  assert.deepStrictEqual(userStore.getLiked(admin.user.id), [L.c2], 'restore carried it back under the original chapter id');
  assert.deepStrictEqual(userStore.getLiked(member.user.id).sort(), [L.c3, L.single.id].sort());
  assert.deepStrictEqual((await json('/api/liked?limit=50')).items.map((i) => i.id), [L.c2], 'listed again');

  const tr2 = await del(`/api/videos/${enc(L.mix.id)}`);
  const trashId2 = (await tr2.json()).trashId;
  const pg = await del(`/api/trash/${enc(trashId2)}`);
  assert.strictEqual(pg.status, 200);
  assert.deepStrictEqual(userStore.getLiked(admin.user.id), [], 'purge shed the chapter like (no orphan row)');
  assert.deepStrictEqual(userStore.getLiked(member.user.id), [L.single.id], 'purge shed the other user\'s chapter like too; the sibling file like survives');
  assert.strictEqual(loadDatabase().metadata[L.mix.id], undefined, 'precondition: the file is gone');
});

test('AC7: a move carries EVERY user\'s chapter likes under the new id, leaves no row under the old id, and does not touch sibling files', async () => {
  const L = seedLibrary();
  const member = __mintTestSession({ username: 'mover', role: 'member' });
  await post(`/api/liked/${enc(L.c2)}`);
  userStore.addLiked(member.user.id, L.c2, '2026-09-23T00:00:00.000Z');
  userStore.addLiked(member.user.id, L.c3, '2026-09-23T00:00:00.000Z');
  userStore.addLiked(member.user.id, L.single.id, '2026-09-23T00:00:00.000Z');
  const dst = path.join(L.root, 'Other');
  const newId = getMediaId(path.join(dst, 'mix.mp3'));
  const mv = await fetch(`${base}/api/videos/${enc(L.mix.id)}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetFolder: dst }) });
  assert.strictEqual(mv.status, 200, await mv.text());
  assert.deepStrictEqual(userStore.getLiked(admin.user.id), [`${newId}::c2`], 'the admin\'s chapter like followed the move');
  assert.deepStrictEqual(userStore.getLiked(member.user.id).sort(), [`${newId}::c2`, `${newId}::c3`, L.single.id].sort(), 'both of the member\'s chapter likes followed; the sibling file like untouched');
  const listed = await json('/api/liked?limit=50');
  assert.deepStrictEqual(listed.items.map((i) => i.id), [`${newId}::c2`], 'the Liked page lists the chapter under its new id');
  assert.strictEqual(listed.items[0].title, 'Third Song', 'same chapter, same title');
  assert.strictEqual((await json(`/api/music/${enc(newId + '::c2')}`)).liked, true, 'the moved chapter row reads liked');
});

test('AC8: the backup bundle round-trips a chapter like (the longer key rides the generic user_liked export/restore)', async () => {
  const L = seedLibrary();
  await post(`/api/liked/${enc(L.c2)}`);
  const bundle = await json('/api/admin/backup');
  const me = bundle.users.find((u) => u.id === admin.user.id);
  assert.deepStrictEqual(me.liked.map((l) => l.mediaId), [L.c2], 'the bundle carries the chapter key');

  await __resetDatabaseForTests();
  __clearUsersForTests();
  const fresh = __mintTestSession();
  const res = await fetch(`${base}/api/admin/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: fresh.cookie }, body: JSON.stringify(bundle) });
  assert.strictEqual(res.status, 200, await res.text());
  const restored = userStore.getByUsername('testadmin');
  assert.deepStrictEqual(userStore.getLiked(restored.id), [L.c2], 'the chapter like came back');
  // And it is LISTED again through the restored metadata (the doc tables restored in the same transaction).
  const reissued = (res.headers.get('set-cookie') || '').split(';')[0];
  const listed = await json('/api/liked?limit=50', reissued);
  assert.deepStrictEqual(listed.items.map((i) => i.id), [L.c2], 'the Liked page lists it after the restore');
  assert.strictEqual(listed.items[0].title, 'Third Song');
});

// Gate r1, adversary W1 (presence-not-binding): the read arm's `if (!track) continue;`
// in shapedLikedChapterItems was UNBOUND - with it deleted a re-chapter that strands
// `::c4` makes GET /api/liked throw on `track.chapterStartSec` (a 500 for the whole
// Liked page). Both halves of the disclosed rule are bound here: a stale index is
// DROPPED from the read (200, [], total 0) and NOT deleted from storage (the row is
// still in getLiked; a later edit restoring the index revives it). The session is
// minted HERE (AC8 above clears and restores the users table, which invalidates the
// suite-wide admin cookie), and every request carries it explicitly.
test('W1: a chapter like whose index a re-chapter removed is dropped from the read (200, empty, total 0), never a 500, and the row stays in storage', async () => {
  const L = seedLibrary();
  const me = __mintTestSession();
  const ck = me.cookie;
  const editChapters = (text) => fetch(`${base}/api/videos/${enc(L.mix.id)}/chapters`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify({ text }),
  });
  // The id comes from the REAL projection (never hand-typed): the fifth chapter row.
  const c4 = libraryAudio.expandAudioToTracks(L.mix, () => FIVE)[4].id;
  assert.strictEqual(c4, L.mix.id + '::c4', 'precondition: the last chapter row is `::c4`');
  assert.strictEqual((await post(`/api/liked/${enc(c4)}`, ck)).status, 200);
  const pre = await json('/api/liked?limit=50', ck);
  assert.deepStrictEqual(pre.items.map((i) => i.id), [c4], 'precondition: listed');
  assert.strictEqual(pre.total, 1, 'precondition: counted');
  // Re-chapter to THREE chapters through the real editor route (manual chapters win).
  const edit = await editChapters('0:00 One\n1:40 Two\n3:20 Three');
  assert.strictEqual(edit.status, 200, await edit.text());
  // Reachability: the file is STILL chaptered (three rows), so the entry reaches the
  // index lookup and the drop is the `!track` guard, not the base/audio/visibility gate.
  const rows = (await json('/api/music?limit=50', ck)).items.filter((t) => String(t.id).startsWith(L.mix.id + '::c')).map((t) => t.id);
  assert.deepStrictEqual(rows, [0, 1, 2].map((n) => L.mix.id + '::c' + n), 'the edit re-chaptered the file to three rows');
  const res = await get('/api/liked?limit=50', ck);
  assert.strictEqual(res.status, 200, 'the Liked page still answers (no throw on the stranded index)');
  const body = await res.json();
  assert.deepStrictEqual(body.items, [], 'the stale `::c4` entry is dropped from the read');
  assert.strictEqual(body.total, 0, 'and from the count');
  assert.deepStrictEqual(userStore.getLiked(me.user.id), [c4], 'the row is NOT deleted from storage (disclosed: a hand DELETE or a restoring edit is the only way out)');
  // Restoring a 5-chapter list revives it (the index is real again).
  const back = await editChapters('0:00 A\n1:00 B\n2:00 C\n3:00 D\n4:00 E');
  assert.strictEqual(back.status, 200);
  const revived = await json('/api/liked?limit=50', ck);
  assert.deepStrictEqual(revived.items.map((i) => i.id), [c4], 'revived once the index exists again');
  assert.strictEqual(revived.items[0].title, 'E', 'under the RESTORING edit\'s title for index 4');
});
