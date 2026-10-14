'use strict';

// [UNIT] v1.391.0 (W1) - the `mediaFetch` capability gate. The downloader UI shows when there is no native host, or the
// host announced `mediaFetch` (host.allowsMediaFetch(), read through public/js/host-adapter.js; no User-Agent or platform
// sniffing). Every source of `moduleEnabled` goes through ONE predicate (common.js mediaFetchAllowed) and every entry
// point the module flag does not already gate is gated beside it. Each block below is proven by mutation: delete the
// predicate call and watch the block go red (the mutation proofs are recorded in the plan's Evidence section).
//
//   no host            -> unchanged (follows the health answer)
//   host + mediaFetch  -> unchanged
//   host, no mediaFetch -> moduleEnabled false from every source, no health fetch, every entry point absent
//   the offline `downloads` control (a DIFFERENT capability) keeps working under a host that lacks mediaFetch.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const hostAdapter = require('../../public/js/host-adapter.js');
const offline = require('../../public/js/offline.js');
const common = require('../../public/js/common.js');
const setupJs = require('../../public/js/setup.js');
const { watchViewRealm, VIDEO } = require('../helpers/watch-view-harness');

const REPO = path.join(__dirname, '..', '..');
const SETUP_HTML = fs.readFileSync(path.join(REPO, 'public/setup.html'), 'utf8');

const NO_HOST = null; // every browser, the PWA
const WITH = ['downloads', 'haptics', 'mediaFetch']; // a host that announced the capability
const WITHOUT = ['downloads', 'haptics']; // the App Store build: native offline copies, no server downloader

function hostFor(caps) {
  return hostAdapter.create({ FileTubeHost: { bridge: 1, platform: 'ios', capabilities: caps, post() {} }, document: null });
}

// A jsdom shell with the realm globals common.js reads. `caps` null = no host object at all.
function realm(caps, { health = { ok: true, status: 200 } } = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <header><div class="header-right"></div></header>
    <aside id="sidebar"><a class="sidebar-item" href="/setup.html">Settings</a></aside>
    <nav id="bottom-nav">
      <a class="bottom-nav-item" data-nav="home" href="/">Home</a>
      <a class="bottom-nav-item" data-nav="settings" href="/setup.html">Settings</a>
    </nav>
    <div id="view-root"></div>
  </body></html>`, { url: 'http://localhost/' });
  const w = dom.window;
  if (caps) w.FileTube = { host: hostFor(caps) };
  const fetched = [];
  const saved = {};
  const put = (k, v) => { saved[k] = Object.prototype.hasOwnProperty.call(global, k) ? { v: global[k] } : null; global[k] = v; };
  put('window', w);
  put('mediaFetchAllowed', common.mediaFetchAllowed); // a browser's classic scripts share common.js's top-level functions
  put('document', w.document);
  put('localStorage', w.localStorage);
  put('sessionStorage', w.sessionStorage);
  put('fetch', (u) => {
    fetched.push(String(u));
    return Promise.resolve({ ...health, json: () => Promise.resolve({ count: 0, enabled: true, folders: [], syntheticFolders: [] }) });
  });
  return {
    w, doc: w.document, fetched,
    healthFetches: () => fetched.filter((u) => u === '/api/subscriptions/health').length,
    restore() { for (const k of Object.keys(saved)) { if (saved[k]) global[k] = saved[k].v; else delete global[k]; } w.close(); },
  };
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 40));

// ---- the adapter and the predicate -----------------------------------------------------------------------------------

test('the adapter declares mediaFetch (a pure capability, no messages, no events) and answers allowsMediaFetch()', () => {
  assert.ok(hostAdapter.CAPABILITIES.includes('mediaFetch'));
  assert.ok(!Object.values(hostAdapter.MESSAGES).some((m) => m && m.cap === 'mediaFetch'), 'no message rides on it');
  assert.strictEqual(hostAdapter.create({ document: null }).allowsMediaFetch(), true, 'no host: allowed');
  assert.strictEqual(hostFor(WITH).allowsMediaFetch(), true, 'host + mediaFetch: allowed');
  assert.strictEqual(hostFor(WITHOUT).allowsMediaFetch(), false, 'host without it: not allowed');
  assert.strictEqual(hostFor(['downloads']).allowsMediaFetch(), false, 'the offline downloads capability is NOT mediaFetch');
});

test('mediaFetchAllowed(): true with no window / no host / no adapter, false only for a present host without the capability', () => {
  assert.strictEqual(common.mediaFetchAllowed(), true, 'Node: no window at all');
  for (const [caps, want] of [[NO_HOST, true], [WITH, true], [WITHOUT, false]]) {
    const r = realm(caps);
    try { assert.strictEqual(common.mediaFetchAllowed(), want, JSON.stringify(caps)); } finally { r.restore(); }
  }
  // a hand-rolled host object without allowsMediaFetch (an older mock) is read through present + has
  const r = realm(NO_HOST);
  try {
    r.w.FileTube = { host: { present: true, has: (c) => c === 'mediaFetch' } };
    assert.strictEqual(common.mediaFetchAllowed(), true);
    r.w.FileTube = { host: { present: true, has: () => false } };
    assert.strictEqual(common.mediaFetchAllowed(), false);
  } finally { r.restore(); }
});

// ---- every source of moduleEnabled ---------------------------------------------------------------------------------

test('probeSubscriptionsHealth(): no host and host+mediaFetch ask the server; a host without it never touches the network', async () => {
  for (const caps of [NO_HOST, WITH]) {
    const r = realm(caps);
    try {
      const res = await common.probeSubscriptionsHealth();
      assert.strictEqual(res.ok, true);
      assert.strictEqual(r.healthFetches(), 1, JSON.stringify(caps));
    } finally { r.restore(); }
  }
  const r = realm(WITHOUT);
  try {
    const res = await common.probeSubscriptionsHealth();
    assert.strictEqual(res.ok, false, 'reads as a server with no module');
    assert.strictEqual(res.status, 404);
    assert.strictEqual(r.fetched.length, 0, 'no request at all');
  } finally { r.restore(); }
});

test('the capability cache and the remembered chrome flag read false when the gate is shut, even if they hold true', () => {
  for (const [caps, want] of [[NO_HOST, true], [WITH, true], [WITHOUT, false]]) {
    const r = realm(caps);
    try {
      // a cache written while allowed ("true"), then read under this host
      r.w.sessionStorage.setItem('ft-cap-cache-v1', JSON.stringify({ ts: Date.now(), moduleEnabled: true, subs: [], pins: [] }));
      assert.strictEqual(common.readCapabilityCache().moduleEnabled, want, 'cache read ' + JSON.stringify(caps));
      // a write of true (a stale probe, a poisoned patch) is stored as the gate allows
      common.writeCapabilityCache({ moduleEnabled: true });
      assert.strictEqual(JSON.parse(r.w.sessionStorage.getItem('ft-cap-cache-v1')).moduleEnabled, want, 'cache write ' + JSON.stringify(caps));
      assert.strictEqual(r.w.localStorage.getItem('ft-ytdlp-module'), want ? '1' : '0', 'remembered flag ' + JSON.stringify(caps));
      common.rememberModuleEnabled(true);
      assert.strictEqual(r.w.localStorage.getItem('ft-ytdlp-module'), want ? '1' : '0', 'rememberModuleEnabled ' + JSON.stringify(caps));
    } finally { r.restore(); }
  }
});

// ---- the injected entry points (nav, header Download, bell, chip, Re-pull) -------------------------------------------------

async function runInjectors(caps) {
  const r = realm(caps);
  try {
    common.injectSubscriptionsNavLinkIfEnabled();
    common.injectOneOffDownloadButtonIfEnabled();
    common.injectNotificationBellIfEnabled();
    common.injectDownloadStatusChip();
    common.probeAndReconcileRepullButton();
    await tick();
    return {
      healthFetches: r.healthFetches(),
      badgeFetches: r.fetched.filter((u) => u === '/api/notifications/badge').length,
      subsNav: !!r.doc.querySelector('[data-nav="subscriptions"], [data-nav-sidebar="subscriptions"]'),
      downloadBtn: !!r.doc.getElementById('ytdlp-oneoff-btn'),
      downloadNav: !!r.doc.querySelector('[data-nav="oneoff-download"]'),
      accountRow: !!r.doc.querySelector('a.account-menu-item[href="/subscriptions"]'),
      bellFlag: r.w.localStorage.getItem('ft-notif-bell-enabled'),
      fetched: r.fetched.slice(),
    };
  } finally { r.restore(); }
}

test('A1 injectors: no host and host+mediaFetch behave as before (the Subs link, the Download button and nav tab are injected)', async () => {
  for (const caps of [NO_HOST, WITH]) {
    const o = await runInjectors(caps);
    assert.ok(o.healthFetches >= 1, 'asks the health route ' + JSON.stringify(caps));
    assert.ok(o.badgeFetches >= 1, 'asks the bell badge route ' + JSON.stringify(caps));
    assert.strictEqual(o.subsNav, true, 'Subs entry ' + JSON.stringify(caps));
    assert.strictEqual(o.downloadBtn, true, 'header Download button ' + JSON.stringify(caps));
    assert.strictEqual(o.downloadNav, true, 'bottom-nav Download tab ' + JSON.stringify(caps));
  }
});

test('A1 injectors: a host without mediaFetch injects none of them and makes no downloader request', async () => {
  const o = await runInjectors(WITHOUT);
  assert.strictEqual(o.healthFetches, 0, 'no /api/subscriptions/health request');
  assert.strictEqual(o.badgeFetches, 0, 'no bell badge request');
  assert.deepStrictEqual(o.fetched.filter((u) => /\/api\/(subscriptions|ytdlp|notifications)/.test(u)), [], 'no downloader route is asked for');
  assert.strictEqual(o.subsNav, false, 'no Subs link / tab');
  assert.strictEqual(o.downloadBtn, false, 'no header Download button');
  assert.strictEqual(o.downloadNav, false, 'no bottom-nav Download tab');
  assert.strictEqual(o.accountRow, false, 'no account-menu Subscriptions row');
  assert.strictEqual(o.bellFlag, '0', 'the bell is off for the next launch');
});

test('the pre-paint bell placeholder a shell painted is removed when the gate is shut', async () => {
  const r = realm(WITHOUT);
  try {
    const ph = r.doc.createElement('span');
    ph.id = 'notif-bell-placeholder';
    r.doc.querySelector('.header-right').appendChild(ph);
    r.w.localStorage.setItem('ft-notif-bell-enabled', '1');
    common.injectNotificationBellIfEnabled();
    assert.strictEqual(r.doc.getElementById('notif-bell-placeholder'), null);
  } finally { r.restore(); }
});

test('the cached "module on" answer cannot inject the Subs link optimistically under a shut gate', async () => {
  const r = realm(WITHOUT);
  try {
    r.w.sessionStorage.setItem('ft-cap-cache-v1', JSON.stringify({ ts: Date.now(), moduleEnabled: true }));
    r.w.localStorage.setItem('ft-ytdlp-module', '1');
    common.injectSubscriptionsNavLinkIfEnabled();
    assert.strictEqual(r.doc.querySelector('[data-nav="subscriptions"], [data-nav-sidebar="subscriptions"]'), null, 'no optimistic inject');
    await tick();
    assert.strictEqual(r.healthFetches(), 0);
  } finally { r.restore(); }
});

test('the pinned channels and the playlists sheet do not ask for /api/subscriptions/pins under a shut gate (books and podcasts pins still load)', async () => {
  for (const [caps, want] of [[NO_HOST, 1], [WITH, 1], [WITHOUT, 0]]) {
    const r = realm(caps);
    try {
      await common.fetchAllPins();
      assert.strictEqual(r.fetched.filter((u) => u === '/api/subscriptions/pins').length, want, JSON.stringify(caps));
      assert.strictEqual(r.fetched.filter((u) => u === '/api/books/pins').length, 1, 'books pins are not the downloader');
      assert.strictEqual(r.fetched.filter((u) => u === '/api/podcasts/pins').length, 1, 'podcast pins are not the downloader');
    } finally { r.restore(); }
  }
});

// ---- direct navigation to /subscriptions ------------------------------------------------------------------------------------

test('a direct visit to /subscriptions renders "Not available in this app" under a shut gate and never runs the view', () => {
  assert.strictEqual(common.viewBlockedByMediaFetch('subscriptions'), false, 'Node / no host: open');
  assert.strictEqual(common.viewBlockedByMediaFetch('home'), false);
  const r = realm(WITHOUT);
  try {
    assert.strictEqual(common.viewBlockedByMediaFetch('subscriptions'), true);
    assert.strictEqual(common.viewBlockedByMediaFetch('home'), false, 'only the downloader route is blocked');
    assert.strictEqual(common.viewBlockedByMediaFetch('books'), false);
    const root = r.doc.getElementById('view-root');
    root.innerHTML = '<p>old</p>';
    common.renderNotAvailableInApp(root);
    assert.match(root.textContent, /Not available in this app/);
    assert.strictEqual(root.querySelector('p').textContent.includes('old'), false);
  } finally { r.restore(); }
  const open = realm(WITH);
  try { assert.strictEqual(common.viewBlockedByMediaFetch('subscriptions'), false, 'host + mediaFetch: open'); } finally { open.restore(); }
  // both router entry points (the first load and an in-app swap) take the gate
  const src = fs.readFileSync(path.join(REPO, 'public/js/common.js'), 'utf8');
  assert.strictEqual((src.match(/if \(viewBlockedByMediaFetch\(view\)\)/g) || []).length, 2, 'bootRouter and swapToView both consult it');
});

// ---- Settings: the Downloads box, the Notifications page, the Imported videos note ----------------------------------------

test('Settings: a shut gate removes the Downloads box, the Notifications page and the relocate note; an open gate keeps them all', () => {
  const ids = ['downloads-box', 'notifications-box', 'notifications-enabled-check', 'relocate-hydrated-check', 'engine-channels'];
  for (const caps of [NO_HOST, WITH, WITHOUT]) {
    const dom = new JSDOM(SETUP_HTML, { url: 'http://localhost/setup.html' });
    const r = realm(caps);
    try {
      setupJs.applyMediaFetchGate(dom.window.document);
      const shut = caps === WITHOUT;
      for (const id of ids) assert.strictEqual(!!dom.window.document.getElementById(id), !shut, id + ' ' + JSON.stringify(caps));
      assert.strictEqual(!!Array.from(dom.window.document.querySelectorAll('h3')).find((h) => h.textContent === 'Imported videos'), !shut, 'Imported videos heading');
      assert.ok(dom.window.document.getElementById('push-user-enabled-check') || shut, 'a plain browser keeps push');
      // the library folders, which are not the downloader, stay
      assert.ok(dom.window.document.getElementById('add-folder-btn'), 'Videos folders stay');
    } finally { r.restore(); dom.window.close(); }
  }
});

test('Settings: loadEngineSection makes no /api/ytdlp/engine request when the box is gone', async () => {
  const dom = new JSDOM(SETUP_HTML, { url: 'http://localhost/setup.html' });
  const r = realm(WITHOUT);
  try {
    global.document = dom.window.document; // the real setup page, after the gate removed the box
    setupJs.applyMediaFetchGate(dom.window.document);
    await setupJs.loadEngineSection(new AbortController().signal);
    assert.strictEqual(r.fetched.filter((u) => u.indexOf('/api/ytdlp') === 0).length, 0);
  } finally { r.restore(); dom.window.close(); }
});

// ---- the watch page: Subscribe, bell, Pin, Reheat, source-link Share -------------------------------------------------------

async function mountedWatch(hostCaps) {
  const r = watchViewRealm({ hostCaps, subs: [], pins: [] });
  r.init();
  await r.settle(24);
  return r;
}

test('watch page, no host and host+mediaFetch: Subscribe, Pin, Share and Reheat are offered as before', async () => {
  for (const hostCaps of [undefined, WITH]) {
    const r = await mountedWatch(hostCaps);
    try {
      assert.ok(r.$('#subscribe-btn-mock'), 'Subscribe ' + JSON.stringify(hostCaps));
      assert.ok(r.$('#pin-channel-btn'), 'Pin ' + JSON.stringify(hostCaps));
      assert.ok(r.$('#share-media-btn'), 'Share the source link ' + JSON.stringify(hostCaps));
      assert.ok(r.calls('GET', '/api/subscriptions/health').length >= 1, 'asks the health route');
      r.$('#more-actions-btn').click();
      await r.settle(6);
      const labels = Array.from(r.doc.querySelectorAll('.ui-sheet .ui-row')).map((x) => x.textContent.trim());
      assert.ok(labels.includes('Reheat metadata'), 'Reheat ' + JSON.stringify(hostCaps));
    } finally { r.close(); }
  }
});

test('watch page, host without mediaFetch: no Subscribe, bell, Pin, Reheat or source-link Share, and no downloader request', async () => {
  const r = await mountedWatch(WITHOUT);
  try {
    assert.strictEqual(r.$('#subscribe-btn-mock'), null, 'Subscribe');
    assert.strictEqual(r.$('#notify-channel-btn'), null, 'bell');
    assert.strictEqual(r.$('#pin-channel-btn'), null, 'Pin');
    assert.strictEqual(r.$('#share-media-btn'), null, 'Share the original link');
    assert.deepStrictEqual(r.fetches.filter((f) => /^\/api\/(subscriptions|ytdlp)/.test(f.url)), [], 'no downloader route is asked for');
    r.$('#more-actions-btn').click();
    await r.settle(6);
    const labels = Array.from(r.doc.querySelectorAll('.ui-sheet .ui-row')).map((x) => x.textContent.trim());
    assert.ok(!labels.includes('Reheat metadata'), 'Reheat: ' + labels.join(' | '));
    assert.ok(labels.includes('Save to device'), 'the file save (the user\'s own file) stays');
  } finally { r.close(); }
});

test('watch page, host without mediaFetch: the cached "module on" answer cannot paint Reheat or Subscribe from the cache', async () => {
  const r = watchViewRealm({ hostCaps: WITHOUT, subs: [], pins: [] });
  r.w.sessionStorage.setItem('ft-cap-cache-v1', JSON.stringify({ ts: Date.now(), moduleEnabled: true, subs: [], pins: [] }));
  r.init();
  await r.settle(24);
  try {
    assert.strictEqual(r.$('#subscribe-btn-mock'), null);
    r.$('#more-actions-btn').click();
    await r.settle(6);
    const labels = Array.from(r.doc.querySelectorAll('.ui-sheet .ui-row')).map((x) => x.textContent.trim());
    assert.ok(!labels.includes('Reheat metadata'));
  } finally { r.close(); }
});

// ---- the music / podcast sticker menu: Reheat and the source-link Share ---------------------------------------------------

test('the music / podcast actions menu: Reheat and the source-link Share follow the gate', async () => {
  const SS = require('../../public/js/skin-surface.js');
  for (const [caps, want] of [[NO_HOST, true], [WITH, true], [WITHOUT, false]]) {
    const r = realm(caps);
    try {
      r.w.fetch = global.fetch; // the shared menu core reads the signed-in user through fetch
      const menuEl = r.doc.createElement('div');
      r.doc.body.appendChild(menuEl);
      const item = { id: 't1', title: 'Song', watchUrl: 'https://example.test/watch?v=1', liked: false, watchState: 'unwatched' };
      const core = SS.createExtrasMenu({
        getMenuEl: () => menuEl, getBaseId: () => 't1', stillOnPage: () => true, close() {},
        fetchItem: () => item, getSignal: () => null,
      });
      core.open();
      for (let i = 0; i < 8; i++) await tick(5);
      assert.strictEqual(!!menuEl.querySelector('[data-skin-x="reheat"]'), want, 'Reheat tile ' + JSON.stringify(caps));
      assert.ok(menuEl.querySelector('[data-skin-x="share"]'), 'file Share stays ' + JSON.stringify(caps));
      assert.strictEqual(core.hasSource(item), want, 'a source link to share ' + JSON.stringify(caps));
    } finally { r.restore(); }
  }
});

test('the Downloads folder entry (the downloader\'s output root) is not injected into the nav under a shut gate', async () => {
  for (const [caps, want] of [[NO_HOST, true], [WITHOUT, false]]) {
    const r = realm(caps);
    try {
      global.fetch = (u) => { r.fetched.push(String(u)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ folders: ['/lib'], syntheticFolders: ['/lib/Downloads'] }) }); };
      r.doc.querySelector('#bottom-nav').insertAdjacentHTML('beforeend', '<a class="bottom-nav-item" data-nav="downloads" href="/">Downloads</a>');
      common.injectDownloadsNavLinkIfEnabled();
      await tick();
      const link = r.doc.querySelector('.bottom-nav-item[data-nav="downloads"]');
      assert.strictEqual(!!link, want, 'bottom-nav Downloads ' + JSON.stringify(caps));
    } finally { r.restore(); }
  }
});

// ---- the offline downloads control is a different capability --------------------------------------------------------------

test('the native offline downloads control still works under a host that lacks mediaFetch', () => {
  const posted = [];
  const w = { document: {}, FileTubeHost: { bridge: 1, platform: 'ios', capabilities: WITHOUT, post: (m) => posted.push(m) } };
  w.FileTube = { host: hostAdapter.create(w) };
  assert.strictEqual(w.FileTube.host.allowsMediaFetch(), false);
  const off = offline.create(w);
  assert.strictEqual(off.enabled, true, 'offline.js is on: it reads `downloads`, not mediaFetch');
  off.show();
  assert.ok(posted.some((m) => m.type === 'downloads.show'), 'and it reaches native');
  // the account menu "Offline" row is keyed on offline.enabled, never on the gate
  const src = fs.readFileSync(path.join(REPO, 'public/js/common.js'), 'utf8');
  assert.match(src, /window\.FileTube\.offline && window\.FileTube\.offline\.enabled\) \{\s*links\.appendChild\(accountMenuRow\(U, \{ icon: 'arrow_downward', label: 'Offline'/);
});

test('(sanity) VIDEO fixture still carries a source link, so the Share assertions above bind', () => {
  assert.ok(VIDEO.watchUrl);
});
