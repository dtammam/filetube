'use strict';

// [UNIT] v1.34 T2 (Dean, desktop CC sync) -- shiftVttCues + its time helpers
// (lib/subtitles.js): the offset-shifted VTT the live-transcode playback
// re-points its <track> at after a seek.
const { test } = require('node:test');
const assert = require('node:assert');
const { shiftVttCues, parseVttTimeMs, formatVttTimeMs } = require('../../lib/subtitles');

const DOC = [
  'WEBVTT',
  '',
  'intro',
  '00:00:01.000 --> 00:00:04.000',
  'Welcome!',
  '',
  '00:00:05.500 --> 00:00:09.250 align:center',
  'Second cue',
  '',
  'NOTE a comment block',
  '',
  '01:02:03.400 --> 01:02:05.000',
  'Deep cue',
  '',
].join('\n');

test('parseVttTimeMs handles both timestamp shapes; formatVttTimeMs always emits the long form', () => {
  assert.equal(parseVttTimeMs('00:00:01.000'), 1000);
  assert.equal(parseVttTimeMs('01:02:03.400'), 3723400);
  assert.equal(parseVttTimeMs('02:03.400'), 123400, 'MM:SS.mmm short form');
  assert.ok(Number.isNaN(parseVttTimeMs('garbage')));
  assert.equal(formatVttTimeMs(1000), '00:00:01.000');
  assert.equal(formatVttTimeMs(3723400), '01:02:03.400');
  assert.equal(formatVttTimeMs(-50), '00:00:00.000', 'never a negative timestamp');
});

test('shiftVttCues shifts every cue earlier by the offset and preserves settings/headers/NOTE blocks', () => {
  const shifted = shiftVttCues(DOC, 1);
  assert.ok(shifted.includes('00:00:00.000 --> 00:00:03.000'), 'first cue shifted by 1s');
  assert.ok(shifted.includes('00:00:04.500 --> 00:00:08.250 align:center'), 'cue settings ride through untouched');
  assert.ok(shifted.includes('01:02:02.400 --> 01:02:04.000'), 'long-form cue shifted');
  assert.ok(shifted.includes('WEBVTT'), 'header preserved');
  assert.ok(shifted.includes('NOTE a comment block'), 'NOTE block preserved');
  assert.ok(shifted.includes('Welcome!'), 'cue payload preserved');
});

test('shiftVttCues drops a cue that ends at/before the seek point, including its identifier line', () => {
  const shifted = shiftVttCues(DOC, 4);
  assert.ok(!shifted.includes('Welcome!'), 'the fully-elapsed first cue is dropped');
  assert.ok(!shifted.includes('\nintro\n'), 'its identifier line goes with it');
  assert.ok(shifted.includes('00:00:01.500 --> 00:00:05.250 align:center'), 'the second cue survives, shifted');
});

test('shiftVttCues clamps a cue that STRADDLES the seek point to start at 0', () => {
  const shifted = shiftVttCues(DOC, 7); // second cue runs 5.5-9.25 -> straddles 7
  assert.ok(!shifted.includes('Welcome!'));
  assert.ok(shifted.includes('00:00:00.000 --> 00:00:02.250 align:center'), 'straddling cue clamped to start at 0');
});

test('shiftVttCues is a no-op for absent/invalid/non-positive offsets and never throws on garbage', () => {
  assert.equal(shiftVttCues(DOC, 0), DOC);
  assert.equal(shiftVttCues(DOC, -5), DOC);
  assert.equal(shiftVttCues(DOC, 'nonsense'), DOC);
  assert.equal(shiftVttCues(DOC, undefined), DOC);
  assert.equal(shiftVttCues(null, 5), '', 'non-string input degrades to empty, never a throw');
  const malformed = 'WEBVTT\n\nnot a timing line --> at all\npayload\n';
  assert.equal(typeof shiftVttCues(malformed, 5), 'string');
});
