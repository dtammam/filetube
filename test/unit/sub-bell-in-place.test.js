// v1.316 (Dean, B1): the /subscriptions row bell toggles WITHOUT a page refresh.
//
// v1.314's toggleBell did `PATCH` then `loadSubscriptions()` - which cleared the
// list, painted skeleton rows, re-fetched `/api/subscriptions` and rebuilt every
// row. That is the "refresh" Dean saw on every tap. The fix updates the clicked
// row IN PLACE from the PATCH response (the ~2.5s poll's `applyStatusUpdatesInPlace`
// posture, keyed by `data-sub-id`).
//
// `toggleBell` is closure-internal to initSubscriptionsView, so this mounts the
// real subscriptions.html in jsdom with the real ui.js
// (test/helpers/subs-view-harness.js), routes `fetch` through a recording spy, and
// drives real clicks on the real bell. UI pass S5: the bell is a ui-btn icon
// toggle - its state is aria-pressed + the sprite glyph (notifications_active /
// notifications_off, F32), read back through `glyph()` below. The assertions are the acceptance rows of
// docs/exec-plans/completed/2026-09-23-sub-bell-polish.md (AC1, AC2):
//   - exactly one PATCH, and ZERO `/api/subscriptions` list fetches after load;
//   - the row ELEMENT identity is unchanged across the toggle (no rebuild);
//   - the glyph / -active class / aria follow the RESPONSE, not the request
//     (the gate's "echoing fake route" lesson: the route answers with a value
//     that DIFFERS from the request, so a label-follows-request lookalike is red);
//   - the second tap sends the flipped value (the record was patched);
//   - a 403 leaves the row byte-identical, logs once, and issues no list fetch.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { mountSubsView, jsonRes, tick, settle, click } = require('../helpers/subs-view-harness');

const SUBS_PATH = require.resolve('../../lib/ytdlp/client/subscriptions.js');
const SUBS = [
  { id: 's1', name: 'Alpha Channel', channelUrl: 'https://www.youtube.com/@alpha', pushBell: false },
  { id: 's2', name: 'Bravo Channel', channelUrl: 'https://www.youtube.com/@bravo', pushBell: true },
];

// Every GET /api/subscriptions answers the list; a PATCH goes to `route`.
function mountView(route) {
  return mountSubsView((method, url, body) => {
    if (method === 'GET' && url === '/api/subscriptions') return jsonRes(200, SUBS.map((x) => ({ ...x })));
    if (method === 'PATCH') return route(method, url, body);
    return undefined;
  });
}

const rowOf = (document, id) => document.querySelector(`.ui-row[data-sub-id="${id}"]`);
const bellOf = (row) => row.querySelector('.subs-bell');
// the drawn glyph: 'bell' (notifications_active) or 'bellOff' (notifications_off)
const glyph = (bell) => {
  const href = bell.querySelector('.ui-btn__icon use').getAttribute('href');
  if (href === '#i-notifications_active') return 'bell';
  if (href === '#i-notifications_off') return 'bellOff';
  return href;
};
const listFetches = (calls) => calls.filter((c) => c.method === 'GET' && c.url === '/api/subscriptions').length;
const patches = (calls) => calls.filter((c) => c.method === 'PATCH');

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
    assert.match(bell.className, /\bui-btn--plain\b.*\bui-btn--icon\b.*\bsubs-bell\b/, 'a plain icon ui-btn');
    assert.strictEqual(glyph(bell), 'bellOff');
    assert.strictEqual(bell.getAttribute('aria-pressed'), 'false');

    click(window, bell);
    // Gate r1 (adversary ME/ME2): the in-flight disable is bound HERE, before the
    // response lands. (Do NOT bind it by double-dispatching clicks and counting
    // PATCHes - jsdom delivers synthetic clicks to disabled buttons.)
    assert.strictEqual(bell.disabled, true, 'the bell is disabled for the flight');
    await settle(() => patches(calls).length === 1 && glyph(bell) === 'bell', 'the in-place update after the PATCH');

    assert.strictEqual(patches(calls).length, 1, 'exactly one PATCH');
    assert.deepStrictEqual(patches(calls)[0].body, { pushBell: true });
    assert.strictEqual(listFetches(calls), loadsBefore, 'NO /api/subscriptions re-fetch after the toggle (that was the page refresh)');
    assert.strictEqual(rowOf(document, 's1'), rowBefore, 'the row element identity survives the toggle (no rebuild)');
    assert.strictEqual(bellOf(rowBefore), bell, 'the bell element identity survives too');
    assert.strictEqual(glyph(bell), 'bell');
    assert.strictEqual(bell.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(bell.getAttribute('aria-label'), 'Notify me about new videos from Alpha Channel', 'a toggle keeps ONE name; aria-pressed carries the state');
    assert.strictEqual(bell.disabled, false, 're-enabled after the flight');
    // (The row/bell identity asserts above are what bind "no rebuild" - a
    // "no skeleton rows" check here is timing-vacuous, gate r1 adversary #4.)

    // The record was patched: the SECOND tap sends the flipped value.
    click(window, bell);
    await settle(() => patches(calls).length === 2 && glyph(bell) === 'bellOff', 'the second toggle');
    assert.deepStrictEqual(patches(calls)[1].body, { pushBell: false }, 'the next tap reads the patched record');
    assert.strictEqual(bell.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(listFetches(calls), loadsBefore, 'still no list re-fetch');
    // The other row is untouched.
    assert.strictEqual(glyph(bellOf(rowOf(document, 's2'))), 'bell');
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
    assert.strictEqual(glyph(bell), 'bellOff', 'the RESPONSE said off - the glyph stays off');
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
    const snapshot = { cls: bell.className, label: bell.getAttribute('aria-label'), pressed: bell.getAttribute('aria-pressed'), glyph: glyph(bell), svg: bell.innerHTML };
    assert.strictEqual(snapshot.glyph, 'bell', 's2 starts ON');
    click(window, bell);
    await settle(() => patches(calls).length === 1 && errors.length === 1 && bell.disabled === false, 'the failed round trip');
    await tick();
    assert.strictEqual(rowOf(document, 's2'), row, 'row identity unchanged');
    assert.strictEqual(bellOf(row), bell, 'bell identity unchanged');
    assert.deepStrictEqual({ cls: bell.className, label: bell.getAttribute('aria-label'), pressed: bell.getAttribute('aria-pressed'), glyph: glyph(bell), svg: bell.innerHTML }, snapshot, 'the row is exactly as it was');
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

test('AC7 (gate r1 adversary MB): a list rebuild MID-FLIGHT (Pause -> loadSubscriptions) - the response lands on the NEW row and the NEW record, so the next tap sends the flipped value', async () => {
  // The bell PATCH is held open; the pause PATCH answers at once (togglePause
  // then reloads the list, rebuilding every row from fresh server objects).
  let releaseBell = null;
  const { window, document, handlers, calls } = mountView((m, url, body) => {
    if (body && Object.prototype.hasOwnProperty.call(body, 'pushBell')) {
      return new Promise((resolve) => { releaseBell = () => resolve(jsonRes(200, { id: 's1', pushBell: body.pushBell })); });
    }
    return jsonRes(200, { id: 's1', paused: true });
  });
  try {
    await settle(() => !!rowOf(document, 's1'), 'the initial list render');
    const oldRow = rowOf(document, 's1');
    const oldBell = bellOf(oldRow);
    click(window, oldBell);
    await settle(() => patches(calls).length === 1 && typeof releaseBell === 'function', 'the bell PATCH is in flight');

    // Mid-flight: open the row's settings sheet (a row tap) and Pause -> the list reloads.
    click(window, oldRow.querySelector('.ui-row__link'));
    const pauseBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Pause');
    assert.ok(pauseBtn, 'the settings sheet offers Pause');
    click(window, pauseBtn);
    await settle(() => listFetches(calls) === 2 && rowOf(document, 's1') && rowOf(document, 's1') !== oldRow, 'the list was rebuilt after Pause');
    const newRow = rowOf(document, 's1');
    const newBell = bellOf(newRow);
    assert.notStrictEqual(newBell, oldBell, 'a fresh bell was built');
    assert.strictEqual(glyph(newBell), 'bellOff', 'rebuilt from the server list (still off)');

    // Now the bell response lands: the NEW row flips, the NEW record is patched.
    releaseBell();
    await settle(() => glyph(newBell) === 'bell', 'the in-place update lands on the rebuilt row');
    assert.strictEqual(rowOf(document, 's1'), newRow, 'no further rebuild');
    assert.strictEqual(newBell.getAttribute('aria-pressed'), 'true');
    click(window, newBell);
    await settle(() => patches(calls).filter((p) => p.body && 'pushBell' in p.body).length === 2, 'the next bell PATCH');
    const bellPatches = patches(calls).filter((p) => p.body && 'pushBell' in p.body);
    assert.deepStrictEqual(bellPatches[1].body, { pushBell: false }, 'the rebuilt record carries the response state, so the next tap flips it OFF');
  } finally {
    handlers.destroy();
  }
});

test('applyBellUpdateInPlace: keyed by id through rowElementsById; a missing row or bell is a no-op that returns false', () => {
  delete require.cache[SUBS_PATH];
  const { applyBellUpdateInPlace, applyBellState, findBellButton } = require(SUBS_PATH);
  const ui = require('../../public/js/ui.js');
  const doc = new JSDOM('<div class="ui-row" data-sub-id="x"><span class="ui-row__actions"></span></div>').window.document;
  const row = doc.querySelector('.ui-row');
  const bell = ui.button({ variant: 'plain', shape: 'icon', icon: { off: 'notifications_off', on: 'notifications_active' }, pressed: true, ariaLabel: 'Notify', doc });
  bell.classList.add('subs-bell');
  row.querySelector('.ui-row__actions').appendChild(bell);
  assert.strictEqual(findBellButton(row), bell);
  applyBellState(bell, false);
  assert.strictEqual(glyph(bell), 'bellOff');
  assert.strictEqual(bell.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(applyBellUpdateInPlace({ x: row }, 'x', true), true);
  assert.strictEqual(glyph(bell), 'bell');
  assert.strictEqual(bell.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(applyBellUpdateInPlace({ x: row }, 'x', 'true'), true, 'a non-boolean truthy is OFF (the record\'s boolean truth)');
  assert.strictEqual(glyph(bell), 'bellOff');
  assert.strictEqual(applyBellUpdateInPlace({ x: row }, 'missing', true), false, 'unknown id -> no-op');
  assert.strictEqual(applyBellUpdateInPlace({}, 'x', true), false, 'no row -> no-op');
  assert.strictEqual(applyBellUpdateInPlace(null, 'x', true), false);
  const noBell = new JSDOM('<div class="ui-row"></div>').window.document.querySelector('.ui-row');
  assert.strictEqual(applyBellUpdateInPlace({ y: noBell }, 'y', true), false, 'a row without a bell -> no-op');
  assert.strictEqual(findBellButton(null), null);
});
