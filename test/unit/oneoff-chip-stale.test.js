'use strict';

// [UNIT] v1.365.0 W3 (plan 2026-10-05-small-phones-pocket-downloads-vr, ROADMAP "one-off download stuck"): the
// corner download chip tells a STUCK server from a STALE screen. Driven for real: common.js's
// injectDownloadStatusChip in jsdom with ui.js and a scripted fetch, on the mock clock (setTimeout + Date).
//
//   - stale screen: a status poll that fails used to only back off, so the row kept saying "Downloading 47%"
//     with no sign. Now the chip header says "Can't reach FileTube, last checked Ns ago" until a poll
//     succeeds, and the rows keep their last state. Both axes, from a POPULATED chip (LESSONS 2/4).
//   - stuck server: every non-terminal row shows "updated Ns ago" once the server's own entry is older than
//     60 s, measured on the SERVER's clock (the status response's `now`), and the label clears on a fresh update.
//   - the health probe: one failed probe used to latch the chip off for the tab, silently. Now the next call
//     probes again.
//   - one bad row: a row whose render throws is caught and counted; the other rows and the poll carry on.

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');
const UI = require.resolve('../../public/js/ui.js');

let dom;
afterEach(() => {
  mock.timers.reset();
  if (dom) dom.window.close();
  dom = null;
  for (const k of ['window', 'document', 'fetch', 'localStorage', 'sessionStorage']) delete global[k];
  delete require.cache[COMMON];
});

const T0 = Date.UTC(2026, 9, 5, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString();
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

// Boots common.js + ui.js in jsdom. `respond(url, n)` answers every fetch (n = the call count for that url).
async function boot(respond) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 });
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  const common = require(COMMON);
  dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  delete require.cache[UI];
  w.ui = require(UI);
  global.window = w;
  global.document = w.document;
  global.localStorage = w.localStorage;
  global.sessionStorage = w.sessionStorage;
  const calls = {};
  global.fetch = (url) => {
    calls[url] = (calls[url] || 0) + 1;
    return respond(url, calls[url]);
  };
  return { common, w, calls };
}
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const down = () => Promise.reject(new TypeError('Failed to fetch'));
const chipOf = (w) => w.document.getElementById('dl-status-chip');
const summaryText = (w) => chipOf(w).querySelector('.dl-status-chip-text').textContent;
const rowAge = (w, i = 0) => {
  const el = chipOf(w).querySelectorAll('.dl-status-chip-item')[i].querySelector('.dl-status-chip-item-age');
  return el && !el.hidden ? el.textContent : '';
};
// One downloading one-off at 47 %, its server entry last written `ageMs` before the server's `now`.
const snap = (nowMs, ageMs, extra) => ({
  now: iso(nowMs),
  subscriptions: {},
  oneShots: { j1: { state: 'downloading', percent: 47, title: 'Clip', updatedAt: iso(nowMs - ageMs) }, ...(extra || {}) },
});

// ---- the stale screen ----------------------------------------------------------------

test('a failed poll on a POPULATED chip says "Can\'t reach FileTube, last checked Ns ago"; the row keeps its last state', async () => {
  let failing = false;
  const { common, w } = await boot((url) => {
    if (url === '/api/subscriptions/health') return ok({});
    if (url === '/api/subscriptions/status') return failing ? down() : ok(snap(Date.now(), 1000));
    return new Promise(() => {});
  });
  common.injectDownloadStatusChip();
  await settle();
  assert.match(summaryText(w), /47%/, 'precondition: populated, downloading 47%');
  assert.strictEqual(chipOf(w).classList.contains('dl-status-chip-offline'), false);
  failing = true;
  mock.timers.tick(6000); // the next poll fails
  await settle();
  assert.match(summaryText(w), /^Can't reach FileTube, last checked \d+s ago$/);
  mock.timers.tick(31000); // the backed-off poll after it fails too
  await settle();
  assert.match(summaryText(w), /^Can't reach FileTube, last checked \d+s ago$/);
  assert.ok(chipOf(w).classList.contains('dl-status-chip-offline'));
  const row = chipOf(w).querySelector('.dl-status-chip-item');
  assert.match(row.els.statusEl.textContent, /47%/, 'the row keeps its last known state');
  const secs = Number(/last checked (\d+)s/.exec(summaryText(w))[1]);
  assert.ok(secs >= 30, 'the age grows from the last GOOD poll: ' + secs);
});

test('the offline line CLEARS on the first good poll (the clear axis, from a populated offline state)', async () => {
  let failing = false;
  const { common, w } = await boot((url) => {
    if (url === '/api/subscriptions/health') return ok({});
    if (url === '/api/subscriptions/status') return failing ? down() : ok(snap(Date.now(), 1000));
    return new Promise(() => {});
  });
  common.injectDownloadStatusChip();
  await settle();
  failing = true;
  mock.timers.tick(6000); await settle();
  assert.match(summaryText(w), /^Can't reach FileTube/, 'precondition: offline shown');
  failing = false;
  mock.timers.tick(31000); await settle();
  assert.match(summaryText(w), /47%/);
  assert.strictEqual(chipOf(w).classList.contains('dl-status-chip-offline'), false);
});

// ---- the stuck server ----------------------------------------------------------------

test('a row the server has not touched for over 60 s shows "updated Ns ago" (the server clock), and a fresh update clears it', async () => {
  let age = 90 * 1000;
  const { common, w } = await boot((url) => {
    if (url === '/api/subscriptions/health') return ok({});
    if (url === '/api/subscriptions/status') return ok(snap(Date.now(), age));
    return new Promise(() => {});
  });
  common.injectDownloadStatusChip();
  await settle();
  assert.strictEqual(rowAge(w), 'updated 90s ago');
  age = 2000;
  mock.timers.tick(6000); await settle();
  assert.strictEqual(rowAge(w), '', 'a fresh server update clears the label');
});

test('the age is measured on the SERVER\'s clock: a phone clock hours off changes nothing', async () => {
  const { common, w } = await boot((url) => {
    if (url === '/api/subscriptions/health') return ok({});
    // The server's now is 3 h behind the phone; its entry is 30 s old on the server's clock.
    if (url === '/api/subscriptions/status') return ok(snap(Date.now() - 3 * 3600 * 1000, 30 * 1000));
    return new Promise(() => {});
  });
  common.injectDownloadStatusChip();
  await settle();
  assert.strictEqual(rowAge(w), '', '30 s old on the server: no label, whatever the phone clock says');
});

test('terminal rows never show an age; 60 s is the threshold (59 s none, 61 s shown)', () => {
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  const c = require(COMMON);
  assert.strictEqual(c.formatDownloadStaleNote(59), '');
  assert.strictEqual(c.formatDownloadStaleNote(61), 'updated 61s ago');
  assert.strictEqual(c.formatDownloadStaleNote(119), 'updated 119s ago');
  assert.strictEqual(c.formatDownloadStaleNote(125), 'updated 2 min ago');
  assert.strictEqual(c.formatDownloadStaleNote(3 * 3600 + 5), 'updated 3 h ago');
  assert.strictEqual(c.formatDownloadStaleNote(NaN), '');
  const state = c.reduceDownloadChipState({
    subscriptions: {},
    oneShots: {
      a: { state: 'downloading', percent: 5, updatedAt: iso(T0 - 300000) },
      b: { state: 'error', error: 'x', updatedAt: iso(T0 - 300000) },
      q: { state: 'queued', updatedAt: iso(T0 - 300000) },
    },
  }, new Set(), T0);
  const by = Object.fromEntries(state.items.map((i) => [i.id, i.staleNote]));
  assert.strictEqual(by.a, 'updated 5 min ago');
  assert.strictEqual(by.q, 'updated 5 min ago', 'a queued row counts too (non-terminal)');
  assert.strictEqual(by.b, '', 'a failed (terminal) row never shows an age');
  assert.strictEqual(c.reduceDownloadChipState({ subscriptions: {}, oneShots: { a: { state: 'downloading', updatedAt: iso(T0 - 300000) } } }, new Set()).items[0].staleNote, '', 'no clock given: no age');
  assert.strictEqual(c.formatDownloadOfflineText(null, T0), "Can't reach FileTube");
  assert.strictEqual(c.formatDownloadOfflineText(T0 - 12000, T0), "Can't reach FileTube, last checked 12s ago");
  assert.strictEqual(c.formatDownloadOfflineText(T0 - 300000, T0), "Can't reach FileTube, last checked 5 min ago");
});

// ---- the health probe ----------------------------------------------------------------

test('one failed health probe no longer kills the chip for the tab: the next call probes again and mounts it', async () => {
  const { common, w, calls } = await boot((url, n) => {
    if (url === '/api/subscriptions/health') return n === 1 ? down() : ok({});
    if (url === '/api/subscriptions/status') return ok(snap(Date.now(), 1000));
    return new Promise(() => {});
  });
  common.injectDownloadStatusChip();
  await settle();
  assert.strictEqual(chipOf(w), null, 'the first probe failed: no chip');
  common.injectDownloadStatusChip(); // e.g. the next one-off submit
  await settle();
  assert.strictEqual(calls['/api/subscriptions/health'], 2, 'it probed again');
  assert.ok(chipOf(w), 'and the chip mounted');
});

test('a 404 probe (the downloader is off) stays latched: no re-probe storm on a disabled install', async () => {
  const { common, w, calls } = await boot((url) => {
    if (url === '/api/subscriptions/health') return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    return new Promise(() => {});
  });
  common.injectDownloadStatusChip();
  await settle();
  common.injectDownloadStatusChip();
  await settle();
  assert.strictEqual(calls['/api/subscriptions/health'], 1);
  assert.strictEqual(chipOf(w), null);
});

test('a 5xx probe (the server is up but failing) is retried on the next call, like a network failure', async () => {
  const { common, calls } = await boot((url, n) => {
    if (url === '/api/subscriptions/health') return n === 1 ? Promise.resolve({ ok: false, status: 502, json: async () => ({}) }) : ok({});
    if (url === '/api/subscriptions/status') return ok(snap(Date.now(), 1000));
    return new Promise(() => {});
  });
  common.injectDownloadStatusChip();
  await settle();
  common.injectDownloadStatusChip();
  await settle();
  assert.strictEqual(calls['/api/subscriptions/health'], 2);
});

// ---- one bad row ---------------------------------------------------------------------

test('a row whose render throws is caught and counted; the other rows render and the poll is not called offline', async () => {
  const { common, w } = await boot((url) => {
    if (url === '/api/subscriptions/health') return ok({});
    if (url === '/api/subscriptions/status') return ok(snap(Date.now(), 1000, { j2: { state: 'downloading', percent: 10, title: 'Second', updatedAt: iso(Date.now()) } }));
    return new Promise(() => {});
  });
  const realButton = w.ui.button;
  let builds = 0;
  w.ui.button = (o) => {
    if (o && o.label === 'Cancel') { builds += 1; if (builds === 1) throw new Error('boom'); }
    return realButton(o);
  };
  const before = common.downloadChipRenderErrorCount();
  common.injectDownloadStatusChip();
  await settle();
  const rows = chipOf(w).querySelectorAll('.dl-status-chip-item');
  assert.strictEqual(rows.length, 1, 'the good row rendered');
  assert.strictEqual(common.downloadChipRenderErrorCount(), before + 1, 'the bad row was counted');
  assert.strictEqual(chipOf(w).classList.contains('dl-status-chip-offline'), false, 'a render fault is not "can\'t reach"');
});
