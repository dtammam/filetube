'use strict';

// [INTEGRATION] v1.238 T1 - the per-user custom PLAYER STICKER: upload
// (POST /api/me/sticker), serve (GET /api/me/sticker, SELF-ONLY), delete, and
// the security posture (self-only write AND self-only read, magic-byte + SVG
// rejection, oversized 413, delete-cascade unlink). Disk-only, no schema change,
// deliberately NOT in the backup bundle. Isolated DATA_DIR. Mirrors the v1.82
// avatar-upload test; the sticker serve is self-only (no by-id read route at all).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-sticker-'));
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

test('T1: no sticker -> self serve 404 (the client falls back to the ft-sticker choice)', async () => {
  assert.strictEqual((await fetch(`${base}/api/me/sticker`)).status, 404, 'serve 404 when unset');
});

test('T1: a valid PNG upload round-trips - POST accepts, self serve returns exact bytes + image/png', async () => {
  const post = await fetch(`${base}/api/me/sticker`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: TINY_PNG });
  assert.strictEqual(post.status, 200);
  const body = await post.json();
  assert.strictEqual(body.sticker.present, true);
  assert.ok(body.sticker.version > 0, 'a cache-bust version is returned');

  const served = await fetch(`${base}/api/me/sticker`);
  assert.strictEqual(served.status, 200);
  assert.strictEqual(served.headers.get('content-type'), 'image/png');
  assert.strictEqual(served.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(TINY_PNG), 'served bytes are exactly what was uploaded');
});

test('T1: a JPEG replaces the PNG (atomic overwrite), served with image/jpeg', async () => {
  await fetch(`${base}/api/me/sticker`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: TINY_JPEG });
  const served = await fetch(`${base}/api/me/sticker`);
  assert.strictEqual(served.headers.get('content-type'), 'image/jpeg');
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(TINY_JPEG));
});

test('T1 (S1): magic-byte + type validation - forged PNG, an SVG, and an empty body all 400 and write nothing', async () => {
  // Confirm the current (valid JPEG) sticker is intact before the rejected uploads.
  assert.strictEqual((await fetch(`${base}/api/me/sticker`)).headers.get('content-type'), 'image/jpeg');
  assert.strictEqual((await fetch(`${base}/api/me/sticker`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('not a png at all') })).status, 400, 'forged png');
  // An SVG (not in the allowlist) - a script-injection vector, must 400.
  assert.strictEqual((await fetch(`${base}/api/me/sticker`, { method: 'POST', headers: { 'Content-Type': 'image/svg+xml' }, body: Buffer.from('<svg onload="alert(1)"/>') })).status, 400, 'svg rejected');
  assert.strictEqual((await fetch(`${base}/api/me/sticker`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.alloc(0) })).status, 400, 'empty');
  // The existing JPEG sticker is untouched by any rejected upload.
  assert.strictEqual((await fetch(`${base}/api/me/sticker`)).headers.get('content-type'), 'image/jpeg', 'no write happened on any rejected upload');
});

test('T1 (S2): an UPPERCASE Content-Type is accepted (MIME is case-insensitive)', async () => {
  const res = await fetch(`${base}/api/me/sticker`, { method: 'POST', headers: { 'Content-Type': 'IMAGE/PNG' }, body: TINY_PNG });
  assert.strictEqual(res.status, 200, 'IMAGE/PNG is the same allowlisted type as image/png');
  assert.strictEqual((await fetch(`${base}/api/me/sticker`)).headers.get('content-type'), 'image/png');
});

test('T1 (S1): an oversized body is rejected 413', async () => {
  const big = Buffer.concat([TINY_PNG, Buffer.alloc(1024 * 1024 + 10)]); // > 1 MB cap
  const res = await fetch(`${base}/api/me/sticker`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: big });
  assert.strictEqual(res.status, 413, 'over the 1 MB cap');
});

test('T1 (S2): self-only - a member sees only their OWN sticker; there is NO by-id read or write route', async () => {
  // The member uploads their own sticker and reads it back.
  const post = await asMember('/api/me/sticker', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: TINY_PNG });
  assert.strictEqual(post.status, 200, 'member sets own sticker');
  const mine = await asMember('/api/me/sticker', { method: 'GET' });
  assert.strictEqual(mine.status, 200, 'member reads own sticker');
  // No by-id route exists at all - a member cannot read/write another user's sticker.
  assert.strictEqual((await asMember(`/api/users/${member.user.id}/sticker`, { method: 'GET' })).status, 404, 'no by-id read route');
  assert.strictEqual((await asMember(`/api/users/${member.user.id}/sticker`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: TINY_PNG })).status, 404, 'no by-id write route');
});

test('T1 (S4): deleting a user unlinks their sticker file (no orphan for the never-reused id)', async () => {
  const victim = __mintTestSession({ username: 'goner', role: 'member' });
  await fetch(`${base}/api/me/sticker`, { method: 'POST', headers: { Cookie: victim.cookie, 'Content-Type': 'image/png' }, body: TINY_PNG });
  const onDisk = path.join(DATA_DIR, 'stickers', `${victim.user.id}.bin`);
  assert.ok(fs.existsSync(onDisk), 'sticker file exists before delete');
  const del = await fetch(`${base}/api/users/${victim.user.id}`, { method: 'DELETE' });
  assert.strictEqual(del.status, 200);
  assert.strictEqual(fs.existsSync(onDisk), false, 'sticker file unlinked with the account');
});

test('T1: DELETE /api/me/sticker reverts to the chosen preset/logo (self serve 404), idempotent', async () => {
  // The admin still has a sticker from earlier uploads.
  assert.strictEqual((await fetch(`${base}/api/me/sticker`)).status, 200);
  const del = await fetch(`${base}/api/me/sticker`, { method: 'DELETE' });
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await del.json()).sticker.present, false);
  assert.strictEqual((await fetch(`${base}/api/me/sticker`)).status, 404, 'serve 404 after delete');
  // Idempotent: a second delete is still 200.
  assert.strictEqual((await fetch(`${base}/api/me/sticker`, { method: 'DELETE' })).status, 200);
});

test('T1 (backup): the custom sticker is intentionally NOT carried in the admin backup bundle', async () => {
  // Set a sticker, take a bundle, confirm no sticker bytes ride it (disk-only,
  // presence-is-state; the v1.82 avatar S4 precedent - restore is a no-op for it).
  await fetch(`${base}/api/me/sticker`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: TINY_PNG });
  const bundle = await (await fetch(`${base}/api/admin/backup`)).json();
  const serialized = JSON.stringify(bundle);
  assert.strictEqual(bundle.sticker, undefined, 'no top-level sticker key in the bundle');
  assert.ok(!/sticker/i.test(Object.keys(bundle).join(',')), 'no sticker namespace key in the bundle');
  // The uploaded PNG bytes (base64) must not appear anywhere in the bundle.
  assert.ok(!serialized.includes(TINY_PNG.toString('base64')), 'sticker image bytes are not in the bundle');
});
