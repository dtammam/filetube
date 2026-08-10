'use strict';

// [UNIT] v1.93.2 storyboard sprites - the DERIVED-descriptor + on-disk-keyed
// heal contract. This REPLACES v1.92's persisted-flag contract, which only
// committed the `storyboard` descriptor at end-of-scan: on a large library that
// finish line was never crossed, so 0/2943 prod records ever carried it and
// NOTHING served. v1.93.2 derives the descriptor from the (persisted) duration
// and keys serving/heal on the on-disk sprite FILE, writing NOTHING to the db.
//
//  - storyboardDescriptor(item): PURE geometry from duration/dims (no fs).
//  - restoreMissingStoryboard: ensures the on-disk sprite exists; on this
//    no-ffmpeg harness extractStoryboard is a no-op, so we assert the
//    file-existence logic + that the item metadata is NEVER mutated.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-sb-persist-'));

const { test } = require('node:test');
const assert = require('node:assert');
const { restoreMissingStoryboard, storyboardPath, storyboardDescriptor } = require('../../server');

function writeSprite(id, bytes = 'JPEGDATA') {
  fs.mkdirSync(path.dirname(storyboardPath(id)), { recursive: true });
  fs.writeFileSync(storyboardPath(id), bytes);
}

// ---- storyboardDescriptor: derived geometry, never persisted ----------------

test('storyboardDescriptor: eligible video -> full geometry from duration + dims', () => {
  const d = storyboardDescriptor({ type: 'video', duration: 79.714104, width: 1920, height: 1080 });
  assert.ok(d, 'eligible');
  assert.strictEqual(d.count, 40);
  assert.strictEqual(d.cols, 10);
  assert.strictEqual(d.rows, 4);
  assert.strictEqual(d.tileW, 320); // v1.93.3: SB_TILE_W 160 -> 320 (crisper tiles)
  assert.strictEqual(d.tileH, Math.round(320 * 1080 / 1920)); // 180
});

test('storyboardDescriptor: tileH falls back to 16:9 when dims are unknown', () => {
  const d = storyboardDescriptor({ type: 'video', duration: 300 });
  assert.strictEqual(d.tileH, Math.round(320 * 9 / 16)); // 180
});

test('storyboardDescriptor: null for audio / too-short / non-video / missing', () => {
  assert.strictEqual(storyboardDescriptor({ type: 'audio', duration: 300 }), null, 'audio excluded');
  assert.strictEqual(storyboardDescriptor({ type: 'video', duration: 1 }), null, 'too short');
  assert.strictEqual(storyboardDescriptor({ type: 'video' }), null, 'no duration');
  assert.strictEqual(storyboardDescriptor(null), null);
  assert.strictEqual(storyboardDescriptor(undefined), null);
});

test('storyboardDescriptor: derived grid matches what generation would tile (MAX regime)', () => {
  // The client renders from this derivation, so it MUST equal the grid
  // extractStoryboard/planStoryboard used to build the on-disk sprite. Same
  // duration -> same grid, so a derived descriptor always describes the real sprite.
  const d = storyboardDescriptor({ type: 'video', duration: 4000, width: 3840, height: 2160 });
  assert.strictEqual(d.count, 100);
  assert.strictEqual(d.cols, 10);
  assert.strictEqual(d.rows, 10);
});

// ---- restoreMissingStoryboard: on-disk-keyed, writes NOTHING to the db ------

test('restore: writes NOTHING to the item metadata (the v1.93.2 decoupling)', async () => {
  const id = 'sb-nowrite';
  const item = { id, type: 'video', duration: 500, width: 1280, height: 720 };
  const before = JSON.stringify(item);
  const ret = await restoreMissingStoryboard(item, id, '/x/b.mp4');
  assert.strictEqual(ret, undefined, 'no persist-signal return (sprite is its own state)');
  assert.strictEqual(JSON.stringify(item), before, 'item is never mutated');
  assert.ok(!('storyboard' in item), 'no storyboard field is ever written to the record');
});

test('restore: a PRESENT non-empty sprite is left on disk untouched (converged, no regen)', async () => {
  const id = 'sb-present';
  writeSprite(id);
  const item = { id, type: 'video', duration: 120, width: 1920, height: 1080 };
  await restoreMissingStoryboard(item, id, '/x/p.mp4');
  assert.ok(fs.existsSync(storyboardPath(id)), 'existing sprite survives');
  assert.strictEqual(fs.readFileSync(storyboardPath(id), 'utf8'), 'JPEGDATA', 'bytes untouched');
  assert.ok(!('storyboard' in item), 'still no db write');
});

test('restore: ineligible AUDIO item REMOVES a stale sprite for its id', async () => {
  const id = 'sb-audio';
  writeSprite(id); // a stale sidecar under this id
  await restoreMissingStoryboard({ id, type: 'audio', duration: 300 }, id, '/x/a.mp3');
  assert.ok(!fs.existsSync(storyboardPath(id)), 'stale sprite removed for an ineligible item');
});

test('restore: too-short video is ineligible -> stale sprite removed', async () => {
  const id = 'sb-short';
  writeSprite(id);
  await restoreMissingStoryboard({ id, type: 'video', duration: 1 }, id, '/x/s.mp4');
  assert.ok(!fs.existsSync(storyboardPath(id)), 'stale sprite removed');
});

test('restore: eligible item with NO sprite on disk attempts generation (no ffmpeg here)', async () => {
  const id = 'sb-backfill';
  const item = { id, type: 'video', duration: 500, width: 1280, height: 720 };
  assert.ok(!fs.existsSync(storyboardPath(id)));
  await restoreMissingStoryboard(item, id, '/x/b.mp4');
  // no ffmpeg on this harness -> attempt is a no-op; still no file, still no db write.
  assert.ok(!('storyboard' in item), 'no db write on a generation attempt');
});
