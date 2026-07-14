'use strict';

// [UNIT] v1.41.4 (Dean bug): folders flagged folderSettings[path].hiddenFromSidebar
// were correctly hidden on the Home sidebar but re-appeared in FULL on the watch
// page once a video was opened.
//
// ROOT CAUSE: watch.js's renderSidebarFolders mapped the RAW `folders` array
// straight to links, never applying the shared visibleSidebarFolders() filter
// that main.js (home sidebar), setup.js (Setup list) and common.js (mobile
// Playlists sheet) all use. Same data source (GET /api/config's folders +
// folderSettings), different filtering: home filtered, watch did not.
//
// No jsdom/browser-DOM harness exists in this codebase (see e.g.
// watch-prev-next-flash.test.js / watch-view-ping.test.js for the identical
// rationale), so we (1) re-assert the pure filter's contract and (2) prove the
// runtime wiring against the watch.js source: renderSidebarFolders derives a
// visibleSidebarFolders() list and BOTH its empty-check and its .map() consume
// that filtered list -- never the raw `folders` argument.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const { visibleSidebarFolders } = require('../../public/js/common.js');

const watchJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'watch.js'), 'utf8');

// ---- the shared filter's contract (the single source of truth) ------------

test('visibleSidebarFolders: omits a hiddenFromSidebar folder (the parity contract watch must honor)', () => {
  const folders = ['/media/movies', '/media/music'];
  const settings = { '/media/music': { hiddenFromSidebar: true } };
  assert.deepEqual(visibleSidebarFolders(folders, settings), ['/media/movies']);
});

// ---- watch.js runtime wiring, proven against source -----------------------

test('watch.js renderSidebarFolders: derives visibleSidebarFolders(folders, settings) before rendering', () => {
  assert.match(
    watchJs,
    // The window is generous on purpose: it spans the function's comment
    // block, so a tight bound would FALSELY FAIL the day someone expands that
    // comment (slim-gate LOW-1). Non-greedy, so it still anchors to the FIRST
    // derivation inside this function.
    /function renderSidebarFolders\(folders, settings = \{\}\) \{[\s\S]{0,2000}?const visibleFolders = visibleSidebarFolders\(folders, settings\);/,
    'expected renderSidebarFolders to compute a visibleSidebarFolders() list'
  );
});

test('watch.js renderSidebarFolders: the empty-check gates on the FILTERED list, so all-hidden shows "None" (not the raw folders length)', () => {
  const fnStart = watchJs.indexOf('function renderSidebarFolders(folders, settings = {}) {');
  assert.ok(fnStart >= 0, 'expected to find renderSidebarFolders');
  const fnBody = watchJs.slice(fnStart, fnStart + 900);
  assert.ok(
    fnBody.includes('if (visibleFolders.length === 0)'),
    'expected the empty-check to test visibleFolders.length (filtered), never folders.length (raw)'
  );
  assert.ok(
    !/if \(folders\.length === 0\)/.test(fnBody),
    'the raw-folders empty-check must be gone -- it is what let hidden folders survive'
  );
});

test('watch.js renderSidebarFolders: the link list is built from the FILTERED visibleFolders, not the raw folders array', () => {
  const fnStart = watchJs.indexOf('function renderSidebarFolders(folders, settings = {}) {');
  const fnBody = watchJs.slice(fnStart, fnStart + 1600);
  assert.match(
    fnBody,
    /sidebarFoldersList\.innerHTML = visibleFolders\.map\(/,
    'expected the sidebar list to map over visibleFolders (filtered), never folders (raw)'
  );
});
