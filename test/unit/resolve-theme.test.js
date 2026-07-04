'use strict';

// resolveTheme lives in the browser common.js, which exposes it to Node via a
// `typeof module` guard purely for this test.
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveTheme } = require('../../public/js/common.js');

test('resolveTheme: nothing stored at all defaults to 2021/light', () => {
  assert.deepStrictEqual(resolveTheme(null, null, null), { era: '2021', mode: 'light' });
});

test('resolveTheme: legacy theme=dark migrates to 2021/dark', () => {
  assert.deepStrictEqual(resolveTheme(null, null, 'dark'), { era: '2021', mode: 'dark' });
});

test('resolveTheme: legacy theme=light migrates to 2021/light', () => {
  assert.deepStrictEqual(resolveTheme(null, null, 'light'), { era: '2021', mode: 'light' });
});

test('resolveTheme: new era+mode keys win over a leftover legacy key', () => {
  assert.deepStrictEqual(resolveTheme('2009', 'dark', 'light'), { era: '2009', mode: 'dark' });
});

test('resolveTheme: unrecognized era falls back to default era, mode kept', () => {
  assert.deepStrictEqual(resolveTheme('2050', 'dark', null), { era: '2021', mode: 'dark' });
});

test('resolveTheme: unrecognized mode falls back to default mode', () => {
  assert.deepStrictEqual(resolveTheme('2014', 'xyz', null), { era: '2014', mode: 'light' });
});

test('resolveTheme: era only, mode absent entirely defaults to light', () => {
  assert.deepStrictEqual(resolveTheme('2005', null, null), { era: '2005', mode: 'light' });
});
