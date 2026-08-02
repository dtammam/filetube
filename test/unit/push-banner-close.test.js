'use strict';

// [UNIT] v1.68 T4 - closeDeliveredPushBanners (Dean ruling 4): a play
// closes ITS OWN delivered push banner and nothing else. Executed against a
// stubbed navigator.serviceWorker registration; the id match PARSES the
// banner's data.url ?v param (plan D4: URLSearchParams, never substring -
// the "v=abc must not close v=abc2" hazard is a named test below). The
// wiring (watch.js pingView calls it at the same moment the view ping
// fires) is locked against comment-stripped source, this repo's
// exact-statement form.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { closeDeliveredPushBanners } = require('../../public/js/common.js');

function fakeBanner(url) {
  const b = { data: { url }, closed: false, close() { this.closed = true; } };
  return b;
}

// Node >= 21 ships a getter-only global navigator - override/restore via
// defineProperty, never assignment.
const REAL_NAVIGATOR_DESC = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}
function restoreNavigator() {
  if (REAL_NAVIGATOR_DESC) Object.defineProperty(globalThis, 'navigator', REAL_NAVIGATOR_DESC);
  else delete globalThis.navigator;
}

function withRegistration(banners, fn) {
  setNavigator({
    serviceWorker: {
      getRegistration: () => Promise.resolve({ getNotifications: () => Promise.resolve(banners) }),
    },
  });
  return Promise.resolve().then(fn).finally(restoreNavigator);
}

test('closes exactly the played video\'s banner; different ids and prefix-collisions survive', () =>
  withRegistration([
    fakeBanner('/watch.html?v=abc'),
    fakeBanner('/watch.html?v=abc2'),   // the substring hazard, named
    fakeBanner('/watch.html?v=other'),
    fakeBanner('/watch.html?v=abc&ctx=x'),
  ], async () => {
    const closed = await closeDeliveredPushBanners('abc');
    assert.strictEqual(closed, 2, 'both banners whose PARSED v equals abc');
  }).then(function verify() {}));

test('parse discipline end-to-end: closed flags land on the right banners', () => {
  const target = fakeBanner('/watch.html?v=Vídeo-1');
  const decoy = fakeBanner('/watch.html?v=V%C3%ADdeo-12');
  return withRegistration([target, decoy], async () => {
    await closeDeliveredPushBanners('Vídeo-1');
    assert.strictEqual(target.closed, true, 'the exact id closes');
    assert.strictEqual(decoy.closed, false, 'the longer id survives');
  });
});

// v1.68.1: banners minted BEFORE v1.67.4's pushWatchUrl fix carry ?id= and
// outlive that fix in the phone's shade - a play must retire those too.
test('legacy ?id= banners close on play; ?v= wins over ?id= when both are present', () => {
  const legacy = fakeBanner('/watch.html?id=abc');
  const legacyDecoy = fakeBanner('/watch.html?id=abc2');   // substring hazard, legacy lane
  const modern = fakeBanner('/watch.html?v=abc');
  const bothParams = fakeBanner('/watch.html?v=other&id=abc'); // precedence: v wins, id ignored
  return withRegistration([legacy, legacyDecoy, modern, bothParams], async () => {
    const closed = await closeDeliveredPushBanners('abc');
    assert.strictEqual(closed, 2, 'exactly the legacy ?id=abc and modern ?v=abc banners');
    assert.strictEqual(legacy.closed, true, 'legacy ?id= banner closes');
    assert.strictEqual(legacyDecoy.closed, false, 'the longer legacy id survives');
    assert.strictEqual(modern.closed, true, 'modern ?v= banner closes');
    assert.strictEqual(bothParams.closed, false, 'v takes precedence over a contradicting id');
  });
});

test('garbage banners never throw: missing data, unparseable url, close() that throws', () =>
  withRegistration([
    { close() { throw new Error('gone'); }, data: { url: '/watch.html?v=abc' } },
    { data: null },
    fakeBanner('http://[broken'),
    fakeBanner(''),
  ], async () => {
    const closed = await closeDeliveredPushBanners('abc');
    assert.strictEqual(closed, 0, 'a throwing close() is swallowed and uncounted');
  }));

test('absent plumbing is a silent zero: no navigator, no serviceWorker, no registration, bad mediaId', async () => {
  Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true });
  try {
    assert.strictEqual(await closeDeliveredPushBanners('abc'), 0, 'no navigator');
  } finally { restoreNavigator(); }

  await withRegistration([], async () => {
    assert.strictEqual(await closeDeliveredPushBanners(''), 0, 'empty id');
    assert.strictEqual(await closeDeliveredPushBanners(null), 0, 'null id');
  });

  setNavigator({ serviceWorker: { getRegistration: () => Promise.resolve(null) } });
  try {
    assert.strictEqual(await closeDeliveredPushBanners('abc'), 0, 'no registration');
  } finally { restoreNavigator(); }
});

// ---- the wiring (comment-stripped exact-statement lock) ---------------------

test('watch.js pingView fires the banner close at the SAME play moment as the view ping', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'watch.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
  const body = /function pingView\(id\) \{([\s\S]*?)\n {4}\}/.exec(src);
  assert.ok(body, 'pingView found');
  assert.ok(body[1].includes('closeDeliveredPushBanners(id);'), 'the exact call, inside pingView');
});
