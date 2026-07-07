'use strict';

// [UNIT] v1.18.0 T4 (FR-3) -- pollScanStatus's pure suffix builder. Verifies
// the "converting N file(s)…" message's appended name list/overflow text,
// and the empty-set guard (no misleading "Converting 0 file(s)" text is this
// helper's concern -- that guard lives in the `s.transcoding > 0` check in
// pollScanStatus itself; this helper only renders the suffix once that guard
// has already passed, but must still degrade to '' for an empty/missing
// transcodeNames array so a caller can't accidentally render a stray ": ").
const { test } = require('node:test');
const assert = require('node:assert');
const { transcodeNamesSuffix } = require('../../public/js/setup.js');

test('transcodeNamesSuffix: renders a plain name list with no overflow', () => {
  const suffix = transcodeNamesSuffix({ transcodeNames: ['a.mp4', 'b.mkv'], transcodeOverflow: 0 });
  assert.equal(suffix, ': a.mp4, b.mkv');
});

test('transcodeNamesSuffix: appends "+K more" when transcodeOverflow > 0', () => {
  const suffix = transcodeNamesSuffix({ transcodeNames: ['a.mp4'], transcodeOverflow: 4 });
  assert.equal(suffix, ': a.mp4 +4 more');
});

test('transcodeNamesSuffix: empty transcodeNames renders no suffix at all', () => {
  assert.equal(transcodeNamesSuffix({ transcodeNames: [], transcodeOverflow: 0 }), '');
});

test('transcodeNamesSuffix: a missing/malformed transcodeNames degrades to no suffix rather than throwing', () => {
  assert.equal(transcodeNamesSuffix({}), '');
  assert.equal(transcodeNamesSuffix({ transcodeNames: undefined }), '');
});
