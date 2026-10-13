'use strict';

// [UNIT] v1.389.0 (plan 2026-10-13-phone-landscape): "a sideways phone stays a phone".
//   D1/D2  the side menu is TWO states: the desktop collapse (`.hidden` + `.expanded`) and the phone
//          drawer (`.mobile-open` alone), chosen at click time by sidebarPhoneLayout; a rotation or
//          a crossing of 768px closes the drawer; a link, an outside press and Escape close it;
//   D3/D4  (below) the watch page enters the phone fullscreen view when already sideways.
// The sidebar half boots the REAL public/index.html through common.js in jsdom (the click wiring
// is the thing under test, not a hand copy of it), with a controllable matchMedia.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJs = (s) => strip(s).replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// A matchMedia whose answers the test sets and whose 'change' listeners it can fire.
function makeMatchMedia(initial) {
  const state = Object.assign({ '(max-width: 768px)': false, '(orientation: landscape)': false }, initial);
  const listeners = {};
  const mm = (q) => ({
    get matches() { return !!state[q]; },
    media: q,
    addEventListener(type, fn) { if (type === 'change') (listeners[q] = listeners[q] || []).push(fn); },
    removeEventListener() {},
  });
  mm.set = (q, v) => { state[q] = v; (listeners[q] || []).forEach((fn) => fn({ matches: v, media: q })); };
  mm.listenerCount = (q) => (listeners[q] || []).length;
  return mm;
}

async function bootShell({ phone, media }) {
  let html = fs.readFileSync(path.join(REPO, 'public/index.html'), 'utf8');
  if (phone) html = html.replace('<html', '<html class="is-phone"');
  const inlined = [];
  let past = false;
  html = html.replace(/<script([^>]*) src="\/js\/([\w-]+\.js)"([^>]*)><\/script>/g, (m, a, file, b) => {
    if (past) return '';
    if (file === 'common.js') past = true;
    inlined.push(file);
    return `<script${a}${b}>${fs.readFileSync(path.join(REPO, 'public/js', file), 'utf8')}</script>`;
  });
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  const mm = makeMatchMedia(media);
  const page = new JSDOM(html, {
    url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
    beforeParse(w) {
      w.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
      w.matchMedia = mm;
    },
  });
  const w = page.window;
  if (w.document.readyState !== 'complete') await new Promise((r) => w.addEventListener('load', r, { once: true }));
  await tick(50);
  assert.ok(inlined.length > 5 && inlined[inlined.length - 1] === 'common.js', 'precondition: the shell scripts ran, common.js last');
  assert.deepStrictEqual(errors, [], 'precondition: the boot threw nothing');
  const d = w.document;
  const sidebar = d.getElementById('sidebar');
  const main = d.getElementById('main-content');
  const toggle = d.getElementById('menu-toggle');
  assert.ok(sidebar && main && toggle, 'precondition: the shell carries the sidebar, the content and the menu button');
  // a navigation link inside the sidebar (the real ones are injected late by other code)
  const link = d.createElement('a'); link.className = 'sidebar-item'; link.href = '/history.html';
  const label = d.createElement('span'); link.appendChild(label); sidebar.appendChild(link);
  const note = d.createElement('div'); note.className = 'sidebar-section-title'; sidebar.appendChild(note);
  const outside = d.createElement('div'); main.appendChild(outside);
  const st = () => ({ hidden: sidebar.classList.contains('hidden'), open: sidebar.classList.contains('mobile-open'), expanded: main.classList.contains('expanded') });
  const press = (el) => el.dispatchEvent(new w.Event('pointerdown', { bubbles: true, cancelable: true }));
  return { w, d, mm, sidebar, main, toggle, link, label, note, outside, st, press, close: () => w.close() };
}
const CLOSED = { hidden: false, open: false, expanded: false };
const DRAWER = { hidden: false, open: true, expanded: false };
const COLLAPSED = { hidden: true, open: false, expanded: true };

test('D2 phone landscape (real page): the menu button toggles ONLY the drawer; the desktop pair is never written', async () => {
  const s = await bootShell({ phone: true, media: { '(orientation: landscape)': true } });
  try {
    assert.deepStrictEqual(s.st(), CLOSED, 'precondition: closed');
    s.toggle.click(); assert.deepStrictEqual(s.st(), DRAWER, 'first tap opens the drawer');
    s.toggle.click(); assert.deepStrictEqual(s.st(), CLOSED, 'second tap closes it - and leaves no hidden/mobile-open residue (the leak)');
    s.toggle.click(); assert.deepStrictEqual(s.st(), DRAWER, 'and opens again');
  } finally { s.close(); }
});

test('D2 rotation permutations (real page): open/close in each orientation, rotate, and the drawer is never left open', async () => {
  const s = await bootShell({ phone: true, media: { '(orientation: landscape)': true } });
  const rotate = (landscape) => s.mm.set('(orientation: landscape)', landscape);
  try {
    for (const start of [true, false]) {
      for (const openFirst of [true, false]) {
        s.mm.set('(orientation: landscape)', start);
        if (s.st().open) s.toggle.click();
        assert.deepStrictEqual(s.st(), CLOSED, `precondition (start landscape=${start}, openFirst=${openFirst})`);
        if (openFirst) { s.toggle.click(); assert.deepStrictEqual(s.st(), DRAWER, 'opened'); }
        else { s.toggle.click(); s.toggle.click(); assert.deepStrictEqual(s.st(), CLOSED, 'opened then closed by hand'); }
        rotate(!start);
        assert.deepStrictEqual(s.st(), CLOSED, `rotated: never left open (start landscape=${start}, openFirst=${openFirst})`);
        rotate(start);
        assert.deepStrictEqual(s.st(), CLOSED, 'rotated back: closed');
      }
    }
  } finally { s.close(); }
});

test('D2 desktop (real page): the menu button writes ONLY the collapse pair, never the drawer, and a width crossing leaves the collapse alone', async () => {
  const s = await bootShell({ phone: false, media: {} });
  try {
    assert.deepStrictEqual(s.st(), CLOSED);
    s.toggle.click(); assert.deepStrictEqual(s.st(), COLLAPSED, 'collapses: hidden + expanded, no mobile-open');
    s.mm.set('(max-width: 768px)', true); s.mm.set('(max-width: 768px)', false); // a window resized across 768
    s.mm.set('(orientation: landscape)', true);
    assert.deepStrictEqual(s.st(), COLLAPSED, 'the desktop collapse survives a crossing');
    s.toggle.click(); assert.deepStrictEqual(s.st(), CLOSED, 'expands again');
  } finally { s.close(); }
});

test('D2 a narrow non-phone window (<= 768px) is the phone layout at click time (the same test the CSS uses)', async () => {
  const s = await bootShell({ phone: false, media: { '(max-width: 768px)': true } });
  try {
    s.toggle.click(); assert.deepStrictEqual(s.st(), DRAWER);
    s.mm.set('(max-width: 768px)', false); // widened back to desktop: a crossing clears the drawer
    assert.deepStrictEqual(s.st(), CLOSED, 'a crossing closes the drawer');
  } finally { s.close(); }
});

test('D2 the drawer closes on a link tap, an outside press and Escape - and an inside press, or the button, does not', async () => {
  const s = await bootShell({ phone: true, media: { '(orientation: landscape)': true } });
  const open = () => { if (!s.st().open) s.toggle.click(); assert.deepStrictEqual(s.st(), DRAWER, 'precondition: drawer open'); };
  try {
    open(); s.link.click(); assert.deepStrictEqual(s.st(), CLOSED, 'a tap on a link inside the drawer closes it (the SPA navigates)');
    open(); s.label.click(); assert.deepStrictEqual(s.st(), CLOSED, 'a tap on a child of the link closes it too');
    open(); s.press(s.outside); assert.deepStrictEqual(s.st(), CLOSED, 'a press outside closes it');
    open(); s.press(s.note); assert.deepStrictEqual(s.st(), DRAWER, 'a press on the drawer\'s own non-link text keeps it open');
    s.d.dispatchEvent(new s.w.KeyboardEvent('keydown', { key: 'a', bubbles: true })); assert.deepStrictEqual(s.st(), DRAWER, 'another key keeps it open');
    s.d.dispatchEvent(new s.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.deepStrictEqual(s.st(), CLOSED, 'Escape closes it');
    const glyph = s.toggle.querySelector('svg') || s.toggle.firstElementChild;
    assert.ok(glyph && glyph !== s.toggle, 'precondition: the button has a child glyph (a real tap lands on it)');
    open(); s.press(glyph); assert.deepStrictEqual(s.st(), DRAWER, 'a press on the button\'s glyph does not close it (its click would reopen it)');
    s.press(s.toggle); assert.deepStrictEqual(s.st(), DRAWER, 'nor a press on the button itself');
    s.toggle.click(); assert.deepStrictEqual(s.st(), CLOSED, 'the button closes it');
  } finally { s.close(); }
});

test('D2 desktop: the same close paths never touch the desktop collapse', async () => {
  const s = await bootShell({ phone: false, media: {} });
  try {
    s.toggle.click(); assert.deepStrictEqual(s.st(), COLLAPSED);
    s.press(s.outside); s.d.dispatchEvent(new s.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); s.link.click();
    assert.deepStrictEqual(s.st(), COLLAPSED, 'an outside press, Escape and a link tap leave a desktop collapse as the user set it');
  } finally { s.close(); }
});

// ---- the CSS half: a source lock, since jsdom cannot measure the cascade (probe-measured too) ----
const css = strip(fs.readFileSync(path.join(REPO, 'public/css/style.css'), 'utf8'));
function blockAt(src, header) {
  const i = src.indexOf(header);
  assert.ok(i >= 0, 'found ' + header);
  let depth = 0; let j = src.indexOf('{', i);
  const start = j;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) break; } }
  return src.slice(start + 1, j);
}
test('D1 CSS: ONE phone-width block carries the drawer rules (off-canvas, open, no content margin), after the base rules, keyed on html.is-phone', () => {
  assert.strictEqual(css.split('@media (min-width: 769px) {\n  html.is-phone .sidebar {').length - 1, 1, 'one block');
  const body = blockAt(css, '@media (min-width: 769px) {\n  html.is-phone .sidebar {');
  assert.match(body, /html\.is-phone \.sidebar \{\s*transform: translateX\(calc\(-1 \* var\(--sidebar-w\)\)\);\s*\}/, 'off-canvas by the same coupling as .sidebar.hidden');
  assert.match(body, /html\.is-phone \.sidebar\.mobile-open \{\s*transform: translateX\(0\);\s*\}/, 'the open drawer');
  assert.match(body, /html\.is-phone \.main-content \{\s*margin-left: 0;\s*\}/, 'the content does not leave room for a bar that is not there');
  assert.doesNotMatch(body, /\.hidden|\.expanded/, 'the desktop collapse is not part of the phone rules');
  const at = css.indexOf('@media (min-width: 769px) {\n  html.is-phone .sidebar {');
  for (const base of ['.sidebar.hidden {', '.main-content.expanded {', '.sidebar {']) {
    assert.ok(css.indexOf('\n' + base) >= 0 && css.indexOf('\n' + base) < at, `${base.trim()} (the base) comes before the phone block`);
  }
});
test('D1 CSS: a phone held sideways shows the hamburger (the portrait bottom nav is not there); portrait still hides it', () => {
  const m = /@media \(orientation: landscape\) \{\s*html\.is-phone \.header-left > \.menu-toggle \{\s*display: inline-flex;\s*\}\s*\}/.exec(css);
  assert.ok(m, 'the landscape hamburger rule');
  assert.ok(/@media \(max-width: 768px\) and \(orientation: landscape\) \{\s*html\.is-phone \.header-left > \.menu-toggle \{\s*margin-block: calc\(\(var\(--ctl-md\) - var\(--ctl-lg\)\) \/ 2\);\s*\}\s*\}/.test(css), 'at <= 768px the shown button keeps its 44px hit box in a 36px layout slot, so the 56px mobile header does not grow (probe: 61px without it)');
  const hide = css.indexOf('  .header-left > .menu-toggle {');
  assert.ok(hide > 0 && /display:\s*none/.test(css.slice(hide, hide + 120)), 'the 768px block still hides it for the portrait shell');
});
test('D2 sources: the click handler decides by sidebarPhoneLayout; theatre\'s collapse writes only the desktop pair', () => {
  const common = stripJs(fs.readFileSync(path.join(REPO, 'public/js/common.js'), 'utf8'));
  assert.match(common, /toggleSidebarMenu\(sidebar, mainContent, sidebarPhoneLayout\(window\)\);/, 'the real handler passes the layout test');
  assert.match(common, /wireSidebarDrawerCloses\(document, window, sidebar, menuToggle\);/, 'the close paths are wired in the real shell');
  const watch = stripJs(fs.readFileSync(path.join(REPO, 'public/js/watch.js'), 'utf8'));
  const body = /function setGuideCollapsed\([\s\S]*?\n\}/.exec(watch)[0];
  assert.doesNotMatch(body, /mobile-open/, 'theatre (desktop, 1025px+) never writes the phone drawer');
});
