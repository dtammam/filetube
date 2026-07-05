'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { gbToBytes, bytesToGb } = require('../../public/js/common.js');

test('gbToBytes/bytesToGb: exported for Node (require-safe)', () => {
  assert.equal(typeof gbToBytes, 'function');
  assert.equal(typeof bytesToGb, 'function');
});

test('gbToBytes: converts a positive GB value to whole bytes', () => {
  assert.equal(gbToBytes(1), 1024 * 1024 * 1024);
  assert.equal(gbToBytes(5), 5 * 1024 * 1024 * 1024);
  assert.equal(gbToBytes('2.5'), Math.round(2.5 * 1024 * 1024 * 1024), 'string input coerces to number');
});

test('gbToBytes: empty/blank means "use the default" -> null', () => {
  assert.equal(gbToBytes(''), null);
  assert.equal(gbToBytes(null), null);
  assert.equal(gbToBytes(undefined), null);
});

test('gbToBytes: non-finite or non-positive values -> null (never a negative/NaN cap)', () => {
  assert.equal(gbToBytes(0), null);
  assert.equal(gbToBytes(-3), null);
  assert.equal(gbToBytes(NaN), null);
  assert.equal(gbToBytes('not a number'), null);
});

test('gbToBytes: a tiny positive value that rounds to < 1 byte -> null, not 0 (avoids a misleading 400)', () => {
  assert.equal(gbToBytes(1e-12), null);
  assert.equal(gbToBytes(1e-15), null);
});

test('bytesToGb: converts bytes to a GB number rounded to 2 decimals', () => {
  assert.equal(bytesToGb(1024 * 1024 * 1024), 1);
  assert.equal(bytesToGb(5 * 1024 * 1024 * 1024), 5);
  assert.equal(bytesToGb(1610612736), 1.5, '1.5 GiB rounds cleanly');
});

test('bytesToGb: null/undefined/non-finite -> null', () => {
  assert.equal(bytesToGb(null), null);
  assert.equal(bytesToGb(undefined), null);
  assert.equal(bytesToGb(NaN), null);
});

test('gbToBytes/bytesToGb: round-trip a whole-GB value', () => {
  const gb = 3;
  assert.equal(bytesToGb(gbToBytes(gb)), gb);
});
