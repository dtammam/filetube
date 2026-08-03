'use strict';

// activeNavItem lives in the browser common.js, which exposes it to Node via a
// `typeof module` guard purely for this test.
const { test } = require('node:test');
const assert = require('node:assert');
const { activeNavItem, likedScopeQuery } = require('../../public/js/common.js');

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

// T5: the optional yt-dlp module's dedicated page (D4). The route/nav link
// only ever exist server-side when the module is enabled, but this pure
// mapping is unconditional -- harmless when nothing ever navigates there.
test('activeNavItem: /subscriptions is subscriptions', () => {
  assert.strictEqual(activeNavItem('/subscriptions', ''), 'subscriptions');
});

test('activeNavItem: /watch.html with a video query is null (no false highlight)', () => {
  assert.strictEqual(activeNavItem('/watch.html', '?v=abc123'), null);
});

test('activeNavItem: any other path is null', () => {
  assert.strictEqual(activeNavItem('/anything-else', ''), null);
});

// ---- v1.75: home and liked share the `/` path ------------------------------
//
// The central Liked playlist IS the home grid scoped by ?liked=1, so the two
// bottom-nav entries cannot be told apart by pathname. The highlight has to
// discriminate on the query, and on the SAME read main.js performs.

test('v1.75: /?liked=1 lights liked, not home', () => {
  assert.strictEqual(activeNavItem('/', '?liked=1'), 'liked');
  assert.strictEqual(activeNavItem('/index.html', '?liked=1'), 'liked');
});

test('v1.75: the liked scope survives being combined with other params, in either position', () => {
  assert.strictEqual(activeNavItem('/', '?liked=1&sort=newest'), 'liked');
  assert.strictEqual(activeNavItem('/', '?sort=newest&liked=1'), 'liked');
});

test('v1.75: only the exact scope value main.js reads counts - everything else is still home', () => {
  // main.js: `urlParams.get('liked') === '1'`. A truthy-looking variant that
  // the view itself would NOT treat as the liked scope must not light Liked,
  // or the bar lies about which grid is on screen.
  for (const q of ['?liked=0', '?liked=', '?liked=true', '?liked=11', '?likedx=1', '?notliked=1', '?search=liked']) {
    assert.strictEqual(activeNavItem('/', q), 'home', `${q} is a home view`);
  }
});

test('v1.75: a bare/absent/garbage query degrades to home, never throws', () => {
  assert.strictEqual(activeNavItem('/', ''), 'home');
  assert.strictEqual(activeNavItem('/', undefined), 'home');
  assert.strictEqual(activeNavItem('/', null), 'home');
  assert.strictEqual(activeNavItem('/', '?%'), 'home');
});

test('v1.75: the liked scope never leaks onto another path', () => {
  assert.strictEqual(activeNavItem('/music', '?liked=1'), 'music');
  assert.strictEqual(activeNavItem('/podcasts', '?liked=1'), 'podcasts');
  assert.strictEqual(activeNavItem('/watch.html', '?v=abc&liked=1'), null);
});

test('v1.75: likedScopeQuery is the one parse behind that decision', () => {
  assert.strictEqual(likedScopeQuery('?liked=1'), true);
  assert.strictEqual(likedScopeQuery('liked=1'), true, 'a query with no leading ? parses the same');
  assert.strictEqual(likedScopeQuery(''), false);
  assert.strictEqual(likedScopeQuery(null), false);
});
