'use strict';

// [INTEGRATION] v1.82 T1 - the per-user profile avatar: upload (POST /api/me/
// avatar), serve (GET /api/users/:id/avatar), delete, /api/auth/me presence, and
// the security posture (self-only write, magic-byte validation, numeric-id
// serve, delete-cascade). Disk-only, no schema change. Isolated DATA_DIR.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-avatar-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, member;

// A tiny-but-real PNG (1x1) - valid signature + IHDR, passes the magic-byte sniff.
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
  '01f15c4890000000d49444154789c6260000000060005e27de71c0000000049454e44ae426082',
  'hex',
);
// A tiny valid JPEG (SOI + APP0 + EOI) - enough for the ff d8 ff sniff.
const TINY_JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin, patches global fetch with the admin cookie
  member = __mintTestSession({ username: 'kid', role: 'member' });
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const asMember = (p, init) => fetch(`${base}${p}`, { ...(init || {}), headers: { ...((init || {}).headers || {}), Cookie: member.cookie } });
const me = () => fetch(`${base}/api/auth/me`).then((r) => r.json()); // admin

test('T1: no avatar -> /api/auth/me present:false, serve 404, monogram is the client fallback', async () => {
  const m = await me();
  assert.strictEqual(m.user.avatar.present, false, 'no avatar set');
  assert.strictEqual(m.user.avatar.version, 0);
  const admin = await me();
  assert.strictEqual((await fetch(`${base}/api/users/${admin.user.id}/avatar`)).status, 404, 'serve 404 when unset');
});

test('T1: a valid PNG upload round-trips - POST accepts, serve returns exact bytes + image/png, me reports present', async () => {
  const admin = await me();
  const post = await fetch(`${base}/api/me/avatar`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: TINY_PNG });
  assert.strictEqual(post.status, 200);
  const body = await post.json();
  assert.strictEqual(body.avatar.present, true);
  assert.ok(body.avatar.version > 0, 'a cache-bust version is returned');

  const served = await fetch(`${base}/api/users/${admin.user.id}/avatar`);
  assert.strictEqual(served.status, 200);
  assert.strictEqual(served.headers.get('content-type'), 'image/png');
  assert.strictEqual(served.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(TINY_PNG), 'served bytes are exactly what was uploaded');

  const m = await me();
  assert.strictEqual(m.user.avatar.present, true, '/api/auth/me now reports the avatar');
  assert.ok(m.user.avatar.version > 0);
});

test('T1: a JPEG replaces the PNG (atomic overwrite), served with image/jpeg', async () => {
  const admin = await me();
  await fetch(`${base}/api/me/avatar`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: TINY_JPEG });
  const served = await fetch(`${base}/api/users/${admin.user.id}/avatar`);
  assert.strictEqual(served.headers.get('content-type'), 'image/jpeg');
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(TINY_JPEG));
});

test('T1 (S1): magic-byte + type validation - forged PNG, an SVG, and an empty body all 400 and write nothing', async () => {
  const admin = await me();
  const before = (await me()).user.avatar.version;
  // A png Content-Type but non-PNG bytes.
  assert.strictEqual((await fetch(`${base}/api/me/avatar`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('not a png at all') })).status, 400, 'forged png');
  // An SVG (not in the allowlist) - express.raw won't buffer it, mime check 400s.
  assert.strictEqual((await fetch(`${base}/api/me/avatar`, { method: 'POST', headers: { 'Content-Type': 'image/svg+xml' }, body: Buffer.from('<svg/>') })).status, 400, 'svg rejected');
  // Empty body under an image type.
  assert.strictEqual((await fetch(`${base}/api/me/avatar`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.alloc(0) })).status, 400, 'empty');
  // The existing (valid JPEG) avatar is untouched by the rejected uploads.
  assert.strictEqual((await me()).user.avatar.version, before, 'no write happened on any rejected upload');
  assert.strictEqual((await fetch(`${base}/api/users/${admin.user.id}/avatar`)).headers.get('content-type'), 'image/jpeg');
});

test('T1 (S1): an oversized body is rejected 413', async () => {
  const big = Buffer.concat([TINY_PNG, Buffer.alloc(1024 * 1024 + 10)]); // > 1 MB cap
  const res = await fetch(`${base}/api/me/avatar`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: big });
  assert.strictEqual(res.status, 413, 'over the 1 MB cap');
});

test('T1 (S2): self-only - a member sets their OWN avatar; there is NO by-id write route', async () => {
  // The member uploads their own photo.
  const post = await asMember('/api/me/avatar', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: TINY_PNG });
  assert.strictEqual(post.status, 200, 'member sets own avatar');
  assert.strictEqual((await fetch(`${base}/api/users/${member.user.id}/avatar`)).status, 200, 'member avatar served');
  // No POST/PUT by-id route exists - a member cannot write another user id's avatar.
  const admin = await me();
  const byId = await asMember(`/api/users/${admin.user.id}/avatar`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: TINY_PNG });
  assert.notStrictEqual(byId.status, 200, 'no by-id write route (404/405), never a successful cross-user write');
});

test('T1 (S2): the serve route rejects a non-numeric id (no path traversal)', async () => {
  for (const bad of ['..%2f..%2fetc', 'abc', '-1', '0', '1.5']) {
    assert.strictEqual((await fetch(`${base}/api/users/${bad}/avatar`)).status, 404, `id ${bad} -> 404`);
  }
});

test('T1 (S4): deleting a user unlinks their avatar file (no orphan for the never-reused id)', async () => {
  const victim = __mintTestSession({ username: 'goner', role: 'member' });
  await fetch(`${base}/api/me/avatar`, { method: 'POST', headers: { Cookie: victim.cookie, 'Content-Type': 'image/png' }, body: TINY_PNG });
  assert.strictEqual((await fetch(`${base}/api/users/${victim.user.id}/avatar`)).status, 200, 'victim has an avatar');
  const onDisk = path.join(DATA_DIR, 'avatars', `${victim.user.id}.bin`);
  assert.ok(fs.existsSync(onDisk), 'avatar file exists before delete');
  // Admin deletes the user.
  const del = await fetch(`${base}/api/users/${victim.user.id}`, { method: 'DELETE' });
  assert.strictEqual(del.status, 200);
  assert.strictEqual(fs.existsSync(onDisk), false, 'avatar file unlinked with the account');
  assert.strictEqual((await fetch(`${base}/api/users/${victim.user.id}/avatar`)).status, 404, 'serve 404 after delete');
});

test('T1: DELETE /api/me/avatar reverts to the monogram (present:false, serve 404)', async () => {
  // The admin still has the JPEG from earlier.
  const admin = await me();
  assert.strictEqual((await fetch(`${base}/api/users/${admin.user.id}/avatar`)).status, 200);
  const del = await fetch(`${base}/api/me/avatar`, { method: 'DELETE' });
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await del.json()).avatar.present, false);
  assert.strictEqual((await me()).user.avatar.present, false, 'me reports no avatar');
  assert.strictEqual((await fetch(`${base}/api/users/${admin.user.id}/avatar`)).status, 404, 'serve 404 after delete');
  // Idempotent: a second delete is still 200.
  assert.strictEqual((await fetch(`${base}/api/me/avatar`, { method: 'DELETE' })).status, 200);
});
