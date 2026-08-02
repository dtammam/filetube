'use strict';

// [UNIT] v1.65 -- deleteResultToast's four-way mapping (deletePending >
// fileRemainsOnDisk > trashed > plain), including the new trash copy.

const { test } = require('node:test');
const assert = require('node:assert');
const { deleteResultToast } = require('../../public/js/common.js');

test('trashed clean -> "Moved to Trash."', () => {
  assert.equal(deleteResultToast({ success: true, trashed: true }), 'Moved to Trash.');
});

test('trashed + fileRemainsOnDisk -> the reassuring trash line, not the scary legacy one', () => {
  const msg = deleteResultToast({ success: true, trashed: true, fileRemainsOnDisk: true });
  assert.match(msg, /Moved to Trash/);
  assert.ok(!/could not be deleted/.test(msg));
});

test('legacy shapes unchanged: deletePending wins; fileRemainsOnDisk without trashed keeps the retry line; plain stays', () => {
  assert.match(deleteResultToast({ deletePending: true, fileRemainsOnDisk: true, trashed: true }), /still held open/);
  assert.match(deleteResultToast({ fileRemainsOnDisk: true }), /next scan will retry/);
  assert.equal(deleteResultToast({ success: true }), 'File deleted.');
  assert.equal(deleteResultToast(null), 'File deleted.');
});
