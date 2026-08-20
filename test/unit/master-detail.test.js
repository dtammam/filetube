'use strict';

// [UNIT] v1.152: the master-detail menu component (wireMasterDetail). Binds the
// behaviour, not presence: grouping + per-group tone, single-section selection,
// the phone open/close flag, and the two CORRECTNESS-critical properties -
//   (a) a `hidden` (admin-gated) section NEVER renders a menu row, and appears
//       only when it is revealed asynchronously (the v1.80 leak class), and
//   (b) the era-reactive Appearance tile tracks <html data-theme>.

const { test } = require('node:test');
const assert = require('node:assert');
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
