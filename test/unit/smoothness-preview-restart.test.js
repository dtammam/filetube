'use strict';

// v1.406.0 W2 P (plan docs/exec-plans/active/2026-11-08-smoothness.md): the Modern home's preview clips come back after Back.
// Home is CACHED on nav-away and the SAME card nodes are reattached on Back; PreviewCards.refresh() unobserved the detached cards
// (the v1.85 leak guard) but left their `data-pv-obs` mark, and only unmarked cards are ever observed - so after Back no preview
// played again (Dean's recording: about 20 s, none). The REAL main.js PreviewCards (main.js evaluated as a classic script), a recording IntersectionObserver, the real MutationObserver-driven refresh.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

// main.js evaluated alone, as its own classic script, with a handle on its top-level PreviewCards (a const in the script's scope)
function previewRealm() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }); // a phone: no hover
  w.fetch = () => new Promise(() => {});
  return { w, load: () => w.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8') + '\n;window.__pv = PreviewCards;'), close: () => w.close() };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('P: a detached card is unobserved AND unmarked; reattached (Back to the cached home) it is observed again; the leak guard holds', async () => {
  const r = previewRealm();
  try {
    const w = r.w;
    const log = [];
    const live = new Set();
    w.IntersectionObserver = class { constructor() {} observe(el) { log.push(['observe', el]); live.add(el); } unobserve(el) { log.push(['unobserve', el]); live.delete(el); } disconnect() {} };
    const home = w.document.createElement('div');
    home.innerHTML = '<div class="video-card"><div class="card-preview" data-preview-id="m1"></div></div>';
    w.document.body.appendChild(home);
    const card = home.querySelector('.card-preview');
    r.load();
    w.__pv.init();
    assert.strictEqual(live.has(card), true, 'observed on first sight');
    assert.strictEqual(card.getAttribute('data-pv-obs'), '1');
    home.remove(); // the router caches home: the node leaves the document, kept alive
    w.document.body.appendChild(w.document.createElement('section')); // any mutation drives refresh()
    await wait(200);
    assert.strictEqual(live.has(card), false, 'v1.85 leak guard: a detached card is not held by the observer');
    assert.strictEqual(card.hasAttribute('data-pv-obs'), false, 'the mark goes with the observation');
    w.document.body.appendChild(home); // Back: the same node returns
    await wait(200);
    assert.strictEqual(live.has(card), true, 'observed again - its preview can play');
    assert.strictEqual(log.filter((e) => e[0] === 'observe' && e[1] === card).length, 2);
  } finally { r.close(); }
});
