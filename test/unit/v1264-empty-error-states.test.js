'use strict';

// [UNIT] v1.26.4 Items 2/3 (unified empty/error states): `buildEmptyStateHtml`
// / `buildErrorStateHtml` (public/js/common.js) -- pure string builders
// shared by the home/library grid (public/js/main.js) and the subscriptions
// list (lib/ytdlp/client/subscriptions.js). Also locks that `.empty-state`/
// `.error-state` exist as REAL shared CSS classes (not per-surface inline
// styles) and that the old bare inline-styled markup is gone from both
// consuming call sites.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { buildEmptyStateHtml, buildErrorStateHtml } = require('../../public/js/common.js');

const ROOT = path.join(__dirname, '..', '..');
const CSS_PATH = path.join(ROOT, 'public', 'css', 'style.css');
const MAIN_JS_PATH = path.join(ROOT, 'public', 'js', 'main.js');
const SUBS_CLIENT_JS_PATH = path.join(ROOT, 'lib', 'ytdlp', 'client', 'subscriptions.js');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const mainJs = fs.readFileSync(MAIN_JS_PATH, 'utf8');
const subsClientJs = fs.readFileSync(SUBS_CLIENT_JS_PATH, 'utf8');

test('buildEmptyStateHtml: default (no options) renders the .empty-state card with a fallback icon/message', () => {
  const html = buildEmptyStateHtml();
  assert.match(html, /class="empty-state"/);
  assert.match(html, /class="icon-search empty-state-icon"/);
  assert.match(html, /class="empty-state-message">Nothing here yet\.</);
});

test('buildEmptyStateHtml: custom icon/message/hint/actionHtml are threaded through', () => {
  const html = buildEmptyStateHtml({
    icon: 'icon-folder',
    message: 'No video or audio files found.',
    hint: 'Try a different search.',
    actionHtml: '<a href="/" class="btn empty-state-action">View All Media</a>',
  });
  assert.match(html, /class="icon-folder empty-state-icon"/);
  assert.match(html, /No video or audio files found\./);
  assert.match(html, /class="empty-state-hint">Try a different search\.<\/p>/);
  assert.match(html, /<a href="\/" class="btn empty-state-action">View All Media<\/a>/);
});

test('buildEmptyStateHtml: compact option adds the empty-state-inline modifier class (for non-grid surfaces)', () => {
  const html = buildEmptyStateHtml({ compact: true, message: 'No playlists pinned yet.' });
  assert.match(html, /class="empty-state empty-state-inline"/);
});

test('buildEmptyStateHtml: omitting hint/actionHtml renders neither wrapper', () => {
  const html = buildEmptyStateHtml({ message: 'x' });
  assert.doesNotMatch(html, /empty-state-hint/);
  assert.doesNotMatch(html, /<a /);
});

test('buildErrorStateHtml: default message + a wired-up-by-caller Retry button with a stable hook', () => {
  const html = buildErrorStateHtml();
  assert.match(html, /class="error-state"/);
  assert.match(html, /class="error-state-message">Something went wrong\.</);
  assert.match(html, /<button type="button" class="btn error-state-retry" data-error-retry>Retry<\/button>/);
});

test('buildErrorStateHtml: custom message is threaded through', () => {
  const html = buildErrorStateHtml({ message: 'Failed to load subscriptions.' });
  assert.match(html, /Failed to load subscriptions\./);
});

// ---- CSS lock: shared classes exist, not per-surface inline styles --------

test('style.css defines .empty-state/.error-state as real, shared classes', () => {
  assert.match(css, /\.empty-state,\s*\n\.error-state\s*\{/);
  assert.match(css, /\.error-state-retry\s*\{/);
  assert.match(css, /\.empty-state-inline\s*\{/);
});

// ---- Regression guard: the old bare inline-styled markup is gone ----------

test('main.js no longer inline-styles the empty/error states -- uses the shared builders instead', () => {
  assert.doesNotMatch(mainJs, /No video or audio files found\.\s*\n\s*\$\{searchQuery/, 'old inline empty-state template literal should be gone');
  assert.doesNotMatch(mainJs, /Error loading library data from server\.<\/div>`/, 'old inline error-state template literal should be gone');
  assert.match(mainJs, /buildEmptyStateHtml\(/);
  assert.match(mainJs, /buildErrorStateHtml\(/);
  assert.match(mainJs, /data-error-retry/, 'main.js must wire up the Retry button');
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
