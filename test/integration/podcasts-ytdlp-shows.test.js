'use strict';

// [INTEGRATION] v1.69.0 T9 (D15) - a ytdlp subscription toggled
// libraryPlace='podcasts' surfaces in the Podcasts place as a show whose
// episodes are its channel dir's db.metadata items (watch-page playback,
// watch-history state). ytdlp module ENABLED for this suite.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-podyt-'));
process.env.FILETUBE_YTDLP_ENABLED = 'true';
process.env.FILETUBE_YTDLP_POLL_MINUTES = '0';
const DOWNLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-podyt-dl-'));
process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { app, updateDatabase, userStore } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, user;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  ({ user } = authenticateFetch(server, base));
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const get = (p) => fetch(`${base}${p}`);
const patchJson = (p, body) => fetch(`${base}${p}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const SUB_ID = 'ffffffffffffffffffffffffffff0001';
const CHANNEL_NAME = 'Pod Channel';
let itemNew, itemOld;

function seedMediaItem(fileName, releaseDate) {
  const dir = path.join(DOWNLOAD_DIR, CHANNEL_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, 'AUDIOBYTES');
  const id = crypto.createHash('md5').update(filePath).digest('hex');
  return { id, filePath, title: fileName.replace(/\.mp3$/, ''), name: fileName, type: 'audio', duration: 1800, releaseDate };
}

test('seed: a toggled ytdlp sub + two channel-dir media items', async () => {
  itemNew = seedMediaItem('Episode Two [abcdefghij2].mp3', Date.UTC(2026, 7, 2));
  itemOld = seedMediaItem('Episode One [abcdefghij1].mp3', Date.UTC(2026, 6, 1));
  await updateDatabase((db) => {
    db.ytdlp = db.ytdlp || {};
    db.ytdlp.subscriptions = [{
      id: SUB_ID, channelUrl: 'https://www.youtube.com/@podchannel', name: CHANNEL_NAME,
      format: 'audio', quality: 'best', paused: false, skipShorts: false, order: 1,
      addedAt: '2026-08-01T00:00:00.000Z', lastCheckedAt: null, lastStatus: 'ok', libraryPlace: 'default',
    }];
    db.metadata = db.metadata || {};
    db.metadata[itemNew.id] = itemNew;
    db.metadata[itemOld.id] = itemOld;
    return true;
  });
});

test('libraryPlace=default: the sub is NOT a podcast show, health counts zero', async () => {
  const health = await (await get('/api/podcasts/health')).json();
  assert.strictEqual(health.shows, 0);
  const shows = await (await get('/api/podcasts/shows')).json();
  assert.deepStrictEqual(shows.shows, []);
});

test('PATCH libraryPlace=podcasts via the ytdlp route; the show + episodes surface', async () => {
  const r = await patchJson(`/api/subscriptions/${SUB_ID}`, { libraryPlace: 'podcasts' });
  assert.strictEqual(r.status, 200, await r.text());

  const health = await (await get('/api/podcasts/health')).json();
  assert.strictEqual(health.shows, 1, 'the nav gate counts the toggled sub');

  const shows = (await (await get('/api/podcasts/shows')).json()).shows;
  assert.strictEqual(shows.length, 1);
  const show = shows[0];
  assert.strictEqual(show.id, `yt:${SUB_ID}`);
  assert.strictEqual(show.name, CHANNEL_NAME);
  assert.strictEqual(show.source, 'ytdlp');
  assert.strictEqual(show.episodeCount, 2);
  assert.strictEqual(show.artUrl, `/thumbnail/${itemNew.id}`, 'art = the newest item\'s thumbnail');

  const data = await (await get(`/api/podcasts/shows/yt:${SUB_ID}/episodes`)).json();
  assert.deepStrictEqual(data.episodes.map((e) => e.title), ['Episode Two', 'Episode One'], 'newest-first, bracket stripped');
  const ep = data.episodes[0];
  assert.strictEqual(ep.status, 'downloaded');
  assert.strictEqual(ep.watchHref, `/watch.html?v=${itemNew.id}`, 'media items keep watch-page playback');
  assert.strictEqual(ep.played, false);
  assert.strictEqual(ep.progress, null);
});

test('watch-history state rides the projection (progress + watched latch)', async () => {
  userStore.setProgress(user.id, itemNew.id, { timestamp: 600, duration: 1800, updatedAt: '2026-08-02T10:00:00.000Z' });
  userStore.markWatched(user.id, itemOld.id, '2026-08-01T10:00:00.000Z');
  const data = await (await get(`/api/podcasts/shows/yt:${SUB_ID}/episodes`)).json();
  const [epNew, epOld] = data.episodes;
  assert.strictEqual(epNew.progress.position, 600, 'user_progress surfaces as episode progress');
  assert.strictEqual(epOld.played, true, 'user_watched surfaces as played');
});

test('invalid patch values 400; unknown yt: show 404s on episodes', async () => {
  assert.strictEqual((await patchJson(`/api/subscriptions/${SUB_ID}`, { libraryPlace: 'attic' })).status, 400);
  assert.strictEqual((await get('/api/podcasts/shows/yt:ffffffffffffffffffffffffffff9999/episodes')).status, 404);
});

test('toggling back to default removes the show from the place', async () => {
  assert.strictEqual((await patchJson(`/api/subscriptions/${SUB_ID}`, { libraryPlace: 'default' })).status, 200);
  const shows = (await (await get('/api/podcasts/shows')).json()).shows;
  assert.deepStrictEqual(shows, []);
  assert.strictEqual((await (await get('/api/podcasts/health')).json()).shows, 0);
});
