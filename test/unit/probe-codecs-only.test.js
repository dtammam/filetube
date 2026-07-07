'use strict';

// v1.18.1 hotfix: `probeCodecsOnly(filePath)` is the lightweight,
// CODEC-ONLY probe used by the scan's legacy-video backfill branch (see
// server.js's `legacyVideoCodecBackfillOnly` branch). It must NEVER run an
// ffmpeg frame-grab / art-extraction spawn, and must degrade safely
// (explicit `null`, never `undefined` or a throw) exactly like
// `extractMetadataAndThumbnail`'s codec fields do.
//
// This file exercises the real, unmocked `!ffmpegAvailable` early-return
// path -- there is no ffmpeg/ffprobe binary on the CI runner (per
// docs/RELIABILITY.md), matching a real no-ffmpeg deployment. The
// ffmpeg-available/successful-probe path is covered by the mocked
// child_process suite in test/integration/scan-thumbnail-preserve.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));

const { test } = require('node:test');
const assert = require('node:assert');

const { probeCodecsOnly } = require('../../server');

test('probeCodecsOnly: resolves explicit null/null (never undefined, never throws) when ffmpeg is unavailable', async () => {
  const result = await probeCodecsOnly('/some/nonexistent/path.mp4');
  assert.equal(result.videoCodec, null);
  assert.equal(result.audioCodec, null);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'videoCodec'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'audioCodec'), true);
});

test('probeCodecsOnly: never rejects, even for a path that does not exist', async () => {
  await assert.doesNotReject(probeCodecsOnly('/definitely/does/not/exist.mp4'));
});
