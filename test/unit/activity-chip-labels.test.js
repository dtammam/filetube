'use strict';

// [UNIT] v1.55 Track A (Dean: "the reheats, the repulls... it just shows one
// off download. That should be clearer") - batch-activity entries in the
// oneShots namespace now name themselves by OPERATION in the corner chip.
// Every server producer already stamps `kind` (verified in the exec plan);
// these tests drive the CLIENT half: naming, batch-counter status text, the
// real processed/total bar, the never-retryable rule (the chip's Retry fires
// the one-shot retry route, which is wrong for a fixed batch id), and the
// collapsed summary treating running activities as first-class.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  ACTIVITY_CHIP_LABELS,
  formatActivityStatusText,
  buildDownloadChipItem,
  downloadChipItemShowsPercent,
  formatDownloadChipSummary,
  reduceDownloadChipState,
} = require('../../public/js/common.js');

// The four fixed batch ids/kinds the servers emit today (lib/ytdlp/index.js:
// repull/repull-item/refresh-avatars; server.js: attribute-bulk).
test('every known activity kind maps to an operation label, never "One-off download"', () => {
  assert.deepEqual(Object.keys(ACTIVITY_CHIP_LABELS).sort(),
    ['attribute-bulk', 'refresh-avatars', 'repull', 'repull-item']);
  const item = buildDownloadChipItem('oneshot', 'repull-metadata', {
    kind: 'repull', state: 'running', total: 200, done: 10, skipped: 1, failed: 1, current: 'Some Video',
  });
  assert.equal(item.name, 'Reheating library');
  assert.equal(item.activityKind, 'repull');
  assert.equal(buildDownloadChipItem('oneshot', 'repull-metadata-item', { kind: 'repull-item', state: 'running', total: 1, current: 'T' }).name, 'Reheating video');
  assert.equal(buildDownloadChipItem('oneshot', 'refresh-avatars', { kind: 'refresh-avatars', state: 'running', total: 5 }).name, 'Refreshing avatars');
  assert.equal(buildDownloadChipItem('oneshot', 'attribute-bulk', { kind: 'attribute-bulk', state: 'running', total: 30, done: 2 }).name, 'Attributing videos');
});

test('an UNKNOWN kind falls through to the old one-shot naming - a future producer degrades, never breaks', () => {
  const item = buildDownloadChipItem('oneshot', 'future-thing', { kind: 'defrag-library', state: 'running' });
  assert.equal(item.name, 'One-off download');
  assert.equal(item.activityKind, undefined, 'not misclassified as a known activity');
});

test('a real one-shot download is untouched: title naming, retryable on error', () => {
  const dl = buildDownloadChipItem('oneshot', 'job1', { state: 'error', title: 'My Video', error: 'boom' });
  assert.equal(dl.name, 'My Video');
  assert.equal(dl.retryable, true, 'downloads keep their Retry');
});

test('statusText: processed (done+skipped+failed) of total, with the current item', () => {
  assert.equal(formatActivityStatusText({ kind: 'repull', state: 'running', total: 200, done: 10, skipped: 1, failed: 1, current: 'Some Video' }),
    '12 of 200 — Some Video');
  assert.equal(formatActivityStatusText({ kind: 'refresh-avatars', state: 'running', total: 12, done: 3, current: 'Chan' }),
    '3 of 12 — Chan');
});

test('statusText: a single-item batch (flame-button reheat) leads with the video, no "1 of 1" noise', () => {
  assert.equal(formatActivityStatusText({ kind: 'repull-item', state: 'running', total: 1, done: 0, current: 'My Video' }),
    'My Video');
});

test('statusText: attribute-bulk surfaces its moved tally; terminal states mirror the one-off wording', () => {
  assert.equal(formatActivityStatusText({ kind: 'attribute-bulk', state: 'running', total: 30, done: 12, moved: 10 }),
    '12 of 30 — 10 moved');
  assert.equal(formatActivityStatusText({ state: 'cancelled' }), 'Cancelled');
  assert.equal(formatActivityStatusText({ state: 'error', error: 'disk full' }), 'disk full');
  assert.equal(formatActivityStatusText({ state: 'running' }), 'Running…', 'no counters at all still says something honest');
});

test('the bar is REAL batch progress (processed/total), shown only while running with a determinate basis', () => {
  const batch = buildDownloadChipItem('oneshot', 'repull-metadata', {
    kind: 'repull', state: 'running', total: 200, done: 40, skipped: 8, failed: 2,
  });
  assert.equal(batch.percent, 25, '50 of 200 processed = 25%');
  assert.equal(downloadChipItemShowsPercent(batch), true);
  const single = buildDownloadChipItem('oneshot', 'repull-metadata-item', { kind: 'repull-item', state: 'running', total: 1, current: 'T' });
  assert.equal(downloadChipItemShowsPercent(single), false, 'a single-item batch shows no bar - never a fake 0%');
  const errored = buildDownloadChipItem('oneshot', 'repull-metadata', { kind: 'repull', state: 'error', total: 200, done: 10 });
  assert.equal(downloadChipItemShowsPercent(errored), false, 'a terminal batch shows text, not a frozen bar');
});

test('an errored batch is NEVER retryable - the chip Retry would fire the one-shot retry route against a batch id', () => {
  const errored = buildDownloadChipItem('oneshot', 'repull-metadata', { kind: 'repull', state: 'error', total: 200, done: 10 });
  assert.equal(errored.retryable, false);
});

test('collapsed summary: a lone running reheat headlines by operation, not the empty string', () => {
  const state = reduceDownloadChipState({
    oneShots: { 'repull-metadata': { kind: 'repull', state: 'running', total: 200, done: 10, skipped: 1, failed: 1, current: 'Some Video' } },
  }, new Set());
  assert.equal(state.count, 1);
  assert.equal(formatDownloadChipSummary(state), 'Reheating library — 12 of 200 — Some Video');
});

test('collapsed summary: a download and a running batch co-headline, joined with the middot', () => {
  const state = reduceDownloadChipState({
    oneShots: {
      job1: { state: 'downloading', title: 'My Video', percent: 47 },
      'refresh-avatars': { kind: 'refresh-avatars', state: 'running', total: 12, done: 3 },
    },
  }, new Set());
  const summary = formatDownloadChipSummary(state);
  assert.match(summary, /My Video/);
  assert.match(summary, / · Refreshing avatars/);
});

test('collapsed summary: failed batches are "tasks failed", never "downloads failed"', () => {
  const state = reduceDownloadChipState({
    oneShots: { 'repull-metadata': { kind: 'repull', state: 'error', error: 'boom', total: 5 } },
  }, new Set());
  assert.equal(formatDownloadChipSummary(state), '1 task failed');
  const mixedDownloads = reduceDownloadChipState({
    oneShots: { job1: { state: 'error', title: 'Vid', error: 'x' } },
  }, new Set());
  assert.equal(formatDownloadChipSummary(mixedDownloads), '1 download failed', 'pure-download wording unchanged');
});
