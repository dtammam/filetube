'use strict';

// [UNIT] v1.111 (Dean, streaming Tier 1): lib/faststart.js -- MP4 faststart
// detection (pure box-walk) + the safe, atomic, graceful in-place remux.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  probeMp4Faststart, buildFaststartRemuxArgs, isFaststartEligible, remuxFaststartInPlace,
} = require('../../lib/faststart');

// ---- helpers: craft a minimal MP4 as a real temp file with a given box order -
function box(type) {
  const size = 8 + 16; // 8-byte header + 16 payload bytes (zeros)
  const b = Buffer.alloc(size);
  b.writeUInt32BE(size, 0);
  b.write(type, 4, 'latin1');
  return b;
}
function writeMp4(order) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-faststart-')), 'v.mp4');
  fs.writeFileSync(p, Buffer.concat(order.map(box)));
  return p;
}

// ---- probeMp4Faststart -------------------------------------------------------
test('probeMp4Faststart: moov BEFORE mdat -> faststart true', () => {
  const p = writeMp4(['ftyp', 'moov', 'mdat']);
  assert.strictEqual(probeMp4Faststart(p).faststart, true);
});
test('probeMp4Faststart: moov AFTER mdat -> faststart false (the case we remux)', () => {
  const p = writeMp4(['ftyp', 'mdat', 'moov']);
  assert.strictEqual(probeMp4Faststart(p).faststart, false);
});
test('probeMp4Faststart: no moov seen -> null (leave alone)', () => {
  const p = writeMp4(['ftyp', 'mdat', 'free']);
  assert.strictEqual(probeMp4Faststart(p).faststart, null);
});
test('probeMp4Faststart: non-mp4-box garbage -> null (never claims false)', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-faststart-')), 'x.mp4');
  fs.writeFileSync(p, Buffer.from('not an mp4 file at all, just text bytes here'));
  assert.strictEqual(probeMp4Faststart(p).faststart, null);
});

// ---- buildFaststartRemuxArgs / isFaststartEligible ---------------------------
test('buildFaststartRemuxArgs: lossless copy + faststart, in->out', () => {
  assert.deepStrictEqual(
    buildFaststartRemuxArgs('/in.mp4', '/out.mp4'),
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', '/in.mp4', '-c', 'copy', '-movflags', '+faststart', '/out.mp4']
  );
});
test('isFaststartEligible: ONLY .mp4 (never webm/mkv/mp3) -- the hard safety boundary', () => {
  assert.ok(isFaststartEligible('/a/b.mp4'));
  assert.ok(isFaststartEligible('/a/B.MP4'));
  assert.ok(!isFaststartEligible('/a/b.webm'), 'webm never gets -movflags');
  assert.ok(!isFaststartEligible('/a/b.mkv'));
  assert.ok(!isFaststartEligible('/a/b.mp3'));
  assert.ok(!isFaststartEligible(null));
});

// ---- remuxFaststartInPlace: orchestration with injected spawn/fs/probe --------
function fakeFsi(overrides = {}) {
  const calls = { renamed: null, unlinked: [], utimes: null };
  const base = {
    statSync: () => ({ atime: new Date(1000), mtime: new Date(2000) }),
    existsSync: () => false,
    unlinkSync: (p) => { calls.unlinked.push(p); },
    renameSync: (from, to) => { calls.renamed = { from, to }; },
    utimesSync: (p, a, m) => { calls.utimes = { p, a, m }; },
  };
  return { io: Object.assign(base, overrides), calls };
}
function fakeSpawn(exitCode) {
  return () => {
    const handlers = {};
    setImmediate(() => { if (handlers.close) handlers.close(exitCode); });
    return { on: (ev, fn) => { handlers[ev] = fn; } };
  };
}

test('remuxFaststartInPlace: non-mp4 -> skip-non-mp4 (no spawn, no touch)', async () => {
  let spawned = false;
  const outcome = await remuxFaststartInPlace('/x.webm', { spawn: () => { spawned = true; return { on() {} }; } });
  assert.strictEqual(outcome, 'skip-non-mp4');
  assert.strictEqual(spawned, false);
});

test('remuxFaststartInPlace: already faststart -> skip-not-trailing (original untouched)', async () => {
  const { io, calls } = fakeFsi();
  const outcome = await remuxFaststartInPlace('/a.mp4', {
    fsi: io, probe: () => ({ faststart: true }), spawn: () => { throw new Error('must not spawn'); },
  });
  assert.strictEqual(outcome, 'skip-not-trailing');
  assert.strictEqual(calls.renamed, null, 'original never replaced');
});

test('remuxFaststartInPlace: trailing moov + ffmpeg OK + temp faststart -> remuxed (atomic rename + mtime restored)', async () => {
  const { io, calls } = fakeFsi();
  // probe: original trailing (false), then the temp verifies as faststart (true).
  let n = 0;
  const probe = () => (n++ === 0 ? { faststart: false } : { faststart: true });
  const outcome = await remuxFaststartInPlace('/a.mp4', { fsi: io, probe, spawn: fakeSpawn(0) });
  assert.strictEqual(outcome, 'remuxed');
  assert.deepStrictEqual(calls.renamed, { from: '/a.mp4.faststart.tmp.mp4', to: '/a.mp4' }, 'atomic rename of temp over original');
  assert.ok(calls.utimes && calls.utimes.p === '/a.mp4', 'original mtime restored (no scan/tombstone churn)');
});

test('remuxFaststartInPlace: ffmpeg NON-ZERO -> failed, ORIGINAL UNTOUCHED, temp cleaned', async () => {
  const { io, calls } = fakeFsi({ existsSync: () => true });
  const outcome = await remuxFaststartInPlace('/a.mp4', {
    fsi: io, probe: () => ({ faststart: false }), spawn: fakeSpawn(1),
  });
  assert.strictEqual(outcome, 'failed');
  assert.strictEqual(calls.renamed, null, 'original NEVER replaced on failure (no data loss)');
  assert.ok(calls.unlinked.includes('/a.mp4.faststart.tmp.mp4'), 'temp cleaned up');
});

test('remuxFaststartInPlace: ffmpeg OK but temp NOT faststart -> failed, original untouched (never swap in a dud)', async () => {
  const { io, calls } = fakeFsi({ existsSync: () => true });
  let n = 0;
  const probe = () => (n++ === 0 ? { faststart: false } : { faststart: false }); // temp still bad
  const outcome = await remuxFaststartInPlace('/a.mp4', { fsi: io, probe, spawn: fakeSpawn(0) });
  assert.strictEqual(outcome, 'failed');
  assert.strictEqual(calls.renamed, null, 'never replace the good original with a non-faststart dud');
});

test('remuxFaststartInPlace: spawn throws -> failed (never throws out)', async () => {
  const { io, calls } = fakeFsi({ existsSync: () => true });
  const outcome = await remuxFaststartInPlace('/a.mp4', {
    fsi: io, probe: () => ({ faststart: false }), spawn: () => { throw new Error('no ffmpeg'); },
  });
  assert.strictEqual(outcome, 'failed');
  assert.strictEqual(calls.renamed, null);
});
