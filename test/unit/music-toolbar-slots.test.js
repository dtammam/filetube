'use strict';

// [UNIT] v1.339 (L1b): the music toolbar never reflows when a tab- or state-dependent
// control shows or hides. Once L2's global `.btn[hidden]{display:none!important}` made
// [hidden] really remove a box, the Artists-only view toggle (and the drill's wider sort
// list) pushed Autoplay from row 1 to row 2 of the wrapped mobile toolbar (CLS 0.0174 /
// 0.0194). Every such control now goes through ONE writer, setToolbarSlot: 'shown',
// 'reserved' (box kept; invisible, inert, aria-hidden, tabindex -1) or 'gone' ([hidden]).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const musicPath = require.resolve('../../public/js/music.js');
function loadPure() {
  delete require.cache[musicPath];
  const saved = global.window; global.window = undefined;
  try { return require(musicPath); } finally { global.window = saved; delete require.cache[musicPath]; }
}
const M = loadPure();
const MUSIC = fs.readFileSync(path.join(REPO, 'public/js/music.js'), 'utf8');
const CSS = fs.readFileSync(path.join(REPO, 'public/css/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function btn() {
  const dom = new JSDOM('<body><button id="b" class="btn btn-sm">x</button></body>');
  return dom.window.document.getElementById('b');
}

test('setToolbarSlot: reserved keeps the box but makes it invisible, inert, aria-hidden and unfocusable', () => {
  const el = btn();
  M.setToolbarSlot(el, 'reserved');
  assert.strictEqual(el.hidden, false, 'never [hidden] (that removes the box and reflows the row)');
  assert.ok(el.classList.contains('music-slot-reserved'));
  assert.strictEqual(el.getAttribute('aria-hidden'), 'true');
  assert.strictEqual(el.getAttribute('tabindex'), '-1');
  assert.ok(el.hasAttribute('inert'));
  assert.strictEqual(M.toolbarSlotLive(el), false);
});

test('setToolbarSlot: shown clears EVERY reserve mark (from a populated reserved state)', () => {
  const el = btn();
  M.setToolbarSlot(el, 'reserved');
  M.setToolbarSlot(el, 'shown');
  assert.strictEqual(el.hidden, false);
  assert.ok(!el.classList.contains('music-slot-reserved'));
  assert.ok(!el.hasAttribute('aria-hidden') && !el.hasAttribute('tabindex') && !el.hasAttribute('inert'));
  assert.strictEqual(M.toolbarSlotLive(el), true);
});

test('setToolbarSlot: gone is [hidden] with no reserve marks; from gone back to shown', () => {
  const el = btn();
  M.setToolbarSlot(el, 'reserved');
  M.setToolbarSlot(el, 'gone');
  assert.strictEqual(el.hidden, true);
  assert.ok(!el.classList.contains('music-slot-reserved') && !el.hasAttribute('inert'));
  assert.strictEqual(M.toolbarSlotLive(el), false);
  M.setToolbarSlot(el, 'shown');
  assert.strictEqual(el.hidden, false);
  assert.doesNotThrow(() => M.setToolbarSlot(null, 'shown'));
});

test('CSS: the reserve is visibility (never display), and the sort select has a FIXED width', () => {
  const m = /\.music-toolbar-actions \.music-slot-reserved\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(m, 'the reserve rule exists, scoped to the toolbar');
  assert.match(m[1], /^\s*visibility:\s*hidden;\s*$/, 'visibility only - the box stays');
  const w = /#music-sort-select\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(w, 'a base #music-sort-select rule');
  assert.match(w[1], /width:\s*15em;/, 'a fixed width (a select sizes to its widest option; the drill list is wider)');
  assert.doesNotMatch(CSS, /music-sort-reserved/, 'the retired per-control class is gone');
});

test('every toolbar control that toggles goes through the ONE writer (no direct [hidden] writes)', () => {
  assert.doesNotMatch(MUSIC, /\b(sortSelect|wrap|viewToggleBtn|popoutBtn|actionsBtn)\.hidden\s*=/, 'no bypass of setToolbarSlot');
  assert.match(MUSIC, /setToolbarSlot\(wrap, reserveOnly \? 'reserved' : 'shown'\)/, 'sort: reserved on Home');
  assert.match(MUSIC, /setToolbarSlot\(viewToggleBtn, showable \? 'shown' : 'reserved'\)/, 'view toggle: reserved off the Artists grid');
  assert.match(MUSIC, /setToolbarSlot\(popoutBtn, !popoutSupported\(\) \? 'gone' : \(hasCurrentMusicTrack\(\) \? 'shown' : 'reserved'\)\)/, 'pop-out: reserved where supported');
  assert.match(MUSIC, /setToolbarSlot\(actionsBtn, show \? 'shown' : \(expanded \? 'reserved' : 'gone'\)\)/, 'More: reserved while expanded');
});

test('a reserved control never acts: every toolbar click handler checks toolbarSlotLive', () => {
  assert.match(MUSIC, /viewToggleBtn\.addEventListener\('click', function \(\) \{\s*if \(!toolbarSlotLive\(viewToggleBtn\)\) return;/);
  assert.match(MUSIC, /popoutBtn\.addEventListener\('click', function \(\) \{ if \(toolbarSlotLive\(popoutBtn\)\) togglePopout\(\); \}/);
  assert.match(MUSIC, /if \(toolbarSlotLive\(actionsBtn\)\) toggleActionsMenu\(\);/);
});

test('music.html ships the view toggle and the pop-out already RESERVED (the first paint has their slots)', () => {
  const html = fs.readFileSync(path.join(REPO, 'public/music.html'), 'utf8');
  const dom = new JSDOM(html);
  for (const id of ['music-view-toggle', 'music-popout-btn']) {
    const el = dom.window.document.getElementById(id);
    assert.ok(el, id);
    assert.strictEqual(el.hidden, false, `${id}: never [hidden] in the markup (that paints without its box, then init reflows)`);
    // Parity with the JS writer: the markup carries exactly what setToolbarSlot(el,
    // 'reserved') leaves, so a cold init changes nothing about the box.
    const probe = el.cloneNode(true);
    M.setToolbarSlot(probe, 'reserved');
    assert.strictEqual(probe.outerHTML, el.outerHTML, `${id}: markup == setToolbarSlot(reserved)`);
    assert.ok(el.classList.contains('music-slot-reserved') && el.hasAttribute('inert'), `${id}: reserved + inert`);
  }
});

// UI pass D7: the pop-out's gate is the device class (html.is-phone), so its pre-JS box rule keys
// on the SAME class popoutSupported() reads through music-skins.js isPhone - never a width.
test('the pop-out has no box on a phone - the SAME class popoutSupported() reads', () => {
  const m = /(?:^|\n)html\.is-phone #music-popout-btn\s*\{\s*display:\s*none;?\s*\}/.exec(CSS);
  assert.ok(m, 'a phone-class rule removes the pop-out box before music.js runs');
  assert.doesNotMatch(CSS, /@media \(max-width: \d+px\)\s*\{\s*#music-popout-btn/, 'no width query decides the pop-out box');
  const skins = fs.readFileSync(path.join(REPO, 'public/js/music-skins.js'), 'utf8');
  assert.match(skins, /var PHONE_CLASS = 'is-phone';/, 'music-skins.js names the same class');
  assert.match(skins, /function isPhone\(phone\) \{[\s\S]*?classList\.contains\(PHONE_CLASS\)/, 'isPhone reads the class');
  assert.match(MUSIC, /function popoutSupported\(\) \{\s*try \{ if \(SKINS && SKINS\.isPhone && SKINS\.isPhone\(\)\) return false;/, 'popoutSupported reads isPhone');
});
