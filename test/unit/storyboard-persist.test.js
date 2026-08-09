'use strict';

// [UNIT] v1.92 storyboard sprites - the persist-gate/heal contract for the new
// per-item `storyboard` field (this repo's most-scarred bug class). Exercises
// restoreMissingStoryboard (the library BACKFILL + heal path) directly, no
// ffmpeg needed: on this harness ffmpegAvailable is false, so extractStoryboard
// resolves null and we assert the SURROUNDING persist logic (field presence,
// don't-regenerate-a-present-sprite guard, heal-on-delete, ineligible->null).
//
// The "present sprite is left untouched" test is the delete-the-guard MUTATION
// target: remove `if (!missing) return false` in restoreMissingStoryboard and
// this test goes red (the descriptor would be clobbered to null).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-sb-persist-'));

const { test } = require('node:test');
const assert = require('node:assert');
const { restoreMissingStoryboard, storyboardPath } = require('../../server');

const DESC = { v: 1, interval: 2, count: 40, cols: 10, rows: 4, tileW: 160, tileH: 90 };

function writeSprite(id, bytes = 'JPEGDATA') {
  fs.mkdirSync(path.dirname(storyboardPath(id)), { recursive: true });
  fs.writeFileSync(storyboardPath(id), bytes);
}

// ---- ineligible items: field always ends up present as null -----------------

test('restore: audio item gets an explicit null storyboard (persist-gate presence)', async () => {
  const item = { id: 'sb-audio', type: 'audio', duration: 300 };
  const changed = await restoreMissingStoryboard(item, item.id, '/x/a.mp3');
  assert.strictEqual(item.storyboard, null);
  assert.strictEqual(changed, true, 'setting the field from undefined is a change to persist');
});

test('restore: too-short video -> null; already-null is a no-op (no scan churn)', async () => {
  const item = { id: 'sb-short', type: 'video', duration: 1, storyboard: null };
  const changed = await restoreMissingStoryboard(item, item.id, '/x/s.mp4');
  assert.strictEqual(item.storyboard, null);
  assert.strictEqual(changed, false, 'already null + ineligible -> no change');
});

// ---- the guard: a PRESENT sprite is never regenerated -----------------------

test('restore: eligible item with a present non-empty sprite is left UNTOUCHED (guard)', async () => {
  const id = 'sb-present';
  writeSprite(id);
  const item = { id, type: 'video', duration: 120, width: 1920, height: 1080, storyboard: { ...DESC } };
  const changed = await restoreMissingStoryboard(item, id, '/x/p.mp4');
  assert.strictEqual(changed, false, 'nothing to heal');
  // DELETE-THE-GUARD MUTATION: without `if (!missing) return false`, this would
  // call extractStoryboard (null on this no-ffmpeg harness) and clobber it.
  assert.deepStrictEqual(item.storyboard, DESC, 'descriptor preserved byte-for-byte');
});

// ---- heal on delete + backfill ----------------------------------------------

test('restore: eligible item whose sprite FILE is gone re-attempts (heal-on-delete)', async () => {
  const id = 'sb-filegone';
  // descriptor present but NO file on disk
  const item = { id, type: 'video', duration: 120, width: 1920, height: 1080, storyboard: { ...DESC } };
  assert.ok(!fs.existsSync(storyboardPath(id)));
  const changed = await restoreMissingStoryboard(item, id, '/x/g.mp4');
  assert.strictEqual(changed, true, 'a missing sprite triggers a regeneration attempt');
  // no ffmpeg on this harness -> attempt yields null (self-heals on a real box).
  assert.strictEqual(item.storyboard, null);
});

test('restore: eligible item with NO descriptor (legacy backfill) attempts generation', async () => {
  const id = 'sb-backfill';
  const item = { id, type: 'video', duration: 500, width: 1280, height: 720 }; // no storyboard key
  const changed = await restoreMissingStoryboard(item, id, '/x/b.mp4');
  assert.strictEqual(changed, true);
  assert.strictEqual(item.storyboard, null, 'no ffmpeg here; field is now explicitly present');
});

test('restore: an EMPTY (zero-byte) sprite counts as missing and re-attempts', async () => {
  const id = 'sb-empty';
  writeSprite(id, ''); // zero bytes
  const item = { id, type: 'video', duration: 120, width: 1920, height: 1080, storyboard: { ...DESC } };
  const changed = await restoreMissingStoryboard(item, id, '/x/e.mp4');
  assert.strictEqual(changed, true, 'zero-byte sprite is treated as absent');
});
