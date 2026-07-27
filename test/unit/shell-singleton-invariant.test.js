'use strict';

// [UNIT] v1.47.4 item 4 -- nav-injector idempotency + the ?debugUI=1 shell
// singleton invariant.
//
// Dean: "on mobile at times if I go back and forth between pages ... certain
// icons do not properly show or glitch out and duplicate (think the top bar).
// It's odd and annoying and only resolved by switching pages entirely."
//
// HONEST SCOPE, asserted here so it cannot quietly drift: the idempotency fixes
// below are real and provable, but they do NOT explain a TOP-BAR symptom during
// in-app navigation (those injectors run once at DOMContentLoaded, and the
// header markup is static). Dean's report is intermittent and uncapturable, so
// the second half of this item is an INSTRUMENT that makes the next occurrence
// report itself -- not a claimed fix.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const {
  findDuplicateShellSingletons,
  SHELL_SINGLETON_SELECTORS,
} = require('../../public/js/common.js');

const COMMON = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');

// ---- THE REAL DEFECT (tech-debt #33a) --------------------------------------

test('the subscriptions SIDEBAR link now carries its own marker attribute', () => {
  // THE BUG: the sidebar link was created with no marker at all, and the guard
  // only ever matched the BOTTOM-NAV entry's `data-nav`. On a shell with no
  // #bottom-nav that entry is never created, so the guard could never become
  // true and EVERY call appended another sidebar link.
  const injector = COMMON.slice(
    COMMON.indexOf('function injectSubscriptionsNavLinkIfEnabled()'),
    COMMON.indexOf('// ---- v1.37.0 books nav-link injection'),
  );
  assert.match(injector, /sidebarLink\.setAttribute\('data-nav-sidebar', 'subscriptions'\)/,
    'the sidebar entry must be markable, or it can never be de-duplicated');
});

test('the idempotency guard checks BOTH surfaces, not just the bottom nav', () => {
  const guard = COMMON.slice(COMMON.indexOf('function subscriptionsNavAlreadyInjected()'));
  assert.match(guard.slice(0, 400), /\[data-nav="subscriptions"\]/, 'bottom-nav marker');
  assert.match(guard.slice(0, 400), /\[data-nav-sidebar="subscriptions"\]/, 'sidebar marker');
});

test('every probe-gated injector RE-CHECKS after its fetch resolves', () => {
  // The pre-fetch guard runs BEFORE the await, so two overlapping calls both
  // passed it and both injected -- the classic async double-inject window.
  const subs = COMMON.slice(
    COMMON.indexOf('function injectSubscriptionsNavLinkIfEnabled()'),
    COMMON.indexOf('// ---- v1.37.0 books nav-link injection'),
  );
  const afterFetch = subs.slice(subs.indexOf('.then((res) =>'));
  assert.match(afterFetch, /if \(subscriptionsNavAlreadyInjected\(\)\) return;/,
    'subscriptions must re-check inside the .then, where the DOM write happens');

  const oneOff = COMMON.slice(COMMON.indexOf('function injectOneOffDownloadButtonIfEnabled()'));
  const oneOffAfterFetch = oneOff.slice(oneOff.indexOf('.then((res) =>'), oneOff.indexOf('.then((res) =>') + 900);
  assert.match(oneOffAfterFetch, /getElementById\('ytdlp-oneoff-btn'\)/,
    'the one-off button must re-check after its fetch too');

  // books/music both write through injectLibraryNavEntry, which re-checks its
  // own marker at the write site -- so their window is closed there.
  const libraryEntry = COMMON.slice(COMMON.indexOf('function injectLibraryNavEntry('));
  assert.match(libraryEntry.slice(0, 300), /if \(document\.querySelector\('\[data-nav-sidebar="' \+ key \+ '"\]'\)\) return;/);
});

// ---- findDuplicateShellSingletons (pure) -----------------------------------

test('findDuplicateShellSingletons: reports only genuine duplicates, with counts', () => {
  const counts = { header: 2, '#bottom-nav': 1, '#menu-toggle': 3, '.header-right': 0 };
  const dupes = findDuplicateShellSingletons((sel) => counts[sel] || 0, Object.keys(counts));
  assert.deepEqual(dupes, [
    { selector: 'header', count: 2 },
    { selector: '#menu-toggle', count: 3 },
  ]);
});

test('findDuplicateShellSingletons: a clean document reports nothing', () => {
  assert.deepEqual(findDuplicateShellSingletons(() => 1), []);
  assert.deepEqual(findDuplicateShellSingletons(() => 0), []);
});

test('findDuplicateShellSingletons: never throws on a bad counter or selector list', () => {
  // A diagnostic that can itself crash is worse than no diagnostic.
  assert.doesNotThrow(() => findDuplicateShellSingletons(() => { throw new Error('bad selector'); }));
  assert.deepEqual(findDuplicateShellSingletons(() => { throw new Error('x'); }), []);
  for (const bad of [undefined, null, 'nope', 42, {}]) {
    assert.doesNotThrow(() => findDuplicateShellSingletons(() => 1, bad));
  }
  assert.deepEqual(findDuplicateShellSingletons(() => 'two'), [], 'a non-numeric count is not a finding');
});

test('findDuplicateShellSingletons: works against a REAL duplicated document', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <header><button id="menu-toggle"></button></header>
    <header><button id="menu-toggle"></button></header>
    <div id="bottom-nav"></div>
  </body></html>`);
  const d = dom.window.document;
  const dupes = findDuplicateShellSingletons((sel) => d.querySelectorAll(sel).length);
  const byselector = Object.fromEntries(dupes.map((x) => [x.selector, x.count]));
  assert.equal(byselector.header, 2, 'the duplicated top bar is exactly what Dean described');
  assert.equal(byselector['#menu-toggle'], 2);
  assert.ok(!('#bottom-nav' in byselector), 'a unique element is not reported');
});

test('the watched selectors cover shell chrome only, never #view-root contents', () => {
  // #view-root's contents are legitimately rebuilt on every SPA swap, so
  // watching them would produce constant false positives and make the
  // instrument useless exactly when it matters.
  assert.ok(SHELL_SINGLETON_SELECTORS.includes('header'), 'the reported surface must be watched');
  assert.ok(SHELL_SINGLETON_SELECTORS.includes('#bottom-nav'));
  assert.ok(!SHELL_SINGLETON_SELECTORS.some((s) => s.includes('view-root')));
  assert.ok(!SHELL_SINGLETON_SELECTORS.some((s) => s.includes('video-grid')));
});

// ---- opt-in posture --------------------------------------------------------

test('the instrument is OPT-IN and completely inert without ?debugUI=1', () => {
  const fn = COMMON.slice(COMMON.indexOf('function wireShellSingletonDebug()'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /debugUI'\) === '1'/, 'gated on the query flag');
  assert.match(body, /if \(!enabled\) return false;/,
    'it must bail BEFORE observing anything -- no timers/listeners on a normal load');
  const bailIdx = body.indexOf('if (!enabled) return false;');
  assert.ok(bailIdx < body.indexOf('MutationObserver'),
    'the MutationObserver must never be constructed on a normal load');
  // console.warn, not error: a breadcrumb to screenshot, never something that
  // trips an error-reporting path.
  assert.match(body, /console\.warn/);
  assert.doesNotMatch(body, /console\.error/);
});

test('a malformed query string cannot break page boot', () => {
  const fn = COMMON.slice(COMMON.indexOf('function wireShellSingletonDebug()'));
  assert.match(fn.slice(0, 900), /catch \(_\) \{\s*return false;/,
    'URLSearchParams failure must disable the instrument, never throw during boot');
});
