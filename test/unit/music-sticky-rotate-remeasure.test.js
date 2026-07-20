'use strict';

// [UNIT] v1.45.0 T3 -- the music album-drill sticky header measures the fixed
// site-header height ONCE (buildStickyBar/wireStickyObserver), and the mobile
// header is taller than desktop, so a portrait<->landscape rotate left the
// sticky offset + collapse threshold stale until the next render(). This locks
// the re-measure: a debounced resize/orientationchange handler re-runs
// wireStickyObserver, registered with the init AbortController signal (so the
// SPA #view-root swap tears it down) and guarded against a trailing timer
// firing after destroy(). Actual on-rotate rendering is Dean's on-device call.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MUSIC_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');

test('T3: a rotate/resize re-measure re-runs wireStickyObserver, debounced', () => {
  assert.match(MUSIC_JS, /function scheduleStickyRemeasure\(\)/, 'has a debounced re-measure scheduler');
  assert.match(MUSIC_JS, /clearTimeout\(stickyRemeasureTimer\)/, 'debounces (clears the prior timer)');
  assert.match(MUSIC_JS, /wireStickyObserver\(\)/, 're-runs the observer wiring (re-measures the header)');
});

test('T3: the re-measure listeners are registered with the { signal } AbortController (torn down on the SPA swap)', () => {
  assert.match(MUSIC_JS, /window\.addEventListener\('resize', scheduleStickyRemeasure, \{ signal \}\)/, 'resize is signal-scoped');
  assert.match(MUSIC_JS, /window\.addEventListener\('orientationchange', scheduleStickyRemeasure, \{ signal \}\)/, 'orientationchange is signal-scoped');
});

test('T3: a trailing debounce timer firing after destroy() is guarded by isConnected (no observer on a detached node)', () => {
  assert.match(MUSIC_JS, /if \(content && content\.isConnected\) wireStickyObserver\(\)/,
    'the debounced body only re-wires while the view content is still connected');
});

test('T3 (gate S2): the pending debounce timer is also cleared on the abort (SPA teardown)', () => {
  assert.match(MUSIC_JS, /signal\.addEventListener\('abort', function \(\) \{ clearTimeout\(stickyRemeasureTimer\); \}\)/,
    'destroy() -> controller.abort() cancels any pending re-measure timer');
});

test('T3: the re-measure listeners sit INSIDE init (where `signal` exists), not module scope', () => {
  const initStart = MUSIC_JS.indexOf('function init(root)');
  const destroyStart = MUSIC_JS.indexOf('function destroy()');
  assert.ok(initStart !== -1 && destroyStart !== -1 && initStart < destroyStart);
  const initBody = MUSIC_JS.slice(initStart, destroyStart);
  assert.match(initBody, /function scheduleStickyRemeasure\(\)/, 're-measure scheduler is defined within init');
  assert.match(initBody, /addEventListener\('orientationchange'/, 'listeners are registered within init');
});
