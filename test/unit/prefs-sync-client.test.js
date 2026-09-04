'use strict';

// [UNIT] v1.265 - the client sync agent (public/js/prefs-sync.js) in jsdom.
// The axes: the setItem/removeItem SEAM (allowlisted mirrors, local keys and
// the meta key never mirror - the recursion axis), debounce batching, LWW
// apply BOTH directions (server-newer lands raw + stamps; local-newer
// survives), 401 dormancy, the visibility refresh leg, SHELL PARITY (dynamic,
// fail-safe floors), and the client/server/plan allowlist TRIPLE lock.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const AGENT_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'prefs-sync.js'), 'utf8');

// The plan's 22 keys - the AUTHORITY all three lists are locked against.
const PLAN_KEYS = [
  'theme', 'ft-era', 'ft-mode', 'ft-modern-mode', 'ft-icons',
  'filetube_sort', 'filetube_modern_sort', 'filetube_modern_chip',
  'ft-star-ratings', 'ft-ambient', 'ft-ambient-intensity',
  'ft-critters:on', 'ft-critters:density', 'ft-critters:size', 'ft-critters:kiss', 'ft-critters:randomsound',
  'ft-music-skin', 'ft-music-autoplay',
  'ft-home-feed', 'ft-home-continue-listening', 'ft-home-continue-podcasts', 'ft-tv-continue-watching',
];

function boot({ fetchImpl } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const calls = [];
  dom.window.fetch = fetchImpl || function (url, opts) {
    calls.push({ url, opts });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ prefs: {} }) });
  };
  // Drive the agent with controllable time.
  let now = 100000;
  dom.window.Date.now = () => now;
  const timers = [];
  dom.window.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  dom.window.eval(AGENT_SRC);
  return {
    dom,
    calls,
    ls: dom.window.localStorage,
    fireTimers() { const t = timers.splice(0); t.forEach((x) => x.fn()); },
    setNow(v) { now = v; },
    api: dom.window.__ftPrefsSync,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test('the seam: an allowlisted write mirrors (debounced batch POST); a LOCAL key and the meta key never do', async () => {
  const b = boot();
  await settle(); // the boot GET
  const bootCalls = b.calls.length;

  b.ls.setItem('theme', 'dark');
  b.ls.setItem('ft-volume', '0.5');      // deliberately LOCAL
  b.ls.setItem('ft-prefs-meta', '{}');   // the meta key must NOT recurse
  b.ls.setItem('ft-era', '2009');
  assert.equal(b.calls.length, bootCalls, 'nothing posts before the debounce fires');

  b.fireTimers();
  await settle();
  const posts = b.calls.slice(bootCalls).filter((c) => c.opts && c.opts.method === 'POST');
  assert.equal(posts.length, 1, 'ONE batched POST for the burst');
  const body = JSON.parse(posts[0].opts.body);
  assert.deepEqual(body.entries.map((e) => e.key).sort(), ['ft-era', 'theme'], 'only the synced keys mirrored');
  assert.equal(b.ls.getItem('theme'), 'dark', 'the caller\'s write landed regardless');
  assert.equal(b.ls.getItem('ft-volume'), '0.5');
});

test('removeItem mirrors a synced key as the empty-string tombstone', async () => {
  const b = boot();
  await settle();
  const before = b.calls.length;
  b.ls.setItem('theme', 'dark');
  b.fireTimers(); await settle();
  b.ls.removeItem('theme');
  b.fireTimers(); await settle();
  const posts = b.calls.slice(before).filter((c) => c.opts && c.opts.method === 'POST');
  const last = JSON.parse(posts[posts.length - 1].opts.body);
  assert.deepEqual(last.entries, [{ key: 'theme', value: '', updatedAt: 100000 }], 'the removal rides as \'\' with a stamp (LWW-coherent tombstone)');
  assert.equal(b.ls.getItem('theme'), null, 'locally removed');
});

test('LWW apply BOTH axes: server-newer lands (raw + stamp, theme live-applied); local-newer survives untouched', async () => {
  const b = boot();
  await settle();
  b.setNow(200000);
  b.ls.setItem('ft-era', '2013'); // local stamp 200000

  b.api.applyServer({
    theme: { value: 'dark', updatedAt: 150000 },      // no local stamp -> server wins
    'ft-era': { value: '2009', updatedAt: 150000 },   // local is NEWER -> local survives
    'ft-volume': { value: '1', updatedAt: 999999 },   // off-list from a hostile server -> ignored
  });
  assert.equal(b.ls.getItem('theme'), 'dark', 'server-newer landed');
  assert.equal(b.dom.window.document.documentElement.getAttribute('data-theme'), 'dark', 'THEME is the one live re-apply');
  assert.equal(b.ls.getItem('ft-era'), '2013', 'local-newer survived - the OTHER axis');
  assert.equal(b.ls.getItem('ft-volume'), null, 'a non-allowlisted server key never lands');
});

test('a server empty-string value applies as REMOVAL (the tombstone round-trip)', async () => {
  const b = boot();
  await settle();
  b.ls.setItem('theme', 'dark');
  b.fireTimers(); await settle();
  b.setNow(300000);
  b.api.applyServer({ theme: { value: '', updatedAt: 250000 } });
  assert.equal(b.ls.getItem('theme'), null, 'the tombstone removed the key locally');
});

test('401 -> dormant: no further GETs or POSTs this session', async () => {
  const calls = [];
  const b = boot({
    fetchImpl(url, opts) {
      calls.push({ url, opts });
      return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
    },
  });
  await settle(); // boot GET -> 401 -> dormant
  const after401 = calls.length;
  b.ls.setItem('theme', 'dark');
  b.fireTimers();
  await settle();
  b.api.refresh();
  await settle();
  assert.equal(calls.length, after401, 'dormant: the signed-out session stays local-only');
  assert.equal(b.ls.getItem('theme'), 'dark', 'local writes still work');
});

test('the visibility leg: becoming visible refreshes', async () => {
  const b = boot();
  await settle();
  const before = b.calls.length;
  Object.defineProperty(b.dom.window.document, 'visibilityState', { value: 'visible', configurable: true });
  b.dom.window.document.dispatchEvent(new b.dom.window.Event('visibilitychange'));
  await settle();
  assert.equal(b.calls.length, before + 1, 'one GET on focus');
  assert.ok(!b.calls[b.calls.length - 1].opts || !b.calls[b.calls.length - 1].opts.method, 'a GET, not a POST');
});

test('TRIPLE allowlist lock: the client list, the server list, and the plan are the SAME 22 keys', () => {
  const clientSrc = AGENT_SRC;
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  const b = boot();
  assert.deepEqual([...b.api.SYNCED].sort(), [...PLAN_KEYS].sort(), 'client === plan');
  for (const k of PLAN_KEYS) {
    assert.ok(serverSrc.includes(`'${k}'`), `server allowlist carries '${k}' (drift = a key that silently never syncs)`);
  }
  const setMatch = serverSrc.match(/const SYNCED_PREF_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(setMatch, 'the server Set literal exists');
  const serverKeys = [...setMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(serverKeys.sort(), [...PLAN_KEYS].sort(), 'server === plan (both directions - no extra server keys either)');
  assert.ok(clientSrc.includes("var META_KEY = 'ft-prefs-meta'"), 'the meta key is pinned (never in any allowlist)');
  assert.ok(!PLAN_KEYS.includes('ft-prefs-meta'), 'the meta key is not a synced key');
});

test('SHELL PARITY (dynamic): every public/*.html shell loads prefs-sync BEFORE common.js; fail-safe floors', () => {
  const shells = fs.readdirSync(path.join(__dirname, '..', '..', 'public')).filter((f) => f.endsWith('.html'));
  assert.ok(shells.length >= 10, `fail-safe floor: expected >=10 shells, found ${shells.length} (a broken glob must not vacuously pass)`);
  let checked = 0;
  for (const f of shells) {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', f), 'utf8');
    // anchor on the TAG spelling - comments mention /js/common.js earlier
    // in some shells (the comment-porous class, striking this test's own net)
    if (!html.includes('src="/js/common.js"')) continue; // no core scripts = no writers to mirror
    const syncAt = html.indexOf('src="/js/prefs-sync.js"');
    const commonAt = html.indexOf('src="/js/common.js"');
    assert.ok(syncAt > -1, `${f}: the sync agent is missing (the v1.250 shell-parity class)`);
    assert.ok(syncAt < commonAt, `${f}: the agent must load BEFORE common.js (the patch precedes the first synced write)`);
    checked++;
  }
  assert.ok(checked >= 10, `fail-safe floor: expected >=10 checked shells, checked ${checked}`);
});

test('a Storage-hostile environment (setItem throws) leaves the app functional', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  dom.window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ prefs: {} }) });
  // Simulate private-mode: the PROTOTYPE methods throw.
  const proto = Object.getPrototypeOf(dom.window.localStorage);
  proto.setItem = function () { throw new Error('QuotaExceededError'); };
  proto.getItem = function () { throw new Error('SecurityError'); };
  proto.removeItem = function () { throw new Error('SecurityError'); };
  assert.doesNotThrow(() => dom.window.eval(AGENT_SRC), 'the agent boots without throwing');
  assert.throws(() => dom.window.localStorage.setItem('theme', 'x'), /QuotaExceededError|SecurityError/, 'the caller sees the ORIGINAL storage error, not an agent crash');
});
