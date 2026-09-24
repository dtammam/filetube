'use strict';

// [INTEGRATION] Chapter Snap (2026-09-24) (Dean 2026-09-24): the chapter TIME editor
// through the REAL app, the REAL stored record and the REAL music projection.
// Plan: docs/exec-plans/active/2026-09-24-chapter-snap.md. Bound here:
//   - a REAL ffmpeg silencedetect run over a REAL generated file (tone,
//     silence, tone...) reaches the suggestions (skips, loudly, when no ffmpeg);
//   - TIMES ONLY: a save never renumbers - a like on `<id>::c3` still names the
//     same song after save AND after revert (GET /api/liked, /api/music);
//   - revert is seeded from STORAGE and wins over a reheat / a rescan between
//     edit and revert; a count change on revert needs an explicit yes;
//   - stale seed / racing saves: the version token refuses the loser, the
//     winner's data is what is stored;
//   - the silence cache survives a rescan and goes stale when the file changes;
//   - RBAC on every new route (403 without modify, 404 when restricted,
//     no ffmpeg started for a restricted item) + the lead-in setting.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapter-snap-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, getMediaId, loadDatabase, updateDatabase, userStore, __mintTestSession, scanDirectories, chapterSilenceService,
} = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const libraryAudio = require('../../lib/music/libraryAudio');
const { SILENCE_PARAMS_KEY } = require('../../lib/media/chapterSilence');

let server, base, admin;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  admin = authenticateFetch(server, base);
});
after(async () => {
  admin.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const SETTINGS = { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 0, trashRetentionDays: 30 };
const FIVE = [
  { startTime: 0, title: 'Opening' }, { startTime: 60, title: 'Second Song' }, { startTime: 120, title: 'Third Song' },
  { startTime: 180, title: 'Fourth Song' }, { startTime: 240, title: 'Closer' },
];

const enc = encodeURIComponent;
const get = (p, cookie) => fetch(`${base}${p}`, cookie ? { headers: { Cookie: cookie } } : undefined);
const json = async (p, cookie) => (await get(p, cookie)).json();
const postJson = (p, body, cookie) => fetch(`${base}${p}`, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: JSON.stringify(body || {}),
});

// A real library on disk (stat-able files; two folders for the folder restriction).
function seedLibrary(extra) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapter-snap-lib-'));
  fs.mkdirSync(path.join(root, 'Chan'));
  fs.mkdirSync(path.join(root, 'Other'));
  const mk = (rel, fields, bytes) => {
    const filePath = path.join(root, rel);
    if (bytes) fs.copyFileSync(bytes, filePath); else fs.writeFileSync(filePath, 'bytes-' + rel);
    const id = getMediaId(filePath);
    return {
      id, name: path.basename(rel), title: path.basename(rel, path.extname(rel)), filePath,
      folderName: rel.split(path.sep)[0], channelName: 'NESTALGIA', rootFolder: root,
      size: fs.statSync(filePath).size, addedAt: 1700000000000, hasThumbnail: false, audioCodec: 'mp3', ...fields,
    };
  };
  const mix = mk(path.join('Chan', 'mix.mp3'), { ext: '.mp3', type: 'audio', duration: 300, title: 'The Mix', chapters: FIVE.map((c) => ({ ...c })) });
  const items = { [mix.id]: mix };
  const more = extra ? extra(mk) : {};
  for (const it of Object.values(more)) items[it.id] = it;
  seedState({ folders: [root], folderSettings: {}, settings: SETTINGS, liked: [], metadata: items });
  return { root, mix, ...more };
}

// Seed the silence cache for a file exactly as a finished scan would (the REAL
// store API, matching the file's real size + mtime).
function seedSilence(item, silences) {
  const st = fs.statSync(item.filePath);
  chapterSilenceService.cache.write(item.id, { params: SILENCE_PARAMS_KEY, size: st.size, mtimeMs: st.mtimeMs, durationSec: item.duration, silences });
}

// Gaps shaped like Dean's two cases around the 300s mix: chapter 2 (60s) sits
// INSIDE a 58-62 gap, chapter 4 (180s) sits in the previous song's tail before
// a 183-185 gap; chapters 3 and 5 have no gap near them.
const MIX_GAPS = [{ start: 58, end: 62 }, { start: 183, end: 185 }];

function chapterTrackIds(item) {
  return libraryAudio.expandAudioToTracks(item, () => item.chapters).map((t) => t.id);
}

test('seed from STORAGE + suggestions: GET returns the stored rows, the version, and (once the silence is cached) the snap suggestions and a Snap-all list', async () => {
  const L = seedLibrary();
  let s = await json(`/api/videos/${enc(L.mix.id)}/chapter-snap`);
  assert.strictEqual(s.silence.state, 'none', 'nothing scanned yet');
  assert.strictEqual(s.suggestions, null);
  assert.strictEqual(s.chaptersSource, 'embedded');
  assert.strictEqual(s.edited, false);
  assert.deepStrictEqual(s.chapters.map((c) => [c.index, c.startTime, c.title]), FIVE.map((c, i) => [i, c.startTime, c.title]));
  assert.strictEqual(s.leadInSec, 0.25, 'the default lead-in');
  seedSilence(L.mix, MIX_GAPS);
  s = await json(`/api/videos/${enc(L.mix.id)}/chapter-snap`);
  assert.strictEqual(s.silence.state, 'ready');
  assert.deepStrictEqual(s.suggestions.map((x) => x.status), ['first', 'suggest', 'no-gap', 'suggest', 'no-gap']);
  assert.deepStrictEqual(s.suggestions.map((x) => x.reason || null), [null, 'silence', null, 'tail', null]);
  assert.deepStrictEqual(s.snapAll, [0, 61.75, 120, 184.75, 240]);
});

test('HEADLINE (times only): a snap save keeps every `<id>::c<n>` on the SAME song - a like on c3 survives save and revert, titles and count never change', async () => {
  const L = seedLibrary();
  const ids = chapterTrackIds(L.mix);
  const c3 = ids[3];
  assert.strictEqual((await postJson(`/api/liked/${enc(c3)}`)).status, 200, 'like chapter 4 ("Fourth Song") as a song');
  const member = __mintTestSession({ username: 'snap-liker', role: 'member' });
  userStore.addLiked(member.user.id, ids[1], '2026-09-24T00:00:00.000Z');
  seedSilence(L.mix, MIX_GAPS);
  const s = await json(`/api/videos/${enc(L.mix.id)}/chapter-snap`);
  const r = await postJson(`/api/videos/${enc(L.mix.id)}/chapter-snap`, { version: s.version, starts: s.snapAll });
  assert.strictEqual(r.status, 200);
  const saved = await r.json();
  assert.strictEqual(saved.chaptersSource, 'manual');
  assert.strictEqual(saved.chaptersEdited, true);
  assert.deepStrictEqual(saved.chapters.map((c) => c.title), FIVE.map((c) => c.title), 'titles are the stored ones');

  // The stored record: chaptersManual with provenance, embedded chapters untouched.
  const stored = loadDatabase().metadata[L.mix.id];
  assert.deepStrictEqual(stored.chaptersManual.map((c) => c.startTime), [0, 61.75, 120, 184.75, 240]);
  assert.deepStrictEqual(stored.chaptersManual.map((c) => c.snapFrom), [0, 60, 120, 180, 240]);
  assert.deepStrictEqual(stored.chapters, FIVE, 'the source chapters are never written');

  // GET /api/videos/:id reports manual + edited; the music rows carry the new starts under the SAME ids.
  const detail = await json(`/api/videos/${enc(L.mix.id)}`);
  assert.strictEqual(detail.chaptersSource, 'manual');
  assert.strictEqual(detail.chaptersEdited, true);
  const music = (await json('/api/music?limit=50')).items.filter((t) => String(t.id).startsWith(L.mix.id + '::c'));
  assert.deepStrictEqual(music.map((t) => t.id).sort(), ids.slice().sort(), 'the SAME five chapter ids');
  const byId = Object.fromEntries(music.map((t) => [t.id, t]));
  assert.strictEqual(byId[c3].title, 'Fourth Song');
  assert.strictEqual(byId[c3].chapterStartSec, 184.75, 'c3 now starts at its snapped time');
  assert.strictEqual(byId[c3].liked, true, 'the like still points at c3');
  assert.strictEqual(byId[c3].chaptersEdited, true, 'the drill badge flag rides the rows');

  // GET /api/liked: the admin's like is still "Fourth Song"; the member's still "Second Song".
  const liked = (await json('/api/liked?limit=50')).items.find((i) => i.id === c3);
  assert.ok(liked, 'the chapter like is still listed');
  assert.strictEqual(liked.title, 'Fourth Song');
  assert.strictEqual(liked.chapterStartSec, 184.75);
  const mLiked = (await json('/api/liked?limit=50', member.cookie)).items.find((i) => i.id === ids[1]);
  assert.strictEqual(mLiked && mLiked.title, 'Second Song');

  // Revert: back to the embedded source, the likes STILL on the same songs.
  const s2 = await json(`/api/videos/${enc(L.mix.id)}/chapter-snap`);
  assert.strictEqual(s2.edited, true);
  assert.deepStrictEqual(s2.revert, { source: 'embedded', count: 5 });
  const rv = await postJson(`/api/videos/${enc(L.mix.id)}/chapter-snap/revert`, { version: s2.version });
  assert.strictEqual(rv.status, 200);
  const reverted = loadDatabase().metadata[L.mix.id];
  assert.strictEqual(reverted.chaptersManual, undefined, 'the manual list is gone');
  assert.strictEqual((await json(`/api/videos/${enc(L.mix.id)}`)).chaptersEdited, false);
  const after = (await json('/api/liked?limit=50')).items.find((i) => i.id === c3);
  assert.strictEqual(after.title, 'Fourth Song');
  assert.strictEqual(after.chapterStartSec, 180, 'the source time is back');
  assert.deepStrictEqual(userStore.getLiked(admin.user.id).filter((id) => id.startsWith(L.mix.id)), [c3], 'no like was re-keyed or dropped');
});

test('refusals: count change, reorder, chapter-1 move, past the end, bad version and a titles smuggle are all refused and store NOTHING', async () => {
  const L = seedLibrary();
  const s = await json(`/api/videos/${enc(L.mix.id)}/chapter-snap`);
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const cases = [
    [{ version: s.version, starts: [0, 61, 120, 180] }, 400, /expected 5/],
    [{ version: s.version, starts: [0, 61, 120, 180, 240, 290] }, 400, /expected 5/],
    [{ version: s.version, starts: [0, 130, 120, 180, 240] }, 400, /Chapter 3 must start after/],
    [{ version: s.version, starts: [2, 61, 120, 180, 240] }, 400, /first chapter/],
    [{ version: s.version, starts: [0, 61, 120, 180, 300] }, 400, /before the end/],
    [{ version: s.version, starts: [0, '61', 120, 180, 240] }, 400, /Chapter 2/],
    [{ version: s.version, starts: 'nope' }, 400, /starts must be an array/],
    [{ version: 'stale0123456789a', starts: [0, 61, 120, 180, 240] }, 409, /changed since/],
    [{ starts: [0, 61, 120, 180, 240] }, 409, /changed since/],
  ];
  for (const [body, status, re] of cases) {
    const r = await postJson(url, body);
    assert.strictEqual(r.status, status, `${JSON.stringify(body)} -> ${status}`);
    assert.match((await r.json()).error, re);
  }
  // A titles smuggle is ignored: the stored titles win.
  const ok = await postJson(url, { version: s.version, starts: [0, 61, 120, 180, 240], titles: ['HACKED'], chapters: [{ startTime: 0, title: 'HACKED' }] });
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(loadDatabase().metadata[L.mix.id].chaptersManual.map((c) => c.title), FIVE.map((c) => c.title));
  // Revert without an edit to revert.
  const L2 = seedLibrary();
  const s3 = await json(`/api/videos/${enc(L2.mix.id)}/chapter-snap`);
  const rv = await postJson(`/api/videos/${enc(L2.mix.id)}/chapter-snap/revert`, { version: s3.version });
  assert.strictEqual(rv.status, 409);
  assert.strictEqual(loadDatabase().metadata[L2.mix.id].chaptersManual, undefined);
});

test('stale seed: a text-editor save after the snap editor opened wins; the snap save is refused and the typed chapters are what is stored', async () => {
  const L = seedLibrary();
  const s = await json(`/api/videos/${enc(L.mix.id)}/chapter-snap`);
  const typed = '0:00 Opening\n1:05 Second Song\n2:00 Third Song\n3:00 Fourth Song\n4:00 Closer';
  assert.strictEqual((await postJson(`/api/videos/${enc(L.mix.id)}/chapters`, { text: typed })).status, 200);
  const r = await postJson(`/api/videos/${enc(L.mix.id)}/chapter-snap`, { version: s.version, starts: [0, 61, 120, 180, 240] });
  assert.strictEqual(r.status, 409);
  assert.strictEqual((await r.json()).stale, true);
  assert.deepStrictEqual(loadDatabase().metadata[L.mix.id].chaptersManual.map((c) => c.startTime), [0, 65, 120, 180, 240], 'the typed list is untouched');
});

test('racing saves (TOCTOU): two saves from the SAME seed fired together - exactly one lands, the other is refused, and the stored record is the winner\'s', async () => {
  const L = seedLibrary();
  const s = await json(`/api/videos/${enc(L.mix.id)}/chapter-snap`);
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const [a, b] = await Promise.all([
    postJson(url, { version: s.version, starts: [0, 61, 120, 180, 240] }),
    postJson(url, { version: s.version, starts: [0, 59, 121, 181, 241] }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepStrictEqual(statuses, [200, 409], 'one winner, one refusal');
  const winner = a.status === 200 ? [0, 61, 120, 180, 240] : [0, 59, 121, 181, 241];
  assert.deepStrictEqual(loadDatabase().metadata[L.mix.id].chaptersManual.map((c) => c.startTime), winner);
  // The provenance is the ORIGINAL source, not the loser's or the winner's times.
  assert.deepStrictEqual(loadDatabase().metadata[L.mix.id].chaptersManual.map((c) => c.snapFrom), [0, 60, 120, 180, 240]);
});

test('revert seeds from STORAGE after a REHEAT re-pulled the source between edit and revert: the reheated source wins; a count change needs an explicit yes', async () => {
  const { recordRepulledItemMeta } = require('../../server');
  const L = seedLibrary();
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const s = await json(url);
  assert.strictEqual((await postJson(url, { version: s.version, starts: [0, 61, 121, 181, 241] })).status, 200);
  // A reheat re-pulls the embedded chapters (same count, a moved time) - the REAL persist path.
  const reheated = FIVE.map((c) => ({ ...c }));
  reheated[2].startTime = 125;
  await recordRepulledItemMeta({ loadDatabase, updateDatabase, getMediaId }, L.mix.id, { filePath: L.mix.filePath, chapters: reheated, markComplete: false }, 1_900_000_000_000);
  const mid = loadDatabase().metadata[L.mix.id];
  assert.deepStrictEqual(mid.chaptersManual.map((c) => c.startTime), [0, 61, 121, 181, 241], 'the reheat never touches the snapped times');
  const s2 = await json(url);
  assert.strictEqual(s2.edited, true);
  assert.strictEqual((await postJson(`${url}/revert`, { version: s2.version })).status, 200);
  assert.deepStrictEqual((await json(`/api/videos/${enc(L.mix.id)}`)).chapters.map((c) => c.startTime), [0, 60, 125, 180, 240], 'revert lands on the source AS STORED NOW (the reheated 125)');

  // Count change: snap again, then the reheat drops a chapter.
  const s3 = await json(url);
  assert.strictEqual((await postJson(url, { version: s3.version, starts: [0, 61, 125, 181, 241] })).status, 200);
  await recordRepulledItemMeta({ loadDatabase, updateDatabase, getMediaId }, L.mix.id, { filePath: L.mix.filePath, chapters: FIVE.slice(0, 4), markComplete: false }, 1_900_000_000_001);
  const s4 = await json(url);
  assert.deepStrictEqual(s4.revert, { source: 'embedded', count: 4 });
  const refused = await postJson(`${url}/revert`, { version: s4.version });
  assert.strictEqual(refused.status, 409);
  assert.deepStrictEqual((await refused.json()).countChange, { from: 5, to: 4 });
  assert.strictEqual(loadDatabase().metadata[L.mix.id].chaptersManual.length, 5, 'nothing reverted without the yes');
  const yes = await postJson(`${url}/revert`, { version: s4.version, allowCountChange: true });
  assert.strictEqual(yes.status, 200);
  assert.strictEqual(loadDatabase().metadata[L.mix.id].chaptersManual, undefined);
});

test('revert of a TYPED list that was then snapped restores the typed times (not the embedded ones), titles intact', async () => {
  const L = seedLibrary();
  const typed = '0:00 Alpha\n1:05 Beta\n2:10 Gamma';
  assert.strictEqual((await postJson(`/api/videos/${enc(L.mix.id)}/chapters`, { text: typed })).status, 200);
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const s = await json(url);
  assert.strictEqual(s.chaptersSource, 'manual');
  assert.strictEqual((await postJson(url, { version: s.version, starts: [0, 66, 131] })).status, 200);
  const s2 = await json(url);
  assert.deepStrictEqual(s2.revert, { source: 'manual', count: 3 });
  assert.strictEqual((await postJson(`${url}/revert`, { version: s2.version })).status, 200);
  assert.deepStrictEqual(loadDatabase().metadata[L.mix.id].chaptersManual, [
    { startTime: 0, title: 'Alpha' }, { startTime: 65, title: 'Beta' }, { startTime: 130, title: 'Gamma' },
  ]);
});

test('a RESCAN keeps the snap edit (with its provenance) and the silence cache; a CHANGED file makes the cache stale while the edit is carried forward', async () => {
  const L = seedLibrary();
  seedSilence(L.mix, MIX_GAPS);
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const s = await json(url);
  assert.strictEqual((await postJson(url, { version: s.version, starts: s.snapAll })).status, 200);
  await scanDirectories();
  const kept = loadDatabase().metadata[L.mix.id];
  assert.deepStrictEqual(kept.chaptersManual.map((c) => [c.startTime, c.snapFrom, c.snapBase]),
    [[0, 0, 'embedded'], [61.75, 60, 'embedded'], [120, 120, 'embedded'], [184.75, 180, 'embedded'], [240, 240, 'embedded']]);
  const afterScan = await json(url);
  assert.strictEqual(afterScan.silence.state, 'ready', 'an unchanged file keeps its cached silence across a rescan');
  assert.strictEqual(afterScan.edited, true);
  // The file changes: the cache is stale (never served), the edit is carried forward.
  fs.appendFileSync(L.mix.filePath, '-replaced-with-new-bytes');
  const stale = await json(url);
  assert.strictEqual(stale.silence.state, 'stale');
  assert.strictEqual(stale.suggestions, null, 'no suggestions from a stale scan');
  await scanDirectories();
  assert.strictEqual(loadDatabase().metadata[L.mix.id].chaptersManual.length, 5, 'the re-init carry-forward keeps the snap edit');
  assert.strictEqual((await json(url)).edited, true);
});

test('RBAC: no modify right -> 403 on all four routes; a restricted item -> 404 on all four and NO scan is started; a NUL id -> 404', async () => {
  const L = seedLibrary();
  const plain = __mintTestSession({ username: 'snap-plain', role: 'member' });
  const granted = __mintTestSession({ username: 'snap-granted', role: 'member' });
  userStore.setCanModifyLibrary(granted.user.id, true);
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const s = await json(url);
  const routes = [
    () => get(url, plain.cookie),
    () => postJson(`${url}/scan`, {}, plain.cookie),
    () => postJson(url, { version: s.version, starts: [0, 61, 120, 180, 240] }, plain.cookie),
    () => postJson(`${url}/revert`, { version: s.version }, plain.cookie),
  ];
  for (const call of routes) assert.strictEqual((await call()).status, 403);
  // A granted member restricted by FOLDER (the media-only kind) sees 404 everywhere.
  userStore.setRestrictions(granted.user.id, [{ kind: 'folder', value: 'Chan' }]);
  const g = granted.cookie;
  assert.strictEqual((await get(url, g)).status, 404);
  assert.strictEqual((await postJson(`${url}/scan`, {}, g)).status, 404);
  assert.strictEqual(chapterSilenceService.stateFor(L.mix).state, 'none', 'the restricted scan started no ffmpeg run');
  assert.strictEqual((await postJson(url, { version: s.version, starts: [0, 61, 120, 180, 240] }, g)).status, 404);
  assert.strictEqual((await postJson(`${url}/revert`, { version: s.version }, g)).status, 404);
  assert.strictEqual(loadDatabase().metadata[L.mix.id].chaptersManual, undefined, 'nothing stored by any refused call');
  // Lifted: the same member can now save (discrimination - the gate is the restriction).
  userStore.setRestrictions(granted.user.id, []);
  assert.strictEqual((await postJson(url, { version: s.version, starts: [0, 61, 120, 180, 240] }, g)).status, 200);
  assert.strictEqual((await get(`/api/videos/${enc('a\u0000b')}/chapter-snap`)).status, 404);
  assert.strictEqual((await get('/api/videos/no-such-id/chapter-snap')).status, 404);
});

test('the scan route: refuses an item with fewer than two chapters; answers busy/unavailable honestly; the lead-in setting moves the suggestions', async () => {
  const L = seedLibrary((mk) => ({ single: mk(path.join('Chan', 'single.mp3'), { ext: '.mp3', type: 'audio', duration: 90 }) }));
  assert.strictEqual((await postJson(`/api/videos/${enc(L.single.id)}/chapter-snap/scan`)).status, 400);
  fs.rmSync(L.mix.filePath);
  assert.strictEqual((await postJson(`/api/videos/${enc(L.mix.id)}/chapter-snap/scan`)).status, 409, 'a missing file is unavailable, not a crash');
  // The lead-in: admin-only, 0-2 s.
  assert.strictEqual((await postJson('/api/settings', { chapterSnapLeadInSec: 3 })).status, 400);
  assert.strictEqual((await postJson('/api/settings', { chapterSnapLeadInSec: '1' })).status, 400);
  const member = __mintTestSession({ username: 'snap-setter', role: 'member' });
  userStore.setCanModifyLibrary(member.user.id, true);
  assert.strictEqual((await postJson('/api/settings', { chapterSnapLeadInSec: 1 }, member.cookie)).status, 403, 'a server-wide setting stays admin-only');
  const L2 = seedLibrary(); // (seeding replaces the settings table - seed BEFORE the setting)
  seedSilence(L2.mix, MIX_GAPS);
  const set = await postJson('/api/settings', { chapterSnapLeadInSec: 1 });
  assert.strictEqual(set.status, 200);
  assert.strictEqual((await set.json()).chapterSnapLeadInSec, 1);
  const s = await json(`/api/videos/${enc(L2.mix.id)}/chapter-snap`);
  assert.strictEqual(s.leadInSec, 1);
  assert.deepStrictEqual(s.snapAll, [0, 61, 120, 184, 240], 'the snapped starts sit 1 s before the first sound');
  assert.strictEqual((await postJson('/api/settings', { chapterSnapLeadInSec: 0.25 })).status, 200);
});

// ---- REACHABILITY: a REAL ffmpeg over a REAL file --------------------------------
// The detector's output shape comes from ffmpeg itself, never a hand-typed fixture.
// FILETUBE_TEST_FFMPEG points at a binary when ffmpeg is not on PATH (this box has
// none installed); without either, the test SKIPS and says so.
function findFfmpeg() {
  const explicit = process.env.FILETUBE_TEST_FFMPEG;
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, 'ffmpeg');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (_) { /* next */ }
  }
  return null;
}
const FFMPEG = findFfmpeg();

test('REACHABILITY: POST scan runs the REAL ffmpeg silencedetect over a generated tone/silence/tone album and the suggestions land on the real gaps', { skip: FFMPEG ? false : 'no ffmpeg binary (set FILETUBE_TEST_FFMPEG)' }, async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapter-snap-ff-'));
  const album = path.join(work, 'album.mp3');
  // tone 6s | silence 2s | tone 6s | silence 2s | tone 6s  (22s). Song starts: 0, 8, 16.
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=550:duration=6',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=660:duration=6',
    '-filter_complex', '[0][1][2][3][4]concat=n=5:v=0:a=1', '-ac', '1', '-y', album]);
  // Dean's two cases: chapter 2 starts INSIDE the first gap (6.5), chapter 3 in song 2's TAIL (13).
  const CH = [{ startTime: 0, title: 'One' }, { startTime: 6.5, title: 'Two' }, { startTime: 13, title: 'Three' }];
  const L = seedLibrary((mk) => ({ real: mk(path.join('Chan', 'real.mp3'), { ext: '.mp3', type: 'audio', duration: 22, chapters: CH }, album) }));
  const savedPath = process.env.PATH;
  process.env.PATH = path.dirname(FFMPEG) + path.delimiter + savedPath; // the server spawns `ffmpeg` by name
  try {
    const url = `/api/videos/${enc(L.real.id)}/chapter-snap`;
    const started = await postJson(`${url}/scan`);
    assert.strictEqual(started.status, 202);
    assert.strictEqual((await started.json()).state, 'running');
    assert.strictEqual((await json(url)).silence.state, 'running');
    await chapterSilenceService.whenIdle(L.real.id);
    const s = await json(url);
    assert.strictEqual(s.silence.state, 'ready', `scan finished: ${JSON.stringify(s.silence)}`);
    assert.strictEqual(s.silence.gaps, 2, 'the two real gaps');
    assert.deepStrictEqual(s.suggestions.map((x) => x.status), ['first', 'suggest', 'suggest']);
    assert.deepStrictEqual(s.suggestions.map((x) => x.reason || null), [null, 'silence', 'tail']);
    // The first sound after each gap is at 8 and 16; the lead-in is 0.25.
    assert.ok(Math.abs(s.suggestions[1].time - 7.75) < 0.05, `chapter 2 snaps to ~7.75 (got ${s.suggestions[1].time})`);
    assert.ok(Math.abs(s.suggestions[2].time - 15.75) < 0.05, `chapter 3 snaps to ~15.75 (got ${s.suggestions[2].time})`);
    assert.strictEqual((await postJson(url, { version: s.version, starts: s.snapAll })).status, 200);
    const tracks = (await json('/api/music?limit=50')).items.filter((t) => String(t.id).startsWith(L.real.id + '::c'));
    assert.deepStrictEqual(tracks.map((t) => t.chapterStartSec).sort((a, b) => a - b), s.snapAll);
    // A second scan request is answered from the cache (no second run).
    const again = await postJson(`${url}/scan`);
    assert.strictEqual(again.status, 200);
    assert.strictEqual((await again.json()).state, 'ready');
  } finally {
    process.env.PATH = savedPath;
    fs.rmSync(work, { recursive: true, force: true });
  }
});

// ---- gate r1 fixes -----------------------------------------------------------------
const common = require('../../public/js/common.js');
const seedTextOf = (chapters) => chapters.map((c) => common.formatChapterStamp(c.startTime) + ' ' + c.title).join('\n');

test('A1 (adversary W1): a TITLE-ONLY text save of a snap edit keeps every snapped time AND the provenance (Edited + Revert survive)', async () => {
  const L = seedLibrary();
  seedSilence(L.mix, MIX_GAPS);
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const s = await json(url);
  assert.strictEqual((await postJson(url, { version: s.version, starts: s.snapAll })).status, 200);
  const detail = await json(`/api/videos/${enc(L.mix.id)}`);
  assert.strictEqual(typeof detail.chaptersVersion, 'string', 'the detail carries the text editor\'s version token');
  // The REAL seed the watch page builds (common.js formatChapterStamp), one title renamed.
  const text = seedTextOf(detail.chapters).replace('Closer', 'The Closer');
  assert.match(text, /1:01\.75 Second Song/, 'precondition: the seed is lossless (never 1:01)');
  const r = await postJson(`/api/videos/${enc(L.mix.id)}/chapters`, { text, version: detail.chaptersVersion });
  assert.strictEqual(r.status, 200);
  const body = await r.json();
  assert.strictEqual(body.chaptersEdited, true, 'still Edited');
  const stored = loadDatabase().metadata[L.mix.id].chaptersManual;
  assert.deepStrictEqual(stored.map((c) => c.startTime), [0, 61.75, 120, 184.75, 240], 'no time moved');
  assert.deepStrictEqual(stored.map((c) => c.snapFrom), [0, 60, 120, 180, 240], 'the provenance survived');
  assert.strictEqual(stored[4].title, 'The Closer', 'the rename landed');
  assert.deepStrictEqual((await json(url)).revert, { source: 'embedded', count: 5 }, 'Revert is still offered');
  // A typed TIME change is a plain typed list (the stated rule).
  const d2 = await json(`/api/videos/${enc(L.mix.id)}`);
  const moved = seedTextOf(d2.chapters).replace('1:01.75', '1:03');
  assert.strictEqual((await postJson(`/api/videos/${enc(L.mix.id)}/chapters`, { text: moved, version: d2.chaptersVersion })).status, 200);
  assert.strictEqual((await json(url)).edited, false, 'a time change through the text box is plain manual chapters');
});

test('A1b (adversary W1): starts 0.7 s apart round-trip through the text editor - 5 chapters stay 5 and the ::c3 like still names its song; a typed DUPLICATE start is refused, nothing stored', async () => {
  const L = seedLibrary();
  const ids = chapterTrackIds(L.mix);
  assert.strictEqual((await postJson(`/api/liked/${enc(ids[3])}`)).status, 200);
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const s = await json(url);
  assert.strictEqual((await postJson(url, { version: s.version, starts: [0, 120.2, 120.9, 180, 240] })).status, 200);
  const detail = await json(`/api/videos/${enc(L.mix.id)}`);
  const text = seedTextOf(detail.chapters);
  assert.match(text, /2:00\.2 Second Song\n2:00\.9 Third Song/, 'two distinct stamps (flooring made them both 2:00)');
  assert.strictEqual((await postJson(`/api/videos/${enc(L.mix.id)}/chapters`, { text, version: detail.chaptersVersion })).status, 200);
  const stored = loadDatabase().metadata[L.mix.id].chaptersManual;
  assert.strictEqual(stored.length, 5, 'no chapter was merged away');
  assert.deepStrictEqual(stored.map((c) => c.startTime), [0, 120.2, 120.9, 180, 240]);
  const liked = (await json('/api/liked?limit=50')).items.find((i) => i.id === ids[3]);
  assert.strictEqual(liked && liked.title, 'Fourth Song', 'the ::c3 like still names "Fourth Song"');
  // Two chapters typed on ONE start: refused with a message, the store untouched.
  const d2 = await json(`/api/videos/${enc(L.mix.id)}`);
  const dup = '0:00 Opening\n2:00 Second Song\n2:00 Third Song\n3:00 Fourth Song\n4:00 Closer';
  const r = await postJson(`/api/videos/${enc(L.mix.id)}/chapters`, { text: dup, version: d2.chaptersVersion });
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).error, /Two chapters start at 2:00/);
  assert.strictEqual(loadDatabase().metadata[L.mix.id].chaptersManual.length, 5, 'nothing stored');
});

test('the TWO text-editor seed stamps agree (adversary W1): music.js chapterStamp === common.js formatChapterStamp, fractions included, and the server grammar reads them back exactly', () => {
  const M = require('../../public/js/music.js');
  const { parseManualChapterText } = require('../../server');
  for (const t of [5, 59, 60, 61.75, 120.2, 120.9, 184.75, 599.999, 3600, 3725.5, 7325.125]) {
    assert.strictEqual(M.chapterStamp(t), common.formatChapterStamp(t), `the stamps agree at ${t}`);
    const back = parseManualChapterText('0:00 A\n' + common.formatChapterStamp(t) + ' B');
    assert.strictEqual(back.error, null);
    assert.strictEqual(back.chapters[1].startTime, t, `"${common.formatChapterStamp(t)}" reads back as ${t}`);
  }
  assert.strictEqual(common.formatChapterStamp(61.75), '1:01.75');
  assert.strictEqual(common.formatChapterStamp(61), '1:01', 'whole seconds read exactly as before');
  // The description grammar is unchanged: "3:00.1999 remix" keeps its old reading.
  assert.deepStrictEqual(parseManualChapterText('0:00 A\n3:00.1999 remix').chapters[1], { startTime: 180, title: '1999 remix' });
});

test('S8 (adversary): a TEXT editor opened before a snap save cannot overwrite it - its version is refused (409); with no version the legacy path still saves', async () => {
  const L = seedLibrary();
  const before = await json(`/api/videos/${enc(L.mix.id)}`);
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const s = await json(url);
  assert.strictEqual((await postJson(url, { version: s.version, starts: [0, 61, 121, 181, 241] })).status, 200);
  const stale = await postJson(`/api/videos/${enc(L.mix.id)}/chapters`, { text: seedTextOf(before.chapters), version: before.chaptersVersion });
  assert.strictEqual(stale.status, 409);
  assert.strictEqual((await stale.json()).stale, true);
  assert.deepStrictEqual(loadDatabase().metadata[L.mix.id].chaptersManual.map((c) => c.startTime), [0, 61, 121, 181, 241], 'the snap survived');
  assert.strictEqual((await postJson(`/api/videos/${enc(L.mix.id)}/chapters`, { text: 'x', version: 7 })).status, 400, 'a non-string version is refused');
});

test('R2 (gate r2, Architect ruling on adversary W1): a revert with an UNCHANGED count restores the source TIMES and KEEPS the typed titles; a count-changing revert takes the source titles', async () => {
  const { recordRepulledItemMeta } = require('../../server');
  const L = seedLibrary();
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const s = await json(url);
  assert.strictEqual((await postJson(url, { version: s.version, starts: [0, 61.75, 120, 184.75, 240] })).status, 200);
  // The adversary's repro: rename two chapters in the TEXT editor (title-only: Edited survives).
  const d = await json(`/api/videos/${enc(L.mix.id)}`);
  const renamed = seedTextOf(d.chapters).replace('Second Song', 'Heartbeats (José González)').replace('Fourth Song', 'Crosses');
  const r = await postJson(`/api/videos/${enc(L.mix.id)}/chapters`, { text: renamed, version: d.chaptersVersion });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).chaptersEdited, true, 'precondition: still a snap edit after the rename');
  const s2 = await json(url);
  assert.deepStrictEqual(s2.revert, { source: 'embedded', count: 5 });
  assert.strictEqual((await postJson(`${url}/revert`, { version: s2.version })).status, 200);
  const stored = loadDatabase().metadata[L.mix.id].chaptersManual;
  assert.deepStrictEqual(stored.map((c) => c.title), ['Opening', 'Heartbeats (José González)', 'Third Song', 'Crosses', 'Closer'], 'the TYPED titles survive the revert');
  assert.deepStrictEqual(stored.map((c) => c.startTime), [0, 60, 120, 180, 240], 'the TIMES are the source times');
  assert.ok(stored.every((c) => c.snapFrom === undefined && c.snapBase === undefined), 'a plain typed list now: no snap provenance');
  assert.strictEqual((await json(url)).edited, false, 'no longer Edited');
  // A count-changing revert (the source grew) takes the SOURCE list, titles included.
  const s3 = await json(url);
  const typedStarts = [0, 61, 120, 181, 240];
  assert.strictEqual((await postJson(url, { version: s3.version, starts: typedStarts })).status, 200);
  const six = FIVE.map((c) => ({ ...c })).concat([{ startTime: 280, title: 'Bonus' }]);
  await recordRepulledItemMeta({ loadDatabase, updateDatabase, getMediaId }, L.mix.id, { filePath: L.mix.filePath, chapters: six, markComplete: false }, 1_900_000_000_000);
  const s4 = await json(url);
  assert.deepStrictEqual(s4.revert, { source: 'manual', count: 5 }, 'the base of THIS snap edit is the typed list (the rename made it plain) - its typed titles come back');
  assert.strictEqual((await postJson(`${url}/revert`, { version: s4.version })).status, 200);
  assert.deepStrictEqual(loadDatabase().metadata[L.mix.id].chaptersManual.map((c) => c.title)[1], 'Heartbeats (José González)');
});

test('R2: a count-changing revert of an EMBEDDED-based snap takes the source titles with the source list (and says so)', async () => {
  const { recordRepulledItemMeta } = require('../../server');
  const L = seedLibrary();
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const s = await json(url);
  assert.strictEqual((await postJson(url, { version: s.version, starts: [0, 61, 121, 181, 241] })).status, 200);
  const six = [{ startTime: 0, title: 'N1' }, { startTime: 50, title: 'N2' }, { startTime: 100, title: 'N3' }, { startTime: 150, title: 'N4' }, { startTime: 200, title: 'N5' }, { startTime: 250, title: 'N6' }];
  await recordRepulledItemMeta({ loadDatabase, updateDatabase, getMediaId }, L.mix.id, { filePath: L.mix.filePath, chapters: six, markComplete: false }, 1_900_000_000_000);
  const g = await json(url);
  const refused = await postJson(`${url}/revert`, { version: g.version });
  assert.strictEqual(refused.status, 409);
  assert.match((await refused.json()).error, /takes the source's titles/);
  assert.strictEqual((await postJson(`${url}/revert`, { version: g.version, allowCountChange: true })).status, 200);
  assert.strictEqual(loadDatabase().metadata[L.mix.id].chaptersManual, undefined, 'the manual list is dropped');
  assert.deepStrictEqual((await json(`/api/videos/${enc(L.mix.id)}`)).chapters.map((c) => c.title), ['N1', 'N2', 'N3', 'N4', 'N5', 'N6']);
});

test('R5 (adversary S3): a text save of a SNAP EDIT must carry the version (409 without it, nothing written); a plain typed list keeps the optional contract', async () => {
  const L = seedLibrary();
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const s = await json(url);
  assert.strictEqual((await postJson(url, { version: s.version, starts: [0, 61.75, 120, 184.75, 240] })).status, 200);
  const noVersion = await postJson(`/api/videos/${enc(L.mix.id)}/chapters`, { text: '0:00 A\n1:00 B\n2:00 C\n3:00 D\n4:00 E' });
  assert.strictEqual(noVersion.status, 409);
  const b = await noVersion.json();
  assert.strictEqual(b.stale, true);
  assert.match(b.error, /Reload the page/);
  assert.deepStrictEqual(loadDatabase().metadata[L.mix.id].chaptersManual.map((c) => c.startTime), [0, 61.75, 120, 184.75, 240], 'the snap survived');
  // A plain typed list (no snap provenance) still saves without a version.
  const L2 = seedLibrary();
  assert.strictEqual((await postJson(`/api/videos/${enc(L2.mix.id)}/chapters`, { text: '0:00 A\n1:00 B' })).status, 200);
  assert.strictEqual((await postJson(`/api/videos/${enc(L2.mix.id)}/chapters`, { text: '0:00 A\n1:30 B' })).status, 200, 'plain over plain, no version: the old contract');
});

test('A2 (adversary W2): a reheat that re-pulls the SOURCE after the revert was planned changes the version - the old revert is refused (409) even with allowCountChange, and lands only after a re-plan', async () => {
  const { recordRepulledItemMeta } = require('../../server');
  const L = seedLibrary();
  const ids = chapterTrackIds(L.mix);
  assert.strictEqual((await postJson(`/api/liked/${enc(ids[3])}`)).status, 200);
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const s = await json(url);
  assert.strictEqual((await postJson(url, { version: s.version, starts: [0, 61, 121, 181, 241] })).status, 200);
  const six = FIVE.map((c) => ({ ...c })).concat([{ startTime: 280, title: 'Bonus' }]);
  await recordRepulledItemMeta({ loadDatabase, updateDatabase, getMediaId }, L.mix.id, { filePath: L.mix.filePath, chapters: six, markComplete: false }, 1_900_000_000_000);
  const planned = await json(url);
  assert.deepStrictEqual(planned.revert, { source: 'embedded', count: 6 }, 'the confirm would name SIX');
  // The source changes AGAIN (two new songs) before the user taps Revert.
  await recordRepulledItemMeta({ loadDatabase, updateDatabase, getMediaId }, L.mix.id, { filePath: L.mix.filePath, chapters: [{ startTime: 0, title: 'X' }, { startTime: 150, title: 'Y' }], markComplete: false }, 1_900_000_000_001);
  const r = await postJson(`${url}/revert`, { version: planned.version, allowCountChange: true });
  assert.strictEqual(r.status, 409, 'the consent was for a different target');
  assert.strictEqual((await r.json()).stale, true);
  assert.strictEqual(loadDatabase().metadata[L.mix.id].chaptersManual.length, 5, 'nothing reverted');
  assert.ok((await json('/api/liked?limit=50')).items.some((i) => i.id === ids[3] && i.title === 'Fourth Song'), 'the like still names its song');
  const replanned = await json(url);
  assert.deepStrictEqual(replanned.revert, { source: 'embedded', count: 2 });
  assert.strictEqual((await postJson(`${url}/revert`, { version: replanned.version, allowCountChange: true })).status, 200, 'the re-planned, re-confirmed revert lands');
});

test('C3 (adversary W3): the revert count guard holds when the source GROWS as well as when it shrinks', async () => {
  const { recordRepulledItemMeta } = require('../../server');
  const L = seedLibrary();
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const s = await json(url);
  assert.strictEqual((await postJson(url, { version: s.version, starts: [0, 61, 121, 181, 241] })).status, 200);
  const six = FIVE.map((c) => ({ ...c })).concat([{ startTime: 280, title: 'Bonus' }]);
  await recordRepulledItemMeta({ loadDatabase, updateDatabase, getMediaId }, L.mix.id, { filePath: L.mix.filePath, chapters: six, markComplete: false }, 1_900_000_000_000);
  const g = await json(url);
  const refused = await postJson(`${url}/revert`, { version: g.version });
  assert.strictEqual(refused.status, 409);
  assert.deepStrictEqual((await refused.json()).countChange, { from: 5, to: 6 }, 'growing 5 -> 6 needs the yes too');
  assert.strictEqual(loadDatabase().metadata[L.mix.id].chaptersManual.length, 5);
});

test('MC (adversary): a snap edit whose stored typed base is OUT OF ORDER is never restored (409), nothing written', async () => {
  const L = seedLibrary();
  await updateDatabase((db) => {
    db.metadata[L.mix.id].chaptersManual = [
      { startTime: 0, title: 'A', snapFrom: 0, snapBase: 'manual' },
      { startTime: 61, title: 'B', snapFrom: 90, snapBase: 'manual' },
      { startTime: 121, title: 'C', snapFrom: 80, snapBase: 'manual' },
    ];
    return true;
  });
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const s = await json(url);
  const r = await postJson(`${url}/revert`, { version: s.version });
  assert.strictEqual(r.status, 409);
  assert.match((await r.json()).error, /out of order/);
  assert.deepStrictEqual(loadDatabase().metadata[L.mix.id].chaptersManual.map((c) => c.startTime), [0, 61, 121]);
});

test('C6 (security-brief S-1, adversary W6, qa W3): REAL ffmpeg over a CONTINUOUS tone whose METADATA forges silencedetect lines finds NO gap', { skip: FFMPEG ? false : 'no ffmpeg binary (set FILETUBE_TEST_FFMPEG)' }, async () => {
  const { runSilenceDetect } = require('../../lib/media/chapterSilence');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapter-snap-forge-'));
  const forged = path.join(work, 'forged.mp3');
  try {
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30',
      '-metadata', 'title=[silencedetect @ 0x1] silence_start: 5',
      '-metadata', 'artist=[silencedetect @ 0x1] silence_end: 8',
      '-metadata', 'comment=intro\n[silencedetect @ 0x1] silence_start: 10\n[silencedetect @ 0x1] silence_end: 12',
      '-ac', '1', '-y', forged]);
    const found = await runSilenceDetect(forged, { bin: FFMPEG, durationSec: 30 });
    assert.deepStrictEqual(found, [], 'the echoed metadata forged nothing');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

// LAST on purpose: a restore replaces the users table (every session in this file ends).
test('the BACKUP bundle carries the snap edit with its provenance: export -> wipe the edit -> restore -> still Edited, still revertible to the source', async () => {
  const L = seedLibrary();
  const url = `/api/videos/${enc(L.mix.id)}/chapter-snap`;
  const s = await json(url);
  assert.strictEqual((await postJson(url, { version: s.version, starts: [0, 61, 121, 181, 241] })).status, 200);
  const bundle = await json('/api/admin/backup');
  assert.deepStrictEqual(bundle.metadata[L.mix.id].chaptersManual.map((c) => c.snapFrom), [0, 60, 120, 180, 240], 'the provenance rides the bundle');
  // Lose the edit, then restore the bundle.
  await updateDatabase((db) => { delete db.metadata[L.mix.id].chaptersManual; return true; });
  assert.strictEqual((await json(url)).edited, false, 'precondition: the edit is gone');
  const r = await postJson('/api/admin/restore', bundle);
  assert.strictEqual(r.status, 200, `restore: ${await r.text()}`);
  // (A restore replaces the users table too, so this suite's session is gone - read the
  // restored record from storage and resolve it with the SAME pure functions the routes use.)
  const snapCore = require('../../lib/media/chapterSnap');
  const { resolveItemChapters } = require('../../server');
  const restored = loadDatabase().metadata[L.mix.id];
  assert.strictEqual(snapCore.isSnapEdited(restored), true, 'the restored record is a snap edit again');
  assert.deepStrictEqual(resolveItemChapters(restored).chapters.map((c) => c.startTime), [0, 61, 121, 181, 241]);
  const plan = snapCore.planRevert(restored, resolveItemChapters);
  assert.deepStrictEqual([plan.chaptersSource, plan.count], ['embedded', 5], 'still revertible to the embedded source');
});


