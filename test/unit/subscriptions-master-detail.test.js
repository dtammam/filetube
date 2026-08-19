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

test('Subscriptions: a dynamically-mounted history/failures card is adopted into Activity on re-wire', () => {
  const { dom, doc, signal } = load();
  try {
    wireMasterDetail('subscriptions', doc, signal);
    const panes = doc.querySelector('.md-panes');
    // build the cards with the client's OWN exported builders (binds the real
    // data-md-* attrs the builders set), mount them into the panes like the
    // client's mount sites do, then re-wire (what wireMenu() does).
    const hist = subsClient.createHistorySectionElement(doc).section;
    const fail = subsClient.createFailureSectionElement(doc, {}).section;
    panes.appendChild(hist);
    panes.appendChild(fail);
    wireMasterDetail('subscriptions', doc, signal); // the re-call -> _mdRefresh adopts them

    assert.deepStrictEqual(groupTitles(doc), ['Following', 'Add', 'Activity'], 'Activity group now present');
    assert.ok(doc.querySelector('.md-row[data-md-target="download-history"]'), 'history row adopted');
    assert.ok(doc.querySelector('.md-row[data-md-target="download-failures"]'), 'failures row adopted');
    assert.strictEqual(doc.querySelector('.md-row[data-md-target="download-history"] .md-tile').getAttribute('data-md-tone'), 'steel', 'Activity = steel');
    // and the adopted cards live in the panes (so selection can show them)
    assert.strictEqual(hist.parentNode, panes);
  } finally { unload(dom); }
});
