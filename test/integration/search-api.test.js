'use strict';

// [INTEGRATION] Wave B - GET /api/search against the real app. Seeds all media
// namespaces (video/audio/metadata, music, podcasts show+episode, tv, books)
// and proves: a blended ranked stream with a resultType per item; the type=
// chip filter; pagination (total = full ranked length, page = slice); empty q
// -> []; and the blended-relevance ranking (an exact-title match leads). RBAC
// leak (a restricted member sees nothing) is proven in rbac-census.test.js.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-searchapi-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, updateDatabase } = require('../../server');
const musicStore = require('../../lib/music/store');
const podcastStore = require('../../lib/podcasts/store');
const booksStore = require('../../lib/books/store');
const tvStore = require('../../lib/tv/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth;
const subId = 'd'.repeat(32);

async function json(p) { return (await fetch(`${base}${p}`)).json(); }

before(async () => {
  for (const f of ['zw.mp4', 'za.mp3', 'zt.flac', 'zb.epub']) fs.writeFileSync(path.join(DATA_DIR, f), 'x');
  const showDir = path.join(DATA_DIR, 'podcasts', 'ZCast'); fs.mkdirSync(showDir, { recursive: true });
  fs.writeFileSync(path.join(showDir, 'ep.mp3'), 'E');

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);

  saveDatabase({
    folders: [DATA_DIR], folderSettings: {}, progress: {},
    metadata: {
      vzw: { id: 'vzw', title: 'Zephyr Winds', filePath: path.join(DATA_DIR, 'zw.mp4'), folderName: 'F', rootFolder: DATA_DIR, type: 'video', ext: '.mp4', duration: 10, size: 1, addedAt: 100, youtubeId: 'dQw4w9WgXcQ' },
      vother: { id: 'vother', title: 'Unrelated Clip', filePath: path.join(DATA_DIR, 'zw.mp4'), folderName: 'F', rootFolder: DATA_DIR, type: 'video', ext: '.mp4', duration: 5, size: 1, addedAt: 99 },
      aza: { id: 'aza', title: 'Zephyr Audio Log', filePath: path.join(DATA_DIR, 'za.mp3'), folderName: 'F', rootFolder: DATA_DIR, type: 'audio', ext: '.mp3', duration: 8, size: 1, addedAt: 98 },
    },
    liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
  await updateDatabase((db) => {
    musicStore.ensureMusic(db).tracks = {
      tz: { id: 'tz', title: 'Zephyr', artist: 'Band', album: 'Al', filePath: path.join(DATA_DIR, 'zt.flac'), rootFolder: DATA_DIR, folderName: 'F', ext: '.flac', codec: 'flac', durationSec: 3, albumArtKey: null, addedAt: '2026-01-01T00:00:00Z' },
    };
    const p = podcastStore.ensurePodcasts(db); p.subscriptions = []; p.episodes = {};
    podcastStore.reduceAddSubscription(p, { id: subId, name: 'Zephyr Cast', feedUrl: 'https://e.com/f.xml' });
    const epId = podcastStore.episodeIdFor(subId, 'g1');
    podcastStore.reduceUpsertEpisodes(p, subId, [{ guid: 'g1', title: 'Zephyr Episode One', pubDateMs: 500, durationSec: 1 }], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(p, epId, { fileName: 'ep.mp3', filePath: path.join(DATA_DIR, 'podcasts', 'ZCast', 'ep.mp3'), bytes: 1, nowMs: 6000 });
    tvStore.ensureTv(db).episodes = {
      tve: { id: 'tve', showId: 'shZ', showName: 'Zephyr Chronicles', title: 'The Storm', seasonNum: 1, episodeNum: 1, filePath: path.join(DATA_DIR, 'zt.flac'), rootFolder: DATA_DIR, ext: '.mp4', codec: 'h264', durationSec: 20, addedAt: 200 },
    };
    booksStore.ensureBooks(db).items = {
      bz: { id: 'bz', title: 'Zephyr', author: 'Writer', filePath: path.join(DATA_DIR, 'zb.epub'), folderName: 'F', format: 'epub', addedAt: 50 },
    };
    return true;
  });
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('GET /api/search blends every media type into one stream, each item carrying a resultType', async () => {
  const res = await json('/api/search?q=zephyr&limit=50');
  assert.ok(Array.isArray(res.items), 'items array');
  assert.strictEqual(res.type, 'all');
  assert.strictEqual(res.query, 'zephyr');
  const types = new Set(res.items.map((i) => i.resultType));
  for (const t of ['video', 'audio', 'music', 'podcast-show', 'podcast-episode', 'tv-show', 'tv-episode', 'book']) {
    assert.ok(types.has(t), `resultType '${t}' present (saw ${[...types]})`);
  }
  // the unrelated video is NOT matched
  assert.ok(!res.items.some((i) => i.id === 'vother'), 'non-matching item excluded');
});

test('blended ranking: an exact-title match (music/book "Zephyr") leads; music outranks book on the type tiebreak', async () => {
  const { items } = await json('/api/search?q=zephyr&limit=50');
  assert.strictEqual(items[0].resultType, 'music', `exact-title music first, got ${items[0].resultType} (${items[0].id})`);
  const musicIdx = items.findIndex((i) => i.id === 'tz');
  const bookIdx = items.findIndex((i) => i.id === 'bz');
  const videoIdx = items.findIndex((i) => i.id === 'vzw');
  assert.ok(musicIdx < bookIdx, 'exact music before exact book (type tiebreak)');
  assert.ok(bookIdx < videoIdx, 'both exact-title (tier 0) before the prefix-title video (tier 1)');
});

test('type= chip filter narrows to one content type', async () => {
  const music = await json('/api/search?q=zephyr&type=music&limit=50');
  assert.ok(music.items.length >= 1 && music.items.every((i) => i.resultType === 'music'), 'music chip -> only music');
  assert.strictEqual(music.type, 'music');
  const shows = await json('/api/search?q=zephyr&type=shows&limit=50');
  const showTypes = new Set(shows.items.map((i) => i.resultType));
  assert.ok(showTypes.has('tv-show') && showTypes.has('tv-episode'), 'shows chip -> both TV granularities');
  assert.ok(![...showTypes].some((t) => t === 'music' || t === 'book'), 'and nothing else');
});

test('an unknown type= falls back to all (never a silent empty)', async () => {
  const res = await json('/api/search?q=zephyr&type=bogus&limit=50');
  assert.strictEqual(res.type, 'all');
  assert.ok(res.items.length > 1);
});

test('pagination: total is the full ranked length; page = slice(offset, offset+limit); no drops/dupes across pages', async () => {
  const full = await json('/api/search?q=zephyr&limit=50');
  const total = full.total;
  assert.strictEqual(full.items.length, total, 'unpaged returns everything');
  const p1 = await json('/api/search?q=zephyr&limit=3&offset=0');
  const p2 = await json('/api/search?q=zephyr&limit=3&offset=3');
  assert.strictEqual(p1.total, total, 'total stable across pages');
  assert.strictEqual(p1.items.length, 3, 'first page full');
  const ids = new Set([...p1.items, ...p2.items].map((i) => i.id));
  assert.strictEqual(ids.size, p1.items.length + p2.items.length, 'no dupes across page boundary');
  // the two pages together equal the head of the full ranked list
  assert.deepStrictEqual([...p1.items, ...p2.items].map((i) => i.id), full.items.slice(0, 6).map((i) => i.id),
    'paged order == the full ranked order sliced');
});

test('empty query -> [] with total 0 (no full-library dump)', async () => {
  for (const q of ['', '   ']) {
    const res = await json(`/api/search?q=${encodeURIComponent(q)}`);
    assert.deepStrictEqual(res.items, [], `q=${JSON.stringify(q)} items empty`);
    assert.strictEqual(res.total, 0);
  }
});

test('a matching video carries its shareable watchUrl exactly when a safe youtubeId exists; an item without one has no key', async () => {
  const { items } = await json('/api/search?q=zephyr&limit=50');
  const vzw = items.find((i) => i.id === 'vzw'); // video WITH youtubeId
  assert.strictEqual(vzw.watchUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'watchUrl derived like /api/videos');
  const aza = items.find((i) => i.id === 'aza'); // audio, NO youtubeId
  assert.ok(aza, 'the audio item is in the unfiltered stream');
  assert.ok(!('watchUrl' in aza), 'no youtubeId -> the watchUrl key is absent (C4)');
});
