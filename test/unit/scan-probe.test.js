'use strict';

// [UNIT] Wave 6 (scan extraction) -- lib/scan/probe.js, required DIRECTLY.
//
// applyHasSubtitlesDetection is the scan's cheap, SCHEMA-ONLY `hasSubtitles`
// detection: it only lists the containing directory (no ffmpeg, no thumbnail
// or transcode work), it is recomputed on EVERY scan so a sidecar dropped in
// or removed later is picked up on the very next pass, it MUTATES the entry in
// place, and it returns true ONLY when the value actually changed - the signal
// the call sites use to set `dbChanged`.
//
// Both reveal axes are driven here (the reveal-once lesson): the empty -> true
// transition AND the populated -> false CLEAR, the latter against an entry
// that really did carry `hasSubtitles: true` first.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { applyHasSubtitlesDetection } = require('../../lib/scan/probe');

function makeDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-scanprobe-'));
  for (const name of files) fs.writeFileSync(path.join(dir, name), 'x');
  return dir;
}

test('applyHasSubtitlesDetection: a bare .vtt sidecar flips a fresh entry to true (changed)', () => {
  const dir = makeDir(['clip.mp4', 'clip.vtt']);
  try {
    const existing = {};
    assert.strictEqual(applyHasSubtitlesDetection(existing, path.join(dir, 'clip.mp4')), true);
    assert.strictEqual(existing.hasSubtitles, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyHasSubtitlesDetection: a language-tagged .vtt and a bare .srt both count', () => {
  for (const sidecar of ['clip.en.vtt', 'clip.srt']) {
    const dir = makeDir(['clip.mp4', sidecar]);
    try {
      const existing = {};
      applyHasSubtitlesDetection(existing, path.join(dir, 'clip.mp4'));
      assert.strictEqual(existing.hasSubtitles, true, `${sidecar} should count`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('applyHasSubtitlesDetection: no sidecar -> false, and that IS a change on a fresh entry', () => {
  const dir = makeDir(['clip.mp4']);
  try {
    const existing = {};
    assert.strictEqual(applyHasSubtitlesDetection(existing, path.join(dir, 'clip.mp4')), true,
      'undefined -> false is a real transition the caller must persist');
    assert.strictEqual(existing.hasSubtitles, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyHasSubtitlesDetection: an unrelated sibling never counts as this file\'s captions', () => {
  const dir = makeDir(['clip.mp4', 'other.vtt', 'clip.1080p.en.vtt']);
  try {
    const existing = {};
    applyHasSubtitlesDetection(existing, path.join(dir, 'clip.mp4'));
    assert.strictEqual(existing.hasSubtitles, false,
      'the sidecar match is anchored on THIS base - a multi-segment sibling is not a true sibling');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyHasSubtitlesDetection: the CLEAR axis - a populated true goes back to false when the sidecar is removed', () => {
  const dir = makeDir(['clip.mp4', 'clip.vtt']);
  const file = path.join(dir, 'clip.mp4');
  try {
    const existing = {};
    applyHasSubtitlesDetection(existing, file);
    assert.strictEqual(existing.hasSubtitles, true, 'populate FIRST, so the clear below is not vacuous');

    fs.unlinkSync(path.join(dir, 'clip.vtt'));
    assert.strictEqual(applyHasSubtitlesDetection(existing, file), true, 'the value changed');
    assert.strictEqual(existing.hasSubtitles, false, 'a removed sidecar is picked up on the very next scan');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyHasSubtitlesDetection: an UNCHANGED value returns false (no spurious dbChanged)', () => {
  const dir = makeDir(['clip.mp4', 'clip.vtt']);
  const file = path.join(dir, 'clip.mp4');
  try {
    const existing = { hasSubtitles: true };
    assert.strictEqual(applyHasSubtitlesDetection(existing, file), false);
    const bare = { hasSubtitles: false };
    fs.unlinkSync(path.join(dir, 'clip.vtt'));
    assert.strictEqual(applyHasSubtitlesDetection(bare, file), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyHasSubtitlesDetection: the dirCache is honoured (one listing per dir for the whole pass)', () => {
  const dir = makeDir(['a.mp4', 'a.vtt', 'b.mp4']);
  try {
    const cache = new Map();
    const a = {};
    applyHasSubtitlesDetection(a, path.join(dir, 'a.mp4'), cache);
    assert.strictEqual(a.hasSubtitles, true);
    assert.strictEqual(cache.size, 1, 'the directory was listed and memoized');

    const b = {};
    applyHasSubtitlesDetection(b, path.join(dir, 'b.mp4'), cache);
    assert.strictEqual(b.hasSubtitles, false, 'the same cached listing answers every probe');
    assert.strictEqual(cache.size, 1, 'no second readdir for the same dir');

    // A sidecar added AFTER the cache was populated is invisible to THIS pass
    // (by design - the cache is discarded at the end of the scan), but a fresh
    // Map sees it, which is what keeps the every-scan contract honest.
    fs.writeFileSync(path.join(dir, 'b.vtt'), 'x');
    const stillCached = {};
    applyHasSubtitlesDetection(stillCached, path.join(dir, 'b.mp4'), cache);
    assert.strictEqual(stillCached.hasSubtitles, false);
    const nextPass = {};
    applyHasSubtitlesDetection(nextPass, path.join(dir, 'b.mp4'), new Map());
    assert.strictEqual(nextPass.hasSubtitles, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyHasSubtitlesDetection: an unreadable/vanished directory fails closed, never throws', () => {
  const missing = path.join(os.tmpdir(), 'filetube-no-such-dir-' + process.pid, 'clip.mp4');
  const existing = { hasSubtitles: true };
  assert.strictEqual(applyHasSubtitlesDetection(existing, missing), true, 'true -> false is a change');
  assert.strictEqual(existing.hasSubtitles, false);
});
