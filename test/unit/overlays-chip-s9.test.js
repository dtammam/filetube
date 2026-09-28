'use strict';

// [UNIT] Sweep S9 (F57, F47): the download status chip, driven for real - common.js's
// injectDownloadStatusChip in jsdom with ui.js and a scripted fetch. The collapsed chip is a
// tonal pill ui-btn whose glyph says the state (`download` while work runs, `error` once
// something failed - never the colour alone); a failed row carries the error glyph beside its
// name and ui-btn Retry / Dismiss; there is no pulsing red dot and no bespoke button family.

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');
const UI = require.resolve('../../public/js/ui.js');

let dom;
afterEach(() => {
  mock.timers.reset(); // the chip's next poll was on the mock clock: it never fires after the test
  if (dom) dom.window.close();
  dom = null;
  for (const k of ['window', 'document', 'fetch', 'localStorage', 'sessionStorage']) delete global[k];
  delete require.cache[COMMON];
});

// Boots the chip against one status snapshot. Returns the chip once its first poll rendered.
async function bootChip(snapshot, path = '/') {
  mock.timers.enable({ apis: ['setTimeout'] });
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  const common = require(COMMON); // no document at require time: the boot block is skipped
  dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost' + path, pretendToBeVisual: true });
  const w = dom.window;
  delete require.cache[UI];
  w.ui = require(UI);
  global.window = w;
  global.document = w.document;
  global.localStorage = w.localStorage;
  global.sessionStorage = w.sessionStorage;
  const posts = [];
  global.fetch = (url, init) => {
    if (url === '/api/subscriptions/health') return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    if (url === '/api/subscriptions/status') return Promise.resolve({ ok: true, status: 200, json: async () => snapshot });
    posts.push([url, init && init.method]);
    return new Promise(() => {});
  };
  common.injectDownloadStatusChip();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  const chip = w.document.getElementById('dl-status-chip');
  assert.ok(chip, 'the chip mounted');
  return { chip, w, posts };
}
const iconOf = (el) => el.querySelector('.ui-btn__icon use').getAttribute('href');
const recent = () => new Date().toISOString();

test('F57: an active download - the summary is a tonal pill ui-btn with the `download` glyph, no red dot, no error class', async () => {
  const { chip } = await bootChip({ subscriptions: {}, oneShots: { j1: { state: 'downloading', percent: 40, title: 'Clip', updatedAt: recent() } } });
  assert.strictEqual(chip.hidden, false);
  const summary = chip.querySelector('.dl-status-chip-summary');
  for (const c of ['ui-btn', 'ui-btn--tonal', 'ui-btn--sm', 'ui-btn--pill']) assert.ok(summary.classList.contains(c), c);
  assert.strictEqual(iconOf(summary), '#i-download');
  assert.strictEqual(chip.classList.contains('dl-status-chip-has-error'), false);
  assert.strictEqual(chip.querySelector('.dl-status-chip-dot'), null, 'no pulsing red dot');
  assert.match(summary.querySelector('.dl-status-chip-text').textContent, /40%/);
});

test('F57: a failed download - the summary swaps to the `error` glyph (colour is never the only signal), the row shows its error icon and ui-btn Retry / Dismiss', async () => {
  const { chip } = await bootChip({ subscriptions: {}, oneShots: { j1: { state: 'error', title: 'Clip', error: 'HTTP 403', url: 'https://youtu.be/x' } } });
  assert.ok(chip.classList.contains('dl-status-chip-has-error'));
  assert.strictEqual(iconOf(chip.querySelector('.dl-status-chip-summary')), '#i-error');
  const row = chip.querySelector('.dl-status-chip-item');
  assert.ok(row.classList.contains('is-error'));
  const err = row.querySelector('.dl-status-chip-item-erricon');
  assert.ok(err && !err.hasAttribute('hidden'), 'the error glyph beside the name');
  assert.strictEqual(err.querySelector('use').getAttribute('href'), '#i-error');
  for (const b of [row.els.retryBtn, row.els.dismissBtn]) {
    assert.ok(b.classList.contains('ui-btn') && b.classList.contains('ui-btn--secondary') && b.classList.contains('ui-btn--sm'), b.textContent);
    assert.strictEqual(b.hidden, false);
  }
  assert.strictEqual(row.els.retryBtn.textContent, 'Retry');
  assert.strictEqual(iconOf(row.els.retryBtn), '#i-refresh');
});

test('the healthy row hides its error glyph; the summary toggles the panel and Dismiss all is a plain ui-btn', async () => {
  const { chip, w } = await bootChip({ subscriptions: {}, oneShots: { j1: { state: 'downloading', percent: 5, title: 'Clip', updatedAt: recent() } } });
  const row = chip.querySelector('.dl-status-chip-item');
  assert.ok(row.querySelector('.dl-status-chip-item-erricon').hasAttribute('hidden'));
  const panel = chip.querySelector('.dl-status-chip-panel');
  assert.strictEqual(panel.hidden, true);
  chip.querySelector('.dl-status-chip-summary').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(panel.hidden, false);
  assert.ok(chip.classList.contains('dl-status-chip-expanded'));
  const all = chip.querySelector('.dl-status-chip-dismiss-all');
  assert.ok(all.classList.contains('ui-btn') && all.classList.contains('ui-btn--plain'));
  assert.strictEqual(chip.querySelectorAll('button:not(.ui-btn)').length, 0, 'every chip button is a ui-btn');
});
