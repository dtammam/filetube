'use strict';

// [UNIT] v1.365.0 W3 (plan 2026-10-05-small-phones-pocket-downloads-vr, ROADMAP "one-off download stuck"): the
// corner download chip tells a STUCK server from a STALE screen. Driven for real: common.js's
// injectDownloadStatusChip in jsdom with ui.js and a scripted fetch, on the mock clock (setTimeout + Date).
//
//   - stale screen: a status poll that fails used to only back off, so the row kept saying "Downloading 47%"
//     with no sign. Now the chip header says "Can't reach FileTube, last reached Ns ago" until a poll
//     succeeds, and the rows keep their last state. Both axes, from a POPULATED chip (LESSONS 2/4).
//   - stuck server: every non-terminal row shows "updated Ns ago" once the server's own entry is older than
//     60 s, measured on the SERVER's clock (the status response's `now`), and the label clears on a fresh update.
//   - the health probe: one failed probe used to latch the chip off for the tab, silently. Now the next call
//     probes again.
//   - one bad row: a row whose render throws is caught and counted; the other rows and the poll carry on.
//   - gate r1 (adversary W3/N1/N2, qa W2/S2/S3): an age means what it says. Only a downloading row that is not
//     merging or converting says "updated N ago"; a queued row says "waiting N"; batch (`kind`) and terminal
//     rows never age; offline hides every age; no `now` in the snapshot means no age. A 401 says "Signed out";
//     a throw in page code after a good poll is counted, never "Can't reach FileTube".

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

test('a failed poll on a POPULATED chip says "Can\'t reach FileTube, last reached Ns ago"; the row keeps its last state', async () => {
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
  assert.match(summaryText(w), /^Can't reach FileTube, last reached \d+s ago$/);
  mock.timers.tick(31000); // the backed-off poll after it fails too
  await settle();
  assert.match(summaryText(w), /^Can't reach FileTube, last reached \d+s ago$/);
  assert.ok(chipOf(w).classList.contains('dl-status-chip-offline'));
  const row = chipOf(w).querySelector('.dl-status-chip-item');
  assert.match(row.els.statusEl.textContent, /47%/, 'the row keeps its last known state');
  const secs = Number(/last reached (\d+)s/.exec(summaryText(w))[1]);
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
  assert.strictEqual(by.q, 'waiting 5 min', 'a queued row says it is waiting, not stuck (gate r1)');
  assert.strictEqual(by.b, '', 'a failed (terminal) row never shows an age');
  assert.strictEqual(c.reduceDownloadChipState({ subscriptions: {}, oneShots: { a: { state: 'downloading', updatedAt: iso(T0 - 300000) } } }, new Set()).items[0].staleNote, '', 'no clock given: no age');
  assert.strictEqual(c.formatDownloadOfflineText(null, T0), "Can't reach FileTube");
  assert.strictEqual(c.formatDownloadOfflineText(T0 - 12000, T0), "Can't reach FileTube, last reached 12s ago");
  assert.strictEqual(c.formatDownloadOfflineText(T0 - 12000, T0, 'signed-out'), 'Signed out - reload to sign in');
  assert.strictEqual(c.formatDownloadOfflineText(T0 - 300000, T0), "Can't reach FileTube, last reached 5 min ago");
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

// ---- gate r1: the age rules ------------------------------------------------------------

const rowByName = (w, name) => Array.from(chipOf(w).querySelectorAll('.dl-status-chip-item')).find((r) => r.els.nameEl.textContent === name);
const ageOfRow = (row) => (row && !row.els.ageEl.hidden ? row.els.ageEl.textContent : '');

test('gate r1: on the chip only a downloading row (not merging, not converting) says "updated N ago"; queued says "waiting N"; a batch row never ages', async () => {
  const { common, w } = await boot((url) => {
    if (url === '/api/subscriptions/health') return ok({});
    if (url === '/api/subscriptions/status') {
      const now = Date.now();
      return ok({
        now: iso(now),
        subscriptions: {},
        oneShots: {
          d: { state: 'downloading', percent: 20, title: 'Down', updatedAt: iso(now - 90000) },
          m: { state: 'downloading', phase: 'merging', percent: 100, title: 'Merge', updatedAt: iso(now - 300000) },
          c: { state: 'downloading', phase: 'converting', percent: 100, title: 'Conv', updatedAt: iso(now - 300000) },
          q: { state: 'queued', title: 'Wait', updatedAt: iso(now - 180000) },
          k: { kind: 'repull', state: 'running', total: 4, done: 1, updatedAt: iso(now - 300000) },
        },
      });
    }
    return new Promise(() => {});
  });
  common.injectDownloadStatusChip();
  await settle();
  assert.strictEqual(chipOf(w).querySelectorAll('.dl-status-chip-item').length, 5, 'precondition: all five rows rendered');
  assert.strictEqual(ageOfRow(rowByName(w, 'Down')), 'updated 90s ago');
  assert.strictEqual(ageOfRow(rowByName(w, 'Merge')), '', 'merging: ffmpeg is legitimately silent');
  assert.strictEqual(ageOfRow(rowByName(w, 'Conv')), '', 'converting: the same');
  assert.strictEqual(ageOfRow(rowByName(w, 'Wait')), 'waiting 3 min', 'queued: waiting, not stuck');
  assert.strictEqual(ageOfRow(rowByName(w, 'Reheating library')), '', 'an activity batch is not a download');
});

test('gate r1: formatDownloadRowAge, every rule (pure)', () => {
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  const c = require(COMMON);
  const old = iso(T0 - 300000);
  assert.strictEqual(c.formatDownloadRowAge({ state: 'downloading', updatedAt: old }, T0), 'updated 5 min ago');
  assert.strictEqual(c.formatDownloadRowAge({ state: 'downloading', phase: 'merging', updatedAt: old }, T0), '');
  assert.strictEqual(c.formatDownloadRowAge({ state: 'downloading', phase: 'converting', updatedAt: old }, T0), '');
  assert.strictEqual(c.formatDownloadRowAge({ state: 'queued', updatedAt: iso(T0 - 59000) }, T0), '', 'queued: the same 60 s threshold');
  assert.strictEqual(c.formatDownloadRowAge({ state: 'queued', updatedAt: iso(T0 - 61000) }, T0), 'waiting 61s');
  assert.strictEqual(c.formatDownloadRowAge({ state: 'queued', updatedAt: old }, T0), 'waiting 5 min');
  for (const st of ['done', 'error', 'cancelled', 'listing']) assert.strictEqual(c.formatDownloadRowAge({ state: st, updatedAt: old }, T0), '', st);
  assert.strictEqual(c.formatDownloadRowAge({ kind: 'repull', state: 'downloading', updatedAt: old }, T0), '', 'a batch row');
  assert.strictEqual(c.formatDownloadRowAge({ state: 'downloading', updatedAt: old }, undefined), '', 'no server clock: no age');
  assert.strictEqual(c.formatDownloadRowAge({ state: 'downloading' }, T0), '', 'no updatedAt: no age');
});

test('gate r1: offline hides every row age (the offline line says how stale the screen is); the next good poll shows it again', async () => {
  let failing = false;
  const { common, w } = await boot((url) => {
    if (url === '/api/subscriptions/health') return ok({});
    if (url === '/api/subscriptions/status') return failing ? down() : ok(snap(Date.now(), 90000));
    return new Promise(() => {});
  });
  common.injectDownloadStatusChip();
  await settle();
  assert.strictEqual(rowAge(w), 'updated 90s ago', 'precondition: the row ages while online');
  failing = true;
  mock.timers.tick(6000); await settle();
  assert.match(summaryText(w), /^Can't reach FileTube/);
  assert.strictEqual(rowAge(w), '', 'offline: no row age (the snapshot is frozen, not the server)');
  mock.timers.tick(31000); await settle();
  assert.strictEqual(rowAge(w), '', 'still none minutes later');
  failing = false;
  mock.timers.tick(61000); await settle();
  assert.doesNotMatch(summaryText(w), /^Can't reach/);
  assert.strictEqual(rowAge(w), 'updated 90s ago', 'back online: the server-clock age again');
});

test('gate r1: a snapshot with no `now` carries no row age, whatever this device\'s clock says (adversary N2)', async () => {
  const { common, w } = await boot((url) => {
    if (url === '/api/subscriptions/health') return ok({});
    if (url === '/api/subscriptions/status') {
      const s = snap(Date.now(), 10 * 60 * 1000);
      delete s.now;
      return ok(s);
    }
    return new Promise(() => {});
  });
  common.injectDownloadStatusChip();
  await settle();
  assert.match(summaryText(w), /47%/, 'precondition: the row rendered');
  assert.strictEqual(rowAge(w), '');
});

test('gate r1: a 401 poll says "Signed out - reload to sign in", not "Can\'t reach FileTube"; a good poll clears it', async () => {
  let status = 200;
  const { common, w } = await boot((url) => {
    if (url === '/api/subscriptions/health') return ok({});
    if (url === '/api/subscriptions/status') {
      return status === 200 ? ok(snap(Date.now(), 1000)) : Promise.resolve({ ok: false, status, json: async () => ({}) });
    }
    return new Promise(() => {});
  });
  common.injectDownloadStatusChip();
  await settle();
  status = 401;
  mock.timers.tick(6000); await settle();
  assert.strictEqual(summaryText(w), 'Signed out - reload to sign in');
  assert.ok(chipOf(w).classList.contains('dl-status-chip-offline'));
  status = 503;
  mock.timers.tick(31000); await settle();
  assert.match(summaryText(w), /^Can't reach FileTube, last reached/, 'a non-OK answer other than 401 is "can\'t reach"');
  status = 200;
  mock.timers.tick(61000); await settle();
  assert.match(summaryText(w), /47%/);
  assert.strictEqual(chipOf(w).classList.contains('dl-status-chip-offline'), false);
});

test('gate r1: a throw in page code after a GOOD poll is counted and never shown as "Can\'t reach FileTube"', async () => {
  const { common, w } = await boot((url) => {
    if (url === '/api/subscriptions/health') return ok({});
    if (url === '/api/subscriptions/status') return ok(snap(Date.now(), 1000, { jd: { state: 'done', title: 'Done', updatedAt: iso(Date.now()) } }));
    return new Promise(() => {});
  });
  w.__filetubeRefreshLibrary = () => { throw new Error('library refresh blew up'); };
  const before = common.downloadChipPollFaultCount();
  common.injectDownloadStatusChip();
  await settle();
  assert.strictEqual(common.downloadChipPollFaultCount(), before + 1, 'the page fault was counted');
  assert.doesNotMatch(summaryText(w), /Can't reach/);
  assert.strictEqual(chipOf(w).classList.contains('dl-status-chip-offline'), false);
});

test('gate r1 (qa S4, measured 212 px at 320 and 390): where the offline sentence clips, the pill says the bare words; the sentence stays in its tooltip', async () => {
  let failing = false;
  const { common, w } = await boot((url) => {
    if (url === '/api/subscriptions/health') return ok({});
    if (url === '/api/subscriptions/status') return failing ? down() : ok(snap(Date.now(), 1000));
    return new Promise(() => {});
  });
  // jsdom has no layout: model the measured pill (212 px of room; about 6.6 px per character).
  const isPill = (el) => el.classList && el.classList.contains('dl-status-chip-text');
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return isPill(this) ? 212 : 0; } });
  Object.defineProperty(w.HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return isPill(this) ? Math.round(this.textContent.length * 6.6) : 0; } });
  common.injectDownloadStatusChip();
  await settle();
  failing = true;
  mock.timers.tick(6000); await settle();
  assert.strictEqual(summaryText(w), "Can't reach FileTube", 'the bare words fit the pill');
  const btn = chipOf(w).querySelector('.dl-status-chip-summary');
  assert.match(btn.title, /^Can't reach FileTube, last reached \d+s ago$/, 'the full sentence in the tooltip');
  failing = false;
  mock.timers.tick(31000); await settle();
  assert.strictEqual(btn.hasAttribute('title'), false, 'cleared with the offline line');
});
