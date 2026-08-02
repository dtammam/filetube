'use strict';

// [INTEGRATION] v1.64 gate fix (adversarial W1): the History sidebar entry's
// COUNT-GATE, bound at the DOM (not a pure-helper proxy). The surviving
// mutant was "delete the gate line in injectHistoryNavLinkIfEnabled so it
// always injects" -- the zero-history case below goes red under exactly that
// mutant. Runs the REAL exported function from common.js against a jsdom
// document with a stubbed fetch; also binds QA S2's deterministic
// Music > Books > History ordering across every probe-race order.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
// Required BEFORE any DOM globals exist -- the same node-side require path
// every other common.js unit consumer takes; the injectors check for a
// document at CALL time, so the globals below are what they see.
const { injectHistoryNavLinkIfEnabled, injectLibraryNavEntry } = require('../../public/js/common.js');

const SIDEBAR_HTML = '<body><aside id="sidebar"><nav class="sidebar-section"></nav>' +
  '<div class="sidebar-section"><div id="sidebar-folders-list"></div></div></aside></body>';

function withDom(fetchImpl, fn) {
  const dom = new JSDOM(SIDEBAR_HTML, { url: 'http://localhost/' });
  global.document = dom.window.document;
  global.window = dom.window;
  const realFetch = global.fetch;
  global.fetch = fetchImpl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.fetch = realFetch;
      delete global.document;
      delete global.window;
      dom.window.close();
    });
}

const jsonResponse = (body, ok = true) => () => Promise.resolve({ ok, json: () => Promise.resolve(body) });
const settle = () => new Promise((resolve) => setImmediate(resolve));
const marker = () => global.document.querySelector('[data-nav-sidebar="history"]');

test('zero history -> NO entry injected (the count-gate; kills the always-inject mutant)', () =>
  withDom(jsonResponse({ items: [], total: 0 }), async () => {
    injectHistoryNavLinkIfEnabled();
    await settle();
    assert.equal(marker(), null, 'an empty history must not grow a sidebar entry');
  }));

test('>=1 history item -> the entry injects with the History href/label, exactly once (idempotent)', () =>
  withDom(jsonResponse({ items: [{ id: 'x' }], total: 3 }), async () => {
    injectHistoryNavLinkIfEnabled();
    await settle();
    const el = marker();
    assert.ok(el, 'expected the History entry');
    assert.equal(el.getAttribute('href'), '/history');
    assert.match(el.textContent, /History/);
    injectHistoryNavLinkIfEnabled(); // second boot-call must not double it
    await settle();
    assert.equal(global.document.querySelectorAll('[data-nav-sidebar="history"]').length, 1);
  }));

test('probe failure paths fail CLOSED: rejected fetch and non-ok response inject nothing', async () => {
  await withDom(() => Promise.reject(new Error('network down')), async () => {
    injectHistoryNavLinkIfEnabled();
    await settle();
    assert.equal(marker(), null);
  });
  await withDom(jsonResponse({ total: 5 }, false), async () => {
    injectHistoryNavLinkIfEnabled();
    await settle();
    assert.equal(marker(), null, 'a non-ok response is not a confirmed count');
  });
  await withDom(jsonResponse({ total: 'garbage' }), async () => {
    injectHistoryNavLinkIfEnabled();
    await settle();
    assert.equal(marker(), null, 'a garbage total is not >0');
  });
});

test('deterministic Library order Music > Books > Podcasts > History for EVERY injection race order (QA S2; v1.69 QA S1: all 24 four-entry permutations)', () =>
  withDom(jsonResponse({ total: 1 }), async () => {
    // Every permutation of the four entries, generated - a hand list rots.
    const keys = ['music', 'books', 'podcasts', 'history'];
    const orders = [];
    const permute = (rest, acc) => {
      if (rest.length === 0) { orders.push(acc); return; }
      for (const k of rest) permute(rest.filter((x) => x !== k), [...acc, k]);
    };
    permute(keys, []);
    assert.equal(orders.length, 24);
    const spec = {
      music: ['/music', 'Music', 'icon-play'],
      books: ['/books', 'Books', 'icon-folder'],
      podcasts: ['/podcasts', 'Podcasts', 'icon-podcast'],
      history: ['/history', 'History', 'icon-history'],
    };
    for (const order of orders) {
      const list = global.document.getElementById('sidebar-folders-list');
      // reset the surrounding container between races
      list.parentElement.querySelectorAll('[data-nav-sidebar]').forEach((el) => el.remove());
      for (const key of order) injectLibraryNavEntry(key, ...spec[key]);
      const seen = Array.from(list.parentElement.querySelectorAll('[data-nav-sidebar]'))
        .map((el) => el.getAttribute('data-nav-sidebar'));
      assert.deepEqual(seen, ['music', 'books', 'podcasts', 'history'], 'race order ' + order.join(','));
    }
  }));
