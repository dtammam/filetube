'use strict';

// [UNIT] v1.64 -- public/js/history.js pure row builders (DOM-free, the
// music-view.test.js posture). Escaping, the relative-when labels (nowMs
// injected -- the near-today-date-literals lesson), the bar threshold, and
// the no-inline-width contract; interaction wiring is jsdom-smoked
// (shell-smoke) and device-validated.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  escapeHistoryHtml, formatHistoryDuration, formatHistoryWhen, historyBarPercent, buildHistoryRowEl, historyMetaText,
} = require('../../public/js/history.js');

const NOW = Date.parse('2026-07-20T12:00:00.000Z');
const at = (iso) => formatHistoryWhen(iso, NOW);

test('escapeHistoryHtml neutralizes the five HTML metacharacters; null/undefined -> empty', () => {
  assert.equal(escapeHistoryHtml('<img src=x onerror="pwn()">&\'q\''), '&lt;img src=x onerror=&quot;pwn()&quot;&gt;&amp;&#039;q&#039;');
  assert.equal(escapeHistoryHtml(null), '');
  assert.equal(escapeHistoryHtml(undefined), '');
});

test('formatHistoryDuration: m:ss / h:mm:ss; empty for zero/garbage', () => {
  assert.equal(formatHistoryDuration(65), '1:05');
  assert.equal(formatHistoryDuration(3600 + 5 * 60 + 3), '1:05:03');
  assert.equal(formatHistoryDuration(0), '');
  assert.equal(formatHistoryDuration('nope'), '');
});

test('formatHistoryWhen: the full ladder, deterministic via injected now', () => {
  assert.equal(at('2026-07-20T11:59:40.000Z'), 'Just now');
  assert.equal(at('2026-07-20T11:59:00.000Z'), '1 minute ago');
  assert.equal(at('2026-07-20T11:15:00.000Z'), '45 minutes ago');
  assert.equal(at('2026-07-20T09:00:00.000Z'), '3 hours ago');
  assert.equal(at('2026-07-19T10:00:00.000Z'), 'Yesterday');
  assert.equal(at('2026-07-16T12:00:00.000Z'), '4 days ago');
  assert.equal(at('2026-07-06T12:00:00.000Z'), '2 weeks ago');
  assert.equal(at('2026-04-20T12:00:00.000Z'), '3 months ago');
  assert.equal(at('2024-07-20T12:00:00.000Z'), '2 years ago');
  assert.equal(at(null), '', 'a legacy null stamp renders no label, never a lie');
  assert.equal(at('garbage'), '');
  assert.equal(at('2026-07-20T12:05:00.000Z'), 'Just now', 'a small future skew clamps to now');
});

test('historyBarPercent: >0.5 threshold (the home-card rule), watched -> no partial bar, clamped to 100', () => {
  assert.equal(historyBarPercent({ progressPercent: 0.4 }), null);
  assert.equal(historyBarPercent({ progressPercent: 0.5 }), null, 'exactly 0.5 is NOT >0.5 (adversarial gate: binds <= against a < mutant)');
  assert.equal(historyBarPercent({ progressPercent: 0.51 }), 0.51);
  assert.equal(historyBarPercent({ progressPercent: 43.2 }), 43.2);
  assert.equal(historyBarPercent({ progressPercent: 250 }), 100);
  assert.equal(historyBarPercent({ progressPercent: 60, watchState: 'watched' }), null, 'the Watched chip carries completion; no partial bar');
  assert.equal(historyBarPercent({}), null);
  assert.equal(historyBarPercent({ progressPercent: NaN }), null);
});

// UI pass sweep S2 (converts the v1.64 row-markup locks, AC12): the row is a
// ui-row built as DOM (textContent only - so escaping is structural, and the
// hostile-text binds read the TEXT back), with a ui-thumb (duration + resume bar
// as the --p data property), the meta line, and ONE reserved Remove slot.
const { JSDOM } = require('jsdom');
const rowOf = (item, now) => buildHistoryRowEl(item, now, new JSDOM('<!doctype html><body></body>').window.document);

test('buildHistoryRowEl: hostile titles AND channel names are TEXT, the row carries data-id, and no inline style is ever written but the --p data property', () => {
  const row = rowOf({
    // A hostile CHANNEL too (adversarial gate W2): folder names come from
    // on-disk dirnames, and '<img onerror=...>' is a legal Linux dirname.
    id: 'abc123', title: '<script>alert(1)</script>', channelName: '<img src=x onerror=alert(2)>', folderName: 'Chan',
    duration: 65, progressPercent: 43.2, watchState: 'watching', lastWatchedAt: '2026-07-20T09:00:00.000Z', type: 'video',
  }, NOW);
  assert.strictEqual(row.querySelectorAll('script').length, 0, 'the title never parses');
  assert.strictEqual(row.querySelectorAll('img').length, 1, 'only the thumbnail image - the channel never parses');
  assert.strictEqual(row.querySelector('.ui-row__link').textContent, '<script>alert(1)</script>', 'the title renders as text');
  assert.match(row.querySelector('.ui-row__meta').textContent, /^<img src=x onerror=alert\(2\)> · 3 hours ago$/, 'the channel renders as text');
  assert.strictEqual(row.getAttribute('data-id'), 'abc123');
  assert.strictEqual(row.querySelector('.ui-row__link').getAttribute('href'), '/watch.html?v=abc123');
  assert.strictEqual(row.querySelector('.ui-thumb__duration').textContent, '1:05');
  assert.ok(Math.abs(Number(row.querySelector('.ui-thumb__bar').style.getPropertyValue('--p')) - 0.432) < 1e-9, 'the resume bar rides the ui-thumb data property (43.2%)');
  for (const el of row.querySelectorAll('[style]')) assert.match(el.getAttribute('style'), /^--p: [\d.]+;$/, 'no visual inline style');
  const remove = row.querySelector('.ui-row__actions > .history-remove');
  assert.ok(remove && remove.classList.contains('ui-btn') && remove.classList.contains('ui-btn--icon'), 'the ONE action slot holds the Remove ui-btn');
  assert.strictEqual(remove.getAttribute('data-id'), 'abc123');
  assert.strictEqual(remove.getAttribute('aria-label'), 'Remove from history');
});

test('buildHistoryRowEl: v1.114 A2 strips a leading "@" so a handle-as-name shows the name (the standalone History page was an un-swept surface)', () => {
  const meta = historyMetaText({ id: 'x', title: 'V', channelName: '@Apple' }, Date.now());
  assert.ok(meta.startsWith('Apple') && !meta.includes('@Apple'), 'renders "Apple", not "@Apple"');
});

test('buildHistoryRowEl: a watched item says Watched in its meta and shows no partial bar; a zero-duration item shows no badge', () => {
  const watched = rowOf({ id: 'w1', title: 'Done', duration: 100, progressPercent: 97, watchState: 'watched', lastWatchedAt: '2026-07-19T10:00:00.000Z' }, NOW);
  assert.match(watched.querySelector('.ui-row__meta').textContent, / · Watched$/);
  assert.strictEqual(watched.querySelector('.ui-thumb__progress'), null, 'watched -> no partial bar');
  const audio = rowOf({ id: 'a1', title: 'Song', type: 'audio', duration: 0, progressPercent: 0, watchState: 'new' }, NOW);
  assert.strictEqual(audio.querySelector('.ui-thumb__duration'), null, 'the thumbnail shows only a real duration (D8.5)');
});
