'use strict';

// [UNIT] v1.64 -- public/js/history.js pure row builders (DOM-free, the
// music-view.test.js posture). Escaping, the relative-when labels (nowMs
// injected -- the near-today-date-literals lesson), the bar threshold, and
// the no-inline-width contract; interaction wiring is jsdom-smoked
// (shell-smoke) and device-validated.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  escapeHistoryHtml, formatHistoryDuration, formatHistoryWhen, historyBarPercent, buildHistoryRowHtml,
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

test('buildHistoryRowHtml: escapes hostile titles AND channel names, carries data-id, and NEVER emits an inline style attribute', () => {
  const html = buildHistoryRowHtml({
    // A hostile CHANNEL too (adversarial gate W2): folder names come from
    // on-disk dirnames, and '<img onerror=...>' is a legal Linux dirname --
    // the channel escape must be BOUND, not merely present.
    id: 'abc123', title: '<script>alert(1)</script>', channelName: '<img src=x onerror=alert(2)>', folderName: 'Chan',
    duration: 65, progressPercent: 43.2, watchState: 'watching', lastWatchedAt: '2026-07-20T09:00:00.000Z', type: 'video',
  }, NOW);
  assert.ok(!html.includes('<script>alert'), 'title is escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped title still renders as text');
  assert.ok(!html.includes('<img src=x'), 'channel is escaped');
  assert.ok(html.includes('&lt;img src=x onerror=alert(2)&gt;'), 'escaped channel still renders as text');
  assert.ok(html.includes('data-id="abc123"'));
  assert.ok(html.includes('href="/watch.html?v=abc123"'));
  assert.ok(html.includes('3 hours ago'));
  assert.ok(html.includes('1:05'));
  assert.ok(html.includes('data-pct="43.2"'), 'the bar width travels as data, wired to --history-pct after insertion');
  assert.ok(!/style\s*=/.test(html), 'no inline style attribute, ever (#71/ratchet posture)');
});

test('buildHistoryRowHtml: v1.114 A2 strips a leading "@" so a handle-as-name shows the name (the standalone History page was an un-swept surface)', () => {
  const html = buildHistoryRowHtml({ id: 'x', title: 'V', channelName: '@Apple' }, Date.now());
  assert.ok(html.includes('Apple') && !html.includes('@Apple'), 'renders "Apple", not "@Apple"');
});

test('buildHistoryRowHtml: watched item gets the chip and no bar; audio gets the Audio badge', () => {
  const watched = buildHistoryRowHtml({ id: 'w1', title: 'Done', duration: 100, progressPercent: 97, watchState: 'watched', lastWatchedAt: '2026-07-19T10:00:00.000Z' }, NOW);
  assert.ok(watched.includes('history-watched-chip'));
  assert.ok(!watched.includes('history-bar-fill'));
  const audio = buildHistoryRowHtml({ id: 'a1', title: 'Song', type: 'audio', duration: 0, progressPercent: 0, watchState: 'new' }, NOW);
  assert.ok(audio.includes('>Audio<'));
});
