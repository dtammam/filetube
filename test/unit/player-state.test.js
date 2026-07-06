'use strict';

// [UNIT] The pure FULL/DOCKED/CLOSED state-machine decisions extracted from
// the persistent player controller (public/js/player.js, FR-1, T2) and the
// router's `applyPlayerTransition` hook (public/js/common.js) it feeds. The
// DOM-heavy reparent/mount machinery those decisions drive (and the iOS
// reparent behavior itself) is intentionally NOT covered here (no jsdom/
// browser harness in this codebase -- see CONTRIBUTING.md); Dean's on-device
// pass is the arbiter for that.
const { test } = require('node:test');
const assert = require('node:assert');
const { isAdoptLoad, shouldDockOnTransition, nextPlayerState } = require('../../public/js/player.js');
const { shouldDockOnTransition: routerShouldDockOnTransition } = require('../../public/js/common.js');

// ---- isAdoptLoad ------------------------------------------------------------

test('isAdoptLoad: the same id while FULL is an adopt (no-restart reparent)', () => {
  assert.strictEqual(isAdoptLoad('abc', 'abc', 'full'), true);
});

test('isAdoptLoad: the same id while DOCKED is an adopt (dock-tap expand)', () => {
  assert.strictEqual(isAdoptLoad('abc', 'abc', 'docked'), true);
});

test('isAdoptLoad: the same id while CLOSED is NOT an adopt (source was released -- always a fresh load)', () => {
  assert.strictEqual(isAdoptLoad('abc', 'abc', 'closed'), false);
});

test('isAdoptLoad: a different id is never an adopt, regardless of state', () => {
  assert.strictEqual(isAdoptLoad('abc', 'xyz', 'full'), false);
  assert.strictEqual(isAdoptLoad('abc', 'xyz', 'docked'), false);
});

test('isAdoptLoad: nothing currently loaded (null currentId) is never an adopt', () => {
  assert.strictEqual(isAdoptLoad(null, 'abc', 'closed'), false);
});

// ---- shouldDockOnTransition (both the player.js and common.js copies agree) -

test('shouldDockOnTransition: leaving watch for home/setup/subscriptions docks', () => {
  assert.strictEqual(shouldDockOnTransition('watch', 'home'), true);
  assert.strictEqual(shouldDockOnTransition('watch', 'setup'), true);
  assert.strictEqual(shouldDockOnTransition('watch', 'subscriptions'), true);
});

test('shouldDockOnTransition: watch -> watch (a different video) does NOT dock', () => {
  assert.strictEqual(shouldDockOnTransition('watch', 'watch'), false);
});

test('shouldDockOnTransition: leaving any non-watch view never docks (nothing to dock FROM)', () => {
  assert.strictEqual(shouldDockOnTransition('home', 'watch'), false);
  assert.strictEqual(shouldDockOnTransition('setup', 'subscriptions'), false);
});

test('shouldDockOnTransition: an unknown/null toView (progressive-enhancement boot has no "from") never docks', () => {
  assert.strictEqual(shouldDockOnTransition('watch', null), false);
  assert.strictEqual(shouldDockOnTransition(null, 'home'), false);
});

test('shouldDockOnTransition: player.js and common.js expose the identical decision (single source of truth)', () => {
  const cases = [
    ['watch', 'home'], ['watch', 'watch'], ['home', 'watch'], ['watch', 'setup'],
    ['watch', 'subscriptions'], ['setup', 'home'], ['watch', null], [null, 'watch'],
  ];
  for (const [from, to] of cases) {
    assert.strictEqual(shouldDockOnTransition(from, to), routerShouldDockOnTransition(from, to));
  }
});

// ---- nextPlayerState ---------------------------------------------------------

test('nextPlayerState: nothing loaded (hasMedia=false) never transitions to docked, regardless of views', () => {
  assert.strictEqual(nextPlayerState('watch', 'home', 'full', false), 'closed');
  assert.strictEqual(nextPlayerState('watch', 'home', 'closed', false), 'closed');
});

test('nextPlayerState: an already-CLOSED controller stays closed even if hasMedia is stale/true', () => {
  assert.strictEqual(nextPlayerState('watch', 'home', 'closed', true), 'closed');
});

test('nextPlayerState: leaving watch while media is loaded docks', () => {
  assert.strictEqual(nextPlayerState('watch', 'home', 'full', true), 'docked');
  assert.strictEqual(nextPlayerState('watch', 'setup', 'full', true), 'docked');
});

test('nextPlayerState: entering/returning to watch while media is loaded ends up full (docked -> full expand, or a fresh watch load once load() has set hasMedia)', () => {
  assert.strictEqual(nextPlayerState('home', 'watch', 'docked', true), 'full');
  assert.strictEqual(nextPlayerState(null, 'watch', 'full', true), 'full');
});

test('nextPlayerState: a fresh watch entry with nothing loaded YET (before load() runs) is closed, not full -- there is no media to be "full" with', () => {
  assert.strictEqual(nextPlayerState(null, 'watch', 'closed', false), 'closed');
});

test('nextPlayerState: watch -> watch (different media) leaves the state unchanged (host stays in the slot)', () => {
  assert.strictEqual(nextPlayerState('watch', 'watch', 'full', true), 'full');
});

test('nextPlayerState: a non-watch -> non-watch transition (e.g. home -> setup) leaves state unchanged', () => {
  assert.strictEqual(nextPlayerState('home', 'setup', 'docked', true), 'docked');
});
