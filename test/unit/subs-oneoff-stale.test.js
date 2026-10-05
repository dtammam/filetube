'use strict';

// [UNIT] v1.365.0 W3 (plan 2026-10-05-small-phones-pocket-downloads-vr): the /subscriptions page tells a STUCK
// server from a STALE page, with the corner chip's words and threshold (common.js formatDownloadStaleNote /
// formatDownloadOfflineText, the globals the shell provides). The REAL view (test/helpers/subs-view-harness.js)
// on the mock clock: a failed status poll shows "Can't reach FileTube, last reached Ns ago" above the list until
// a poll succeeds (both axes, from a populated page); a running one-off the server has not touched for over a
// minute says "updated Ns ago" on the SERVER's clock, and a fresh update clears it. Gate r1: the same age rules
// as the chip (queued "waiting N", merging none), ages hidden offline and with no `now`, both on the server
// clock; an age tick updates in place (the Dismiss button survives); a 401 says "Signed out"; a throw in page
// code after a good poll is counted, never "Can't reach FileTube".

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
  for (const k of ['window', 'document', 'fetch', 'localStorage', 'formatDownloadStaleNote', 'formatDownloadOfflineText', 'formatDownloadRowAge']) delete global[k];
});

function mount(statusFn) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 });
  global.formatDownloadStaleNote = common.formatDownloadStaleNote;
  global.formatDownloadOfflineText = common.formatDownloadOfflineText;
  global.formatDownloadRowAge = common.formatDownloadRowAge;
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

test('/subscriptions: a failed poll on a POPULATED page shows "Can\'t reach FileTube, last reached Ns ago"; the next good poll clears it', async () => {
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
  assert.match(offlineEl(document).textContent, /^Can't reach FileTube, last reached \d+s ago$/);
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
  global.formatDownloadRowAge = common.formatDownloadRowAge;
  const old = iso(T0 - 300000);
  assert.strictEqual(subs.oneShotStaleNote({ state: 'downloading', updatedAt: old }, T0), 'updated 5 min ago');
  assert.strictEqual(subs.oneShotStaleNote({ state: 'queued', updatedAt: old }, T0), 'waiting 5 min');
  assert.strictEqual(subs.oneShotStaleNote({ state: 'downloading', phase: 'merging', updatedAt: old }, T0), '');
  for (const st of ['done', 'error', 'cancelled']) assert.strictEqual(subs.oneShotStaleNote({ state: st, updatedAt: old }, T0), '', st);
  assert.strictEqual(subs.oneShotStaleNote({ state: 'running', kind: 'repull-metadata', updatedAt: old }, T0), '');
  assert.strictEqual(subs.oneShotStaleNote({ state: 'downloading' }, T0), '');
  assert.strictEqual(subs.oneShotStaleNote({ state: 'downloading', updatedAt: old }, NaN), '');
  assert.strictEqual(subs.formatStatusOfflineText(T0 - 12000, T0), "Can't reach FileTube, last reached 12s ago");
  delete global.formatDownloadOfflineText;
  assert.strictEqual(subs.formatStatusOfflineText(T0 - 12000, T0), "Can't reach FileTube", 'without common.js, the bare words');
});

test('gate r1 (qa S1): the one-off list signature leaves the age note OUT (an age tick never rebuilds the list)', () => {
  const e = { state: 'downloading', label: 'F', url: 'u' };
  assert.strictEqual(subs.computeOneShotsSignature({ j: { ...e, staleNote: '' } }), subs.computeOneShotsSignature({ j: { ...e, staleNote: 'updated 90s ago' } }));
});

// ---- gate r1 ---------------------------------------------------------------------------

const rowAgeOf = (d, id) => { const el = d.querySelector(`.ui-row[data-job-id="${id}"] .subs-oneshot-age`); return el ? el.textContent : ''; };
const liveSubs = () => require('../../lib/ytdlp/client/subscriptions.js'); // the harness's fresh instance

test('/subscriptions gate r1: queued says "waiting N"; a merging row shows no age', async () => {
  const { document } = mount(() => jsonRes(200, {
    now: iso(Date.now()),
    subscriptions: {},
    oneShots: {
      q: { state: 'queued', label: 'Q', updatedAt: iso(Date.now() - 180000) },
      m: { state: 'downloading', phase: 'merging', label: 'M', updatedAt: iso(Date.now() - 300000) },
    },
  }));
  mock.timers.tick(2600); await flush();
  assert.ok(document.querySelector('.ui-row[data-job-id="m"]'), 'precondition: rows rendered');
  assert.strictEqual(rowAgeOf(document, 'q'), 'waiting 3 min');
  assert.strictEqual(rowAgeOf(document, 'm'), '');
});

test('/subscriptions gate r1: the age is on the SERVER clock: a server 3 h behind the phone changes nothing (adversary X7)', async () => {
  const { document } = mount(() => {
    const serverNow = Date.now() - 3 * 3600 * 1000;
    return jsonRes(200, { now: iso(serverNow), subscriptions: {}, oneShots: { j1: { state: 'downloading', label: 'F', updatedAt: iso(serverNow - 30000) } } });
  });
  mock.timers.tick(2600); await flush();
  assert.ok(document.querySelector('.ui-row[data-job-id="j1"]'), 'precondition: the row rendered');
  assert.strictEqual(ageOf(document), '', '30 s old on the server clock: no age');
});

test('/subscriptions gate r1: no `now` in the snapshot, no age (adversary N2)', async () => {
  const { document } = mount(() => { const s = snapAt(10 * 60 * 1000); delete s.now; return jsonRes(200, s); });
  mock.timers.tick(2600); await flush();
  assert.ok(document.querySelector('.ui-row[data-job-id="j1"]'), 'precondition: the row rendered');
  assert.strictEqual(ageOf(document), '');
});

test('/subscriptions gate r1: offline hides every row age; the next good poll shows it again', async () => {
  let failing = false;
  const { document } = mount(() => (failing ? Promise.reject(new TypeError('Failed to fetch')) : jsonRes(200, snapAt(90000))));
  mock.timers.tick(2600); await flush();
  assert.strictEqual(ageOf(document), 'updated 90s ago', 'precondition: aged while online');
  failing = true;
  mock.timers.tick(1000); await flush();
  mock.timers.tick(6000); await flush();
  assert.strictEqual(offlineEl(document).hidden, false, 'precondition: offline shown');
  assert.strictEqual(ageOf(document), '', 'offline: no row age');
  assert.ok(document.querySelector('.ui-row[data-job-id="j1"]'), 'the row itself stays');
  failing = false;
  mock.timers.tick(31000); await flush();
  assert.strictEqual(offlineEl(document).hidden, true);
  assert.strictEqual(ageOf(document), 'updated 90s ago');
});

test('/subscriptions gate r1 (qa S1): an age tick updates the text IN PLACE; the Dismiss button node survives', async () => {
  const { document } = mount(() => jsonRes(200, snapAt(61000 + (Date.now() - T0))));
  mock.timers.tick(2600); await flush();
  const before = ageOf(document);
  assert.match(before, /^updated \d+s ago$/, 'precondition: aged');
  const dismiss = document.querySelector('.ui-row[data-job-id="j1"] .subs-oneshot-dismiss');
  assert.ok(dismiss, 'precondition: a Dismiss button');
  mock.timers.tick(3000); await flush();
  const after = ageOf(document);
  assert.notStrictEqual(after, before, 'the age ticked: ' + before + ' -> ' + after);
  assert.strictEqual(document.querySelector('.ui-row[data-job-id="j1"] .subs-oneshot-dismiss'), dismiss, 'the same Dismiss node');
});

test('/subscriptions gate r1: a 401 says "Signed out - reload to sign in"', async () => {
  let status = 200;
  const { document } = mount(() => (status === 200 ? jsonRes(200, snapAt(1000)) : jsonRes(status, {})));
  mock.timers.tick(2600); await flush();
  status = 401;
  mock.timers.tick(1000); await flush();
  mock.timers.tick(6000); await flush();
  assert.strictEqual(offlineEl(document).hidden, false);
  assert.strictEqual(offlineEl(document).textContent, 'Signed out - reload to sign in');
  status = 502;
  mock.timers.tick(31000); await flush();
  assert.match(offlineEl(document).textContent, /^Can't reach FileTube, last reached/);
});

test('/subscriptions gate r1 (adversary N1): a throw in page code after a GOOD poll is counted, never "Can\'t reach FileTube"', async () => {
  const { document } = mount(() => jsonRes(200, snapAt(1000)));
  global.formatDownloadRowAge = () => { throw new Error('page fault'); };
  const before = liveSubs().subsStatusPollFaultCount();
  mock.timers.tick(2600); await flush();
  assert.ok(liveSubs().subsStatusPollFaultCount() > before, 'counted');
  assert.strictEqual(offlineEl(document).hidden, true, 'not offline: the server answered');
});
