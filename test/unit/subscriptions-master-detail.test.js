'use strict';

// [UNIT] v1.152: binds the REAL subscriptions.html .md-root + the DYNAMIC
// history/failures cards. The static sections build Following/Add; the
// dynamic cards (created by subscriptions.js's own exported builders, then
// mounted + re-wired the way the client does) are adopted into an Activity
// group by the wireMasterDetail re-call - the tricky part of this page.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { wireMasterDetail } = require('../../public/js/common.js');
const subsClient = require('../../lib/ytdlp/client/subscriptions.js');

const SUBS_HTML = fs.readFileSync(path.join(__dirname, '../../lib/ytdlp/views/subscriptions.html'), 'utf8');
const MD_ROOT = SUBS_HTML.match(/<div class="md-root" data-md-page="subscriptions"[\s\S]*?<\/div><!-- \/\.md-root -->/);

function load() {
  assert.ok(MD_ROOT, 'subscriptions.html carries the .md-root wrapper');
  const dom = new JSDOM('<!DOCTYPE html><html data-theme="2021"><body>' + MD_ROOT[0] + '</body></html>', { url: 'http://localhost/subscriptions' });
  global.window = dom.window; global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver; global.localStorage = dom.window.localStorage;
  return { dom, doc: dom.window.document, signal: new dom.window.AbortController().signal };
}
function unload(dom) {
  delete global.window; delete global.document; delete global.MutationObserver; delete global.localStorage;
  dom.window.close();
}

const rowKeys = (doc) => Array.from(doc.querySelectorAll('.md-nav .md-row')).map((r) => r.getAttribute('data-md-target'));
const groupTitles = (doc) => Array.from(doc.querySelectorAll('.md-nav .md-group-title')).map((t) => t.textContent);

test('Subscriptions static menu: Following + Add (no Activity until a card mounts)', () => {
  const { dom, doc, signal } = load();
  try {
    wireMasterDetail('subscriptions', doc, signal);
    assert.deepStrictEqual(groupTitles(doc), ['Following', 'Add']);
    assert.deepStrictEqual(rowKeys(doc), ['subscriptions-list', 'add-subscription', 'one-off-download']);
    assert.strictEqual(doc.querySelector('.md-row[data-md-target="add-subscription"] .md-row-label').textContent, 'Add a subscription', 'the "+ " prefix is dropped via data-md-label');
    assert.strictEqual(doc.querySelector('.md-row[data-md-target="subscriptions-list"] .md-tile').getAttribute('data-md-tone'), 'red', 'Following = red');
  } finally { unload(dom); }
});

test('Subscriptions: dynamic history/failures cards are adopted into Activity - once each, no duplicate rows', () => {
  const { dom, doc, signal } = load();
  try {
    wireMasterDetail('subscriptions', doc, signal);
    const panes = doc.querySelector('.md-panes');
    // Reproduce the client's REAL mount path: insertAdjacentElement('afterend')
    // of listContainer.closest('.setup-box') === #sub-list-details (which now
    // lives in .md-panes), then a wireMenu() re-call per mount - exactly the
    // repeated-re-call pattern the _mdRefresh dedup must survive.
    const anchor = doc.getElementById('sub-list-details');
    const hist = subsClient.createHistorySectionElement(doc).section;
    anchor.insertAdjacentElement('afterend', hist);
    wireMasterDetail('subscriptions', doc, signal); // re-call #2
    const fail = subsClient.createFailureSectionElement(doc, {}).section;
    anchor.insertAdjacentElement('afterend', fail);
    wireMasterDetail('subscriptions', doc, signal); // re-call #3
    wireMasterDetail('subscriptions', doc, signal); // re-call #4 (extra idempotency probe)

    assert.deepStrictEqual(groupTitles(doc), ['Following', 'Add', 'Activity'], 'Activity group present');
    const keys = rowKeys(doc);
    // The load-bearing dedup: removing `sections.indexOf(s) === -1` from
    // _mdRefresh triplicates the static rows + duplicates the dynamic ones ->
    // this deep-equal / length / uniqueness triad goes RED.
    assert.strictEqual(keys.length, 5, `exactly 5 rows, got ${keys.length} (dupes = dedup regressed): ${keys.join(',')}`);
    assert.strictEqual(new Set(keys).size, 5, 'no duplicate rows');
    assert.deepStrictEqual([...keys].sort(), ['add-subscription', 'download-failures', 'download-history', 'one-off-download', 'subscriptions-list']);
    assert.strictEqual(doc.querySelector('.md-row[data-md-target="download-history"] .md-tile').getAttribute('data-md-tone'), 'steel', 'Activity = steel');
    assert.strictEqual(hist.parentNode, panes, 'adopted into the panes so selection can show it');
  } finally { unload(dom); }
});
