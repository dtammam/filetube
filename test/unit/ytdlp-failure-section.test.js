'use strict';

// [UNIT] v1.47.4 item 7 -- the Download-failures section's pure builders.
//
// Dean: "If any downloads fail I'd like it to be explicitly logged and have the
// error so one can look in posterity. It should be able to be cleared/deleted
// as well."
//
// jsdom-backed, mirroring this repo's other client-builder tests. The load-
// bearing properties are (a) the verbatim error text actually reaches the DOM,
// (b) untrusted yt-dlp text is rendered as TEXT and never parsed as markup, and
// (c) a subtitle-fallback row never reads as a lost download.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const {
  filterFailureEntries,
  formatFailureKindLabel,
  createFailureRow,
  createFailureListElement,
  createFailureSectionElement,
  FAILURE_SOURCE_FILTERS,
} = require('../../lib/ytdlp/client/subscriptions.js');

function doc() {
  return new JSDOM('<!doctype html><html><body></body></html>').window.document;
}

function entry(overrides = {}) {
  return {
    id: 'id-1',
    ts: '2026-07-27T12:00:00.000Z',
    source: 'one-off',
    videoId: 'vid1',
    title: 'Some Video',
    url: 'https://www.youtube.com/watch?v=vid1',
    reason: 'ERROR: Video unavailable',
    ...overrides,
  };
}

// ---- filterFailureEntries (pure) -------------------------------------------

test('filterFailureEntries: filters by source', () => {
  const entries = [entry({ id: 'a', source: 'one-off' }), entry({ id: 'b', source: 'subscription' })];
  assert.deepEqual(filterFailureEntries(entries, 'one-off').map((e) => e.id), ['a']);
  assert.deepEqual(filterFailureEntries(entries, 'subscription').map((e) => e.id), ['b']);
  assert.deepEqual(filterFailureEntries(entries, 'all').map((e) => e.id), ['a', 'b']);
});

test('filterFailureEntries: an unknown/absent filter FAILS TOWARD VISIBILITY', () => {
  // Silently hiding a failure is the one outcome this whole feature exists to
  // prevent, so anything unrecognized must show everything rather than nothing.
  const entries = [entry({ id: 'a' }), entry({ id: 'b', source: 'subscription' })];
  for (const bad of [undefined, null, '', 'nonsense', 42, {}]) {
    assert.equal(filterFailureEntries(entries, bad).length, 2, `${JSON.stringify(bad)} must show everything`);
  }
  assert.deepEqual(filterFailureEntries(null, 'all'), []);
});

test('FAILURE_SOURCE_FILTERS covers exactly the sources faillog can persist', () => {
  assert.deepEqual(FAILURE_SOURCE_FILTERS, ['all', 'one-off', 'subscription']);
});

// ---- formatFailureKindLabel (pure) -----------------------------------------

test('formatFailureKindLabel: a subtitle-fallback row NEVER reads as a lost download', () => {
  // The video landed; only its captions did not. Wording it as a failure would
  // be a lie about what is on disk.
  assert.match(formatFailureKindLabel(entry({ subtitleFallback: true })), /saved without captions/);
  assert.doesNotMatch(formatFailureKindLabel(entry({ subtitleFallback: true })), /download failed/);
  assert.match(formatFailureKindLabel(entry()), /download failed/);
});

test('formatFailureKindLabel: subtitleFallback must be STRICTLY true to soften the wording', () => {
  // A truthy-ish value must not silently upgrade a real failure into a partial
  // success -- that would under-report an actually-missing video.
  for (const truthy of ['true', 1, {}, [], 'yes']) {
    assert.match(formatFailureKindLabel(entry({ subtitleFallback: truthy })), /download failed/);
  }
});

test('formatFailureKindLabel: names the source', () => {
  assert.match(formatFailureKindLabel(entry({ source: 'subscription' })), /^Subscription/);
  assert.match(formatFailureKindLabel(entry({ source: 'one-off' })), /^One-off/);
  assert.match(formatFailureKindLabel(entry({ source: 'nonsense' })), /^One-off/, 'unknown source falls back');
  assert.doesNotThrow(() => formatFailureKindLabel(null));
});

// ---- createFailureRow ------------------------------------------------------

test('createFailureRow: renders the VERBATIM error text', () => {
  const d = doc();
  const reason = "ERROR: Unable to download video subtitles for 'en-en-US': HTTP Error 429: Too Many Requests";
  const row = createFailureRow(entry({ reason }), d, {});
  assert.equal(row.querySelector('.sub-row-failures').textContent, reason,
    'the operator needs the real error, not a summary');
});

test('SECURITY: untrusted yt-dlp text is rendered as TEXT, never parsed as markup', () => {
  const d = doc();
  const hostile = '<img src=x onerror=alert(1)>';
  const row = createFailureRow(entry({ reason: hostile, title: hostile, url: hostile }), d, {});
  assert.equal(row.querySelectorAll('img').length, 0, 'no element may be created from stderr text');
  assert.equal(row.querySelector('.sub-row-failures').textContent, hostile, 'shown literally');
});

test('createFailureRow: a row is never anonymous (title -> videoId -> placeholder)', () => {
  const d = doc();
  assert.equal(createFailureRow(entry({ title: '' }), d, {}).querySelector('.sub-row-name').textContent, 'vid1');
  assert.equal(
    createFailureRow(entry({ title: '', videoId: '' }), d, {}).querySelector('.sub-row-name').textContent,
    'Unknown item',
  );
});

test('createFailureRow: a missing reason still says something honest', () => {
  const d = doc();
  const row = createFailureRow(entry({ reason: '' }), d, {});
  assert.equal(row.querySelector('.sub-row-failures').textContent, 'Unknown error');
});

test('createFailureRow: the delete control passes the entry id and only exists when addressable', () => {
  const d = doc();
  const deleted = [];
  const row = createFailureRow(entry({ id: 'abc' }), d, { onDelete: (id) => deleted.push(id) });
  const btn = row.querySelector('button');
  assert.ok(btn, 'a deletable row offers a delete control');
  btn.dispatchEvent(new d.defaultView.Event('click'));
  assert.deepEqual(deleted, ['abc']);

  // An entry with no id cannot be addressed by the DELETE route, so offering a
  // control that could never work would be a lie.
  assert.equal(createFailureRow(entry({ id: '' }), d, { onDelete: () => {} }).querySelector('button'), null);
  assert.equal(createFailureRow(entry(), d, {}).querySelector('button'), null, 'no handler -> no control');
});

// ---- createFailureListElement ----------------------------------------------

test('createFailureListElement: renders one row per entry, in the given order', () => {
  const d = doc();
  const el = createFailureListElement([entry({ id: 'a', title: 'First' }), entry({ id: 'b', title: 'Second' })], d, {});
  const names = [...el.querySelectorAll('.sub-row-name')].map((n) => n.textContent);
  // faillog.readFailures already returns newest-first; this must not re-order.
  assert.deepEqual(names, ['First', 'Second']);
});

test('createFailureListElement: an ACTIVE FILTER never reads as a clean bill of health', () => {
  const d = doc();
  assert.match(createFailureListElement([], d, { filtered: false }).textContent, /No download failures recorded/);
  assert.match(createFailureListElement([], d, { filtered: true }).textContent, /No failures match this filter/);
});

// ---- createFailureSectionElement -------------------------------------------

test('createFailureSectionElement: a collapsible details card reusing the existing section/list classes', () => {
  // v1.55 Track D (DELIBERATE lock update): details/summary now, with the
  // persistence key; open by default so the layout matches yesterday until
  // the user collapses it. The filter/clear controls live in the body row,
  // never inside the summary (they would toggle the disclosure).
  const d = doc();
  const { section, list } = createFailureSectionElement(d, {});
  assert.equal(section.tagName, 'DETAILS');
  assert.equal(section.className, 'setup-box sub-collapsible');
  assert.equal(section.open, true);
  assert.equal(section.getAttribute('data-collapse-key'), 'download-failures');
  assert.equal(list.className, 'sub-list');
  assert.match(section.querySelector('summary').textContent, /Download failures/);
  assert.ok(section.querySelector('.sub-list-header select'), 'controls stay in the body header row');
  assert.equal(section.querySelector('summary select'), null, 'no controls inside the summary');
});

test('createFailureSectionElement: the filter offers exactly the supported sources and defaults to all', () => {
  const d = doc();
  const { select } = createFailureSectionElement(d, {});
  assert.deepEqual([...select.options].map((o) => o.value), FAILURE_SOURCE_FILTERS);
  assert.equal(select.value, 'all', 'a failure must never be hidden by a filter the user did not set');
});

test('createFailureSectionElement: the filter and clear controls invoke their handlers', () => {
  const d = doc();
  const seen = { filter: [], cleared: 0 };
  const { select, clearBtn } = createFailureSectionElement(d, {
    onFilterChange: (v) => seen.filter.push(v),
    onClear: () => { seen.cleared += 1; },
  });
  select.value = 'subscription';
  select.dispatchEvent(new d.defaultView.Event('change'));
  clearBtn.dispatchEvent(new d.defaultView.Event('click'));
  assert.deepEqual(seen.filter, ['subscription']);
  assert.equal(seen.cleared, 1);
});

test('createFailureSectionElement: builds without handlers (defensive, never throws)', () => {
  assert.doesNotThrow(() => createFailureSectionElement(doc(), undefined));
  assert.doesNotThrow(() => createFailureSectionElement(doc(), {}));
});
