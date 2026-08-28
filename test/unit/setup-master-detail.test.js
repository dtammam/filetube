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
      'appearance', 'critters', 'video-folders', 'book-folders', 'music-folders', 'tv-folders', 'podcasts-place',
      'automation-storage', 'trash', 'feedhidden', 'account', 'troubleshooting', 'experimental', 'transcript-ai',
    ], 'the 14 non-hidden sections in order (v1.195: + Shows folders in Library; v1.201: + Transcript sharing, last in Advanced); hidden admin excluded');
    const groups = Array.from(doc.querySelectorAll('.md-nav .md-group-title')).map((t) => t.textContent);
    assert.deepStrictEqual(groups, ['Library', 'System', 'Account', 'Advanced'], 'the new Advanced group sits LAST');
  } finally { unload(dom); }
});

test('Settings tiles: era Appearance, per-group tone, and the Video label override', () => {
  const { dom, doc, signal } = load();
  try {
    wireMasterDetail('setup', doc, signal);
    const tile = (k) => doc.querySelector('.md-row[data-md-target="' + k + '"] .md-tile');
    const label = (k) => doc.querySelector('.md-row[data-md-target="' + k + '"] .md-row-label').textContent;
    assert.strictEqual(tile('appearance').getAttribute('data-md-era'), '2021', 'Appearance is the era tile');
    assert.strictEqual(tile('video-folders').getAttribute('data-md-tone'), 'red', 'Library = red');
    assert.strictEqual(tile('automation-storage').getAttribute('data-md-tone'), 'graphite', 'System = graphite');
    assert.strictEqual(tile('account').getAttribute('data-md-tone'), 'steel', 'Account = steel');
    assert.strictEqual(label('video-folders'), 'Video folders', 'summary "FileTube Setup & Configuration" overridden via data-md-label');
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
    // Downloads joins System (graphite); Users/Backup join Account (steel)
    assert.strictEqual(doc.querySelector('.md-row[data-md-target="downloads"] .md-tile').getAttribute('data-md-tone'), 'graphite');
    assert.strictEqual(users.querySelector('.md-tile').getAttribute('data-md-tone'), 'steel');
  } finally { unload(dom); }
});
