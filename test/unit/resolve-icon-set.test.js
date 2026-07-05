'use strict';

// resolveIconSet lives in the browser common.js, which exposes it to Node via
// a `typeof module` guard purely for this test. Mirrors
// test/unit/resolve-theme.test.js's style/pattern exactly.
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveIconSet } = require('../../public/js/common.js');

test('resolveIconSet: explicit outlined pref wins regardless of era', () => {
  assert.strictEqual(resolveIconSet('outlined', '2021'), 'outlined');
});

test('resolveIconSet: explicit rounded pref wins regardless of era', () => {
  assert.strictEqual(resolveIconSet('rounded', '2005'), 'rounded');
});

test('resolveIconSet: explicit filled pref wins regardless of era', () => {
  assert.strictEqual(resolveIconSet('filled', '2014'), 'filled');
});

test('resolveIconSet: explicit emoji pref wins regardless of era', () => {
  assert.strictEqual(resolveIconSet('emoji', '2009'), 'emoji');
});

test('resolveIconSet: auto maps 2005 to emoji', () => {
  assert.strictEqual(resolveIconSet('auto', '2005'), 'emoji');
});

test('resolveIconSet: auto maps 2009 to emoji', () => {
  assert.strictEqual(resolveIconSet('auto', '2009'), 'emoji');
});

test('resolveIconSet: auto maps 2014 to filled', () => {
  assert.strictEqual(resolveIconSet('auto', '2014'), 'filled');
});

test('resolveIconSet: auto maps 2021 to rounded', () => {
  assert.strictEqual(resolveIconSet('auto', '2021'), 'rounded');
});

test('resolveIconSet: auto with an unrecognized era falls back to the default era mapping', () => {
  assert.strictEqual(resolveIconSet('auto', '2050'), 'rounded'); // DEFAULT_ERA is '2021' -> rounded
});

test('resolveIconSet: nothing stored (null) defaults to outlined at any era', () => {
  assert.strictEqual(resolveIconSet(null, '2014'), 'outlined');
});

test('resolveIconSet: an unrecognized stored value falls back to outlined', () => {
  assert.strictEqual(resolveIconSet('bogus', '2021'), 'outlined');
});
