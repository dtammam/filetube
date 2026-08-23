'use strict';

// [INTEGRATION] v1.171 gate closures - the critter pool's DESTRUCTIVE surfaces
// bound behaviorally against a LIVE app:
//  - QA S1: every management route answers 403 to a member (the archive GET had
//    only a source lock before).
//  - Adversarial S2: delete-all's scope guard was source-locked only; here a
//    seeded folder proves README.md, a subdirectory, a .tmp straggler, and a
//    SYMLINK (plus the symlink's outside target) all survive the purge.
// CRITTERS_DIR (the server's test seam) points the whole route family at a
// temp folder so the repo's real public/critters/ is never touched.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-critters-data-'));
const CRITTERS = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-critters-pool-'));
process.env.CRITTERS_DIR = CRITTERS;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
let auth;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const OUTSIDE = path.join(os.tmpdir(), 'filetube-critters-outside-' + process.pid + '.png');

before(async () => {
  // Seed the pool: two real critters (one with a paired sound), the README,
  // a subdirectory, a mid-upload straggler, and a symlink to an OUTSIDE file.
  fs.writeFileSync(path.join(CRITTERS, 'pearl.png'), PNG);
  fs.writeFileSync(path.join(CRITTERS, 'pearl.mp3'), Buffer.from('ID3fake'));
  fs.writeFileSync(path.join(CRITTERS, 'milo.png'), PNG);
  fs.writeFileSync(path.join(CRITTERS, 'README.md'), '# contract file');
  fs.mkdirSync(path.join(CRITTERS, 'subdir'));
  fs.writeFileSync(path.join(CRITTERS, 'subdir', 'inner.png'), PNG);
  fs.writeFileSync(path.join(CRITTERS, 'straggler.png.123.456.tmp'), 'half-written');
  fs.writeFileSync(OUTSIDE, PNG);
  fs.symlinkSync(OUTSIDE, path.join(CRITTERS, 'evil-link.png'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin cookie on every un-Cookied fetch
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  try { fs.unlinkSync(OUTSIDE); } catch { /* already gone would be the FAILURE the suite asserts against */ }
  fs.rmSync(CRITTERS, { recursive: true, force: true });
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test('a MEMBER gets 403 from every management route (upload, delete item, delete all, archive)', async () => {
  const member = __mintTestSession({ username: 'critterpeon', role: 'member' });
  const h = { Cookie: member.cookie };
  assert.strictEqual((await fetch(`${base}/api/critters/archive`, { headers: h })).status, 403, 'archive (QA S1: was source-locked only)');
  assert.strictEqual((await fetch(`${base}/api/critters/item?id=pearl`, { method: 'DELETE', headers: h })).status, 403, 'delete item');
  assert.strictEqual((await fetch(`${base}/api/critters/all`, { method: 'DELETE', headers: h })).status, 403, 'delete all');
  const up = await fetch(`${base}/api/critters/upload?name=x.png`, { method: 'POST', headers: { ...h, 'Content-Type': 'image/png' }, body: PNG });
  assert.strictEqual(up.status, 403, 'upload');
  // And NOTHING was destroyed by the refused calls.
  assert.ok(fs.existsSync(path.join(CRITTERS, 'pearl.png')), 'pearl survives the refused member delete');
});

test('admin round-trip: listing sees the seeded pool, upload lands, traversal names are refused', async () => {
  const list = await (await fetch(`${base}/api/critters`)).json();
  assert.deepStrictEqual(list.critters.map((c) => c.id).sort(), ['milo', 'pearl'], 'subdir/symlink/tmp/README never list');
  assert.ok(list.critters.find((c) => c.id === 'pearl').sound, 'the paired sound rides the listing');
  const up = await fetch(`${base}/api/critters/upload?name=hazel.png`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: PNG });
  assert.strictEqual(up.status, 200);
  assert.ok(fs.existsSync(path.join(CRITTERS, 'hazel.png')), 'the upload landed in the pool folder');
  const evil = await fetch(`${base}/api/critters/upload?name=${encodeURIComponent('../escape.png')}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: PNG });
  assert.strictEqual(evil.status, 400, 'traversal name refused');
  assert.ok(!fs.existsSync(path.join(path.dirname(CRITTERS), 'escape.png')), 'nothing escaped the folder');
});

test('delete item removes the image AND its paired sound; unmatched ids 404', async () => {
  const r = await fetch(`${base}/api/critters/item?id=pearl`, { method: 'DELETE' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual((await r.json()).deleted.sort(), ['pearl.mp3', 'pearl.png'], 'one critter = image + voice');
  assert.ok(!fs.existsSync(path.join(CRITTERS, 'pearl.png')));
  assert.ok(!fs.existsSync(path.join(CRITTERS, 'pearl.mp3')));
  assert.strictEqual((await fetch(`${base}/api/critters/item?id=README`, { method: 'DELETE' })).status, 404, 'the extension-less contract file is unreachable');
  assert.strictEqual((await fetch(`${base}/api/critters/item?id=${encodeURIComponent('../../README')}`, { method: 'DELETE' })).status, 404, 'traversal id finds nothing');
  assert.ok(fs.existsSync(path.join(CRITTERS, 'README.md')), 'README.md untouched');
});

test('DELETE ALL purges only real critter files - README, subdir, straggler, symlink AND its outside target all survive', async () => {
  const r = await fetch(`${base}/api/critters/all`, { method: 'DELETE' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).deleted, 2, 'milo.png + hazel.png (pearl already gone)');
  assert.ok(!fs.existsSync(path.join(CRITTERS, 'milo.png')));
  assert.ok(!fs.existsSync(path.join(CRITTERS, 'hazel.png')));
  // The load-bearing scope assertions (adversarial S2, now behavioral):
  assert.ok(fs.existsSync(path.join(CRITTERS, 'README.md')), 'README.md survives');
  assert.ok(fs.existsSync(path.join(CRITTERS, 'subdir', 'inner.png')), 'subdirectory contents survive');
  assert.ok(fs.existsSync(path.join(CRITTERS, 'straggler.png.123.456.tmp')), '.tmp straggler survives');
  assert.ok(fs.lstatSync(path.join(CRITTERS, 'evil-link.png')).isSymbolicLink(), 'the symlink itself survives (never unlinked)');
  assert.ok(fs.existsSync(OUTSIDE), 'the symlink TARGET outside the folder survives - delete-all never follows links');
});

test('the archive is admin-reachable and structurally sound against the live pool', async () => {
  // Re-seed one critter so the zip has content after the purge above.
  fs.writeFileSync(path.join(CRITTERS, 'biscuit.png'), PNG);
  const r = await fetch(`${base}/api/critters/archive`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'application/zip');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'starts with a local file header');
  assert.strictEqual(buf.readUInt32LE(buf.length - 22), 0x06054b50, 'ends with the EOCD');
  assert.strictEqual(buf.readUInt16LE(buf.length - 22 + 10), 1, 'one entry: biscuit.png');
});
