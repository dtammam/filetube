'use strict';

// [UNIT] Mobile music player skins - the PURE framework (public/js/music-skins.js):
// registry, the mobile+music gate, the per-device setting, and that each skin's
// renderFull emits the STABLE data-skin-* proxy hooks (the view wires those to the
// player's existing controls). Presentation only - no engine here to test.

const { test } = require('node:test');
const assert = require('node:assert');
const skins = require('../../public/js/music-skins.js');

const CTX = {
  track: { title: 'Track A', artist: 'NESTALGIA', album: 'Retro Mix', artUrl: '/albumart/djmix1::c1' },
  upNext: [
    { index: 0, title: 'Intro', durLabel: '0:42', state: 'played' },
    { index: 1, title: 'Track A', durLabel: '5:37', state: 'current' },
    { index: 2, title: 'Track B', durLabel: '4:51', state: 'next' },
  ],
  playing: true, posSec: 96, durSec: 337, posLabel: '1:36', remLabel: '-4:01',
};

test('registry exposes exactly the three skins with render funcs', () => {
  assert.deepStrictEqual(skins.IDS, ['apple', 'spotify', 'ipod']);
  assert.strictEqual(skins.DEFAULT_ID, 'apple');
  for (const id of skins.IDS) {
    const s = skins.skinById(id);
    assert.ok(s && typeof s.renderFull === 'function', id + ' has renderFull');
    assert.ok(typeof s.label === 'string' && s.label, id + ' has a label');
  }
});

test('the per-device setting round-trips and normalizes junk to the default', () => {
  const bag = {}; const store = { getItem: (k) => (k in bag ? bag[k] : null), setItem: (k, v) => { bag[k] = v; } };
  assert.strictEqual(skins.activeSkinId(store), 'apple', 'unset -> default');
  skins.setActiveSkin('spotify', store);
  assert.strictEqual(bag[skins.SKIN_KEY], 'spotify');
  assert.strictEqual(skins.activeSkinId(store), 'spotify');
  skins.setActiveSkin('bogus', store);
  assert.strictEqual(skins.activeSkinId(store), 'apple', 'junk id normalizes to default');
});

test('the GATE is true ONLY for mobile + a music item (desktop / non-music are default chrome)', () => {
  assert.strictEqual(skins.skinActiveFor({ isMusic: true }, true), true, 'mobile + music -> skin');
  assert.strictEqual(skins.skinActiveFor({ isMusic: true }, false), false, 'desktop + music -> default');
  assert.strictEqual(skins.skinActiveFor({ isMusic: false }, true), false, 'mobile + NON-music (video/podcast/book) -> default');
  assert.strictEqual(skins.skinActiveFor(null, true), false, 'nothing playing -> default');
});

test('every skin renderFull emits the proxy hooks + reflects the ctx (not vacuous)', () => {
  for (const id of skins.IDS) {
    const html = skins.renderFull(id, CTX);
    assert.match(html, /data-skin-play/, id + ': play hook (proxies to #pp-btn)');
    assert.match(html, /data-skin-prev/, id + ': prev hook');
    assert.match(html, /data-skin-next/, id + ': next hook');
    assert.match(html, /data-skin-seek/, id + ': seek hook');
    assert.match(html, /data-skin-collapse/, id + ': collapse hook (dock/return)');
    assert.match(html, /data-skin-go="2"/, id + ': up-next rows jump by queue index');
    assert.ok(html.includes('Track A'), id + ': shows the current title');
    assert.match(html, /width:\s*[\d.]+%/, id + ': scrubber fill reflects position');
    assert.match(html, /is-current/, id + ': the current up-next row is marked');
  }
});

test('every render includes the skin SWITCHER - all three options, the active one marked', () => {
  const html = skins.renderFull('spotify', CTX);
  for (const id of skins.IDS) assert.match(html, new RegExp('data-skin-set="' + id + '"'), 'switcher offers ' + id);
  assert.match(html, /data-skin-set="spotify"[^>]*aria-pressed="true"/, 'the active skin (spotify) is marked pressed');
  assert.match(html, /data-skin-set="apple"[^>]*aria-pressed="false"/, 'an inactive skin is not pressed');
});

test('the pause glyph shows only when playing; play glyph when paused', () => {
  const playing = skins.renderFull('apple', Object.assign({}, CTX, { playing: true }));
  const paused = skins.renderFull('apple', Object.assign({}, CTX, { playing: false }));
  assert.match(playing, /aria-label="Pause"/, 'playing -> Pause affordance');
  assert.match(paused, /aria-label="Play"/, 'paused -> Play affordance');
});

test('render ESCAPES track/queue text (no HTML injection from a crafted tag/title)', () => {
  const evil = { track: { title: '<img src=x onerror=alert(1)>', artist: '"><b>', album: 'A&B', artUrl: '/x' },
    upNext: [{ index: 0, title: '<script>', durLabel: '', state: 'current' }], playing: false, posSec: 0, durSec: 100 };
  const html = skins.renderFull('spotify', evil);
  assert.ok(!/<img src=x/.test(html), 'the raw <img> tag never lands in the DOM');
  assert.ok(!/<script>/.test(html), 'the raw <script> never lands');
  assert.match(html, /&lt;img src=x/, 'it is escaped');
});

test('pct clamps position into 0..100 and guards a zero/absent duration', () => {
  assert.strictEqual(skins._pct(0, 0), 0);
  assert.strictEqual(skins._pct(50, 100), 50);
  assert.strictEqual(skins._pct(999, 100), 100, 'over-run clamps to 100');
  assert.strictEqual(skins._pct(10, 0), 0, 'zero duration -> 0, no NaN');
});
