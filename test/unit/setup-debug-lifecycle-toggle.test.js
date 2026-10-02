'use strict';

// [UNIT] v1.27.1: a Settings (Setup page) toggle for player.js's
// `?debugLifecycle=1` on-screen lifecycle-debug overlay. An owner running the
// installed PWA has no address bar to type the URL param into, so this adds
// an in-app way to flip the SAME `localStorage['ft-debug-lifecycle']` flag
// `initDebugLifecycleFlag()` (public/js/player.js) already reads/writes.
//
// This is a CLIENT-LOCAL preference, deliberately NOT a server db.settings
// value -- it must never appear in server.js's DEFAULT_SETTINGS/KNOWN_KEYS
// allowlist (see test/integration/background-audio-setting-api.test.js for
// the contrasting shape of an actual server-backed toggle). No jsdom/browser
// harness in this codebase (see CONTRIBUTING.md) -- locked directly against
// source text, mirroring test/unit/player-lifecycle-release.test.js and
// test/unit/settings-mobile-polish.test.js.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SETUP_HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
const SETUP_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'setup.js'), 'utf8');
const PLAYER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
const SERVER_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
// Wave 7b (the monolith split, slice S10b): POST /api/settings - and with it
// the KNOWN_KEYS allowlist declared inside it - moved to lib/config/routes.js.
// The allowlist lock reads the route SURFACE (server.js PLUS every module the
// split carved out of it, derived from server.js's own requires) so it binds
// the same declaration wherever the slice put it. DEFAULT_SETTINGS and the
// localStorage-key negative still read server.js: both live there.
const { routeSurfaceSource } = require('../helpers/route-surface');
const ROUTE_SURFACE = routeSurfaceSource();

// ---- setup.html: the checkbox exists, with a hint ---------------------

test('setup.html: a "Show lifecycle debug log" checkbox exists (#debug-lifecycle-check)', () => {
  assert.match(SETUP_HTML, /<input type="checkbox" role="switch" class="ui-switch" id="debug-lifecycle-check" \/>/);
  assert.match(SETUP_HTML, /Show lifecycle debug log/);
});

test('setup.html: the checkbox has an explanatory hint mentioning force-quit survival (matches player.js\'s own documented rationale)', () => {
  // Sweep S8: the hint is the .setup-note footer directly under the switch's grouped list.
  // v1.355: the rotate-log switch row now follows this one in the same list, so the hint is the FIRST
  // note after the list closes (the rotate log's own note follows it).
  const match = /id="debug-lifecycle-check" \/><\/span><\/div>\s*<div class="ui-row[^\n]*id="debug-rotate-check" \/><\/span><\/div>\s*<\/div>\s*<p class="setup-note">([\s\S]*?)<\/p>/.exec(SETUP_HTML);
  assert.ok(match, 'expected a .setup-note hint immediately following the switch row');
  assert.match(match[1], /diagnosing player lifecycle issues/);
  assert.match(match[1], /survives a force-quit/);
});

// ---- setup.js: reads/writes the EXACT SAME storage key as player.js ---

test("setup.js declares DEBUG_LIFECYCLE_STORAGE_KEY = 'ft-debug-lifecycle', matching player.js's own DEBUG_LIFECYCLE_STORAGE_KEY exactly", () => {
  assert.match(SETUP_JS, /const DEBUG_LIFECYCLE_STORAGE_KEY = 'ft-debug-lifecycle';/);
  assert.match(PLAYER_JS, /var DEBUG_LIFECYCLE_STORAGE_KEY = 'ft-debug-lifecycle';/);
});

test('loadDebugLifecycleControl() prefills the checkbox from localStorage, treating anything other than the literal string \'1\' as off (mirrors isDebugLifecycleEnabled()\'s own === \'1\' check in player.js)', () => {
  const match = /function loadDebugLifecycleControl\(\) \{([\s\S]*?)\n\}/.exec(SETUP_JS);
  assert.ok(match, 'expected to find loadDebugLifecycleControl()\'s source body');
  const body = match[1];
  assert.match(body, /document\.getElementById\('debug-lifecycle-check'\)/);
  assert.match(body, /localStorage\.getItem\(DEBUG_LIFECYCLE_STORAGE_KEY\)/);
  assert.match(body, /check\.checked = raw === '1';/);
});

test('the checkbox change listener sets the key to \'1\' when checked, and REMOVES it (not sets to \'0\') when unchecked -- mirrors initDebugLifecycleFlag()\'s own set/removeItem shape in player.js exactly', () => {
  const match = /debugLifecycleCheck\.addEventListener\('change', \(e\) => \{([\s\S]*?)\n {4}\}, \{ signal \}\);/.exec(SETUP_JS);
  assert.ok(match, 'expected to find the checkbox\'s change listener');
  const body = match[1];
  assert.match(body, /if \(e\.target\.checked\) localStorage\.setItem\(DEBUG_LIFECYCLE_STORAGE_KEY, '1'\);/);
  assert.match(body, /else localStorage\.removeItem\(DEBUG_LIFECYCLE_STORAGE_KEY\);/);

  // player.js's own URL-param mechanism (?debugLifecycle=1 / =0), for
  // comparison -- both paths must write/clear the exact same key.
  const playerMatch = /function initDebugLifecycleFlag\(\) \{([\s\S]*?)\n {2}\}/.exec(PLAYER_JS);
  assert.match(playerMatch[1], /localStorage\.setItem\(DEBUG_LIFECYCLE_STORAGE_KEY, '1'\)/);
  assert.match(playerMatch[1], /localStorage\.removeItem\(DEBUG_LIFECYCLE_STORAGE_KEY\)/);
});

test('the change listener is wired inside wireStaticControls() and loadDebugLifecycleControl() is called from init(), same lifecycle as the resume-threshold control', () => {
  assert.match(SETUP_JS, /const debugLifecycleCheck = document\.getElementById\('debug-lifecycle-check'\);/);
  assert.match(SETUP_JS, /loadDebugLifecycleControl\(\);/);
  const initMatch = /function init\(root\) \{([\s\S]*?)\n\}/.exec(SETUP_JS);
  assert.ok(initMatch, 'expected to find init(root)\'s source body');
  assert.match(initMatch[1], /loadDebugLifecycleControl\(\);/);
});

// ---- NOT a server setting: absent from DEFAULT_SETTINGS/KNOWN_KEYS ----

test('the route surface: KNOWN_KEYS (the /api/settings POST allowlist) does not include a lifecycle-debug key', () => {
  const match = /const KNOWN_KEYS = \[([^\]]*)\];/.exec(ROUTE_SURFACE);
  assert.ok(match, 'expected to find the KNOWN_KEYS array declaration');
  assert.ok(!/debugLifecycle/i.test(match[1]), 'the client-local lifecycle-debug flag must never be added to the server settings allowlist');
  assert.ok(!/lifecycle/i.test(match[1]), 'no lifecycle-related key belongs in KNOWN_KEYS -- this is a localStorage-only preference');
});

test('server.js: DEFAULT_SETTINGS does not include a lifecycle-debug key', () => {
  const match = /const DEFAULT_SETTINGS = \{([\s\S]*?)\n\};/.exec(SERVER_JS);
  assert.ok(match, 'expected to find the DEFAULT_SETTINGS object declaration');
  assert.ok(!/debugLifecycle/i.test(match[1]), 'the client-local lifecycle-debug flag must never be added to DEFAULT_SETTINGS');
});

test('server.js never references the localStorage key string \'ft-debug-lifecycle\' anywhere (confirms this stays purely client-side)', () => {
  assert.ok(!SERVER_JS.includes('ft-debug-lifecycle'), 'the flag must never be persisted server-side');
});

// ---- v1.73.1: the default-view picker names the synthetic folder Downloads --

test('v1.73.1 SOURCE-LOCK: the picker labels a synthetic folder "Downloads" while its VALUE stays the path (saved selections keep working)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../public/js/setup.js'), 'utf8');
  assert.ok(src.includes("? ((folderSettings[f] && folderSettings[f].name) || 'Downloads')"), 'synthetic rows read Downloads in the picker UNLESS a custom rename exists (slim-gate S1)');
  assert.ok(src.includes('`<option value="${escapeHtml(f)}">${escapeHtml(label)}</option>`'), 'the option VALUE is still the folder path - the defaultView contract is unchanged');
  assert.ok(src.includes('visibleSidebarFolders(folders, settings, syntheticFolders)'), "setup's sidebar render threads the synthetic list");
});


// ---- v1.73.1 slim-gate W2: EVERY threaded call site is bound ----------------

test('v1.73.1 SOURCE-LOCK (slim-gate W2/C1): all six synthetic-threading sites are bound - a dropped arg anywhere fails here', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '../../public/js/', f), 'utf8');
  const mainSrc = read('main.js');
  assert.ok(mainSrc.includes('visibleSidebarFolders(folders, settings, syntheticFolderPaths)'), 'main.js renderer threads (mutant M3)');
  const setupSrc = read('setup.js');
  assert.ok(setupSrc.includes('visibleSidebarFolders(folders, settings, syntheticFolders)'), 'setup.js renderer threads (mutant M5)');
  // v1.339 S2 (T-C1): the two sidebar DnD rebuilds (old mutants M4/M6) moved
  // out of main.js/setup.js into common.js's ONE by-path persist, which
  // rebuilds from the FRESH GET - so the threading now lives there, and the
  // synthetic list it threads is the fresh config's, never a page copy. Both
  // callers reach it only through that helper (bound behaviourally in
  // setup-sidebar-reorder.test.js "S2: a synthetic folder keeps its absolute
  // position" and home-sidebar-reorder-cas.test.js).
  assert.ok(mainSrc.includes('persistSidebarMoveByPath(move)'), 'main.js DnD goes through the shared by-path persist');
  assert.ok(setupSrc.includes('persistSidebarMoveByPath(move)'), 'setup.js DnD goes through the shared by-path persist');
  const watchSrc = read('watch.js');
  assert.ok(watchSrc.includes('visibleSidebarFolders(folders, settings, watchSyntheticFolders)'), 'watch.js renderer threads (slim-gate C1 - the v1.41.4 site)');
  const commonSrc = read('common.js');
  assert.ok(commonSrc.includes('visibleSidebarFolders(folders, settings, syntheticFolders); // v1.73.1: sheet/sidebar parity'), 'the Playlists sheet threads (slim-gate W1)');
  assert.ok(commonSrc.includes('const synthetic = Array.isArray(cfg.syntheticFolders) ? cfg.syntheticFolders : [];'), 'the by-path persist reads the FRESH synthetic list');
  assert.ok(commonSrc.includes('applySidebarMoveByPath(folders, settings, synthetic, move.draggedPath'), 'and threads it into the move');
  assert.ok(commonSrc.includes('visibleSidebarFolders(full, settings, syntheticFolders);\n  if (draggedPath === anchorPath'), 'the move derives the visible subset with it');
  assert.ok(commonSrc.includes('rebuildFullFolderOrder(full, settings, without, syntheticFolders)'), 'and rebuilds the full order with it (old mutants M4/M6)');
  assert.ok(commonSrc.includes('renderPlaylistsSheet(snapshot.folders, snapshot.folderSettings, snapshot.syntheticFolders)'), 'and its caller passes the snapshot half');
  // Slim-gate round-2 residual, closed as the one-liner it was: the
  // snapshot BUILDER is the ninth link - without this, deleting its
  // syntheticFolders field silently restored the mobile dupe (full suite
  // green, the seat measured it).
  assert.ok(commonSrc.includes('syntheticFolders: Array.isArray(config.syntheticFolders) ? config.syntheticFolders : []'), 'the sheet snapshot BUILDER carries the field (the ninth link)');
  assert.ok(commonSrc.includes('[data-nav-sidebar="downloads"]'), 'the sheet MIRRORS the Downloads entry (removal without the mirror = no mobile access)');
});
