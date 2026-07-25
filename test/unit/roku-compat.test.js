'use strict';

// v1.46 Roku compatibility renditions -- pure verdict/args/signature logic
// (lib/rokuCompat.js). No server require, no ffmpeg: every probe result is
// canned JSON, per docs/RELIABILITY.md's "ffmpeg stays out of CI" standard.
// Fixtures deliberately DIVERGE where reality does (the v1.41.9 lesson):
// the attached-pic fixture mirrors Dean's actual failing yt-dlp file
// (h264 High yuv420p + png attached_pic), the rotation fixtures cover both
// signs and the 180 case, and the MP3-with-art fixture proves audio files
// can never be remuxed into a wrong container.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  rokuCompatVerdict,
  buildStripArgs,
  buildRotateArgs,
  sourceSignature,
  signatureMatches,
  isInsideAnyRoot,
} = require('../../lib/rokuCompat');

// ---------------------------------------------------------------------------
// rokuCompatVerdict
// ---------------------------------------------------------------------------

// Dean's on-device evidence, 2026-07-25: yt-dlp --embed-thumbnail file.
const ATTACHED_PIC_MP4 = {
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, disposition: { attached_pic: 0 } },
    { codec_type: 'audio', codec_name: 'aac' },
    { codec_type: 'video', codec_name: 'png', width: 1280, height: 720, disposition: { attached_pic: 1 } },
  ],
};

test('verdict: embedded cover-art track -> strip', () => {
  const out = rokuCompatVerdict(ATTACHED_PIC_MP4);
  assert.equal(out.verdict, 'strip');
  assert.equal(out.attachedPicCount, 1);
});

// Dean's ACTUAL failing file (ffprobe on-device 2026-07-25): the yt-dlp
// thumbnail is a second video stream WITHOUT the attached_pic flag, plus a
// bin_data track. v1.46.0 mis-verdicted this 'clean'; v1.46.1 must strip.
const UNFLAGGED_THUMB_MP4 = {
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', disposition: { attached_pic: 0 } },
    { index: 1, codec_type: 'audio', codec_name: 'aac', disposition: { attached_pic: 0 } },
    { index: 2, codec_type: 'video', codec_name: 'png', disposition: { attached_pic: 0 } },
    { index: 3, codec_type: 'data', codec_name: 'bin_data', disposition: { attached_pic: 0 } },
  ],
};

test('verdict: UNFLAGGED second video stream (Dean\'s yt-dlp file) -> strip', () => {
  const out = rokuCompatVerdict(UNFLAGGED_THUMB_MP4);
  assert.equal(out.verdict, 'strip');
});

test('verdict: a lone stray data stream (single real video) -> strip', () => {
  const out = rokuCompatVerdict({
    streams: [
      { codec_type: 'video', codec_name: 'h264', disposition: { attached_pic: 0 } },
      { codec_type: 'audio', codec_name: 'aac' },
      { codec_type: 'data', codec_name: 'bin_data' },
    ],
  });
  assert.equal(out.verdict, 'strip');
});

test('verdict: an embedded SUBTITLE alone does not force a strip (Roku handles mov_text; captions are sidecar)', () => {
  const out = rokuCompatVerdict({
    streams: [
      { codec_type: 'video', codec_name: 'h264', disposition: { attached_pic: 0 } },
      { codec_type: 'audio', codec_name: 'aac' },
      { codec_type: 'subtitle', codec_name: 'mov_text' },
    ],
  });
  assert.equal(out.verdict, 'clean');
});

test('verdict: clean h264/aac mp4 -> clean', () => {
  const out = rokuCompatVerdict({
    streams: [
      { codec_type: 'video', codec_name: 'h264', disposition: { attached_pic: 0 } },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  });
  assert.equal(out.verdict, 'clean');
});

test('verdict: rotation on the real video stream -> rotate, either sign, incl. 180', () => {
  for (const rotation of [90, -90, 180, 270, -270]) {
    const out = rokuCompatVerdict({
      streams: [
        { codec_type: 'video', codec_name: 'h264', side_data_list: [{ rotation }] },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    });
    assert.equal(out.verdict, 'rotate', `rotation ${rotation}`);
    assert.equal(out.rotation, rotation);
  }
});

test('verdict: rotation of 0 / 360 / -360 is not a rotation', () => {
  for (const rotation of [0, 360, -360]) {
    const out = rokuCompatVerdict({
      streams: [{ codec_type: 'video', codec_name: 'h264', side_data_list: [{ rotation }] }],
    });
    assert.equal(out.verdict, 'clean', `rotation ${rotation}`);
  }
});

test('verdict: rotated video that ALSO carries cover art -> rotate wins (re-encode drops the art too)', () => {
  const out = rokuCompatVerdict({
    streams: [
      { codec_type: 'video', codec_name: 'h264', side_data_list: [{ rotation: -90 }] },
      { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  });
  assert.equal(out.verdict, 'rotate');
  assert.equal(out.attachedPicCount, 1);
});

test('verdict: rotation flag on the cover-art stream itself is ignored', () => {
  const out = rokuCompatVerdict({
    streams: [
      { codec_type: 'video', codec_name: 'h264' },
      { codec_type: 'video', codec_name: 'png', disposition: { attached_pic: 1 }, side_data_list: [{ rotation: -90 }] },
    ],
  });
  assert.equal(out.verdict, 'strip');
});

test('verdict: MP3 with ID3 art (no real video stream) -> clean, never remuxed', () => {
  const out = rokuCompatVerdict({
    streams: [
      { codec_type: 'audio', codec_name: 'mp3' },
      { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
    ],
  });
  assert.equal(out.verdict, 'clean');
  assert.equal(out.attachedPicCount, 1);
});

test('verdict: fail-open to clean on garbage / empty / missing streams', () => {
  for (const input of ['not json {', '', null, undefined, {}, { streams: null }, { streams: 'nope' }, []]) {
    assert.equal(rokuCompatVerdict(input).verdict, 'clean');
  }
});

test('verdict: accepts the raw ffprobe stdout string form', () => {
  const out = rokuCompatVerdict(JSON.stringify(ATTACHED_PIC_MP4));
  assert.equal(out.verdict, 'strip');
});

// ---------------------------------------------------------------------------
// ffmpeg argument builders
// ---------------------------------------------------------------------------

test('strip args: stream-copy remux mapping first REAL video (0:V:0) + all audio, faststart, tmp target', () => {
  const args = buildStripArgs('/media/a.mp4', '/cache/x.mp4.tmp.mp4');
  assert.deepEqual(args, [
    '-i', '/media/a.mp4',
    '-map', '0:V:0',
    '-map', '0:a?',
    '-c', 'copy',
    '-movflags', '+faststart',
    '-y', '/cache/x.mp4.tmp.mp4',
  ]);
});

test('rotate args: same encode profile as the browser-compat pipeline, crf stringified', () => {
  const args = buildRotateArgs('/media/b.mov', '/cache/y.mp4.tmp.mp4', 23);
  assert.deepEqual(args, [
    '-i', '/media/b.mov',
    '-map', '0:V:0',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ac', '2',
    '-movflags', '+faststart',
    '-y', '/cache/y.mp4.tmp.mp4',
  ]);
});

test('neither builder ever names the source as an output (zero-mutation contract)', () => {
  const src = '/media/original.mp4';
  for (const args of [buildStripArgs(src, '/cache/t.tmp.mp4'), buildRotateArgs(src, '/cache/t.tmp.mp4', 20)]) {
    assert.equal(args.filter(a => a === src).length, 1); // exactly once: as -i input
    assert.equal(args[args.indexOf('-i') + 1], src);
    assert.notEqual(args[args.length - 1], src);
  }
});

// ---------------------------------------------------------------------------
// source signature (replaced-in-place invalidation)
// ---------------------------------------------------------------------------

test('signature: matches itself, breaks on size or mtime change', () => {
  const stat = { size: 1234, mtimeMs: 1753400000000 };
  const sig = sourceSignature(stat);
  assert.equal(signatureMatches(sig, stat), true);
  assert.equal(signatureMatches(sig, { size: 1235, mtimeMs: stat.mtimeMs }), false);
  assert.equal(signatureMatches(sig, { size: stat.size, mtimeMs: stat.mtimeMs + 1 }), false);
  assert.equal(signatureMatches(null, stat), false);
  assert.equal(signatureMatches(undefined, stat), false);
});

// ---------------------------------------------------------------------------
// cache-dir-vs-library-root guard
// ---------------------------------------------------------------------------

test('isInsideAnyRoot: inside, equal, and safely-outside cases (incl. prefix-sibling trap)', () => {
  const roots = ['/media/videos', '/media/music'];
  assert.equal(isInsideAnyRoot('/media/videos/sub/cache', roots, path), true);
  assert.equal(isInsideAnyRoot('/media/videos', roots, path), true);
  assert.equal(isInsideAnyRoot('/data/roku-compat', roots, path), false);
  // Sibling whose name shares the root as a string prefix must NOT match.
  assert.equal(isInsideAnyRoot('/media/videos-archive', roots, path), false);
  assert.equal(isInsideAnyRoot('/anywhere', [], path), false);
  assert.equal(isInsideAnyRoot('/anywhere', [null, '', 42], path), false);
});
