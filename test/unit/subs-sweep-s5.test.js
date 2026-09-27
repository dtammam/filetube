'use strict';

// [UNIT] UI pass S5 - the Subscriptions page on the primitives (plan D5, D8.9, F24,
// F32, F40, AC5). jsdom + the REAL ui.js: every DOM builder in
// lib/ytdlp/client/subscriptions.js the page draws with - the channel row, its menu
// items, the settings sheet, the poll's in-place repaint, the list and its A-Z
// sections, the skeleton / error / empty states, the Activity panes' history rows and
// the one-off rows.
//
// AC12: this file REPLACES the fake-DOM builder tests that
// test/unit/ytdlp-subscriptions-client.test.js carried for the retired `.sub-row` /
// `.sub-sheet` markup (row anatomy, click routing, pin/bell/kebab, the meta and status
// lines, failures + Skip, the cookie warning, Retry, the settings-sheet fields and
// patch, XSS inertness, the poll-never-clobbers-the-sheet invariant, history and
// one-off rows, updateOneShotsContainer). Each contract below names the old one it
// carries forward.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const S = require('../../lib/ytdlp/client/subscriptions.js');

const NOW = Date.parse('2026-09-27T12:00:00.000Z');
const HOUR = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const newDoc = () => new JSDOM('<!doctype html><body></body>').window.document;
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.Event('click', { bubbles: true, cancelable: true }));
const metaText = (row) => row.querySelector('.subs-meta').textContent;
const HOSTILE = '<img src=x onerror=alert(1)><script>alert(2)</script>';

// ---- the one meta line (D8.9, F24) -------------------------------------------

test('formatAgo: compact relative times, and "" for anything unparseable', () => {
  assert.strictEqual(S.formatAgo(iso(NOW - 20e3), NOW), 'just now');
  assert.strictEqual(S.formatAgo(iso(NOW - 5 * 60e3), NOW), '5m ago');
  assert.strictEqual(S.formatAgo(iso(NOW - 2 * HOUR), NOW), '2h ago');
  assert.strictEqual(S.formatAgo(NOW - 3 * 24 * HOUR, NOW), '3d ago');
  assert.strictEqual(S.formatAgo(iso(NOW + HOUR), NOW), 'just now', 'a future stamp never reads negative');
  for (const bad of [undefined, null, '', 'garbage', {}, NaN]) assert.strictEqual(S.formatAgo(bad, NOW), '', String(bad));
});

test('parseStatusCounts reads the server\'s own composed lastStatus shapes', () => {
  assert.deepStrictEqual(S.parseStatusCounts('ok: downloaded 3 new video(s)'), { newCount: 3, failedCount: 0 });
  assert.deepStrictEqual(S.parseStatusCounts('partial: downloaded 2 new video(s), 1 failed: HTTP 403'), { newCount: 2, failedCount: 1 });
  assert.deepStrictEqual(S.parseStatusCounts('ok: no new videos'), { newCount: 0, failedCount: 0 });
  assert.deepStrictEqual(S.parseStatusCounts(undefined), { newCount: 0, failedCount: 0 });
});

test('formatRowMeta: ONE line - "3 new · checked 2h ago", "Checked 2h ago", "Check failed · 2h ago" (error tone), paused leads, never-checked says so', () => {
  const at = iso(NOW - 2 * HOUR);
  const m = (sub, live) => S.formatRowMeta(sub, live, NOW);
  assert.deepStrictEqual([m({ lastCheckedAt: at, lastStatus: 'ok: downloaded 3 new video(s)' }).text, m({ lastCheckedAt: at, lastStatus: 'ok: downloaded 3 new video(s)' }).newText],
    ['3 new · checked 2h ago', '3 new']);
  assert.strictEqual(m({ lastCheckedAt: at, lastStatus: 'ok: no new videos' }).text, 'Checked 2h ago');
  const failed = m({ lastCheckedAt: at, lastStatus: 'error: HTTP Error 403: Forbidden' });
  assert.deepStrictEqual([failed.text, failed.tone], ['Check failed · 2h ago', 'error']);
  assert.doesNotMatch(failed.text, /403/, 'the raw error text lives in the sheet, never the row (F24)');
  assert.deepStrictEqual([m({ lastCheckedAt: at, lastStatus: 'partial: downloaded 2 new video(s), 1 failed: x' }).text, m({ lastCheckedAt: at, lastStatus: 'partial: downloaded 2 new video(s), 1 failed: x' }).tone],
    ['2 new · 1 failed · 2h ago', 'partial']);
  assert.strictEqual(m({ paused: true, lastCheckedAt: at, lastStatus: 'ok' }).text, 'Paused · checked 2h ago');
  assert.strictEqual(m({ lastCheckedAt: null }).text, 'Not checked yet');
  // quality / cutoff / URL never reach the row line (F24)
  const busy = m({ lastCheckedAt: at, lastStatus: 'ok', quality: '720p', cutoffDate: '20260102', channelUrl: 'https://x' });
  assert.doesNotMatch(busy.text, /720p|2026-01-02|https|quality|Subscribed/);
});

test('formatRowMeta: a live in-flight state wins outright; a live error reads as a failed check; a live partial done reads its own line', () => {
  const sub = { lastCheckedAt: iso(NOW - 5 * HOUR), lastStatus: 'ok: downloaded 3 new video(s)' };
  assert.deepStrictEqual(S.formatRowMeta(sub, { state: 'downloading', title: 'Clip', index: 1, total: 3, percent: 42 }, NOW),
    { tone: 'live', newText: '', parts: ['Clip — 1 of 3 — 42%'], text: 'Clip — 1 of 3 — 42%' });
  assert.strictEqual(S.formatRowMeta(sub, { state: 'error', error: 'boom', updatedAt: iso(NOW - 60e3) }, NOW).text, 'Check failed · 1m ago');
  assert.strictEqual(S.formatRowMeta(sub, { state: 'error', error: 'boom', updatedAt: iso(NOW - 60e3) }, NOW).tone, 'error');
  assert.strictEqual(S.formatRowMeta(sub, { state: 'done', outcome: 'partial', updatedAt: iso(NOW) }, NOW).text, 'Some downloads failed · just now');
  assert.strictEqual(S.formatRowMeta(sub, { state: 'idle' }, NOW).text, '3 new · checked 5h ago', 'an idle live entry is no override');
});

// ---- the row (D4.3, AC5, F32, F40) ---------------------------------------------

test('createSubscriptionRow: a ui-row - avatar media, the name as the title, ONE meta line, and exactly three trailing slots (pin, bell, menu)', () => {
  const d = newDoc();
  const row = S.createSubscriptionRow({ id: 's1', name: 'Alpha', channelDir: '/dl/Alpha', pushBell: true, lastCheckedAt: iso(NOW - 2 * HOUR), lastStatus: 'ok: downloaded 3 new video(s)' }, d, {}, undefined, true, NOW);
  assert.match(row.className, /^ui-row ui-row--default/);
  assert.strictEqual(row.getAttribute('role'), 'listitem');
  assert.strictEqual(row.getAttribute('data-sub-id'), 's1');
  assert.ok(row.querySelector('.ui-row__media > .ui-avatar.ui-avatar--md'), 'a circular channel avatar (decision 7)');
  assert.strictEqual(row.querySelector('.ui-row__title').textContent, 'Alpha');
  assert.strictEqual(row.querySelectorAll('.ui-row__meta').length, 1, 'ONE meta line');
  assert.strictEqual(metaText(row), '3 new · checked 2h ago');
  assert.strictEqual(row.querySelector('.subs-meta__new').textContent, '3 new', 'the new count is the only bold word');
  const acts = [...row.querySelector('.ui-row__actions').children].map((c) => c.className.split(' ').pop());
  assert.deepStrictEqual(acts, ['subs-pin', 'subs-bell', 'subs-more']);
  // no URL, no quality, no dates, no failure lines, no inline Retry (F24, F40)
  assert.strictEqual(row.querySelector('a[href^="http"]'), null, 'the channel URL moved to the sheet');
  assert.strictEqual([...row.querySelectorAll('button')].filter((b) => /Retry|Skip/.test(b.textContent)).length, 0, 'no inline Retry/Skip button');
});

test('createSubscriptionRow: an optional pin never moves a column - a row without a channelDir reserves an EMPTY pin slot (AC5, F40)', () => {
  const d = newDoc();
  const withPin = S.createSubscriptionRow({ id: 'a', name: 'A', channelDir: '/d/A' }, d, {});
  const noPin = S.createSubscriptionRow({ id: 'b', name: 'B' }, d, {});
  const shape = (r) => [...r.querySelector('.ui-row__actions').children].map((c) => (c.tagName === 'BUTTON' ? 'btn' : c.className));
  assert.deepStrictEqual(shape(withPin), ['btn', 'btn', 'btn']);
  assert.deepStrictEqual(shape(noPin), ['ui-row__slot', 'btn', 'btn'], 'the pin slot is reserved, the bell and menu stay put');
  assert.strictEqual(noPin.querySelector('.subs-pin'), null);
  // a row with no id has no bell (the flag is a record field) - its slot is reserved too
  const anon = S.createSubscriptionRow({ name: 'C', channelDir: '/d/C' }, d, {});
  assert.deepStrictEqual(shape(anon), ['btn', 'ui-row__slot', 'btn']);
  assert.strictEqual(anon.getAttribute('data-sub-id'), null, 'no bogus id attribute');
});

test('createSubscriptionRow: Pin is keep/keep.fill and Notify is the bell states only (F32) - pressed follows the flags, never a colour class', () => {
  const d = newDoc();
  const glyph = (b) => b.querySelector('.ui-btn__icon use').getAttribute('href');
  const on = S.createSubscriptionRow({ id: 's', name: 'N', channelDir: '/d', pushBell: true }, d, {}, undefined, true);
  const off = S.createSubscriptionRow({ id: 's', name: 'N', channelDir: '/d', pushBell: false }, d, {}, undefined, false);
  assert.deepStrictEqual([glyph(on.querySelector('.subs-pin')), on.querySelector('.subs-pin').getAttribute('aria-pressed')], ['#i-keep-fill', 'true']);
  assert.deepStrictEqual([glyph(off.querySelector('.subs-pin')), off.querySelector('.subs-pin').getAttribute('aria-pressed')], ['#i-keep', 'false']);
  assert.deepStrictEqual([glyph(on.querySelector('.subs-bell')), on.querySelector('.subs-bell').getAttribute('aria-pressed')], ['#i-notifications_active', 'true']);
  assert.deepStrictEqual([glyph(off.querySelector('.subs-bell')), off.querySelector('.subs-bell').getAttribute('aria-pressed')], ['#i-notifications_off', 'false']);
  assert.strictEqual(on.querySelector('.subs-more .ui-btn__icon use').getAttribute('href'), '#i-more_vert');
  for (const b of [...on.querySelectorAll('.ui-row__actions button')]) {
    assert.doesNotMatch(b.className, /active|gold|primary|danger/, 'no state colour class on a row control');
  }
});

test('createSubscriptionRow click routing: the row (its title link) opens settings; pin, bell and menu each call ONLY their own handler', () => {
  const d = newDoc();
  const calls = [];
  const sub = { id: 's1', name: 'Alpha', channelDir: '/dl/Alpha' };
  const row = S.createSubscriptionRow(sub, d, {
    onOpenSettings: (s) => calls.push(['settings', s.id]),
    onTogglePin: (s, pinned) => calls.push(['pin', s.id, pinned]),
    onToggleBell: (s) => calls.push(['bell', s.id]),
    onMenu: (s, btn) => calls.push(['menu', s.id, btn.className.includes('subs-more')]),
  }, undefined, true);
  d.body.appendChild(row);
  click(row.querySelector('.ui-row__link'));
  click(row.querySelector('.subs-pin'));
  click(row.querySelector('.subs-bell'));
  click(row.querySelector('.subs-more'));
  assert.deepStrictEqual(calls, [['settings', 's1'], ['pin', 's1', true], ['bell', 's1'], ['menu', 's1', true]]);
  // the row link is a real button stretched over the row (keyboard reachable)
  assert.strictEqual(row.querySelector('.ui-row__link').tagName, 'BUTTON');
  // a row with no channelDir still opens settings (v1.155)
  const bare = S.createSubscriptionRow({ id: 's2', name: 'B' }, d, { onOpenSettings: (s) => calls.push(['settings', s.id]) });
  click(bare.querySelector('.ui-row__link'));
  assert.deepStrictEqual(calls.pop(), ['settings', 's2']);
});

test('createSubscriptionRow: hostile name / status / live error are inert TEXT (XSS regression)', () => {
  const d = newDoc();
  const row = S.createSubscriptionRow({ id: 's', name: HOSTILE, channelDir: '/d', channelUrl: 'https://youtube.com/@x', lastCheckedAt: iso(NOW - HOUR), lastStatus: 'error: ' + HOSTILE }, d, {}, { state: 'downloading', title: HOSTILE, percent: 5 });
  assert.strictEqual(row.querySelectorAll('img:not(.ui-avatar__img), script').length, 0, 'no element parsed from data');
  assert.strictEqual(row.querySelector('.ui-row__title').textContent, HOSTILE, 'the name renders literally');
  assert.match(metaText(row), /<img src=x/, 'the live title renders literally');
  assert.match(row.querySelector('.subs-more').getAttribute('aria-label'), /<img src=x/, 'even inside an attribute it is just text');
});

test('createSubscriptionRow: a channel photo is an <img> in ui-avatar (trimmed URL); none -> the monogram; a broken image falls back to the monogram', () => {
  const d = newDoc();
  const withImg = S.createSubscriptionRow({ id: 's', name: 'Alpha Beta', channelAvatarUrl: '  https://yt3.example/a.jpg  ' }, d, {});
  const img = withImg.querySelector('.ui-avatar__img');
  assert.ok(img);
  assert.strictEqual(img.getAttribute('src'), 'https://yt3.example/a.jpg');
  assert.strictEqual(img.getAttribute('alt'), '');
  img.dispatchEvent(new d.defaultView.Event('error'));
  assert.strictEqual(withImg.querySelector('.ui-avatar__img'), null);
  assert.strictEqual(withImg.querySelector('.ui-avatar__mono').textContent, 'AB');
  const mono = S.createSubscriptionRow({ id: 's', name: '' }, d, {});
  assert.strictEqual(mono.querySelector('.ui-avatar__mono').textContent, '?', 'a missing name -> "?" monogram');
  assert.strictEqual(mono.querySelector('.ui-row__title').textContent, '(untitled subscription)');
});

test('createSubscriptionRow: a failed check reads "Check failed" in the error tone; a paused channel is marked data-paused', () => {
  const d = newDoc();
  const failed = S.createSubscriptionRow({ id: 'f', name: 'F', lastCheckedAt: iso(NOW - 2 * HOUR), lastStatus: 'error: HTTP Error 403' }, d, {}, undefined, false, NOW);
  assert.strictEqual(failed.querySelector('.subs-meta').getAttribute('data-tone'), 'error');
  assert.strictEqual(metaText(failed), 'Check failed · 2h ago');
  const paused = S.createSubscriptionRow({ id: 'p', name: 'P', paused: true }, d, {});
  assert.ok(paused.hasAttribute('data-paused'));
  assert.ok(!failed.hasAttribute('data-paused'));
});

// ---- the row menu (F40, F33) -------------------------------------------------

test('buildRowMenuItems: Settings, Check now / Retry (Retry exactly while the row reads failed), Pause/Resume, playlist, channel page, Unsubscribe LAST and danger', () => {
  const calls = [];
  const h = {};
  for (const k of ['onOpenSettings', 'onRepull', 'onTogglePause', 'onViewPlaylist', 'onOpenChannel', 'onUnsubscribe']) h[k] = (s) => calls.push([k, s.id]);
  const ok = { id: 'a', name: 'A', channelDir: '/d', channelUrl: 'https://y/@a', lastStatus: 'ok' };
  const items = S.buildRowMenuItems(ok, undefined, h);
  assert.deepStrictEqual(items.map((i) => i.label), ['Settings', 'Check now', 'Pause checks', 'View as playlist', 'Open channel page', 'Unsubscribe']);
  assert.deepStrictEqual(items.map((i) => !!i.danger), [false, false, false, false, false, true], 'only Unsubscribe is danger');
  items.forEach((i) => i.onSelect());
  assert.deepStrictEqual(calls.map((c) => c[0]), ['onOpenSettings', 'onRepull', 'onTogglePause', 'onViewPlaylist', 'onOpenChannel', 'onUnsubscribe']);
  assert.strictEqual(S.buildRowMenuItems({ ...ok, lastStatus: 'error: x' }, undefined, h)[1].label, 'Retry', 'a failed row offers Retry (in the menu, F40)');
  assert.strictEqual(S.buildRowMenuItems({ ...ok, lastStatus: 'partial: x' }, undefined, h)[1].label, 'Retry');
  assert.strictEqual(S.buildRowMenuItems(ok, { state: 'error', error: 'e' }, h)[1].label, 'Retry', 'a live error too');
  assert.strictEqual(S.buildRowMenuItems({ ...ok, paused: true }, undefined, h)[2].label, 'Resume checks');
  const bare = S.buildRowMenuItems({ id: 'b', name: 'B' }, undefined, h).map((i) => i.label);
  assert.deepStrictEqual(bare, ['Settings', 'Check now', 'Pause checks', 'Unsubscribe'], 'no playlist without a channelDir, no page without a URL');
});

// ---- the poll's in-place repaint (FR-1, AC22) -----------------------------------

test('applyStatusUpdatesInPlace repaints ONLY each row\'s meta line - same row, same meta element, never touching an open settings sheet', () => {
  const d = newDoc();
  const sub = { id: 's1', name: 'A', lastCheckedAt: iso(NOW - HOUR), lastStatus: 'ok' };
  const row = S.createSubscriptionRow(sub, d, {}, undefined, false, NOW);
  const metaEl = row.querySelector('.subs-meta');
  const sheet = S.buildSettingsSheet(sub, d, {}, undefined);
  const sheetInput = sheet.querySelector('input[type="date"]');
  sheetInput.value = '2026-01-02'; // an unsaved edit
  const sheetBefore = sheet.outerHTML;
  S.applyStatusUpdatesInPlace({ s1: row }, [sub], { subscriptions: { s1: { state: 'downloading', title: 'T', percent: 50 } } }, {}, d, NOW);
  assert.strictEqual(row.querySelector('.subs-meta'), metaEl, 'the same meta element (no rebuild)');
  assert.strictEqual(metaText(row), 'T — 50%');
  assert.strictEqual(sheet.outerHTML, sheetBefore, 'the sheet is untouched');
  assert.strictEqual(sheetInput.value, '2026-01-02', 'the unsaved edit survives');
  // recovery: the live entry goes idle -> the persisted line comes back
  S.applyStatusUpdatesInPlace({ s1: row }, [sub], { subscriptions: { s1: { state: 'error', error: 'x', updatedAt: iso(NOW) } } }, {}, d, NOW);
  assert.strictEqual(row.querySelector('.subs-meta').getAttribute('data-tone'), 'error');
  S.applyStatusUpdatesInPlace({ s1: row }, [sub], { subscriptions: {} }, {}, d, NOW);
  assert.strictEqual(metaText(row), 'Checked 1h ago');
  assert.strictEqual(row.querySelector('.subs-meta').getAttribute('data-tone'), 'ok');
  assert.doesNotThrow(() => S.applyStatusUpdatesInPlace({}, [sub], {}, {}, d));
  assert.doesNotThrow(() => S.applyStatusUpdatesInPlace(null, [sub], {}, {}, d));
});

// ---- the settings sheet (D4.6, D4.10, F24) ----------------------------------------

function sheetFor(sub, handlers, live) {
  const d = newDoc();
  const el = S.buildSettingsSheet(sub, d, handlers || {}, live);
  d.body.appendChild(el);
  const fields = {};
  el.querySelectorAll('.ui-field').forEach((f) => { fields[f.querySelector('.ui-field__label').textContent] = f.querySelector('input, select'); });
  const btn = (label) => [...el.querySelectorAll('button')].find((b) => b.textContent === label);
  return { d, el, fields, btn, skip: el.querySelector('.ui-switch') };
}

test('buildSettingsSheet: ui-select / ui-field / ui-switch fields pre-filled from the record (minutes, YYYY-MM-DD), the channel name read-only', () => {
  const { el, fields, skip } = sheetFor({ id: 's', name: 'Alpha', format: 'audio', quality: '720p', filetype: 'opus', cutoffDate: '20260102', minDurationSeconds: 300, maxDurationSeconds: 3600, skipShorts: true, libraryPlace: 'podcasts' });
  assert.deepStrictEqual(Object.keys(fields), ['Type', 'Quality', 'File type', 'Published on or after', 'Min length (minutes)', 'Max length (minutes)', 'File under']);
  assert.strictEqual(fields.Type.value, 'audio');
  assert.strictEqual(fields.Type.className, 'ui-select__native');
  assert.strictEqual(fields.Quality.value, '720p');
  assert.strictEqual(fields['File type'].value, 'opus');
  assert.deepStrictEqual([...fields['File type'].options].map((o) => o.value), ['mp3', 'm4a', 'opus', 'default'], 'the audio set');
  assert.strictEqual(fields['Published on or after'].value, '2026-01-02');
  assert.strictEqual(fields['Min length (minutes)'].value, '5');
  assert.strictEqual(fields['Max length (minutes)'].value, '60');
  assert.strictEqual(fields['File under'].value, 'podcasts');
  assert.strictEqual(skip.getAttribute('aria-checked'), 'true');
  assert.ok(el.querySelector('.ui-select__chevron'), 'the select chevron is the sprite glyph');
  assert.strictEqual([...el.querySelectorAll('input')].filter((i) => i.value === 'Alpha').length, 0, 'no input backs the name (v1.25 T3)');
});

test('buildSettingsSheet: Save sends the patch - minutes in, seconds out; blank date / durations omitted; 0 kept; the switch and the file-under always travel', () => {
  const saves = [];
  const { fields, btn, skip } = sheetFor({ id: 's', name: 'A', format: 'video', quality: 'best', filetype: 'mp4' }, { onSave: (id, patch) => saves.push([id, patch]) });
  click(btn('Save'));
  assert.deepStrictEqual(saves.pop(), ['s', { format: 'video', quality: 'best', filetype: 'mp4', skipShorts: false, libraryPlace: 'default' }], 'blank = unchanged: no cutoffDate / durations');
  fields['Published on or after'].value = '2026-03-04';
  fields['Min length (minutes)'].value = '2';
  fields['Max length (minutes)'].value = '0';
  click(skip);
  fields.Type.value = 'audio';
  fields.Type.dispatchEvent(new fields.Type.ownerDocument.defaultView.Event('change'));
  click(btn('Save'));
  assert.deepStrictEqual(saves.pop(), ['s', { format: 'audio', quality: 'best', filetype: 'mp3', skipShorts: true, libraryPlace: 'default', cutoffDate: '20260304', minDurationSeconds: 120, maxDurationSeconds: 0 }],
    'the format change repopulated the file type; minutes -> seconds; 0 = unlimited kept');
});

test('buildSettingsSheet: the details the row dropped live here - the full last-check line, the subscribed date, the channel URL as a real link', () => {
  const { el } = sheetFor({ id: 's', name: 'A', addedAt: iso(NOW - 30 * 24 * HOUR), channelUrl: 'https://www.youtube.com/@a', lastCheckedAt: iso(NOW - HOUR), lastStatus: 'ok: downloaded 3 new video(s)' });
  assert.match(el.querySelector('.subs-sheet-status').textContent, /^Last checked: .* — ok: downloaded 3 new video\(s\)/);
  assert.match(el.querySelector('.subs-sheet-about').textContent, /Subscribed on /);
  const link = el.querySelector('a.subs-sheet-link');
  assert.strictEqual(link.getAttribute('href'), 'https://www.youtube.com/@a');
  assert.strictEqual(link.getAttribute('target'), '_blank');
  assert.strictEqual(link.getAttribute('rel'), 'noopener noreferrer');
});

test('buildSettingsSheet: per-video failures with Skip (videoId only, onSkip wired), the cookie warning, and hostile text inert', async () => {
  const skips = [];
  let resolveSkip;
  const live = { state: 'error', error: 'e', warning: true, failures: [{ videoId: 'v1', title: HOSTILE, reason: 'r1' }, { videoId: null, reason: 'r2' }] };
  const { el } = sheetFor({ id: 's', name: 'A' }, { onSkip: (subId, vid) => { skips.push([subId, vid]); return new Promise((r) => { resolveSkip = r; }); } }, live);
  const lines = [...el.querySelectorAll('.subs-sheet-failure')];
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].querySelector('.subs-reason').textContent, HOSTILE + ': r1', 'literal text');
  assert.strictEqual(el.querySelectorAll('script, img:not(.ui-avatar__img)').length, 0);
  const skip = lines[0].querySelector('button.subs-skip');
  assert.ok(skip, 'an attributable failure offers Skip');
  assert.strictEqual(lines[1].querySelector('button'), null, 'an unattributed one does not');
  assert.match(el.textContent, /Cookies file is configured but missing/);
  click(skip);
  assert.deepStrictEqual(skips, [['s', 'v1']]);
  assert.strictEqual(skip.disabled, true);
  click(skip);
  assert.strictEqual(skips.length, 1, 'a second tap mid-flight sends nothing');
  resolveSkip(true);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(skip.querySelector('.ui-btn__stack').getAttribute('data-label'), 'Skipped');
  assert.strictEqual(skip.disabled, true, 'stays done');
  // no onSkip -> no Skip button
  const plain = sheetFor({ id: 's', name: 'A' }, {}, live).el;
  assert.strictEqual(plain.querySelector('button.subs-skip'), null);
});

test('buildSettingsSheet: the actions - ONE primary (Save), Check now / Pause-Resume secondary, Unsubscribe danger on its own line; each calls only its handler', () => {
  const calls = [];
  const sub = { id: 's', name: 'A', paused: true };
  const { el, btn } = sheetFor(sub, {
    onSave: () => calls.push('save'), onRepull: (id) => calls.push(['repull', id]),
    onTogglePause: (s) => calls.push(['pause', s.paused]), onDelete: (s) => calls.push(['delete', s.id]),
  });
  assert.strictEqual(el.querySelectorAll('.ui-btn--primary').length, 1);
  assert.strictEqual(btn('Save').classList.contains('ui-btn--primary'), true);
  assert.ok(btn('Resume'), 'a paused channel offers Resume');
  assert.strictEqual(btn('Unsubscribe').classList.contains('ui-btn--danger'), true);
  assert.strictEqual(btn('Unsubscribe').parentNode.className, 'subs-sheet-danger', 'apart from Save');
  click(btn('Check now')); click(btn('Resume')); click(btn('Unsubscribe'));
  assert.deepStrictEqual(calls, [['repull', 's'], ['pause', true], ['delete', 's']]);
  assert.strictEqual(sheetFor({ id: 's', name: 'A' }).btn('Pause').textContent, 'Pause');
});

// ---- the list, its sections and states (D9) -----------------------------------------

test('createSubscriptionsListElement: A-Z sections, each a ui-list with the SAME reserved columns; rows alphabetical; pinned flags from the Set', () => {
  const d = newDoc();
  const subs = [{ id: '2', name: 'beta', channelDir: '/b' }, { id: '1', name: 'Alpha', channelDir: '/a' }, { id: '3', name: '9 Lives' }];
  const el = S.createSubscriptionsListElement(subs, d, {}, {}, new Set(['/a']));
  assert.deepStrictEqual([...el.querySelectorAll('.subs-letter')].map((h) => h.textContent), ['A', 'B', '#'], 'the # bucket last, iOS-Contacts style');
  const lists = [...el.querySelectorAll('.ui-list')];
  assert.strictEqual(new Set(lists.map((l) => l.className)).size, 1, 'every section list declares the same columns');
  assert.match(lists[0].className, /ui-list--media-avatar/);
  assert.match(lists[0].className, /ui-list--actions-3/);
  assert.deepStrictEqual([...el.querySelectorAll('.ui-row[data-sub-id]')].map((r) => r.getAttribute('data-sub-id')), ['1', '2', '3']);
  assert.strictEqual(el.querySelector('[data-sub-id="1"] .subs-pin').getAttribute('aria-pressed'), 'true');
  assert.strictEqual(el.querySelector('[data-sub-id="2"] .subs-pin').getAttribute('aria-pressed'), 'false');
  assert.doesNotThrow(() => S.createSubscriptionsListElement(subs, d, {}, undefined, undefined));
});

test('createSubscriptionsListElement: empty -> a ui.state (first run vs a search that matches nothing)', () => {
  const d = newDoc();
  const first = S.createSubscriptionsListElement([], d, {});
  assert.strictEqual(first.querySelector('.ui-state .ui-state__title').textContent, 'No subscriptions yet');
  const none = S.createSubscriptionsListElement([], d, {}, {}, new Set(), { emptyMessage: 'No channels match your search.' });
  assert.strictEqual(none.querySelector('.ui-state__title').textContent, 'No channels match your search.');
  assert.strictEqual(none.querySelectorAll('.ui-row').length, 0);
});

test('buildErrorStateNode: a ui.state error with a Retry button handed back to the caller', () => {
  const d = newDoc();
  const { node, retryBtn } = S.buildErrorStateNode('Could not load your subscriptions.', d);
  assert.ok(node.classList.contains('ui-state'));
  assert.strictEqual(node.querySelector('.ui-state__title').textContent, 'Could not load your subscriptions.');
  assert.ok(node.querySelector('.ui-state__icon use[href="#i-error"]'));
  assert.ok(retryBtn && retryBtn.textContent === 'Retry');
  assert.strictEqual(S.buildErrorStateNode('', d).node.querySelector('.ui-state__title').textContent, 'Something went wrong.');
});

// ---- the Activity panes' history rows and the one-off rows ---------------------------

test('createHistoryRow / createHistoryListElement: ui-rows in the given order; outcome + time in one meta line with the tone; reasons in full; hostile text inert', () => {
  const d = newDoc();
  const list = S.createHistoryListElement([
    { name: 'First', ts: iso(NOW), outcome: 'success' },
    { name: HOSTILE, ts: iso(NOW - HOUR), outcome: 'partial', failures: [{ videoId: 'v', reason: 'r' }] },
    { name: '  ', ts: 'bad', outcome: 'error', failures: [{ title: 'T', reason: 'E' }] },
  ], d);
  const rows = [...list.querySelectorAll('.ui-row')];
  assert.deepStrictEqual(rows.map((r) => r.querySelector('.ui-row__title').textContent), ['First', HOSTILE, 'Unknown']);
  assert.deepStrictEqual(rows.map((r) => r.querySelector('.subs-meta').getAttribute('data-tone')), ['ok', 'partial', 'error']);
  assert.match(rows[0].querySelector('.subs-meta').textContent, /^Success · /);
  assert.strictEqual(rows[0].querySelector('.subs-reason'), null, 'no failures line on a success');
  assert.match(rows[1].querySelector('.subs-reason').textContent, /v: r/);
  assert.match(rows[2].querySelector('.subs-meta').textContent, /^Failed · unknown time/);
  assert.strictEqual(list.querySelectorAll('script, img').length, 0);
  assert.strictEqual(S.createHistoryListElement([], d).textContent, 'No download history yet.');
});

test('createOneShotRow / createOneShotsListElement: ui-rows with ONE reserved action slot (Dismiss icon); status + URL as text; hostile inert', () => {
  const d = newDoc();
  const dismissed = [];
  const list = S.createOneShotsListElement({ j1: { label: HOSTILE, url: 'https://y/' + HOSTILE, state: 'downloading', percent: 10, title: 'Clip' }, j2: { state: 'error', error: 'bad' } }, d, { onDismiss: (id) => dismissed.push(id) });
  const ul = list.querySelector('.ui-list');
  assert.match(ul.className, /ui-list--actions-1/);
  const rows = [...ul.querySelectorAll('.ui-row')];
  assert.strictEqual(rows[0].querySelector('.ui-row__title').textContent, HOSTILE);
  assert.match(rows[0].querySelector('.subs-meta').textContent, /^Clip — 10%/);
  assert.strictEqual(rows[1].querySelector('.ui-row__title').textContent, 'One-off');
  assert.strictEqual(rows[1].querySelector('.subs-meta').getAttribute('data-tone'), 'error');
  assert.strictEqual(list.querySelectorAll('script, img').length, 0);
  click(rows[1].querySelector('.subs-oneshot-dismiss'));
  assert.deepStrictEqual(dismissed, ['j2']);
  assert.strictEqual(rows[0].querySelector('.subs-oneshot-dismiss').getAttribute('aria-label'), 'Dismiss');
  assert.strictEqual(S.createOneShotsListElement({}, d, {}).textContent, 'No one-off downloads in progress.');
});

test('updateOneShotsContainer: an unchanged snapshot is NO DOM churn; a changed / removed / first render rebuilds and advances the signature', () => {
  const d = newDoc();
  const container = d.createElement('div');
  const snap = { j1: { label: 'A', url: 'u', state: 'downloading', percent: 10 } };
  const sig1 = S.updateOneShotsContainer(container, snap, d, {}, null);
  assert.ok(sig1, 'a first render always builds');
  const node = container.firstChild;
  assert.strictEqual(S.updateOneShotsContainer(container, { j1: { ...snap.j1, format: 'audio' } }, d, {}, sig1), sig1, 'an unrendered field changes nothing');
  assert.strictEqual(container.firstChild, node, 'same child node');
  const sig2 = S.updateOneShotsContainer(container, { j1: { ...snap.j1, percent: 50 } }, d, {}, sig1);
  assert.notStrictEqual(sig2, sig1);
  assert.notStrictEqual(container.firstChild, node, 'rebuilt');
  assert.match(container.textContent, /50%/);
  S.updateOneShotsContainer(container, {}, d, {}, sig2);
  assert.strictEqual(container.textContent, 'No one-off downloads in progress.', 'a dismissed job rebuilds to the empty line');
});
