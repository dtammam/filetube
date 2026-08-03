'use strict';

// [UNIT] v1.44 T12 — resolveBottomNavLayout (common.js): the pure order+hide
// decision behind the customizable bottom bar. home stays first, settings
// stays last (both un-hideable); optional items reorder/hide per the config;
// a config entry for a NOT-present item is inert (the module gate wins).
// v1.71 adds the DEFAULT-HIDDEN class (podcasts): present in the DOM but
// invisible until the config's `shown` list opts it in.

const { test } = require('node:test');
const assert = require('node:assert');
const { resolveBottomNavLayout, BOTTOM_NAV_DEFAULT_HIDDEN } = require('../../public/js/common.js');

const ALL = ['home', 'playlists', 'history', 'subscriptions', 'oneoff-download', 'theme', 'settings'];

test('T12: default config keeps DOM order, home first + settings last', () => {
  const out = resolveBottomNavLayout(ALL, {});
  assert.deepEqual(out.visible, ALL);
  assert.deepEqual(out.hiddenPresent, []);
});

test('T12: hidden optionals are dropped from visible; home/settings can never be hidden', () => {
  const out = resolveBottomNavLayout(ALL, { hidden: ['subscriptions', 'home', 'settings'] });
  assert.deepEqual(out.visible, ['home', 'playlists', 'history', 'oneoff-download', 'theme', 'settings'], 'home/settings ignore a hide request');
  assert.deepEqual(out.hiddenPresent, ['subscriptions']);
});

test('T12: order reorders the optional middle; unlisted optionals keep their default order after', () => {
  const out = resolveBottomNavLayout(ALL, { order: ['theme', 'oneoff-download'] });
  assert.deepEqual(out.visible, ['home', 'theme', 'oneoff-download', 'playlists', 'history', 'subscriptions', 'settings']);
});

test('T12: order + hide compose', () => {
  const out = resolveBottomNavLayout(ALL, { order: ['oneoff-download', 'subscriptions', 'playlists', 'theme'], hidden: ['theme'] });
  assert.deepEqual(out.visible, ['home', 'oneoff-download', 'subscriptions', 'playlists', 'history', 'settings']);
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

// ---- v1.71: the default-hidden class ----------------------------------------

const WITH_PODCASTS = ['home', 'playlists', 'history', 'podcasts', 'theme', 'settings'];

test('v1.71/v1.72: the roster names podcasts + music + books default-hidden', () => {
  // v1.72 (cap 2): music + books joined with the same opt-in posture.
  assert.deepEqual(BOTTOM_NAV_DEFAULT_HIDDEN, ['podcasts', 'music', 'books', 'downloads']);
});

test('v1.71: a present default-hidden item is INVISIBLE with an empty config and with every pre-v1.71 config shape', () => {
  for (const cfg of [{}, null, { hidden: [], order: [] }, { hidden: ['theme'], order: ['history'] }]) {
    const out = resolveBottomNavLayout(WITH_PODCASTS, cfg);
    assert.ok(out.visible.indexOf('podcasts') === -1, `podcasts stays off for config ${JSON.stringify(cfg)}`);
    assert.ok(out.hiddenPresent.indexOf('podcasts') >= 0, 'but reports as present-and-hidden (hiddenPresent has no production consumer today - this binds the resolver\'s contract, gate S6)');
  }
});

test('v1.71: shown opts a default-hidden item in; hidden still beats shown; other items ignore shown', () => {
  const out = resolveBottomNavLayout(WITH_PODCASTS, { shown: ['podcasts'] });
  assert.deepEqual(out.visible, WITH_PODCASTS, 'opted in at its DOM position');
  const both = resolveBottomNavLayout(WITH_PODCASTS, { shown: ['podcasts'], hidden: ['podcasts'] });
  assert.ok(both.visible.indexOf('podcasts') === -1, 'an explicit hide wins over shown');
  const noise = resolveBottomNavLayout(WITH_PODCASTS, { shown: ['theme', 'nonsense'] });
  assert.ok(noise.visible.indexOf('podcasts') === -1, 'shown for OTHER ids never leaks visibility to podcasts');
  assert.ok(noise.visible.indexOf('theme') >= 0, 'a shown entry for a normal item is harmless');
});

test('v1.71: an opted-in podcasts item reorders like any optional', () => {
  const out = resolveBottomNavLayout(WITH_PODCASTS, { shown: ['podcasts'], order: ['podcasts', 'theme'] });
  assert.deepEqual(out.visible, ['home', 'podcasts', 'theme', 'playlists', 'history', 'settings']);
});
