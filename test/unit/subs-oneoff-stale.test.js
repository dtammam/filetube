'use strict';

// [UNIT] v1.365.0 W3 (plan 2026-10-05-small-phones-pocket-downloads-vr): the /subscriptions page tells a STUCK
// server from a STALE page, with the corner chip's words and threshold (common.js formatDownloadStaleNote /
// formatDownloadOfflineText, the globals the shell provides). The REAL view (test/helpers/subs-view-harness.js)
// on the mock clock: a failed status poll shows "Can't reach FileTube, last checked Ns ago" above the list until
// a poll succeeds (both axes, from a populated page); a running one-off the server has not touched for over a
// minute says "updated Ns ago" on the SERVER's clock, and a fresh update clears it.

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const common = require('../../public/js/common.js');
const subs = require('../../lib/ytdlp/client/subscriptions.js');
const { mountSubsView, jsonRes } = require('../helpers/subs-view-harness');

const T0 = Date.UTC(2026, 9, 5, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString();
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

let view = null;
afterEach(() => {
  try { if (view) view.handlers.destroy(); } catch (_) { /* best effort */ }
  if (view) view.window.close();
  view = null;
  mock.timers.reset();
  for (const k of ['window', 'document', 'fetch', 'localStorage', 'formatDownloadStaleNote', 'formatDownloadOfflineText']) delete global[k];
});

function mount(statusFn) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 });
  global.formatDownloadStaleNote = common.formatDownloadStaleNote;
  global.formatDownloadOfflineText = common.formatDownloadOfflineText;
  view = mountSubsView((method, url) => {
    if (method === 'GET' && url === '/api/subscriptions/status') return statusFn();
    return undefined;
  });
  // The harness's jsdom is not "visual", so document.hidden reads true and the view would park its poll.
  Object.defineProperty(view.document, 'hidden', { value: false, configurable: true });
  return view;
}
const snapAt = (ageMs) => ({ now: iso(Date.now()), subscriptions: {}, oneShots: { j1: { state: 'downloading', percent: 47, label: 'Folder', url: 'https://youtu.be/x', updatedAt: iso(Date.now() - ageMs) } } });
const offlineEl = (d) => d.querySelector('.subs-offline');
const ageOf = (d) => { const el = d.querySelector('.ui-row[data-job-id="j1"] .subs-oneshot-age'); return el ? el.textContent : ''; };

test('/subscriptions: a failed poll on a POPULATED page shows "Can\'t reach FileTube, last checked Ns ago"; the next good poll clears it', async () => {
  let failing = false;
  const { document } = mount(() => (failing ? Promise.reject(new TypeError('Failed to fetch')) : jsonRes(200, snapAt(1000))));
  mock.timers.tick(2600); await flush();
  assert.ok(document.querySelector('.ui-row[data-job-id="j1"]'), 'precondition: the one-off row rendered');
  assert.ok(offlineEl(document), 'the offline line is mounted');
  assert.strictEqual(offlineEl(document).hidden, true, 'hidden while polls succeed');
  failing = true;
  mock.timers.tick(1000); await flush();
  mock.timers.tick(6000); await flush();
  assert.strictEqual(offlineEl(document).hidden, false);
  assert.match(offlineEl(document).textContent, /^Can't reach FileTube, last checked \d+s ago$/);
  assert.ok(document.querySelector('.ui-row[data-job-id="j1"]'), 'the row keeps its last state');
  failing = false;
  mock.timers.tick(31000); await flush();
  assert.strictEqual(offlineEl(document).hidden, true, 'the first good poll clears it');
  assert.strictEqual(offlineEl(document).textContent, '');
});

test('/subscriptions: a running one-off untouched for over 60 s on the server says "updated Ns ago"; a fresh update clears it', async () => {
  let age = 90 * 1000;
  const { document } = mount(() => jsonRes(200, snapAt(age)));
  mock.timers.tick(2600); await flush();
  assert.strictEqual(ageOf(document), 'updated 90s ago');
  age = 1000;
  mock.timers.tick(3000); await flush();
  assert.strictEqual(ageOf(document), '', 'cleared by a fresh server update');
});

test('oneShotStaleNote: terminal and activity entries never age; no clock or no updatedAt, no note', () => {
  global.formatDownloadStaleNote = common.formatDownloadStaleNote;
  global.formatDownloadOfflineText = common.formatDownloadOfflineText;
  const old = iso(T0 - 300000);
  assert.strictEqual(subs.oneShotStaleNote({ state: 'downloading', updatedAt: old }, T0), 'updated 5 min ago');
  assert.strictEqual(subs.oneShotStaleNote({ state: 'queued', updatedAt: old }, T0), 'updated 5 min ago');
  for (const st of ['done', 'error', 'cancelled']) assert.strictEqual(subs.oneShotStaleNote({ state: st, updatedAt: old }, T0), '', st);
  assert.strictEqual(subs.oneShotStaleNote({ state: 'running', kind: 'repull-metadata', updatedAt: old }, T0), '');
  assert.strictEqual(subs.oneShotStaleNote({ state: 'downloading' }, T0), '');
  assert.strictEqual(subs.oneShotStaleNote({ state: 'downloading', updatedAt: old }, NaN), '');
  assert.strictEqual(subs.formatStatusOfflineText(T0 - 12000, T0), "Can't reach FileTube, last checked 12s ago");
  delete global.formatDownloadOfflineText;
  assert.strictEqual(subs.formatStatusOfflineText(T0 - 12000, T0), "Can't reach FileTube", 'without common.js, the bare words');
});

test('the one-off list signature carries the age note, so a row re-renders when only its age changes', () => {
  const e = { state: 'downloading', label: 'F', url: 'u' };
  assert.notStrictEqual(subs.computeOneShotsSignature({ j: { ...e, staleNote: '' } }), subs.computeOneShotsSignature({ j: { ...e, staleNote: 'updated 90s ago' } }));
});
