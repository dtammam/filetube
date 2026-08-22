'use strict';

// [UNIT] v1.152: the master-detail menu component (wireMasterDetail). Binds the
// behaviour, not presence: grouping + per-group tone, single-section selection,
// the phone open/close flag, and the two CORRECTNESS-critical properties -
//   (a) a `hidden` (admin-gated) section NEVER renders a menu row, and appears
//       only when it is revealed asynchronously (the v1.80 leak class), and
//   (b) the era-reactive Appearance tile tracks <html data-theme>.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { wireMasterDetail } = require('../../public/js/common.js');

function setup(html) {
  const dom = new JSDOM('<!DOCTYPE html><html data-theme="2021"><body>' + html + '</body></html>', { url: 'http://localhost/setup.html' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver;
  global.localStorage = dom.window.localStorage;
  const controller = new dom.window.AbortController(); // jsdom's own, so { signal } passes jsdom's addEventListener
  return { dom, doc: dom.window.document, signal: controller.signal, controller };
}
function teardown(dom) {
  delete global.window; delete global.document; delete global.MutationObserver; delete global.localStorage;
  dom.window.close();
}
const tick = () => new Promise((r) => setTimeout(r, 0)); // let MutationObserver callbacks flush

// A representative Settings-shaped fixture: an era Appearance section (ungrouped),
// a Library group (2 sections), an Account group with a hidden admin section.
const FIXTURE = `
<div class="md-root" data-md-page="setup" data-md-title="Library settings">
  <details class="setup-box" data-collapse-key="appearance" data-md-icon="era"><summary>Appearance</summary><p>a</p></details>
  <details class="setup-box" data-collapse-key="video" data-md-icon="video" data-md-group="Library"><summary>Video folders</summary><p>v</p></details>
  <details class="setup-box" data-collapse-key="music" data-md-icon="music" data-md-group="Library"><summary>Music folders</summary><p>m</p></details>
  <details class="setup-box" data-collapse-key="account" data-md-icon="account" data-md-group="Account"><summary>Account</summary><p>ac</p></details>
  <details class="setup-box" id="users-box" hidden data-collapse-key="users" data-md-icon="users" data-md-group="Account" data-md-badge="Admin"><summary>Users</summary><p>u</p></details>
</div>`;

test('builds a grouped menu from the visible sections, era tile ungrouped', () => {
  const { dom, doc, signal } = setup(FIXTURE);
  try {
    wireMasterDetail('setup', doc, signal);
    const rows = doc.querySelectorAll('.md-nav .md-row');
    const keys = Array.from(rows).map((r) => r.getAttribute('data-md-target'));
    assert.deepStrictEqual(keys, ['appearance', 'video', 'music', 'account'], 'hidden users row excluded; the rest in order');
    const titles = Array.from(doc.querySelectorAll('.md-nav .md-group-title')).map((t) => t.textContent);
    assert.deepStrictEqual(titles, ['Library', 'Account'], 'group headers rendered; the era section is ungrouped (no header)');
  } finally { teardown(dom); }
});

test('assigns per-group tone by cycle (era special), colour encodes the group', () => {
  const { dom, doc, signal } = setup(FIXTURE);
  try {
    wireMasterDetail('setup', doc, signal);
    const tileFor = (key) => doc.querySelector('.md-row[data-md-target="' + key + '"] .md-tile');
    assert.strictEqual(tileFor('appearance').getAttribute('data-md-era'), '2021', 'Appearance is the era tile, not a tone');
    assert.strictEqual(tileFor('appearance').hasAttribute('data-md-tone'), false);
    assert.strictEqual(tileFor('video').getAttribute('data-md-tone'), 'red', 'first non-era group = red');
    assert.strictEqual(tileFor('music').getAttribute('data-md-tone'), 'red', 'same group shares the tone');
    assert.strictEqual(tileFor('account').getAttribute('data-md-tone'), 'graphite', 'second non-era group = graphite');
  } finally { teardown(dom); }
});

test('selects one section at a time; a row click opens the detail and persists', () => {
  const { dom, doc, signal } = setup(FIXTURE);
  try {
    wireMasterDetail('setup', doc, signal);
    const mdRoot = doc.querySelector('.md-root');
    // default: first visible section active, menu (not detail) shown
    assert.strictEqual(mdRoot.getAttribute('data-md-open'), 'false');
    assert.strictEqual(doc.querySelector('details[data-collapse-key="appearance"]').classList.contains('md-active'), true);
    // click Video
    doc.querySelector('.md-row[data-md-target="video"]').click();
    assert.strictEqual(doc.querySelector('details[data-collapse-key="video"]').classList.contains('md-active'), true);
    assert.strictEqual(doc.querySelector('details[data-collapse-key="appearance"]').classList.contains('md-active'), false, 'only one active');
    assert.strictEqual(mdRoot.getAttribute('data-md-open'), 'true', 'detail opened');
    assert.strictEqual(global.localStorage.getItem('ft-md:setup'), 'video', 'selection persisted');
    // back returns to the menu
    doc.querySelector('.md-back').click();
    assert.strictEqual(mdRoot.getAttribute('data-md-open'), 'false');
  } finally { teardown(dom); }
});

test('a restricted user never sees an admin row; revealing it asynchronously adds it (v1.80 class)', async () => {
  const { dom, doc, signal } = setup(FIXTURE);
  try {
    wireMasterDetail('setup', doc, signal);
    // before reveal: no Users row, and its title does not leak into the nav
    assert.strictEqual(doc.querySelector('.md-row[data-md-target="users"]'), null, 'no admin row for a non-admin');
    assert.ok(!/Users/.test(doc.querySelector('.md-nav').textContent), 'admin section title does not leak into the menu');
    // reveal it the way setup.js does for an admin, AFTER wiring
    doc.getElementById('users-box').hidden = false;
    await tick();
    const usersRow = doc.querySelector('.md-row[data-md-target="users"]');
    assert.ok(usersRow, 'the admin row appears once revealed');
    assert.strictEqual(usersRow.querySelector('.md-row-badge').textContent, 'Admin', 'the Admin badge renders');
    assert.strictEqual(usersRow.querySelector('.md-tile').getAttribute('data-md-tone'), 'graphite', 'joins the Account group tone');
  } finally { teardown(dom); }
});

test('data-md-groups declares the group order (and thus tone), independent of document order', () => {
  // sections deliberately OUT of group order in the DOM; the declared order wins.
  const { dom, doc, signal } = setup(`
    <div class="md-root" data-md-page="ord" data-md-groups="Overview,Breakdowns,System">
      <details data-collapse-key="fun" data-md-icon="chart" data-md-group="Overview"><summary>Fun</summary></details>
      <details data-collapse-key="keys" data-md-icon="keyboard" data-md-group="System"><summary>Keys</summary></details>
      <details data-collapse-key="type" data-md-icon="layers" data-md-group="Breakdowns"><summary>Type</summary></details>
    </div>`);
  try {
    wireMasterDetail('ord', doc, signal);
    const titles = Array.from(doc.querySelectorAll('.md-group-title')).map((t) => t.textContent);
    assert.deepStrictEqual(titles, ['Overview', 'Breakdowns', 'System'], 'declared order, not the DOM order (Overview, System, Breakdowns)');
    assert.strictEqual(doc.querySelector('.md-row[data-md-target="fun"] .md-tile').getAttribute('data-md-tone'), 'red');
    assert.strictEqual(doc.querySelector('.md-row[data-md-target="type"] .md-tile').getAttribute('data-md-tone'), 'graphite');
    assert.strictEqual(doc.querySelector('.md-row[data-md-target="keys"] .md-tile').getAttribute('data-md-tone'), 'steel');
  } finally { teardown(dom); }
});

test('renders a REUSABLE header box from data-md-title/desc/hero-icon (above the track)', () => {
  const { dom, doc, signal } = setup(`
    <div class="md-root" data-md-page="hx" data-md-title="Settings" data-md-desc="Manage your setup." data-md-hero-icon="sliders">
      <details data-collapse-key="a" data-md-icon="account" data-md-group="G"><summary>A</summary></details>
    </div>`);
  try {
    wireMasterDetail('hx', doc, signal);
    const hero = doc.querySelector('.md-hero');
    assert.ok(hero, 'a header box is rendered from the .md-root attrs (no per-page code)');
    assert.strictEqual(hero.querySelector('h2').textContent, 'Settings');
    assert.match(hero.querySelector('p').textContent, /Manage your setup/);
    const tile = hero.querySelector('.md-tile--hero');
    assert.ok(tile, 'a large hero tile');
    assert.strictEqual(tile.getAttribute('data-md-tone'), 'graphite', 'neutral graphite tile');
    assert.ok(hero.nextElementSibling && hero.nextElementSibling.classList.contains('md-track'),
      'the hero sits before the track (full-width page header on desktop)');
  } finally { teardown(dom); }
});

test('the header box ESCAPES title/desc (reusable surface: no HTML injection)', () => {
  const { dom, doc, signal } = setup(`
    <div class="md-root" data-md-page="hz" data-md-title="<b>t</b>" data-md-desc="<i>d</i>">
      <details data-collapse-key="a" data-md-icon="account" data-md-group="G"><summary>A</summary></details>
    </div>`);
  try {
    wireMasterDetail('hz', doc, signal);
    const hero = doc.querySelector('.md-hero');
    assert.strictEqual(hero.querySelector('h2 b'), null, 'title not parsed as HTML');
    assert.strictEqual(hero.querySelector('p i'), null, 'desc not parsed as HTML');
    assert.strictEqual(hero.querySelector('h2').textContent, '<b>t</b>', 'title is literal text');
    assert.strictEqual(hero.querySelector('p').textContent, '<i>d</i>', 'desc is literal text');
  } finally { teardown(dom); }
});

test('v1.154: the phone detail header is an iOS nav-bar (pinned back + centered title); desktop is a left heading', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  // phone base: back chevron absolute-pinned to the left edge; title centered
  assert.match(css, /\.md-back \{[^}]*position: absolute;[^}]*left: 0;/, 'the back button is pinned to the left edge');
  assert.match(css, /\.md-detail-title \{[^}]*text-align: center;/, 'the title is centered on phone');
  // desktop (min-width:769): reverts to a left-aligned pane heading
  assert.match(css, /@media \(min-width: 769px\)[\s\S]*?\.md-detail-title \{ text-align: left;/,
    'desktop title is left-aligned, not a centered nav-bar');
});

test('v1.154: the back button carries an accessible name (its visible label is CSS-hidden on phone)', () => {
  const { dom, doc, signal } = setup(FIXTURE);
  try {
    wireMasterDetail('setup', doc, signal);
    const back = doc.querySelector('.md-back');
    assert.ok(back.getAttribute('aria-label'), 'the back button has an aria-label for assistive tech');
    assert.match(back.getAttribute('aria-label'), /Back/);
  } finally { teardown(dom); }
});

test('no header box when a .md-root declares no title/desc (opt-in)', () => {
  const { dom, doc, signal } = setup(`
    <div class="md-root" data-md-page="hy">
      <details data-collapse-key="a" data-md-icon="account" data-md-group="G"><summary>A</summary></details>
    </div>`);
  try {
    wireMasterDetail('hy', doc, signal);
    assert.strictEqual(doc.querySelector('.md-hero'), null, 'no hero without a title/desc');
  } finally { teardown(dom); }
});

test('the era tile repaints when the era skin (html data-theme) changes', async () => {
  const { dom, doc, signal } = setup(FIXTURE);
  try {
    wireMasterDetail('setup', doc, signal);
    const eraTile = () => doc.querySelector('[data-md-era-tile]');
    assert.strictEqual(eraTile().getAttribute('data-md-era'), '2021');
    doc.documentElement.setAttribute('data-theme', '2014');
    await tick();
    assert.strictEqual(eraTile().getAttribute('data-md-era'), '2014', 'the Appearance badge tracks the active era');
  } finally { teardown(dom); }
});

test('after signal abort, a later reveal does NOT rebuild the nav (observers disconnected)', async () => {
  const { dom, doc, signal, controller } = setup(FIXTURE);
  try {
    wireMasterDetail('setup', doc, signal);
    controller.abort();
    doc.getElementById('users-box').hidden = false;
    await tick();
    assert.strictEqual(doc.querySelector('.md-row[data-md-target="users"]'), null, 'destroy() unwired the hidden-observer');
  } finally { teardown(dom); }
});

// ---- v1.164 (Dean): SCROLL OWNERSHIP on the push-in --------------------------
// On phone the WINDOW is the scroller (the panes container does not overflow),
// so `panes.scrollTop = 0` alone was a no-op there: scrolling a long nav list
// and tapping a bottom section (Stats' "Under the hood") kept the window offset
// and landed the pane title + back arrow off-screen under the app header.
// Contract: OPENING a section snaps the window to the top; BACK restores the
// saved list offset (return to your place, iOS-Settings style). Neutering the
// window.scrollTo(0,0), the navScrollY save, or the Back restore reds this.
test('SCROLL OWNERSHIP: opening a section snaps the window to top; Back restores the saved list offset', () => {
  const { dom, doc, signal } = setup(FIXTURE);
  try {
    const calls = [];
    dom.window.scrollTo = (x, y) => { calls.push([x, y]); };
    Object.defineProperty(dom.window, 'scrollY', { value: 420, configurable: true });
    wireMasterDetail('setup', doc, signal);

    // Open a section from a scrolled-down list (window at 420).
    doc.querySelector('.md-row[data-md-target="video"]').click();
    assert.deepStrictEqual(calls[calls.length - 1], [0, 0],
      'opening a section scrolls the WINDOW to the top (the pane heading/back arrow must be visible)');

    // Back restores the exact list offset the user tapped from.
    doc.querySelector('.md-back').click();
    assert.deepStrictEqual(calls[calls.length - 1], [0, 420],
      'Back restores the saved list offset, not the top');
    assert.strictEqual(doc.querySelector('.md-root').getAttribute('data-md-open'), 'false');

    // A second open from a DIFFERENT offset re-saves (not a one-shot latch).
    Object.defineProperty(dom.window, 'scrollY', { value: 77, configurable: true });
    doc.querySelector('.md-row[data-md-target="music"]').click();
    assert.deepStrictEqual(calls[calls.length - 1], [0, 0], 'second open snaps to top again');
    doc.querySelector('.md-back').click();
    assert.deepStrictEqual(calls[calls.length - 1], [0, 77],
      'Back restores the FRESH offset - the save re-arms on every open');
  } finally { teardown(dom); }
});
