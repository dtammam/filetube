'use strict';

// [INTEGRATION] v1.63.1 slim-gate CRITICAL binding: the stars pref's
// cross-device seed (pullMirroredDisplayPrefs in public/js/common.js).
//
// The gate's jsdom repro proved the first cut's seed was DEAD CODE on any
// theme-customized device: the "fully chosen locally" early return
// (era+mode+icons) did not include the stars pref, so a device with the
// trio set - i.e. every one of Dean's devices - returned before /api/auth/me
// was ever fetched. This suite binds BOTH halves of the fix and kills the
// gate's surviving mutant H (deleting the entire seed block was green
// across 5365 tests): (1) a trio-set device with no local stars pref MUST
// still fetch and apply the server's 'hidden'; (2) the seed path must
// never write back to the mirror (the write-loop guard).
//
// Harness: the shell-smoke posture - jsdom for the DOM, the REAL committed
// common.js evaluated via vm in the window context, fetch stubbed at the
// platform seam.

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const COMMON_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');
// v1.77: every shell loads glyph-pool.js immediately BEFORE common.js, and
// common.js consumes its exports as globals. This harness evaluates the real
// committed sources, so it evaluates both, in that order - anything less would
// be testing a script-loading arrangement no browser ever sees.
const GLYPH_POOL_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'glyph-pool.js'), 'utf8');

// Every jsdom window this harness news up is tracked and closed after the
// file's tests run. WHY this is load-bearing (v1.78): booting the real
// common.js fires its DOMContentLoaded handler, which now starts the device-
// handoff card's 30s poll setInterval. jsdom's setInterval returns a plain
// number with no unref(), and only window.close() clears it - so a harness
// that never closes leaves that timer live, the test process's event loop
// never drains, and under the parallel runner the worker never goes idle and
// the WHOLE suite hangs (this file was the deterministic culprit). shell-smoke
// already closes each window for the same reason; this harness had not, back
// when boot started no persistent timers.
const openWindows = [];
after(() => {
  for (const w of openWindows) {
    try { w.close(); } catch (_) { /* best-effort teardown */ }
  }
});

function bootHarness({ localPrefs, serverSettings, body }) {
  // `body` (default empty, so no existing test moves) lets a test assert the
  // boot sequence's EFFECT on real DOM rather than its network shape.
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body || ''}</body></html>`, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  for (const [k, v] of Object.entries(localPrefs)) w.localStorage.setItem(k, v);
  const fetchLog = [];
  w.fetch = (url, opts) => {
    fetchLog.push({ url: String(url), method: (opts && opts.method) || 'GET' });
    if (String(url).includes('/api/auth/me')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ settings: serverSettings }) });
    }
    // Everything else (badge probes, queue, logo...) quietly fails - the
    // injectors under test here are only the display-pref machinery.
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  };
  vm.createContext(w);
  vm.runInContext(GLYPH_POOL_SRC, w, { filename: 'glyph-pool.js' });
  vm.runInContext(COMMON_SRC, w, { filename: 'common.js' });
  openWindows.push(w); // closed in the after() hook - see its comment
  return { w, fetchLog };
}

const flush = () => new Promise((r) => setTimeout(r, 50));

test('CRITICAL binding: a theme-customized device (trio set) STILL seeds the stars pref from the server', async () => {
  const { w, fetchLog } = bootHarness({
    localPrefs: { 'ft-era': '2014', 'ft-mode': 'dark', 'ft-icons': 'filled' },
    serverSettings: { starRatings: 'hidden' },
  });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  await flush();
  assert.ok(fetchLog.some((f) => f.url.includes('/api/auth/me')), 'the pull must reach /api/auth/me despite the trio being locally chosen (the dead-seed bug)');
  assert.ok(w.document.documentElement.classList.contains('ft-hide-stars'), 'the server pref applied');
  assert.equal(w.localStorage.getItem('ft-star-ratings'), 'hidden', 'seed persisted locally');
  assert.ok(!fetchLog.some((f) => f.url.includes('/api/me/settings')), 'the seed NEVER writes back to the mirror (write-loop guard)');
  // v1.77 (QA gate S1): THIS is the genuine two-consumer scenario - the pull
  // proceeds past the early return AND initLibraryGlyphs runs, so both of
  // common.js's boot consumers want the user record. Exactly one request is
  // what fetchCurrentUser's memoization buys; two would be a real regression.
  // Asserted here rather than in the fully-chosen test below, where the pull
  // short-circuits and never calls fetchCurrentUser at all - there the count
  // measures the harness's boot, not the memo.
  assert.equal(fetchLog.filter((f) => f.url.includes('/api/auth/me')).length, 1,
    'both boot consumers must share ONE /api/auth/me, not take one each');
});

test('a locally-chosen stars pref is never overridden by the server (locally-unchosen-only rule)', async () => {
  // Gate W-B: ft-icons is deliberately ABSENT so the pull PROCEEDS past
  // the early return and the seed's own !hasStars guard is what must
  // gate - with all four set, this test would vacuously bind the early
  // return twice and the guard-dropped mutant survived the full suite.
  const { w } = bootHarness({
    localPrefs: { 'ft-era': '2014', 'ft-mode': 'dark', 'ft-star-ratings': 'shown' },
    serverSettings: { starRatings: 'hidden' },
  });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  await flush();
  assert.ok(!w.document.documentElement.classList.contains('ft-hide-stars'), 'the local choice wins');
  assert.equal(w.localStorage.getItem('ft-star-ratings'), 'shown');
});

test('with ALL prefs locally chosen the seed pull short-circuits (local prefs win, nothing is re-applied)', async () => {
  // v1.77: this used to assert boot made NO /api/auth/me request at all. That
  // invariant is genuinely retired, not broken: v1.77 adds per-user Library
  // glyphs, which are SERVER-TRUTH by ruling and so have no device cache to
  // short-circuit against - something must ask the server on every load.
  //
  // What the early return actually protects is unchanged and still bound here:
  // a fully-chosen device must not have its local prefs overwritten by the
  // server's, and must never write back to the mirror. The request itself is
  // now memoized (fetchCurrentUser), so boot makes exactly ONE regardless of
  // how many consumers want it - asserted below, because two would be a real
  // regression.
  const { w, fetchLog } = bootHarness({
    localPrefs: { 'ft-era': '2014', 'ft-mode': 'dark', 'ft-icons': 'filled', 'ft-star-ratings': 'hidden' },
    serverSettings: { starRatings: 'shown' },
  });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  await flush();
  assert.ok(w.document.documentElement.classList.contains('ft-hide-stars'),
    'the LOCAL pref stands - the server\'s "shown" must not override it');
  assert.equal(w.localStorage.getItem('ft-star-ratings'), 'hidden');
  assert.ok(!fetchLog.some((f) => f.url.includes('/api/me/settings')),
    'and the seed never writes back to the mirror (the write-loop guard)');
  // NOTE (QA gate S1): no /api/auth/me COUNT is asserted here. In this scenario
  // the pull short-circuits and never calls fetchCurrentUser, so only
  // initLibraryGlyphs fetches - and the harness's jsdom fires its own
  // DOMContentLoaded on top of the manual dispatch, so any count here measures
  // the double boot rather than the memo. The memoization claim is bound in the
  // first test above, which is the real two-consumer case.
});

// ---- v1.77 (adversarial gate round 2, W1): bind the boot EFFECT -------------
//
// A regression this wave INTRODUCED, and a lesson about adopting prescriptions.
//
// Round 1 of the QA gate correctly pointed out that the `/api/auth/me` count in
// the fully-chosen test was measuring the harness's double boot rather than the
// memo, and prescribed moving it to the trio-set test. I did - and traded away
// the only thing binding `initLibraryGlyphs()` at boot. In the fully-chosen
// scenario the pull short-circuits, so the count only ever reached 1 if
// initLibraryGlyphs ran; in the trio-set scenario the pull fetches too, so the
// count is 1 whether or not it is ever called. The prescription was right about
// what the assertion CLAIMED and silent about what it happened to CATCH.
//
// The surviving mutant is the wave's headline feature dead: comment out the
// boot call and per-user Library glyphs never paint on any page, on any load,
// with the full suite green. It would even look correct where you would check
// it by hand - the Settings editor repaints itself on change.
//
// So this binds the effect: real committed sources, real DOM, real boot.
test('BOOT EFFECT: initLibraryGlyphs paints the per-user Library glyphs at boot', async () => {
  const { w } = bootHarness({
    localPrefs: {},
    serverSettings: { glyphBooks: 'school' },
    body: '<a data-nav-sidebar="books" href="/books"><i class="icon-books"></i> Books</a>' +
          '<a data-nav="books" href="/books"><i class="icon-books"></i></a>',
  });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  await flush();
  assert.equal(w.document.querySelector('[data-nav-sidebar="books"] i').className, 'icon-school',
    'the sidebar Library entry must be repainted by the boot sequence');
  assert.equal(w.document.querySelector('[data-nav="books"] i').className, 'icon-school',
    'and so must its bottom-bar twin');
});

test('BOOT EFFECT: an untouched user record leaves every Library glyph alone', async () => {
  const { w } = bootHarness({
    localPrefs: {},
    serverSettings: {},
    body: '<a data-nav-sidebar="books" href="/books"><i class="icon-books"></i> Books</a>',
  });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  await flush();
  assert.equal(w.document.querySelector('[data-nav-sidebar="books"] i').className, 'icon-books');
});
