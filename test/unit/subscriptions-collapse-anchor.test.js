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

// Caller tripwire (adversarial slim-gate SUGGESTION): the pure helper is bound
// above, but mountCollapseToggle is closure-internal (no mount harness), so
// nothing asserts the caller USES it. A revert of that one line to a bare
// `beforebegin` on the list would pass every other test yet re-introduce the
// crush. This comment-stripped source lock catches exactly that revert. It is a
// tripwire, not a full behavioral bind - the jsdom helper tests above are that.
test('mountCollapseToggle inserts via chooseCollapseToggleAnchor, never a bare beforebegin on the list (crush-revert tripwire)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  // Strip block + line comments first (line comments guarded against `://` so
  // URLs survive) - the repo's comment-porous-lock lesson: assert on CODE only.
  const src = fs.readFileSync(path.join(__dirname, '../../lib/ytdlp/client/subscriptions.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  // Bind the CALLER's assignment specifically (not the helper's own definition
  // signature, which also reads `chooseCollapseToggleAnchor(listContainer)`):
  // the anchor the toggle is inserted against must be the helper's RESULT.
  // Reverting this assignment to `= listContainer` is the exact crush regression
  // the slim gate flagged, and it fails this assertion.
  assert.ok(
    /collapseAnchor\s*=\s*chooseCollapseToggleAnchor\(\s*listContainer\s*\)/.test(src),
    'the toggle anchor must be assigned from chooseCollapseToggleAnchor(listContainer), not the list directly',
  );
  // And the toggle must be inserted against that resolved anchor, never the raw
  // list container by either DOM path.
  assert.ok(
    !/listContainer\.insertAdjacentElement\(\s*['"]beforebegin['"]\s*,\s*collapseToggleBtn/.test(src),
    'must NOT insert the toggle directly beforebegin the list (that put it inside the .sub-list-body flex row -> the v1.155.1 crush)',
  );
  assert.ok(
    !/parentNode\.insertBefore\(\s*collapseToggleBtn\s*,\s*listContainer\s*\)/.test(src),
    'must NOT insert the toggle directly before the list via parentNode either',
  );
});
