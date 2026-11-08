'use strict';

// [UNIT] v1.404.0 picture-in-picture, W1 (plan 2026-11-05-ios-pip, the Contract): the `nativeVideoPip` half of the
// bridge AT THE ADAPTER. native-bridge-contract.test.js proves the tables equal the schema; this file proves they BIND: `video.pip` leaves
// the page only under `nativeVideoPip` with a known action, and `videoPip` reaches a listener only with a boolean `active`.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { installFakeHost, loadAdapter } = require('../helpers/fake-host');
const adapterModule = require('../../public/js/host-adapter.js');

function realm(caps) {
  const dom = new JSDOM('<!doctype html><html><head><meta name="ft-version" content="1.404.0"></head><body></body></html>', { runScripts: 'outside-only' });
  const win = dom.window;
  const fake = installFakeHost(win, { capabilities: caps });
  const host = loadAdapter(win);
  fake.clear();
  return { win, fake, host };
}
const OLD_APP = ['nativeAudio', 'nativeVideoAudio', 'nativeVideo', 'nativeVideoDock']; // app v0.17
const PIP_APP = OLD_APP.concat(['nativeVideoPip']);

test('nativeVideoPip is a known capability; video.pip is gated by it; videoPip is a known event', () => {
  assert.ok(adapterModule.CAPABILITIES.includes('nativeVideoPip'));
  assert.strictEqual(adapterModule.MESSAGES['video.pip'].cap, 'nativeVideoPip');
  assert.deepStrictEqual(adapterModule.MESSAGES['video.pip'].fields.action.enum, ['start', 'stop']);
  assert.deepStrictEqual(adapterModule.EVENTS.videoPip.fields.active, { is: 'boolean', req: true });
});

test('a host WITHOUT nativeVideoPip never receives video.pip (app v0.16 / v0.17)', () => {
  const r = realm(OLD_APP);
  assert.strictEqual(r.host.has('nativeVideoPip'), false);
  assert.strictEqual(r.host.post('video.pip', { action: 'start' }), false);
  assert.strictEqual(r.host.post('video.pip', { action: 'stop' }), false);
  assert.deepStrictEqual(r.fake.posts, []);
});

test('with nativeVideoPip: start and stop go out; a missing or unknown action does not; an unknown field never leaves the page', () => {
  const r = realm(PIP_APP);
  assert.strictEqual(r.host.post('video.pip', { action: 'start' }), true);
  assert.strictEqual(r.host.post('video.pip', { action: 'stop', extra: 1 }), true);
  assert.strictEqual(r.host.post('video.pip', {}), false);
  assert.strictEqual(r.host.post('video.pip', { action: 'toggle' }), false);
  assert.deepStrictEqual(r.fake.posts, [{ v: 1, type: 'video.pip', action: 'start' }, { v: 1, type: 'video.pip', action: 'stop' }]);
});

test('videoPip is validated as data: only a boolean active reaches the listener', () => {
  const r = realm(PIP_APP);
  const seen = [];
  r.host.on('videoPip', (d) => seen.push(d));
  r.fake.emit({ v: 1, type: 'videoPip', active: true });
  r.fake.emit({ v: 1, type: 'videoPip', active: 'yes' });
  r.fake.emit({ v: 1, type: 'videoPip' });
  r.fake.emit({ v: 2, type: 'videoPip', active: false });
  r.fake.emit({ v: 1, type: 'videoPip', active: false });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(seen)), [{ active: true }, { active: false }]);
});

test('the docs carry the contract: section 1, the intent and event tables, the owners table, the release note; and audio.stop, never a video.stop that does not exist', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'references', 'native-bridge.md'), 'utf8');
  assert.ok(doc.includes("'nativeVideoDock', 'nativeVideoPip'"), 'section 1 announces it'); // v1.405.0: the add-only list grew past it (nativeTabBar)
  assert.ok(/^\| `video\.pip` \|/m.test(doc), 'section 2');
  assert.ok(/^\| `videoPip` \|/m.test(doc), 'section 3');
  assert.ok(/^\| nativeVideoPip \|/m.test(doc), 'section 5');
  assert.ok(/Picture-in-picture \(v1\.404\.0\) ends with them/.test(doc), 'section 6');
  assert.ok(!/video\.stop/.test(doc), 'the stop intent is audio.stop: the bridge has no video.* transport');
});
