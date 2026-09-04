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

// The plan's 21 keys - the AUTHORITY all three lists are locked against.
const PLAN_KEYS = [
  'ft-era', 'ft-mode', 'ft-modern-mode', 'ft-icons',
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

  b.ls.setItem('ft-era', '2009');
  b.ls.setItem('ft-volume', '0.5');      // deliberately LOCAL
  b.ls.setItem('ft-prefs-meta', '{}');   // the meta key must NOT recurse
  b.ls.setItem('ft-icons', 'classic');
  assert.equal(b.calls.length, bootCalls, 'nothing posts before the debounce fires');

  b.fireTimers();
  await settle();
  const posts = b.calls.slice(bootCalls).filter((c) => c.opts && c.opts.method === 'POST');
  assert.equal(posts.length, 1, 'ONE batched POST for the burst');
  const body = JSON.parse(posts[0].opts.body);
  assert.deepEqual(body.entries.map((e) => e.key).sort(), ['ft-era', 'ft-icons'], 'only the synced keys mirrored');
  assert.equal(b.ls.getItem('ft-era'), '2009', 'the caller\'s write landed regardless');
  assert.equal(b.ls.getItem('ft-volume'), '0.5');
});

test('removeItem mirrors a synced key as the empty-string tombstone', async () => {
  const b = boot();
  await settle();
  const before = b.calls.length;
  b.ls.setItem('ft-icons', 'classic');
  b.fireTimers(); await settle();
  b.ls.removeItem('ft-icons');
  b.fireTimers(); await settle();
  const posts = b.calls.slice(before).filter((c) => c.opts && c.opts.method === 'POST');
  const last = JSON.parse(posts[posts.length - 1].opts.body);
  assert.deepEqual(last.entries, [{ key: 'ft-icons', value: '', updatedAt: 100000 }], 'the removal rides as \'\' with a stamp (LWW-coherent tombstone)');
  assert.equal(b.ls.getItem('ft-icons'), null, 'locally removed');
});

test('LWW apply BOTH axes: server-newer lands (raw + stamp, theme live-applied); local-newer survives untouched', async () => {
  const b = boot();
  await settle();
  b.setNow(200000);
  b.ls.setItem('ft-era', '2013'); // local stamp 200000

  b.api.applyServer({
    'ft-mode': { value: 'dark', updatedAt: 150000 },  // no local stamp -> server wins
    'ft-era': { value: '2009', updatedAt: 150000 },   // local is NEWER -> local survives
    'ft-volume': { value: '1', updatedAt: 999999 },   // off-list from a hostile server -> ignored
  });
  assert.equal(b.ls.getItem('ft-mode'), 'dark', 'server-newer landed');
  assert.equal(b.dom.window.document.documentElement.getAttribute('data-mode'), 'dark', 'the LIVE re-apply targets data-mode (QA W1: era/mode, the keys with real writers)');
  assert.equal(b.ls.getItem('ft-era'), '2013', 'local-newer survived - the OTHER axis');
  assert.equal(b.ls.getItem('ft-volume'), null, 'a non-allowlisted server key never lands');
});

test('a server empty-string value applies as REMOVAL (the tombstone round-trip)', async () => {
  const b = boot();
  await settle();
  b.ls.setItem('ft-icons', 'classic');
  b.fireTimers(); await settle();
  b.setNow(300000);
  b.api.applyServer({ 'ft-icons': { value: '', updatedAt: 250000 } });
  assert.equal(b.ls.getItem('ft-icons'), null, 'the tombstone removed the key locally');
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
  b.ls.setItem('ft-era', '2009');
  b.fireTimers();
  await settle();
  b.api.refresh();
  await settle();
  assert.equal(calls.length, after401, 'dormant: the signed-out session stays local-only');
  assert.equal(b.ls.getItem('ft-era'), '2009', 'local writes still work');
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

test('TRIPLE allowlist lock: the client list, the server list, and the plan are the SAME 21 keys (QA W1: the writer-less legacy theme key removed - a key nothing writes can never sync)', () => {
  const clientSrc = AGENT_SRC;
  const b = boot();
  assert.deepEqual([...b.api.SYNCED].sort(), [...PLAN_KEYS].sort(), 'client === plan');
  // The server-side list lives in ONE shared module since the adversarial
  // round (the restore loop consumes it too) - bind the module itself.
  const shared = require('../../lib/prefs-allowlist');
  assert.deepEqual([...shared.SYNCED_PREF_KEYS].sort(), [...PLAN_KEYS].sort(), 'shared module === plan (both directions)');
  assert.equal(shared.PREF_VALUE_MAX_BYTES, 512);
  assert.equal(shared.PREF_CLOCK_SLACK_MS, 300000);
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.ok(serverSrc.includes("require('./lib/prefs-allowlist')"), 'the routes consume the shared module');
  const storeSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'auth', 'store.js'), 'utf8');
  assert.ok(storeSrc.includes("require('../prefs-allowlist')"), 'the RESTORE loop consumes the shared module (adversarial W-A/W-C: every ingress, one list)');
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


test('QA C1 REGRESSION (the real boot shape): re-writing the UNCHANGED value neither re-stamps nor posts, so a server-newer row is then ADOPTED', async () => {
  const b = boot();
  await settle(); // boot settles
  b.ls.setItem('ft-era', '2021'); // first write DOES mirror (a genuine change from absent)
  b.fireTimers(); await settle();
  const afterFirst = b.calls.filter((c) => c.opts && c.opts.method === 'POST').length;

  b.setNow(200000);
  b.ls.setItem('ft-era', '2021'); // the BOOT RE-APPLY: same value, new day
  b.fireTimers(); await settle();
  const posts = b.calls.filter((c) => c.opts && c.opts.method === 'POST').length;
  assert.equal(posts, afterFirst, 'the unchanged re-write did NOT post (equality suppression)');

  // Device A's genuine change (older wall-clock than the re-apply above) now ADOPTS
  // - before the fix the re-apply's fresh stamp rejected it (last-BOOT-wins).
  b.api.applyServer({ 'ft-era': { value: '2009', updatedAt: 150000 } });
  assert.equal(b.ls.getItem('ft-era'), '2009', 'the other device\'s change landed - LWW restored');
  assert.equal(b.dom.window.document.documentElement.getAttribute('data-theme'), '2009', 'and the era live-applied');
});

test('QA C1 other axis: removeItem of an ABSENT key is suppressed like an equal write', async () => {
  const b = boot();
  await settle();
  const before = b.calls.filter((c) => c.opts && c.opts.method === 'POST').length;
  b.ls.removeItem('ft-icons'); // never set
  b.fireTimers(); await settle();
  const after = b.calls.filter((c) => c.opts && c.opts.method === 'POST').length;
  assert.equal(after, before, 'no tombstone for a key that was never there');
});

test('QA W2: flushes HOLD until the boot GET settles, and a boot-race loser is dropped', async () => {
  let resolveBoot;
  const calls = [];
  const b = boot({
    fetchImpl(url, opts) {
      calls.push({ url, opts });
      if (!opts || !opts.method) {
        return new Promise((r) => { resolveBoot = () => r({ ok: true, status: 200, json: () => Promise.resolve({ prefs: { 'ft-home-feed': { value: 'on', updatedAt: 999999999 } } }) }); });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    },
  });
  // The legacy seed fires BEFORE the GET resolves (the fresh-device shape).
  b.ls.setItem('ft-home-feed', 'off');   // the seed - will LOSE to the server row
  b.ls.setItem('ft-icons', 'classic');   // an innocent boot-time write - must survive
  b.fireTimers(); await settle();
  assert.equal(calls.filter((c) => c.opts && c.opts.method === 'POST').length, 0, 'nothing posted while boot is unsettled');

  resolveBoot(); await settle(); await settle();
  b.fireTimers(); await settle();
  const posts = calls.filter((c) => c.opts && c.opts.method === 'POST');
  assert.equal(posts.length, 1, 'the held flush released after boot');
  const keys = JSON.parse(posts[0].opts.body).entries.map((e) => e.key);
  assert.deepEqual(keys, ['ft-icons'], 'the boot-race loser (the seed the server out-ranked) was dropped; the innocent write posted');
  assert.equal(b.ls.getItem('ft-home-feed'), 'on', 'the server\'s row won locally too');
});

test('QA S1: an un-acked POST returns to pending and retries (never over a newer same-key write)', async () => {
  let failNext = true;
  const calls = [];
  const b = boot({
    fetchImpl(url, opts) {
      calls.push({ url, opts });
      if (!opts || !opts.method) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ prefs: {} }) });
      if (failNext) { failNext = false; return Promise.reject(new Error('offline')); }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    },
  });
  await settle();
  b.ls.setItem('ft-era', '2009');
  b.fireTimers(); await settle(); // POST #1 fails -> entries restored, re-armed
  b.fireTimers(); await settle(); // POST #2 retries
  const posts = calls.filter((c) => c.opts && c.opts.method === 'POST');
  assert.equal(posts.length, 2, 'the dropped flight retried');
  assert.deepEqual(JSON.parse(posts[1].opts.body).entries.map((e) => e.key), ['ft-era']);
});

test('QA S2: a double-load is a no-op (one mirror per write, the first api object survives)', async () => {
  const b = boot();
  await settle();
  const api1 = b.dom.window.__ftPrefsSync;
  b.dom.window.eval(AGENT_SRC); // the second load
  assert.strictEqual(b.dom.window.__ftPrefsSync, api1, 'the guard kept the first instance');
  b.ls.setItem('ft-era', '2009');
  b.fireTimers(); await settle();
  const posts = b.calls.filter((c) => c.opts && c.opts.method === 'POST');
  assert.equal(posts.length, 1, 'ONE post - no double-mirror');
  assert.equal(JSON.parse(posts[0].opts.body).entries.length, 1);
});


test('adversarial W-D: the live re-apply\'s shape guards BIND - junk era/mode values never reach the attributes', async () => {
  const b = boot();
  await settle();
  b.setNow(500000);
  b.api.applyServer({
    'ft-era': { value: '<img onerror=x>', updatedAt: 400000 },
    'ft-mode': { value: 'sideways', updatedAt: 400000 },
  });
  assert.equal(b.ls.getItem('ft-era'), '<img onerror=x>', 'the VALUE lands in storage (next boot re-validates + heals)');
  assert.equal(b.dom.window.document.documentElement.getAttribute('data-theme'), null, 'junk era never touches data-theme (drop the shape guard and this reds)');
  assert.equal(b.dom.window.document.documentElement.getAttribute('data-mode'), null, 'junk mode never touches data-mode');
});

test('adversarial W-B: a resolved 5xx is UN-ACKED - the batch restores and retries like a network failure', async () => {
  let status = 502;
  const calls = [];
  const b = boot({
    fetchImpl(url, opts) {
      calls.push({ url, opts });
      if (!opts || !opts.method) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ prefs: {} }) });
      const st = status; status = 200;
      return Promise.resolve({ ok: st === 200, status: st, json: () => Promise.resolve({}) });
    },
  });
  await settle();
  b.ls.setItem('ft-era', '2009');
  b.fireTimers(); await settle(); // POST #1 -> 502 -> restored + re-armed
  b.fireTimers(); await settle(); // POST #2 -> 200
  const posts = calls.filter((c) => c.opts && c.opts.method === 'POST');
  assert.equal(posts.length, 2, 'the 5xx batch retried (before the fix it was dropped FOREVER - the seat\'s permanent-divergence scenario)');
});


test('adversarial delta: a deterministic 4xx drops ONCE (no 1 Hz retry flood on a READONLY instance) while 5xx still retries', async () => {
  const calls = [];
  const b = boot({
    fetchImpl(url, opts) {
      calls.push({ url, opts });
      if (!opts || !opts.method) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ prefs: {} }) });
      return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) });
    },
  });
  await settle();
  b.ls.setItem('ft-era', '2009');
  b.fireTimers(); await settle(); // POST #1 -> 403 -> dropped, NOT restored
  b.fireTimers(); await settle();
  b.fireTimers(); await settle();
  const posts = calls.filter((c) => c.opts && c.opts.method === 'POST');
  assert.equal(posts.length, 1, 'a 403 is a deterministic rejection - one POST, no retry loop (flip the >=500 to !ok and this reds)');
});
