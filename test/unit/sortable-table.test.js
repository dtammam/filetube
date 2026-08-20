'use strict';

// [UNIT] v1.159 (Dean): the reusable sortable/filterable table. Two layers:
//   1. the PURE core (sortTableRows / filterTableRows / defaultSortDir) - no DOM;
//   2. a jsdom mount of buildSortableTable - header taps sort + flip, the filter
//      narrows, sort persists, and an actions node maps to the RIGHT row AFTER a
//      sort (the gate's "action wired to the post-sort row" concern).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const common = require('../../public/js/common.js');
const { sortTableRows, filterTableRows, defaultSortDir, buildSortableTable } = common;

const SIZE = { key: 'size', label: 'Size', numeric: true, align: 'end', sortValue: (r) => r.bytes, format: (r) => r.sizeLabel };
const NAME = { key: 'name', label: 'Name', format: (r) => r.name };

// ---- pure core -------------------------------------------------------------

test('sortTableRows: numeric sorts by the RAW value, not the formatted label (9.3 GB < 24.8 GB)', () => {
  const rows = [
    { name: 'a', bytes: 24.8 * 1024 ** 3, sizeLabel: '24.8 GB' },
    { name: 'b', bytes: 9.3 * 1024 ** 3, sizeLabel: '9.3 GB' },
    { name: 'c', bytes: 763.8 * 1024 ** 2, sizeLabel: '763.8 MB' },
  ];
  // desc: biggest first (lexical would wrongly put "9.3" or "763.8" on top)
  assert.deepEqual(sortTableRows(rows, SIZE, 'desc').map((r) => r.name), ['a', 'b', 'c']);
  assert.deepEqual(sortTableRows(rows, SIZE, 'asc').map((r) => r.name), ['c', 'b', 'a']);
});

test('sortTableRows: text sorts case-insensitively + numeric-aware, and is STABLE on ties', () => {
  const rows = [
    { name: 'Season 2', k: 1 }, { name: 'season 10', k: 2 }, { name: 'Season 1', k: 3 },
    { name: 'Season 2', k: 4 }, // dup name -> must keep input order (k:1 before k:4)
  ];
  const asc = sortTableRows(rows, { key: 'name', format: (r) => r.name }, 'asc');
  assert.deepEqual(asc.map((r) => r.name), ['Season 1', 'Season 2', 'Season 2', 'season 10'], 'numeric-aware: 2 before 10; case-insensitive');
  const ties = asc.filter((r) => r.name === 'Season 2').map((r) => r.k);
  assert.deepEqual(ties, [1, 4], 'stable: equal rows keep their input order');
});

test('filterTableRows: case-folded substring on the text extractor; empty query = all (a copy)', () => {
  const rows = [{ n: 'nestalgiamusic' }, { n: 'CGTioMusic' }, { n: 'Season 2' }];
  const textOf = (r) => r.n;
  assert.deepEqual(filterTableRows(rows, textOf, 'music').map((r) => r.n), ['nestalgiamusic', 'CGTioMusic'], 'matches both, case-insensitive');
  assert.deepEqual(filterTableRows(rows, textOf, '  ').map((r) => r.n), rows.map((r) => r.n), 'blank -> everything');
  assert.notStrictEqual(filterTableRows(rows, textOf, ''), rows, 'returns a copy, not the original array');
});

test('defaultSortDir: numeric -> desc (biggest first), text -> asc', () => {
  assert.equal(defaultSortDir(SIZE), 'desc');
  assert.equal(defaultSortDir(NAME), 'asc');
});

// ---- jsdom: the built table ------------------------------------------------

function mount() {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  return dom;
}
function teardown(dom) {
  try { global.window.localStorage.clear(); } catch (_) { /* ignore */ }
  delete global.window; delete global.document; dom.window.close();
}
const ROWS = [
  { name: 'nestalgiamusic', bytes: 24.8 * 1024 ** 3, sizeLabel: '24.8 GB' },
  { name: 'ReimaginedAI80s', bytes: 763.8 * 1024 ** 2, sizeLabel: '763.8 MB' },
  { name: 'CGTioMusic', bytes: 9.3 * 1024 ** 3, sizeLabel: '9.3 GB' },
];
const names = (host) => Array.from(host.querySelectorAll('.stable-row .stable-cell--name')).map((c) => c.textContent);

test('build: renders tappable headers + rows, a grid template, and sorts on header click (with flip + aria-sort)', () => {
  const dom = mount();
  try {
    const host = global.document.createElement('div');
    buildSortableTable(host, { columns: [NAME, SIZE], rows: ROWS, defaultSort: { key: 'name', dir: 'asc' } });
    // default: name asc (case-insensitive: C < n < R)
    assert.deepEqual(names(host), ['CGTioMusic', 'nestalgiamusic', 'ReimaginedAI80s']);
    assert.ok(host.querySelector('.stable').style.getPropertyValue('--stable-cols').includes('1fr'), 'grid template var set');

    const sizeTh = host.querySelector('.stable-th[data-col="size"]');
    sizeTh.dispatchEvent(new dom.window.Event('click')); // numeric -> default desc (biggest first)
    assert.deepEqual(names(host), ['nestalgiamusic', 'CGTioMusic', 'ReimaginedAI80s'], 'sorted by raw bytes, biggest first');
    assert.strictEqual(sizeTh.getAttribute('aria-sort'), 'descending');
    assert.strictEqual(host.querySelector('.stable-th[data-col="name"]').getAttribute('aria-sort'), 'none');

    sizeTh.dispatchEvent(new dom.window.Event('click')); // same column -> flip to asc
    assert.deepEqual(names(host), ['ReimaginedAI80s', 'CGTioMusic', 'nestalgiamusic'], 'flipped to smallest first');
    assert.strictEqual(sizeTh.getAttribute('aria-sort'), 'ascending');
  } finally { teardown(dom); }
});

test('build: the filter narrows rows live and shows an empty state on no match', () => {
  const dom = mount();
  try {
    const host = global.document.createElement('div');
    buildSortableTable(host, { columns: [NAME, SIZE], rows: ROWS, filter: { text: (r) => r.name, placeholder: 'Filter' } });
    const input = host.querySelector('.stable-filter');
    input.value = 'music';
    input.dispatchEvent(new dom.window.Event('input'));
    assert.deepEqual(names(host).sort(), ['CGTioMusic', 'nestalgiamusic']);
    input.value = 'zzz';
    input.dispatchEvent(new dom.window.Event('input'));
    assert.strictEqual(names(host).length, 0);
    assert.ok(host.querySelector('.stable-empty'), 'a no-match state, not a blank table');
  } finally { teardown(dom); }
});

test('build: the chosen sort persists to localStorage and restores on the next build', () => {
  const dom = mount();
  try {
    const host1 = global.document.createElement('div');
    buildSortableTable(host1, { columns: [NAME, SIZE], rows: ROWS, persistKey: 'ft-test-sort', defaultSort: { key: 'name', dir: 'asc' } });
    host1.querySelector('.stable-th[data-col="size"]').dispatchEvent(new dom.window.Event('click')); // size desc
    assert.deepEqual(JSON.parse(global.window.localStorage.getItem('ft-test-sort')), { key: 'size', dir: 'desc' });

    const host2 = global.document.createElement('div'); // a fresh mount reads the saved pref
    buildSortableTable(host2, { columns: [NAME, SIZE], rows: ROWS, persistKey: 'ft-test-sort', defaultSort: { key: 'name', dir: 'asc' } });
    assert.deepEqual(names(host2), ['nestalgiamusic', 'CGTioMusic', 'ReimaginedAI80s'], 'restored size-desc, not the default name-asc');
  } finally { teardown(dom); }
});

test('build: renderCap shows only the top-N of the current sort + an honest "showing N of M" hint', () => {
  const dom = mount();
  try {
    const many = [];
    for (let i = 0; i < 10; i += 1) many.push({ name: 'f' + i, bytes: i, sizeLabel: i + 'B' });
    const host = global.document.createElement('div');
    buildSortableTable(host, { columns: [NAME, SIZE], rows: many, renderCap: 3, defaultSort: { key: 'size', dir: 'desc' } });
    assert.strictEqual(host.querySelectorAll('.stable-row').length, 3, 'only 3 rows rendered');
    // desc -> the 3 BIGGEST (f9,f8,f7), proving the cap is applied AFTER the full sort
    assert.deepEqual(names(host), ['f9', 'f8', 'f7']);
    assert.match(host.querySelector('.stable-more').textContent, /Showing 3 of 10/);
    // a filter that narrows below the cap drops the hint
    const th = host.querySelector('.stable-th[data-col="size"]');
    th.dispatchEvent(new dom.window.Event('click')); // flip to asc -> smallest 3 (f0,f1,f2)
    assert.deepEqual(names(host), ['f0', 'f1', 'f2'], 'asc reaches the smallest across the FULL set, not just the capped view');
  } finally { teardown(dom); }
});

test('build: an actions node maps to the CORRECT row after a sort (not the pre-sort position)', () => {
  const dom = mount();
  try {
    const host = global.document.createElement('div');
    buildSortableTable(host, {
      columns: [NAME, SIZE], rows: ROWS, defaultSort: { key: 'name', dir: 'asc' },
      actions: (row) => { const b = global.document.createElement('button'); b.className = 'act'; b.dataset.for = row.name; return b; },
    });
    host.querySelector('.stable-th[data-col="size"]').dispatchEvent(new dom.window.Event('click')); // size desc
    // Row 0 is now the biggest (nestalgiamusic); its action button must be FOR it.
    const rows = host.querySelectorAll('.stable-row');
    assert.strictEqual(rows[0].querySelector('.stable-cell--name').textContent, 'nestalgiamusic');
    assert.strictEqual(rows[0].querySelector('.act').dataset.for, 'nestalgiamusic', 'the action is wired to the post-sort row, not a stale index');
  } finally { teardown(dom); }
});
