'use strict';

// [UNIT] v1.21.0 FR-7, T6 -- extra-deliberate delete for local
// (non-yt-dlp) files.
//
// `isYtdlpManagedItem` is the fail-safe detection predicate (AC45/AC50):
// it must return `true` ONLY on a POSITIVE yt-dlp signal (a non-empty
// channelUrl/channelId/channelName, v1.20 FR-2) -- ANY absence/ambiguity
// (including every pre-v1.20 local file) must resolve to `false`, which
// callers treat as LOCAL/irreplaceable (the one delete confirm's copy,
// main.js cardDeleteConfirmCopy, then says the file cannot be
// re-downloaded). This file exhaustively covers that truth table (the
// adversarial-review focus: the predicate can only ever ADD friction,
// never remove it -- AC51). Step 7 (UI pass) DELETED the checkbox-gated
// dialog (showHardDeleteModal) and its flow picker (deleteFlowFor): no
// caller was left; overlays-dialogs-s9.test.js binds that they stay gone.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  isYtdlpManagedItem,
} = require('../../public/js/common.js');

// ---- isYtdlpManagedItem: fail-safe truth table ------------------------------

test('isYtdlpManagedItem: true when channelUrl is a non-empty string', () => {
  assert.strictEqual(isYtdlpManagedItem({ channelUrl: 'https://www.youtube.com/channel/UC1' }), true);
});

test('isYtdlpManagedItem: true when channelId is a non-empty string (channelUrl absent)', () => {
  assert.strictEqual(isYtdlpManagedItem({ channelId: 'UC12345' }), true);
});

test('isYtdlpManagedItem: true when channelName is a non-empty string (channelUrl/channelId absent)', () => {
  assert.strictEqual(isYtdlpManagedItem({ channelName: 'Real Creator' }), true);
});

test('isYtdlpManagedItem: true when only PART of the signal set is present (partial-signal case)', () => {
  assert.strictEqual(isYtdlpManagedItem({ channelId: 'UC1', channelUrl: '', channelName: undefined }), true);
});

test('isYtdlpManagedItem: false when ALL THREE fields are absent (pre-v1.20 local file, the common case -- AC50)', () => {
  assert.strictEqual(isYtdlpManagedItem({ title: 'home_movie.mp4', filePath: '/media/home_movie.mp4' }), false);
});

test('isYtdlpManagedItem: false on an item with only unrelated fields (artist/folderName, a local file with tags)', () => {
  assert.strictEqual(isYtdlpManagedItem({ artist: 'Some Artist', folderName: 'Movies' }), false);
});

test('isYtdlpManagedItem: false on empty-string signal fields (never treats "" as a signal)', () => {
  assert.strictEqual(isYtdlpManagedItem({ channelUrl: '', channelId: '', channelName: '' }), false);
});

test('isYtdlpManagedItem: false on whitespace-only signal fields', () => {
  assert.strictEqual(isYtdlpManagedItem({ channelUrl: '   ', channelId: '\t', channelName: '\n' }), false);
});

test('isYtdlpManagedItem: false on non-string signal fields (malformed shape, never coerced to truthy)', () => {
  assert.strictEqual(isYtdlpManagedItem({ channelUrl: 123 }), false);
  assert.strictEqual(isYtdlpManagedItem({ channelId: true }), false);
  assert.strictEqual(isYtdlpManagedItem({ channelName: {} }), false);
  assert.strictEqual(isYtdlpManagedItem({ channelUrl: null }), false);
});

test('isYtdlpManagedItem: never throws on null/undefined/malformed input -- fails safe to false', () => {
  assert.doesNotThrow(() => isYtdlpManagedItem(null));
  assert.doesNotThrow(() => isYtdlpManagedItem(undefined));
  assert.doesNotThrow(() => isYtdlpManagedItem('a string, not an object'));
  assert.doesNotThrow(() => isYtdlpManagedItem(42));
  assert.strictEqual(isYtdlpManagedItem(null), false);
  assert.strictEqual(isYtdlpManagedItem(undefined), false);
  assert.strictEqual(isYtdlpManagedItem('nope'), false);
  assert.strictEqual(isYtdlpManagedItem(42), false);
});

test('isYtdlpManagedItem: no ambiguous/absent input can ever resolve to true (fail-safe direction, AC51)', () => {
  const ambiguousInputs = [
    {},
    { channelUrl: '' },
    { channelUrl: null },
    { channelUrl: undefined },
    { channelUrl: '  ' },
    null,
    undefined,
    { random: 'field' },
  ];
  for (const input of ambiguousInputs) {
    assert.strictEqual(isYtdlpManagedItem(input), false, `expected LOCAL (false) for ${JSON.stringify(input)}`);
  }
});

// v1.338 D8d (Dean: "non-YouTube things supported by YT DLP should have generally
// first-class experiences"): `sourceExtractor` is the fourth signal - a download from
// another site whose site reported no uploader has none of the other three.
test('v1.338 D8d isYtdlpManagedItem: true for a download from another site with no uploader (sourceExtractor alone)', () => {
  assert.strictEqual(isYtdlpManagedItem({ sourceExtractor: 'Reddit', sourceId: 'abc123', filePath: '/dl/Reddit/x [Reddit=abc123].mp4' }), true);
  assert.strictEqual(isYtdlpManagedItem({ sourceExtractor: 'Facebook', sourceId: '99' }), true);
});

test('v1.338 D8d isYtdlpManagedItem: a blank / whitespace / non-string sourceExtractor is no signal (still fails safe to LOCAL)', () => {
  for (const v of ['', '   ', null, undefined, 42, {}, true]) {
    assert.strictEqual(isYtdlpManagedItem({ sourceExtractor: v, sourceId: 'abc' }), false, `sourceExtractor ${JSON.stringify(v)}`);
  }
  assert.strictEqual(isYtdlpManagedItem({ sourceId: 'abc' }), false, 'a sourceId alone is no signal');
});
