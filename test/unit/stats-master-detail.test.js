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
      'by-type', 'by-folder', 'by-channel', 'books', 'duplicates',
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
