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

// ---- setup.html: the checkbox exists, with a hint ---------------------

test('setup.html: a "Show lifecycle debug log" checkbox exists (#debug-lifecycle-check)', () => {
  assert.match(SETUP_HTML, /<input type="checkbox" id="debug-lifecycle-check" \/>/);
  assert.match(SETUP_HTML, /Show lifecycle debug log/);
});

test('setup.html: the checkbox has an explanatory hint mentioning force-quit survival (matches player.js\'s own documented rationale)', () => {
  const match = /<input type="checkbox" id="debug-lifecycle-check" \/>[\s\S]*?<\/label>\s*<small[^>]*>([\s\S]*?)<\/small>/.exec(SETUP_HTML);
  assert.ok(match, 'expected a <small> hint immediately following the checkbox label');
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

test('server.js: KNOWN_KEYS (the /api/settings POST allowlist) does not include a lifecycle-debug key', () => {
  const match = /const KNOWN_KEYS = \[([^\]]*)\];/.exec(SERVER_JS);
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
