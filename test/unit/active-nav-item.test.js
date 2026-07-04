'use strict';

// activeNavItem lives in the browser common.js, which exposes it to Node via a
// `typeof module` guard purely for this test.
const { test } = require('node:test');
const assert = require('node:assert');
const { activeNavItem } = require('../../public/js/common.js');

test('activeNavItem: home path with no query is home', () => {
  assert.strictEqual(activeNavItem('/', ''), 'home');
});

test('activeNavItem: home path with ?search= is still home', () => {
  assert.strictEqual(activeNavItem('/', '?search=cats'), 'home');
});

test('activeNavItem: home path with ?root= is still home', () => {
  assert.strictEqual(activeNavItem('/', '?root=%2Fmedia%2Fmovies'), 'home');
});

test('activeNavItem: home path with ?folder= is still home', () => {
  assert.strictEqual(activeNavItem('/', '?folder=Movies'), 'home');
});

test('activeNavItem: /index.html with no query is home', () => {
  assert.strictEqual(activeNavItem('/index.html', ''), 'home');
});

test('activeNavItem: /setup.html is settings', () => {
  assert.strictEqual(activeNavItem('/setup.html', ''), 'settings');
});

test('activeNavItem: /watch.html with a video query is null (no false highlight)', () => {
  assert.strictEqual(activeNavItem('/watch.html', '?v=abc123'), null);
});

test('activeNavItem: any other path is null', () => {
  assert.strictEqual(activeNavItem('/anything-else', ''), null);
});
