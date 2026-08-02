'use strict';

// [INTEGRATION] v1.69.0 T7 - the podcasts routes against the REAL app.
// Seeds db.podcasts directly (the music-config test pattern; the poll
// pipeline is covered in test/unit/podcasts-poll.test.js with injected
// transports). Feed URLs use the .invalid TLD so any background poll a route
// legitimately fires fails CLOSED at DNS (hostResolvesPublic) - no network.
// Binds: the token-never-in-db/API guarantee, secret-file lifecycle (0600,
// delete-on-unsubscribe), the feed-url re-entry lane, per-user progress +
// the 95% auto-latch, played toggling, streaming with Range, and the
// zero-subscription no-op guarantee (no podcasts dir is ever created).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-podcastsapi-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase } = require('../../server');
const podcastStore = require('../../lib/podcasts/store');
const secrets = require('../../lib/podcasts/secrets');
const { authenticateFetch } = require('../helpers/auth');

const DATA_DIR = process.env.DATA_DIR;
const TOKEN = 'IntegrationSecretTok42';
const FEED_URL = `https://feeds.invalid/rss/myshow?auth=${TOKEN}&show=1234`;

let server, base;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const get = (p, opts) => fetch(`${base}${p}`, opts);
const postJson = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const patchJson = (p, body) => fetch(`${base}${p}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const del = (p) => fetch(`${base}${p}`, { method: 'DELETE' });

test('fresh install: health is zeroed and NO podcasts directory exists', async () => {
  const r = await get('/api/podcasts/health');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { shows: 0, episodes: 0 });
  assert.ok(!fs.existsSync(path.join(DATA_DIR, 'podcasts')), 'zero subscriptions = no dir, the no-op guarantee');
});

let subId;

test('POST subscription: 201; the token lands ONLY in the 0600 secrets file, never the db or the API', async () => {
  const r = await postJson('/api/podcasts/subscriptions', { feedUrl: FEED_URL, backfill: 'all' });
  assert.strictEqual(r.status, 201);
  const body = await r.json();
  subId = body.id;
  assert.match(subId, /^[0-9a-f]{32}$/);

  // The secrets file: exists, 0600, holds the full URL.
  const secretsPath = secrets.resolveSecretsPath(DATA_DIR);
  assert.ok(fs.existsSync(secretsPath));
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(secretsPath).mode & 0o777, 0o600);
  }
  assert.strictEqual(secrets.loadFeedSecrets(DATA_DIR)[subId], FEED_URL);

  // The DB and the list API: display form only, token nowhere.
  const list = await (await get('/api/podcasts/subscriptions')).json();
  assert.strictEqual(list.subscriptions.length, 1);
  const sub = list.subscriptions[0];
  assert.strictEqual(sub.feedUrlDisplay, 'https://feeds.invalid/rss/myshow');
  assert.ok(!JSON.stringify(list).includes(TOKEN), 'token never in an API response');
  const rawDb = fs.readFileSync(path.join(DATA_DIR, 'filetube.db'));
  assert.ok(!rawDb.includes(Buffer.from(TOKEN)), 'token never in the database FILE');

  // Idempotent re-add.
  const again = await postJson('/api/podcasts/subscriptions', { feedUrl: FEED_URL });
  assert.strictEqual(again.status, 200);
  assert.strictEqual((await again.json()).existed, true);
});

test('input rejection: bad URLs, private hosts, bad backfill - neutral errors, never echoing the input', async () => {
  for (const [body, wantStatus] of [
    [{ feedUrl: 'http://127.0.0.1/feed' }, 400],
    [{ feedUrl: 'file:///etc/passwd' }, 400],
    [{ feedUrl: 'https://ok.invalid/feed', backfill: 'sometimes' }, 400],
    [{}, 400],
  ]) {
    const r = await postJson('/api/podcasts/subscriptions', body);
    assert.strictEqual(r.status, wantStatus, JSON.stringify(body));
    const e = await r.json();
    if (body.feedUrl && body.feedUrl.length > 12) {
      assert.ok(!JSON.stringify(e).includes(body.feedUrl), 'no input echo');
    }
  }
});

test('PATCH: allowlisted fields only; unknown sub 404', async () => {
  assert.strictEqual((await patchJson(`/api/podcasts/subscriptions/${subId}`, { paused: true })).status, 200);
  assert.strictEqual((await patchJson(`/api/podcasts/subscriptions/${subId}`, { lastStatus: 'forged' })).status, 400);
  assert.strictEqual((await patchJson('/api/podcasts/subscriptions/ffffffffffffffffffffffffffffffff', { paused: true })).status, 404);
  const sub = (await (await get('/api/podcasts/subscriptions')).json()).subscriptions[0];
  assert.strictEqual(sub.paused, true);
  await patchJson(`/api/podcasts/subscriptions/${subId}`, { paused: false });
});

// Seed two episodes directly: one downloaded (real temp file), one pending.
let epDownloaded, epPending, mediaFile;

test('seeded episodes: list newest-first with per-user state; stream honors Range; pending is not streamable', async () => {
  const showDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-podshow-'));
  mediaFile = path.join(showDir, 'Ep Two [rss=g2].mp3');
  fs.writeFileSync(mediaFile, 'MP3BYTES-0123456789');
  epDownloaded = podcastStore.episodeIdFor(subId, 'g2');
  epPending = podcastStore.episodeIdFor(subId, 'g1');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    podcastStore.reduceUpsertEpisodes(ns, subId, [
      { guid: 'g1', title: 'Ep One', pubDateMs: 1000, durationSec: 100 },
      { guid: 'g2', title: 'Ep Two', pubDateMs: 2000, durationSec: 200 },
    ], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(ns, epDownloaded, { fileName: path.basename(mediaFile), filePath: mediaFile, bytes: 19, nowMs: 6000 });
    return true;
  });

  const r = await get(`/api/podcasts/shows/${subId}/episodes`);
  assert.strictEqual(r.status, 200);
  const data = await r.json();
  assert.deepStrictEqual(data.episodes.map((e) => e.title), ['Ep Two', 'Ep One'], 'newest-first');
  assert.strictEqual(data.episodes[0].status, 'downloaded');
  assert.strictEqual(data.episodes[0].played, false);
  assert.strictEqual(data.episodes[0].progress, null);
  assert.ok(!('filePath' in data.episodes[0]), 'server paths never leak to the client');

  const whole = await get(`/episode/${epDownloaded}`);
  assert.strictEqual(whole.status, 200);
  assert.strictEqual(await whole.text(), 'MP3BYTES-0123456789');

  const range = await get(`/episode/${epDownloaded}`, { headers: { Range: 'bytes=0-7' } });
  assert.strictEqual(range.status, 206);
  assert.strictEqual(await range.text(), 'MP3BYTES');

  assert.strictEqual((await get(`/episode/${epPending}`)).status, 404, 'a pending episode has no file to stream');
  assert.strictEqual((await get('/episode/ffffffffffffffffffffffffffffffff')).status, 404);
});

test('progress: phantom 400; real persists; >=95% auto-latches played; manual toggle both ways', async () => {
  assert.strictEqual((await postJson('/api/podcasts/progress', { episodeId: 'ffffffffffffffffffffffffffffffff', position: 5 })).status, 400);
  assert.strictEqual((await postJson('/api/podcasts/progress', { episodeId: epDownloaded, position: -3 })).status, 400);

  assert.strictEqual((await postJson('/api/podcasts/progress', { episodeId: epDownloaded, position: 50, duration: 200 })).status, 200);
  let data = await (await get(`/api/podcasts/shows/${subId}/episodes`)).json();
  assert.strictEqual(data.episodes[0].progress.position, 50);
  assert.strictEqual(data.episodes[0].played, false, '25% is not played');

  assert.strictEqual((await postJson('/api/podcasts/progress', { episodeId: epDownloaded, position: 195, duration: 200 })).status, 200);
  data = await (await get(`/api/podcasts/shows/${subId}/episodes`)).json();
  assert.strictEqual(data.episodes[0].played, true, '97.5% auto-latches');

  assert.strictEqual((await postJson(`/api/podcasts/episodes/${epDownloaded}/played`, { played: false })).status, 200);
  data = await (await get(`/api/podcasts/shows/${subId}/episodes`)).json();
  assert.strictEqual(data.episodes[0].played, false, 'manual unplay wins');
  assert.strictEqual((await postJson(`/api/podcasts/episodes/${epPending}/played`, { played: true })).status, 200);
  assert.strictEqual((await postJson('/api/podcasts/episodes/ffffffffffffffffffffffffffffffff/played', {})).status, 400, 'phantom id 400');
});

test('progress: the shared player controller\'s {id, timestamp} body shape and the read route both work', async () => {
  // saveProgressToServer (public/js/player.js) posts {id, timestamp, duration}
  // to every progressEndpoint - the podcasts route must accept it.
  assert.strictEqual((await postJson('/api/podcasts/progress', { id: epDownloaded, timestamp: 77, duration: 200 })).status, 200);
  const read = await (await get(`/api/podcasts/progress/${epDownloaded}`)).json();
  assert.strictEqual(read.position, 77, 'the player read route reflects the player write shape');
  const never = await (await get('/api/podcasts/progress/ffffffffffffffffffffffffffffffff')).json();
  assert.strictEqual(never.position, 0, 'a never-played episode reads 0, not an error (the player treats it as start-from-top)');
});

test('v1.69 gate fix (adversarial #4): the pretty /podcasts route gets the shell treatment (no-cache), same as /music', async () => {
  const pretty = await get('/podcasts');
  assert.strictEqual(pretty.status, 200);
  assert.strictEqual(pretty.headers.get('cache-control'), 'no-cache', 'the linked route rides the shell middleware');
  const music = await get('/music');
  assert.strictEqual(music.headers.get('cache-control'), 'no-cache', 'parity with the /music arm');
});

test('podcastart: SVG placeholder when no art exists', async () => {
  const r = await get(`/podcastart/${subId}`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /image\/svg\+xml/);
});

test('feed-url re-entry: a rotated token for the SAME feed is accepted; a different feed is refused', async () => {
  const rotated = 'https://feeds.invalid/rss/myshow?auth=NewRotatedTok777&show=1234';
  const r = await postJson(`/api/podcasts/subscriptions/${subId}/feed-url`, { feedUrl: rotated });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(secrets.loadFeedSecrets(DATA_DIR)[subId], rotated, 'secret replaced');

  const other = await postJson(`/api/podcasts/subscriptions/${subId}/feed-url`, { feedUrl: 'https://feeds.invalid/rss/DIFFERENT?auth=x' });
  assert.strictEqual(other.status, 400);
  assert.strictEqual((await postJson('/api/podcasts/subscriptions/ffffffffffffffffffffffffffffffff/feed-url', { feedUrl: rotated })).status, 404);
});

test('settings: pollMinutes round-trips with validation; downloadDir is reported', async () => {
  const before = await (await get('/api/podcasts/settings')).json();
  assert.strictEqual(before.pollMinutes, 60, 'the default');
  assert.ok(before.downloadDir.endsWith(path.join(path.basename(DATA_DIR), 'podcasts')) || before.downloadDir.includes('podcasts'));
  assert.strictEqual((await postJson('/api/podcasts/settings', { pollMinutes: 120 })).status, 200);
  assert.strictEqual((await (await get('/api/podcasts/settings')).json()).pollMinutes, 120);
  assert.strictEqual((await postJson('/api/podcasts/settings', { pollMinutes: -1 })).status, 400);
  assert.strictEqual((await postJson('/api/podcasts/settings', { pollMinutes: 1.5 })).status, 400);
  assert.strictEqual((await postJson('/api/podcasts/settings', {})).status, 400);
});

test('v1.70: delete -> trash -> restore round-trip; collisions and wrong states refuse; per-user state survives trash', async () => {
  // The seeded downloaded episode lives OUTSIDE the podcasts root (a temp
  // show dir) - move it inside first so computeTrashTarget confines
  // correctly under the real root.
  const root = path.join(DATA_DIR, 'podcasts');
  const showDir = path.join(root, 'RoundTrip Show');
  fs.mkdirSync(showDir, { recursive: true });
  const epFile = path.join(showDir, 'Trip [rss=t1].mp3');
  fs.writeFileSync(epFile, 'TRIPBYTES');
  const epId = podcastStore.episodeIdFor(subId, 't1');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    podcastStore.reduceUpsertEpisodes(ns, subId, [{ guid: 't1', title: 'Trip', pubDateMs: 3000, durationSec: 100 }], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(ns, epId, { fileName: path.basename(epFile), filePath: epFile, bytes: 9, nowMs: 6000 });
    return true;
  });
  // Per-user state before the trash trip.
  await postJson('/api/podcasts/progress', { episodeId: epId, position: 42, duration: 100 });

  // DELETE: file moves into <root>/.filetube-trash, record flips, row survives.
  const del = await fetch(`${base}/api/podcasts/episodes/${epId}`, { method: 'DELETE' });
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await del.json()).status, 'trashed');
  assert.ok(!fs.existsSync(epFile), 'the original path is empty');
  const trashDir = path.join(root, '.filetube-trash');
  const trashed = fs.readdirSync(trashDir).filter((f) => f.includes('Trip'));
  assert.strictEqual(trashed.length, 1, 'the bytes are IN the trash, recoverable');
  let data = await (await get(`/api/podcasts/shows/${subId}/episodes`)).json();
  let row = data.episodes.find((e) => e.id === epId);
  assert.strictEqual(row.status, 'trashed');
  assert.ok(Number.isFinite(row.trashedAt));
  assert.ok(!('trashPath' in row), 'server paths never leak');
  assert.strictEqual(row.progress.position, 42, 'per-user state SURVIVES the trash trip');

  // Wrong-state refusals + the streaming guard now being load-bearing.
  assert.strictEqual((await fetch(`${base}/api/podcasts/episodes/${epId}`, { method: 'DELETE' })).status, 400, 'double-delete refuses');
  assert.strictEqual((await get(`/episode/${epId}`)).status, 404, 'a trashed episode does not stream (the status guard is now load-bearing)');

  // Restore-collision: plant a file at the original path -> 409, trash intact.
  fs.writeFileSync(epFile, 'INTRUDER');
  const collide = await postJson(`/api/podcasts/episodes/${epId}/restore`, {});
  assert.strictEqual(collide.status, 409);
  assert.strictEqual(fs.readFileSync(epFile, 'utf8'), 'INTRUDER', 'never clobbers');
  assert.strictEqual(fs.readdirSync(trashDir).filter((f) => f.includes('Trip')).length, 1, 'trash untouched');
  fs.unlinkSync(epFile);

  // Clean restore: bytes return, record flips, progress intact.
  const restore = await postJson(`/api/podcasts/episodes/${epId}/restore`, {});
  assert.strictEqual(restore.status, 200);
  assert.strictEqual(fs.readFileSync(epFile, 'utf8'), 'TRIPBYTES', 'byte-identical bytes back at the original path');
  data = await (await get(`/api/podcasts/shows/${subId}/episodes`)).json();
  row = data.episodes.find((e) => e.id === epId);
  assert.strictEqual(row.status, 'downloaded');
  assert.strictEqual(row.progress.position, 42, 'resume position survives the whole round-trip');
  assert.strictEqual((await postJson(`/api/podcasts/episodes/${epId}/restore`, {})).status, 400, 'restoring a non-trashed episode refuses');

  // Vanished trash file: 410 + honest tombstone + per-user purge.
  const del2 = await fetch(`${base}/api/podcasts/episodes/${epId}`, { method: 'DELETE' });
  assert.strictEqual(del2.status, 200);
  for (const f of fs.readdirSync(trashDir)) fs.unlinkSync(path.join(trashDir, f));
  const gone = await postJson(`/api/podcasts/episodes/${epId}/restore`, {});
  assert.strictEqual(gone.status, 410);
  data = await (await get(`/api/podcasts/shows/${subId}/episodes`)).json();
  assert.strictEqual(data.episodes.find((e) => e.id === epId).status, 'tombstone');
  const { userStore } = require('../../server');
  const u = userStore.listUsers()[0];
  assert.strictEqual(userStore.getOnePodcastProgress(u.id, epId), null, 'purge retires the rows (trash kept them)');

  // Phantom + non-downloaded refusals.
  assert.strictEqual((await fetch(`${base}/api/podcasts/episodes/ffffffffffffffffffffffffffffffff`, { method: 'DELETE' })).status, 404);
});

test('the FOUR-way root guard: media/music/books configs all reject the podcasts root (both directions by shape)', async () => {
  const podcastsRoot = path.join(DATA_DIR, 'podcasts');
  const nested = path.join(podcastsRoot, 'Some Show');
  // The config routes silently drop NONEXISTENT folders before any guard
  // runs - the overlap rejection is only reachable for real directories.
  fs.mkdirSync(nested, { recursive: true });
  for (const [route, key] of [['/api/config', 'folders'], ['/api/music/config', 'folders'], ['/api/books/config', 'folders']]) {
    for (const target of [podcastsRoot, nested]) {
      const r = await postJson(route, { [key]: [target] });
      assert.strictEqual(r.status, 400, `${route} must reject ${target}`);
      const body = await r.json();
      assert.match(body.error, /podcasts folder/i, `${route}: ${body.error}`);
    }
  }
});

test('DELETE subscription: records + per-user rows + secret gone; the FILE stays on disk', async () => {
  const r = await del(`/api/podcasts/subscriptions/${subId}`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).filesKept, true);

  assert.deepStrictEqual(await (await get('/api/podcasts/health')).json(), { shows: 0, episodes: 0 });
  assert.strictEqual(secrets.loadFeedSecrets(DATA_DIR)[subId], undefined, 'secret deleted');
  assert.ok(fs.existsSync(mediaFile), 'the downloaded file SURVIVES unsubscribe');
  const { userStore } = require('../../server');
  const anyUser = userStore.listUsers()[0];
  assert.equal(userStore.getOnePodcastProgress(anyUser.id, epDownloaded), null, 'per-user rows purged');
  assert.deepStrictEqual({ ...userStore.getPodcastPlayed(anyUser.id) }, {}, 'played rows purged');

  assert.strictEqual((await del(`/api/podcasts/subscriptions/${subId}`)).status, 404, 'second delete 404s');
});
