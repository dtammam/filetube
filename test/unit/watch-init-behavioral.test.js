'use strict';

// [UNIT] v1.54 gate round 1 (adversarial C1 + QA CRITICAL): BEHAVIORAL
// execution of the REAL public/js/watch.js init() under a vm DOM shim --
// adopted from the adversarial seat's own repro harness. The finding it
// exists for: the frame-one Subscribe/Pin seed call sat 800 lines above the
// `let` declarations it assigns, threw a TDZ ReferenceError on every
// warm-cache navigation, the SPA router's catch swallowed it (dead page),
// and every source-regex lock stayed green -- presence, not binding, in its
// strongest form. These tests RUN the real init; a reintroduced TDZ (or any
// throw on the synchronous path) fails here outright.
//
// Scope honesty: hydration fetches hang forever (frame-one only), so the
// CONFIRMED apply pass is not executed here -- its remove-vs-re-mount
// semantics are locked structurally in capability-cache.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');

// sessionStorage must exist in the require realm BEFORE common.js loads:
// its cache accessors close over their own realm's global.
const storage = new Map();
if (!global.sessionStorage) {
  global.sessionStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
}

const common = require('../../public/js/common.js');

// ---- minimal generic DOM shim ---------------------------------------------
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    children: [], style: {}, dataset: {}, hidden: false, disabled: false,
    textContent: '', innerHTML: '', className: '', title: '', href: '', src: '',
    isConnected: true, value: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { if (c) { try { c.parentNode = el; c.isConnected = true; } catch (_) { /* shim */ } el.children.push(c); } return c; },
    insertBefore(c) { if (c) { try { c.parentNode = el; c.isConnected = true; } catch (_) { /* shim */ } el.children.unshift(c); } return c; },
    removeChild() {}, remove() { el.isConnected = false; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {}, click() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 100 }; },
  };
  Object.defineProperty(el, 'firstChild', { get() { return el.children[0] || null; }, configurable: true });
  let parent;
  Object.defineProperty(el, 'parentNode', {
    get() { if (parent === undefined) parent = makeEl('div'); return parent; },
    set(v) { parent = v; },
    configurable: true,
  });
  return el;
}

const FULL_SEED_ITEM = {
  id: 'vid1', title: 'T', filePath: '/downloads/Chan/vid.mp4', type: 'video',
  size: 123, addedAt: Date.now() - 1000, duration: 60,
  channelUrl: 'https://www.youtube.com/@chan', channel: 'Chan',
};

// Builds a fresh sandbox, evaluates the REAL watch.js in it, and returns
// {init, els} -- els is the shared selector->element map, pre-seedable.
function buildWatchRealm({ cacheEntry } = {}) {
  storage.clear();
  if (cacheEntry) storage.set('ft-cap-cache-v1', JSON.stringify(cacheEntry));

  const els = new Map();
  function getEl(sel) {
    if (!els.has(sel)) els.set(sel, makeEl('div'));
    return els.get(sel);
  }
  const documentShim = {
    createElement: (t) => makeEl(t),
    createTextNode: () => makeEl('text'),
    querySelector: (sel) => getEl(sel),
    querySelectorAll: () => [],
    getElementById: (id) => getEl('#' + id),
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), documentElement: makeEl('html'),
    title: '',
  };
  let capturedInit = null;
  const windowShim = {
    FileTube: {
      player: new Proxy({ currentId: null, getState: () => ({ docked: false, loaded: false }), load: () => true, isLoopEnabled: () => false }, {
        get(t, p) { if (p in t) return t[p]; return () => undefined; },
      }),
      consumeWatchSeed: () => ({ item: FULL_SEED_ITEM, folderSettings: null }),
      registerView: (name, handlers) => { if (name === 'watch') capturedInit = handlers.init; },
    },
    location: { pathname: '/watch.html', search: '?v=vid1', origin: 'http://x', href: 'http://x/watch.html?v=vid1' },
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    history: { replaceState() {}, pushState() {} },
    innerWidth: 1200, innerHeight: 800,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  windowShim.window = windowShim;

  const sandbox = {
    window: windowShim, document: documentShim,
    sessionStorage: global.sessionStorage, localStorage: global.sessionStorage,
    navigator: { userAgent: 'x', clipboard: {} },
    fetch: () => new Promise(() => {}), // hydration hangs forever: frame-one only
    console, URL, URLSearchParams, AbortController, Date, Math, JSON, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Node: function Node() {}, requestAnimationFrame: windowShim.requestAnimationFrame,
    history: windowShim.history, location: windowShim.location,
    screen: { width: 1200, height: 800 },
  };
  for (const [k, v] of Object.entries(common)) sandbox[k] = v;
  // Non-exported browser globals common.js defines page-side; not under test.
  sandbox.primePinnedSidebarFromCache = () => {};
  sandbox.fetchAllPins = () => Promise.resolve([]);
  sandbox.renderPinnedSidebar = () => {};
  sandbox.FileTube = windowShim.FileTube;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(REPO, 'public/js/watch.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'watch.js' });
  assert.ok(capturedInit, 'watch.js must register its init with the router');
  return { init: capturedInit, els };
}

const WARM_SUBSCRIBED_CACHE = {
  ts: Date.now(), moduleEnabled: true,
  subs: [{ id: 's1', channelUrl: 'https://www.youtube.com/@chan', name: 'Chan' }],
  pins: [],
};

test('frame-one seed + warm cache: init() completes (no TDZ) and renders Subscribed + Pin synchronously', () => {
  const { init, els } = buildWatchRealm({ cacheEntry: WARM_SUBSCRIBED_CACHE });
  const btn = Object.assign(makeEl('button'), { hidden: true });
  els.set('#subscribe-btn-mock', btn);
  const root = makeEl('div');
  root.querySelector = (sel) => { if (!els.has(sel)) els.set(sel, makeEl('div')); return els.get(sel); };

  init(root); // the C1 repro threw ReferenceError right here

  assert.equal(btn.hidden, false, 'Subscribe button visible in frame one');
  assert.equal(btn.textContent, 'Subscribed', 'labeled from the cached sub match, never the "Subscribe" flash');
  const pin = btn.parentNode.children.find((c) => c.id === 'pin-channel-btn');
  assert.ok(pin, 'Pin button created in the SAME frame-one apply, not a later round trip');
  assert.equal(pin.textContent, 'Pin channel');
});

test('cached moduleEnabled:false HIDES but never removes (the confirmed answer must still be able to show)', () => {
  const { init, els } = buildWatchRealm({
    cacheEntry: { ...WARM_SUBSCRIBED_CACHE, moduleEnabled: false },
  });
  const btn = Object.assign(makeEl('button'), { hidden: true });
  els.set('#subscribe-btn-mock', btn);
  const root = makeEl('div');
  root.querySelector = (sel) => { if (!els.has(sel)) els.set(sel, makeEl('div')); return els.get(sel); };

  init(root);

  // Gate round 1 (QA CRITICAL / adversarial W4): a cached answer is
  // possibly one transient health blip, poisoned for a 5-min TTL. It may
  // hide; only a CONFIRMED answer removes.
  assert.equal(btn.hidden, true, 'hidden on the cached not-enabled answer');
  assert.equal(btn.isConnected, true, 'but STILL CONNECTED -- removal is reserved for confirmed answers');
});

test('cold cache: init() completes and the button simply stays as the markup left it', () => {
  const { init, els } = buildWatchRealm({}); // no cache entry at all
  const btn = Object.assign(makeEl('button'), { hidden: true });
  els.set('#subscribe-btn-mock', btn);
  const root = makeEl('div');
  root.querySelector = (sel) => { if (!els.has(sel)) els.set(sel, makeEl('div')); return els.get(sel); };

  init(root);

  assert.equal(btn.hidden, true, 'no cached answer -> no frame-one claim, hydration will decide');
  assert.equal(btn.isConnected, true);
});
