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
function buildWatchRealm({ cacheEntry, search = '?v=vid1', fetchImpl } = {}) {
  storage.clear();
  if (cacheEntry) storage.set('ft-cap-cache-v1', JSON.stringify(cacheEntry));

  const els = new Map();
  function getEl(sel) {
    if (!els.has(sel)) els.set(sel, makeEl('div'));
    return els.get(sel);
  }
  // v1.196: capture player.load descriptors + setTrackNav registrations + every
  // fetch URL, so the TV path's "never touch /api/videos" invariant is testable.
  const loadCalls = [];
  const trackNavCalls = [];
  const fetchUrls = [];
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
  const seedCalls = [];
  const windowShim = {
    FileTube: {
      player: new Proxy({
        currentId: null, getState: () => ({ docked: false, loaded: false }),
        load: (id, data, opts) => { loadCalls.push({ id, data, opts }); return true; },
        setTrackNav: (h) => { trackNavCalls.push(h); },
        isLoopEnabled: () => false,
      }, {
        get(t, p) { if (p in t) return t[p]; return () => undefined; },
      }),
      consumeWatchSeed: (id) => { seedCalls.push(id); return { item: FULL_SEED_ITEM, folderSettings: null }; },
      registerView: (name, handlers) => { if (name === 'watch') capturedInit = handlers.init; },
      navigate: () => {},
    },
    location: { pathname: '/watch.html', search, origin: 'http://x', href: 'http://x/watch.html' + search },
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
    fetch: (url, opts) => { fetchUrls.push(String(url)); return fetchImpl ? fetchImpl(url, opts) : new Promise(() => {}); }, // default: hydration hangs (frame-one only)
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
  return { init: capturedInit, els, loc: windowShim.location, seedCalls, loadCalls, trackNavCalls, fetchUrls };
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

// ---- v1.68.1: the legacy ?id= deep-link fallback, bound at the USE ---------
// A pure-helper test alone would let a mutant revert init back to
// urlParams.get('v') and stay green (the "testing a DECISION is not testing
// its USE" class). These run the REAL init against the shim location.

test('resolveWatchMediaId precedence table: v, id fallback, v-wins, absent, empty-string params', () => {
  const { resolveWatchMediaId } = require('../../public/js/watch.js');
  assert.equal(resolveWatchMediaId('?v=a'), 'a');
  assert.equal(resolveWatchMediaId('?id=a'), 'a', 'the legacy push-banner lane');
  assert.equal(resolveWatchMediaId('?v=a&id=b'), 'a', 'v wins when both are present');
  assert.equal(resolveWatchMediaId('?id=b&v=a'), 'a', 'v wins regardless of order');
  assert.equal(resolveWatchMediaId('?list=liked'), null);
  assert.equal(resolveWatchMediaId(''), null);
  assert.equal(resolveWatchMediaId('?v=&id=b'), 'b', 'an EMPTY v falls through to id');
});

test('legacy ?id= deep link (a pre-v1.67.4 push banner) initializes instead of bouncing home', () => {
  const { init, els, loc } = buildWatchRealm({ search: '?id=vid1' });
  const root = makeEl('div');
  root.querySelector = (sel) => { if (!els.has(sel)) els.set(sel, makeEl('div')); return els.get(sel); };

  init(root);

  assert.equal(loc.href, 'http://x/watch.html?id=vid1',
    'href untouched: the tap must land ON the video, never bounce to /');
});

test('gate W1: v-over-id precedence bound at the USE - init consumes the ?v= id when both params are present', () => {
  // The adversarial seat's verified probe: an init that inlines an id-first
  // read (`urlParams.get('id') || urlParams.get('v')`) survived the full
  // suite with the pure helper left exported, dead, and green. The seed
  // consume rides init's REAL mediaId, so capturing its argument binds the
  // precedence where it executes, not where it is defined.
  const { init, els, seedCalls } = buildWatchRealm({ search: '?v=vid1&id=other' });
  const root = makeEl('div');
  root.querySelector = (sel) => { if (!els.has(sel)) els.set(sel, makeEl('div')); return els.get(sel); };

  init(root);

  assert.deepStrictEqual(seedCalls, ['vid1'],
    'init consumed the seed for the ?v= id exactly once - never the legacy ?id=');
});

test('a watch URL with NO id still bounces home (the guard the fallback must not break)', () => {
  const { init, els, loc } = buildWatchRealm({ search: '?list=liked' });
  const root = makeEl('div');
  root.querySelector = (sel) => { if (!els.has(sel)) els.set(sel, makeEl('div')); return els.get(sel); };

  init(root);

  assert.equal(loc.href, '/', 'the no-id guard still redirects');
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

// ---- v1.196: the TV episode path (?tv=) drives the shared player ------------
// The HARD INVARIANT: a ?tv= load reuses the player host + track-nav but runs
// NONE of the video-only hydration, so it NEVER issues an /api/videos or /video
// request (that id is not in db.metadata). Behavioural, against the REAL init.

test('v1.196 ?tv= load: drives the shared player with the tv descriptor and never touches /api/videos', async () => {
  const epDetail = {
    id: 'ep1', type: 'video', title: 'Pilot', showId: 'show1', showName: 'My Show',
    seasonNum: 1, episodeNum: 2, duration: 100, needsTranscode: false,
    transcodeStatus: 'ready', streamSrc: '/tvepisode/ep1', statusUrl: '/api/tv/episode/ep1',
    artUrl: '/tvposter/show1', progress: 0,
  };
  const showDetail = { id: 'show1', name: 'My Show', seasons: [
    { seasonNum: 1, label: 'Season 1', episodes: [{ id: 'ep0' }, { id: 'ep1' }, { id: 'ep2' }] },
  ] };
  const fetchImpl = (url) => {
    const u = String(url);
    if (u.indexOf('/api/tv/episode/ep1') === 0) return Promise.resolve({ ok: true, json: () => Promise.resolve(epDetail) });
    if (u.indexOf('/api/tv/show1') === 0) return Promise.resolve({ ok: true, json: () => Promise.resolve(showDetail) });
    return new Promise(() => {}); // anything else hangs (a stray /api/videos would be a violation, caught below)
  };
  const { init, els, loadCalls, trackNavCalls, fetchUrls } = buildWatchRealm({ search: '?tv=ep1', fetchImpl });
  const title = makeEl('h1'); els.set('#media-title', title);
  const root = makeEl('div');
  root.querySelector = (sel) => { if (!els.has(sel)) els.set(sel, makeEl('div')); return els.get(sel); };

  init(root);
  for (let i = 0; i < 12; i++) await Promise.resolve(); // flush the async initTvWatch chain

  // THE INVARIANT: no /api/videos and no /video/ request on a tv load.
  assert.ok(!fetchUrls.some((u) => u.includes('/api/videos')), 'a ?tv= load must never hit /api/videos (got: ' + fetchUrls.join(', ') + ')');
  assert.ok(!fetchUrls.some((u) => u.includes('/video/')), 'a ?tv= load must never hit /video/ (got: ' + fetchUrls.join(', ') + ')');
  assert.ok(fetchUrls.some((u) => u.indexOf('/api/tv/episode/ep1') === 0), 'it DID fetch the tv episode detail');

  // The shared player is driven with the tv source descriptor.
  assert.equal(loadCalls.length, 1, 'the shared player.load ran exactly once');
  assert.equal(loadCalls[0].id, 'ep1');
  assert.equal(loadCalls[0].data.streamSrc, '/tvepisode/ep1', 'streams the tv route, not /video/:id');
  assert.equal(loadCalls[0].data.statusUrl, '/api/tv/episode/ep1', 'polls the tv route, not /api/videos/:id');
  assert.equal(loadCalls[0].data.channelName, 'My Show', 'the show name is the "channel" (lock-screen + uploader metadata)');

  // The episode title is painted (Dean item 4).
  assert.equal(title.textContent, 'Pilot', 'the episode name shows');

  // Prev/next registered across the whole show in order (ep1 -> prev ep0, next ep2).
  assert.ok(trackNavCalls.length >= 1, 'setTrackNav registered the show queue (prev/next/autoplay)');
  const nav = trackNavCalls[trackNavCalls.length - 1];
  assert.equal(typeof nav.onPrev, 'function', 'prev is armed (ep0)');
  assert.equal(typeof nav.onNext, 'function', 'next is armed (ep2)');
});
