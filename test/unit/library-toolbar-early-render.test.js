'use strict';

// [UNIT] v1.100 (Dean's device report): the classic library toolbar
// "starts with only a few buttons" then grows - the static sort/rescan/view
// buttons paint first and the format (All/Videos/Audio) + watch-state (All/New/
// Watching/Watched) toggles injected in fetchLibraryPage0 AFTER the /api/videos
// fetch. Those toggles read SYNCHRONOUS localStorage prefs, so the fix renders
// them at the TOP of loadLibrary - BEFORE the /api/config + /api/videos awaits -
// so the toolbar is complete from the first paint (no reveal needed; the grid
// below still shimmers via buildSkeletonGrid). A source-text lock (main.js has
// no jsdom harness for this view IIFE - the established library-toolbar-wiring
// posture).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const mainJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');

// The synchronous prefix of loadLibrary: from its declaration to the first
// `fetch('/api/config'` (the first await). The early toggle render must live here.
function loadLibraryPrefix() {
  const start = mainJs.indexOf('async function loadLibrary()');
  assert.ok(start !== -1, 'loadLibrary exists');
  const cfg = mainJs.indexOf("fetch('/api/config'", start);
  assert.ok(cfg !== -1, 'loadLibrary awaits /api/config');
  return mainJs.slice(start, cfg);
}

// UI pass sweep S2 (F19): the format + watch toggles are dimensions of the ONE
// chip row now (mountLibraryChips); the v1.100 complete-from-first-paint lock
// carries over to it (AC12 conversion).
test('loadLibrary renders the filter chip row BEFORE the first fetch (toolbar complete from first paint)', () => {
  const prefix = loadLibraryPrefix();
  assert.match(prefix, /buildSkeletonGrid\(SKELETON_CARD_COUNT, \{ avatar: !!modernMode, typeLine: isUnifiedSearch \}\)/, 'the grid skeleton is still seeded first (with the search type line on a global search)');
  assert.match(prefix, /ensureLibraryChips\(\);/, 'the chip row mounts in loadLibrary BEFORE the /api/config fetch');
  const mount = mainJs.slice(mainJs.indexOf('function mountLibraryChips() {'), mainJs.indexOf('function updateShuffleButtonVisibility() {'));
  assert.match(mount, /getStoredFormatFilter\(\)[\s\S]*getStoredWatchFilter\(\)/, 'from the synchronous stored prefs');
  assert.doesNotMatch(mount, /await|fetch\(/, 'the mount itself is synchronous');
});

test('the early render is scoped to the classic toolbar (NOT modern home) and guarded against a rebuild', () => {
  const prefix = loadLibraryPrefix();
  assert.match(prefix, /if \(!modernMode\) ensureLibraryChips\(\);/, 'the early render is scoped to the classic toolbar');
  const ensure = mainJs.slice(mainJs.indexOf('function ensureLibraryChips() {'), mainJs.indexOf('function mountLibraryChips() {'));
  assert.match(ensure, /if \(cur && cur\.getAttribute\('data-kind'\) === chipRowKind\(\)\) return;/, 'a row of this kind is never rebuilt (no flash, scroll kept)');
});

test('fetchLibraryPage0 never UNCONDITIONALLY re-renders the chip row; its fallback call is guarded too', () => {
  const start = mainJs.indexOf('async function fetchLibraryPage0()');
  const end = mainJs.indexOf('\n    }', start);
  const body = mainJs.slice(start, end);
  assert.match(body, /ensureLibraryChips\(\);/, 'the fetchLibraryPage0 chip render goes through the same guard');
  assert.doesNotMatch(body, /mountLibraryChips\(\)/, 'never the unguarded mount');
});
