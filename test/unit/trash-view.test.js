'use strict';

// [UNIT] v1.65 t5 -- public/js/setup.js's pure trash-row builders (the
// transcodeNamesSuffix export posture): escaping, the days-left ladder
// (nowMs injected), sizes, and the no-inline-style contract.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  escapeTrashHtml, trashDaysLeftLabel, formatTrashSize,
} = require('../../public/js/setup.js');

const NOW = Date.parse('2026-08-01T12:00:00.000Z');
const DAY = 86400000;

test('trashDaysLeftLabel: the retention ladder, deterministic via injected now', () => {
  assert.equal(trashDaysLeftLabel(NOW - 5 * DAY, 30, NOW), '25 days left');
  assert.equal(trashDaysLeftLabel(NOW - 29.5 * DAY, 30, NOW), '1 day left');
  assert.equal(trashDaysLeftLabel(NOW - 31 * DAY, 30, NOW), 'purging soon');
  assert.equal(trashDaysLeftLabel(NOW - 400 * DAY, 0, NOW), 'kept until purged', '0 = keep forever');
  assert.equal(trashDaysLeftLabel(undefined, 30, NOW), 'kept until purged', 'garbage never lies about a countdown');
});

test('formatTrashSize: KB/MB/GB ladder; empty for zero/garbage', () => {
  assert.equal(formatTrashSize(500), '1 KB');
  assert.equal(formatTrashSize(3 * 1024 ** 2), '3.0 MB');
  assert.equal(formatTrashSize(2.5 * 1024 ** 3), '2.5 GB');
  assert.equal(formatTrashSize(0), '');
  assert.equal(formatTrashSize('nope'), '');
});

// v1.159: the trash rows now render via buildSortableTable (Title | Size |
// Expires + Restore/Purge). The row builders (buildTrashTitleCell escaping,
// the data-trash-id action wiring, thumbnail) are jsdom-tested in
// trash-table.test.js; the pure label/size/escape helpers stay bound here.

test('escapeTrashHtml: the five metacharacters; null/undefined -> empty', () => {
  assert.equal(escapeTrashHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#039;&lt;/a&gt;');
  assert.equal(escapeTrashHtml(null), '');
});
