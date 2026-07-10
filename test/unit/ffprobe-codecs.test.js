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
  isValidMediaDimension,
  isPrimitiveNumericInput,
  MAX_MEDIA_DIMENSION,
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

// ---------------------------------------------------------------------------
// Feature A (v1.26.1, Shorts player-size jump): parseFfprobeStreams width/
// height, fed real-shaped ffprobe JSON (incl. attached_pic stream ordering,
// mirroring the codec tests above).
// ---------------------------------------------------------------------------

test('parseFfprobeStreams: extracts width/height from the real (non-attached_pic) video stream, a real-shaped ffprobe -show_entries payload', () => {
  const j = {
    format: { duration: '12.345000' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, disposition: { attached_pic: 0 } },
      { codec_type: 'audio', codec_name: 'aac', disposition: { attached_pic: 0 } },
    ],
  };
  const out = parseFfprobeStreams(j);
  assert.equal(out.width, 1080);
  assert.equal(out.height, 1920);
});

test('parseFfprobeStreams: an embedded cover-art (attached_pic) stream ordered FIRST never contributes width/height -- the real stream after it does', () => {
  const j = {
    streams: [
      { codec_type: 'video', codec_name: 'mjpeg', width: 500, height: 500, disposition: { attached_pic: 1 } },
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, disposition: { attached_pic: 0 } },
    ],
  };
  const out = parseFfprobeStreams(j);
  assert.equal(out.videoCodec, 'h264');
  assert.equal(out.width, 1920, 'must use the REAL video stream\'s width, not the attached_pic cover art\'s');
  assert.equal(out.height, 1080);
});

test('parseFfprobeStreams: an attached_pic-only stream set (no real video track, e.g. an audio file) leaves width/height absent', () => {
  const j = {
    streams: [
      { codec_type: 'video', codec_name: 'mjpeg', width: 500, height: 500, disposition: { attached_pic: 1 } },
      { codec_type: 'audio', codec_name: 'mp3' },
    ],
  };
  const out = parseFfprobeStreams(j);
  assert.equal('width' in out, false);
  assert.equal('height' in out, false);
});

test('parseFfprobeStreams: accepts string-typed width/height (ffprobe sometimes reports numeric fields as strings)', () => {
  const out = parseFfprobeStreams({ streams: [{ codec_type: 'video', codec_name: 'h264', width: '1920', height: '1080' }] });
  assert.equal(out.width, 1920);
  assert.equal(out.height, 1080);
});

test('parseFfprobeStreams: non-integer/zero/negative/missing width or height is left absent', () => {
  assert.equal('width' in parseFfprobeStreams({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 0, height: 1080 }] }), false);
  assert.equal('width' in parseFfprobeStreams({ streams: [{ codec_type: 'video', codec_name: 'h264', width: -5, height: 1080 }] }), false);
  assert.equal('width' in parseFfprobeStreams({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920.5, height: 1080 }] }), false);
  assert.equal('width' in parseFfprobeStreams({ streams: [{ codec_type: 'video', codec_name: 'h264', height: 1080 }] }), false);
});

test('parseFfprobeStreams: a width/height above MAX_MEDIA_DIMENSION is rejected (left absent) -- guards against a corrupt probe', () => {
  const out = parseFfprobeStreams({ streams: [{ codec_type: 'video', codec_name: 'h264', width: MAX_MEDIA_DIMENSION + 1, height: 1080 }] });
  assert.equal('width' in out, false);
  const atBound = parseFfprobeStreams({ streams: [{ codec_type: 'video', codec_name: 'h264', width: MAX_MEDIA_DIMENSION, height: MAX_MEDIA_DIMENSION }] });
  assert.equal(atBound.width, MAX_MEDIA_DIMENSION);
  assert.equal(atBound.height, MAX_MEDIA_DIMENSION);
});

test('parseFfprobeStreams: an audio-only stream set never carries width/height', () => {
  const out = parseFfprobeStreams({ streams: [{ codec_type: 'audio', codec_name: 'aac' }] });
  assert.equal('width' in out, false);
  assert.equal('height' in out, false);
});

// ---------------------------------------------------------------------------
// F2 (v1.26.1 two-reviewer follow-up): rotation-aware width/height --
// ffprobe's raw width/height are CODED dims; a rotation-flagged phone video
// needs them swapped to match the browser's rotation-corrected
// videoWidth/videoHeight. `side_data_list` shape mirrors ffprobe's real
// `-show_entries stream_side_data=rotation` output (a "Display Matrix"
// entry carrying a signed `rotation` degree field).
// ---------------------------------------------------------------------------

test('parseFfprobeStreams: rotation 90 swaps landscape-coded dims to portrait display dims', () => {
  const j = {
    streams: [{
      codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080,
      side_data_list: [{ side_data_type: 'Display Matrix', rotation: 90 }],
    }],
  };
  const out = parseFfprobeStreams(j);
  assert.equal(out.width, 1080);
  assert.equal(out.height, 1920);
});

test('parseFfprobeStreams: rotation -90 (negative) also swaps -- only the axis, not the spin direction, matters', () => {
  const j = {
    streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }],
  };
  const out = parseFfprobeStreams(j);
  assert.equal(out.width, 1080);
  assert.equal(out.height, 1920);
});

test('parseFfprobeStreams: rotation 270 also swaps', () => {
  const j = {
    streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, side_data_list: [{ rotation: 270 }] }],
  };
  const out = parseFfprobeStreams(j);
  assert.equal(out.width, 1080);
  assert.equal(out.height, 1920);
});

test('parseFfprobeStreams: rotation -270 also swaps', () => {
  const j = {
    streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, side_data_list: [{ rotation: -270 }] }],
  };
  const out = parseFfprobeStreams(j);
  assert.equal(out.width, 1080);
  assert.equal(out.height, 1920);
});

test('parseFfprobeStreams: rotation 0 leaves coded dims unswapped', () => {
  const j = {
    streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, side_data_list: [{ rotation: 0 }] }],
  };
  const out = parseFfprobeStreams(j);
  assert.equal(out.width, 1920);
  assert.equal(out.height, 1080);
});

test('parseFfprobeStreams: rotation 180 leaves coded dims unswapped (upside-down, not a portrait/landscape turn)', () => {
  const j = {
    streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, side_data_list: [{ rotation: 180 }] }],
  };
  const out = parseFfprobeStreams(j);
  assert.equal(out.width, 1920);
  assert.equal(out.height, 1080);
});

test('parseFfprobeStreams: rotation absent (no side_data_list at all) leaves coded dims unswapped', () => {
  const out = parseFfprobeStreams({ streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 }] });
  assert.equal(out.width, 1920);
  assert.equal(out.height, 1080);
});

test('parseFfprobeStreams: an empty side_data_list, or one whose entries never carry a rotation field, leaves coded dims unswapped', () => {
  const j1 = { streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, side_data_list: [] }] };
  assert.equal(parseFfprobeStreams(j1).width, 1920);
  const j2 = { streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, side_data_list: [{ side_data_type: 'Content Light Level' }] }] };
  assert.equal(parseFfprobeStreams(j2).width, 1920);
});

test('parseFfprobeStreams: a string-typed rotation ("90") is still accepted (ffprobe sometimes reports numeric fields as strings)', () => {
  const j = { streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, side_data_list: [{ rotation: '90' }] }] };
  const out = parseFfprobeStreams(j);
  assert.equal(out.width, 1080);
  assert.equal(out.height, 1920);
});

test('parseFfprobeStreams: side_data on the attached_pic (cover-art) stream is ignored -- only the real video stream\'s rotation drives the swap', () => {
  const j = {
    streams: [
      { codec_type: 'video', codec_name: 'mjpeg', width: 500, height: 500, disposition: { attached_pic: 1 }, side_data_list: [{ rotation: 90 }] },
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, disposition: { attached_pic: 0 } },
    ],
  };
  const out = parseFfprobeStreams(j);
  assert.equal(out.width, 1920, 'the cover-art stream\'s own rotation must never affect the real video stream\'s dims');
  assert.equal(out.height, 1080);
});

test('parseFfprobeStreams: rotation never swaps when the coded width or height itself was rejected (e.g. oversized/invalid)', () => {
  const j = {
    streams: [{
      codec_type: 'video', codec_name: 'h264', width: MAX_MEDIA_DIMENSION + 1, height: 1080,
      side_data_list: [{ rotation: 90 }],
    }],
  };
  const out = parseFfprobeStreams(j);
  assert.equal('width' in out, false);
  assert.equal(out.height, 1080, 'height must not be swapped into the rejected width slot');
});

// ---------------------------------------------------------------------------
// isValidMediaDimension (shared by parseFfprobeStreams above and the
// POST /api/videos/:id/dimensions endpoint's own validation)
// ---------------------------------------------------------------------------

test('isValidMediaDimension: accepts any positive integer up to and including MAX_MEDIA_DIMENSION', () => {
  assert.equal(isValidMediaDimension(1), true);
  assert.equal(isValidMediaDimension(1080), true);
  assert.equal(isValidMediaDimension(MAX_MEDIA_DIMENSION), true);
});

test('isValidMediaDimension: rejects zero, negative, non-integer, oversized, and non-numeric input', () => {
  assert.equal(isValidMediaDimension(0), false);
  assert.equal(isValidMediaDimension(-1), false);
  assert.equal(isValidMediaDimension(1080.5), false);
  assert.equal(isValidMediaDimension(MAX_MEDIA_DIMENSION + 1), false);
  assert.equal(isValidMediaDimension(NaN), false);
  assert.equal(isValidMediaDimension(Infinity), false);
  assert.equal(isValidMediaDimension(undefined), false);
  assert.equal(isValidMediaDimension(null), false);
  assert.equal(isValidMediaDimension('1080'), false, 'a string is never coerced -- callers must Number() it first');
});

// ---------------------------------------------------------------------------
// F3 (v1.26.1 two-reviewer follow-up, NIT): isPrimitiveNumericInput -- the
// POST /api/videos/:id/dimensions body-shape guard run BEFORE Number(), so
// a non-primitive coercible value ([1920], true, '0x10') can never sail
// through as a plausible-looking positive integer.
// ---------------------------------------------------------------------------

test('isPrimitiveNumericInput: accepts a plain JS number, including 0/negative (isValidMediaDimension rejects those separately)', () => {
  assert.equal(isPrimitiveNumericInput(1920), true);
  assert.equal(isPrimitiveNumericInput(0), true);
  assert.equal(isPrimitiveNumericInput(-5), true);
  assert.equal(isPrimitiveNumericInput(1080.5), true);
});

test('isPrimitiveNumericInput: accepts a base-10 digit-only string', () => {
  assert.equal(isPrimitiveNumericInput('1920'), true);
  assert.equal(isPrimitiveNumericInput('0'), true);
});

test('isPrimitiveNumericInput: rejects a single-element array, which Number() would otherwise unwrap (Number([1920]) === 1920)', () => {
  assert.equal(isPrimitiveNumericInput([1920]), false);
});

test('isPrimitiveNumericInput: rejects a boolean, which Number() would otherwise coerce (Number(true) === 1)', () => {
  assert.equal(isPrimitiveNumericInput(true), false);
  assert.equal(isPrimitiveNumericInput(false), false);
});

test('isPrimitiveNumericInput: rejects a hex string, which Number() would otherwise parse (Number(\'0x10\') === 16)', () => {
  assert.equal(isPrimitiveNumericInput('0x10'), false);
});

test('isPrimitiveNumericInput: rejects other non-digit-only strings (negative, decimal, exponential, whitespace-padded)', () => {
  assert.equal(isPrimitiveNumericInput('-5'), false);
  assert.equal(isPrimitiveNumericInput('19.5'), false);
  assert.equal(isPrimitiveNumericInput('1e3'), false);
  assert.equal(isPrimitiveNumericInput(' 1920 '), false);
  assert.equal(isPrimitiveNumericInput(''), false);
});

test('isPrimitiveNumericInput: rejects null/undefined/object', () => {
  assert.equal(isPrimitiveNumericInput(null), false);
  assert.equal(isPrimitiveNumericInput(undefined), false);
  assert.equal(isPrimitiveNumericInput({}), false);
});
