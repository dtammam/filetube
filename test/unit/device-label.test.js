'use strict';

// [UNIT] v1.78 device handoff - the UA -> device label table
// (public/js/common.js resolveDeviceLabel).
//
// This is a rot-prone roster: every arm exists because a naive check gets it
// wrong, and nothing else in the app would notice if one silently stopped
// matching - a mislabelled card just says the wrong device name, forever.
// The ORDER of the checks is the actual contract, so the tests below are
// written as order traps: real UA strings that match more than one rule.

const { test } = require('node:test');
const assert = require('node:assert');
const { resolveDeviceLabel } = require('../../public/js/common.js');

// Real-world UA strings (trimmed), not invented ones - an invented UA proves
// nothing about a table whose whole job is matching what browsers really send.
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadLegacy: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  ipod: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
};

test('the plain arms: each real UA resolves to its device', () => {
  assert.equal(resolveDeviceLabel(UA.iphone), 'iPhone');
  assert.equal(resolveDeviceLabel(UA.ipadLegacy), 'iPad');
  assert.equal(resolveDeviceLabel(UA.ipod), 'iPod');
  assert.equal(resolveDeviceLabel(UA.windows), 'PC');
  assert.equal(resolveDeviceLabel(UA.mac), 'Mac');
  assert.equal(resolveDeviceLabel(UA.chromebook), 'Chromebook');
  assert.equal(resolveDeviceLabel(UA.linux), 'Linux PC');
});

test('ORDER TRAP: an iPod UA contains "iPhone OS" - it must not read as an iPhone', () => {
  // This one shipped broken in the first draft and only the test found it.
  assert.ok(/iPhone/.test(UA.ipod), 'the trap is real: an iPod UA really does say iPhone OS');
  assert.equal(resolveDeviceLabel(UA.ipod), 'iPod');
});

test('ORDER TRAP: an iPhone UA also contains "Mac OS X" - it must not read as a Mac', () => {
  assert.ok(/Mac OS X/.test(UA.iphone), 'the trap is real: the UA really does say Mac OS X');
  assert.equal(resolveDeviceLabel(UA.iphone), 'iPhone');
  assert.ok(/Mac OS X/.test(UA.ipadLegacy));
  assert.equal(resolveDeviceLabel(UA.ipadLegacy), 'iPad');
});

test('ORDER TRAP: iPadOS 13+ sends a DESKTOP Mac UA - the touch-points tell separates them', () => {
  // Byte-identical UA strings; only maxTouchPoints differs. This is the whole
  // reason the function takes an options bag instead of just a string.
  assert.equal(resolveDeviceLabel(UA.ipadOS, { maxTouchPoints: 5 }), 'iPad');
  assert.equal(resolveDeviceLabel(UA.ipadOS, { maxTouchPoints: 0 }), 'Mac');
  assert.equal(resolveDeviceLabel(UA.mac, { maxTouchPoints: 0 }), 'Mac');
  // A touch-screen Windows laptop must NOT be dragged into the iPad arm.
  assert.equal(resolveDeviceLabel(UA.windows, { maxTouchPoints: 10 }), 'PC');
});

test('ORDER TRAP: every Android UA also says "Linux" - it must not read as a Linux PC', () => {
  assert.ok(/Linux/.test(UA.androidPhone), 'the trap is real');
  assert.equal(resolveDeviceLabel(UA.androidPhone), 'Android phone');
  assert.equal(resolveDeviceLabel(UA.androidTablet), 'Android tablet',
    'no "Mobile" token -> tablet');
});

test('ORDER TRAP: a Chromebook UA is an X11 UA - it must not read as a Linux PC', () => {
  assert.ok(/X11/.test(UA.chromebook));
  assert.equal(resolveDeviceLabel(UA.chromebook), 'Chromebook');
});

test('unknown, empty and non-string input fall back rather than throwing', () => {
  assert.equal(resolveDeviceLabel('SomeFutureBrowser/1.0'), 'Another device');
  assert.equal(resolveDeviceLabel(''), 'Another device');
  assert.equal(resolveDeviceLabel(undefined), 'Another device');
  assert.equal(resolveDeviceLabel(null), 'Another device');
  assert.equal(resolveDeviceLabel(12345), 'Another device');
  assert.equal(resolveDeviceLabel({}), 'Another device');
  // A missing options bag must not throw on the touch-points read.
  assert.equal(resolveDeviceLabel(UA.ipadOS), 'Mac');
  assert.equal(resolveDeviceLabel(UA.ipadOS, {}), 'Mac');
  assert.equal(resolveDeviceLabel(UA.ipadOS, { maxTouchPoints: 'lots' }), 'Mac');
});

test('every label the table can produce survives the server\'s own sanitizer unchanged', () => {
  // The label crosses to the server and back into the card. If the sanitizer
  // ever altered one of our OWN labels, the card would render something we
  // never intended - so bind the two modules together rather than trusting
  // that they happen to agree.
  const { normalizeLabel, LABEL_MAX } = require('../../lib/presence/store.js');
  const produced = new Set();
  for (const ua of Object.values(UA)) {
    for (const tp of [0, 5]) produced.add(resolveDeviceLabel(ua, { maxTouchPoints: tp }));
  }
  produced.add(resolveDeviceLabel('nonsense'));
  assert.ok(produced.size >= 8, 'the roster really is being exercised');
  for (const label of produced) {
    assert.equal(normalizeLabel(label), label, `"${label}" must survive normalizeLabel untouched`);
    assert.ok(label.length <= LABEL_MAX, `"${label}" must fit the server cap`);
  }
});
