'use strict';

// [UNIT] v1.152: binds the REAL stats.html .md-root markup to wireMasterDetail -
// the declared group order (data-md-groups) reorders the DOM-scattered sections
// into Overview / Breakdowns / System, and tone follows that order.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { wireMasterDetail } = require('../../public/js/common.js');

const STATS_HTML = fs.readFileSync(path.join(__dirname, '../../public/stats.html'), 'utf8');
const MD_ROOT = STATS_HTML.match(/<div class="md-root" data-md-page="stats"[\s\S]*?<\/div><!-- \/\.md-root -->/);

function load() {
  assert.ok(MD_ROOT, 'stats.html carries the .md-root wrapper');
  const dom = new JSDOM('<!DOCTYPE html><html data-theme="2021"><body>' + MD_ROOT[0] + '</body></html>', { url: 'http://localhost/stats.html' });
  global.window = dom.window; global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver; global.localStorage = dom.window.localStorage;
  return { dom, doc: dom.window.document, signal: new dom.window.AbortController().signal };
}
function unload(dom) {
  delete global.window; delete global.document; delete global.MutationObserver; delete global.localStorage;
  dom.window.close();
}

test('Stats builds Overview / Breakdowns / System from the DOM-scattered sections', () => {
  const { dom, doc, signal } = load();
  try {
    wireMasterDetail('stats', doc, signal);
    const groups = Array.from(doc.querySelectorAll('.md-nav .md-group-title')).map((t) => t.textContent);
    assert.deepStrictEqual(groups, ['Overview', 'Breakdowns', 'System'], 'declared order, not the interleaved DOM order');
    const keys = Array.from(doc.querySelectorAll('.md-nav .md-row')).map((r) => r.getAttribute('data-md-target'));
    assert.deepStrictEqual(keys, [
      'fun-stats', 'records', 'most-watched',
      'by-type', 'by-folder', 'by-channel', 'videos-audio', 'books', 'duplicates',
      'keyboard-shortcuts', 'under-the-hood', 'about-filetube',
    ], 'grouped, each group in its own document order');
  } finally { unload(dom); }
});

test('Stats tone follows the declared group order (Overview red / Breakdowns graphite / System steel)', () => {
  const { dom, doc, signal } = load();
  try {
    wireMasterDetail('stats', doc, signal);
    const tone = (k) => doc.querySelector('.md-row[data-md-target="' + k + '"] .md-tile').getAttribute('data-md-tone');
    assert.strictEqual(tone('fun-stats'), 'red');
    assert.strictEqual(tone('by-type'), 'graphite');
    assert.strictEqual(tone('keyboard-shortcuts'), 'steel');
  } finally { unload(dom); }
});

// v1.165 DELIBERATE LOCK UPDATE (Dean, reversing his v1.47.8 ruling): the
// keyboard-shortcuts entry is now VISIBLE on phones - the shortcuts window hosts
// the tappable DDR mini-synth (v1.163), so the phone gets the toy. This test
// binds BOTH halves of the new state:
//   (a) stats.html no longer marks the section data-md-hide-mobile, so its menu
//       row renders un-hidden on phones (re-marking it reds this), AND
//   (b) the GENERIC v1.152 hide-mobile mechanism still works for any future
//       section - bound with a synthetic marking on the same real fixture, plus
//       the CSS row+pane rules (deleting the mechanism reds this too).
test('Stats: keyboard-shortcuts is NOT phone-hidden any more; the generic hide-mobile mechanism survives', () => {
  const { dom, doc, signal } = load();
  try {
    // (b) synthetically mark a section BEFORE wiring - the mechanism must still propagate.
    doc.querySelector('details[data-collapse-key="fun-stats"]').setAttribute('data-md-hide-mobile', '');
    wireMasterDetail('stats', doc, signal);
    const ks = doc.querySelector('.md-row[data-md-target="keyboard-shortcuts"]');
    assert.ok(ks, 'the keyboard-shortcuts row renders');
    assert.ok(!ks.classList.contains('md-hide-mobile'),
      'v1.165: the row is NOT phone-hidden (the DDR mini-synth is tappable on mobile)');
    assert.ok(doc.querySelector('.md-row[data-md-target="fun-stats"]').classList.contains('md-hide-mobile'),
      'the generic mechanism still propagates a marked section to its row');
    // (a) the source markup no longer marks the section...
    assert.doesNotMatch(STATS_HTML, /data-collapse-key="keyboard-shortcuts"[^>]*data-md-hide-mobile/,
      'stats.html must NOT mark keyboard-shortcuts hide-mobile (Dean reversed the ruling)');
    assert.doesNotMatch(STATS_HTML, /\.shortcuts-entry[^}]*display:\s*none/,
      'no inline phone hide crept back into stats.html');
    // ...and the generic CSS mechanism remains for future users.
    const cssPath = path.join(__dirname, '../../public/css/style.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert.match(css, /max-width: 768px[\s\S]*\.md-row\.md-hide-mobile\s*\{\s*display: none/, 'the generic phone row rule survives');
    assert.match(css, /details\[data-md-hide-mobile\]\.md-active\s*\{\s*display: none/, 'and the pane rule survives');
  } finally { unload(dom); }
});
