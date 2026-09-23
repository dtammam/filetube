// v1.316 (Dean, B1): the /subscriptions row bell toggles WITHOUT a page refresh.
//
// v1.314's toggleBell did `PATCH` then `loadSubscriptions()` - which cleared the
// list, painted skeleton rows, re-fetched `/api/subscriptions` and rebuilt every
// row. That is the "refresh" Dean saw on every tap. The fix updates the clicked
// row IN PLACE from the PATCH response (the ~2.5s poll's `applyStatusUpdatesInPlace`
// posture, keyed by `data-sub-id`).
//
// `toggleBell` is closure-internal to initSubscriptionsView, so this mounts the
// real subscriptions.html in jsdom (the subscriptions-panels-behavior.test.js
// driver), routes `fetch` through a recording spy, and drives real clicks on the
// real bell. The assertions are the acceptance rows of
// docs/exec-plans/active/2026-09-23-sub-bell-polish.md (AC1, AC2):
//   - exactly one PATCH, and ZERO `/api/subscriptions` list fetches after load;
//   - the row ELEMENT identity is unchanged across the toggle (no rebuild);
//   - the glyph / -active class / aria follow the RESPONSE, not the request
//     (the gate's "echoing fake route" lesson: the route answers with a value
//     that DIFFERS from the request, so a label-follows-request lookalike is red);
//   - the second tap sends the flipped value (the record was patched);
//   - a 403 leaves the row byte-identical, logs once, and issues no list fetch.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SUBS_HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'),
  'utf8',
);
const SUBS_PATH = require.resolve('../../lib/ytdlp/client/subscriptions.js');

const SUBS = [
  { id: 's1', name: 'Alpha Channel', channelUrl: 'https://www.youtube.com/@alpha', pushBell: false },
  { id: 's2', name: 'Bravo Channel', channelUrl: 'https://www.youtube.com/@bravo', pushBell: true },
];

const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

// Mounts the real view. `route(method, url, body)` answers the PATCH; every
// other endpoint resolves to a harmless empty shape (the panels-test posture).
function mountView(route) {
  const dom = new JSDOM(SUBS_HTML, { url: 'http://localhost/subscriptions' });
  const { window } = dom;
  const { document } = window;
  const calls = [];
  const fetchSpy = (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const body = opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push({ method, url: String(url), body });
    if (method === 'GET' && String(url) === '/api/subscriptions') {
      return Promise.resolve(jsonRes(200, SUBS.map((s) => ({ ...s }))));
    }
    if (method === 'PATCH') return Promise.resolve(route(method, String(url), body));
    return Promise.resolve(jsonRes(200, []));
  };
  const openOverlay = (el, cls) => { if (el && el.classList) el.classList.add(cls); };
  const closeOverlayThen = (el, cls, after) => { if (el && el.classList) el.classList.remove(cls); if (typeof after === 'function') after(); };

  // The row builder reaches for common.js's avatar helpers as page globals
  // (subscriptions.js runs after common.js on the real shell).
  const common = require('../../public/js/common.js');
  global.resolveAvatarSource = common.resolveAvatarSource;
  global.deriveAvatar = common.deriveAvatar;
  global.window = window;
  global.document = document;
  global.localStorage = window.localStorage;
  global.navigator = window.navigator;
  global.AbortController = window.AbortController;
  global.openOverlay = openOverlay;
  global.closeOverlayThen = closeOverlayThen;
  global.fetch = fetchSpy;
  window.openOverlay = openOverlay;
  window.closeOverlayThen = closeOverlayThen;
  window.fetch = fetchSpy;

  let captured = null;
  window.FileTube = {
    registerView: (name, handlers) => { if (name === 'subscriptions') captured = handlers; },
    navigate: () => {},
  };
  delete require.cache[SUBS_PATH];
  require(SUBS_PATH);
  assert.ok(captured && typeof captured.init === 'function', 'subscriptions.js must self-register an init');
  captured.init(document.getElementById('view-root'));
  return { window, document, handlers: captured, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(pred, label) {
  for (let i = 0; i < 50; i++) {
    if (pred()) return;
    await tick();
  }
  assert.fail(`timed out waiting for: ${label}`);
}
const rowOf = (document, id) => document.querySelector(`.sub-row[data-sub-id="${id}"]`);
const bellOf = (row) => row.querySelector('.sub-row-bell');
const listFetches = (calls) => calls.filter((c) => c.method === 'GET' && c.url === '/api/subscriptions').length;
const patches = (calls) => calls.filter((c) => c.method === 'PATCH');
const click = (window, el) => el.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));

test('AC1: a bell tap = ONE PATCH, NO list re-fetch, the SAME row element, and the glyph/class/aria follow the RESPONSE', async () => {
  // The route answers pushBell:true for a request of true - the honest case.
  const { window, document, handlers, calls } = mountView((m, url, body) => {
    assert.strictEqual(url, '/api/subscriptions/s1');
    return jsonRes(200, { id: 's1', name: 'Alpha Channel', pushBell: body.pushBell });
  });
  try {
    await settle(() => !!rowOf(document, 's1'), 'the initial list render');
    const loadsBefore = listFetches(calls);
    assert.strictEqual(loadsBefore, 1, 'the initial load is the only list fetch so far');
    const rowBefore = rowOf(document, 's1');
    const bell = bellOf(rowBefore);
    assert.ok(bell, 'the row has a bell');
    assert.strictEqual(bell.className, 'btn btn-chip sub-row-bell');
    assert.strictEqual(bell.textContent, '🔕');

    click(window, bell);
    await settle(() => patches(calls).length === 1 && bell.textContent === '🔔', 'the in-place update after the PATCH');

    assert.strictEqual(patches(calls).length, 1, 'exactly one PATCH');
    assert.deepStrictEqual(patches(calls)[0].body, { pushBell: true });
    assert.strictEqual(listFetches(calls), loadsBefore, 'NO /api/subscriptions re-fetch after the toggle (that was the page refresh)');
    assert.strictEqual(rowOf(document, 's1'), rowBefore, 'the row element identity survives the toggle (no rebuild)');
    assert.strictEqual(bellOf(rowBefore), bell, 'the bell element identity survives too');
    assert.strictEqual(bell.className, 'btn btn-chip sub-row-bell sub-row-bell-active');
    assert.strictEqual(bell.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(bell.getAttribute('aria-label'), 'Push notifications on for this channel - turn off');
    assert.strictEqual(bell.disabled, false, 're-enabled after the flight');
    assert.strictEqual(document.querySelectorAll('.sub-row-skeleton, .skeleton-row').length, 0, 'no skeleton rows were painted');

    // The record was patched: the SECOND tap sends the flipped value.
    click(window, bell);
    await settle(() => patches(calls).length === 2 && bell.textContent === '🔕', 'the second toggle');
    assert.deepStrictEqual(patches(calls)[1].body, { pushBell: false }, 'the next tap reads the patched record');
    assert.strictEqual(bell.className, 'btn btn-chip sub-row-bell');
    assert.strictEqual(listFetches(calls), loadsBefore, 'still no list re-fetch');
    // The other row is untouched.
    assert.strictEqual(bellOf(rowOf(document, 's2')).textContent, '🔔');
  } finally {
    handlers.destroy();
  }
});

test('AC1 (anti-echo): the glyph follows the RESPONSE - a route that answers pushBell:false to a request of true leaves the bell OFF and the record off', async () => {
  const { window, document, handlers, calls } = mountView(() => jsonRes(200, { id: 's1', pushBell: false }));
  try {
    await settle(() => !!rowOf(document, 's1'), 'the initial list render');
    const bell = bellOf(rowOf(document, 's1'));
    click(window, bell);
    await settle(() => patches(calls).length === 1 && bell.disabled === false, 'the PATCH round trip');
    await tick();
    assert.deepStrictEqual(patches(calls)[0].body, { pushBell: true }, 'the request asked for on');
    assert.strictEqual(bell.textContent, '🔕', 'the RESPONSE said off - the glyph stays off');
    assert.strictEqual(bell.className, 'btn btn-chip sub-row-bell');
    assert.strictEqual(bell.getAttribute('aria-pressed'), 'false');
    // and the record followed the response too: the next tap asks for on AGAIN
    click(window, bell);
    await settle(() => patches(calls).length === 2, 'the second PATCH');
    assert.deepStrictEqual(patches(calls)[1].body, { pushBell: true });
    assert.strictEqual(listFetches(calls), 1);
  } finally {
    handlers.destroy();
  }
});

test('AC2: a 403 leaves the row byte-identical (class/aria/glyph/identity), logs once, and issues NO list fetch', async () => {
  const { window, document, handlers, calls } = mountView(() => jsonRes(403, { error: 'Forbidden: manage-subscriptions required' }));
  const errors = [];
  const origError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); };
  try {
    await settle(() => !!rowOf(document, 's2'), 'the initial list render');
    const row = rowOf(document, 's2');
    const bell = bellOf(row);
    const snapshot = { cls: bell.className, label: bell.getAttribute('aria-label'), pressed: bell.getAttribute('aria-pressed'), glyph: bell.textContent };
    assert.strictEqual(snapshot.glyph, '🔔', 's2 starts ON');
    click(window, bell);
    await settle(() => patches(calls).length === 1 && errors.length === 1 && bell.disabled === false, 'the failed round trip');
    await tick();
    assert.strictEqual(rowOf(document, 's2'), row, 'row identity unchanged');
    assert.strictEqual(bellOf(row), bell, 'bell identity unchanged');
    assert.deepStrictEqual({ cls: bell.className, label: bell.getAttribute('aria-label'), pressed: bell.getAttribute('aria-pressed'), glyph: bell.textContent }, snapshot, 'the row is exactly as it was');
    assert.strictEqual(errors.length, 1, 'logged exactly once');
    assert.match(errors[0], /Forbidden: manage-subscriptions required/, 'the server\'s own error text is surfaced');
    assert.strictEqual(listFetches(calls), 1, 'no list re-fetch on failure either');
    // the record was NOT patched: the next tap asks for the same flip again
    click(window, bell);
    await settle(() => patches(calls).length === 2, 'the second PATCH');
    assert.deepStrictEqual(patches(calls)[1].body, { pushBell: false });
  } finally {
    console.error = origError;
    handlers.destroy();
  }
});

test('applyBellUpdateInPlace: keyed by id through rowElementsById; a missing row or bell is a no-op that returns false', () => {
  delete require.cache[SUBS_PATH];
  const { applyBellUpdateInPlace, applyBellState, findBellButton } = require(SUBS_PATH);
  const dom = new JSDOM('<div class="sub-row" data-sub-id="x"><span class="sub-row-info"></span><button class="btn btn-chip sub-row-bell"></button></div>');
  const row = dom.window.document.querySelector('.sub-row');
  const bell = row.querySelector('.sub-row-bell');
  applyBellState(bell, false);
  assert.strictEqual(bell.textContent, '🔕');
  assert.strictEqual(applyBellUpdateInPlace({ x: row }, 'x', true), true);
  assert.strictEqual(bell.className, 'btn btn-chip sub-row-bell sub-row-bell-active');
  assert.strictEqual(bell.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(applyBellUpdateInPlace({ x: row }, 'x', 'true'), true, 'a non-boolean truthy is OFF (the record\'s boolean truth)');
  assert.strictEqual(bell.textContent, '🔕');
  assert.strictEqual(applyBellUpdateInPlace({ x: row }, 'missing', true), false, 'unknown id -> no-op');
  assert.strictEqual(applyBellUpdateInPlace({}, 'x', true), false, 'no row -> no-op');
  assert.strictEqual(applyBellUpdateInPlace(null, 'x', true), false);
  const noBell = new JSDOM('<div class="sub-row"><span class="sub-row-info"></span></div>').window.document.querySelector('.sub-row');
  assert.strictEqual(applyBellUpdateInPlace({ y: noBell }, 'y', true), false, 'a row without a bell -> no-op');
  assert.strictEqual(findBellButton(null), null);
});
