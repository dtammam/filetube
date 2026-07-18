'use strict';

// [UNIT] v1.44 T12 — resolveBottomNavLayout (common.js): the pure order+hide
// decision behind the customizable bottom bar. home stays first, settings
// stays last (both un-hideable); optional items reorder/hide per the config;
// a config entry for a NOT-present item is inert (the module gate wins).

const { test } = require('node:test');
const assert = require('node:assert');
const { resolveBottomNavLayout } = require('../../public/js/common.js');

const ALL = ['home', 'playlists', 'subscriptions', 'oneoff-download', 'theme', 'settings'];

test('T12: default config keeps DOM order, home first + settings last', () => {
  const out = resolveBottomNavLayout(ALL, {});
  assert.deepEqual(out.visible, ALL);
  assert.deepEqual(out.hiddenPresent, []);
});

test('T12: hidden optionals are dropped from visible; home/settings can never be hidden', () => {
  const out = resolveBottomNavLayout(ALL, { hidden: ['subscriptions', 'home', 'settings'] });
  assert.deepEqual(out.visible, ['home', 'playlists', 'oneoff-download', 'theme', 'settings'], 'home/settings ignore a hide request');
  assert.deepEqual(out.hiddenPresent, ['subscriptions']);
});

test('T12: order reorders the optional middle; unlisted optionals keep their default order after', () => {
  const out = resolveBottomNavLayout(ALL, { order: ['theme', 'oneoff-download'] });
  assert.deepEqual(out.visible, ['home', 'theme', 'oneoff-download', 'playlists', 'subscriptions', 'settings']);
});

test('T12: order + hide compose', () => {
  const out = resolveBottomNavLayout(ALL, { order: ['oneoff-download', 'subscriptions', 'playlists', 'theme'], hidden: ['theme'] });
  assert.deepEqual(out.visible, ['home', 'oneoff-download', 'subscriptions', 'playlists', 'settings']);
});

test('T12: a config entry for a NOT-present item is inert (module gate wins)', () => {
  // subscriptions + download not present (modules disabled); config references them.
  const present = ['home', 'playlists', 'theme', 'settings'];
  const out = resolveBottomNavLayout(present, { order: ['subscriptions', 'theme', 'oneoff-download', 'playlists'], hidden: ['subscriptions'] });
  assert.deepEqual(out.visible, ['home', 'theme', 'playlists', 'settings'], 'absent items neither appear nor break ordering');
});

test('T12: missing home or settings anchors are simply omitted (never fabricated)', () => {
  const out = resolveBottomNavLayout(['playlists', 'theme'], {});
  assert.deepEqual(out.visible, ['playlists', 'theme']);
});

test('T12: junk config is tolerated (treated as empty)', () => {
  assert.deepEqual(resolveBottomNavLayout(ALL, null).visible, ALL);
  assert.deepEqual(resolveBottomNavLayout(ALL, { hidden: 'x', order: 5 }).visible, ALL);
  assert.deepEqual(resolveBottomNavLayout(null, {}).visible, []);
});
