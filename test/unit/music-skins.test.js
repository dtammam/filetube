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

test('registry exposes the four skins with render funcs (incl. the v1.232 black iPod)', () => {
  assert.deepStrictEqual(skins.IDS, ['apple', 'spotify', 'ipod', 'ipod-black']);
  assert.strictEqual(skins.DEFAULT_ID, 'apple');
  for (const id of skins.IDS) {
    const s = skins.skinById(id);
    assert.ok(s && typeof s.renderFull === 'function', id + ' has renderFull');
    assert.ok(typeof s.label === 'string' && s.label, id + ' has a label');
  }
  // the black iPod shares the silver iPod's render + declares a `base` so the panel
  // also carries the shared .mms-ipod CSS class (music.js reads it).
  assert.strictEqual(skins.skinById('ipod-black').base, 'ipod', 'black iPod bases on the silver iPod CSS');
  assert.strictEqual(skins.skinById('ipod-black').renderFull, skins.skinById('ipod').renderFull, 'same render, different palette');
  // v1.232.1 (Dean): the labels are CHEEKY riffs, deliberately NOT the real product /
  // company names (the IDS stay literal for CSS/storage).
  const labels = skins.IDS.map((id) => skins.skinById(id).label);
  assert.deepStrictEqual(labels, ['Cider', 'Nordic', 'Pocket Classic', 'Pocket Classic (Black)']);
  for (const l of labels) {
    assert.ok(!/apple|spotify|ipod/i.test(l), 'label "' + l + '" avoids the real product/company names');
  }
});

test('v1.232.1: the iPod LCD is height-capped so a long song list scrolls INSIDE it (not out of bounds)', () => {
  // Device bug (Dean): pressing Select opened the list and the LCD grew past its 4:3
  // box. A flex item's default min-height:auto lets tall content force growth; the cap
  // is min-height:0 + overflow:hidden on .ip-lcd (the list scrolls in .ip-listview).
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  const m = /\.mms-ipod \.ip-lcd\{([^}]*)\}/.exec(css);
  assert.ok(m, 'the .ip-lcd rule exists');
  assert.match(m[1], /min-height:\s*0/, 'min-height:0 caps the flex item at its 4:3 aspect');
  assert.match(m[1], /overflow:\s*hidden/, 'overflow:hidden clips at the LCD box');
  assert.match(m[1], /contain:\s*size/, 'contain:size -> content can NEVER resize the LCD (Dean: never resize)');
});

test('v1.232.3: the full-screen skin LOCKS page scroll (touch-action) - only the list/queue pan', () => {
  // Device bug (Dean): dragging the skin body scrolled the page behind it - body
  // overflow:hidden does not stop iOS touch-scroll. touch-action:none on the fixed
  // panel does; the scrollable regions re-enable vertical panning with pan-y.
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  const full = /\.mms-full\{([^}]*)\}/.exec(css);
  assert.ok(full && /touch-action:\s*none/.test(full[1]), '.mms-full has touch-action:none (page cannot scroll behind the overlay)');
  const list = /\.mms-ipod \.ip-listview\{([^}]*)\}/.exec(css);
  assert.ok(list && /touch-action:\s*pan-y/.test(list[1]), 'the iPod song list re-enables vertical pan');
  const q = /\.mms-spotify \.mms-qlist\{([^}]*)\}/.exec(css);
  assert.ok(q && /touch-action:\s*pan-y/.test(q[1]), 'the Spotify queue re-enables vertical pan');
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

test('v1.232.5: setIpodListMode scrolls the current song into view via the list container (source lock)', () => {
  // jsdom has no layout, so lock the scroll GLUE in source (mirrors the default panel's
  // scroll-to-current lock): rAF-deferred, targets .mms-row.is-current, scrolls the
  // .ip-listview container via scrollTop (never scrollIntoView -> would scroll the page),
  // and normalizes by the container offsetTop (the list is position:static).
  const fs = require('node:fs'); const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  const m = /function setIpodListMode\(on\) \{([\s\S]*?)\n {4}\}/.exec(js);
  assert.ok(m, 'setIpodListMode exists');
  const body = m[1];
  assert.match(body, /\.ip-listview/, 'targets the list container');
  assert.match(body, /\.mms-row\.is-current/, 'centers the CURRENT row');
  // the scroll write must be INSIDE the rAF callback (deferred past the display:none->block
  // layout) - not merely that a raf helper is declared (that would be vacuous).
  assert.match(body, /raf\(function[\s\S]*?\.scrollTop\s*=/, 'the scrollTop write runs inside the rAF callback (deferred)');
  assert.match(body, /cur\.offsetTop\s*-\s*lv\.offsetTop/, 'normalizes by the container offsetTop (static list)');
  assert.ok(!/scrollIntoView/.test(body), 'NOT scrollIntoView (that would scroll the page behind)');
});

test('v1.232.5: the iPod list renders ctx.fullList (whole album, reach earlier songs); Spotify uses upNext', () => {
  const ctx = Object.assign({}, CTX, {
    upNext: [{ index: 5, title: 'Up A', durLabel: '1:00', state: 'current' }, { index: 6, title: 'Up B', durLabel: '2:00', state: 'next' }],
    fullList: [{ index: 0, title: 'Album First', durLabel: '0:30', state: 'played' }, { index: 5, title: 'Up A', durLabel: '1:00', state: 'current' }],
  });
  const ipod = skins.renderFull('ipod', ctx);
  assert.match(ipod, /Album First/, 'iPod list includes the album-start song (from fullList)');
  assert.match(ipod, /data-skin-go="0"/, 'iPod list has song index 0 - scroll-up can reach the start');
  const spotify = skins.renderFull('spotify', ctx);
  assert.ok(!/Album First/.test(spotify), 'Spotify "Next in queue" uses upNext (upcoming), not the whole album');
  assert.match(spotify, /Up A/, 'Spotify shows the upNext rows');
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
  assert.match(zones, /data-skin-play[^>]*><svg/, 'play/pause is an SVG glyph (not the emoji-prone ▶❚❚)');
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
  // The registry the Settings picker reads is still exported.
  assert.deepStrictEqual(skins.IDS, ['apple', 'spotify', 'ipod', 'ipod-black']);
  assert.strictEqual(typeof skins.setActiveSkin, 'function');
  assert.strictEqual(skins.skinById('ipod').label, 'Pocket Classic', 'cheeky label (not the real product name) for the picker');
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
