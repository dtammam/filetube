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

test('every skin renderFull emits the core transport hooks + shared reflect targets (not vacuous)', () => {
  for (const id of skins.IDS) {
    const html = skins.renderFull(id, CTX);
    assert.match(html, /data-skin-play/, id + ': play hook (proxies to #pp-btn)');
    assert.match(html, /data-skin-prev/, id + ': prev hook');
    assert.match(html, /data-skin-next/, id + ': next hook');
    assert.ok(html.includes('Track A'), id + ': shows the current title');
    assert.match(html, /width:\s*[\d.]+%/, id + ': scrubber fill reflects position');
    // reflect targets music.js queries every timeupdate, shared by all skins.
    assert.match(html, /class="mms-fill"/, id + ': .mms-fill reflect target');
    assert.match(html, /class="mms-pos"/, id + ': .mms-pos reflect target');
    assert.match(html, /class="mms-rem"/, id + ': .mms-rem reflect target');
  }
});

test('per-skin controls: Apple/Spotify have a swap-glyph play + collapse + tap-seek; iPod is the click wheel', () => {
  const apple = skins.renderFull('apple', CTX);
  const spotify = skins.renderFull('spotify', CTX);
  const ipod = skins.renderFull('ipod', CTX);
  for (const [id, html] of [['apple', apple], ['spotify', spotify]]) {
    assert.match(html, /class="mms-play"/, id + ': the big play (reflectSkin swaps its glyph)');
    assert.match(html, /data-skin-collapse/, id + ': grab/chevron dismiss');
    assert.match(html, /data-skin-seek/, id + ': tap-to-seek bar');
  }
  assert.match(spotify, /data-skin-shuffle/, 'spotify wires the REAL shuffle (-> #music-shuffle-btn)');
  // iPod click wheel: MENU (back/exit) + Select (list), a status-bar play indicator,
  // NO tap-seek (scrubbing deferred), NO collapse chevron, NO swap-glyph .mms-play.
  assert.match(ipod, /data-skin-menu/, 'iPod: MENU zone (back / exit)');
  assert.match(ipod, /data-skin-select/, 'iPod: Select zone (list toggle)');
  assert.match(ipod, /class="mms-playind"/, 'iPod: status-bar play indicator (reflect target)');
  assert.ok(!/data-skin-seek/.test(ipod), 'iPod scrubber is display-only (no seek hook)');
  assert.ok(!/data-skin-collapse/.test(ipod), 'iPod exits via MENU, not the collapse chevron');
  assert.ok(!/class="mms-play"/.test(ipod), 'iPod has no swap-glyph play (the wheel bottom keeps its ▶❚❚)');
});

test('the skins with a list (spotify queue, ipod song list) render jump-by-index rows; apple is art-only', () => {
  for (const id of ['spotify', 'ipod']) {
    const html = skins.renderFull(id, CTX);
    assert.match(html, /data-skin-go="2"/, id + ': list rows jump by queue index');
    assert.match(html, /is-current/, id + ': the current row is marked');
  }
  const apple = skins.renderFull('apple', CTX);
  assert.ok(!/data-skin-go=/.test(apple), 'apple renders no list');
});

test('the iPod skin renders the Classic Now Playing (artist/album/N-of-M + wheel), no chrome knob', () => {
  const html = skins.renderFull('ipod', Object.assign({}, CTX, { curNum: 2, total: 3 }));
  assert.match(html, /NESTALGIA/, 'artist shown (Now Playing meta)');
  assert.match(html, /Retro Mix/, 'album shown');
  assert.match(html, /2 of 3/, 'the "N of M" position');
  assert.match(html, /ip-wheel/, 'the click wheel');
  assert.ok(!/mms-knob/.test(html), 'the old chrome knob is gone (display-only scrubber)');
  // v1.231.1 (Dean): the wheel prev/next/play use SVG line-glyphs, NOT the unicode
  // skip chars (which iOS renders as blue emoji). Guard against a regression to emoji.
  const zones = html.slice(html.indexOf('ip-wheel'));
  assert.match(zones, /data-skin-prev[^>]*><svg/, 'rewind is an SVG glyph');
  assert.match(zones, /data-skin-next[^>]*><svg/, 'fast-forward is an SVG glyph');
  assert.ok(!/[⏮⏭]/.test(zones), 'no unicode skip chars (⏮/⏭) that iOS emoji-fies');
});

test('v1.229: NO in-player skin switcher - picking lives in the account menu now', () => {
  // The in-player chips were unreliable on-device (they vanished against some skins),
  // so skin picking moved to the account-menu segmented control. No render may emit
  // the old data-skin-set hook (else the dead in-panel handler would be reachable).
  for (const id of skins.IDS) {
    const html = skins.renderFull(id, CTX);
    assert.ok(!/data-skin-set/.test(html), id + ': no in-player switcher hook');
    assert.ok(!/mms-skinsw|mms-sw\b/.test(html), id + ': no switcher markup');
  }
  // The registry the MENU picker reads is still exported.
  assert.deepStrictEqual(skins.IDS, ['apple', 'spotify', 'ipod']);
  assert.strictEqual(typeof skins.setActiveSkin, 'function');
  assert.strictEqual(skins.skinById('ipod').label, 'iPod', 'labels for the menu chips');
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
