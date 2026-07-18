'use strict';

// [UNIT] v1.44 T7 — the ALAC transcode DECISION (musicCodecNeedsTranscode).
// Conservative, positive-identification-only: ONLY a probed 'alac' codec
// transcodes; a null/unknown/absent codec never flags a file (degrade-safe).
// Isolate DATA_DIR so requiring the server is side-effect-free.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));

const { test } = require('node:test');
const assert = require('node:assert');
const { musicCodecNeedsTranscode } = require('../../server');

test('T7: only a positively-identified ALAC codec needs transcoding', () => {
  assert.equal(musicCodecNeedsTranscode('alac'), true);
  assert.equal(musicCodecNeedsTranscode('ALAC'), true, 'case-insensitive');
});

test('T7: native codecs never transcode', () => {
  for (const c of ['mp3', 'aac', 'flac', 'pcm_s16le', 'pcm_s24le', 'opus', 'vorbis']) {
    assert.equal(musicCodecNeedsTranscode(c), false, `${c} streams natively`);
  }
});

test('T7: a null/undefined/empty codec (probe failed / no ffmpeg) NEVER flags (degrade-safe)', () => {
  assert.equal(musicCodecNeedsTranscode(null), false);
  assert.equal(musicCodecNeedsTranscode(undefined), false);
  assert.equal(musicCodecNeedsTranscode(''), false);
  assert.equal(musicCodecNeedsTranscode(42), false);
});
