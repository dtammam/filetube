'use strict';

// [INTEGRATION] v1.397.0 native audio (plan docs/exec-plans/active/2026-10-28-native-audio.md, D7 + D8 + D14): the MEDIA
// TOKEN over HTTP. Minted ONLY with a device token (a cookie cannot, a media token cannot); accepted ONLY on GET / HEAD of
// the audio file route (track, podcastEpisode) and the two art routes; refused as a JSON 401 everywhere else and on every
// POST, never a redirect, never a cookie; the user's restrictions apply; expiry and a never-existed token answer the SAME
// (mediaTokenExpired, no oracle); a revoked / epoch-stale / disabled device answers deviceRevoked, and a revoke mid-stream
// ends the open stream; the token never reaches a log line. Plus the D8 scope widening: a device token posts progress and
// plays to the web's own routes and asks for radio, restrictions applying.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-mediatok-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, userStore, deviceStore, musicDb, podcastsDb, __mintTestSession, createMutationAuditMiddleware } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const authCrypto = require('../../lib/auth/crypto');
const musicStore = require('../../lib/music/store');
const podcastStore = require('../../lib/podcasts/store');
const mediaTokenLib = require('../../lib/auth/media-token');

let server, base, auth, kid, admin;
const KID_PASSWORD = 'kid-password-1';
const lib = path.join(DATA_DIR, 'lib');
const BIG_BYTES = 24 * 1024 * 1024;
const SUB = 'a'.repeat(32), HIDDEN_SUB = 'b'.repeat(32);
let tracks = {}, epOk, epHidden;

const f = (rel, bytes) => { const full = path.join(lib, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, bytes); return full; };
function mkTrack(rel, bytes, meta) {
  const full = f(rel, bytes);
  const id = crypto.createHash('md5').update(full).digest('hex');
  return Object.assign({ id, filePath: full, rootFolder: lib, ext: path.extname(full), addedAt: '2026-01-01T00:00:00.000Z', albumArtKey: null, durationSec: 200 }, meta);
}
const asCookie = (cookie, p, opts = {}) => fetch(`${base}${p}`, { ...opts, headers: { Cookie: cookie, ...(opts.headers || {}) } });
const asToken = (token, p, opts = {}) => fetch(`${base}${p}`, { ...opts, headers: { Cookie: '', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
const bare = (p, opts = {}) => fetch(`${base}${p}`, { ...opts, redirect: 'manual', headers: { Cookie: '', ...(opts.headers || {}) } });
const withMt = (p, mt) => p + (p.includes('?') ? '&' : '?') + 'mt=' + encodeURIComponent(mt);
async function pairOk(cookie, password, name = 'Phone') {
  const r = await asCookie(cookie, '/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, platform: 'ios', password }) });
  assert.strictEqual(r.status, 201);
  return r.json();
}
async function mintOk(deviceToken) {
  const r = await asToken(deviceToken, '/api/devices/media-token', { method: 'POST' });
  assert.strictEqual(r.status, 200, 'the device token mints');
  const body = await r.json();
  assert.ok(/^ftm_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(body.token), 'ftm_ + payload.mac');
  const exp = Date.parse(body.expiresAt);
  assert.ok(exp - Date.now() > 5.9 * 3600 * 1000 && exp - Date.now() <= 6 * 3600 * 1000 + 5000, 'about 6 h');
  assert.strictEqual(r.headers.get('cache-control'), 'no-store');
  return body;
}
const secret = () => fs.readFileSync(path.join(DATA_DIR, 'session-secret'), 'utf8').trim();

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  admin = { cookie: auth.cookie, user: auth.user };
  const aud = f('Talks/long talk.m4a', 'LIBRARY-AUDIO-BYTES');
  seedState({
    folders: [lib], folderSettings: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    metadata: {
      aud: { id: 'aud', title: 'Talk', filePath: aud, folderName: 'Talks', rootFolder: lib, type: 'audio', ext: '.m4a', codec: 'aac', duration: 90, size: 19, addedAt: 1, hasThumbnail: false, tags: { artist: 'Speaker', album: 'Talks' } },
      vid: { id: 'vid', title: 'Cartoon', filePath: f('Kids/cartoon.mp4', 'VIDEO-BYTES'), folderName: 'Kids', rootFolder: lib, type: 'video', ext: '.mp4', codec: 'h264', audioCodec: 'aac', duration: 100, size: 11, addedAt: 1 },
    },
  });
  tracks = {
    ok: mkTrack('Music/Floyd/Wall/01 Mother.flac', 'FLAC-BYTES-OK', { artist: 'Pink Floyd', albumArtist: 'Pink Floyd', album: 'The Wall', title: 'Mother', trackNo: 1, codec: 'flac' }),
    hidden: mkTrack('Music/Blocked/Wall/03 Bricks.flac', 'FLAC-BYTES-HIDDEN', { artist: 'Pink Floyd', albumArtist: 'Pink Floyd', album: 'The Wall', title: 'Bricks', trackNo: 3, codec: 'flac' }),
    big: mkTrack('Music/Big/01 Long.mp3', Buffer.alloc(BIG_BYTES, 7), { artist: 'Big', albumArtist: 'Big', album: 'Long', title: 'Long', trackNo: 1, codec: 'mp3' }),
  };
  await updateDatabase(() => musicDb.mutate((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks = {}; ns.folders = [path.join(lib, 'Music')];
    for (const t of Object.values(tracks)) ns.tracks[t.id] = t;
    return true;
  }));
  const showDir = path.join(DATA_DIR, 'podcasts', 'Show'); fs.mkdirSync(showDir, { recursive: true });
  fs.writeFileSync(path.join(showDir, 'ep1.mp3'), 'PODCAST-BYTES');
  const hiddenDir = path.join(DATA_DIR, 'podcasts', 'Hidden'); fs.mkdirSync(hiddenDir, { recursive: true });
  fs.writeFileSync(path.join(hiddenDir, 'h1.mp3'), 'HIDDEN-PODCAST');
  epOk = podcastStore.episodeIdFor(SUB, 'g1');
  epHidden = podcastStore.episodeIdFor(HIDDEN_SUB, 'h1');
  await updateDatabase(() => podcastsDb.mutate((h) => {
    const p = podcastStore.ensurePodcasts(h); p.subscriptions = []; p.episodes = {};
    podcastStore.reduceAddSubscription(p, { id: SUB, name: 'The Show', feedUrl: 'https://e.com/f.xml' });
    podcastStore.reduceAddSubscription(p, { id: HIDDEN_SUB, name: 'Hidden Show', feedUrl: 'https://e.com/h.xml' });
    podcastStore.reduceUpsertEpisodes(p, SUB, [{ guid: 'g1', title: 'Episode One', pubDateMs: 1, durationSec: 1800 }], 'pending', 5000);
    podcastStore.reduceUpsertEpisodes(p, HIDDEN_SUB, [{ guid: 'h1', title: 'Hush', pubDateMs: 1, durationSec: 100 }], 'pending', 5000);
    podcastStore.reduceEpisodeDownloaded(p, epOk, { fileName: 'ep1.mp3', filePath: path.join(showDir, 'ep1.mp3'), bytes: 13, nowMs: 6000 });
    podcastStore.reduceEpisodeDownloaded(p, epHidden, { fileName: 'h1.mp3', filePath: path.join(hiddenDir, 'h1.mp3'), bytes: 14, nowMs: 6000 });
    return true;
  }));
  const k0 = __mintTestSession({ username: 'kid', role: 'member' });
  userStore.updatePassword(k0.user.id, await authCrypto.hashPassword(KID_PASSWORD));
  kid = __mintTestSession({ username: 'kid', role: 'member' });
  userStore.setRestrictions(kid.user.id, [{ kind: 'show', value: HIDDEN_SUB }, { kind: 'path', value: path.join(lib, 'Music', 'Blocked') }]);
});
after(() => { auth.restore(); server.close(); });

test('mint: ONLY a device token mints (200 { token: ftm_..., expiresAt ~6 h, no-store }); a cookie session is 403; no credential is 401; a media token cannot mint (the gate refuses mt on a POST)', async () => {
  const { token } = await pairOk(kid.cookie, KID_PASSWORD);
  const minted = await mintOk(token);
  const byCookie = await asCookie(kid.cookie, '/api/devices/media-token', { method: 'POST' });
  assert.strictEqual(byCookie.status, 403);
  assert.deepStrictEqual(await byCookie.json(), { error: 'device token required' });
  assert.strictEqual((await bare('/api/devices/media-token', { method: 'POST' })).status, 401, 'no credential: the gate');
  const byMt = await bare(withMt('/api/devices/media-token', minted.token), { method: 'POST' });
  assert.strictEqual(byMt.status, 401);
  assert.deepStrictEqual(await byMt.json(), { error: 'media token not accepted here', mediaTokenScope: true });
  const byMtAndCookie = await asCookie(kid.cookie, withMt('/api/devices/media-token', minted.token), { method: 'POST' });
  assert.strictEqual(byMtAndCookie.status, 401, 'mt WITH a valid cookie: the cookie is never consulted');
  // a Shortcut token (Pages) never mints: its own scope answers 401 at the gate
  const sc = await asCookie(kid.cookie, '/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Shortcut', platform: 'shortcut', password: KID_PASSWORD }) });
  assert.strictEqual(sc.status, 201);
  assert.strictEqual((await asToken((await sc.json()).token, '/api/devices/media-token', { method: 'POST' })).status, 401);
});

test('scope: mt is accepted on GET / HEAD of the audio file route (track, podcastEpisode) and the two art routes, as the USER (restrictions apply); everywhere else, and on every POST, it is a JSON 401 that never redirects and never sets a cookie', async () => {
  const { token } = await pairOk(kid.cookie, KID_PASSWORD);
  const mt = (await mintOk(token)).token;
  const ok = await bare(withMt(`/api/offline/file/track/${tracks.ok.id}`, mt));
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(await ok.text(), 'FLAC-BYTES-OK');
  assert.strictEqual(ok.headers.get('set-cookie'), null, 'a media-token response never sets a cookie');
  const ranged = await bare(withMt(`/api/offline/file/track/${tracks.ok.id}`, mt), { headers: { Range: 'bytes=5-' } });
  assert.strictEqual(ranged.status, 206);
  assert.strictEqual(await ranged.text(), 'BYTES-OK');
  assert.strictEqual((await bare(withMt(`/api/offline/file/track/${tracks.ok.id}`, mt), { method: 'HEAD' })).status, 200, 'HEAD too');
  assert.strictEqual((await bare(withMt('/api/offline/file/track/aud', mt))).status, 200, 'library audio through the track resolver');
  const ep = await bare(withMt(`/api/offline/file/podcastEpisode/${epOk}`, mt));
  assert.strictEqual(ep.status, 200);
  assert.strictEqual(await ep.text(), 'PODCAST-BYTES');
  assert.strictEqual((await bare(withMt(`/albumart/${tracks.ok.id}`, mt))).status, 200, 'album art (the placeholder or the file)');
  assert.strictEqual((await bare(withMt(`/podcastart/${SUB}`, mt))).status, 200, 'podcast art');
  // the kid's restrictions apply exactly as for a browser: a hidden track / episode / show is a neutral 404
  assert.strictEqual((await bare(withMt(`/api/offline/file/track/${tracks.hidden.id}`, mt))).status, 404);
  assert.strictEqual((await bare(withMt(`/albumart/${tracks.hidden.id}`, mt))).status, 404);
  assert.strictEqual((await bare(withMt(`/api/offline/file/podcastEpisode/${epHidden}`, mt))).status, 404);
  assert.strictEqual((await bare(withMt(`/podcastart/${HIDDEN_SUB}`, mt))).status, 404);
  // outside the scope: a JSON 401 for everything, a video's bytes included
  for (const [method, p] of [['GET', '/api/offline/file/video/vid'], ['GET', `/track/${tracks.ok.id}`], ['GET', `/episode/${epOk}`], ['GET', '/video/vid'], ['GET', '/thumbnail/vid'], ['GET', '/api/auth/me'], ['GET', '/api/offline/manifest?kind=track&id=x'], ['GET', '/api/music'], ['GET', '/api/music/radio?seed=track:x'], ['GET', '/'], ['GET', '/setup.html'], ['GET', '/api/devices'], ['POST', '/api/music/progress'], ['POST', '/api/progress'], ['POST', '/api/podcasts/progress'], ['POST', '/api/music/plays'], ['POST', '/api/offline/progress'], ['POST', '/api/devices'], ['POST', `/api/offline/file/track/${tracks.ok.id}`], ['DELETE', '/api/devices/1']]) {
    const r = await bare(withMt(p, mt), { method, headers: { Accept: 'text/html,application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, body: method === 'POST' ? '{}' : undefined });
    assert.strictEqual(r.status, 401, `${method} ${p}`);
    assert.deepStrictEqual(await r.json(), { error: 'media token not accepted here', mediaTokenScope: true }, `${method} ${p}`);
    assert.strictEqual(r.headers.get('location'), null, `${method} ${p}: never a redirect (a Location would echo the token)`);
    assert.strictEqual(r.headers.get('set-cookie'), null);
  }
  // an HTML-accepting browser-shaped request with a BAD mt on a scoped route is still JSON, never the /login redirect
  const html = await bare(withMt(`/albumart/${tracks.ok.id}`, 'ftm_bad.' + 'x'.repeat(43)), { headers: { Accept: 'text/html' } });
  assert.strictEqual(html.status, 401);
  assert.strictEqual(html.headers.get('location'), null);
  assert.deepStrictEqual(await html.json(), { error: 'media token expired', mediaTokenExpired: true });
  // an empty mt is still "a request carrying mt": refused, never a fall-through to the cookie
  const empty = await asCookie(kid.cookie, `/albumart/${tracks.ok.id}?mt=`);
  assert.strictEqual(empty.status, 401);
  // the array form (?mt=a&mt=b) is "a request carrying mt" too: refused, never the cookie (gate r1 adversary S-B)
  const arr = await asCookie(kid.cookie, `/albumart/${tracks.ok.id}?mt=${encodeURIComponent(mt)}&mt=x`);
  assert.strictEqual(arr.status, 401);
  // ... nor to the Shortcut's X-FileTube-Token (gate r1: the mt branch is judged before EVERY other credential, that one included)
  const viaShortcut = await bare(withMt('/api/ytdlp/download', mt), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FileTube-Token': 'whatever' }, body: '{}' });
  assert.strictEqual(viaShortcut.status, 401);
  assert.deepStrictEqual(await viaShortcut.json(), { error: 'media token not accepted here', mediaTokenScope: true });
});

test('liveness (D14): an expired token and a token that never existed answer the SAME 401 mediaTokenExpired (native re-mints); a revoked, epoch-stale (password change / Remove all) or disabled device answers 401 deviceRevoked; the next mint works again after re-pairing', async () => {
  const paired = await pairOk(kid.cookie, KID_PASSWORD, 'Live');
  const mt = (await mintOk(paired.token)).token;
  const route = `/api/offline/file/track/${tracks.ok.id}`;
  assert.strictEqual((await bare(withMt(route, mt))).status, 200);
  // expired: signed with the REAL secret, exp in the past
  const expired = mediaTokenLib.signMediaToken({ uid: kid.user.id, did: paired.id, de: userStore.getById(kid.user.id).deviceEpoch }, secret(), { nowSeconds: Math.floor(Date.now() / 1000) - 7 * 3600 }).token;
  const e1 = await bare(withMt(route, expired));
  assert.strictEqual(e1.status, 401);
  assert.deepStrictEqual(await e1.json(), { error: 'media token expired', mediaTokenExpired: true });
  // never existed: a well-formed forgery with another secret, a garbage value, a device token in the query
  for (const bad of [mediaTokenLib.signMediaToken({ uid: kid.user.id, did: paired.id, de: 0 }, 'not-the-secret-not-the-secret-not-the-secret').token, 'ftm_garbage', 'ftm_' + 'a'.repeat(20) + '.' + 'b'.repeat(43), paired.token, 'x']) {
    const r = await bare(withMt(route, bad));
    assert.strictEqual(r.status, 401, bad.slice(0, 12));
    assert.deepStrictEqual(await r.json(), { error: 'media token expired', mediaTokenExpired: true }, 'no oracle: the same answer as expired');
  }
  // a token for a device row that does not exist (did 999999) is "never existed" too, not revoked
  const noRow = mediaTokenLib.signMediaToken({ uid: kid.user.id, did: 999999, de: 0 }, secret()).token;
  const nr = await bare(withMt(route, noRow));
  assert.strictEqual(nr.status, 401);
  assert.deepStrictEqual(await nr.json(), { error: 'device token revoked', deviceRevoked: true }, 'a correctly signed token whose device row is gone reads as revoked (only our own secret can sign one, so this is a removed device)');
  // revoked: remove the device
  assert.strictEqual((await asCookie(kid.cookie, `/api/devices/${paired.id}`, { method: 'DELETE' })).status, 200);
  const r1 = await bare(withMt(route, mt));
  assert.strictEqual(r1.status, 401);
  assert.deepStrictEqual(await r1.json(), { error: 'device token revoked', deviceRevoked: true });
  // epoch-stale: pair again, mint, then the admin's "Remove all devices" bumps the epoch
  const p2 = await pairOk(kid.cookie, KID_PASSWORD, 'Live2');
  const mt2 = (await mintOk(p2.token)).token;
  assert.strictEqual((await bare(withMt(route, mt2))).status, 200);
  assert.strictEqual((await asCookie(admin.cookie, `/api/users/${kid.user.id}/devices`, { method: 'DELETE' })).status, 200);
  const r2 = await bare(withMt(route, mt2));
  assert.strictEqual(r2.status, 401);
  assert.deepStrictEqual(await r2.json(), { error: 'device token revoked', deviceRevoked: true });
  assert.strictEqual((await asToken(p2.token, '/api/devices/media-token', { method: 'POST' })).status, 401, 'the stale device token cannot mint either');
  // disabled: pair again, mint, disable the account
  const p3 = await pairOk(kid.cookie, KID_PASSWORD, 'Live3');
  const mt3 = (await mintOk(p3.token)).token;
  assert.strictEqual((await asCookie(admin.cookie, `/api/users/${kid.user.id}/disabled`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: true }) })).status, 200);
  const r3 = await bare(withMt(route, mt3));
  assert.strictEqual(r3.status, 401);
  assert.deepStrictEqual(await r3.json(), { error: 'device token revoked', deviceRevoked: true });
  assert.strictEqual((await asCookie(admin.cookie, `/api/users/${kid.user.id}/disabled`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: false }) })).status, 200);
  assert.strictEqual((await bare(withMt(route, mt3))).status, 200, 're-enabled: the token works again (disclosed, like the device token)');
  kid = __mintTestSession({ username: 'kid', role: 'member' }); // re-enabling rotates token_version: a fresh cookie for the tests below
});

test('D15: the mint sits behind deviceAuth - a revoked, epoch-stale, disabled-user or expired device token answers 401 deviceRevoked and mints NOTHING (native re-mints on any byte 401 and this answer decides)', async () => {
  const a = await pairOk(kid.cookie, KID_PASSWORD, 'Gone');
  assert.strictEqual((await asCookie(kid.cookie, `/api/devices/${a.id}`, { method: 'DELETE' })).status, 200);
  const r1 = await asToken(a.token, '/api/devices/media-token', { method: 'POST' });
  assert.strictEqual(r1.status, 401);
  assert.deepStrictEqual(await r1.json(), { error: 'device token revoked', deviceRevoked: true }, 'revoked');
  const b = await pairOk(kid.cookie, KID_PASSWORD, 'Stale');
  assert.strictEqual((await asCookie(admin.cookie, `/api/users/${kid.user.id}/devices`, { method: 'DELETE' })).status, 200, 'Remove all bumps the epoch');
  const r2 = await asToken(b.token, '/api/devices/media-token', { method: 'POST' });
  assert.strictEqual(r2.status, 401);
  assert.deepStrictEqual(await r2.json(), { error: 'device token revoked', deviceRevoked: true }, 'epoch-stale');
  const c = await pairOk(kid.cookie, KID_PASSWORD, 'Disabled');
  assert.strictEqual((await asCookie(admin.cookie, `/api/users/${kid.user.id}/disabled`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: true }) })).status, 200);
  const r3 = await asToken(c.token, '/api/devices/media-token', { method: 'POST' });
  assert.strictEqual(r3.status, 401);
  assert.deepStrictEqual(await r3.json(), { error: 'device token revoked', deviceRevoked: true }, 'disabled user');
  assert.strictEqual((await asCookie(admin.cookie, `/api/users/${kid.user.id}/disabled`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: false }) })).status, 200);
  kid = __mintTestSession({ username: 'kid', role: 'member' });
  const d = await pairOk(kid.cookie, KID_PASSWORD, 'Expired');
  deviceStore.touch(d.id, new Date(Date.now() - 181 * 24 * 3600 * 1000).toISOString()); // 180 days unused = dead
  const r4 = await asToken(d.token, '/api/devices/media-token', { method: 'POST' });
  assert.strictEqual(r4.status, 401);
  assert.deepStrictEqual(await r4.json(), { error: 'device token revoked', deviceRevoked: true }, 'expired device token');
  assert.strictEqual(deviceStore.byId(d.id), null, 'the dead row was pruned at the gate');
  // epoch-stale with the ROW STILL THERE: a password change bumps device_epoch and leaves the rows (devices.js: never the
  // login re-hash), so this is the one case that binds the epoch comparison itself (Remove all deletes the rows as well)
  const e = await pairOk(kid.cookie, KID_PASSWORD, 'Stale-row');
  const mtE = (await mintOk(e.token)).token;
  assert.strictEqual((await bare(withMt(`/api/offline/file/track/${tracks.ok.id}`, mtE))).status, 200);
  assert.strictEqual((await asCookie(admin.cookie, `/api/users/${kid.user.id}/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'kid-password-2' }) })).status, 200);
  assert.ok(deviceStore.byId(e.id), 'the row is still there');
  assert.notStrictEqual(deviceStore.byId(e.id).epoch, userStore.getById(kid.user.id).deviceEpoch, 'but its epoch is behind the user\'s');
  const rE = await bare(withMt(`/api/offline/file/track/${tracks.ok.id}`, mtE));
  assert.strictEqual(rE.status, 401);
  assert.deepStrictEqual(await rE.json(), { error: 'device token revoked', deviceRevoked: true }, 'epoch-stale media token, row present');
  const rE2 = await asToken(e.token, '/api/devices/media-token', { method: 'POST' });
  assert.strictEqual(rE2.status, 401);
  assert.deepStrictEqual(await rE2.json(), { error: 'device token revoked', deviceRevoked: true }, 'epoch-stale device token, row present: no mint');
  userStore.updatePassword(kid.user.id, await authCrypto.hashPassword(KID_PASSWORD)); // the re-hash path: leaves the epoch alone (the tests below pair with the original password)
  kid = __mintTestSession({ username: 'kid', role: 'member' });
  // "mints NOTHING" is bound by the exact bodies above (each deepStrictEqual admits no token field)
});

test('D16: the mint is rate-bound PER DEVICE - the 7th mint inside a minute is 429 with retryAfterSec; a sibling device is untouched', async () => {
  const a = await pairOk(kid.cookie, KID_PASSWORD, 'Looper');
  const b = await pairOk(kid.cookie, KID_PASSWORD, 'Sibling');
  for (let i = 0; i < 6; i++) assert.strictEqual((await asToken(a.token, '/api/devices/media-token', { method: 'POST' })).status, 200, 'mint ' + (i + 1));
  const over = await asToken(a.token, '/api/devices/media-token', { method: 'POST' });
  assert.strictEqual(over.status, 429);
  const body = await over.json();
  assert.strictEqual(body.error, 'too many attempts');
  assert.ok(Number.isInteger(body.retryAfterSec) && body.retryAfterSec >= 1);
  assert.ok(!JSON.stringify(body).includes('ftm_'), 'nothing minted');
  assert.strictEqual((await asToken(b.token, '/api/devices/media-token', { method: 'POST' })).status, 200, 'the bucket is per device');
});

test('live revocation: a revoke mid-stream ends an open media-token stream at once', async () => {
  const { token, id } = await pairOk(kid.cookie, KID_PASSWORD, 'Streamer');
  const mt = (await mintOk(token)).token;
  const res = await bare(withMt(`/api/offline/file/track/${tracks.big.id}`, mt));
  assert.strictEqual(res.status, 200);
  const reader = res.body.getReader();
  const first = await reader.read();
  assert.ok(!first.done && first.value.length > 0, 'the stream is flowing');
  let received = first.value.length;
  assert.ok(deviceStore.openResponseCount(id) >= 1, 'the response is tracked under the DEVICE (a device revoke reaches it)');
  assert.strictEqual((await asCookie(kid.cookie, `/api/devices/${id}`, { method: 'DELETE' })).status, 200);
  let ended = 'completed';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
    }
  } catch (err) { ended = 'error: ' + (err && err.message); }
  assert.ok(received < BIG_BYTES, `the stream ended early (${received} of ${BIG_BYTES} bytes; ${ended})`);
  assert.strictEqual(deviceStore.openResponseCount(id), 0);
});

test('redaction: no log line ever carries a token - a refused mt request (GET or POST, scoped or not) writes nothing with it, the gate never echoes it (no Location, no body echo), and the audit middleware redacts mt= from the URL it logs (the wiring, bound directly)', async () => {
  const { token } = await pairOk(kid.cookie, KID_PASSWORD, 'Logger');
  const mt = (await mintOk(token)).token;
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => { lines.push(a.join(' ')); };
  console.warn = (...a) => { lines.push(a.join(' ')); };
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    const refusedPost = await bare(withMt('/api/music/progress', mt), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: tracks.ok.id, position: 1, duration: 2 }) });
    assert.strictEqual(refusedPost.status, 401);
    assert.ok(!(await refusedPost.text()).includes(mt), 'the body never echoes the token');
    assert.strictEqual(refusedPost.headers.get('location'), null);
    const okGet = await bare(withMt(`/api/offline/file/track/${tracks.ok.id}`, mt));
    assert.strictEqual(okGet.status, 200);
    const badGet = await bare(withMt(`/albumart/${tracks.ok.id}`, 'ftm_forged.' + 'z'.repeat(43)), { headers: { Accept: 'text/html' } });
    assert.strictEqual(badGet.status, 401);
    await new Promise((res) => setTimeout(res, 60)); // an audit line rides 'finish'
  } finally { Object.assign(console, orig); }
  const needle = mt.slice(4, 28);
  for (const l of lines) assert.ok(!l.includes(needle) && !l.includes('ftm_forged'), 'a log line carries a token: ' + l);
  // The ONE URL logger (server.js createMutationAuditMiddleware, originalUrl) redacts mt=; a request that reaches it can never carry
  // a media token (the gate refuses every mt POST first), so this binds the wiring directly rather than through HTTP.
  const captured = [];
  const mw = createMutationAuditMiddleware((s) => captured.push(s));
  const { EventEmitter } = require('node:events');
  const res = Object.assign(new EventEmitter(), { statusCode: 401, writableEnded: true });
  mw({ method: 'POST', originalUrl: '/api/music/progress?x=1&mt=' + mt + '&y=2', user: null, authVia: null }, res, () => {});
  res.emit('finish');
  assert.strictEqual(captured.length, 1);
  assert.ok(captured[0].includes('/api/music/progress?x=1&mt=[redacted]&y=2'), captured[0]);
  assert.ok(!captured[0].includes(needle), 'redacted');
});

test('D8 scope widening: a device token posts progress and plays to the web\'s own routes with the web\'s bodies and asks for radio; restrictions apply (a hidden track is 404 for plays); /api/music/resume stays a web-only post (403)', async () => {
  const { token } = await pairOk(kid.cookie, KID_PASSWORD, 'Poster');
  const json = (p, body) => asToken(token, p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.strictEqual((await json('/api/music/progress', { id: tracks.ok.id, position: 42, duration: 200 })).status, 200);
  assert.strictEqual((await json('/api/progress', { id: 'aud', timestamp: 12, duration: 90 })).status, 200, 'library audio saves to the media store');
  assert.strictEqual((await json('/api/podcasts/progress', { episodeId: epOk, position: 30, duration: 1800 })).status, 200);
  const plays = await json('/api/music/plays', { events: [{ id: tracks.ok.id, kind: 'play' }] });
  assert.strictEqual(plays.status, 200);
  assert.deepStrictEqual(await plays.json(), { ok: true, recorded: 1 });
  assert.strictEqual((await json('/api/music/plays', { events: [{ id: tracks.hidden.id, kind: 'play' }] })).status, 404, 'a hidden track cannot be played-counted from the phone');
  const radio = await asToken(token, `/api/music/radio?seed=${encodeURIComponent('track:' + tracks.ok.id)}&count=5`);
  assert.strictEqual(radio.status, 200);
  const picks = (await radio.json()).items;
  assert.ok(Array.isArray(picks));
  assert.ok(!picks.some((t) => t.id === tracks.hidden.id), 'radio never picks a hidden track for the phone');
  const resume = await json('/api/music/resume', { lastTrackId: tracks.ok.id, position: 0 });
  assert.strictEqual(resume.status, 403, 'the web\'s own record of what was opened stays a web post');
  assert.deepStrictEqual(await resume.json(), { error: 'not available to devices' });
});
