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

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const COMMON_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');

function bootHarness({ localPrefs, serverSettings }) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
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
  vm.runInContext(COMMON_SRC, w, { filename: 'common.js' });
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

test('with ALL prefs locally chosen the pull short-circuits (no fetch at all - the early return, now stars-inclusive)', async () => {
  const { w, fetchLog } = bootHarness({
    localPrefs: { 'ft-era': '2014', 'ft-mode': 'dark', 'ft-icons': 'filled', 'ft-star-ratings': 'hidden' },
    serverSettings: { starRatings: 'shown' },
  });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  await flush();
  assert.ok(!fetchLog.some((f) => f.url.includes('/api/auth/me')), 'fully-chosen device skips the pull entirely');
  assert.ok(w.document.documentElement.classList.contains('ft-hide-stars'), 'boot applied the local pref');
});
