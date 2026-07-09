'use strict';

// [UNIT] v1.24 UX Round, Wave 3 (T10 follow-up) -- fires the view-count ping
// (`POST /api/videos/:id/view`, T10's already-tested/working route on
// server.js) from the watch page. Nothing called this route before this
// change, so the stats page's "most-watched" list was always empty. Like
// test/unit/move-trigger-wiring.test.js and test/unit/watch-pin-from-
// channel.test.js, there is no jsdom/browser-DOM harness in this codebase
// (see CONTRIBUTING.md), so this proves the load-bearing contracts directly
// against the source text:
//   1. exactly one view POST per watch-page open (guarded by a one-shot
//      flag, fresh per view instance);
//   2. the correct URL/method, with the id run through encodeURIComponent;
//   3. fired from the "mediaData resolved" point of the open path
//      (initWatch()), never from the progress-saving path or the
//      `/video/:id` Range-serve path;
//   4. best-effort -- never awaited, and any rejection is swallowed via
//      `.catch(() => {})` so a failed ping can never break the page.

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const watchJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'watch.js'), 'utf8');

test('pingView() POSTs to /api/videos/<id>/view with the id run through encodeURIComponent', () => {
  const fnMatch = /function pingView\(id\) \{[\s\S]*?\n {4}\}/.exec(watchJs);
  assert.ok(fnMatch, 'expected to find a pingView(id) function in watch.js');
  const body = fnMatch[0];
  assert.match(
    body,
    /fetch\('\/api\/videos\/' \+ encodeURIComponent\(id\) \+ '\/view', \{ method: 'POST', signal \}\)/,
    'expected pingView to POST to the id-encoded /api/videos/:id/view route'
  );
});

test('pingView() is best-effort: the fetch is chained with .catch(() => {}) so a rejection is silently swallowed', () => {
  const fnMatch = /function pingView\(id\) \{[\s\S]*?\n {4}\}/.exec(watchJs);
  const body = fnMatch[0];
  assert.match(body, /\.catch\(\(\) => \{\}\);?\s*$/m, 'expected the ping fetch to end in a swallowing .catch');
});

test('pingView() is guarded by a one-shot flag: returns early if already pinged, else sets the flag before firing', () => {
  const fnMatch = /function pingView\(id\) \{[\s\S]*?\n {4}\}/.exec(watchJs);
  const body = fnMatch[0];
  assert.match(body, /if \(viewPinged\) return;/, 'expected an early-return guard on viewPinged');
  const guardIdx = body.indexOf('if (viewPinged) return;');
  const setIdx = body.indexOf('viewPinged = true;');
  const fetchIdx = body.indexOf("fetch('/api/videos/");
  assert.ok(guardIdx >= 0 && setIdx > guardIdx, 'expected viewPinged to be set to true AFTER the guard check');
  assert.ok(fetchIdx > setIdx, 'expected the flag to be set BEFORE the fetch fires, so a synchronous re-entrant call cannot double-fire');
});

test('viewPinged starts false, fresh per view instance (declared with mediaData, not module-level)', () => {
  assert.match(watchJs, /let viewPinged = false;/);
  // Declared inside init()'s closure (alongside mediaData), not at IIFE/
  // module scope (alongside `controller`) -- so it resets to false on every
  // init() call, i.e. every watch-page open, including an SPA navigation
  // from one video straight to another.
  const initFnMatch = /function init\(root\) \{[\s\S]*/.exec(watchJs);
  assert.ok(initFnMatch, 'expected to find init(root)');
  const controllerDeclIdx = watchJs.indexOf('let controller = null;');
  const viewPingedDeclIdx = watchJs.indexOf('let viewPinged = false;');
  const initFnIdx = watchJs.indexOf('function init(root) {');
  assert.ok(controllerDeclIdx >= 0 && controllerDeclIdx < initFnIdx, 'controller should be declared at IIFE (module) scope, above init()');
  assert.ok(viewPingedDeclIdx > initFnIdx, 'viewPinged should be declared INSIDE init(), not at module scope');
});

test('pingView(mediaData.id) is called exactly once, from initWatch() right after mediaData resolves', () => {
  const initWatchMatch = /async function initWatch\(\) \{[\s\S]*?\n {4}\}/.exec(watchJs);
  assert.ok(initWatchMatch, 'expected to find initWatch()');
  const body = initWatchMatch[0];

  const mediaResolvedIdx = body.indexOf('mediaData = await mediaRes.json();');
  const pingCallIdx = body.indexOf('pingView(mediaData.id);');
  const channelNameIdx = body.indexOf('const channelName = resolveChannelName(mediaData, folderSettings);');

  assert.ok(mediaResolvedIdx >= 0, 'expected mediaData to be resolved from the /api/videos/:id fetch');
  assert.ok(pingCallIdx > mediaResolvedIdx, 'expected pingView to be called AFTER mediaData resolves');
  assert.ok(channelNameIdx > pingCallIdx, 'expected pingView to fire before the rest of the open flow continues (fire-and-forget, not blocking it)');

  // Exactly one actual CALL site anywhere in the whole file -- matches a
  // real invocation statement (`pingView(...);`), which excludes both the
  // `function pingView(id) {` definition itself and any prose that merely
  // mentions "pingView()" in a comment.
  const callSites = watchJs.match(/\bpingView\([^)]*\);/g) || [];
  assert.strictEqual(callSites.length, 1, 'expected exactly one pingView(...) invocation statement in watch.js');
  assert.strictEqual(callSites[0], "pingView(mediaData.id);");
});

test('pingView is never awaited -- fire-and-forget, never blocks player start', () => {
  assert.ok(!/await pingView\(/.test(watchJs), 'pingView should never be awaited');
});

test('watch.js never wires the view ping into the progress-saving or Range-serve paths -- it makes no fetch() call site targeting /api/progress or /video/:id (both live in player.js)', () => {
  const fetchCallSites = watchJs.match(/fetch\(\s*(['"`])[\s\S]*?\1/g) || [];
  assert.ok(fetchCallSites.length > 0, 'expected to find at least one fetch() call site to check');
  for (const call of fetchCallSites) {
    assert.ok(!call.includes('/api/progress'), `unexpected /api/progress fetch call site in watch.js: ${call}`);
    assert.ok(!/fetch\(\s*[`'"]\/video\//.test(call), `unexpected /video/:id fetch call site in watch.js: ${call}`);
  }
});
