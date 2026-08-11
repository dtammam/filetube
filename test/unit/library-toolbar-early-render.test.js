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

test('loadLibrary renders the format + watch toggles BEFORE the first fetch (toolbar complete from first paint)', () => {
  const prefix = loadLibraryPrefix();
  // Rendered before any await, alongside the grid skeleton seed.
  assert.match(prefix, /buildSkeletonGrid\(SKELETON_CARD_COUNT\)/, 'the grid skeleton is still seeded first');
  assert.match(prefix, /renderFormatToggle\(sectionActions,\s*getStoredFormatFilter\(\),\s*\(\)\s*=>\s*resetAndReload\(\)\)/,
    'the format toggle renders in loadLibrary BEFORE the /api/config fetch');
  assert.match(prefix, /renderWatchToggle\(sectionActions,\s*getStoredWatchFilter\(\),\s*\(\)\s*=>\s*resetAndReload\(\)\)/,
    'the watch-state toggle renders in loadLibrary BEFORE the fetch');
  assert.ok(prefix.indexOf('renderFormatToggle(') < prefix.indexOf('renderWatchToggle('),
    'format toggle before watch toggle (the watch renderer anchors behind #library-format-toggle)');
});

test('the early render is scoped to the classic toolbar (NOT modern home) and guarded against a re-render flash', () => {
  const prefix = loadLibraryPrefix();
  // The guard block: modern home uses its own chip chrome (section-actions
  // hidden); not-present so a loadLibrary retry / cached re-entry never
  // removes+reinserts the toggles (a flash).
  assert.match(prefix, /if \(!modernMode && sectionActions && !sectionActions\.querySelector\('#library-format-toggle'\)\) \{[\s\S]*?renderFormatToggle[\s\S]*?renderWatchToggle[\s\S]*?\}/,
    'the early render is guarded on !modernMode + not-already-present');
});

test('fetchLibraryPage0 no longer UNCONDITIONALLY re-renders the toggles (it would remove+reinsert = a flash); its call is guarded too', () => {
  const start = mainJs.indexOf('async function fetchLibraryPage0()');
  const end = mainJs.indexOf('\n    }', start);
  const body = mainJs.slice(start, end);
  // The fetchLibraryPage0 toggle render (a fallback) is now behind the same
  // not-present guard, so it can't flash over the early-rendered toggles.
  assert.match(body, /if \(sectionActions && !sectionActions\.querySelector\('#library-format-toggle'\)\) \{[\s\S]*?renderFormatToggle/,
    'the fetchLibraryPage0 toggle render is guarded on not-present (no unconditional re-render flash)');
});
