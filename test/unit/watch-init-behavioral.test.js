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
// Scope honesty: by default hydration fetches hang forever (frame-one only), so
// the CONFIRMED apply pass is not executed here -- its remove-vs-re-mount
// semantics are locked structurally in capability-cache.test.js. (Some tests
// route resolving fetches: the v1.196 ?tv= path, the v1.314 bell arms and the
// v1.317 hydrated video path.)

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
    // v1.314 gate r1: listeners are RECORDED (last per type) so a test can drive a
    // click; every earlier test ignores them. v1.317 gate r2: the OPTIONS too (_lo),
    // so a test can bind a listener's `{ signal }` by execution.
    addEventListener(t, fn, opts) { (el._l = el._l || {})[t] = fn; (el._lo = el._lo || {})[t] = opts; }, removeEventListener() {},
    // v1.197: the tv path now runs the cog-injection + ambient setup, which use
    // insertAdjacentHTML (and, v1.312, an OFF-DOM sample canvas the engine creates
    // only on its first sample) - permissive stubs (the ambient engine never
    // starts in the harness; ambientShouldRun gates it off).
    insertAdjacentHTML() {},
    getContext() { return { drawImage() {}, getImageData() { return { data: [] }; }, clearRect() {}, fillRect() {} }; },
    appendChild(c) { if (c) { try { c.parentNode = el; c.isConnected = true; } catch (_) { /* shim */ } el.children.push(c); } return c; },
    insertBefore(c) { if (c) { try { c.parentNode = el; c.isConnected = true; } catch (_) { /* shim */ } el.children.unshift(c); } return c; },
    removeChild() {}, remove() { el.isConnected = false; },
    querySelectorAll() { return []; },
    querySelector() { return null; }, // v1.317: the hydrated video path asks its action row for children ("not found" branch)
    // v1.317: the hydrated video path (initWatch steps 3-9) mounts the action-row buttons;
    // permissive no-ops like insertAdjacentHTML above (nothing here is under test).
    replaceChildren() {}, append() {}, prepend() {}, before() {}, after() {}, matches() { return false; }, hasAttribute() { return false; }, contains() { return false; }, dispatchEvent() { return true; }, scrollIntoView() {},
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

// v1.317 gate r1 fix: the REAL player api's property names, read from player.js's
// `var api = { ... }` literal plus its `api.X = ` / defineProperty(api, 'X') additions,
// so the harness Proxy answers exactly what production answers (see its get trap).
const REAL_PLAYER_API = (() => {
  const src = fs.readFileSync(path.join(REPO, 'public/js/player.js'), 'utf8');
  const start = src.indexOf('\n  var api = {\n');
  assert.ok(start !== -1, 'player.js: the `var api = {` literal moved - update REAL_PLAYER_API');
  const end = src.indexOf('\n  };\n', start);
  const names = new Set();
  for (const m of src.slice(start, end).matchAll(/^ {4}([A-Za-z_$][\w$]*)\s*[:(]/gm)) names.add(m[1]);
  for (const m of src.matchAll(/\bapi\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) names.add(m[1]);
  for (const m of src.matchAll(/defineProperty\(api,\s*'([^']+)'/g)) names.add(m[1]);
  return names;
})();

test('harness: REAL_PLAYER_API is read from player.js (non-vacuous; a misspelling is NOT on it)', () => {
  for (const n of ['load', 'expand', 'dock', 'close', 'setTrackNav', 'getState', 'isLoopEnabled', 'currentId', 'ensureTheaterButton']) {
    assert.ok(REAL_PLAYER_API.has(n), `REAL_PLAYER_API carries ${n} (got ${[...REAL_PLAYER_API].join(', ')})`);
  }
  assert.ok(!REAL_PLAYER_API.has('ensureTheatreButton'), 'the misspelled writer is not on the real api');
});

// v1.317 gate r2 (adversary S3): the regex scan above misses an ES shorthand member or a
// getter in the literal (a silent SUBSET); bind it to the RUNTIME api of the real player.js.
test('harness: REAL_PLAYER_API equals the runtime api of the real player.js (jsdom)', () => {
  const w = new (require('jsdom').JSDOM)('<body></body>', { url: 'http://localhost/', runScripts: 'outside-only' }).window;
  w.eval(fs.readFileSync(path.join(REPO, 'public/js/player.js'), 'utf8'));
  assert.deepStrictEqual([...REAL_PLAYER_API].sort(), Object.getOwnPropertyNames(w.FileTube.player).sort());
});

const FULL_SEED_ITEM = {
  id: 'vid1', title: 'T', filePath: '/downloads/Chan/vid.mp4', type: 'video',
  size: 123, addedAt: Date.now() - 1000, duration: 60,
  channelUrl: 'https://www.youtube.com/@chan', channel: 'Chan',
};

// Builds a fresh sandbox, evaluates the REAL watch.js in it, and returns
// {init, els} -- els is the shared selector->element map, pre-seedable.
function buildWatchRealm({ cacheEntry, search = '?v=vid1', fetchImpl, overrides } = {}) {
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
  // v1.317 (gate r1, adversary W1): the ONE writer of #theater-btn lives on the
  // player api; a SPY (not the Proxy's `() => undefined` fallback) so a test can
  // assert initWatch / initTvWatch actually CALL it - a source regex on the call
  // string survived a one-letter typo in the `typeof` guard that removed the
  // theatre button from every watch page.
  const theaterCalls = [];
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
  let capturedDestroy = null;
  const seedCalls = [];
  // v1.317 gate r2: every AbortController the realm creates, so a test can name the
  // one init() made (its first statement) and compare a listener's signal to it.
  const abortControllers = [];
  class RecordingAbortController extends AbortController {
    constructor() { super(); abortControllers.push(this); }
  }
  const windowShim = {
    FileTube: {
      player: new Proxy({
        currentId: null, getState: () => ({ docked: false, loaded: false }),
        load: (id, data, opts) => { loadCalls.push({ id, data, opts }); return true; },
        setTrackNav: (h) => { trackNavCalls.push(h); },
        isLoopEnabled: () => false,
        ensureTheaterButton: () => { theaterCalls.push(1); return getEl('#theater-btn'); },
      }, {
        // v1.317 gate r1 fix (the guard-typo mutant SURVIVED the first spy): the old
        // fallback answered EVERY unknown name with a function, so a misspelled
        // `typeof player.ensureTheatreButton === 'function'` guard was true here while
        // it is false in production. Unlisted names now answer a no-op only when the
        // REAL player api carries them; anything else is undefined, as in the browser.
        get(t, p) { if (p in t) return t[p]; return REAL_PLAYER_API.has(p) ? () => undefined : undefined; },
      }),
      consumeWatchSeed: (id) => { seedCalls.push(id); return { item: FULL_SEED_ITEM, folderSettings: null }; },
      registerView: (name, handlers) => { if (name === 'watch') { capturedInit = handlers.init; capturedDestroy = handlers.destroy; } },
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
    console, URL, URLSearchParams, AbortController: RecordingAbortController, Date, Math, JSON, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Node: function Node() {}, requestAnimationFrame: windowShim.requestAnimationFrame,
    history: windowShim.history, location: windowShim.location,
    screen: { width: 1200, height: 800 },
  };
  for (const [k, v] of Object.entries(common)) sandbox[k] = v;
  for (const [k, v] of Object.entries(overrides || {})) sandbox[k] = v; // v1.314: e.g. a capturing buildSubscribeModal
  // Non-exported browser globals common.js defines page-side; not under test.
  sandbox.primePinnedSidebarFromCache = () => {};
  sandbox.fetchAllPins = () => Promise.resolve([]);
  sandbox.renderPinnedSidebar = () => {};
  sandbox.FileTube = windowShim.FileTube;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(REPO, 'public/js/watch.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'watch.js' });
  assert.ok(capturedInit, 'watch.js must register its init with the router');
  return { init: capturedInit, destroy: capturedDestroy, els, loc: windowShim.location, seedCalls, loadCalls, trackNavCalls, fetchUrls, theaterCalls, abortControllers };
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
  // v1.314: the push bell renders in the same frame-one apply, OFF for a cached
  // record without the flag (the opt-in default).
  const bell = btn.parentNode.children.find((c) => c.id === 'notify-channel-btn');
  assert.ok(bell, 'Notify bell created in the SAME frame-one apply');
  assert.equal(bell.textContent, '🔕 Notify');
  // (the shim's setAttribute is a no-op, so aria-pressed is bound in ytdlp-subscriptions-client / by the label here)
});

test('v1.314 frame-one bell: a cached subscription with pushBell:true renders the bell ON; an UNSUBSCRIBED page renders no bell at all', () => {
  const on = buildWatchRealm({ cacheEntry: { ...WARM_SUBSCRIBED_CACHE, subs: [{ ...WARM_SUBSCRIBED_CACHE.subs[0], pushBell: true }] } });
  const btn = Object.assign(makeEl('button'), { hidden: true });
  on.els.set('#subscribe-btn-mock', btn);
  const root = makeEl('div');
  root.querySelector = (sel) => { if (!on.els.has(sel)) on.els.set(sel, makeEl('div')); return on.els.get(sel); };
  on.init(root);
  const bell = btn.parentNode.children.find((c) => c.id === 'notify-channel-btn');
  assert.ok(bell, 'bell present');
  assert.equal(bell.textContent, '🔔 Notifying', 'the cached ON flag renders ON in frame one (scrubSubsForCache must carry it)');

  const off = buildWatchRealm({ cacheEntry: { ...WARM_SUBSCRIBED_CACHE, subs: [{ id: 's9', channelUrl: 'https://www.youtube.com/@someoneelse', name: 'Else' }] } });
  const btn2 = Object.assign(makeEl('button'), { hidden: true });
  off.els.set('#subscribe-btn-mock', btn2);
  const root2 = makeEl('div');
  root2.querySelector = (sel) => { if (!off.els.has(sel)) off.els.set(sel, makeEl('div')); return off.els.get(sel); };
  off.init(root2);
  assert.equal(btn2.textContent, 'Subscribe', 'precondition: not subscribed to this channel');
  assert.equal(btn2.parentNode.children.find((c) => c.id === 'notify-channel-btn'), undefined, 'no bell without a subscription record to hang it on');
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
    // v1.197 (W2): the description-panel display fields.
    sizeBytes: 123456, addedAtMs: Date.now() - 86400000, fileName: 'My Show S01E02 - Pilot.mp4', ext: '.mp4',
  };
  const showDetail = { id: 'show1', name: 'My Show', seasons: [
    // ep2 carries the full display fields (gate S1: bare {id} fixtures left the
    // whole card-title path - SxxEyy padding, title fallback, escaping - untested).
    { seasonNum: 1, label: 'Season 1', episodes: [{ id: 'ep0' }, { id: 'ep1' }, { id: 'ep2', seasonNum: 1, episodeNum: 3, title: 'End', durationSec: 60 }] },
  ] };
  const fetchImpl = (url) => {
    const u = String(url);
    if (u.indexOf('/api/tv/episode/ep1') === 0) return Promise.resolve({ ok: true, json: () => Promise.resolve(epDetail) });
    if (u.indexOf('/api/tv/show1') === 0) return Promise.resolve({ ok: true, json: () => Promise.resolve(showDetail) });
    if (u.indexOf('/api/settings') === 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); // cog toggles read it (source-agnostic)
    return new Promise(() => {}); // anything else hangs (a stray /api/videos would be a violation, caught below)
  };
  const { init, els, loadCalls, trackNavCalls, fetchUrls } = buildWatchRealm({ search: '?tv=ep1', fetchImpl });
  const title = makeEl('h1'); els.set('#media-title', title);
  const channelName = makeEl('a'); els.set('#uploader-channel-name', channelName);
  const subsCount = makeEl('div'); els.set('#uploader-subs-count', subsCount);
  const descPara = makeEl('div'); els.set('#video-description', descPara);
  const typeText = makeEl('span'); els.set('#file-type-text', typeText);
  const filePathEl = makeEl('span'); els.set('#file-path-text', filePathEl);
  const subBtn = makeEl('button'); els.set('#subscribe-btn-mock', subBtn);
  const commentsBox = makeEl('div'); els.set('#comments-container', commentsBox);
  const relatedHeader = makeEl('div'); relatedHeader.hidden = true; els.set('#related-header', relatedHeader);
  const relatedBox = makeEl('div'); els.set('#related-files-container', relatedBox);
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

  // v1.197 W1: the dock-return href is the TV watch URL (the readerHref seam) -
  // without it the mini-player tap-return built /watch.html?v=<episodeId> and the
  // video path errored "Failed to Load Media" (Dean's device report).
  assert.equal(loadCalls[0].data.readerHref, '/watch.html?tv=ep1', 'the dock returns to the ?tv= watch URL');

  // v1.197 W2: the show-as-channel + file-metadata panel painted from the live shapes.
  assert.equal(channelName.textContent, 'My Show', 'the "channel" is the show');
  assert.equal(channelName.href, '/tv?show=show1', 'tapping the channel returns to the show');
  assert.equal(subsCount.textContent, '1 season · 3 episodes', 'the subs line is the show\'s season/episode counts (from the track-nav fetch)');
  // (v1.198: the filename moved from the description to the File Path row - see
  // the asserts below; the old description assert was superseded.)
  // Gate fix (both seats, the divergent-fixture class): the fixture's `ext`
  // matches what the REAL server now sends (bound in rbac-tv-enforcement), and
  // the PAINTED type is asserted - omitting ext from the payload turns this red.
  assert.equal(typeText.textContent, 'MP4', 'the Type field paints the real extension, not the fallback');

  // v1.198 (Dean's polish round, all device-confirmed via the live probe):
  assert.equal(filePathEl.textContent, 'My Show S01E02 - Pilot.mp4', 'the File Path row paints the BASENAME (was a forever-shimmer)');
  assert.equal(descPara.textContent, '', 'the description is empty now (the filename moved to the File Path row - no duplication)');
  assert.equal(subBtn.style.display, 'none', 'NO Subscribe on an episode (the [hidden]-loses-to-display class made it show)');
  assert.ok(commentsBox.children.length > 0, 'the fake retro comments render on episodes (same machinery as videos, episode-id-scoped)');
  // Slim-gate WARNING 1: rendering alone is not VISIBILITY - re-adding
  // '#comments-container' to hideTvVideoChrome's list appends children into a
  // display:none box and stayed green. Bind the visibility axis too.
  assert.notEqual(commentsBox.style.display, 'none', 'the comments container is not re-hidden on tv (Dean\'s exact complaint)');
  // Slim-gate SUGGESTION 1: the episode-id scope binds via the REAL storage key -
  // deleting `commentScopeId = episodeId` would key every episode on comments_null.
  assert.ok(storage.has('comments_ep1'), 'comments persist under the EPISODE id bucket');
  assert.ok(!storage.has('comments_null'), 'never the null bucket');

  // v1.198.1 (Dean): the Up-next rail = the show's OTHER episodes ROTATED around
  // the current one - after it in order, then WRAP to the start (current ep1 of
  // [ep0, ep1, ep2] -> [ep2, ep0]; the ep0-after-ep2 ordering IS the wrap bind).
  assert.equal(relatedHeader.hidden, false, 'the Up-next header is revealed on tv');
  assert.equal(relatedHeader.textContent, 'Up next', 'labelled Up next, not Related files');
  const ep2At = relatedBox.innerHTML.indexOf('?tv=ep2');
  const ep0At = relatedBox.innerHTML.indexOf('?tv=ep0');
  assert.ok(ep2At !== -1 && ep0At !== -1, 'both other episodes render as ?tv= cards');
  assert.ok(ep2At < ep0At, 'ep2 (next in order) precedes ep0 (the wrap-around)');
  assert.ok(!relatedBox.innerHTML.includes('?tv=ep1'), 'the CURRENT episode is excluded');
  assert.ok(relatedBox.innerHTML.includes('/tvthumb/ep2'), 'cards use the per-episode art route');
  // Gate W1 (presence-not-binding): the hide mechanism is style.display, which
  // the .hidden asserts above cannot see - re-adding the rail selectors to the
  // hide list rendered everything into an invisible container, suite green.
  assert.notEqual(relatedHeader.style.display, 'none', 'the header is not display-hidden (the tv hide-list must not cover it)');
  assert.notEqual(relatedBox.style.display, 'none', 'the container is not display-hidden');
  // Gate S1: the enriched fixture drives the real card-title path.
  assert.ok(relatedBox.innerHTML.includes('S01E03 - End'), 'the SxxEyy code + title render (padding + escape path exercised)');
});

// Gate W2's empty axis: a single-episode show has NO "up next" - the header must
// HIDE and the seeded skeleton must be cleared (deleting the empty-branch clear,
// or the header.hidden line, turns this red - both survived round 1).
test('v1.198.1 Up-next rail: a single-episode show hides the header and clears the seeded skeleton', async () => {
  const epDetail = {
    id: 'solo', type: 'video', title: 'Only One', showId: 'show1', showName: 'Solo Show',
    duration: 100, needsTranscode: false, transcodeStatus: 'ready',
    streamSrc: '/tvepisode/solo', statusUrl: '/api/tv/episode/solo', artUrl: '/tvposter/show1',
    progress: 0, sizeBytes: 1, addedAtMs: Date.now(), fileName: 'Solo.mp4', ext: '.mp4',
  };
  const showDetail = { id: 'show1', name: 'Solo Show', seasons: [{ seasonNum: 1, label: 'Season 1', episodes: [{ id: 'solo' }] }] };
  const fetchImpl = (url) => {
    const u = String(url);
    if (u.indexOf('/api/tv/episode/solo') === 0) return Promise.resolve({ ok: true, json: () => Promise.resolve(epDetail) });
    if (u.indexOf('/api/tv/show1') === 0) return Promise.resolve({ ok: true, json: () => Promise.resolve(showDetail) });
    if (u.indexOf('/api/settings') === 0) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    return new Promise(() => {});
  };
  const { init, els } = buildWatchRealm({ search: '?tv=solo', fetchImpl });
  const relatedHeader = makeEl('div'); relatedHeader.hidden = true; els.set('#related-header', relatedHeader);
  const relatedBox = makeEl('div'); els.set('#related-files-container', relatedBox);
  const root = makeEl('div');
  root.querySelector = (sel) => { if (!els.has(sel)) els.set(sel, makeEl('div')); return els.get(sel); };
  init(root);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(relatedHeader.hidden, true, 'no other episodes -> the Up-next header stays hidden');
  assert.equal(relatedBox.innerHTML, '', 'the seeded skeleton is CLEARED, never stranded');
});

// ---- v1.197 W1 (both gate seats, BLOCKING): the tv path's cog sequence bound --
// The "video-path setup the TV branch skips" class has struck twice (v1.196.1
// controls, v1.196 ambient). This comment-stripped source-lock binds initTvWatch's
// five-call cog sequence - the adversarial seat proved removing the whole block
// left the suite green (the exact v1.196 ambient bug reverting silently).
test('v1.197 W1: initTvWatch runs the FULL cog sequence (inject + autoplay + loop + theatre + ambient)', () => {
  const watchSrc = fs.readFileSync(require('node:path').join(REPO, 'public/js/watch.js'), 'utf8');
  const start = watchSrc.indexOf('async function initTvWatch(');
  assert.ok(start > 0, 'initTvWatch exists');
  const body = watchSrc.slice(start, watchSrc.indexOf('\n    }', start));
  const stripped = body.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.match(stripped, /ensureCogControlsInjected\(\);\s*\n\s*setupAutoplayToggle\(\);\s*\n\s*setupLoopToggle\(\);\s*\n\s*setupTheatreToggle\(\);\s*\n\s*setupAmbientMode\(\);/,
    'the five-call sequence, in order, after the player mounts - deleting any call (the v1.196 ambient bug) turns this red');
});

// ---- v1.197.1 (Dean device, the v1.54 TDZ class RE-STRIKE on the tv path) ----
// The ?tv= branch RETURNS out of init(), so any `let` declared after it never
// executes and stays in the temporal dead zone for the whole page - every later
// read THROWS. setupAmbientMode's isAudioItem() read mediaData on the first
// paint, so ambient armed but painted nothing (proven by a live-Chromium probe:
// ReferenceError + an empty canvas; post-fix, frames paint). These bind BOTH
// halves: the declaration precedes the branch, and initTvWatch assigns it.
test('v1.197.1 TDZ: mediaData is declared BEFORE the ?tv= early return, and initTvWatch assigns the descriptor to it', () => {
  // COMMENT-STRIPPED first (the slim-gate finding: a raw indexOf lock is
  // comment-porous - commenting the declaration out and re-adding it below the
  // branch satisfied the un-stripped lock while fully reverting the fix).
  const watchSrc = fs.readFileSync(require('node:path').join(REPO, 'public/js/watch.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const decl = watchSrc.indexOf('let mediaData = null;');
  const branch = watchSrc.indexOf("const tvEpisodeId = urlParams.get('tv');");
  assert.ok(decl > 0 && branch > 0, 'both sites exist (uncommented)');
  assert.ok(decl < branch, 'the declaration EXECUTES before the tv branch can return (moving it back below re-opens the TDZ)');
  assert.strictEqual(watchSrc.indexOf('let mediaData = null;', decl + 1), -1, 'exactly ONE live declaration (a second one below the branch would shadow the fix)');
  const tvStart = watchSrc.indexOf('async function initTvWatch(');
  const tvBody = watchSrc.slice(tvStart, watchSrc.indexOf('\n    }', tvStart));
  assert.match(tvBody, /mediaData = descriptor;/, 'the tv path assigns its descriptor - isAudioItem (the SOLE tv-reachable mediaData reader today) reads real truth');
});

// ---- v1.314 gate r1 (adversary W1 + qa W1): the bell follows the RECORD through the
// in-page subscribe/unsubscribe arms, not only the reload applier ----------------
const settle = () => new Promise((r) => setTimeout(r, 0));
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
function mountSubscribed(cacheEntry, extra) {
  const calls = [];
  const realm = buildWatchRealm({
    cacheEntry,
    fetchImpl: (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      calls.push({ url: String(url), method, body: opts && opts.body ? JSON.parse(opts.body) : null });
      const r = extra && extra.route ? extra.route(method, String(url), calls[calls.length - 1].body) : null;
      return r ? Promise.resolve(r) : new Promise(() => {}); // unrouted (hydration) hangs: frame-one only
    },
    overrides: extra && extra.overrides,
  });
  const btn = Object.assign(makeEl('button'), { hidden: true });
  realm.els.set('#subscribe-btn-mock', btn);
  const root = makeEl('div');
  root.querySelector = (sel) => { if (!realm.els.has(sel)) realm.els.set(sel, makeEl('div')); return realm.els.get(sel); };
  realm.init(root);
  const bell = () => btn.parentNode.children.find((c) => c.id === 'notify-channel-btn' && c.isConnected);
  return { realm, btn, calls, bell };
}

test('v1.314 gate W1: an in-page UNSUBSCRIBE (DELETE 200) removes the bell - it can never PATCH a deleted subscription', async () => {
  const { btn, calls, bell } = mountSubscribed(WARM_SUBSCRIBED_CACHE, {
    route: (m, url) => (m === 'DELETE' && url === '/api/subscriptions/s1') ? jsonRes(200, {}) : null,
  });
  assert.equal(btn.textContent, 'Subscribed');
  assert.ok(bell(), 'precondition: bell present while subscribed');
  btn._l.click();
  await settle(); await settle();
  assert.equal(btn.textContent, 'Subscribe', 'the DELETE resolved');
  assert.equal(bell(), undefined, 'the bell is GONE with the record (W1 scenario A)');
  assert.ok(calls.some((c) => c.method === 'DELETE'), 'the unsubscribe fetch fired');
});

test('v1.314 gate W1: an in-page SUBSCRIBE (modal confirm, POST 201) creates the bell OFF from the POST response, and the cache carries it', async () => {
  let handlers = null;
  const { btn, bell, realm } = mountSubscribed({ ...WARM_SUBSCRIBED_CACHE, subs: [] }, {
    route: (m, url) => (m === 'POST' && url === '/api/subscriptions') ? jsonRes(201, { id: 'new1', channelUrl: 'https://www.youtube.com/@chan', pushBell: false }) : null,
    overrides: { buildSubscribeModal: (doc, opts, h) => { handlers = h; return { setError() {}, backdrop: makeEl('div'), modal: makeEl('div') }; } },
  });
  assert.equal(btn.textContent, 'Subscribe', 'precondition: not subscribed');
  assert.equal(bell(), undefined, 'precondition: no bell');
  btn._l.click(); // opens the (captured) modal
  assert.ok(handlers && typeof handlers.onConfirm === 'function', 'the modal handlers were captured');
  handlers.onConfirm({ channelUrl: 'https://www.youtube.com/@chan', format: 'video' });
  await settle(); await settle();
  assert.equal(btn.textContent, 'Subscribed');
  const b = bell();
  assert.ok(b, 'the bell appears WITHOUT a reload (W1 scenario B / D9 "one tap after adding")');
  assert.equal(b.textContent, '🔕 Notify', 'off by default');
  const cached = JSON.parse(global.sessionStorage.getItem('ft-cap-cache-v1'));
  const rec = cached.subs.find((x) => x.id === 'new1');
  assert.strictEqual(rec.pushBell, false, 'the cached record carries its bell (write-through)');
  void realm;
});

test('v1.314 gate S1: tapping the bell PATCHes { pushBell: true }, the label follows the RESPONSE, the cache is written through; a 403 leaves the label unchanged', async () => {
  let deny = false;
  const { calls, bell } = mountSubscribed(WARM_SUBSCRIBED_CACHE, {
    route: (m, url, body) => (m === 'PATCH' && url === '/api/subscriptions/s1')
      ? (deny ? jsonRes(403, { error: 'You do not have permission to manage subscriptions.' }) : jsonRes(200, { id: 's1', pushBell: body.pushBell }))
      : null,
  });
  const b = bell();
  assert.equal(b.textContent, '🔕 Notify');
  b._l.click();
  await settle(); await settle(); await settle();
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(patch.body, { pushBell: true }, 'the PATCH body flips the flag');
  assert.equal(b.textContent, '🔔 Notifying', 'the label follows the server response');
  assert.equal(b.disabled, false, 're-enabled');
  const cached = JSON.parse(global.sessionStorage.getItem('ft-cap-cache-v1'));
  assert.strictEqual(cached.subs.find((x) => x.id === 's1').pushBell, true, 'write-through to the cache');
  deny = true;
  b._l.click();
  await settle(); await settle(); await settle();
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 2, 'a second PATCH was attempted');
  assert.equal(b.textContent, '🔔 Notifying', 'a 403 leaves the label at the unchanged state (D8)');
  assert.equal(b.disabled, false);
});

// ---- v1.317 (gate r1, adversary W1): the WATCH side of "each view calls the ONE
// theatre-button writer" is bound by EXECUTION, not a source regex. The writer is
// player.js's ensureTheaterButton (on the player api); watch's
// ensureCogControlsInjected must CALL it post-mount on BOTH the video path (initWatch
// step 9) and the ?tv= episode path (initTvWatch). The surviving mutant this kills: a
// one-letter typo in the `typeof` guard (`ensureTheatreButton`) that never calls the
// writer - the regex lock stayed green while the button vanished from every watch page.
const VIDEO_DETAIL = { id: 'vid1', title: 'T', filePath: '/downloads/Chan/vid.mp4', type: 'video', size: 123, duration: 60, channel: 'Chan', liked: false, watchState: 'unwatched' };
function routeVideoHydration(url) {
  const u = String(url);
  if (u.indexOf('/api/config') === 0) return Promise.resolve(jsonRes(200, { folderSettings: {}, folders: [], folderDisplayNames: {}, syntheticFolders: [] }));
  if (u === '/api/videos/vid1') return Promise.resolve(jsonRes(200, VIDEO_DETAIL));
  if (u.indexOf('/api/settings') === 0) return Promise.resolve(jsonRes(200, {})); // the cog toggles read it
  return new Promise(() => {}); // everything else hangs (related rail, queue, subscriptions)
}
function mountVideoPath() {
  // page-side common.js globals the hydration path reaches (not exported; stubbed like
  // primePinnedSidebarFromCache above) - the harness's default hangs never got this far.
  const realm = buildWatchRealm({ cacheEntry: WARM_SUBSCRIBED_CACHE, fetchImpl: routeVideoHydration, overrides: { applyLikedSidebarEntry: () => {} } });
  const btn = Object.assign(makeEl('button'), { hidden: true });
  realm.els.set('#subscribe-btn-mock', btn);
  const root = makeEl('div');
  root.querySelector = (sel) => { if (!realm.els.has(sel)) realm.els.set(sel, makeEl('div')); return realm.els.get(sel); };
  const before = realm.abortControllers.length;
  realm.init(root);
  realm.initController = realm.abortControllers[before]; // init()'s first statement creates the view's controller
  return realm;
}

test('v1.317 gate W1: the video path CALLS the one theatre-button writer exactly once, post-mount (after player.load), never before the media resolves', async () => {
  const realm = mountVideoPath();
  assert.equal(realm.theaterCalls.length, 0, 'not called synchronously in init() - the host is mounted by player.load first');
  for (let i = 0; i < 40 && realm.theaterCalls.length === 0; i++) await settle(); // hydration -> step 4 load -> step 9
  for (let i = 0; i < 12; i++) await settle(); // and past it, so a SECOND call would be counted
  // the seeded open loads twice by design: the synchronous early adopt in init() + step 4's
  // idempotent re-load once the detail resolves (the real player treats the second as a reparent)
  assert.equal(realm.loadCalls.length, 2, 'precondition: the media was mounted (seed adopt + step 4), got ' + realm.loadCalls.length);
  assert.equal(realm.theaterCalls.length, 1, 'ensureCogControlsInjected called window.FileTube.player.ensureTheaterButton() exactly once (fetched: ' + realm.fetchUrls.join(', ') + ')');
});

// ---- v1.317 gate r2 (qa W1 + adversary W1): watch's theatre click is bound on the VIEW
// signal, by EXECUTION. After T1 music and watch share ONE button, so a watch listener
// that outlives its view runs on every MUSIC theatre click and flips the persisted
// ft-theater from the music page (measured by the adversary with a real-DOM drive). The
// hydrated video path reaches setupTheatreToggle (the auto-created #theater-btn is
// truthy); the shim records the listener options, so dropping `{ signal }` is red here.
test('v1.317 gate r2 W1: setupTheatreToggle binds the #theater-btn click on init()\'s signal, and destroy() aborts it', async () => {
  const realm = mountVideoPath();
  for (let i = 0; i < 40 && realm.theaterCalls.length === 0; i++) await settle();
  for (let i = 0; i < 12; i++) await settle();
  const tb = realm.els.get('#theater-btn');
  assert.ok(tb && tb._l && typeof tb._l.click === 'function', 'precondition: setupTheatreToggle ran and bound a click on #theater-btn');
  assert.ok(realm.initController, 'precondition: init() created its view controller');
  const opts = tb._lo.click;
  assert.ok(opts && opts.signal, 'the theatre click is registered WITH a signal (got ' + JSON.stringify(opts) + ')');
  assert.strictEqual(opts.signal, realm.initController.signal, 'it is init()\'s own view signal');
  assert.equal(opts.signal.aborted, false, 'live while the view is up');
  realm.destroy();
  assert.equal(opts.signal.aborted, true, 'destroy() aborts it, so the listener dies with the view');
});

test('v1.317 gate W1: the ?tv= episode path CALLS the one theatre-button writer exactly once (initTvWatch runs the same cog sequence)', async () => {
  const epDetail = { id: 'ep1', type: 'video', title: 'Pilot', showId: 'show1', showName: 'My Show', seasonNum: 1, episodeNum: 2, duration: 100, needsTranscode: false, transcodeStatus: 'ready', streamSrc: '/tvepisode/ep1', statusUrl: '/api/tv/episode/ep1', artUrl: '/tvposter/show1', progress: 0, sizeBytes: 1, addedAtMs: Date.now(), fileName: 'p.mp4', ext: '.mp4' };
  const showDetail = { id: 'show1', name: 'My Show', seasons: [{ seasonNum: 1, label: 'Season 1', episodes: [{ id: 'ep1' }] }] };
  const fetchImpl = (url) => {
    const u = String(url);
    if (u.indexOf('/api/tv/episode/ep1') === 0) return Promise.resolve(jsonRes(200, epDetail));
    if (u.indexOf('/api/tv/show1') === 0) return Promise.resolve(jsonRes(200, showDetail));
    if (u.indexOf('/api/settings') === 0) return Promise.resolve(jsonRes(200, {}));
    return new Promise(() => {});
  };
  const realm = buildWatchRealm({ search: '?tv=ep1', fetchImpl });
  const root = makeEl('div');
  root.querySelector = (sel) => { if (!realm.els.has(sel)) realm.els.set(sel, makeEl('div')); return realm.els.get(sel); };
  realm.init(root);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  for (let i = 0; i < 12; i++) await settle();
  assert.equal(realm.loadCalls.length, 1, 'precondition: the episode was mounted');
  assert.equal(realm.theaterCalls.length, 1, 'initTvWatch called the writer exactly once');
});

// ---- v1.317 (gate r1, adversary S2): the persistent host can arrive wearing the MUSIC
// view's aria-pressed (its own key). init() applies `.theater-mode` synchronously from
// ft-theater; the button's aria is re-stamped in the SAME synchronous pass, so the pressed
// look never disagrees with the class for the hydration RTT.
test('v1.317 gate S2: init() re-stamps #theater-btn aria-pressed from ft-theater synchronously, beside the class apply (?v= and ?tv=)', () => {
  // gate r2 (adversary W2): the host is reachable ONLY through the document here - the
  // docked host lives outside #view-root in every shell, so root.querySelector must not
  // find it (a `root.querySelector('#theater-btn')` mutant makes AC12 inert in
  // production). The ?tv= iteration binds that the re-stamp runs before the tv return.
  for (const search of ['?v=vid1', '?tv=ep1']) {
    for (const [stored, expected] of [['1', 'true'], ['0', 'false'], [null, 'false']]) {
      const realm = buildWatchRealm({ cacheEntry: WARM_SUBSCRIBED_CACHE, search });
      if (stored !== null) global.sessionStorage.setItem('ft-theater', stored); // the sandbox's localStorage IS this shim
      const writes = [];
      const tb = makeEl('button'); tb.setAttribute = (k, v) => { writes.push([k, v]); };
      realm.els.set('#theater-btn', tb); // the host is already in the document (a soft-nav from music)
      tb.setAttribute('aria-pressed', 'true'); writes.length = 0; // music left it pressed
      const root = makeEl('div');
      root.querySelector = (sel) => {
        if (sel === '#theater-btn') return null; // outside #view-root: only the document finds it
        if (!realm.els.has(sel)) realm.els.set(sel, makeEl('div'));
        return realm.els.get(sel);
      };
      realm.init(root); // synchronous part only - no await
      assert.deepEqual(writes, [['aria-pressed', expected]], `${search} ft-theater=${stored}: aria re-stamped synchronously to ${expected}`);
    }
  }
});
