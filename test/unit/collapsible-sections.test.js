'use strict';

// [UNIT] v1.152: the management pages (Settings / Stats / Subscriptions) moved
// from per-section <details> collapse (the retired wireCollapsibleSections) to
// the master-detail menu (wireMasterDetail). This is the statement-anchored
// wiring LOCK: every page must still CARRY its data-collapse-key section cards
// (the menu's source of sections) AND wire the menu - markup without the wiring
// call = a page that never becomes a menu; the reverse = nothing to build from.
// (The component's behaviour lives in master-detail.test.js + the per-page
// *-master-detail.test.js binders.)

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const stripped = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('LOCK: every management page carries its section cards AND wires the master-detail menu', () => {
  const setupHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
  const statsHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'stats.html'), 'utf8');
  const subsHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'), 'utf8');

  // the section cards the menu is built from
  assert.ok((setupHtml.match(/data-collapse-key="/g) || []).length >= 8, 'all setup section cards present');
  assert.ok((statsHtml.match(/data-collapse-key="/g) || []).length >= 10, 'the stats section cards present');
  for (const key of ['subscriptions-list', 'add-subscription', 'one-off-download']) {
    assert.ok(subsHtml.includes(`data-collapse-key="${key}"`), `subscriptions.html lost the ${key} card`);
  }
  // each page carries the .md-root wrapper the component targets
  assert.match(setupHtml, /class="md-root" data-md-page="setup"/, 'setup.html lost its .md-root');
  assert.match(statsHtml, /class="md-root" data-md-page="stats"/, 'stats.html lost its .md-root');
  assert.match(subsHtml, /class="md-root" data-md-page="subscriptions"/, 'subscriptions.html lost its .md-root');

  // the wiring calls (comments stripped)
  assert.match(stripped('public/js/setup.js'), /wireMasterDetail\('setup', root \|\| document, controller\.signal\);/,
    'setup master-detail wiring deleted');
  assert.match(stripped('public/js/stats.js'), /wireMD\('stats', mdScope, signal\);/,
    'stats master-detail wiring deleted');
  const subs = stripped('lib/ytdlp/client/subscriptions.js');
  assert.match(subs, /wireMasterDetail\('subscriptions', root \|\| document, signal\);/,
    'subscriptions master-detail wiring deleted');
  assert.equal((subs.match(/wireMenu\(\);/g) || []).length >= 3, true,
    'a dynamic mount (history/failures) stopped re-adopting into the menu');
});

test('LOCK: the retired wireCollapsibleSections is fully gone (no dangling caller/export)', () => {
  const common = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');
  assert.ok(!/function wireCollapsibleSections/.test(common), 'the function is removed');
  assert.ok(!/\bwireCollapsibleSections\b\s*,/.test(common), 'and not exported');
});
