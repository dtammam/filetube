'use strict';

// [UNIT] v1.41.1 — centerVttCues (Dean: subtitles bottom-center, not
// bottom-left). WebVTT cue position/justification live in per-cue settings on
// the timing line (CSS ::cue can't move the box), so the /api/subtitles route
// normalizes every served cue to `position:50% align:center`. Covers SRT-
// derived (no settings) AND author-positioned .vtt, plus the cue-BLOCK
// discipline it shares with shiftVttCues.

const { test } = require('node:test');
const assert = require('node:assert');
const { centerVttCues, shiftVttCues } = require('../../lib/subtitles.js');

test('centerVttCues: a plain (SRT-derived, settings-less) cue gets centered', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello world\n';
  const out = centerVttCues(vtt);
  assert.match(out, /00:00:01\.000 --> 00:00:04\.000 position:50% align:center/);
  assert.ok(out.includes('Hello world'), 'payload preserved');
});

test('centerVttCues: an author-positioned .vtt cue has its settings OVERRIDDEN to center', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000 line:0 position:10% align:start size:40%\nTop-left caption\n';
  const out = centerVttCues(vtt);
  assert.match(out, /00:00:01\.000 --> 00:00:04\.000 position:50% align:center/);
  assert.ok(!/line:0/.test(out) && !/align:start/.test(out) && !/position:10%/.test(out), 'old settings stripped');
});

test('centerVttCues: every cue in a multi-cue document is centered', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA\n\n00:00:03.000 --> 00:00:04.000 align:end\nB\n';
  const out = centerVttCues(vtt);
  const centered = (out.match(/position:50% align:center/g) || []).length;
  assert.strictEqual(centered, 2);
});

test('centerVttCues: hour-form timestamps and a leading cue identifier survive', () => {
  const vtt = 'WEBVTT\n\ncue-7\n01:02:03.500 --> 01:02:05.000\nLater line\n';
  const out = centerVttCues(vtt);
  assert.match(out, /01:02:03\.500 --> 01:02:05\.000 position:50% align:center/);
  assert.ok(out.includes('cue-7'), 'identifier line untouched');
});

test('centerVttCues: a payload line that LOOKS like a timing line (inside a cue block) is NOT rewritten', () => {
  // The spoken text quotes a timestamp range -- must stay verbatim, not become a cue.
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:09.000\nfrom 00:00:02.000 --> 00:00:03.000 he said\n';
  const out = centerVttCues(vtt);
  // Only ONE cue -> exactly one settings injection; the payload timestamp is intact.
  assert.strictEqual((out.match(/position:50% align:center/g) || []).length, 1);
  assert.ok(out.includes('from 00:00:02.000 --> 00:00:03.000 he said'), 'payload line untouched');
});

test('centerVttCues: WEBVTT header + NOTE blocks are preserved', () => {
  const vtt = 'WEBVTT\n\nNOTE this is a comment\n\n00:00:01.000 --> 00:00:02.000\nHi\n';
  const out = centerVttCues(vtt);
  assert.ok(out.startsWith('WEBVTT'));
  assert.ok(out.includes('NOTE this is a comment'));
});

test('centerVttCues: non-string / empty input -> empty string (never throws)', () => {
  assert.strictEqual(centerVttCues(undefined), '');
  assert.strictEqual(centerVttCues(null), '');
  assert.strictEqual(centerVttCues(42), '');
  assert.strictEqual(centerVttCues(''), '');
});

test('centerVttCues after shiftVttCues keeps the shifted times and adds centering', () => {
  const vtt = 'WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nShifted\n';
  const shifted = shiftVttCues(vtt, 5); // -5s -> 00:00:05.000 --> 00:00:07.000
  const out = centerVttCues(shifted);
  assert.match(out, /00:00:05\.000 --> 00:00:07\.000 position:50% align:center/);
});
