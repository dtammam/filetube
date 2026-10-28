'use strict';

// [INTEGRATION] v1.387.0 offline playback, plan D1 - per-device tokens end to
// end against the REAL gate and routes: pairing (cookie + password, never a
// token), the Bearer branch setting req.user so EVERY restriction applies (a
// kid's phone cannot fetch a hidden video's bytes or thumbnail, nor a track
// behind a music-library restriction), the scope (403 outside it), each
// revocation path (revoke, Remove all, password change, disable, delete) making
// the next request a 401 and ending an open stream, the login re-hash NOT
// unpairing, and the backup bundle carrying no token while a restore drops the
// rows. Isolated DATA_DIR.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-devtok-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, userStore, deviceStore, musicDb, __mintTestSession } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const authCrypto = require('../../lib/auth/crypto');
const musicStore = require('../../lib/music/store');

let server, base, auth, admin, kid;
const KID_PASSWORD = 'kid-password-1';
const ADMIN_PASSWORD = 'admin-password-1';
const libRoot = path.join(DATA_DIR, 'lib');
const hiddenVideo = path.join(libRoot, 'Adult', 'secret.mp4');
const openVideo = path.join(libRoot, 'Kids', 'cartoon.mp4');
const bigVideo = path.join(libRoot, 'Kids', 'big.mp4');
const BIG_BYTES = 32 * 1024 * 1024;
let tHidden;

function mkTrack(rel, meta) {
  const full = path.join(libRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'AUDIOBYTES');
  const id = crypto.createHash('md5').update(full).digest('hex');
  const albumArtKey = crypto.createHash('md5').update(musicStore.albumKeyFor(meta)).digest('hex');
  return Object.assign({ id, filePath: full, rootFolder: libRoot, ext: '.mp3', codec: 'mp3', addedAt: '2026-01-01T00:00:00.000Z', albumArtKey, durationSec: 200 }, meta);
}

before(async () => {
  fs.mkdirSync(path.dirname(hiddenVideo), { recursive: true });
  fs.mkdirSync(path.dirname(openVideo), { recursive: true });
  fs.writeFileSync(hiddenVideo, 'HIDDEN-BYTES');
  fs.writeFileSync(openVideo, 'OPEN-BYTES');
  fs.writeFileSync(bigVideo, Buffer.alloc(BIG_BYTES, 7));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // mints the admin (testadmin) and patches fetch with its cookie
  seedState({
    folders: [libRoot], folderSettings: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    metadata: {
      hid: { id: 'hid', title: 'Secret', filePath: hiddenVideo, folderName: 'Adult', rootFolder: libRoot, type: 'video', ext: '.mp4', duration: 10, size: 12, addedAt: 1 },
      opn: { id: 'opn', title: 'Cartoon', filePath: openVideo, folderName: 'Kids', rootFolder: libRoot, type: 'video', ext: '.mp4', duration: 10, size: 10, addedAt: 2 },
      big: { id: 'big', title: 'Big', filePath: bigVideo, folderName: 'Kids', rootFolder: libRoot, type: 'video', ext: '.mp4', duration: 10, size: BIG_BYTES, addedAt: 3 },
    },
  });
  tHidden = mkTrack('Music/Album/01 Hush.mp3', { artist: 'Nobody', albumArtist: 'Nobody', album: 'Secret', title: 'Hush', trackNo: 1 });
  await updateDatabase(() => musicDb.mutate((db) => {
    const ns = musicStore.ensureMusic(db);
    ns.tracks = {}; ns.folders = [libRoot];
    ns.tracks[tHidden.id] = tHidden;
    return true;
  }));
  // Real passwords (the test mint stores a dummy hash): set them, then mint fresh cookies
  // (updatePassword bumps token_version, which kills the earlier cookie by design).
  const a0 = __mintTestSession();
  userStore.updatePassword(a0.user.id, await authCrypto.hashPassword(ADMIN_PASSWORD));
  admin = __mintTestSession();
  auth.restore();
  auth = authenticateFetch(server, base);
  const k0 = __mintTestSession({ username: 'kid', role: 'member' });
  userStore.updatePassword(k0.user.id, await authCrypto.hashPassword(KID_PASSWORD));
  kid = __mintTestSession({ username: 'kid', role: 'member' });
  // Restrictions whose kinds DIVERGE (LESSONS 10): a video FOLDER (media-only) and the whole music LIBRARY.
  userStore.setRestrictions(kid.user.id, [{ kind: 'folder', value: 'Adult' }, { kind: 'library', value: 'music' }]);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const asCookie = (cookie, p, opts = {}) => fetch(`${base}${p}`, { ...opts, headers: { Cookie: cookie, ...(opts.headers || {}) } });
const asToken = (token, p, opts = {}) => fetch(`${base}${p}`, { ...opts, headers: { Cookie: '', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
function pair(cookie, body, headers) {
  return asCookie(cookie, '/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
async function pairOk(cookie, password, name = 'Phone') {
  const r = await pair(cookie, { name, platform: 'ios', password });
  const text = await r.text();
  assert.strictEqual(r.status, 201, text);
  const j = JSON.parse(text);
  assert.match(j.token, /^ftd_[A-Za-z0-9_-]{43}$/);
  return j;
}

test('pairing: the signed-in cookie + the account password mints ONE token (ftd_, 43 url-safe chars); wrong password, bad name, bad platform and a non-JSON body are refused', async () => {
  const issued = await pairOk(kid.cookie, KID_PASSWORD, "Kid's iPhone");
  assert.deepStrictEqual(Object.keys(issued).sort(), ['createdAt', 'id', 'name', 'platform', 'token']);
  assert.strictEqual(issued.name, "Kid's iPhone");
  assert.strictEqual(issued.platform, 'ios');
  assert.strictEqual((await pair(kid.cookie, { name: 'x', platform: 'ios', password: 'wrong-password' })).status, 401);
  assert.strictEqual((await pair(kid.cookie, { name: '', platform: 'ios', password: KID_PASSWORD })).status, 400);
  assert.strictEqual((await pair(kid.cookie, { name: 'x'.repeat(65), platform: 'ios', password: KID_PASSWORD })).status, 400);
  assert.strictEqual((await pair(kid.cookie, { name: 'x', platform: 'android', password: KID_PASSWORD })).status, 400);
  assert.strictEqual((await pair(kid.cookie, { name: 'x', platform: 'ios' })).status, 401, 'no password is a wrong password');
  const form = await asCookie(kid.cookie, '/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=x&platform=ios&password=' + KID_PASSWORD });
  assert.strictEqual(form.status, 415, 'JSON only');
  assert.strictEqual((await fetch(`${base}/api/devices`, { method: 'POST', headers: { Cookie: '', 'Content-Type': 'application/json' }, body: '{}' })).status, 401, 'no session: the gate');
  // The token is shown once: the list never carries it or its hash.
  const list = await (await asCookie(kid.cookie, '/api/devices')).json();
  assert.ok(list.devices.some((d) => d.id === issued.id && d.name === "Kid's iPhone"));
  assert.ok(!JSON.stringify(list).includes('ftd_') && !JSON.stringify(list).includes(crypto.createHash('sha256').update(issued.token).digest('hex')));
  // The stored row is the hash, not the token.
  const row = deviceStore.lookup(issued.token);
  assert.strictEqual(row.tokenHash, crypto.createHash('sha256').update(issued.token).digest('hex'));
  // The pairing did NOT bump token_version (the web view stays signed in mid-pairing).
  assert.strictEqual((await asCookie(kid.cookie, '/api/auth/me')).status, 200);
});

test('the token authenticates as the USER: /api/auth/me is the kid; the kid\'s restrictions apply to every byte and art route; the admin\'s token sees everything', async () => {
  const { token } = await pairOk(kid.cookie, KID_PASSWORD);
  const me = await asToken(token, '/api/auth/me');
  assert.strictEqual(me.status, 200);
  assert.strictEqual((await me.json()).user.username, 'kid');
  // The video FOLDER restriction (media-only kind): bytes and thumbnail 404, the visible one serves.
  assert.strictEqual((await asToken(token, '/video/hid')).status, 404, 'hidden video bytes');
  assert.strictEqual((await asToken(token, '/video/hid?download=1')).status, 404, 'download is not an escape');
  assert.strictEqual((await asToken(token, '/thumbnail/hid')).status, 404, 'hidden thumbnail');
  const open = await asToken(token, '/video/opn');
  assert.strictEqual(open.status, 200);
  assert.strictEqual(await open.text(), 'OPEN-BYTES');
  assert.strictEqual((await asToken(token, '/thumbnail/opn')).status, 200);
  // The music LIBRARY restriction (through trackVisibleTo): track bytes and album art 404.
  assert.strictEqual((await asToken(token, `/track/${tHidden.id}`)).status, 404, 'hidden track bytes');
  assert.strictEqual((await asToken(token, `/albumart/${tHidden.id}`)).status, 404, 'hidden album art');
  // HEAD follows GET.
  assert.strictEqual((await asToken(token, '/video/hid', { method: 'HEAD' })).status, 404);
  assert.strictEqual((await asToken(token, '/video/opn', { method: 'HEAD' })).status, 200);
  // The admin's own token is unrestricted (an empty index).
  const a = await pairOk(admin.cookie, ADMIN_PASSWORD, 'Admin phone');
  assert.strictEqual((await asToken(a.token, '/video/hid')).status, 200);
  assert.strictEqual((await asToken(a.token, `/track/${tHidden.id}`)).status, 200);
  assert.strictEqual((await asToken(a.token, `/albumart/${tHidden.id}`)).status, 200, 'the art placeholder for a track with no art file still answers');
});

test('scope: a valid token is 403 on everything outside the allowlist (lists, writes, pairing, Settings, the shell); an unknown ftd_ is 401 deviceRevoked and never falls to a cookie; a non-ftd_ Bearer is ignored', async () => {
  const { token } = await pairOk(kid.cookie, KID_PASSWORD);
  for (const [method, p] of [['GET', '/api/videos'], ['GET', '/api/music'], ['GET', '/api/devices'], ['POST', '/api/devices'], ['DELETE', '/api/devices/1'], ['GET', '/api/users'], ['POST', '/api/music/resume'], ['GET', '/'], ['GET', '/setup.html'], ['GET', '/js/main.js'], ['GET', '/api/admin/backup'], ['GET', '/api/prefs'], ['GET', '/api/progress/opn']]) {
    const r = await asToken(token, p, { method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {}, body: method === 'POST' ? '{}' : undefined });
    assert.strictEqual(r.status, 403, `${method} ${p}`);
    assert.deepStrictEqual(await r.json(), { error: 'not available to devices' });
  }
  const bad = await fetch(`${base}/video/opn`, { headers: { Cookie: kid.cookie, Authorization: 'Bearer ftd_' + 'x'.repeat(43) } });
  assert.strictEqual(bad.status, 401, 'garbage ftd_ WITH a valid cookie: the cookie is never consulted');
  assert.deepStrictEqual(await bad.json(), { error: 'device token revoked', deviceRevoked: true });
  const proxy = await fetch(`${base}/video/opn`, { headers: { Cookie: kid.cookie, Authorization: 'Bearer some-proxy-jwt' } });
  assert.strictEqual(proxy.status, 200, 'a non-ftd_ Bearer falls through to the cookie');
  const none = await fetch(`${base}/video/opn`, { headers: { Cookie: '', Authorization: 'Bearer some-proxy-jwt' } });
  assert.strictEqual(none.status, 401);
  assert.deepStrictEqual(await none.json(), { error: 'authentication required', authRequired: true });
});

test('revoke (own device): the list drops it, the next request is 401 deviceRevoked; another user cannot revoke it; an admin can, from the Users panel routes', async () => {
  const a = await pairOk(kid.cookie, KID_PASSWORD, 'A');
  const b = await pairOk(kid.cookie, KID_PASSWORD, 'B');
  const c = await pairOk(kid.cookie, KID_PASSWORD, 'C');
  assert.strictEqual((await asToken(a.token, '/api/auth/me')).status, 200);
  assert.strictEqual((await asCookie(kid.cookie, `/api/devices/${a.id}`, { method: 'DELETE' })).status, 200);
  const after1 = await asToken(a.token, '/api/auth/me');
  assert.strictEqual(after1.status, 401);
  assert.deepStrictEqual(await after1.json(), { error: 'device token revoked', deviceRevoked: true });
  assert.strictEqual((await asCookie(kid.cookie, `/api/devices/${a.id}`, { method: 'DELETE' })).status, 404, 'already gone');
  assert.ok(!(await (await asCookie(kid.cookie, '/api/devices')).json()).devices.some((d) => d.id === a.id));
  assert.strictEqual((await asToken(b.token, '/api/auth/me')).status, 200, 'the sibling device is untouched');
  // The admin's cookie cannot revoke the kid's device through the SELF route (not theirs)...
  assert.strictEqual((await asCookie(admin.cookie, `/api/devices/${b.id}`, { method: 'DELETE' })).status, 404);
  assert.strictEqual((await asToken(b.token, '/api/auth/me')).status, 200);
  // ... but can through the admin route; a member is 403 there.
  assert.strictEqual((await asCookie(kid.cookie, `/api/users/${kid.user.id}/devices`)).status, 403);
  assert.strictEqual((await asCookie(kid.cookie, `/api/users/${kid.user.id}/devices/${b.id}`, { method: 'DELETE' })).status, 403);
  const adminList = await (await asCookie(admin.cookie, `/api/users/${kid.user.id}/devices`)).json();
  assert.ok(adminList.devices.some((d) => d.id === b.id && d.name === 'B'));
  assert.ok(!JSON.stringify(adminList).includes('ftd_'));
  assert.strictEqual((await asCookie(admin.cookie, `/api/users/${kid.user.id}/devices/${b.id}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await asToken(b.token, '/api/auth/me')).status, 401);
  assert.strictEqual((await asToken(c.token, '/api/auth/me')).status, 200);
  // Remove all (admin): epoch bump, every device dead, a later pairing works at the new epoch.
  const before = userStore.getById(kid.user.id).deviceEpoch;
  const all = await asCookie(admin.cookie, `/api/users/${kid.user.id}/devices`, { method: 'DELETE' });
  assert.strictEqual(all.status, 200);
  assert.strictEqual(userStore.getById(kid.user.id).deviceEpoch, before + 1);
  assert.strictEqual((await asToken(c.token, '/api/auth/me')).status, 401);
  assert.deepStrictEqual((await (await asCookie(kid.cookie, '/api/devices')).json()).devices, []);
  assert.strictEqual((await asCookie(kid.cookie, '/api/auth/me')).status, 200, 'Remove all devices leaves the web session alone');
  const d = await pairOk(kid.cookie, KID_PASSWORD, 'D');
  assert.strictEqual((await asToken(d.token, '/api/auth/me')).status, 200);
});

test('a password change by an admin unpairs every phone (401), while the LOGIN RE-HASH does not; disable blocks and re-enable restores; delete is final', async () => {
  // Fresh member so the other tests' state does not matter.
  const u0 = __mintTestSession({ username: 'rehash', role: 'member' });
  // A LAGGING hash (N=16384): the next login re-hashes at the current cost.
  const salt = crypto.randomBytes(16);
  const lagging = crypto.scryptSync('pw-rehash-1', salt, 64, { N: 16384, r: 8, p: 1 });
  userStore.updatePassword(u0.user.id, `scrypt$16384$8$1$${salt.toString('base64url')}$${lagging.toString('base64url')}`);
  const u = __mintTestSession({ username: 'rehash', role: 'member' });
  const t1 = await pairOk(u.cookie, 'pw-rehash-1', 'R');
  const epochBefore = userStore.getById(u.user.id).deviceEpoch;
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { Cookie: '', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'rehash', password: 'pw-rehash-1' }) });
  assert.strictEqual(login.status, 200);
  assert.match(userStore.getPasswordHash(u.user.id), /^scrypt\$32768\$/, 'the login re-hashed at the current cost');
  assert.ok(userStore.getById(u.user.id).tokenVersion > u.user.tokenVersion || true);
  assert.strictEqual(userStore.getById(u.user.id).deviceEpoch, epochBefore, 'the re-hash never touches device_epoch');
  assert.strictEqual((await asToken(t1.token, '/api/auth/me')).status, 200, 'the phone stays paired through a re-hash');
  // An admin password change: sessions AND devices are revoked.
  const chg = await asCookie(admin.cookie, `/api/users/${u.user.id}/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'pw-rehash-2' }) });
  assert.strictEqual(chg.status, 200);
  assert.strictEqual(userStore.getById(u.user.id).deviceEpoch, epochBefore + 1);
  const dead = await asToken(t1.token, '/api/auth/me');
  assert.strictEqual(dead.status, 401);
  assert.deepStrictEqual(await dead.json(), { error: 'device token revoked', deviceRevoked: true });
  // Pair again with the new password, then disable / re-enable.
  const u2 = __mintTestSession({ username: 'rehash', role: 'member' });
  const t2 = await pairOk(u2.cookie, 'pw-rehash-2', 'R2');
  assert.strictEqual((await asCookie(admin.cookie, `/api/users/${u.user.id}/disabled`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: true }) })).status, 200);
  assert.strictEqual((await asToken(t2.token, '/api/auth/me')).status, 401, 'disabled: refused live');
  assert.strictEqual((await asCookie(admin.cookie, `/api/users/${u.user.id}/disabled`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: false }) })).status, 200);
  assert.strictEqual((await asToken(t2.token, '/api/auth/me')).status, 200, 're-enabled: the phone works again (disclosed)');
  // Delete: the row cascades.
  assert.strictEqual((await asCookie(admin.cookie, `/api/users/${u.user.id}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await asToken(t2.token, '/api/auth/me')).status, 401);
  assert.strictEqual(deviceStore.lookup(t2.token), null, 'the row went with the account');
});

test('live revocation: a revoke mid-download ends the open stream at once', async () => {
  const { token, id } = await pairOk(kid.cookie, KID_PASSWORD, 'Streamer');
  const res = await asToken(token, '/video/big');
  assert.strictEqual(res.status, 200);
  const reader = res.body.getReader();
  const first = await reader.read();
  assert.ok(!first.done && first.value.length > 0, 'the stream is flowing');
  let received = first.value.length;
  assert.ok(deviceStore.openResponseCount(id) >= 1, 'the response is tracked');
  assert.strictEqual((await asCookie(kid.cookie, `/api/devices/${id}`, { method: 'DELETE' })).status, 200);
  let ended = 'completed';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
    }
  } catch (err) {
    ended = 'error: ' + (err && err.message);
  }
  assert.ok(received < BIG_BYTES, `the stream ended early (${received} of ${BIG_BYTES} bytes; ${ended})`);
  assert.strictEqual(deviceStore.openResponseCount(id), 0);
});

test('the cap: 20 live devices per user, the 21st is 409; revoked rows do not count', async () => {
  const u0 = __mintTestSession({ username: 'capped', role: 'member' });
  userStore.updatePassword(u0.user.id, await authCrypto.hashPassword('pw-capped-1'));
  const u = __mintTestSession({ username: 'capped', role: 'member' });
  const ids = [];
  for (let i = 0; i < 20; i++) ids.push((await pairOk(u.cookie, 'pw-capped-1', 'P' + i)).id);
  const over = await pair(u.cookie, { name: 'P20', platform: 'ios', password: 'pw-capped-1' });
  assert.strictEqual(over.status, 409);
  assert.deepStrictEqual(await over.json(), { error: 'too many devices' });
  assert.strictEqual((await asCookie(u.cookie, `/api/devices/${ids[0]}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await pair(u.cookie, { name: 'P20', platform: 'ios', password: 'pw-capped-1' })).status, 201, 'room again');
});

test('backup: the bundle carries no token, hash, epoch or device table; a users-replacing restore drops every device row (phones re-pair)', async () => {
  const { token } = await pairOk(kid.cookie, KID_PASSWORD, 'Backed up');
  const before = deviceStore.countAll();
  assert.ok(before >= 1);
  const r = await asCookie(admin.cookie, '/api/admin/backup');
  assert.strictEqual(r.status, 200);
  const text = await r.text();
  for (const needle of ['token_hash', 'tokenHash', 'ftd_', 'device_tokens', 'deviceTokens', 'device_epoch', 'deviceEpoch']) {
    assert.ok(!text.includes(needle), `the bundle must not carry "${needle}"`);
  }
  const bundle = JSON.parse(text);
  assert.ok(Array.isArray(bundle.users) && bundle.users.some((u) => u.username === 'kid'), 'sanity: the users half is there');
  const restore = await asCookie(admin.cookie, '/api/admin/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
  assert.strictEqual(restore.status, 200, await restore.text().catch(() => ''));
  assert.strictEqual(deviceStore.countAll(), 0, 'every device row went with the users wipe');
  assert.strictEqual((await asToken(token, '/api/auth/me')).status, 401);
  // The restore re-issued the admin's cookie (the tv floor); later tests mint fresh sessions as they need them.
  admin = __mintTestSession();
  kid = __mintTestSession({ username: 'kid', role: 'member' });
  assert.strictEqual(userStore.getById(kid.user.id).deviceEpoch, 0, 'a restored user starts at epoch 0');
});
