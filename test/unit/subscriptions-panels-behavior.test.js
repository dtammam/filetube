// v1.156 (T3, gate WARNING 1) -> UI pass S5: BEHAVIORAL coverage for the
// toolbar->panel controller (openPanel/closePanel/wirePanels and the relocation
// preview's stacked sheet), closure-internal in initSubscriptionsView. It mounts the
// real subscriptions.html in jsdom with the real ui.js and drives real events
// (test/helpers/subs-view-harness.js). A mutant on the `'sub-panel-'` id concat, on
// the move-back-to-holder, on the stacked preview or on the signal must go RED here.

const { test } = require('node:test');
const assert = require('node:assert');
const { mountSubsView, jsonRes, settle, click } = require('../helpers/subs-view-harness');

const holderOf = (document) => document.querySelector('.subs-panels');
const sheetOf = (panel) => (panel && panel.parentNode && panel.parentNode.classList.contains('ui-sheet__body') ? panel.parentNode.parentNode : null);
const esc = (window, document) => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));

test('S5 controller: each toolbar button opens its panel IN a ui.sheet titled from data-title; opening another closes the first, which goes back to the holder', async () => {
  const { window, document, handlers } = mountSubsView();
  try {
    const add = document.getElementById('sub-panel-add');
    const activity = document.getElementById('sub-panel-activity');
    const oneoff = document.getElementById('sub-panel-oneoff');
    for (const p of [add, activity, oneoff]) assert.strictEqual(p.parentNode, holderOf(document), 'panels rest in the hidden holder');
    assert.strictEqual(holderOf(document).hidden, true);

    click(window, document.querySelector('.subs-toolbar [data-sub-panel="add"]'));
    const addSheet = sheetOf(add);
    assert.ok(addSheet, 'the Add button moves #sub-panel-add into a ui.sheet body (binds the sub-panel-<key> concat)');
    assert.strictEqual(addSheet.querySelector('.ui-sheet__title').textContent, 'Add a subscription');
    assert.strictEqual(addSheet.parentNode, document.body, 'the sheet lives on <body>');

    click(window, document.querySelector('.subs-toolbar [data-sub-panel="activity"]'));
    assert.ok(sheetOf(activity), 'Activity opens');
    await settle(() => add.parentNode === holderOf(document), 'the first panel returns to the holder once its sheet has closed');
    assert.strictEqual(addSheet.parentNode, null, 'the first sheet left the DOM');

    click(window, document.querySelector('.subs-toolbar [data-sub-panel="oneoff"]'));
    assert.ok(sheetOf(oneoff), 'One-off opens');
    await settle(() => activity.parentNode === holderOf(document), 'Activity went back');
  } finally {
    handlers.destroy();
  }
});

test('S5 controller: Esc, the scrim and Close each close the panel sheet; the panel returns with its ids and wiring intact', async () => {
  const { window, document, handlers, calls } = mountSubsView();
  try {
    const add = document.getElementById('sub-panel-add');
    const open = () => click(window, document.querySelector('.subs-toolbar [data-sub-panel="add"]'));
    const back = () => settle(() => add.parentNode === holderOf(document), 'panel back in the holder');

    open(); esc(window, document); await back();
    open(); click(window, document.querySelector('.ui-scrim')); await back();
    open(); click(window, sheetOf(add).querySelector('.ui-sheet__close')); await back();

    // wiring survived three round trips: the Add button still validates and posts
    open();
    click(window, document.getElementById('sub-add-btn'));
    const err = document.getElementById('sub-add-error');
    assert.strictEqual(err.hidden, false, 'an empty URL shows the field error (hidden flips, no inline display)');
    assert.strictEqual(err.textContent, 'Enter a channel URL.');
    document.getElementById('sub-add-url').value = 'https://www.youtube.com/@x';
    click(window, document.getElementById('sub-add-skipshorts'));
    assert.strictEqual(document.getElementById('sub-add-skipshorts').getAttribute('aria-checked'), 'true', 'the Skip Shorts switch toggles');
    click(window, document.getElementById('sub-add-btn'));
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/subscriptions');
    assert.ok(post, 'the add POST was sent');
    assert.strictEqual(post.body.skipShorts, true, 'the switch state travels as skipShorts');
    assert.strictEqual(err.hidden, true, 'a valid submit clears the error');
  } finally {
    handlers.destroy();
  }
});

test('S5 controller: the reloc preview STACKS over Activity; Esc closes the preview first and Activity stays open', async () => {
  const preview = { summary: { moves: 0 }, moves: [], skips: [] };
  const { window, document, handlers } = mountSubsView((m, url) => (m === 'POST' && url === '/api/ytdlp/repull-metadata/preview' ? jsonRes(200, preview) : undefined));
  try {
    click(window, document.querySelector('.subs-toolbar [data-sub-panel="activity"]'));
    const activity = document.getElementById('sub-panel-activity');
    const reloc = document.getElementById('reloc-preview-panel');
    assert.ok(sheetOf(activity));
    click(window, document.getElementById('sub-reheat-preview-btn'));
    await settle(() => !!sheetOf(reloc), 'the preview opens in its own sheet');
    assert.ok(sheetOf(activity), 'opening the preview does NOT close Activity');
    assert.strictEqual(sheetOf(reloc).querySelector('.ui-sheet__title').textContent, 'Preview: what a reheat would move');
    esc(window, document);
    await settle(() => reloc.parentNode === holderOf(document), 'Esc closed the top-most sheet (the preview)');
    assert.ok(sheetOf(activity), 'the Activity sheet stays open underneath');
    esc(window, document);
    await settle(() => activity.parentNode === holderOf(document), 'a second Esc closes Activity');
  } finally {
    handlers.destroy();
  }
});

test('S5 controller: an SPA teardown (destroy) closes an open panel sheet - nothing is stranded on <body>', async () => {
  const { window, document, handlers } = mountSubsView();
  click(window, document.querySelector('.subs-toolbar [data-sub-panel="oneoff"]'));
  const oneoff = document.getElementById('sub-panel-oneoff');
  assert.ok(sheetOf(oneoff));
  handlers.destroy();
  await settle(() => document.querySelectorAll('.ui-sheet').length === 0 && document.querySelectorAll('.ui-scrim').length === 0,
    'the view signal closed the sheet and its scrim');
  assert.strictEqual(oneoff.parentNode, holderOf(document), 'and returned the panel to the (now detached-able) holder');
  click(window, document.querySelector('.subs-toolbar [data-sub-panel="add"]'));
  assert.strictEqual(document.querySelectorAll('.ui-sheet').length, 0, 'a torn-down view opens nothing');
});

test('S5 Activity: the segmented control shows one pane at a time (History first)', () => {
  const { window, document, handlers } = mountSubsView();
  try {
    const seg = document.querySelector('#sub-activity-tabs .ui-segmented');
    assert.ok(seg, 'the segmented control mounted');
    const items = [...seg.querySelectorAll('.ui-segmented__item')];
    assert.deepStrictEqual(items.map((b) => b.getAttribute('data-value')), ['history', 'failures', 'maintenance']);
    const visible = () => [...document.querySelectorAll('[data-activity-pane]')].filter((p) => !p.hidden).map((p) => p.getAttribute('data-activity-pane'));
    assert.deepStrictEqual(visible(), ['history']);
    click(window, items[1]);
    assert.deepStrictEqual(visible(), ['failures']);
    click(window, items[2]);
    assert.deepStrictEqual(visible(), ['maintenance']);
    click(window, items[0]);
    assert.deepStrictEqual(visible(), ['history']);
  } finally {
    handlers.destroy();
  }
});

test('S5: the members-only switch reflects the stored setting, posts its new state and REVERTS on a refused save', async () => {
  let answer = 400;
  const { window, document, handlers, calls } = mountSubsView((m, url) => {
    // the stored value is ON, so the load and a revert both write 'true' and a tap writes 'false'
    if (m === 'GET' && url === '/api/subscriptions/settings') return jsonRes(200, { allowMembersOnly: true });
    if (m === 'POST' && url === '/api/subscriptions/settings') return jsonRes(answer, answer === 200 ? { allowMembersOnly: false } : { error: 'nope' });
    return undefined;
  });
  try {
    const sw = document.getElementById('sub-members-only-check');
    // wait for the load to land FIRST, so the only later writer of 'true' is the revert
    await settle(() => sw.getAttribute('aria-checked') === 'true', 'the stored setting is reflected on load');
    await new Promise((r) => setTimeout(r, 20));
    click(window, sw);
    assert.strictEqual(sw.getAttribute('aria-checked'), 'false', 'optimistic flip on tap');
    await settle(() => sw.getAttribute('aria-checked') === 'true', 'a 400 reverts the switch');
    assert.strictEqual(document.getElementById('sub-members-only-error').textContent, 'nope');
    assert.deepStrictEqual(calls.filter((c) => c.url === '/api/subscriptions/settings' && c.method === 'POST').map((c) => c.body), [{ allowMembersOnly: false }]);
    answer = 200;
    click(window, sw);
    await settle(() => document.getElementById('sub-members-only-error').hidden === true, 'a 200 clears the error');
    assert.strictEqual(sw.getAttribute('aria-checked'), 'false', 'and keeps the new state');
  } finally {
    handlers.destroy();
  }
});
