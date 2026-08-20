'use strict';

// [UNIT] v1.159 (Dean): the Stats "Videos & audio" table - the whole library as
// sortable rows (Title | Type | Length | Size) from /api/library-items, with a
// renderCap for big libraries (sort/filter still reach the full set).

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const common = require('../../public/js/common.js');
global.buildSortableTable = common.buildSortableTable;
const stats = require('../../public/js/stats.js');

function mount() {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="host"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  return dom;
}
function teardown(dom) {
  try { global.window.localStorage.clear(); } catch (_) { /* ignore */ }
  delete global.window; delete global.document; dom.window.close();
}
const titles = (host) => Array.from(host.querySelectorAll('.stable-row .stable-cell--name')).map((c) => c.textContent);

test('renders Title|Type|Length|Size, default Size-desc, with formatted Type/Length labels', () => {
  const dom = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderAvTable(host, [
      { title: 'Small Song', type: 'audio', durationSeconds: 200, sizeBytes: 5 * 1024 ** 2 },
      { title: 'Big Movie', type: 'video', durationSeconds: 6000, sizeBytes: 3 * 1024 ** 3 },
    ]);
    const headers = Array.from(host.querySelectorAll('.stable-th')).map((t) => t.textContent);
    assert.deepEqual(headers, ['Title', 'Type', 'Length', 'Size']);
    assert.deepEqual(titles(host), ['Big Movie', 'Small Song'], 'default Size desc (3 GB before 5 MB)');
    // Type shows a capitalised label; Length is MM:SS-style, not a library total
    const firstCells = host.querySelectorAll('.stable-row')[0].querySelectorAll('.stable-cell');
    assert.strictEqual(firstCells[1].textContent, 'Video');
    assert.match(firstCells[2].textContent, /\d+:\d\d/, 'per-item duration format');
  } finally { teardown(dom); }
});

test('renderCap: a large library renders only the cap + a "showing N of M" hint; sort reaches the full set', () => {
  const dom = mount();
  try {
    const host = global.document.getElementById('host');
    const cap = stats.AV_RENDER_CAP;
    const many = [];
    for (let i = 0; i < cap + 25; i += 1) many.push({ title: 'item ' + i, type: 'video', durationSeconds: 60, sizeBytes: i });
    stats.renderAvTable(host, many);
    assert.strictEqual(host.querySelectorAll('.stable-row').length, cap, 'render is capped');
    assert.match(host.querySelector('.stable-more').textContent, new RegExp('Showing ' + cap + ' of ' + (cap + 25)));
    // default Size-desc -> the biggest (highest i) is row 0, proving the cap is applied AFTER the full sort
    assert.strictEqual(titles(host)[0], 'item ' + (cap + 24));
  } finally { teardown(dom); }
});

test('empty library -> a friendly blurb, no table', () => {
  const dom = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderAvTable(host, []);
    assert.ok(!host.querySelector('.stable'));
    assert.match(host.textContent, /No videos or audio/);
  } finally { teardown(dom); }
});
