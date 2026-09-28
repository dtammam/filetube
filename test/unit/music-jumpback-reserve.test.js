'use strict';

// [UNIT] v1.339 (L1, M1): the "Jump back in" strip holds its place. It sits ABOVE the
// tabs and used to unhide after its own fetch, shoving tabs + content down 181px on
// every load and SPA return. Now: a remembered tile count (localStorage) reserves an
// EXACT-shape skeleton synchronously at init (and, on a cold load, music.html's inline
// script un-hides the same static skeleton before first paint); the fetch fills it in
// place; none -> collapse; no memory -> stay hidden; a warm SPA return re-paints the
// last real strip with no skeleton, keeping its DOM when the list is unchanged.
// Boots the REAL music.js init() in jsdom (the music-album-view harness shape).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const musicPath = require.resolve('../../public/js/music.js');
require('../../public/js/common.js'); // window-gated boot is inert here
const KEY = 'ft-music-jumpback-count';

const VIEW_HTML = `<body><div id="view-root" data-view="music">
  <select id="music-sort-select"></select>
  <button id="music-view-toggle" hidden><i></i></button>
  <div id="player-slot"></div><div id="media-player"></div>
  <div id="music-nowplaying-panel"></div>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs" role="tablist">
    <button type="button" class="music-tab active" data-tab="albums" role="tab">Albums</button>
  </div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div></body>`;

const settle = () => new Promise((resolve) => setImmediate(resolve));
const RECENT = [
  { id: 't1', artId: 'rep1', title: 'One', artist: 'A' },
  { id: 't2', artId: 'rep1', title: 'Two', artist: 'A' },
];

// A deferred recent-listening response, so a test can look at the strip BEFORE the fetch lands.
function deferred() { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; }

// Boots init() on a fresh jsdom; `mod` is reused across boots to model a warm SPA return
// (the module instance - and its jumpbackWarmHtml - survives; only the view is re-inited).
function makeEnv() {
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  global.window = dom.window;
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  global.AbortController = dom.window.AbortController;
  let registered = null;
  const reveals = [];
  dom.window.FileTube = {
    registerView: (name, m) => { registered = m; },
    encodeListContext: (ctx) => JSON.stringify(ctx),
    decodeListContext: () => null,
    shimmerArt: () => {},
    revealArtTogether: (host) => { reveals.push(host && host.id); return { abort() {} }; },
    player: { currentId: null, getState: () => 'closed', getCurrentMeta: () => null, load: () => {}, setTrackNav: () => {}, expand: () => {} },
  };
  global.window.addToQueue = () => {};
  let recent = deferred();
  global.fetch = (url) => {
    if (url.indexOf('filter=recent-listening') !== -1) return recent.p.then((items) => ({ ok: true, json: async () => ({ items }) }));
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  delete require.cache[musicPath];
  require(musicPath);
  const env = {
    dom, reveals,
    host: () => dom.window.document.getElementById('music-jumpback'),
    // (re)boot the view on a fresh #view-root copy (a SPA swap) - the module stays loaded
    boot() {
      const root = dom.window.document.getElementById('view-root');
      const fresh = root.cloneNode(false);
      fresh.innerHTML = new JSDOM(VIEW_HTML).window.document.getElementById('view-root').innerHTML;
      root.replaceWith(fresh);
      recent = deferred();
      registered.init(fresh);
    },
    land(items) { recent.resolve(items); },
    destroy() { registered.destroy(); },
    restore() { delete require.cache[musicPath]; Object.assign(global, saved); },
  };
  return env;
}

test('a remembered count reserves the EXACT final shape synchronously at init, then fills in place', async () => {
  const env = makeEnv();
  try {
    env.dom.window.localStorage.setItem(KEY, '3');
    env.boot();
    const h = env.host();
    assert.equal(h.hidden, false, 'reserved before the fetch resolves (same task as init)');
    assert.ok(h.querySelector('h2.music-jump-head'), 'the real heading');
    // step 7 (retire R2, deliberate): the scroller is .music-jump-strip and each tile is the
    // ui-tile primitive (the same button chassis the real tiles are)
    const skel = h.querySelectorAll('.music-jump-strip > button.ui-tile.music-jump-tile.music-jump-skel');
    assert.equal(skel.length, 3, 'one skeleton tile per remembered item');
    // Seed the SHAPE you reveal: the real tile chassis (a BUTTON - its line-height reset is
    // part of the height), the real 116px art box, and one-line title + sub.
    for (const b of skel) {
      assert.ok(b.querySelector('span.music-jump-art.skeleton-shimmer'), 'the real art box, shimmering');
      assert.equal(b.querySelector('.music-jump-title').textContent, ' ', 'a one-line title slot');
      assert.equal(b.querySelector('.music-jump-sub').textContent, ' ', 'a one-line sub slot');
      assert.ok(b.disabled && b.getAttribute('aria-hidden') === 'true' && b.tabIndex === -1, 'inert: not focusable, not announced');
    }
    env.land(RECENT);
    for (let i = 0; i < 6; i++) await settle();
    assert.equal(h.hidden, false);
    assert.equal(h.querySelectorAll('.music-jump-skel').length, 0, 'the skeleton is gone');
    const tiles = h.querySelectorAll('.music-jump-tile[data-id]');
    assert.equal(tiles.length, 2);
    assert.match(tiles[0].querySelector('img').getAttribute('src'), /^\/albumart\/rep1\?s=\d+$/, 'tiles key on the shared art id, sized');
    assert.equal(env.dom.window.localStorage.getItem(KEY), '2', 'the new count is remembered for the next visit');
    assert.ok(env.reveals.includes('music-jumpback'), 'the strip hands its art to revealArtTogether');
    env.destroy();
  } finally { env.restore(); }
});

test('a reserve the library no longer backs COLLAPSES (the disclosed reverse-collapse) and remembers 0', async () => {
  const env = makeEnv();
  try {
    env.dom.window.localStorage.setItem(KEY, '2');
    env.boot();
    assert.equal(env.host().hidden, false, 'reserved');
    env.land([]);
    for (let i = 0; i < 6; i++) await settle();
    assert.equal(env.host().hidden, true, 'collapsed');
    assert.equal(env.host().innerHTML, '', 'emptied');
    assert.equal(env.dom.window.localStorage.getItem(KEY), '0');
    env.destroy();
  } finally { env.restore(); }
});

test('no remembered count: stays hidden until items exist (a one-time shift), then remembers', async () => {
  const env = makeEnv();
  try {
    env.boot();
    assert.equal(env.host().hidden, true, 'nothing reserved without a memory');
    env.land(RECENT);
    for (let i = 0; i < 6; i++) await settle();
    assert.equal(env.host().hidden, false);
    assert.equal(env.dom.window.localStorage.getItem(KEY), '2');
    env.destroy();
  } finally { env.restore(); }
});

test('a warm SPA return re-paints the last REAL strip at init (no skeleton) and keeps its DOM when unchanged', async () => {
  const env = makeEnv();
  try {
    env.boot();
    env.land(RECENT);
    for (let i = 0; i < 6; i++) await settle();
    env.destroy();
    env.boot(); // the SPA return: same module instance, fresh view DOM
    const h = env.host();
    assert.equal(h.hidden, false, 'shown synchronously at init');
    assert.equal(h.querySelectorAll('.music-jump-skel').length, 0, 'no skeleton flash on a warm return');
    const img = h.querySelector('.music-jump-tile[data-id="t1"] img');
    assert.ok(img, 'the real tiles, before the fetch');
    env.land(RECENT);
    for (let i = 0; i < 6; i++) await settle();
    assert.strictEqual(h.querySelector('.music-jump-tile[data-id="t1"] img'), img, 'an unchanged list keeps the same DOM (no re-reveal)');
    env.destroy();
    env.boot();
    env.land([{ id: 't9', title: 'New', artist: 'B' }]);
    for (let i = 0; i < 6; i++) await settle();
    assert.ok(env.host().querySelector('.music-jump-tile[data-id="t9"]'), 'a changed list re-renders');
    assert.ok(!env.host().querySelector('[data-id="t1"]'));
    env.destroy();
  } finally { env.restore(); }
});

test('a view torn down mid-fetch writes nothing (the post-await guard)', async () => {
  const env = makeEnv();
  try {
    env.dom.window.localStorage.setItem(KEY, '3');
    env.boot();
    env.destroy();
    env.land([]);
    for (let i = 0; i < 6; i++) await settle();
    assert.equal(env.dom.window.localStorage.getItem(KEY), '3', 'the dead view neither collapses nor rewrites the memory');
  } finally { env.restore(); }
});

test('storage that throws never breaks init (no reserve, no crash)', async () => {
  const env = makeEnv();
  try {
    Object.defineProperty(env.dom.window, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
    env.boot();
    assert.equal(env.host().hidden, true);
    env.land(RECENT);
    for (let i = 0; i < 6; i++) await settle();
    assert.equal(env.host().hidden, false, 'still fills');
    env.destroy();
  } finally { env.restore(); }
});

test('music.html: the static pre-paint skeleton IS buildJumpBackSkeletonHtml(6), and its script reads the same key', () => {
  const html = fs.readFileSync(path.join(REPO, 'public/music.html'), 'utf8');
  const m = /<section id="music-jumpback" class="music-jumpback" aria-label="Jump back in" hidden>([\s\S]*?)<\/section>\s*<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, 'the section is followed by its pre-paint script');
  delete require.cache[musicPath];
  const saved = global.window; global.window = undefined;
  const mod = require(musicPath);
  global.window = saved;
  delete require.cache[musicPath];
  assert.equal(m[1], mod.buildJumpBackSkeletonHtml(6), 'byte-identical to the JS builder (no drift between the two copies)');
  assert.equal(mod.MUSIC_JUMPBACK_COUNT_KEY, KEY);
  const script = m[2].replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(script, /localStorage\.getItem\('ft-music-jumpback-count'\)/, 'the inline reserve reads the SAME key music.js writes');
  assert.match(script, /document\.getElementById\('music-jumpback'\)\.hidden = false/);
  // Behaviour: run the inline script against the real markup, both axes.
  for (const [stored, shown] of [['4', true], ['0', false], [null, false], ['junk', false]]) {
    const dom = new JSDOM(`<body><section id="music-jumpback" hidden>${m[1]}</section></body>`, { url: 'http://localhost/', runScripts: 'outside-only' });
    if (stored !== null) dom.window.localStorage.setItem(KEY, stored);
    dom.window.eval(m[2]);
    assert.equal(!dom.window.document.getElementById('music-jumpback').hidden, shown, `stored ${stored} -> shown ${shown}`);
  }
});

test('the skeleton reuses the real tile box CSS, and restores the shimmer fill', () => {
  const css = fs.readFileSync(path.join(REPO, 'public/css/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.music-jump-art\.skeleton-shimmer\s*\{\s*background-color:\s*var\(--surface-2\);\s*\}/);
  assert.match(css, /\.music-jump-art\s*\{[^}]*width:\s*116px;[^}]*height:\s*116px;/, 'the one art box both tiles use');
});
