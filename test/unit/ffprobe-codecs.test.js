'use strict';

// FR-1b (v1.18.0): parseFfprobeStreams / codecNeedsTranscode / the
// codec-aware needsTranscode(ext, videoCodec, audioCodec) are exported from
// server.js. Isolate DATA_DIR so requiring the server is side-effect-free
// (own process per test file, per the existing pure-helper test pattern) --
// ffmpeg/ffprobe are never invoked here; all ffprobe output is mocked, per
// docs/RELIABILITY.md's "ffmpeg stays out of CI" standard.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));

const { test } = require('node:test');
const assert = require('node:assert');

const {
  parseFfprobeStreams,
  codecNeedsTranscode,
  needsTranscode,
  PLAYABLE_VIDEO_CODECS,
  PLAYABLE_AUDIO_CODECS,
} = require('../../server');

// ---------------------------------------------------------------------------
// parseFfprobeStreams
// ---------------------------------------------------------------------------

test('parseFfprobeStreams: extracts the first video and first audio stream codec, lowercased', () => {
  const j = {
    streams: [
      { codec_type: 'video', codec_name: 'H264' },
      { codec_type: 'audio', codec_name: 'AAC' },
    ],
  };
  const out = parseFfprobeStreams(j);
  assert.equal(out.videoCodec, 'h264');
  assert.equal(out.audioCodec, 'aac');
});

test('parseFfprobeStreams: accepts a raw JSON string too', () => {
  const s = JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'hevc' }] });
  const out = parseFfprobeStreams(s);
  assert.equal(out.videoCodec, 'hevc');
  assert.equal(out.audioCodec, undefined);
});

test('parseFfprobeStreams: video-only input has no audioCodec key', () => {
  const out = parseFfprobeStreams({ streams: [{ codec_type: 'video', codec_name: 'h264' }] });
  assert.equal(out.videoCodec, 'h264');
  assert.equal('audioCodec' in out, false);
});

test('parseFfprobeStreams: audio-only input has no videoCodec key', () => {
  const out = parseFfprobeStreams({ streams: [{ codec_type: 'audio', codec_name: 'mp3' }] });
  assert.equal(out.audioCodec, 'mp3');
  assert.equal('videoCodec' in out, false);
});

test('parseFfprobeStreams: neither stream type present returns {}', () => {
  assert.deepEqual(parseFfprobeStreams({ streams: [] }), {});
  assert.deepEqual(parseFfprobeStreams({ streams: [{ codec_type: 'subtitle', codec_name: 'mov_text' }] }), {});
});

test('parseFfprobeStreams: takes the FIRST stream of each type when multiple are present', () => {
  const j = {
    streams: [
      { codec_type: 'video', codec_name: 'h264' },
      { codec_type: 'video', codec_name: 'mjpeg' }, // e.g. an embedded cover-art "video" stream
      { codec_type: 'audio', codec_name: 'aac' },
      { codec_type: 'audio', codec_name: 'ac3' },
    ],
  };
  const out = parseFfprobeStreams(j);
  assert.equal(out.videoCodec, 'h264');
  assert.equal(out.audioCodec, 'aac');
});

test('parseFfprobeStreams: returns {} on malformed / empty / missing streams — never throws', () => {
  assert.deepEqual(parseFfprobeStreams('{ not json'), {});
  assert.deepEqual(parseFfprobeStreams(null), {});
  assert.deepEqual(parseFfprobeStreams({}), {});
  assert.deepEqual(parseFfprobeStreams({ streams: 'not-an-array' }), {});
  assert.deepEqual(parseFfprobeStreams({ streams: [null, 42, { codec_type: 'video' }] }), {});
});

// ---------------------------------------------------------------------------
// Cover-art / attached_pic trap (two-reviewer follow-up fix)
// ---------------------------------------------------------------------------

test('parseFfprobeStreams: skips a cover-art (attached_pic) video stream ordered FIRST, resolving to the real H.264 stream after it', () => {
  const j = {
    streams: [
      { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
      { codec_type: 'video', codec_name: 'h264', disposition: { attached_pic: 0 } },
      { codec_type: 'audio', codec_name: 'aac', disposition: { attached_pic: 0 } },
    ],
  };
  const out = parseFfprobeStreams(j);
  assert.equal(out.videoCodec, 'h264', 'the attached_pic cover-art stream must be skipped, not selected as videoCodec');
  assert.equal(out.audioCodec, 'aac');
});

test('parseFfprobeStreams: skips attached_pic cover-art first, still surfaces a real non-allowlisted codec (HEVC) after it', () => {
  const j = {
    streams: [
      { codec_type: 'video', codec_name: 'png', disposition: { attached_pic: 1 } },
      { codec_type: 'video', codec_name: 'hevc', disposition: { attached_pic: 0 } },
    ],
  };
  const out = parseFfprobeStreams(j);
  assert.equal(out.videoCodec, 'hevc', 'the real (non-allowlisted) video stream must still be found and correctly flaggable');
  assert.equal(codecNeedsTranscode(out.videoCodec, out.audioCodec), true);
});

test('parseFfprobeStreams: an attached_pic-only stream set (no real video track) leaves videoCodec absent', () => {
  const j = {
    streams: [
      { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
      { codec_type: 'audio', codec_name: 'aac', disposition: { attached_pic: 0 } },
    ],
  };
  const out = parseFfprobeStreams(j);
  assert.equal('videoCodec' in out, false, 'no real video stream -> videoCodec must not be set (never flagged)');
  assert.equal(out.audioCodec, 'aac');
  assert.equal(codecNeedsTranscode(out.videoCodec, out.audioCodec), false);
});

test('parseFfprobeStreams: streams without any disposition field parse exactly as before (degrade-safe default)', () => {
  const j = {
    streams: [
      { codec_type: 'video', codec_name: 'h264' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  };
  const out = parseFfprobeStreams(j);
  assert.equal(out.videoCodec, 'h264');
  assert.equal(out.audioCodec, 'aac');
});

test('parseFfprobeStreams: a video stream with disposition present but attached_pic:0 is treated as a real stream', () => {
  const out = parseFfprobeStreams({
    streams: [{ codec_type: 'video', codec_name: 'hevc', disposition: { attached_pic: 0, default: 1 } }],
  });
  assert.equal(out.videoCodec, 'hevc');
});

// ---------------------------------------------------------------------------
// Allowlist constants
// ---------------------------------------------------------------------------

test('allowlist constants: H.264/AVC video + AAC audio only', () => {
  assert.deepEqual([...PLAYABLE_VIDEO_CODECS].sort(), ['avc1', 'h264']);
  assert.deepEqual([...PLAYABLE_AUDIO_CODECS], ['aac']);
});

// ---------------------------------------------------------------------------
// codecNeedsTranscode
// ---------------------------------------------------------------------------

test('codecNeedsTranscode: allowlisted h264/avc1 video + aac audio never flag', () => {
  assert.equal(codecNeedsTranscode('h264', 'aac'), false);
  assert.equal(codecNeedsTranscode('avc1', 'aac'), false);
});

test('codecNeedsTranscode: non-allowlisted video codecs flag (HEVC/VP9/AV1/MPEG-4 Part 2)', () => {
  for (const v of ['hevc', 'vp9', 'av1', 'mpeg4']) {
    assert.equal(codecNeedsTranscode(v, 'aac'), true, `${v} should flag`);
  }
});

test('codecNeedsTranscode: non-allowlisted audio codecs flag (AC-3/DTS/E-AC-3)', () => {
  for (const a of ['ac3', 'dts', 'eac3']) {
    assert.equal(codecNeedsTranscode('h264', a), true, `${a} should flag`);
  }
});

test('codecNeedsTranscode: undefined/missing codecs never flag (degrade-safe)', () => {
  assert.equal(codecNeedsTranscode(undefined, undefined), false);
  assert.equal(codecNeedsTranscode('h264', undefined), false);
  assert.equal(codecNeedsTranscode(undefined, 'aac'), false);
  assert.equal(codecNeedsTranscode(null, null), false);
});

// ---------------------------------------------------------------------------
// needsTranscode: generalized signature, existing behavior unchanged
// ---------------------------------------------------------------------------

test('needsTranscode: existing extension-only cases still pass unchanged (single-arg call)', () => {
  for (const ext of ['.avi', '.flv', '.wmv', '.mpg', '.mpeg']) {
    assert.equal(needsTranscode(ext), true, `${ext} should need transcoding`);
  }
  for (const ext of ['.mp4', '.mkv', '.webm', '.mov', '.m4v']) {
    assert.equal(needsTranscode(ext), false, `${ext} should not need transcoding`);
  }
  assert.equal(needsTranscode('.AVI'), false, 'still case-sensitive');
});

test('needsTranscode: extension flag takes effect regardless of a (degrade-safe) codec argument', () => {
  // An already-flagged extension stays flagged even given allowlisted codecs
  // (no call site should ever try to "unflag" via codecs; extension always wins).
  assert.equal(needsTranscode('.avi', 'h264', 'aac'), true);
});

test('needsTranscode: flags a web-safe container whose codec is non-allowlisted (HEVC video)', () => {
  assert.equal(needsTranscode('.mp4', 'hevc', 'aac'), true);
});

test('needsTranscode: flags a web-safe container whose codec is non-allowlisted (AC-3 audio)', () => {
  assert.equal(needsTranscode('.mkv', 'h264', 'ac3'), true);
});

test('needsTranscode: web-safe container with allowlisted codecs does not need transcoding', () => {
  assert.equal(needsTranscode('.mp4', 'h264', 'aac'), false);
  assert.equal(needsTranscode('.webm', 'avc1', 'aac'), false);
});

test('needsTranscode: web-safe container with unknown/unprobed codecs does not need transcoding (degrade-safe)', () => {
  assert.equal(needsTranscode('.mp4', undefined, undefined), false);
  assert.equal(needsTranscode('.mov', null, null), false);
});
