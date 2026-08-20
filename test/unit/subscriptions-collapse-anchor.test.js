// v1.155.1 (Dean device bug): the "Hide subscriptions" collapse toggle was
// crushing the channel list. mountCollapseToggle inserts the toggle
// `beforebegin` its anchor; v1.155 (T1) wrapped the list container in a
// `.sub-list-body` flex row (list + A-Z scrubber), so anchoring on the LIST
// put the toggle INSIDE that row as a flex sibling -- it stole the row's width
// and wrapped every channel name to one letter per line on a 213-sub library.
// chooseCollapseToggleAnchor returns the WRAPPER so the toggle lands above the
// row. These bind that choice by execution (jsdom, real `closest`).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { chooseCollapseToggleAnchor } = require('../../lib/ytdlp/client/subscriptions.js');

test('chooseCollapseToggleAnchor: returns the .sub-list-body wrapper, so the toggle lands ABOVE the list+scrubber flex row (the v1.155.1 crush fix)', () => {
  const dom = new JSDOM('<div id="outer"><div class="sub-list-body"><div id="sub-list-container" class="sub-list"></div><div class="sub-scrubber"></div></div></div>');
  const doc = dom.window.document;
  const listContainer = doc.getElementById('sub-list-container');
  const wrapper = listContainer.closest('.sub-list-body');

  const anchor = chooseCollapseToggleAnchor(listContainer);
  assert.strictEqual(anchor, wrapper, 'anchor is the flex-row wrapper, not the list itself');

  // Outcome: inserting beforebegin the anchor puts the toggle OUTSIDE the flex
  // row (a sibling of .sub-list-body). If the anchor regressed to the list, the
  // toggle would be a flex sibling of the list -> the crush returns.
  const toggle = doc.createElement('button');
  anchor.insertAdjacentElement('beforebegin', toggle);
  assert.strictEqual(toggle.parentNode, wrapper.parentNode, 'toggle is a sibling of the flex row');
  assert.strictEqual(toggle.nextSibling, wrapper, 'toggle sits immediately above the flex row');
  assert.strictEqual(doc.querySelector('.sub-list-body > button'), null, 'NO button is a child (flex sibling) of the list row');
});

test('chooseCollapseToggleAnchor: falls back to the list itself when there is no .sub-list-body wrapper (older/un-wrapped shell)', () => {
  const dom = new JSDOM('<div id="outer"><div id="sub-list-container" class="sub-list"></div></div>');
  const listContainer = dom.window.document.getElementById('sub-list-container');
  assert.strictEqual(chooseCollapseToggleAnchor(listContainer), listContainer);
});

test('chooseCollapseToggleAnchor: never throws on a null or closest-less element', () => {
  assert.strictEqual(chooseCollapseToggleAnchor(null), null);
  const fake = {};
  assert.strictEqual(chooseCollapseToggleAnchor(fake), fake, 'an element without closest() returns itself');
});
