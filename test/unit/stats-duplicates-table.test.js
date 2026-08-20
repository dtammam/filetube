'use strict';

// [UNIT] v1.159 (Dean): the Duplicates report renders each section as a sortable
// `.stable` table (Duplicate | Copies | Total | Reclaim), and - the key change -
// sorts groups by Reclaimable DESC BEFORE the 50-group cap so the biggest
// offenders always survive it (the old order was arbitrary). The per-file paths
// live in the wrapping name cell.

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

function makeGroups(n, wastedFor) {
  const g = [];
  for (let i = 0; i < n; i += 1) {
    g.push({ key: `dup-${i}.mp4`, totalBytes: 1000 + i, wastedBytes: wastedFor(i),
      items: [{ filePath: `/a/dup-${i}.mp4`, size: 500 }, { filePath: `/b/dup-${i}.mp4`, size: 500 }] });
  }
  return g;
}

test('a section renders a sortable table with the Duplicate/Copies/Total/Reclaim columns + file paths', () => {
  const dom = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderDuplicates(host, { nameGroups: [
      { key: 'clip.mp4', totalBytes: 2000, wastedBytes: 1000, items: [{ filePath: '/x/clip.mp4', size: 1000 }, { filePath: '/y/clip.mp4', size: 1000 }] },
    ], idGroups: [] });
    const headers = Array.from(host.querySelectorAll('.stable-th')).map((t) => t.textContent).filter(Boolean);
    assert.deepEqual(headers, ['Duplicate', 'Copies', 'Total', 'Reclaim']);
    assert.ok(host.querySelector('.dup-key'), 'the group key cell');
    assert.strictEqual(host.querySelectorAll('.dup-path').length, 2, 'both file paths shown in the wrap cell');
    assert.match(host.querySelector('.stable-section-title').textContent, /Same filename/);
  } finally { teardown(dom); }
});

test('sort-before-cap: the top-50 shown are the 50 with the MOST reclaimable, not an arbitrary 50', () => {
  const dom = mount();
  try {
    const host = global.document.getElementById('host');
    // 60 groups; group i has wastedBytes = i (so group 59 is the biggest). The
    // old code sliced the FIRST 50 (0..49) - dropping the biggest offenders.
    stats.renderDuplicates(host, { nameGroups: makeGroups(60, (i) => i), idGroups: [] });
    const cap = stats.DUPLICATE_GROUPS_RENDER_CAP;
    const keys = Array.from(host.querySelectorAll('.dup-key')).map((k) => k.textContent);
    assert.strictEqual(keys.length, cap, `capped at ${cap} rows`);
    // the biggest (dup-59, wasted 59) MUST be present; the smallest (dup-0) must NOT
    assert.ok(keys.includes('dup-59.mp4'), 'the biggest-reclaimable group survives the cap');
    assert.ok(!keys.includes('dup-0.mp4'), 'the smallest is dropped by the cap');
    assert.match(host.textContent, /and 10 more groups/, 'the CSV-overflow line still shows');
  } finally { teardown(dom); }
});

test('no duplicates -> the friendly all-unique blurb, no table', () => {
  const dom = mount();
  try {
    const host = global.document.getElementById('host');
    stats.renderDuplicates(host, { nameGroups: [], idGroups: [] });
    assert.ok(!host.querySelector('.stable'));
    assert.match(host.textContent, /every filename and video id in the library is unique/);
  } finally { teardown(dom); }
});
