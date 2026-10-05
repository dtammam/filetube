'use strict';

// [INTEGRATION] v1.366.0 W4 (VR / 360), against the REAL app and the REAL scan:
//   - reachability (LESSONS 2): the real fixture files go through the real scan; an ffprobe stub on PATH
//     REPLAYS the recorded real ffprobe 7.0.2 output (test/fixtures/vr/ffprobe-grown.json) and, like the
//     real binary (measured: without the grown keys a spherical entry prints `{}`), returns ONLY the
//     side-data keys the server asked for - so the scan lands `projection` only if buildFfprobeArgs asks;
//   - rotation still parses through the grown args (rot90: the dims swap);
//   - an unchanged file keeps `projection` with no re-probe (the reuse arm); a changed file re-probes;
//   - POST /api/videos/:id/projection: 403 member, 400 bad value / audio, 404 unknown or NUL id, a pick
//     wins at GET, null deletes the key; the pick survives a changed file (re-init carry) and a pick or a
//     clear landing MID-SCAN survives the final merge (Phase-2 mirror).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const FIX = path.join(__dirname, '..', 'fixtures', 'vr');
const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ffx-vr-'));
const probeLog = path.join(binDir, 'ffprobe-argv.log');
// The ffmpeg stub writes its output file (a thumbnail exists, so the reuse arm does not re-probe to heal it).
fs.writeFileSync(path.join(binDir, 'ffmpeg'), '#!/bin/bash\nif [[ "$1" == "-version" ]]; then echo "ffmpeg version 0.0-filetube-test-stub"; exit 0; fi\nlast="${@: -1}"\nhead -c 4096 /dev/zero > "$last" 2>/dev/null\nexit 0\n', { mode: 0o755 });
fs.writeFileSync(path.join(binDir, 'ffprobe'), `#!${process.execPath}
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
if (args[0] === '-version') { console.log('ffprobe version 0.0-filetube-test-stub'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(probeLog)}, JSON.stringify(args) + '\\n');
const rec = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(FIX, 'ffprobe-grown.json'))}, 'utf8'));
const file = path.basename(args[args.length - 1]);
const r = rec[file];
if (!r) { process.stderr.write('no recording for ' + file); process.exit(1); }
const entries = args[args.indexOf('-show_entries') + 1] || '';
const m = /stream_side_data=([^:]+)/.exec(entries);
const keys = m ? m[1].split(',') : [];
const out = JSON.parse(JSON.stringify(r));
for (const s of out.streams) {
  if (!Array.isArray(s.side_data_list)) continue;
  if (!m) { delete s.side_data_list; continue; }
  s.side_data_list = s.side_data_list.map((e) => { const o = {}; for (const k of keys) if (k in e) o[k] = e[k]; return o; });
}
out.format = { duration: '2.000000' };
process.stdout.write(JSON.stringify(out));
`, { mode: 0o755 });
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-projection-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, scanDirectories, loadDatabase, updateDatabase, getMediaId, __mintTestSession } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
let mediaDir;
let auth;

before(async () => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-projection-media-'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  await new Promise((r) => setTimeout(r, 400)); // the server's boot-time `ffmpeg -version` check is async
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(mediaDir, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
});

function freshLibrary() {
  for (const f of fs.readdirSync(mediaDir)) fs.rmSync(path.join(mediaDir, f), { force: true });
  seedState({ folders: [mediaDir], folderSettings: {}, metadata: {}, settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
}
function copyFixture(name) {
  const dst = path.join(mediaDir, name);
  fs.copyFileSync(path.join(FIX, name), dst);
  return getMediaId(dst);
}
function probeCalls() { try { return fs.readFileSync(probeLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (_) { return []; } }
async function getItem(id) {
  const res = await fetch(`${base}/api/videos/${encodeURIComponent(id)}`);
  assert.equal(res.status, 200);
  return res.json();
}
const pick = (id, projection, headers) => fetch(`${base}/api/videos/${encodeURIComponent(id)}/projection`, {
  method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify({ projection }),
});

test('REACHABILITY: the real fixtures through the real scan land `projection` from the file; flat and name-only files carry no key', async () => {
  freshLibrary();
  const ids = {};
  for (const f of ['vr-360-v1.mp4', 'vr-360-v2.mp4', 'vr-360-tb-v2.mp4', 'vr-180-sbs-v2.mp4', 'clip_360_TB.mp4', 'pano_360.mp4', 'rot90.mp4']) ids[f] = copyFixture(f);
  const before = probeCalls().length;
  await scanDirectories();
  const calls = probeCalls().slice(before);
  assert.ok(calls.length >= 7, 'the scan probed every fixture through the stub (non-vacuity): ' + calls.length);
  assert.ok(calls.every((a) => /stream_side_data=[^:]*side_data_type,projection,type,bound_left,bound_right/.test(a[a.indexOf('-show_entries') + 1])), 'every probe asked for the spherical keys');
  const meta = loadDatabase().metadata;
  assert.strictEqual(meta[ids['vr-360-v1.mp4']].projection, '360');
  assert.strictEqual(meta[ids['vr-360-v2.mp4']].projection, '360');
  assert.strictEqual(meta[ids['vr-360-tb-v2.mp4']].projection, '360-tb');
  assert.strictEqual(meta[ids['vr-180-sbs-v2.mp4']].projection, '180-sbs');
  for (const f of ['clip_360_TB.mp4', 'pano_360.mp4', 'rot90.mp4']) assert.ok(!('projection' in meta[ids[f]]), f + ' carries no projection key');
  // The name rule works at once, at serve time; a flat file serves none.
  assert.strictEqual((await getItem(ids['clip_360_TB.mp4'])).projection, '360-tb');
  assert.strictEqual((await getItem(ids['pano_360.mp4'])).projection, '360');
  assert.strictEqual((await getItem(ids['rot90.mp4'])).projection, undefined);
  assert.strictEqual((await getItem(ids['vr-180-sbs-v2.mp4'])).projection, '180-sbs');
  // Rotation still parses through the grown args: the 512x256 coded frame with a 90 degree flag is 256x512.
  assert.deepStrictEqual([meta[ids['rot90.mp4']].width, meta[ids['rot90.mp4']].height], [256, 512]);

  // An unchanged file is never re-probed and keeps its value (the reuse arm).
  const n = probeCalls().length;
  await scanDirectories();
  assert.strictEqual(probeCalls().length, n, 'no re-probe of unchanged files');
  assert.strictEqual(loadDatabase().metadata[ids['vr-360-v2.mp4']].projection, '360', 'kept across a rescan');
});

test('route: a pick wins at GET, flat hides a sphere, null DELETES the key; validation and RBAC', async () => {
  freshLibrary();
  const id = copyFixture('vr-360-v2.mp4');
  await scanDirectories();
  let r = await pick(id, '180');
  assert.equal(r.status, 200);
  assert.deepStrictEqual(await r.json(), { success: true, projection: '180', projectionOverride: '180' });
  let body = await getItem(id);
  assert.strictEqual(body.projection, '180');
  assert.strictEqual(body.projectionOverride, '180');
  r = await pick(id, 'flat');
  assert.equal(r.status, 200);
  assert.strictEqual((await getItem(id)).projection, undefined, 'flat: no sphere');
  r = await pick(id, null);
  assert.equal(r.status, 200);
  assert.ok(!('projectionOverride' in loadDatabase().metadata[id]), 'the clear deletes the key');
  body = await getItem(id);
  assert.strictEqual(body.projection, '360', 'back to the file');
  assert.strictEqual(body.projectionOverride, undefined);

  for (const bad of ['round', '', 360, 'FLAT', '__proto__', undefined]) {
    const res = await fetch(`${base}/api/videos/${id}/projection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bad === undefined ? {} : { projection: bad }) });
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  assert.ok(!('projectionOverride' in loadDatabase().metadata[id]), 'nothing written by a refused value');
  assert.equal((await pick('does-not-exist', '360')).status, 404);
  assert.equal((await pick('abc\u0000def', '360')).status, 400, 'a NUL-bearing id is refused');

  const member = __mintTestSession({ role: 'member', username: 'vr-member' });
  const res = await pick(id, '360-tb', { Cookie: member.cookie });
  assert.equal(res.status, 403, 'a member cannot set the video type');
  assert.ok(!('projectionOverride' in loadDatabase().metadata[id]), 'nothing written for a member');
});

test('route: an audio item is refused (the video type is video-only)', async () => {
  freshLibrary();
  const filePath = path.join(mediaDir, 'song.mp3');
  fs.writeFileSync(filePath, 'bytes');
  const id = getMediaId(filePath);
  seedState({ folders: [mediaDir], folderSettings: {}, metadata: { [id]: { id, name: 'song.mp3', title: 'song', filePath, folderName: 'x', type: 'audio', ext: '.mp3', size: 5, addedAt: 1, duration: 10, rootFolder: mediaDir } }, settings: { scanIntervalMinutes: 0, pruneMissing: false } });
  assert.equal((await pick(id, '360')).status, 400);
  assert.ok(!('projectionOverride' in loadDatabase().metadata[id]));
});

test('re-init carry: a CHANGED file keeps the owner pick; its own projection is re-derived from the new probe', async () => {
  freshLibrary();
  const id = copyFixture('vr-360-v2.mp4');
  await scanDirectories();
  assert.equal((await pick(id, '360-tb')).status, 200);
  // Same path, new bytes (the 180 SBS file): the scan re-inits and re-probes.
  fs.copyFileSync(path.join(FIX, 'vr-180-sbs-v2.mp4'), path.join(mediaDir, 'vr-360-v2.mp4'));
  // (The stub replays the recording by NAME, so the re-probe reports this name's sphere: the point is
  // that the re-init branch PROBED it and the pick rode across.)
  const n = probeCalls().length;
  await scanDirectories();
  assert.ok(probeCalls().length > n, 'the changed file was re-probed (the re-init branch)');
  const item = loadDatabase().metadata[id];
  assert.strictEqual(item.projectionOverride, '360-tb', 'the owner pick survives a changed file');
  assert.strictEqual(item.projection, '360', 'the file\'s own value comes from the re-init probe (the stub replays this NAME)');
});

test('Phase-2 mirror: a pick and a clear landing MID-SCAN survive the final merge', async () => {
  freshLibrary();
  const picked = copyFixture('vr-360-v1.mp4');
  const cleared = copyFixture('vr-360-tb-v2.mp4');
  await scanDirectories();
  assert.equal((await pick(cleared, '180')).status, 200);
  copyFixture('pano_360.mp4'); // a brand-new file forces the scan through its async probe yield window
  const scanPromise = scanDirectories();
  const p1 = updateDatabase((db) => { if (db.metadata[picked]) db.metadata[picked].projectionOverride = '180-tb'; return true; });
  const p2 = updateDatabase((db) => { if (db.metadata[cleared]) delete db.metadata[cleared].projectionOverride; return true; });
  await Promise.all([scanPromise, p1, p2]);
  const db = loadDatabase();
  assert.strictEqual(db.metadata[picked].projectionOverride, '180-tb', 'a mid-scan pick survives');
  assert.ok(!('projectionOverride' in db.metadata[cleared]), 'a mid-scan clear is not resurrected');
});

test('the OTHER reuse arm (a legacy item with no codec fields: codec-only probe, no re-init) keeps `projection` too', async () => {
  freshLibrary();
  const filePath = path.join(mediaDir, 'vr-360-v2.mp4');
  fs.copyFileSync(path.join(FIX, 'vr-360-v2.mp4'), filePath);
  const id = getMediaId(filePath);
  const size = fs.statSync(filePath).size;
  // An already-indexed item from before the codec fields existed: same path, same size, NO videoCodec/audioCodec.
  seedState({
    folders: [mediaDir], folderSettings: {}, settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    metadata: { [id]: { id, name: 'vr-360-v2.mp4', title: 'legacy', filePath, folderName: path.basename(mediaDir), size, ext: '.mp4', type: 'video', addedAt: 1, duration: 2, hasThumbnail: true, artist: '', projection: '180', rootFolder: mediaDir } },
  });
  const n = probeCalls().length;
  await scanDirectories();
  const item = loadDatabase().metadata[id];
  assert.ok(probeCalls().length > n, 'the legacy arm ran its codec-only probe (non-vacuity)');
  assert.ok('videoCodec' in item, 'the codec fields were backfilled (this WAS the legacy arm)');
  assert.strictEqual(item.title, 'legacy', 'no re-init (the title was not re-derived from the file name)');
  assert.strictEqual(item.projection, '180', 'the stored value is kept: the codec-only probe never writes projection');
});
