'use strict';

// [INTEGRATION] v1.381.0 Feed, TikTok style (plan D10): scripts/feed-stale-continue.js - the read-only report of WHY
// items show as "Continue" - reads the REAL persisted shape. Each suspected cause is driven through the real routes:
//   - a brief look on the watch page (the player's own ping, 10 s of a 10-minute video): Continue, under a minute, not the feed;
//   - an episode paused after 3 s (POST /api/podcasts/progress): Continue - podcasts have no floor, any position counts;
//   - a book the reader opened at its first chapter (the reader's ping), then moved on by a FEED card (served in a session,
//     the feed's forward-only write): Continue, first chapter, moved by a feed session (its record's `moves`);
//   - a video moved by a feed card from 100 s to 130 s: Continue, 1-5 min, moved by the feed.
// Then the script runs as a child process on the server's own database file and its summary lines are asserted, and the
// database is checked unchanged by it (read-only).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-stalecont-'));
process.env.PROGRESS_FLUSH_MS = '50';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const {
  app, __mintTestSession, updateDatabase, scanBooks, flushPendingBookProgress, flushPendingProgress, booksDb, podcastsDb, userStore,
} = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { buildEpub } = require('../helpers/build-zip');
const podcastStore = require('../../lib/podcasts/store');

let server, base, uid, booksDir, epubId, epId;
const subId = 'd'.repeat(32);
const CHAPTER = (n) => `<h1>Chapter ${n}</h1>` + Array.from({ length: 12 }, (_, i) => `<p>Chapter ${n} paragraph ${i} has a handful of words to read in the feed.</p>`).join('');

before(async () => {
  booksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-stalecont-lib-'));
  fs.writeFileSync(path.join(booksDir, 'novel.epub'), buildEpub({ title: 'Novel', author: 'Writer', chapters: [CHAPTER(1), CHAPTER(2), CHAPTER(3)] }));
  await updateDatabase(() => booksDb.mutate((db) => { require('../../lib/books/store').ensureBooks(db).folders = [booksDir]; return true; }));
  await scanBooks();
  epubId = Object.values(booksDb.read().items)[0].id;
  const D = process.env.DATA_DIR;
  const item = (id) => ({ id, title: id, filePath: path.join(D, `${id}.mp4`), folderName: 'F', rootFolder: D, type: 'video', ext: '.mp4', duration: 600, size: 1, addedAt: 1 });
  // vu1 / vu2 / vc: the r1 mix test's videos (no place for the first test's user)
  for (const id of ['vlook', 'vfeed', 'vu1', 'vu2', 'vc']) fs.writeFileSync(path.join(D, `${id}.mp4`), 'V');
  seedState({ folders: [D], folderSettings: {}, metadata: { vlook: item('vlook'), vfeed: item('vfeed'), vu1: item('vu1'), vu2: item('vu2'), vc: item('vc') }, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  const showDir = path.join(D, 'podcasts', 'Show'); fs.mkdirSync(showDir, { recursive: true });
  fs.writeFileSync(path.join(showDir, 'ep.mp3'), 'E');
  epId = podcastStore.episodeIdFor(subId, 'g1');
  await updateDatabase(() => podcastsDb.mutate((h) => {
    const p = podcastStore.ensurePodcasts(h); p.subscriptions = []; p.episodes = {};
    podcastStore.reduceAddSubscription(p, { id: subId, name: 'Show', feedUrl: 'https://e.com/f.xml' });
    podcastStore.reduceUpsertEpisodes(p, subId, [{ guid: 'g1', title: 'Ep', pubDateMs: 1, durationSec: 1800 }, { guid: 'g2', title: 'Ep2', pubDateMs: 2, durationSec: 1800 }, { guid: 'g3', title: 'Ep3', pubDateMs: 3, durationSec: 1800 }], 'pending', 5000);
    for (const g of ['g1', 'g2', 'g3']) {
      fs.writeFileSync(path.join(showDir, `${g}.mp3`), 'E');
      podcastStore.reduceEpisodeDownloaded(p, podcastStore.episodeIdFor(subId, g), { fileName: `${g}.mp3`, filePath: path.join(showDir, `${g}.mp3`), bytes: 1, nowMs: 6000 });
    }
    return true;
  }));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  uid = authenticateFetch(server, base).user.id;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(booksDir, { recursive: true, force: true });
});

const postJson = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('D10: the report sorts each Continue item by how far in it is and whether a feed session moved it, from the real stored shapes, read-only', async () => {
  // a brief look on the watch page: the player's ping at 10 s
  assert.strictEqual((await postJson('/api/progress', { id: 'vlook', timestamp: 10, duration: 600 })).status, 200);
  // an episode paused after 3 s
  assert.strictEqual((await postJson('/api/podcasts/progress', { episodeId: epId, position: 3, duration: 1800 })).status, 200);
  // the reader opened the book at its first chapter
  assert.strictEqual((await postJson(`/api/books/${epubId}/progress`, { locator: { kind: 'epub', cfi: 'epubcfi(/6/2!/4/4/1:0)', spineIndex: 0, blockIndex: 1 }, percent: 2 })).status, 200);
  await flushPendingBookProgress();
  // vfeed is in progress at 100 s, then a feed session serves it and the book, and moves both
  userStore.setProgress(uid, 'vfeed', { timestamp: 100, duration: 600, updatedAt: new Date().toISOString() });
  const s = await (await postJson('/api/feed/sessions', { plannedMin: 10 })).json();
  const seen = new Set();
  for (let i = 0; i < 6 && !(seen.has('vfeed') && seen.has(epubId)); i++) {
    const b = await (await fetch(`${base}/api/feed?session=${s.session.id}&count=5`)).json();
    for (const c of b.cards) seen.add(c.id);
  }
  assert.ok(seen.has('vfeed') && seen.has(epubId), 'both served in the session: ' + Array.from(seen).join(','));
  assert.strictEqual((await postJson('/api/feed/progress/media', { id: 'vfeed', timestamp: 130, duration: 600 })).status, 200);
  assert.strictEqual((await postJson(`/api/feed/progress/book/${epubId}`, { spineIndex: 0, blockIndex: 4 })).status, 200);
  await flushPendingProgress();
  await flushPendingBookProgress();

  const dbFile = path.join(process.env.DATA_DIR, 'filetube.db');
  const before = fs.readFileSync(dbFile);
  const out = execFileSync(process.execPath, [path.join(__dirname, '../../scripts/feed-stale-continue.js'), dbFile, '--items'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.ok(fs.readFileSync(dbFile).equals(before), 'the database file is byte-identical after the report');
  const lines = out.split('\n');
  const line = (kind) => lines.find((l) => l.trim().startsWith(kind + ' ')) || '';
  assert.match(line('video'), /Continue 2 {2}moved by a feed session 1 {2}\{"under 1 min":1,"1-5 min":1\}|Continue 2 {2}moved by a feed session 1 {2}\{"1-5 min":1,"under 1 min":1\}/);
  assert.match(line('podcast'), /Continue 1 {2}moved by a feed session 0 {2}\{"under 1 min":1\}/);
  assert.match(line('book'), /Continue 1 {2}moved by a feed session 1 {2}\{"first chapter or front matter":1\}/);
  assert.ok(lines.some((l) => / video vfeed 1-5 min 130 s .*FEED$/.test(l)), 'the feed-moved video is marked FEED');
  assert.ok(lines.some((l) => / video vlook under 1 min 10 s 1\.7%$/.test(l)), 'the watch-page look is not');
  assert.match(out, /SUMMARY stale-continue: 1 users, read-only/);
});

test('D10 (Dean\'s ruling 2026-10-09): in the Feed an item with less than a minute played is New; a minute or more is Continue; no stored place changes', async () => {
  const { startedUnderAMinute } = require('../../lib/feed/api');
  assert.strictEqual(startedUnderAMinute(10, 1200), true);
  assert.strictEqual(startedUnderAMinute(59.9, 1200), true);
  assert.strictEqual(startedUnderAMinute(60, 1200), false);
  assert.strictEqual(startedUnderAMinute(0, 1200), false, 'no place at all is the other arm (fresh anyway)');
  assert.strictEqual(startedUnderAMinute(31, 40), true, 'a 40 s clip: 80% of it (32 s) is its minute - 31 s is under it');
  assert.strictEqual(startedUnderAMinute(32, 40), false);
  const before = { vlook: userStore.getProgress(uid).vlook, pod: userStore.getOnePodcastProgress(uid, epId) };
  const s = await (await postJson('/api/feed/sessions', { plannedMin: 10 })).json();
  const cards = new Map();
  for (let i = 0; i < 6 && !(cards.has('vlook') && cards.has(epId) && cards.has('vfeed')); i++) {
    const b = await (await fetch(`${base}/api/feed?session=${s.session.id}&count=5`)).json();
    for (const c of b.cards) cards.set(c.id, c);
  }
  assert.strictEqual(cards.get('vlook').fresh, true, 'a 10 s look on the watch page is New (it was Continue: 1.7% is above the 0.5% floor)');
  assert.strictEqual(cards.get('vlook').startAt, 10, 'and it still resumes from its place');
  assert.strictEqual(cards.get(epId).fresh, true, 'an episode paused at 3 s is New (episodes had no floor)');
  assert.strictEqual(cards.get(epId).startAt, 3);
  assert.strictEqual(cards.get('vfeed').fresh, false, '130 s in is Continue');
  assert.deepStrictEqual({ vlook: userStore.getProgress(uid).vlook, pod: userStore.getOnePodcastProgress(uid, epId) }, before, 'labels only: nothing stored moved');
  // a fresh card still writes nothing before its minute (the v1.380.0 rule applies to it now)
  const early = await postJson('/api/feed/progress/podcast', { episodeId: epId, position: 20, duration: 1800, playedSec: 17 });
  assert.strictEqual(early.status, 409);
  assert.strictEqual((await early.json()).reason, 'too-early');
});

test('r1 (adversary W3 A14-A16): the mix counts under-a-minute items as NEW - the first card of a kind is the real Continue item, not a newer peek', async () => {
  const now = Date.now();
  const at = (ms) => new Date(now - ms).toISOString();
  const ep = (g) => podcastStore.episodeIdFor(subId, g);
  const firstOf = async (cookie, pred) => {
    const sr = await fetch(`${base}/api/feed/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ plannedMin: 10 }) });
    const sid = (await sr.json()).session.id;
    for (let i = 0; i < 6; i++) {
      const b = await (await fetch(`${base}/api/feed?session=${sid}&count=5`, { headers: { Cookie: cookie } })).json();
      const c = b.cards.find(pred);
      if (c) return c;
    }
    return null;
  };
  // videos: two peeks (10 s), NEWER than one real place (200 s)
  const v = __mintTestSession({ username: 'mix-video', role: 'admin' });
  userStore.setProgress(v.user.id, 'vu1', { timestamp: 10, duration: 600, updatedAt: at(1000) });
  userStore.setProgress(v.user.id, 'vu2', { timestamp: 10, duration: 600, updatedAt: at(2000) });
  userStore.setProgress(v.user.id, 'vc', { timestamp: 200, duration: 600, updatedAt: at(9000) });
  const fv = await firstOf(v.cookie, (c) => c.kind === 'video');
  assert.deepStrictEqual({ id: fv.id, fresh: fv.fresh }, { id: 'vc', fresh: false }, 'video');
  // episodes: the same
  const pu = __mintTestSession({ username: 'mix-podcast', role: 'admin' });
  userStore.setPodcastProgress(pu.user.id, ep('g2'), { position: 5, duration: 1800, updatedAt: at(1000) });
  userStore.setPodcastProgress(pu.user.id, ep('g3'), { position: 5, duration: 1800, updatedAt: at(2000) });
  userStore.setPodcastProgress(pu.user.id, ep('g1'), { position: 300, duration: 1800, updatedAt: at(9000) });
  const fp = await firstOf(pu.cookie, (c) => c.kind === 'podcast');
  assert.deepStrictEqual({ id: fp.id, fresh: fp.fresh }, { id: ep('g1'), fresh: false }, 'podcast');
  // Watch later episodes: the list's own order puts the peeks first; the first Watch later card is the real place
  const w = __mintTestSession({ username: 'mix-wl', role: 'admin' });
  for (const g of ['g2', 'g3', 'g1']) userStore.addWatchLater(w.user.id, userStore.watchLaterKey('podcast', ep(g)), at(1000));
  userStore.setPodcastProgress(w.user.id, ep('g2'), { position: 5, duration: 1800, updatedAt: at(1000) });
  userStore.setPodcastProgress(w.user.id, ep('g3'), { position: 5, duration: 1800, updatedAt: at(2000) });
  userStore.setPodcastProgress(w.user.id, ep('g1'), { position: 300, duration: 1800, updatedAt: at(9000) });
  const fw = await firstOf(w.cookie, (c) => c.kind === 'watchlater');
  assert.ok(fw, 'a Watch later card');
  assert.strictEqual(fw.fresh, false, 'Watch later: ' + fw.id);
});
