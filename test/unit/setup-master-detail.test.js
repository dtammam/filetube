'use strict';

// [UNIT] v1.152: binds the REAL setup.html .md-root markup to wireMasterDetail
// (catches an attr typo / wrong group / missing label-override / missing admin
// badge that the generic component test can't see). Loads the actual shell
// fragment, not a fixture.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { wireMasterDetail } = require('../../public/js/common.js');

const SETUP_HTML = fs.readFileSync(path.join(__dirname, '../../public/setup.html'), 'utf8');
const MD_ROOT = SETUP_HTML.match(/<div class="md-root" data-md-page="setup"[\s\S]*?<\/div><!-- \/\.md-root -->/);

function load() {
  assert.ok(MD_ROOT, 'setup.html carries the .md-root wrapper (open..close)');
  const dom = new JSDOM('<!DOCTYPE html><html data-theme="2021"><body>' + MD_ROOT[0] + '</body></html>', { url: 'http://localhost/setup.html' });
  global.window = dom.window; global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver; global.localStorage = dom.window.localStorage;
  const controller = new dom.window.AbortController();
  return { dom, doc: dom.window.document, signal: controller.signal };
}
function unload(dom) {
  delete global.window; delete global.document; delete global.MutationObserver; delete global.localStorage;
  dom.window.close();
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('Settings header box: renamed to "Settings" + a description, em-dash-free', () => {
  const { dom, doc, signal } = load();
  try {
    wireMasterDetail('setup', doc, signal);
    const hero = doc.querySelector('.md-hero');
    assert.ok(hero, 'the Settings page has a header box');
    assert.strictEqual(hero.querySelector('h2').textContent, 'Settings', 'renamed from "Library settings"');
    assert.match(hero.querySelector('p').textContent, /appearance, folders, downloads/);
    assert.ok(!/—/.test(hero.querySelector('p').textContent), 'no em dashes in the copy (Dean norm)');
    // and the back-button label follows the renamed title
    assert.strictEqual(doc.querySelector('.md-back .md-back-label').textContent, 'Settings');
  } finally { unload(dom); }
});

test('Settings builds the expected visible menu (admin sections hidden for a non-admin)', () => {
  const { dom, doc, signal } = load();
  try {
    wireMasterDetail('setup', doc, signal);
    const keys = Array.from(doc.querySelectorAll('.md-nav .md-row')).map((r) => r.getAttribute('data-md-target'));
    assert.deepStrictEqual(keys, [
      'trash',
      'appearance', 'home-page', 'playback', 'mobile-player', 'critters',
      'account',
      'videos', 'music', 'books', 'shows', 'podcasts', 'hidden',
      'troubleshooting', 'experimental', 'transcript-sharing',
    ], 'v1.367.0: the 16 pages a member sees before any reveal (Scan & cache, Downloads, Notifications, Users, Backup are hidden), in group order');
    const groups = Array.from(doc.querySelectorAll('.md-nav .md-group-title')).map((t) => t.textContent);
    assert.deepStrictEqual(groups, ['System', 'Personalize', 'Account', 'Library', 'Advanced'], 'SYSTEM, PERSONALIZE, ACCOUNT, LIBRARY, ADVANCED');
  } finally { unload(dom); }
});

test('Settings tiles: era Appearance, per-group tone, and the plain page names', () => {
  const { dom, doc, signal } = load();
  try {
    wireMasterDetail('setup', doc, signal);
    const tile = (k) => doc.querySelector('.md-row[data-md-target="' + k + '"] .md-tile');
    const label = (k) => doc.querySelector('.md-row[data-md-target="' + k + '"] .md-row-label').textContent;
    assert.strictEqual(tile('appearance').getAttribute('data-md-era'), '2021', 'Appearance is the era tile');
    assert.strictEqual(tile('trash').getAttribute('data-md-tone'), 'red', 'System = red');
    assert.strictEqual(tile('account').getAttribute('data-md-tone'), 'graphite', 'Account = graphite');
    assert.strictEqual(tile('videos').getAttribute('data-md-tone'), 'steel', 'Library = steel');
    assert.strictEqual(label('videos'), 'Videos', 'was "FileTube Setup & Configuration" (and its "Video folders" label override)');
    assert.strictEqual(label('music'), 'Music');
    assert.strictEqual(label('books'), 'Books');
    assert.strictEqual(label('shows'), 'Shows');
  } finally { unload(dom); }
});

test('Settings: revealing an admin box (as setup.js does for an admin) adds its row + Admin badge', async () => {
  const { dom, doc, signal } = load();
  try {
    wireMasterDetail('setup', doc, signal);
    assert.strictEqual(doc.querySelector('.md-row[data-md-target="users"]'), null, 'no Users row for a non-admin');
    doc.getElementById('users-box').hidden = false; // the setup.js admin path
    doc.getElementById('backup-box').hidden = false;
    doc.getElementById('downloads-box').hidden = false;
    await tick();
    const users = doc.querySelector('.md-row[data-md-target="users"]');
    assert.ok(users, 'Users row appears once revealed');
    assert.strictEqual(users.querySelector('.md-row-badge').textContent, 'Admin');
    assert.ok(doc.querySelector('.md-row[data-md-target="backup-restore"]'), 'Backup row appears');
    assert.ok(doc.querySelector('.md-row[data-md-target="downloads"]'), 'Downloads row appears');
    // Downloads joins System (red); Users/Backup join Account (graphite)
    assert.strictEqual(doc.querySelector('.md-row[data-md-target="downloads"] .md-tile').getAttribute('data-md-tone'), 'red');
    assert.strictEqual(users.querySelector('.md-tile').getAttribute('data-md-tone'), 'graphite');
  } finally { unload(dom); }
});

// v1.367.0: the old ids. Every key the page used before the reorganization still reaches its page (a bookmark, a
// #hash, the remembered ft-md:setup selection), and every new key reaches itself. Both ways, against the real markup.
const OLD_TO_NEW = {
  'automation-storage': 'scan-cache', 'video-folders': 'videos', 'music-folders': 'music', 'book-folders': 'books',
  'tv-folders': 'shows', 'podcasts-place': 'podcasts', 'feedhidden': 'hidden', 'transcript-ai': 'transcript-sharing',
};
const OLD_SAME = ['appearance', 'mobile-player', 'critters', 'downloads', 'trash', 'account', 'users', 'backup-restore', 'troubleshooting', 'experimental'];
const NEW_KEYS = ['scan-cache', 'downloads', 'notifications', 'trash', 'appearance', 'home-page', 'playback', 'mobile-player', 'critters',
  'account', 'users', 'backup-restore', 'videos', 'music', 'books', 'shows', 'podcasts', 'hidden', 'troubleshooting', 'experimental', 'transcript-sharing'];

test('v1.367.0: the markup holds exactly the 21 new pages, in group order', () => {
  const { dom, doc } = load();
  try {
    const keys = Array.from(doc.querySelectorAll('.md-root > details[data-collapse-key]')).map((d) => d.getAttribute('data-collapse-key'));
    assert.deepStrictEqual(keys, NEW_KEYS);
    assert.strictEqual(doc.querySelector('.md-root').getAttribute('data-md-groups'), 'System,Personalize,Account,Library,Advanced');
  } finally { unload(dom); }
});

test('v1.367.0: every OLD id resolves to a live page; every NEW id resolves to itself (hash, both ways)', async () => {
  const live = new Set(NEW_KEYS);
  const olds = Object.entries(OLD_TO_NEW).concat(OLD_SAME.map((k) => [k, k]));
  for (const [oldKey, newKey] of olds) {
    assert.ok(live.has(newKey), `${oldKey} maps to ${newKey}, which is not a page`);
    const { dom, doc, signal } = load();
    try {
      // reveal every admin-gated page so the hash can land on it (what setup.js does for an admin)
      doc.querySelectorAll('.md-root > details[hidden]').forEach((d) => { d.hidden = false; });
      dom.window.location.hash = '#' + oldKey;
      wireMasterDetail('setup', doc, signal);
      assert.strictEqual(doc.querySelector('.md-row--active').getAttribute('data-md-target'), newKey, `#${oldKey} lands on ${newKey}`);
      assert.strictEqual(doc.querySelector('.md-root').dataset.mdOpen, 'true', `#${oldKey} opens the page`);
    } finally { unload(dom); }
  }
  for (const key of NEW_KEYS) {
    const { dom, doc, signal } = load();
    try {
      doc.querySelectorAll('.md-root > details[hidden]').forEach((d) => { d.hidden = false; });
      dom.window.location.hash = '#' + key;
      wireMasterDetail('setup', doc, signal);
      assert.strictEqual(doc.querySelector('.md-row--active').getAttribute('data-md-target'), key, `#${key} lands on itself`);
    } finally { unload(dom); }
  }
});

test('v1.367.0: a remembered OLD selection carries over (and is rewritten), a remembered NEW one is kept, junk is ignored', () => {
  for (const [stored, expected] of [['video-folders', 'videos'], ['transcript-ai', 'transcript-sharing'], ['feedhidden', 'hidden'], ['music', 'music'], ['no-such-page', 'trash']]) {
    const { dom, doc, signal } = load();
    try {
      dom.window.localStorage.setItem('ft-md:setup', stored);
      wireMasterDetail('setup', doc, signal);
      assert.strictEqual(doc.querySelector('.md-row--active').getAttribute('data-md-target'), expected, `stored ${stored}`);
      if (stored !== expected && expected !== 'trash') assert.strictEqual(dom.window.localStorage.getItem('ft-md:setup'), expected, 'the stored value is rewritten to the new id');
    } finally { unload(dom); }
  }
});

test('v1.367.0: the mapping table covers every id the page had (the 18 old pages), and nothing else is aliased', () => {
  const { dom, doc } = load();
  try {
    const attr = doc.querySelector('.md-root').getAttribute('data-md-aliases');
    const table = Object.fromEntries(attr.split(',').map((p) => p.split(':')));
    assert.deepStrictEqual(table, OLD_TO_NEW);
    assert.strictEqual(Object.keys(OLD_TO_NEW).length + OLD_SAME.length, 18, 'the 18 pages of v1.366.1');
  } finally { unload(dom); }
});

// The member view (Dean, 2026-10-06): a server-wide row (saved through the admin-only POST /api/settings) is for
// admins; a member keeps every personal row. Binds the markup (data-admin-only) to setup.js's real reveal selector.
test('v1.367.0: server-wide rows are admin-only and hidden until setup.js reveals them; personal rows are never gated', () => {
  const { dom, doc } = load();
  try {
    const SERVER_WIDE = ['default-view-select', 'default-sort-select', 'autoplay-next-check', 'notifications-enabled-check',
      'scan-interval-select', 'prune-missing-check', 'chapter-snap-leadin-select', 'scan-now-btn', 'clear-cache-btn', 'cache-age-select', 'cache-cap-input'];
    const PERSONAL = ['per-page-sort-check', 'home-feed-check', 'modern-mode-check', 'home-continue-watching-check', 'tv-continue-watching-check',
      'home-continue-listening-check', 'home-continue-reading-check', 'resume-mode-select', 'resume-threshold-input', 'resume-countdown-check',
      'push-user-enabled-check', 'bottombar-editor'];
    const gated = (id) => { const el = doc.getElementById(id); return !!el.closest('[data-admin-only]'); };
    SERVER_WIDE.forEach((id) => assert.ok(gated(id), id + ' is server-wide: inside data-admin-only'));
    PERSONAL.forEach((id) => assert.ok(!gated(id), id + ' is per-user/device: never admin-gated'));
    // every admin-only element ships hidden; the reveal selector setup.js uses un-hides them all
    const all = Array.from(doc.querySelectorAll('[data-admin-only]'));
    assert.ok(all.length === 4, 'the four wrappers: Scan & cache, the bell, Default view & sort, Autoplay');
    all.forEach((el) => assert.ok(el.hidden, (el.id || el.className || el.tagName) + ' ships hidden'));
    const src = fs.readFileSync(path.join(__dirname, '../../public/js/setup.js'), 'utf8');
    assert.ok(src.includes("querySelectorAll('[data-admin-only][hidden], #notifications-box[hidden]')"), 'setup.js reveals them in the admin branch');
    doc.querySelectorAll('[data-admin-only][hidden], #notifications-box[hidden]').forEach((el) => { el.hidden = false; });
    all.forEach((el) => assert.ok(!el.hidden));
    // the plain line sits in every server-wide group of the mixed pages
    ['home-page', 'playback'].forEach((k) => {
      const page = doc.querySelector('[data-collapse-key="' + k + '"]');
      assert.match(page.querySelector('[data-admin-only]').textContent, /These apply to everyone on this FileTube\./, k);
    });
  } finally { unload(dom); }
});

test('v1.367.0: a member sees no Scan & cache; Notifications appears only with push on; an admin sees both', async () => {
  const { dom, doc, signal } = load();
  try {
    wireMasterDetail('setup', doc, signal);
    const has = (k) => !!doc.querySelector('.md-row[data-md-target="' + k + '"]');
    assert.ok(!has('scan-cache') && !has('notifications'), 'member, push off');
    doc.getElementById('notifications-box').hidden = false; // the push probe says push is on (initPushControls)
    await tick();
    assert.ok(has('notifications') && !has('scan-cache'), 'member, push on');
    doc.getElementById('scan-cache-box').hidden = false; // the admin branch
    await tick();
    assert.ok(has('scan-cache'), 'admin');
  } finally { unload(dom); }
});
