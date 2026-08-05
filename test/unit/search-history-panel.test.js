'use strict';

// [UNIT] v1.85 #1 - the search-history client USE, jsdom-bound (not source-
// asserted): recordSearchTerm POSTs the term (and skips empties);
// renderSearchHistoryPanel builds the rows as DOM, wires each term to onSearch,
// each x to a DELETE + row removal, and clear-all to a DELETE + empty state.
// Plus a source-lock that performGlobalSearch records the term.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');
let dom;

function fresh() {
  delete global.document; delete global.window; delete global.fetch;
  delete require.cache[COMMON];
  const common = require(COMMON); // boot skipped (no document at require)
  dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  return common;
}
afterEach(() => {
  if (dom) { dom.window.close(); dom = null; }
  delete global.window; delete global.document; delete global.fetch;
  delete require.cache[COMMON];
});

test('recordSearchTerm POSTs the trimmed term; skips empty/whitespace', () => {
  const c = fresh();
  const calls = [];
  global.fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve({ ok: true, json: async () => ({}) }); };
  c.recordSearchTerm('  hello  ');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, '/api/search-history');
  assert.strictEqual(calls[0].opts.method, 'POST');
  assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { term: 'hello' });
  c.recordSearchTerm('   '); c.recordSearchTerm('');
  assert.strictEqual(calls.length, 1, 'empty/whitespace terms are never recorded');
});

test('renderSearchHistoryPanel: empty terms -> the empty state, no rows', () => {
  const c = fresh();
  const panel = global.document.createElement('div');
  c.renderSearchHistoryPanel(panel, [], () => {});
  assert.ok(panel.querySelector('.search-history-empty'));
  assert.strictEqual(panel.querySelectorAll('.search-history-row').length, 0);
});

test('renderSearchHistoryPanel: a row per term; a term click calls onSearch', () => {
  const c = fresh();
  const panel = global.document.createElement('div');
  const picked = [];
  c.renderSearchHistoryPanel(panel, ['cats', 'dogs'], (t) => picked.push(t));
  const rows = panel.querySelectorAll('.search-history-row');
  assert.strictEqual(rows.length, 2);
  // term text is set via textContent (no HTML injection)
  assert.strictEqual(rows[0].querySelector('.search-history-term span').textContent, 'cats');
  rows[1].querySelector('.search-history-term').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepStrictEqual(picked, ['dogs']);
});

test('a user-typed <script> term is rendered as TEXT (no self-XSS)', () => {
  const c = fresh();
  const panel = global.document.createElement('div');
  c.renderSearchHistoryPanel(panel, ['<img src=x onerror=1>'], () => {});
  const span = panel.querySelector('.search-history-term span');
  assert.strictEqual(span.textContent, '<img src=x onerror=1>');
  assert.strictEqual(span.querySelector('img'), null, 'never parsed as HTML');
});

test('the x deletes one (DELETE + row removed); clear-all empties + DELETEs', () => {
  const c = fresh();
  const deletes = [];
  global.fetch = (url, opts) => { if (opts && opts.method === 'DELETE') deletes.push(url); return Promise.resolve({ ok: true, json: async () => ({}) }); };
  const panel = global.document.createElement('div');
  c.renderSearchHistoryPanel(panel, ['alpha', 'beta'], () => {});
  // delete 'alpha'
  panel.querySelectorAll('.search-history-row')[0].querySelector('.search-history-del')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(deletes[0], '/api/search-history/alpha', 'DELETEs the one term');
  assert.strictEqual(panel.querySelectorAll('.search-history-row').length, 1, 'row removed');
  // clear all
  panel.querySelector('.search-history-clear').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.ok(deletes.includes('/api/search-history'), 'clear-all DELETEs the collection');
  assert.ok(panel.querySelector('.search-history-empty'), 'panel shows the empty state after clear');
});

test('source-lock: performGlobalSearch records the term', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(COMMON, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.match(src, /function performGlobalSearch\(\)[\s\S]{0,400}recordSearchTerm\(query\)/,
    'a search records the term (per-user, synced)');
});
