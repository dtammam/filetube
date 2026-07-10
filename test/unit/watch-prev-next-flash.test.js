'use strict';

// [UNIT] D1 (v1.24 UX Round, Wave 4, T12) -- the ~1/4s blank/flash of the
// persistent player host on Prev/Next.
//
// ROOT CAUSE: the SPA router (public/js/common.js's swapToView) detaches the
// OUTGOING #view-root -- and the persistent <video> host, still nested
// inside its OLD #player-slot at that instant -- SYNCHRONOUSLY
// (`oldRoot.replaceWith(root)`), well BEFORE the incoming watch view's own
// init() runs. Prior to this fix, the ONLY reparent of the host into the NEW
// #player-slot happened deep inside watch.js's initWatch() (an async
// function) AFTER it had awaited BOTH /api/config and /api/videos/:id -- so
// on a genuine watch -> watch navigation to a DIFFERENT video (Prev/Next, a
// related-card click), the host sat fully detached from the live document
// for the duration of those two network round-trips.
//
// THE FIX: `resolveWatchEntryReparentAction` (public/js/watch.js) extends
// the existing SAME-id "adopt" fast path (which already ran synchronously,
// before any fetch, for the dock-tap case) to a NEW 'reparent' outcome for a
// DIFFERENT id when the host is currently mounted FULL -- watch.js's init()
// then calls `window.FileTube.player.expand(playerSlot)` (a pure reparent,
// same call `mountInSlot`'s adopt path already used) synchronously, in the
// SAME task as the router's swap, before initWatch()'s fetches even start.
// This is what closes the detached-host window entirely, without changing
// the FULL/DOCKED/CLOSED reparenting model itself (`expand`/`dock`/`close`
// are called exactly as before, just at an additional call site / earlier
// moment).
//
// No jsdom/browser-DOM harness exists in this codebase (see CONTRIBUTING.md
// and e.g. test/unit/watch-view-ping.test.js's identical rationale), so the
// pure decision table is tested directly, and the runtime wiring is proven
// against the source: the 'reparent' branch calls `player.expand(...)`
// synchronously, textually BEFORE `initWatch()` is ever invoked -- not just
// "somewhere in init()".

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const { resolveWatchEntryReparentAction } = require('../../public/js/watch.js');

const watchJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'watch.js'), 'utf8');

// ---- resolveWatchEntryReparentAction: the pure decision table -------------

test('resolveWatchEntryReparentAction: same id, not closed -> adopt (pure reparent, no restart)', () => {
  assert.strictEqual(resolveWatchEntryReparentAction('abc', 'abc', 'full'), 'adopt');
  assert.strictEqual(resolveWatchEntryReparentAction('abc', 'abc', 'docked'), 'adopt');
});

test('resolveWatchEntryReparentAction: same id but CLOSED -> not an adopt (source was released -- needs a fresh load, matches isAdoptLoad)', () => {
  assert.strictEqual(resolveWatchEntryReparentAction('abc', 'abc', 'closed'), 'defer');
});

test('resolveWatchEntryReparentAction: DIFFERENT id while FULL -> reparent (the D1 fix -- eagerly carry the host into the new slot)', () => {
  assert.strictEqual(resolveWatchEntryReparentAction('abc', 'xyz', 'full'), 'reparent');
});

test('resolveWatchEntryReparentAction: DIFFERENT id while DOCKED -> defer (do NOT force the WRONG docked video into FULL before real data resolves)', () => {
  assert.strictEqual(resolveWatchEntryReparentAction('abc', 'xyz', 'docked'), 'defer');
});

test('resolveWatchEntryReparentAction: DIFFERENT id while CLOSED -> defer (nothing to carry over)', () => {
  assert.strictEqual(resolveWatchEntryReparentAction('abc', 'xyz', 'closed'), 'defer');
});

test('resolveWatchEntryReparentAction: nothing currently loaded (null currentId) -> defer, regardless of state or requested id', () => {
  assert.strictEqual(resolveWatchEntryReparentAction(null, 'xyz', 'closed'), 'defer');
  assert.strictEqual(resolveWatchEntryReparentAction(null, 'xyz', 'full'), 'defer');
});

// ---- Runtime wiring: the mechanism actually fixes what it claims ----------

test('init(): the reparent branch calls window.FileTube.player.expand(playerSlot) -- a pure reparent, matching the adopt path\'s own player.expand call, never player.load (no restart of the OLD video)', () => {
  assert.match(
    watchJs,
    /entryReparentAction === 'reparent'\) \{[\s\S]{0,700}?window\.FileTube\.player\.expand\(playerSlot\);/,
    'expected the reparent branch to call window.FileTube.player.expand(playerSlot)'
  );
});

test('init(): the reparent decision + expand() call are wired SYNCHRONOUSLY, textually BEFORE initWatch() is ever invoked -- not deferred behind the awaited fetches', () => {
  const entryDecisionIdx = watchJs.indexOf('const entryReparentAction = resolveWatchEntryReparentAction(');
  const expandCallIdx = watchJs.indexOf('window.FileTube.player.expand(playerSlot);');
  const asyncInitWatchDeclIdx = watchJs.indexOf('async function initWatch() {');
  const initWatchInvokeIdx = watchJs.lastIndexOf('initWatch();');

  assert.ok(entryDecisionIdx >= 0, 'expected to find the entryReparentAction decision call site');
  assert.ok(expandCallIdx >= 0, 'expected to find the expand(playerSlot) call site');
  assert.ok(asyncInitWatchDeclIdx >= 0, 'expected to find the initWatch() function declaration');
  assert.ok(initWatchInvokeIdx >= 0, 'expected to find the initWatch() invocation');

  // The decision + reparent call are OUTSIDE (before) the async function's
  // own body/declaration -- proving they run in init()'s own synchronous
  // top-level flow, not nested inside the awaited chain.
  assert.ok(entryDecisionIdx < asyncInitWatchDeclIdx, 'expected the reparent decision to be wired before initWatch() is even declared');
  assert.ok(expandCallIdx < asyncInitWatchDeclIdx, 'expected the expand() call to run before initWatch() is even declared');
  // And, redundantly, both sit before the actual invocation that kicks off
  // the awaited /api/config + /api/videos/:id fetches.
  assert.ok(entryDecisionIdx < initWatchInvokeIdx, 'expected the reparent decision to run before initWatch() is invoked');
  assert.ok(expandCallIdx < initWatchInvokeIdx, 'expected the expand() call to run before initWatch() is invoked');
});

test('init(): the reparent decision is derived from the LIVE controller state (currentId + getState()), not a stale/cached snapshot', () => {
  const fnCallMatch = /const entryReparentAction = resolveWatchEntryReparentAction\(\s*window\.FileTube\.player\.currentId,\s*mediaId,\s*window\.FileTube\.player\.getState\(\)\s*\);/;
  assert.match(watchJs, fnCallMatch, 'expected resolveWatchEntryReparentAction to be called with (player.currentId, mediaId, player.getState())');
});

test('init(): the pre-existing same-id "adopt" fast path (dock-tap / same-video reparent) is preserved, still calling player.load(mediaId, {}, { slot: playerSlot }) with its own fatal-error guard', () => {
  assert.match(
    watchJs,
    /entryReparentAction === 'adopt'\) \{[\s\S]{0,200}?const mountedEarly = window\.FileTube\.player\.load\(mediaId, \{\}, \{ slot: playerSlot \}\);[\s\S]{0,100}?if \(!mountedEarly\) showFatalViewError\(root\);/,
    'expected the adopt branch to be unchanged: player.load(mediaId, {}, { slot: playerSlot }) + the fatal-error guard'
  );
});

test('resolveWatchEntryReparentAction never touches window/document (pure, DOM-free) and is exported for node:test, mirroring player.js\'s isAdoptLoad pattern', () => {
  assert.strictEqual(typeof resolveWatchEntryReparentAction, 'function');
  // Calling it with plain primitives must never throw -- no DOM access.
  assert.doesNotThrow(() => resolveWatchEntryReparentAction('a', 'b', 'full'));
});
