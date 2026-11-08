'use strict';

// [INTEGRATION] v1.406.0 W4 (plan docs/exec-plans/active/2026-11-08-smoothness.md): a launch that lands on content.
// FULL CHAIN: the real index.html / watch.html / login.html with every shell script loaded as in the browser (the
// multi-select-fullchain loading shape, own copy), a recording fetch, and for the app a fake window.FileTubeHost read by the
// REAL host-adapter.js. Binds:
//   E1 - host.ready is posted ONCE per document load: after the home's first cards render (never before the grid answered),
//        on an error page, on a non-home deep link, and by the cap when nothing marks (a stalled grid);
//   E2 - the bare home remembers its first screen under the user; the next launch paints it with no skeleton before the grid
//        answers, the real answer redraws it in place (a deleted item does not linger), and sign-out / the login shell / a
//        user mismatch clear it;
//   E3 - the boot census, counted: /api/config and /api/auth/me once each, /api/settings asked before /api/config answered,
//        and the deferred chrome reads (pins, handoff, the bell, the queue) only after the first screen;
//   F  - the one placeholder rule (the delayed entrance through the motion tokens).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, n) { for (let i = 0; i < (n || 200); i++) { if (fn()) return true; await sleep(10); } return false; }

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

const GRID = (ids) => ids.map((id, i) => ({ id, kind: 'media', title: 'Video ' + id, type: 'video', duration: 60 + i, addedAt: 1000 - i, hasThumbnail: true, needsTranscode: false, channelName: 'Ch', filePath: '/media/Ch/' + id + '.mp4', tags: { description: 'long' } }));

// opts: user (id), grid (ids), holdGrid, holdConfig, failConfig
function makeFetch(opts) {
  const o = opts || {};
  const calls = [];
  const held = {};
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    const call = { url, method, at: calls.length, answered: false };
    calls.push(call);
    const ok = (body) => Promise.resolve({ ok: true, status: 200, url: 'http://localhost' + url, redirected: false, json: async () => body, text: async () => '', clone() { return this; } }).then((r) => { call.answered = true; return r; });
    if (url === '/api/config') {
      if (o.failConfig) return Promise.reject(new TypeError('Failed to fetch')); // a network failure: the home's catch (the error state)
      if (o.noFolders) return Promise.resolve({ ok: true, status: 200, json: async () => ({ folders: [], folderSettings: {} }), clone() { return this; } });
      const answer = () => ({ ok: true, status: 200, json: async () => ({ folders: ['/media'], folderSettings: {} }), clone() { return this; } });
      if (o.holdConfig) return new Promise((res) => { held.config = () => { call.answered = true; res(answer()); }; });
      call.answered = true;
      return Promise.resolve(answer());
    }
    if (url === '/api/auth/me') return ok({ user: { id: o.user == null ? 1 : o.user, username: 'u', role: 'admin' }, settings: {} });
    if (url === '/api/settings') return ok({});
    if (url.indexOf('/api/home?view=grid') === 0 || url.indexOf('/api/videos?') === 0) {
      const body = { items: GRID(o.grid || ['a', 'b', 'c']), total: (o.grid || ['a', 'b', 'c']).length, offset: 0, limit: 60 };
      if (o.holdGrid) return new Promise((res) => { held.grid = () => { call.answered = true; res({ ok: true, status: 200, json: async () => body }); }; });
      return ok(body);
    }
    if (url === '/api/channels') return ok({ channels: [] });
    return new Promise(() => {}); // everything else: never answers (irrelevant here)
  };
  return { fetchImpl, calls, held };
}

function loadShell(file, fetchImpl, o) {
  const opts = o || {};
  const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
  const posts = [];
  const dom = new JSDOM(html, {
    url: 'http://localhost' + (opts.path || '/'),
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    resources: {
      interceptors: [
        requestInterceptor((request) => {
          const filePath = path.join(PUBLIC_DIR, new URL(request.url).pathname);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return new Response(fs.readFileSync(filePath, 'utf8'), { status: 200, headers: { 'Content-Type': contentTypeFor(filePath) } });
          }
          return new Response('', { status: 404 });
        }),
      ],
    },
    beforeParse(window) {
      window.fetch = fetchImpl;
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.matchMedia = (query) => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      if (opts.app) window.FileTubeHost = { bridge: 1, platform: 'ios', app: { name: 'filetube-ios', version: '0.18.0' }, capabilities: ['mediaFetch'], post: (m) => posts.push(Object.assign({ at: Date.now() }, m)) };
      if (opts.storage) for (const [k, v] of Object.entries(opts.storage)) window.localStorage.setItem(k, v);
      if (opts.modern) window.localStorage.setItem('ft-modern-mode', 'on');
      if (opts.beforeParse) opts.beforeParse(window);
    },
  });
  return { dom, posts };
}
const readyPosts = (posts) => posts.filter((m) => m.type === 'host.ready');
const cards = (doc) => Array.from(doc.querySelectorAll('#video-grid .video-card[data-id]')).map((c) => c.getAttribute('data-id'));
const skeletons = (doc) => doc.querySelectorAll('#video-grid .skeleton-card').length;

// ---- E1 ----------------------------------------------------------------------------------------------------------------------

test('E1: host.ready goes out ONCE, after the home grid answered and its cards rendered - never before', async () => {
  const f = makeFetch({ holdGrid: true, modern: true });
  const { dom, posts } = loadShell('index.html', f.fetchImpl, { app: true, modern: true });
  const w = dom.window;
  try {
    assert.ok(await until(() => typeof f.held.grid === 'function'), 'the grid was asked');
    await sleep(100);
    assert.strictEqual(readyPosts(posts).length, 0, 'nothing while the grid has not answered');
    const before = Date.now();
    f.held.grid();
    assert.ok(await until(() => readyPosts(posts).length === 1, 150), 'posted once the cards are up');
    assert.ok(cards(w.document).length === 3, 'the cards are on screen when it goes');
    assert.strictEqual(w.FileTube.firstContent().reason, 'home', 'marked by the home\'s cards, not the cap');
    assert.ok(readyPosts(posts)[0].at >= before);
    w.FileTube.navigate('/history'); // the shell answer never comes here: the hop itself is the point
    await sleep(200);
    assert.strictEqual(readyPosts(posts).length, 1, 'once per document load');
    assert.deepStrictEqual(Object.keys(readyPosts(posts)[0]).sort(), ['at', 'type', 'v'], 'an empty body (v, type) - nothing else crosses');
  } finally { w.close(); }
});

test('E1: an error page, a non-home deep link and a stalled grid (the cap) all send host.ready', async () => {
  {
    const f = makeFetch({ failConfig: true });
    const { dom, posts } = loadShell('index.html', f.fetchImpl, { app: true });
    try {
      assert.ok(await until(() => readyPosts(posts).length === 1, 150), 'the error state is the first screen');
      assert.strictEqual(dom.window.FileTube.firstContent().reason, 'home', 'marked by the error state');
    } finally { dom.window.close(); }
  }
  {
    const f = makeFetch({ noFolders: true });
    const { dom, posts } = loadShell('index.html', f.fetchImpl, { app: true });
    try {
      assert.ok(await until(() => readyPosts(posts).length === 1, 150), 'the welcome box (no folders yet) is the first screen');
      assert.strictEqual(dom.window.FileTube.firstContent().reason, 'home');
    } finally { dom.window.close(); }
  }
  {
    const f = makeFetch();
    const { dom, posts } = loadShell('watch.html', f.fetchImpl, { app: true, path: '/watch.html?v=a' });
    try {
      assert.ok(await until(() => readyPosts(posts).length === 1, 150), 'a watch deep link');
      assert.strictEqual(dom.window.FileTube.firstContent().reason, 'view:watch', 'marked by the view');
    } finally { dom.window.close(); }
  }
  {
    const f = makeFetch({ holdGrid: true });
    const { dom, posts } = loadShell('index.html', f.fetchImpl, { app: true });
    try {
      await sleep(900);
      assert.strictEqual(readyPosts(posts).length, 0, 'not early');
      assert.ok(await until(() => readyPosts(posts).length === 1, 150), 'the cap sends it (about 1.5 s) - the splash is never stuck on the web');
      assert.strictEqual(dom.window.FileTube.firstContent().reason, 'cap');
      f.held.grid(); // the grid lands late: its cards mark again - never a second host.ready
      await sleep(300);
      assert.strictEqual(readyPosts(posts).length, 1, 'still once');
    } finally { dom.window.close(); }
  }
  {
    const f = makeFetch();
    const { dom, posts } = loadShell('login.html', f.fetchImpl, { app: true, path: '/login' });
    try {
      assert.ok(await until(() => readyPosts(posts).length === 1, 250), 'the login shell (no view, no chrome) gets it from the boot cap');
    } finally { dom.window.close(); }
  }
});

test('E1: in a browser (no host) nothing is posted and nothing breaks', async () => {
  const f = makeFetch();
  const { dom } = loadShell('index.html', f.fetchImpl);
  try {
    assert.ok(await until(() => cards(dom.window.document).length === 3));
  } finally { dom.window.close(); }
});

// ---- E2 ----------------------------------------------------------------------------------------------------------------------

test('E2: the bare Modern home remembers its first screen under the user; the next launch paints it at once (no skeleton) and the answer redraws it in place - a deleted item does not linger', async () => {
  const f1 = makeFetch({ grid: ['a', 'b', 'c'], user: 7 });
  const first = loadShell('index.html', f1.fetchImpl, { modern: true });
  let saved = null;
  try {
    assert.ok(await until(() => { saved = first.dom.window.localStorage.getItem('ft-home-snapshot-v1'); return !!saved; }), 'written after page 0');
  } finally { first.dom.window.close(); }
  const snap = JSON.parse(saved);
  assert.strictEqual(snap.user, '7');
  assert.deepStrictEqual(snap.items.map((i) => i.id), ['a', 'b', 'c']);
  assert.ok(snap.items.every((i) => !('filePath' in i) && !('tags' in i)), 'display fields only');

  const f2 = makeFetch({ grid: ['a', 'c'], user: 7, holdGrid: true }); // 'b' was deleted since
  const second = loadShell('index.html', f2.fetchImpl, { modern: true, storage: { 'ft-home-snapshot-v1': saved } });
  const w = second.dom.window;
  try {
    assert.ok(await until(() => cards(w.document).length === 3), 'the remembered cards before the grid answered');
    assert.strictEqual(skeletons(w.document), 0, 'no skeleton');
    assert.ok(await until(() => typeof f2.held.grid === 'function'));
    f2.held.grid();
    assert.ok(await until(() => cards(w.document).join() === 'a,c'), `redrawn in place (got ${cards(w.document)})`);
    assert.ok(await until(() => JSON.parse(w.localStorage.getItem('ft-home-snapshot-v1')).items.length === 2), 'and remembered fresh');
  } finally { w.close(); }
});

test('E2: another user\'s snapshot is cleared as soon as the user is known; the login shell and sign-out clear it', async () => {
  const other = JSON.stringify({ v: 1, user: '99', layout: 'modern:all:newest', at: 1, items: GRID(['x']) });
  const f = makeFetch({ user: 7, holdGrid: true });
  const { dom } = loadShell('index.html', f.fetchImpl, { modern: true, storage: { 'ft-home-snapshot-v1': other } });
  try {
    assert.ok(await until(() => dom.window.localStorage.getItem('ft-home-snapshot-v1') === null), 'cleared on the mismatch');
  } finally { dom.window.close(); }
  const f2 = makeFetch();
  const login = loadShell('login.html', f2.fetchImpl, { path: '/login', storage: { 'ft-home-snapshot-v1': other } });
  try {
    assert.ok(await until(() => login.dom.window.localStorage.getItem('ft-home-snapshot-v1') === null), 'the login shell clears it');
  } finally { login.dom.window.close(); }
  const src = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'common.js'), 'utf8');
  const so = /function accountSignOut\(\) \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(so && /clearHomeSnapshot\(\);/.test(so[1]), 'sign-out clears it');
});

test('E2: a scoped home (a folder) never paints the snapshot; the bare Classic home does (the control)', async () => {
  const saved = JSON.stringify({ v: 1, user: '1', layout: 'classic:release-date:both', at: 1, items: GRID(['x']) });
  {
    const f = makeFetch({ holdGrid: true });
    const { dom } = loadShell('index.html', f.fetchImpl, { storage: { 'ft-home-snapshot-v1': saved } });
    try { assert.ok(await until(() => cards(dom.window.document).includes('x')), `the bare Classic home paints it (got ${cards(dom.window.document)})`); } finally { dom.window.close(); }
  }
  const f = makeFetch({ holdGrid: true });
  const { dom } = loadShell('index.html', f.fetchImpl, { path: '/?root=%2Fmedia', storage: { 'ft-home-snapshot-v1': saved } });
  try {
    await sleep(300);
    assert.ok(!cards(dom.window.document).includes('x'), 'a folder view never shows the home snapshot');
  } finally { dom.window.close(); }
});

// ---- E3 ----------------------------------------------------------------------------------------------------------------------

test('E3 census: /api/config and /api/auth/me once; /api/settings asked before /api/config answered; pins / handoff / bell / queue only after the first screen', async () => {
  const f = makeFetch({ holdConfig: true });
  const { dom, posts } = loadShell('index.html', f.fetchImpl, { app: true });
  try {
    assert.ok(await until(() => typeof f.held.config === 'function'));
    assert.ok(await until(() => f.calls.some((c) => c.url === '/api/settings')), 'settings asked while config is still out');
    const deferred = (c) => /^\/api\/(subscriptions\/pins|books\/pins|podcasts\/pins|handoff|notifications\/badge|queue)(\?|$)/.test(c.url);
    assert.strictEqual(f.calls.filter(deferred).length, 0, 'none of the deferred reads before the first screen');
    f.held.config();
    assert.ok(await until(() => readyPosts(posts).length === 1, 300), 'first screen');
    assert.ok(await until(() => f.calls.filter(deferred).length >= 4), `the deferred reads start then (got ${f.calls.filter(deferred).map((c) => c.url)})`);
    const count = (u) => f.calls.filter((c) => c.method === 'GET' && c.url === u).length;
    assert.strictEqual(count('/api/config'), 1, 'config once');
    assert.strictEqual(count('/api/auth/me'), 1, 'auth/me once');
  } finally { dom.window.close(); }
});

// ---- F -----------------------------------------------------------------------------------------------------------------------

test('F: every skeleton and art shimmer waits --skeleton-delay (150 ms) then fades in through the motion tokens; the box is laid out from the first frame', () => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'tokens.css'), 'utf8');
  assert.match(tokens, /--skeleton-delay: 150ms;/);
  const rule = (sel) => { const m = new RegExp(sel.replace(/[.]/g, '\\.') + ' \\{([^}]*)\\}').exec(css); return m ? m[1] : ''; };
  assert.match(rule('.skeleton-shimmer'), /animation: skeleton-delay-in var\(--dur-fade\) var\(--ease-std\) var\(--skeleton-delay\) both;/);
  assert.match(rule('img.art-shimmer'), /skeleton-delay-in var\(--dur-fade\) var\(--ease-std\) var\(--skeleton-delay\) both/);
  assert.match(css, /@keyframes skeleton-delay-in \{\s*from \{ opacity: 0; \}\s*to \{ opacity: 1; \}\s*\}/, 'opacity only: no layout property moves');
});
