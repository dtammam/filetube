'use strict';

// [UNIT] v1.278 (Dean): the DESKTOP /music actions menu - the video-parity Extras
// (Share/Transcript/Watch/Reheat/Like/Watched/queue/Move/Delete, "if relevant") brought
// to the desktop now-playing view via the SHARED createExtrasMenu factory (skin-surface.js),
// triggered from the top toolbar. These bind the pieces the JS suites can't see: the CSS
// lift (Task 3) that lets the desktop menu be styled, and the shared factory being on the
// public API. The live desktop feel is Dean's device arbiter.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
const SKIN = fs.readFileSync(path.join(ROOT, 'public', 'js', 'skin-surface.js'), 'utf8');

// ---- Task 2: the Extras action core is a SHARED factory on the public API ----------

test('createExtrasMenu is exported so BOTH the skin engine and the desktop menu reuse ONE core (DRY, no second menu)', () => {
  assert.match(SKIN, /createExtrasMenu:\s*createExtrasMenu/, 'FileTubeSkinSurface exposes createExtrasMenu');
  assert.match(SKIN, /function createExtrasMenu\(cfg\)/, 'the factory exists');
  assert.match(SKIN, /return \{ open: open, handleAction: handleAction, cancelPending: cancelPending, destroy: destroy \};/, 'the documented shape');
});

// ---- Task 3: the CSS lift - the .mms-sm-* item styling is UNCONDITIONAL so the desktop
// menu (which carries the .mms-sticker-menu class) is dressed; only the mobile POSITIONING
// stays behind @media (max-width:768px). --------------------------------------------------

test('the sticker/actions item styling is lifted OUT of the mobile media query (else the desktop menu ships unstyled)', () => {
  const actIdx = CSS.indexOf('.mms-sticker-menu .mms-sm-act{');
  const mobileStickerIdx = CSS.indexOf('body.mms-tray .mms-sticker-menu{ position:fixed');
  assert.ok(actIdx > 0, 'the .mms-sm-act item rule exists');
  assert.ok(mobileStickerIdx > 0, 'the mobile-only tray positioning still exists (inside @media)');
  assert.ok(actIdx < mobileStickerIdx,
    'the .mms-sm-act item rule sits ABOVE the mobile sticker @media block - i.e. it is unconditional, so the desktop actions menu is styled');
});

test('the desktop actions menu has its own top-anchored positioning (not the mobile bottom-of-corner-sticker anchor)', () => {
  assert.match(CSS, /#music-actions-menu\{[^}]*position:absolute/, 'the desktop menu is absolutely positioned');
  assert.match(CSS, /#music-actions-menu\{[^}]*top:calc\(100% \+ var\(--space-3\)\)/, 'anchored BELOW its toolbar button');
  assert.match(CSS, /\.music-actions-wrap\{[^}]*position:relative/, 'the wrapper is the positioning context');
});

// ---- Task 4/5: the desktop wiring in music.js (source-locked to the SHARED factory) -----

const MUSIC = fs.readFileSync(path.join(ROOT, 'public', 'js', 'music.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'music.html'), 'utf8');

test('the top-toolbar trigger + menu exist in music.html', () => {
  assert.match(HTML, /id="music-actions-btn"[^>]*aria-haspopup="true"/, 'the More trigger button');
  assert.match(HTML, /<div class="mms-sticker-menu" id="music-actions-menu"[^>]*role="menu"[^>]*hidden>/, 'the menu popover reuses the shared .mms-sticker-menu class');
});

test('music.js builds the desktop menu from the SHARED createExtrasMenu (not a re-implemented menu) and composes Watch in', () => {
  assert.match(MUSIC, /SkinSurface\.createExtrasMenu\(\{/, 'reuses the shared factory');
  assert.match(MUSIC, /getMenuEl:\s*function \(\) \{ return actionsMenu; \}/, 'renders into the toolbar popover');
  assert.match(MUSIC, /hasWatchBack:\s*watchBackVisible/, 'Watch gated on the hoisted watchBackVisible');
  assert.match(MUSIC, /onWatch:\s*watchBackTap/, 'Watch navigates via the hoisted watchBackTap');
  assert.match(MUSIC, /getBaseId:\s*extrasBaseId/, 'the SAME ::c-stripping base id the sticker menu uses');
  assert.match(MUSIC, /onMutated:\s*afterExtrasMutation/, 'Move/Delete refresh reuses the view hook');
});

test('the trigger toggles, clicks delegate to the shared handleAction, and the button self-gates to a FULL library track', () => {
  assert.match(MUSIC, /actionsBtn\.addEventListener\('click', function \(e\) \{ e\.stopPropagation\(\); toggleActionsMenu\(\); \}/, 'the trigger toggles the menu');
  assert.match(MUSIC, /desktopExtras\.handleAction\(act, xact\)/, 'menu clicks dispatch to the shared action handler (anti-INERT)');
  assert.match(MUSIC, /function updateActionsBtn\(\) \{[\s\S]*?p\.getState\(\) === 'full'[\s\S]*?extrasEligibleView\(\)/, 'shown only for a FULL, library-eligible track');
  assert.match(MUSIC, /activeDesktopExtras\.destroy\(\)/, 'the view-swap teardown stops a live reheat poll');
});

// ---- Task 4: the shared factory behaviour under the DESKTOP cfg (anti-INERT) ------------
// Proves the desktop contract end-to-end WITHOUT booting all of music.js: open() fetches
// the base item and renders the action set INCLUDING the cfg-gated Watch, and the
// dispatch drives share/watch.

const { JSDOM } = require('jsdom');

function bootFactory(opts) {
  opts = opts || {};
  const dom = new JSDOM('<body><div id="menu" hidden></div></body>', { url: 'https://x.test/music' });
  const w = dom.window;
  const calls = [];
  w.fetch = (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET' });
    if (String(url).indexOf('/api/videos/') === 0) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        id: 'base9', title: 'Chaptered Mix', watchUrl: 'https://youtu.be/abc123DEF45',
        hasSubtitles: true, liked: false, watchState: 'unwatched',
      }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  w.fetchCurrentUser = () => Promise.resolve({ user: { role: 'admin' } });
  let watched = 0;
  let closed = 0;
  const menuEl = w.document.getElementById('menu');
  // Load skin-surface.js against this window (createExtrasMenu is standalone - no skins
  // needed). The factory resolves `window`/`fetch` at CALL time, so these globals stay set
  // for the duration of the test (these are the last tests in the file).
  global.window = w; global.document = w.document; global.fetch = w.fetch;
  delete require.cache[require.resolve('../../public/js/skin-surface.js')];
  const api = require('../../public/js/skin-surface.js');
  const menu = api.createExtrasMenu({
    getMenuEl: () => menuEl,
    getBaseId: () => 'base9', // the view already strips ::c; here the base
    getPlayer: () => ({ getCurrentTime: () => 0 }),
    getSignal: () => null,
    close: () => { closed++; menuEl.hidden = true; },
    backHtml: () => '',
    stillOnPage: () => !menuEl.hidden,
    onMutated: () => {},
    hasWatchBack: () => !!opts.hasWatchBack,
    onWatch: () => { watched++; },
  });
  return { w, menuEl, menu, calls, get watched() { return watched; }, get closed() { return closed; } };
}

const settle = () => new Promise((r) => setImmediate(r));

test('desktop factory: open() fetches the base item and renders the video-parity action set INCLUDING Watch', async () => {
  const b = bootFactory({ hasWatchBack: true });
  b.menuEl.hidden = false;
  b.menu.open();
  await settle();
  assert.ok(b.calls.some((c) => c.url === '/api/videos/base9' && c.method === 'GET'), 'fetched the base media item on open');
  const q = (n) => b.menuEl.querySelector('[data-skin-x="' + n + '"]');
  for (const name of ['share', 'watch', 'download', 'like', 'watched', 'queue', 'queue-next', 'transcript', 'reheat']) {
    assert.ok(q(name), 'rendered: ' + name);
  }
});

test('desktop factory: Watch is cfg-gated - absent when hasWatchBack is false (mobile parity)', async () => {
  const b = bootFactory({ hasWatchBack: false });
  b.menuEl.hidden = false;
  b.menu.open();
  await settle();
  assert.strictEqual(b.menuEl.querySelector('[data-skin-x="watch"]'), null, 'no Watch row when the surface does not offer it');
  assert.ok(b.menuEl.querySelector('[data-skin-x="share"]'), 'Share still present');
});

test('desktop factory: dispatching Watch calls onWatch and closes; a stale fetch after close renders nothing (TOCTOU)', async () => {
  const b = bootFactory({ hasWatchBack: true });
  b.menuEl.hidden = false;
  b.menu.open();
  await settle();
  b.menu.handleAction('watch', b.menuEl.querySelector('[data-skin-x="watch"]'));
  assert.strictEqual(b.watched, 1, 'Watch navigated');
  assert.strictEqual(b.closed, 1, 'menu closed on a navigating action');
  // TOCTOU: close the menu, open again but flip hidden true mid-flight -> nothing renders.
  b.menuEl.hidden = false;
  b.menu.open();
  b.menuEl.hidden = true; // closed while the fetch is in flight
  await settle();
  assert.strictEqual(b.menuEl.querySelector('[data-skin-x="share"]'), null, 'a fetch that resolves after close does not paint');
});
