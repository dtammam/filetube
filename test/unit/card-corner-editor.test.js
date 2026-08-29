'use strict';

// [UNIT] v1.67 T5 - the Settings > Appearance card-corner editor
// (setup.js): the pure option builder that enforces C2 (a control chosen in
// one corner DROPS from the other corners' pickers - a duplicate is a UI
// bug, not a feature), the label roster bound against main.js's canonical
// control list (hand-copied lists rot - the v1.64 lesson), and the REAL
// renderCardCornerEditor executed against a jsdom document + fetch stub
// (the history-nav-gate pattern): seeding from /api/auth/me, and a change
// event POSTing exactly {cornerXX: value} to /api/me/settings.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const mainExports = require('../../public/js/main.js');

// setup.js consumes main.js's corner vocabulary as browser globals (script
// order: common -> main -> ... -> setup); the Node require path injects the
// same bindings explicitly BEFORE setup.js is loaded.
global.resolveCardCornerPrefs = mainExports.resolveCardCornerPrefs;
global.CARD_CORNER_CONTROLS = mainExports.CARD_CORNER_CONTROLS;

const {
  buildCornerEditorOptions,
  CARD_CORNER_LABELS,
  CORNER_EDITOR_SLOTS,
  renderCardCornerEditor,
} = require('../../public/js/setup.js');

const CONTROLS = mainExports.CARD_CORNER_CONTROLS;

// ---- roster drift bind ------------------------------------------------------

test('every canonical control (main.js CARD_CORNER_CONTROLS) has an editor label, plus none - no hand-copied roster', () => {
  // v1.203 DELIBERATE roster change: + 'transcript' (Dean). Six -> seven.
  assert.ok(Array.isArray(CONTROLS) && CONTROLS.length === 7, 'the canonical roster is the seven controls');
  for (const control of CONTROLS) {
    assert.strictEqual(typeof CARD_CORNER_LABELS[control], 'string', `missing label for '${control}'`);
  }
  assert.strictEqual(typeof CARD_CORNER_LABELS.none, 'string', 'None needs a label too');
  assert.deepStrictEqual(CORNER_EDITOR_SLOTS.map((s) => s[0]), ['cornerTL', 'cornerTR', 'cornerBL'],
    'exactly the three assignable corners - bottom-right is reserved and must never grow a slot');
});

// ---- buildCornerEditorOptions (C2) ------------------------------------------

test('C2: a corner\'s options EXCLUDE controls chosen in the other corners, keep its own pick selected, and always offer none', () => {
  const effective = { cornerTL: 'download', cornerTR: 'delete', cornerBL: 'like' };
  const opts = buildCornerEditorOptions(effective, 'cornerTL', CONTROLS);
  const values = opts.map((o) => o.value);
  assert.ok(!values.includes('delete'), 'delete is taken by TR');
  assert.ok(!values.includes('like'), 'like is taken by BL');
  for (const v of ['download', 'queue', 'share', 'reheat', 'transcript', 'none']) { // v1.203: + transcript
    assert.ok(values.includes(v), `expected option '${v}'`);
  }
  const selected = opts.filter((o) => o.selected);
  assert.deepStrictEqual(selected.map((o) => o.value), ['download'], 'the corner\'s own pick is selected');
});

test('C2: none never drops from any picker (two empty corners are legal), and a none corner selects it', () => {
  const effective = { cornerTL: 'none', cornerTR: 'none', cornerBL: 'queue' };
  for (const key of ['cornerTL', 'cornerTR']) {
    const opts = buildCornerEditorOptions(effective, key, CONTROLS);
    assert.ok(opts.some((o) => o.value === 'none' && o.selected), `${key} selects none`);
    assert.ok(!opts.map((o) => o.value).includes('queue'), `${key} must drop BL's queue`);
  }
});

test('an INJECTED duplicate (bypassing the editor) still shows each corner\'s own stored value - never a lying first-option display (adversarial S1)', () => {
  // Direct POSTs can store the same control in two corners (the plan's
  // accepted residual). The grid's D5 dedupe renders the TL winner; the
  // editor must DISPLAY the stored truth in both pickers (self-heals on any
  // change) rather than silently showing the first option.
  const effective = { cornerTL: 'like', cornerTR: 'like', cornerBL: 'download' };
  for (const key of ['cornerTL', 'cornerTR']) {
    const opts = buildCornerEditorOptions(effective, key, CONTROLS);
    const selected = opts.filter((o) => o.selected);
    assert.deepStrictEqual(selected.map((o) => o.value), ['like'], `${key} shows its own stored value`);
  }
});

// ---- the real editor against a jsdom document -------------------------------

function withEditorDom(meSettings, fn) {
  const dom = new JSDOM('<body><div id="card-corner-editor"></div></body>', { url: 'http://localhost/' });
  global.document = dom.window.document;
  global.window = dom.window;
  const posts = [];
  const realFetch = global.fetch;
  global.fetch = (url, init) => {
    const method = (init && init.method) || 'GET';
    if (url === '/api/auth/me' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 1, settings: meSettings }) });
    }
    if (url === '/api/me/settings' && method === 'POST') {
      posts.push(JSON.parse(init.body));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    }
    return Promise.reject(new Error(`unexpected fetch ${method} ${url}`));
  };
  return Promise.resolve()
    .then(() => fn(dom, posts))
    .finally(() => {
      global.fetch = realFetch;
      delete global.document;
      delete global.window;
      dom.window.close();
    });
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('renderCardCornerEditor: seeds three selects from /api/auth/me and shows the EFFECTIVE layout', () =>
  withEditorDom({ cornerTL: 'queue' }, async (dom) => {
    await renderCardCornerEditor(new dom.window.AbortController().signal);
    await settle();
    const selects = dom.window.document.querySelectorAll('#card-corner-editor select');
    assert.strictEqual(selects.length, 3, 'one picker per assignable corner');
    assert.strictEqual(selects[0].value, 'queue', 'stored pick seeds TL');
    assert.strictEqual(selects[1].value, 'delete', 'absent key shows the C5 default');
    assert.strictEqual(selects[2].value, 'like');
  }));

test('renderCardCornerEditor: a change POSTs exactly {cornerKey: value} and re-filters the sibling pickers (C2 live)', () =>
  withEditorDom({}, async (dom, posts) => {
    await renderCardCornerEditor(new dom.window.AbortController().signal);
    await settle();
    const doc = dom.window.document;
    let selects = doc.querySelectorAll('#card-corner-editor select');
    selects[0].value = 'share';
    selects[0].dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    assert.deepStrictEqual(posts, [{ cornerTL: 'share' }], 'one POST, one key, the picked value');
    selects = doc.querySelectorAll('#card-corner-editor select');
    const trValues = Array.from(selects[1].options).map((o) => o.value);
    assert.ok(!trValues.includes('share'), 'TR immediately drops TL\'s new pick (C2)');
    assert.ok(trValues.includes('download'), 'TL\'s ABANDONED default returns to the pool');
    // QA S2: the C2 redraw destroys the changed <select>; the SAME slot's
    // fresh select must be re-focused so an arrow-keying keyboard user
    // (Firefox fires change per press) is not stranded on <body>.
    assert.strictEqual(doc.activeElement, selects[0], 'focus returns to the changed slot after the redraw');
  }));
