'use strict';

// v1.14.0 item 3 (hide from sidebar) + item 4 (default landing view) -- the
// pure client-side helpers visibleSidebarFolders and resolveDefaultView, both
// exposed from the browser common.js via the same `typeof module` guard as
// the other client-side pure helpers (mirrors test/unit/resolve-icon-set.test.js).
const { test } = require('node:test');
const assert = require('node:assert');
const { visibleSidebarFolders, resolveDefaultView } = require('../../public/js/common.js');

// ---- visibleSidebarFolders (item 3) ----------------------------------------

test('visibleSidebarFolders: omits a folder flagged hiddenFromSidebar', () => {
  const folders = ['/media/movies', '/media/music'];
  const settings = { '/media/music': { hiddenFromSidebar: true } };
  assert.deepEqual(visibleSidebarFolders(folders, settings), ['/media/movies']);
});

test('visibleSidebarFolders: a folder with only "hidden" (Hide from home) set still appears (distinct flags)', () => {
  const folders = ['/media/movies'];
  const settings = { '/media/movies': { hidden: true } };
  assert.deepEqual(visibleSidebarFolders(folders, settings), ['/media/movies'],
    'hidden ("Hide from home") must never affect the sidebar list');
});

test('visibleSidebarFolders: a folder with neither flag set is visible', () => {
  const folders = ['/media/movies'];
  assert.deepEqual(visibleSidebarFolders(folders, {}), ['/media/movies']);
});

test('visibleSidebarFolders: a folder with hidden=true AND hiddenFromSidebar=true is omitted (both flags set)', () => {
  const folders = ['/media/movies'];
  const settings = { '/media/movies': { hidden: true, hiddenFromSidebar: true } };
  assert.deepEqual(visibleSidebarFolders(folders, settings), []);
});

test('visibleSidebarFolders: an undefined/missing settings entry backfills to visible (not hidden)', () => {
  assert.deepEqual(visibleSidebarFolders(['/media/x'], undefined), ['/media/x']);
});

test('visibleSidebarFolders: empty folders list returns an empty list', () => {
  assert.deepEqual(visibleSidebarFolders([], {}), []);
});

// ---- resolveDefaultView (item 4) -------------------------------------------

test('resolveDefaultView: bare load + a valid, existing defaultView -> renders that folder', () => {
  const result = resolveDefaultView('', '', '', '/media/music', ['/media/movies', '/media/music']);
  assert.equal(result, '/media/music');
});

test('resolveDefaultView: bare load + defaultView pointing at a since-removed folder falls back to Most Recent', () => {
  const result = resolveDefaultView('', '', '', '/media/gone', ['/media/movies']);
  assert.equal(result, '', 'must fall back to Most Recent (empty), never throw or error');
});

test('resolveDefaultView: bare load + no defaultView set (empty sentinel) stays Most Recent', () => {
  assert.equal(resolveDefaultView('', '', '', '', ['/media/movies']), '');
});

test('resolveDefaultView: an explicit ?root= deep link always wins over defaultView', () => {
  const result = resolveDefaultView('/media/tv', '', '', '/media/music', ['/media/tv', '/media/music']);
  assert.equal(result, '/media/tv', 'deep link must not be overridden by defaultView');
});

test('resolveDefaultView: an explicit ?search= deep link is treated as NOT a bare load (defaultView never applied)', () => {
  const result = resolveDefaultView('', 'cats', '', '/media/music', ['/media/music']);
  assert.equal(result, '', 'rootFilter stays empty -- search results, not the default folder');
});

test('resolveDefaultView: an explicit ?folder= deep link is treated as NOT a bare load (defaultView never applied)', () => {
  const result = resolveDefaultView('', '', 'some-subfolder', '/media/music', ['/media/music']);
  assert.equal(result, '', 'rootFilter stays empty -- folder filter, not the default folder');
});

test('resolveDefaultView: a hiddenFromSidebar folder can still be a valid defaultView (cross-cutting, item 3 x item 4)', () => {
  // resolveDefaultView only ever consults `folders` (existence), never
  // folderSettings/hiddenFromSidebar -- a folder hidden from the sidebar
  // remains a fully legitimate default view.
  const result = resolveDefaultView('', '', '', '/media/hidden-from-sidebar', ['/media/hidden-from-sidebar']);
  assert.equal(result, '/media/hidden-from-sidebar');
});
