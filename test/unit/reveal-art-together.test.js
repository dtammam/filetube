'use strict';

// [UNIT] v1.339 (L1, plan D4): FileTube.revealArtTogether - the batched in-viewport
// art reveal. The in-view `art-shimmer` images clear TOGETHER once every one has
// settled (loaded + decoded, or errored) or REVEAL_TOGETHER_CAP_MS elapses; complete
// images count at once (warm = same tick); off-screen images reveal per image; an
// abort (view teardown) ends the batch and hands each image back to its own reveal.
// Every clear path is driven from a POPULATED (shimmering) state (LESSONS 2, "reveal
// and clear are two axes").

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const REPO = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

function domWithCommon() {
  delete global.document; delete global.window;
  const COMMON = require.resolve('../../public/js/common.js');
  delete require.cache[COMMON];
  const c = require(COMMON); // boot guarded (no document at require time)
  const dom = new JSDOM('<!DOCTYPE html><body><div id="host"></div></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  return { c, dom, doc: dom.window.document, host: dom.window.document.getElementById('host') };
}

// An art img at a given viewport rect (jsdom has no layout: the rect is stubbed).
// `decode`: undefined = no img.decode (settle on load), or a function returning a promise.
function img(doc, host, { complete = false, top = 10, left = 10, size = 100, decode } = {}) {
  const el = doc.createElement('img');
  el.className = 'art-shimmer';
  let isComplete = complete;
  Object.defineProperty(el, 'complete', { get: () => isComplete, configurable: true });
  el.markComplete = () => { isComplete = true; };
  el.getBoundingClientRect = () => ({ top, left, width: size, height: size, bottom: top + size, right: left + size });
  Object.defineProperty(el, 'decode', { value: decode, configurable: true });
  host.appendChild(el);
  return el;
}
const shimmering = (el) => el.classList.contains('art-shimmer');
const load = (dom, el) => { el.markComplete(); el.dispatchEvent(new dom.window.Event('load')); };
const fail = (dom, el) => { el.markComplete(); el.dispatchEvent(new dom.window.Event('error')); };
const flush = () => new Promise((r) => setImmediate(r));

test('REVEAL_TOGETHER_CAP_MS is a named ~600ms cap, exported with the helper', () => {
  const { c, dom } = domWithCommon();
  assert.equal(c.REVEAL_TOGETHER_CAP_MS, 600);
  assert.equal(typeof c.revealArtTogether, 'function');
  dom.window.close();
});

test('the batch waits for the SLOWEST in-view image, then clears all in the same tick', () => {
  const { c, dom, doc, host } = domWithCommon();
  const a = img(doc, host); const b = img(doc, host, { left: 120 }); const s = img(doc, host, { left: 240 });
  c.revealArtTogether(host);
  assert.ok([a, b, s].every((e) => e.classList.contains('art-together')), 'the in-view batch is held');
  load(dom, a); load(dom, b);
  assert.ok(shimmering(a) && shimmering(b), 'loaded early - still held for the slowest');
  load(dom, s);
  assert.ok(![a, b, s].some(shimmering), 'the last settle reveals every one together');
  assert.ok(![a, b, s].some((e) => e.classList.contains('art-together')), 'the hold class goes with it');
  dom.window.close();
});

test('img.decode(): settles on DECODE after load, not on the load event alone', async () => {
  const { c, dom, doc, host } = domWithCommon();
  const resolvers = [];
  const decode = () => new Promise((r) => resolvers.push(r));
  const a = img(doc, host, { decode }); const b = img(doc, host, { left: 120, decode });
  c.revealArtTogether(host);
  load(dom, a); load(dom, b);
  await flush();
  assert.ok(shimmering(a) && shimmering(b), 'loaded but not decoded - still held');
  assert.equal(resolvers.length, 2, 'decode() was called for each loaded image');
  resolvers[0](); await flush();
  assert.ok(shimmering(a), 'one decoded, one pending - still held');
  resolvers[1](); await flush();
  assert.ok(!shimmering(a) && !shimmering(b), 'both decoded -> revealed together');
  dom.window.close();
});

test('a rejected decode() (a broken image) counts as settled', async () => {
  const { c, dom, doc, host } = domWithCommon();
  const a = img(doc, host, { decode: () => Promise.reject(new Error('EncodingError')) });
  const b = img(doc, host, { left: 120, decode: () => Promise.resolve() });
  c.revealArtTogether(host);
  load(dom, a); load(dom, b);
  await flush();
  assert.ok(!shimmering(a) && !shimmering(b));
  dom.window.close();
});

test('the CAP fires: settled ones reveal together, the straggler falls back to its own reveal', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { c, dom, doc, host } = domWithCommon();
  const a = img(doc, host); const b = img(doc, host, { left: 120 }); const slow = img(doc, host, { left: 240 });
  c.revealArtTogether(host);
  load(dom, a); load(dom, b);
  t.mock.timers.tick(c.REVEAL_TOGETHER_CAP_MS - 1);
  assert.ok(shimmering(a) && shimmering(b), 'still inside the cap');
  t.mock.timers.tick(1);
  assert.ok(!shimmering(a) && !shimmering(b), 'the cap reveals the settled ones');
  assert.ok(shimmering(slow), 'the straggler keeps its shimmer (nothing to show yet)');
  load(dom, slow);
  assert.ok(!shimmering(slow), 'and reveals on its own load after the cap');
  dom.window.close();
});

test('opts.capMs overrides the cap', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { c, dom, doc, host } = domWithCommon();
  const a = img(doc, host); const slow = img(doc, host, { left: 120 });
  c.revealArtTogether(host, { capMs: 50 });
  load(dom, a);
  t.mock.timers.tick(50);
  assert.ok(!shimmering(a) && shimmering(slow));
  dom.window.close();
});

test('warm: every in-view image already complete -> revealed synchronously, never held', () => {
  const { c, dom, doc, host } = domWithCommon();
  const a = img(doc, host, { complete: true }); const b = img(doc, host, { left: 120, complete: true });
  c.revealArtTogether(host);
  assert.ok(!shimmering(a) && !shimmering(b), 'same tick, no event needed');
  assert.ok(!a.classList.contains('art-together') && !b.classList.contains('art-together'), 'never held');
  dom.window.close();
});

test('a complete image in a mixed batch counts as settled at once (it does not wait for a load event)', () => {
  const { c, dom, doc, host } = domWithCommon();
  const warm = img(doc, host, { complete: true }); const cold = img(doc, host, { left: 120 });
  c.revealArtTogether(host);
  assert.ok(shimmering(warm), 'held with its cold neighbour');
  load(dom, cold);
  assert.ok(!shimmering(warm) && !shimmering(cold), 'the cold one settling completes the batch');
  dom.window.close();
});

test('an errored image counts as settled (the broken-image net still applies)', () => {
  const { c, dom, doc, host } = domWithCommon();
  const broken = img(doc, host); const ok = img(doc, host, { left: 120 });
  c.revealArtTogether(host);
  fail(dom, broken);
  assert.ok(shimmering(broken), 'held until the batch completes');
  load(dom, ok);
  assert.ok(!shimmering(broken) && !shimmering(ok), 'error + load = all settled');
  dom.window.close();
});

test('off-screen images keep the PER-IMAGE reveal (never wait for, or hold, the batch)', () => {
  const { c, dom, doc, host } = domWithCommon();
  const inView = img(doc, host);
  const below = img(doc, host, { top: 5000 });
  const right = img(doc, host, { left: 5000 });
  const zero = img(doc, host, { size: 0 }); // display:none / not laid out
  c.revealArtTogether(host);
  assert.ok(!below.classList.contains('art-together') && !right.classList.contains('art-together') && !zero.classList.contains('art-together'));
  load(dom, below);
  assert.ok(!shimmering(below), 'an off-screen image reveals on its own load');
  assert.ok(shimmering(inView), 'without releasing the in-view batch');
  load(dom, right); load(dom, zero);
  assert.ok(!shimmering(right) && !shimmering(zero));
  load(dom, inView);
  assert.ok(!shimmering(inView));
  dom.window.close();
});

test('teardown: an aborted signal ends the batch - the cap never fires, pending images reveal on their own', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { c, dom, doc, host } = domWithCommon();
  const ac = new dom.window.AbortController();
  const a = img(doc, host); const b = img(doc, host, { left: 120 });
  c.revealArtTogether(host, { signal: ac.signal });
  load(dom, a);
  assert.ok(shimmering(a), 'held before the abort');
  ac.abort();
  assert.ok(!shimmering(a), 'an abort hands a settled image back (revealed, never stuck held)');
  assert.ok(shimmering(b), 'a pending one keeps its shimmer');
  t.mock.timers.tick(c.REVEAL_TOGETHER_CAP_MS * 2);
  assert.ok(shimmering(b), 'the cap timer was cancelled with the batch');
  load(dom, b);
  assert.ok(!shimmering(b), 'the pending image reveals on its own load');
  dom.window.close();
});

test('teardown: handle.abort() does the same; an already-aborted signal never holds anything', () => {
  const { c, dom, doc, host } = domWithCommon();
  const a = img(doc, host); const b = img(doc, host, { left: 120 });
  const h = c.revealArtTogether(host);
  load(dom, a);
  h.abort();
  assert.ok(!shimmering(a) && shimmering(b));
  load(dom, b);
  assert.ok(!shimmering(b));

  const host2 = doc.createElement('div'); doc.body.appendChild(host2);
  const ac = new dom.window.AbortController(); ac.abort();
  const x = img(doc, host2);
  c.revealArtTogether(host2, { signal: ac.signal });
  assert.ok(!x.classList.contains('art-together'), 'a dead view never holds its art');
  load(dom, x);
  assert.ok(!shimmering(x));
  dom.window.close();
});

test('a re-run over the same host never re-batches an image a pending batch owns', () => {
  const { c, dom, doc, host } = domWithCommon();
  const a = img(doc, host); const b = img(doc, host, { left: 120 });
  c.revealArtTogether(host);
  load(dom, a);
  c.revealArtTogether(host); // e.g. a second render pass over the same host
  assert.ok(shimmering(a), 'still held by the FIRST batch (not re-owned, not revealed early)');
  load(dom, b);
  assert.ok(!shimmering(a) && !shimmering(b));
  dom.window.close();
});

test('a re-run cannot early-reveal a held image through its own (shorter) cap', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { c, dom, doc, host } = domWithCommon();
  const a = img(doc, host); const b = img(doc, host, { left: 120 });
  c.revealArtTogether(host); // the 600ms batch owns a + b
  load(dom, a);
  c.revealArtTogether(host, { capMs: 10 }); // a second pass with a short cap
  t.mock.timers.tick(10);
  assert.ok(shimmering(a), 'the second pass never owned a, so its cap cannot reveal a ahead of b');
  load(dom, b);
  assert.ok(!shimmering(a) && !shimmering(b), 'the owning batch reveals both together');
  dom.window.close();
});

test('shimmerArt is untouched for its other callers (still per image)', () => {
  const { c, dom, doc, host } = domWithCommon();
  const a = img(doc, host); const b = img(doc, host, { left: 120 });
  c.shimmerArt(host);
  load(dom, a);
  assert.ok(!shimmering(a) && shimmering(b), 'per image, no batching');
  dom.window.close();
});

test('wiring: exported on window.FileTube; the CSS hold rides only art-shimmer + art-together', () => {
  const src = read('public/js/common.js');
  assert.match(src, /window\.FileTube\.revealArtTogether = revealArtTogether;/);
  const css = read('public/css/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /img\.art-shimmer\.art-together\s*\{\s*object-position:\s*-100000px 0;\s*\}/, 'the hold keeps pixels out of the box while shimmering');
  assert.doesNotMatch(css, /(^|[}\s])\.art-together\s*\{/, 'no bare .art-together rule (a hold that could outlive the shimmer)');
});
