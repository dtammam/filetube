'use strict';

// [UNIT] v1.151: Stats is now a registered SPA route, so the mini-player
// survives navigating to it (it no longer full-page-reloads). This binds the
// routed-view contract BEHAVIOURALLY, not by presence:
//   1. stats.js registers { init, destroy } under the name 'stats'.
//   2. init() fires the three /api/* fetches with an AbortSignal.
//   3. destroy() (the navigate-away teardown) ABORTS those in-flight fetches
//      so a late resolution never renders into a replaced #view-root.
// Mutating out either `{ signal }` (fetch arg) or the abort in destroy() turns
// this red.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const STATS = require.resolve('../../public/js/stats.js');

// The container ids the dashboard shell ships (mirrors stats.html) - so init's
// seedStatsSkeleton()/getElementById calls find their targets.
const ALL_IDS = [
  'stats-glance-grid', 'stats-by-type', 'stats-folder-list', 'stats-channel-list',
  'stats-records-grid', 'stats-most-watched-list', 'stats-books-grid',
  'stats-books-folder-list', 'stats-duplicates-list', 'stats-inventory-list', 'stats-about',
];

// Load stats.js into a jsdom that provides FileTube.registerView (so the
// module registers on require) and a fetch stub that records each call's
// AbortSignal and never resolves (so the fetches stay "in flight" for destroy).
function loadRoutedStats() {
  const origFetch = global.fetch;
  const origWindow = global.window;
  const origDocument = global.document;

  const dom = new JSDOM(
    '<!DOCTYPE html><body>' + ALL_IDS.map((id) => `<div id="${id}"></div>`).join('') + '</body>',
    { url: 'http://localhost/stats.html' });

  const captured = {};
  dom.window.FileTube = { registerView: (name, handlers) => { captured[name] = handlers; } };

  const signals = [];
  const urls = [];
  const fetchStub = (url, opts) => { urls.push(url); signals.push(opts && opts.signal); return new Promise(() => {}); };
  dom.window.fetch = fetchStub;
  global.fetch = fetchStub;
  global.window = dom.window;
  global.document = dom.window.document;

  delete require.cache[STATS];
  require(STATS); // registers via the injected registerView; does NOT fetch (no init yet)

  const restore = () => {
    global.fetch = origFetch;
    global.window = origWindow;
    global.document = origDocument;
    delete require.cache[STATS];
    dom.window.close();
  };
  return { dom, captured, signals, urls, restore };
}

test('stats.js registers a routed view with init + destroy', () => {
  const { captured, restore } = loadRoutedStats();
  try {
    assert.ok(captured.stats, 'registerView was called with name "stats"');
    assert.strictEqual(typeof captured.stats.init, 'function', 'exposes init()');
    assert.strictEqual(typeof captured.stats.destroy, 'function', 'exposes destroy()');
  } finally {
    restore();
  }
});

test('init() fires all three fetches with a live (un-aborted) AbortSignal', () => {
  const { dom, captured, signals, urls, restore } = loadRoutedStats();
  try {
    captured.stats.init(dom.window.document.body);
    assert.ok(urls.includes('/api/stats'), 'fetched /api/stats');
    assert.ok(urls.includes('/api/duplicates'), 'fetched /api/duplicates');
    assert.ok(urls.includes('/api/library-items'), 'fetched /api/library-items (v1.159 A/V table)');
    assert.strictEqual(signals.length, 3, 'exactly the three dashboard fetches fired');
    for (const s of signals) {
      assert.ok(s && typeof s.aborted === 'boolean', 'each fetch carried an AbortSignal (the { signal } arg)');
      assert.strictEqual(s.aborted, false, 'signal is live while the view is mounted');
    }
  } finally {
    restore();
  }
});

test('destroy() aborts all in-flight fetches (navigate-away cancels stale renders)', () => {
  const { dom, captured, signals, restore } = loadRoutedStats();
  try {
    captured.stats.init(dom.window.document.body);
    assert.strictEqual(signals.every((s) => s && s.aborted === false), true, 'live before teardown');
    captured.stats.destroy();
    assert.strictEqual(signals.length, 3, 'still the same three signals');
    for (const s of signals) {
      assert.strictEqual(s.aborted, true, 'destroy() aborted the fetch so a late resolve cannot render into a replaced #view-root');
    }
  } finally {
    restore();
  }
});

test('a fresh init() after destroy() gets its own live controller (re-entering Stats)', () => {
  const { dom, captured, signals, restore } = loadRoutedStats();
  try {
    captured.stats.init(dom.window.document.body);
    captured.stats.destroy();
    captured.stats.init(dom.window.document.body); // navigate back into Stats
    // signals 0/1/2 aborted (first mount), 3/4/5 live (second mount)
    assert.strictEqual(signals.length, 6, 'second mount fired its own three fetches');
    assert.strictEqual(signals[3].aborted, false, 'second controller is live, not the aborted first');
    assert.strictEqual(signals[0].aborted, true, 'the first mount\'s controller stays aborted');
  } finally {
    restore();
  }
});

// The CLEAR/error axis of the AbortController (the reveal-once-has-two-axes
// lesson): after destroy(), a fetch that rejects with AbortError must be
// SWALLOWED - never rendered as an error into the (now replaced) tree. Deleting
// the `err.name === 'AbortError'` early-returns in stats.js turns this red
// (renderStatsError paints "Could not load stats" into the detached document).
test('an AbortError-rejecting fetch after destroy() is swallowed, not rendered as an error', async () => {
  const origFetch = global.fetch;
  const origWindow = global.window;
  const origDocument = global.document;

  const dom = new JSDOM(
    '<!DOCTYPE html><body>' + ALL_IDS.map((id) => `<div id="${id}"></div>`).join('') + '</body>',
    { url: 'http://localhost/stats.html' });

  const captured = {};
  dom.window.FileTube = { registerView: (name, handlers) => { captured[name] = handlers; } };

  const rejecters = [];
  const fetchStub = () => new Promise((_resolve, reject) => {
    rejecters.push(() => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e); });
  });
  dom.window.fetch = fetchStub;
  global.fetch = fetchStub;
  global.window = dom.window;
  global.document = dom.window.document;

  delete require.cache[STATS];
  require(STATS);

  try {
    captured.stats.init(dom.window.document.body);
    captured.stats.destroy();
    rejecters.forEach((r) => r());                       // both fetches now reject with AbortError, post-teardown
    await new Promise((r) => setImmediate(r));            // flush the .catch microtasks
    assert.doesNotMatch(
      dom.window.document.getElementById('stats-glance-grid').textContent, /Could not load stats/,
      'a post-destroy AbortError must NOT paint the /api/stats error into the replaced tree');
    assert.doesNotMatch(
      dom.window.document.getElementById('stats-duplicates-list').textContent, /Could not load the duplicates/,
      'a post-destroy AbortError must NOT paint the /api/duplicates error either');
  } finally {
    global.fetch = origFetch;
    global.window = origWindow;
    global.document = origDocument;
    delete require.cache[STATS];
    dom.window.close();
  }
});
