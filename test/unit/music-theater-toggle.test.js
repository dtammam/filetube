'use strict';

// [UNIT] v1.317 (Dean, T1): ONE theatre control in the music view - the player's own
// era-style `#theater-btn` (the popcorn `.pc-btn` before the cog, the same button the
// watch page uses), not a second button in the music toolbar. Dean: "the player has a
// built-in theatre mode button but it doesn't work. There's one higher. Idk why we are
// not using the standard one. It doesn't always show."
//
// The root cause (read, not theorised): watch.js injected `#theater-btn` into the
// PERSISTENT player host (parity-locked across the shells, survives SPA swaps) and bound
// its click on the WATCH view's abort signal. So after a watch visit + a soft-nav into
// Music the button was there but dead; on a cold-load of /music it did not exist at all.
// Now player.js's `ensureTheaterButton` is the ONE writer of the markup (id-guarded), each
// view injects through it and binds its OWN click on its OWN signal, and the toolbar
// duplicate `#music-theater-btn` is gone.
//
// These tests drive the REAL shapes (the INERT FEATURE lesson): (a) a cold-load of the
// music shell whose player host is still in its <template>, then a real row play that
// mounts it; (b) a host the watch view already injected into, with a watch-scoped
// listener, then a music mount; (c) music's init/destroy leaving the button for watch.
// The v1.222 contract still holds: `.is-theater` on #music-stage, persisted to
// localStorage (ft-music-theater), restored on init.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const musicPath = require.resolve('../../public/js/music.js');
const playerPath = require.resolve('../../public/js/player.js');
const { ensureTheaterButton } = require(playerPath);

const settle = () => new Promise((resolve) => setImmediate(resolve));

// The shell's control bar, as music.html carries it: inside the lazily-cloned template.
const HOST_HTML = `<div id="player-wrapper"><video id="media-player"></video>
  <div id="player-controls" class="player-controls">
    <button type="button" id="pp-btn" class="pc-btn"></button>
    <button type="button" id="track-prev-btn" class="pc-btn" hidden></button>
    <button type="button" id="track-next-btn" class="pc-btn" hidden></button>
    <input type="range" id="seek-bar" />
    <button type="button" id="settings-btn" class="pc-btn settings-btn"></button>
    <div id="settings-menu" hidden></div>
  </div></div>`;

// The music view (no toolbar theatre button any more) + the dock + the template.
const VIEW_HTML = `<body data-view="music"><div id="view-root" data-view="music">
  <div class="music-toolbar"><div class="music-toolbar-actions">
    <select id="music-sort-select"></select>
    <button id="music-view-toggle" hidden></button>
    <button id="music-popout-btn" hidden></button>
    <button id="music-shuffle-btn"></button>
    <button id="music-scan-btn"></button>
  </div></div>
  <div id="music-stage" class="music-stage"><div id="player-slot"></div>
  <div id="music-nowplaying-panel" class="music-nowplaying-panel" hidden></div></div>
  <button class="music-nowplaying" id="music-nowplaying" hidden></button>
  <section id="music-jumpback" hidden></section>
  <div class="music-tabs" id="music-tabs"><button class="music-tab active" data-tab="songs">Songs</button></div>
  <div id="music-crumb" hidden></div><div id="music-status" role="status" hidden></div>
  <div id="music-content"></div><div id="music-empty" hidden></div>
</div>
<div id="player-dock" hidden></div>
<template id="player-host-template">${HOST_HTML}</template>
</body>`;

const TRACKS = [
  { id: 't1', title: 'Song One', artist: 'A', album: 'B', albumKey: 'A␟B', durationSec: 100 },
  { id: 't2', title: 'Song Two', artist: 'A', album: 'B', albumKey: 'A␟B', durationSec: 90 },
];

// Boots the REAL music.js against a player stub that MOUNTS like the real one: the host
// is cloned from the template exactly once (ensureHost) and reparented into the slot on
// load({slot}) / into the dock on load({dock}). `ensureTheaterButton` is the REAL writer
// exported by player.js, bound to this document (the api binding itself is proven below).
async function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM(VIEW_HTML, { url: 'http://localhost/music' });
  const D = dom.window.document;
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage, fetch: global.fetch, AbortController: global.AbortController };
  global.window = dom.window; global.document = D;
  global.localStorage = dom.window.localStorage; global.AbortController = dom.window.AbortController;
  dom.window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  dom.window.scrollTo = () => {};
  try { dom.window.localStorage.setItem('filetube_music_tab', 'songs'); } catch (_) { /* ignore */ }
  global.fetch = (url, init) => {
    const s = String(url);
    if (init && init.method === 'POST') return Promise.resolve({ ok: true, json: async () => ({}) });
    if (s.indexOf('/api/music?') !== -1 && s.indexOf('filter=') === -1 && s.indexOf('artist=') === -1) return Promise.resolve({ ok: true, json: async () => ({ items: TRACKS }) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  };
  const playerState = { state: 'docked', host: null, meta: null };
  let mod = null;
  const player = {
    currentId: null,
    getState: () => playerState.state,
    expand: () => { playerState.state = 'full'; },
    getCurrentMeta: () => playerState.meta,
    setTrackNav() {},
    load: (id, data, o) => {
      if (!playerState.host) {
        const t = D.getElementById('player-host-template');
        playerState.host = t.content.cloneNode(true).querySelector('#player-wrapper');
      }
      if (o && o.slot) { o.slot.appendChild(playerState.host); playerState.state = 'full'; } else { D.getElementById('player-dock').appendChild(playerState.host); playerState.state = 'docked'; }
      player.currentId = id;
      playerState.meta = { isMusic: true, id, title: data.title, artist: data.channelName, album: data.album, albumKey: data.albumKey };
      return true;
    },
    ensureTheaterButton: () => ensureTheaterButton(D),
  };
  dom.window.FileTube = {
    registerView: (name, m) => { mod = m; }, encodeListContext: (c) => JSON.stringify(c), decodeListContext: (s) => { try { return JSON.parse(s); } catch (_) { return null; } }, shimmerArt: () => {},
    player,
  };
  dom.window.addToQueue = () => {};
  if (opts.prep) opts.prep(dom, playerState);
  try {
    delete require.cache[musicPath];
    require(musicPath);
    mod.init(D.getElementById('view-root'));
    for (let i = 0; i < 8; i++) await settle();
    const ctx = {
      dom, D, playerState, player,
      mod,
      stage: () => D.getElementById('music-stage'),
      btn: () => D.getElementById('theater-btn'),
      click: (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })),
      playRow: async (n) => {
        const row = D.querySelectorAll('#music-content .music-song-row')[n || 0];
        assert.ok(row, 'precondition: a rendered song row to play');
        row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        for (let i = 0; i < 8; i++) await settle();
      },
      reinit: async () => { mod.destroy(); mod.init(D.getElementById('view-root')); for (let i = 0; i < 8; i++) await settle(); },
    };
    await opts.run(ctx);
  } finally { try { if (mod) mod.destroy(); } catch (_) { /* ignore */ } delete require.cache[musicPath]; Object.assign(global, saved); }
}

// ---- the one writer -----------------------------------------------------------

test('v1.317 writer: ensureTheaterButton injects the popcorn pc-btn just before the cog, id-guarded, and stays out when the host is not in the document', () => {
  const dom = new JSDOM(`<body><div id="player-controls"><button id="pp-btn"></button><button id="settings-btn"></button></div></body>`);
  const D = dom.window.document;
  const btn = ensureTheaterButton(D);
  assert.ok(btn, 'returns the injected button');
  assert.strictEqual(btn.id, 'theater-btn');
  assert.strictEqual(btn.className, 'pc-btn theater-btn', 'the era-style control-bar button class (the CSS sizing/theming key)');
  assert.strictEqual(btn.getAttribute('type'), 'button');
  assert.strictEqual(btn.getAttribute('aria-label'), 'Toggle theatre mode');
  assert.strictEqual(btn.getAttribute('aria-pressed'), 'false', 'born unpressed; the owning view re-stamps from its own state');
  assert.strictEqual(btn.nextElementSibling && btn.nextElementSibling.id, 'settings-btn', 'sits immediately before the cog');
  assert.strictEqual(btn.parentNode.id, 'player-controls', 'inside the control bar');
  // The approved glyph (v1.188/v1.191): evenodd striped tub + puffs, scaled to the cog's footprint.
  const svg = btn.querySelector('svg.pc-svg-ico');
  assert.ok(svg && svg.getAttribute('aria-hidden') === 'true', 'decorative SVG; aria-label carries the meaning');
  assert.ok(btn.querySelector('path[fill-rule="evenodd"]'), 'the popcorn tub uses evenodd (the cut-out stripes)');
  assert.strictEqual(btn.querySelector('g').getAttribute('transform'), 'matrix(1.2 0 0 1.2 -98 54)', 'scaled + re-centred to match the settings-cog footprint');
  // id-guard: a second call (the other view mounting later) REUSES, never duplicates.
  const again = ensureTheaterButton(D);
  assert.strictEqual(again, btn, 'the same node comes back');
  assert.strictEqual(D.querySelectorAll('#theater-btn').length, 1, 'exactly one button');
  // No host in the document (the template is cloned lazily): nothing to write into.
  const bare = new JSDOM('<body><template id="player-host-template"><div id="player-controls"><button id="settings-btn"></button></div></template></body>').window.document;
  assert.strictEqual(ensureTheaterButton(bare), null, 'null while the control bar is still inside the template');
  assert.strictEqual(bare.querySelectorAll('#theater-btn').length, 0, 'and nothing was injected anywhere');
  const noCog = new JSDOM('<body><div id="player-controls"><button id="pp-btn"></button></div></body>').window.document;
  assert.strictEqual(ensureTheaterButton(noCog), null, 'no cog to anchor on -> null');
});

test('v1.317 reachability: the REAL player api exposes ensureTheaterButton and it writes into the live document', async () => {
  const dom = new JSDOM(`<body><div id="player-dock" hidden></div><template id="player-host-template">${HOST_HTML}</template>
    <div id="slot">${HOST_HTML}</div></body>`, { url: 'http://localhost/music' });
  const saved = { window: global.window, document: global.document, localStorage: global.localStorage };
  global.window = dom.window; global.document = dom.window.document; global.localStorage = dom.window.localStorage;
  try {
    delete require.cache[playerPath];
    require(playerPath); // the IIFE runs against this window and installs window.FileTube.player
    const api = dom.window.FileTube && dom.window.FileTube.player;
    assert.ok(api && typeof api.ensureTheaterButton === 'function', 'window.FileTube.player.ensureTheaterButton is a function (the binding both views call)');
    const btn = api.ensureTheaterButton();
    assert.ok(btn && btn.ownerDocument === dom.window.document, 'writes into the page document');
    assert.strictEqual(dom.window.document.querySelector('#slot #player-controls #theater-btn'), btn, 'the button landed in the mounted control bar');
    assert.strictEqual(btn.nextElementSibling && btn.nextElementSibling.id, 'settings-btn', 'immediately before the cog');
    assert.strictEqual(api.ensureTheaterButton(), btn, 'id-guarded through the api too');
  } finally {
    delete require.cache[playerPath];
    Object.assign(global, saved);
    require(playerPath); // restore the module for any later require in this process
  }
});

// ---- shape (a): a cold-load of /music, then a real row play mounts the host --------

test('v1.317 cold-load /music: no button exists at init; the first play mounts the host, the in-player button appears and toggles the MUSIC theatre (class, aria, persist), and it is the only theatre control', async () => {
  await boot({ run: async (c) => {
    assert.strictEqual(c.btn(), null, 'precondition (the cold-load shape): the host is still in its template, no button anywhere');
    assert.ok(!c.stage().classList.contains('is-theater'), 'default OFF');
    await c.playRow(0);
    const btn = c.btn();
    assert.ok(btn, 'the first play mounted the host and the music view injected the in-player button');
    assert.strictEqual(c.D.querySelector('#player-slot #player-controls #theater-btn'), btn, 'inside the expanded player (the mounted host in #player-slot)');
    assert.strictEqual(btn.nextElementSibling && btn.nextElementSibling.id, 'settings-btn', 'immediately before the cog');
    assert.strictEqual(c.D.querySelectorAll('#theater-btn, #music-theater-btn, .music-theater-btn').length, 1, 'ONE theatre control in the DOM (the toolbar duplicate is gone)');
    assert.strictEqual(btn.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(btn.hidden, false, 'never hidden by the music view (CSS gates it by breakpoint/dock/view)');
    c.click(btn);
    assert.ok(c.stage().classList.contains('is-theater'), 'ON: the stage goes two-column (CSS does the layout on desktop)');
    assert.strictEqual(btn.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(c.dom.window.localStorage.getItem('ft-music-theater'), '1', 'the choice persists under the music key');
    c.click(btn);
    assert.ok(!c.stage().classList.contains('is-theater'), 'toggles back OFF');
    assert.strictEqual(btn.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(c.dom.window.localStorage.getItem('ft-music-theater'), '0');
    // a second play in the same init re-runs the mount seam: still ONE button, ONE listener
    await c.playRow(1);
    assert.strictEqual(c.D.querySelectorAll('#theater-btn').length, 1, 'no double-inject on the next track');
    c.click(c.btn());
    assert.ok(c.stage().classList.contains('is-theater'), 'one click = exactly one flip (a second listener would flip it back)');
    assert.strictEqual(c.dom.window.localStorage.getItem('ft-music-theater'), '1');
  } });
});

test('v1.317 a persisted theatre choice is restored synchronously at init (before any host exists) and stamped onto the button once it binds', async () => {
  await boot({
    prep: (dom) => { try { dom.window.localStorage.setItem('ft-music-theater', '1'); } catch (_) { /* ignore */ } },
    run: async (c) => {
      assert.ok(c.stage().classList.contains('is-theater'), 'restored ON from localStorage with no button yet (no widen-flash on the first paint)');
      assert.strictEqual(c.btn(), null, 'still no host (cold load)');
      await c.playRow(0);
      assert.strictEqual(c.btn().getAttribute('aria-pressed'), 'true', 'aria-pressed reflects the music state the moment the button binds');
    },
  });
});

// ---- shape (b): the watch view injected first (persistent host), then a soft-nav to music

test('v1.317 watch -> music: the button watch injected is REUSED (no second injection), music binds exactly one click on ITS signal, the watch listener is dead, aria is re-stamped from the music key; destroy unbinds, re-init rebinds once', async () => {
  let watchCtl = null; // the watch view's AbortController (jsdom realm - its EventTarget rejects a foreign AbortSignal)
  let watchClicks = 0;
  const registrations = [];
  await boot({
    prep: (dom, playerState) => {
      const D = dom.window.document;
      // The watch view's residue after a soft-nav away: the host was cloned and now sits
      // DOCKED (the router docks the player on nav-away), the popcorn button is already in
      // it (watch's ensureCogControlsInjected through the same writer), and watch's own
      // click listener was bound on the WATCH view's signal, which the router aborted at
      // the swap (setupTheatreToggle's `{ signal }` binding is source-locked in
      // watch-chrome-ambient.test.js; this stands in for it on a real DOM).
      const t = D.getElementById('player-host-template');
      playerState.host = t.content.cloneNode(true).querySelector('#player-wrapper');
      D.getElementById('player-dock').appendChild(playerState.host);
      const btn = ensureTheaterButton(D);
      watchCtl = new dom.window.AbortController();
      btn.addEventListener('click', () => { watchClicks += 1; }, { signal: watchCtl.signal });
      btn.setAttribute('aria-pressed', 'true'); // watch's theatre was ON (ft-theater), music's is OFF
      watchCtl.abort(); // the router tore the watch view down
      // count every later click registration on the shared button (the listener census)
      const orig = btn.addEventListener.bind(btn);
      btn.addEventListener = function (type, fn, o) { registrations.push({ type, signal: o && o.signal }); return orig(type, fn, o); };
    },
    run: async (c) => {
      const btn = c.btn();
      assert.ok(btn, 'the button watch injected is still in the (docked) host');
      assert.strictEqual(c.D.querySelectorAll('#theater-btn').length, 1, 'music REUSED it - no second injection');
      assert.strictEqual(btn.getAttribute('aria-pressed'), 'false', 'aria-pressed re-stamped from ft-music-theater (OFF), not left at the watch value');
      const musicRegs = registrations.filter((r) => r.type === 'click');
      assert.strictEqual(musicRegs.length, 1, 'music bound exactly ONE click listener at init (the host already existed)');
      assert.ok(musicRegs[0].signal && !musicRegs[0].signal.aborted, 'bound on a live (music) signal');
      c.click(btn);
      assert.ok(c.stage().classList.contains('is-theater'), 'the click now toggles the MUSIC theatre');
      assert.strictEqual(c.dom.window.localStorage.getItem('ft-music-theater'), '1');
      assert.strictEqual(watchClicks, 0, 'the watch listener is gone (its signal was aborted) - no cross-view toggle');
      // expanding a track in this init runs the mount seam again: no extra listener
      await c.playRow(0);
      assert.strictEqual(registrations.filter((r) => r.type === 'click').length, 1, 'the mount seam did not re-bind within the same init');
      assert.strictEqual(c.D.querySelectorAll('#theater-btn').length, 1);
      // nav away (destroy): the music listener dies with its signal; a click is inert
      c.mod.destroy();
      assert.ok(musicRegs[0].signal.aborted, 'destroy aborted the signal the listener rode on');
      c.click(btn);
      assert.ok(c.stage().classList.contains('is-theater'), 'no listener left: the click changed nothing');
      assert.strictEqual(c.dom.window.localStorage.getItem('ft-music-theater'), '1');
      // back into music (the round trip): exactly one fresh listener, one flip per click
      c.mod.init(c.D.getElementById('view-root'));
      for (let i = 0; i < 8; i++) await settle();
      assert.strictEqual(registrations.filter((r) => r.type === 'click').length, 2, 're-init bound exactly one more listener (no accumulation)');
      assert.strictEqual(c.btn().getAttribute('aria-pressed'), 'true', 're-stamped from the persisted music state on the new mount');
      c.click(c.btn());
      assert.ok(!c.stage().classList.contains('is-theater'), 'one click = one flip (two live listeners would cancel out)');
      assert.strictEqual(c.dom.window.localStorage.getItem('ft-music-theater'), '0');
    },
  });
});

// ---- shape (c): music then watch - the shared button survives music's lifecycle -----

test('v1.317 music -> watch: music\'s init/destroy leaves the shared button in place, in position, and never `hidden`, so the watch view\'s post-mount re-query + bind still finds it', async () => {
  await boot({ run: async (c) => {
    await c.playRow(0);
    const btn = c.btn();
    assert.ok(btn, 'precondition: music injected it');
    c.click(btn); // leave music theatre ON
    c.mod.destroy(); // the router swaps #view-root; the host (docked by the router) persists
    assert.strictEqual(c.D.getElementById('theater-btn'), btn, 'the same node survives the music teardown');
    assert.strictEqual(btn.hidden, false, 'music never sets `hidden` on the shared button (watch never clears it)');
    assert.strictEqual(btn.hasAttribute('hidden'), false);
    assert.strictEqual(btn.nextElementSibling && btn.nextElementSibling.id, 'settings-btn', 'still before the cog for watch to re-query');
    assert.strictEqual(ensureTheaterButton(c.D), btn, 'watch\'s ensureCogControlsInjected (the same writer) reuses it, never duplicates');
  } });
});

// ---- CSS: never a visible-but-inert control ------------------------------------

const STYLE_CSS = fs.readFileSync(path.join(REPO, 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('v1.317 CSS: the in-player button is hidden below the desktop breakpoint, in the dock, and on every view that does not wire it (watch + music own it)', () => {
  assert.match(STYLE_CSS, /@media \(max-width: 1024px\) \{\s*#theater-btn \{ display: none; \}\s*\}/, 'desktop-only (theatre has no meaning below the breakpoint) - the watch rule, unchanged');
  assert.match(STYLE_CSS, /\n#player-dock #theater-btn \{ display: none; \}/, 'hidden in the docked mini-player');
  assert.match(STYLE_CSS, /\nbody:not\(\[data-view="watch"\]\):not\(\[data-view="music"\]\) #theater-btn \{ display: none; \}/, 'scoped to the two views that bind a click (podcasts/shows/reader mount the host too and would show a dead button)');
  assert.match(STYLE_CSS, /#theater-btn\[aria-pressed="true"\] \{\s*color: var\(--yt-red\);/, 'the pressed look still keys off aria-pressed (music re-stamps it)');
  // the podcast theatre toggle still wears the toolbar class (out of scope, must not lose its rules)
  assert.match(STYLE_CSS, /@media \(max-width: 1023px\) \{ \.music-theater-btn \{ display: none !important; \} \}/, 'the podcast toolbar button keeps its mobile hide');
});

// ---- one writer, no duplicate control, and SHELL PARITY ----------------------------

function shellFiles() {
  const out = [];
  for (const dir of [path.join(REPO, 'public'), path.join(REPO, 'lib', 'ytdlp', 'views')]) {
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.html')) out.push(path.join(dir, f));
  }
  return out;
}
const tagAt = (html, file) => html.search(new RegExp('<script[^>]+src="/js/' + file.replace('.', '\\.') + '"'));

test('v1.317 ONE writer: the popcorn glyph lives in player.js only; watch.js and music.js inject through the api; no shell bakes #theater-btn or the old #music-theater-btn in', () => {
  const POPCORN = 'M256-556 704-556 652-116 308-116Z';
  const jsDirs = [path.join(REPO, 'public', 'js'), path.join(REPO, 'lib', 'ytdlp', 'client')];
  const carriers = [];
  for (const dir of jsDirs) for (const f of fs.readdirSync(dir)) if (f.endsWith('.js') && fs.readFileSync(path.join(dir, f), 'utf8').includes(POPCORN)) carriers.push(f);
  assert.deepStrictEqual(carriers, ['player.js'], 'exactly one JS writer of the glyph');
  const playerSrc = fs.readFileSync(path.join(REPO, 'public', 'js', 'player.js'), 'utf8');
  assert.strictEqual((playerSrc.match(/id="theater-btn"/g) || []).length, 1, 'and it writes the id once');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const watchSrc = strip(fs.readFileSync(path.join(REPO, 'public', 'js', 'watch.js'), 'utf8'));
  const musicSrc = strip(fs.readFileSync(path.join(REPO, 'public', 'js', 'music.js'), 'utf8'));
  const watchFn = watchSrc.slice(watchSrc.indexOf('function ensureCogControlsInjected'), watchSrc.indexOf('function setupTheatreToggle'));
  assert.match(watchFn, /window\.FileTube\.player\.ensureTheaterButton\(\)/, 'watch injects through the shared writer');
  assert.doesNotMatch(watchSrc, /id="theater-btn"/, 'watch.js carries no copy of the markup');
  const musicFn = musicSrc.slice(musicSrc.indexOf('function bindTheaterControl'), musicSrc.indexOf('function reflectPlaybackModes'));
  assert.match(musicFn, /pl\.ensureTheaterButton\(\)/, 'music injects through the shared writer');
  assert.doesNotMatch(musicSrc, /id="theater-btn"|music-theater-btn/, 'music.js carries no copy and no toolbar duplicate');
  for (const p of shellFiles()) {
    const html = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(html, /id="theater-btn"/, `${path.relative(REPO, p)}: the button is injected, never static (the host is parity-locked)`);
    assert.doesNotMatch(html, /id="music-theater-btn"/, `${path.relative(REPO, p)}: the toolbar duplicate is gone`);
  }
});

test('v1.317 SHELL PARITY (dynamic roster): every shell that loads watch.js or music.js loads player.js (the writer\'s home), and every shell with a player template carries the control bar + cog the writer anchors on', () => {
  const shells = shellFiles();
  assert.ok(shells.length >= 12, `fail-safe floor: expected >=12 shells, found ${shells.length}`);
  let consumers = 0;
  let hosts = 0;
  for (const p of shells) {
    const html = fs.readFileSync(p, 'utf8');
    const rel = path.relative(REPO, p);
    const loadsView = tagAt(html, 'watch.js') !== -1 || tagAt(html, 'music.js') !== -1;
    if (loadsView) {
      consumers++;
      assert.ok(tagAt(html, 'player.js') !== -1, `${rel}: loads a theatre-binding view but not player.js (the v1.250 shell-parity class: a soft-nav'd view would call a helper its shell never shipped)`);
    }
    if (html.includes('id="player-host-template"')) {
      hosts++;
      assert.ok(tagAt(html, 'player.js') !== -1, `${rel}: a player template without player.js`);
      // gate r1 (qa S3): anchor the end on the first `</template>` AFTER the start, not the first in the file
      const start = html.indexOf('id="player-host-template"');
      const tpl = html.slice(start, html.indexOf('</template>', start));
      assert.ok(tpl.includes('id="player-controls"'), `${rel}: the template must carry #player-controls`);
      assert.ok(tpl.includes('id="settings-btn"'), `${rel}: the template must carry the cog the button is anchored before`);
    }
  }
  assert.ok(consumers >= 11, `fail-safe floor: expected >=11 view-loading shells, checked ${consumers}`);
  assert.ok(hosts >= 10, `fail-safe floor: expected >=10 player-hosting shells, checked ${hosts}`);
});
