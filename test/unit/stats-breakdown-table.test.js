'use strict';

// [UNIT] v1.159 (Dean): the Stats By-folder / By-channel breakdown now renders
// via the shared sortable `.stable` table (Name | Entries | Length | Size)
// instead of the old fused "count · duration · size" flex row. This binds the
// wiring: the right columns, the raw-value sort (default Size desc), the filter,
// and that the numeric columns show FORMATTED text but sort by the raw number.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

// stats.js calls the global buildSortableTable (common.js, loaded first in the
// browser); wire it for node the same way.
const common = require('../../public/js/common.js');
global.buildSortableTable = common.buildSortableTable;
const stats = require('../../public/js/stats.js');

const GROUPS = [
  { folderName: 'nestalgiamusic', count: 348, totalDurationSeconds: 907200, totalSizeBytes: 24.8 * 1024 ** 3 },
  { folderName: 'ReimaginedAI80s', count: 161, totalDurationSeconds: 41700, totalSizeBytes: 763.8 * 1024 ** 2 },
  { folderName: 'CGTioMusic', count: 97, totalDurationSeconds: 306000, totalSizeBytes: 9.3 * 1024 ** 3 },
];

function mount() {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="host"></div></body>', { url: 'http://localhost/' });
  global.window = dom.window; global.document = dom.window.document;
  return dom;
}
function teardown(dom) {
  try { global.window.localStorage.clear(); } catch (_) { /* ignore */ }
  delete global.window; delete global.document; dom.window.close();
}
const names = (host) => Array.from(host.querySelectorAll('.stable-row .stable-cell--name')).map((c) => c.textContent);

test('renders a .stable table with Name/Entries/Length/Size headers, default Size-desc', () => {
  const dom = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderBreakdownList(host, GROUPS, (g) => g.folderName, 'No folders yet.', 'ft-test:folder');
    assert.ok(host.querySelector('.stable'), 'built the sortable table');
    const headers = Array.from(host.querySelectorAll('.stable-th')).map((t) => t.textContent);
    assert.deepEqual(headers, ['Name', 'Entries', 'Length', 'Size'], 'the four columns');
    // default sort = Size desc: nestalgia (24.8G) > CGTio (9.3G) > Reimagined (763M)
    assert.deepEqual(names(host), ['nestalgiamusic', 'CGTioMusic', 'ReimaginedAI80s']);
    // the Size cell shows the FORMATTED label, but sort used the raw bytes
    const firstRowCells = host.querySelectorAll('.stable-row')[0].querySelectorAll('.stable-cell');
    assert.match(firstRowCells[3].textContent, /24\.8 GB/, 'formatted size label');
    assert.match(firstRowCells[1].textContent, /348/, 'formatted entry count');
  } finally { teardown(dom); }
});

test('sorting by Entries and filtering by name both work on the built table', () => {
  const dom = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderBreakdownList(host, GROUPS, (g) => g.folderName, 'No folders yet.', 'ft-test:folder2');
    // sort by Entries desc (numeric default): 348 > 161 > 97
    host.querySelector('.stable-th[data-col="count"]').dispatchEvent(new dom.window.Event('click'));
    assert.deepEqual(names(host), ['nestalgiamusic', 'ReimaginedAI80s', 'CGTioMusic']);
    // filter to "music"
    const input = host.querySelector('.stable-filter');
    input.value = 'music'; input.dispatchEvent(new dom.window.Event('input'));
    assert.deepEqual(names(host).sort(), ['CGTioMusic', 'nestalgiamusic']);
  } finally { teardown(dom); }
});

test('Books folders render a 3-column (Name|Books|Size) sortable table, no Length', () => {
  const dom = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderBookFolders(host, { byFolder: [
      { folderName: 'Fiction', count: 40, totalSizeBytes: 5 * 1024 ** 3 },
      { folderName: 'Manuals', count: 12, totalSizeBytes: 800 * 1024 ** 2 },
    ] });
    const headers = Array.from(host.querySelectorAll('.stable-th')).map((t) => t.textContent);
    assert.deepEqual(headers, ['Name', 'Books', 'Size'], 'no Length column for books');
    assert.deepEqual(names(host), ['Fiction', 'Manuals'], 'default Size desc');
  } finally { teardown(dom); }
});

test('v1.160: Most watched is a Title|Plays sortable table, default Plays desc, no rank prefix', () => {
  const dom = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderMostWatched(host, [
      { title: 'Rewatched Lots', viewCount: 40 },
      { title: 'Watched Once', viewCount: 1 },
      { title: 'Middle', viewCount: 12 },
    ]);
    const headers = Array.from(host.querySelectorAll('.stable-th')).map((t) => t.textContent);
    assert.deepEqual(headers, ['Title', 'Plays']);
    assert.deepEqual(names(host), ['Rewatched Lots', 'Middle', 'Watched Once'], 'default Plays desc (the ranking)');
    assert.ok(!names(host)[0].startsWith('1.'), 'no "N." rank prefix (sorting redefines rank)');
    // Plays shows the raw count (header says Plays); sort by title works too
    host.querySelector('.stable-th[data-col="title"]').dispatchEvent(new dom.window.Event('click'));
    assert.deepEqual(names(host), ['Middle', 'Rewatched Lots', 'Watched Once'], 'title asc');
  } finally { teardown(dom); }
});

test('v1.160: Under the hood fill class lifts the 240px cap but keeps padding (not a .stable table)', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.folder-list-builder--fill\s*\{[^}]*max-height:\s*none/, 'the fill class lifts the cap');
  assert.doesNotMatch(css, /\.folder-list-builder--fill\s*\{[^}]*padding:\s*0/, 'fill KEEPS card padding (only -host zeroes it for a .stable table)');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'stats.html'), 'utf8');
  assert.match(html, /id="stats-inventory-list"[^>]*folder-list-builder--fill|folder-list-builder--fill[^>]*id="stats-inventory-list"/, 'Under the hood uses the fill class');
  assert.match(html, /id="stats-most-watched-list"[^>]*stats-table-host|stats-table-host[^>]*id="stats-most-watched-list"/, 'Most watched uses the table-host fill');
});

test('empty groups keep the friendly blurb (no empty table)', () => {
  const dom = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderBreakdownList(host, [], (g) => g.folderName, 'No folders yet.', 'ft-test:folder3');
    assert.ok(!host.querySelector('.stable'), 'no table for an empty breakdown');
    assert.match(host.textContent, /No folders yet\./);
  } finally { teardown(dom); }
});
