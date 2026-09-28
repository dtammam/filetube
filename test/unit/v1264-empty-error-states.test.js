'use strict';

// [UNIT] v1.26.4 Items 2/3 (unified empty/error states): `buildEmptyStateHtml`
// / `buildErrorStateHtml` (public/js/common.js) -- pure string builders
// shared by the home/library grid (public/js/main.js); the subscriptions list
// has its own DOM twin. Sweep S9 (F65, D9, AC12 conversion): both builders now emit
// the ONE ui-state block (ui.css) - byte-for-byte the DOM ui.state() builds - and
// the bespoke `.empty-state` / `.error-state` family is gone. Parsed in jsdom so the
// assertions read the structure, not a regex over a string.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { buildEmptyStateHtml, buildErrorStateHtml, uiStateHtml } = require('../../public/js/common.js');
const ui = require('../../public/js/ui.js');

const ROOT = path.join(__dirname, '..', '..');
const MAIN_JS_PATH = path.join(ROOT, 'public', 'js', 'main.js');
const SUBS_CLIENT_JS_PATH = path.join(ROOT, 'lib', 'ytdlp', 'client', 'subscriptions.js');
const mainJs = fs.readFileSync(MAIN_JS_PATH, 'utf8');
const subsClientJs = fs.readFileSync(SUBS_CLIENT_JS_PATH, 'utf8');
const { readStyleCss, readUiCss } = require('../helpers/stylesheets');

const parse = (html) => {
  const d = new JSDOM('<!DOCTYPE html><body></body>').window.document;
  d.body.innerHTML = html;
  assert.strictEqual(d.body.children.length, 1, 'one block');
  return d.body.firstElementChild;
};

test('buildEmptyStateHtml: default renders the ui-state block - search icon disc, a title "Nothing here yet.", no body', () => {
  const s = parse(buildEmptyStateHtml());
  assert.strictEqual(s.className, 'ui-state');
  assert.strictEqual(s.querySelector('.ui-state__icon use').getAttribute('href'), '#i-search');
  assert.ok(s.querySelector('.ui-state__icon svg').classList.contains('ui-icon--lg'));
  assert.strictEqual(s.querySelector('h3.ui-state__title').textContent, 'Nothing here yet.');
  assert.strictEqual(s.querySelector('.ui-state__body'), null);
});

test('buildEmptyStateHtml: icon / message / hint / actionHtml are threaded through (a legacy icon-* name still resolves to its glyph)', () => {
  const s = parse(buildEmptyStateHtml({
    icon: 'icon-folder',
    message: 'No video or audio files found.',
    hint: 'Try a different search.',
    actionHtml: '<a href="/" class="ui-btn ui-btn--secondary ui-btn--md empty-state-action"><span class="ui-btn__label">View All Media</span></a>',
  }));
  assert.strictEqual(s.querySelector('.ui-state__icon use').getAttribute('href'), '#i-folder');
  assert.strictEqual(s.querySelector('.ui-state__title').textContent, 'No video or audio files found.');
  assert.strictEqual(s.querySelector('.ui-state__body').textContent, 'Try a different search.');
  const a = s.querySelector('a.ui-btn.empty-state-action');
  assert.ok(a && a.getAttribute('href') === '/' && a.textContent === 'View All Media');
  assert.strictEqual(s.lastElementChild, a, 'the action comes last');
  assert.strictEqual(parse(buildEmptyStateHtml({ icon: 'smart_display' })).querySelector('use').getAttribute('href'), '#i-smart_display');
});

test('the string builder is byte-for-byte the DOM ui.state() builds (one component, two builders)', () => {
  const d = new JSDOM('<!DOCTYPE html><body></body>').window.document;
  const dom = ui.state({ icon: 'folder', title: 'This folder is empty.', body: 'Nothing here yet.', doc: d });
  const str = parse(uiStateHtml({ icon: 'folder', title: 'This folder is empty.', body: 'Nothing here yet.' }));
  const norm = (el) => el.outerHTML.replace(/ focusable="false"/g, '');
  assert.strictEqual(norm(str), norm(dom));
});

test('buildEmptyStateHtml: omitting hint / actionHtml renders neither', () => {
  const s = parse(buildEmptyStateHtml({ message: 'x' }));
  assert.strictEqual(s.querySelector('.ui-state__body'), null);
  assert.strictEqual(s.querySelector('a, button'), null);
});

test('buildErrorStateHtml: an error ui-state - the error glyph and the words carry it (not red text) - with a secondary ui-btn Retry on a stable hook', () => {
  const s = parse(buildErrorStateHtml());
  assert.strictEqual(s.className, 'ui-state ui-state--error');
  assert.strictEqual(s.querySelector('.ui-state__icon use').getAttribute('href'), '#i-error');
  assert.strictEqual(s.querySelector('.ui-state__title').textContent, 'Something went wrong.');
  const retry = s.querySelector('[data-error-retry]');
  assert.strictEqual(retry.tagName, 'BUTTON');
  assert.strictEqual(retry.getAttribute('type'), 'button');
  assert.strictEqual(retry.className, 'ui-btn ui-btn--secondary ui-btn--md');
  assert.strictEqual(retry.textContent, 'Retry');
  assert.strictEqual(retry.id, '', 'no id - several error states may coexist');
});

test('buildErrorStateHtml: a custom message is threaded through', () => {
  assert.strictEqual(parse(buildErrorStateHtml({ message: 'Failed to load subscriptions.' })).querySelector('.ui-state__title').textContent, 'Failed to load subscriptions.');
});

// ---- CSS: ONE state block (sweep S9, was "shared classes exist") ------------

test('the ui-state block is ui.css\'s; style.css keeps no bespoke empty / error family and only places the block', () => {
  const uiCss = readUiCss().replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(uiCss, /\.ui-state\s*\{/);
  assert.match(uiCss, /\.ui-state__title\s*\{/);
  const css = readStyleCss().replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /\.empty-state(?![\w-]*-action)|\.error-state|\.home-feed-empty/, 'no bespoke empty/error family (F65)');
  assert.match(css, /\.video-grid > \.ui-state,\s*#home-feed-host > \.ui-state\s*\{\s*grid-column:\s*1 \/ -1;/, 'in a grid the block spans every column');
});

// ---- Regression guard: the old bare inline-styled markup is gone ----------

test('main.js no longer inline-styles the empty/error states -- uses the shared builders instead', () => {
  assert.doesNotMatch(mainJs, /No video or audio files found\.\s*\n\s*\$\{searchQuery/, 'old inline empty-state template literal should be gone');
  assert.doesNotMatch(mainJs, /Error loading library data from server\.<\/div>`/, 'old inline error-state template literal should be gone');
  assert.match(mainJs, /buildEmptyStateHtml\(/);
  assert.match(mainJs, /buildErrorStateHtml\(/);
  assert.match(mainJs, /data-error-retry/, 'main.js must wire up the Retry button');
});

// v1.81 Task 4: every empty video view gets a helpful, context-aware intro
// (search miss / empty folder / empty library) - no blank surface, matching the
// treatment books/podcasts already have.
test('v1.81: the video grid empty-state is context-aware (search / folder / library each get a hint)', () => {
  assert.match(mainJs, /No results found\./, 'search-miss message');
  assert.match(mainJs, /This folder is empty\./, 'empty-folder message');
  assert.match(mainJs, /No videos or audio yet\./, 'empty-library message');
  // Each branch carries a hint (the "helpful intro treatment").
  assert.match(mainJs, /hint: 'Files in your media folders show up here/, 'empty-library hint present');
});

test('subscriptions.js client no longer inline-styles its load-error text -- uses its own createElement-only error-state builder instead', () => {
  assert.doesNotMatch(subsClientJs, /Failed to load subscriptions\.';/, 'old plain-textContent error string assignment should be gone');
  // NOT common.js's string-based buildErrorStateHtml -- this file carries a
  // hard, file-wide "never .innerHTML" bar (see its own SECURITY comment),
  // so it has its own DOM-node twin, buildErrorStateNode (see
  // test/unit/v1264-skeleton-states.test.js's sibling coverage of
  // buildSkeletonRows for the same reasoning).
  assert.match(subsClientJs, /buildErrorStateNode\(/);
  // Mirrors test/integration/ytdlp-ui-routes.test.js's AC32 regression guard
  // exactly (comments stripped first, since several of THIS file's own
  // comments legitimately mention the literal ".innerHTML =" text while
  // explaining why it's forbidden).
  const stripComments = (src) => src.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(stripComments(subsClientJs), /\.innerHTML\s*=/, 'lib/ytdlp/client/subscriptions.js must never assign .innerHTML anywhere (file-wide bar, AC32)');
});
