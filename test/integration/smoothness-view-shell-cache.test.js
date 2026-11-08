'use strict';

// [INTEGRATION] v1.406.0 W2 G (plan docs/exec-plans/active/2026-11-08-smoothness.md): the view-shell cache. FULL CHAIN: the
// real index.html with every shell script loaded as in the browser (the multi-select-fullchain loading shape, own copy per the
// small-per-file-harness convention), the REAL router (common.js navigate / popstate / the document click handler), shells
// answered from the real public/*.html files. Binds: a second hop swaps from the cache with no shell GET and a FRESH node every
// time (never a reused one); a shell of another ft-version is never cached; the shell is asked in the same task as the tap
// (parallel with the view's lazy script); the lazy script is loaded by its versioned URL when the page names it; the tapped
// link holds [data-pressed] until the swap; a cache hit re-checks the session with HEAD and a redirected answer loads the URL
// for real; the nav destinations' shells are prefetched at idle. Plus the server half: every shell names the lazy scripts'
// hashes, and the server's list equals the router's.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}
const withMeta = (html, metas) => html.replace(/<head>/i, '<head>' + metas);

// The shell the server would send for a path (the file, plus an ft-version meta when given).
function shellFor(pathname, version) {
  const file = { '/': 'index.html', '/history': 'history.html', '/music': 'music.html', '/watch.html': 'watch.html', '/books': 'books.html', '/podcasts': 'podcasts.html' }[pathname];
  if (!file) return null;
  const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
  return version ? withMeta(html, `<meta name="ft-version" content="${version}">`) : html;
}

function makeFetch(opts) {
  const calls = [];
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    calls.push({ url, method });
    const ok = (body) => Promise.resolve({ ok: true, status: 200, url: 'http://localhost' + url, redirected: false, json: async () => body, text: async () => body });
    if (url === '/api/config') return ok({ folders: ['/media'], folderSettings: {} });
    if (url === '/api/settings') return ok({});
    if (url === '/api/auth/me') return ok({ user: { id: 1, username: 'u', role: 'admin' }, settings: {} });
    if (url.indexOf('/api/videos?') === 0) return ok({ items: [], total: 0, offset: 0, limit: 60 });
    let pathname = url;
    try { pathname = new URL(url, 'http://localhost').pathname; } catch (_) { /* as is */ }
    if (method === 'HEAD') {
      if (opts && opts.headRedirect) return Promise.resolve({ ok: true, status: 200, url: 'http://localhost/login?next=' + encodeURIComponent(pathname), redirected: true, text: async () => '' });
      return Promise.resolve({ ok: true, status: 200, url: 'http://localhost' + pathname, redirected: false, text: async () => '' });
    }
    const html = shellFor(pathname, opts && opts.shellVersion);
    if (html !== null && method === 'GET' && !/^\/(api|js|css)\//.test(pathname)) {
      if (opts && opts.holdShell === pathname) return new Promise((res) => { opts.release = () => res({ ok: true, status: 200, url: 'http://localhost' + pathname, redirected: false, text: async () => html }); });
      return Promise.resolve({ ok: true, status: 200, url: 'http://localhost' + pathname, redirected: false, text: async () => html });
    }
    if (method === 'GET' && !/^\/(api|js|css)\//.test(pathname) && /^\/[a-z.]*$/.test(pathname)) return Promise.resolve({ ok: false, status: 404, url: 'http://localhost' + pathname, redirected: false, text: async () => '' }); // a shell this stub does not serve
    return new Promise(() => {});
  };
  return { fetchImpl, calls };
}

function loadIndex(fetchImpl, opts) {
  const o = opts || {};
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  html = withMeta(html, (o.pageVersion ? `<meta name="ft-version" content="${o.pageVersion}">` : '') + (o.viewScripts ? `<meta name="ft-view-scripts" content="${o.viewScripts}">` : ''));
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(String(e && e.message)));
  const scripts = [];
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    resources: {
      interceptors: [
        requestInterceptor((request) => {
          const u = new URL(request.url);
          scripts.push(u.pathname + u.search);
          const filePath = path.join(PUBLIC_DIR, u.pathname);
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
    },
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve({ dom, errors, scripts }); } };
    dom.window.addEventListener('load', () => setTimeout(finish, 20));
    setTimeout(finish, 5000).unref();
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shellGets = (calls, p) => calls.filter((c) => c.method === 'GET' && c.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] === p);
async function until(fn, n) { for (let i = 0; i < (n || 100); i++) { if (fn()) return true; await sleep(10); } return false; }

test('G: a second hop swaps from the cache - no shell GET, a FRESH node each time (never reused), the same markup; a HEAD re-checks the session', async () => {
  const f = makeFetch();
  const { dom } = await loadIndex(f.fetchImpl);
  const w = dom.window;
  try {
    await w.FileTube.navigate('/history');
    assert.ok(await until(() => w.document.getElementById('view-root').getAttribute('data-view') === 'history' || w.location.pathname === '/history'));
    const first = w.document.getElementById('view-root');
    assert.strictEqual(shellGets(f.calls, '/history').length, 1, 'the first visit fetches its shell');
    const marker = w.document.createElement('i'); marker.className = 'smooth-g-live-state'; first.appendChild(marker); // what a live view writes into its root
    const firstCount = first.children.length - 1;
    await w.FileTube.navigate('/books');
    await w.FileTube.navigate('/history');
    const second = w.document.getElementById('view-root');
    assert.strictEqual(w.location.pathname, '/history');
    assert.strictEqual(shellGets(f.calls, '/history').length, 1, 'the second visit swaps from the cache');
    assert.notStrictEqual(second, first, 'a fresh node - the first one is never put back');
    assert.strictEqual(second.querySelector('.smooth-g-live-state'), null, 'the cache holds the shell as SENT, never the live view of a past visit');
    assert.strictEqual(second.children.length, firstCount, 'the same shell markup');
    assert.ok(f.calls.some((c) => c.method === 'HEAD' && c.url.indexOf('/history') >= 0), 'the session is re-checked behind the swap');
    await w.FileTube.navigate('/books');
    await w.FileTube.navigate('/history');
    const third = w.document.getElementById('view-root');
    assert.notStrictEqual(third, second, 'every hop clones');
  } finally { w.close(); }
});

test('G: a shell of ANOTHER ft-version (a release mid-session) is swapped but never cached - the next hop fetches again', async () => {
  const f = makeFetch({ shellVersion: '9.9.9' });
  const { dom } = await loadIndex(f.fetchImpl, { pageVersion: '1.0.0' });
  const w = dom.window;
  try {
    await w.FileTube.navigate('/history');
    await w.FileTube.navigate('/books');
    await w.FileTube.navigate('/history');
    assert.strictEqual(w.location.pathname, '/history');
    assert.strictEqual(shellGets(f.calls, '/history').length, 2, 'not cached: new markup never pairs with old JS from the cache');
  } finally { w.close(); }
});

test('G: the same version IS cached (the control for the test above)', async () => {
  const f = makeFetch({ shellVersion: '1.0.0' });
  const { dom } = await loadIndex(f.fetchImpl, { pageVersion: '1.0.0' });
  const w = dom.window;
  try {
    await w.FileTube.navigate('/history');
    await w.FileTube.navigate('/books');
    await w.FileTube.navigate('/history');
    assert.strictEqual(shellGets(f.calls, '/history').length, 1);
  } finally { w.close(); }
});

test('G: the shell is asked in the SAME task as the hop (parallel with the lazy script), and the script by its versioned URL', async () => {
  const f = makeFetch();
  const { dom, scripts } = await loadIndex(f.fetchImpl, { viewScripts: '/js/history.js=0123456789abcdef /js/music.js=fedcba9876543210' });
  const w = dom.window;
  try {
    const p = w.FileTube.navigate('/history');
    assert.strictEqual(shellGets(f.calls, '/history').length, 1, 'asked before the script has loaded');
    await p;
    assert.ok(await until(() => scripts.includes('/js/history.js?v=0123456789abcdef')), `the versioned URL (got ${scripts.filter((s) => s.indexOf('history') >= 0)})`);
    assert.ok(!scripts.includes('/js/history.js'), 'never the bare URL when the page names a version');
  } finally { w.close(); }
});

test('G: the tapped nav link holds [data-pressed] until the swap, then lets go', async () => {
  const opts = { holdShell: '/history' };
  const f = makeFetch(opts);
  const { dom } = await loadIndex(f.fetchImpl);
  const w = dom.window;
  try {
    const link = w.document.querySelector('#bottom-nav a[href="/history"], #sidebar a[href="/history"], a[href="/history"]');
    assert.ok(link, 'a link to /history in the shell');
    link.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 }));
    assert.ok(link.hasAttribute('data-pressed'), 'pressed at once');
    assert.ok(await until(() => typeof opts.release === 'function'));
    opts.release();
    assert.ok(await until(() => !link.hasAttribute('data-pressed')), 'released after the swap');
    assert.strictEqual(w.location.pathname, '/history');
  } finally { w.close(); }
});

test('G: a cache hit whose HEAD is redirected (the session ended) loads the URL for real', async () => {
  const f = makeFetch({ headRedirect: true });
  const { dom, errors } = await loadIndex(f.fetchImpl);
  const w = dom.window;
  try {
    await w.FileTube.navigate('/history');
    await w.FileTube.navigate('/books');
    const before = errors.filter((e) => /navigation/i.test(e)).length;
    await w.FileTube.navigate('/history');
    assert.ok(await until(() => errors.filter((e) => /navigation/i.test(e)).length > before), 'a real page load was asked (jsdom reports it as a navigation it does not implement)');
  } finally { w.close(); }
});

test('G: at idle after boot, each nav destination\'s shell is fetched once, so the FIRST tap swaps from the cache too', async () => {
  const f = makeFetch();
  const { dom } = await loadIndex(f.fetchImpl);
  const w = dom.window;
  try {
    assert.ok(await until(() => shellGets(f.calls, '/watch.html').length === 1, 400), 'the watch shell prefetched');
    const navPaths = Array.from(w.document.querySelectorAll('#bottom-nav a[href]')).map((a) => new URL(a.getAttribute('href'), 'http://localhost').pathname).filter((p) => ['/history', '/music', '/books', '/podcasts'].includes(p));
    assert.ok(navPaths.length > 0, 'the shell has nav destinations');
    for (const p of navPaths) assert.ok(await until(() => shellGets(f.calls, p).length === 1, 200), `${p} prefetched once`);
    const p0 = navPaths[0];
    await w.FileTube.navigate(p0);
    assert.strictEqual(shellGets(f.calls, p0).length, 1, 'the first tap used the prefetched shell');
  } finally { w.close(); }
});

test('G server: every shell names the lazy view scripts\' content hashes; the server list equals the router\'s', async () => {
  process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'filetube-g-'));
  const server = require('../../server');
  const COMMON = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'common.js'), 'utf8');
  const block = COMMON.slice(COMMON.indexOf('const VIEW_SCRIPT_SRC = {'), COMMON.indexOf('function ensureViewScriptLoaded'));
  const routerList = Array.from(block.replace(/\/\/[^\n]*/g, '').matchAll(/:\s*'(\/js\/[a-z-]+\.js)'/g)).map((m) => m[1]).sort();
  assert.ok(routerList.length >= 10, 'the router list was read');
  assert.deepStrictEqual(server.LAZY_VIEW_SCRIPTS.slice().sort(), routerList);
  const { authenticateFetch } = require('../helpers/auth');
  const srv = await new Promise((resolve) => { const s = server.app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    authenticateFetch(srv, base);
    for (const p of ['/', '/music', '/watch.html', '/history', '/feed']) {
      const html = await (await fetch(base + p)).text();
      const m = /<meta name="ft-view-scripts" content="([^"]*)">/.exec(html);
      assert.ok(m, `${p} carries the meta`);
      const music = /\/js\/music\.js=([0-9a-f]{16})/.exec(m[1]);
      assert.ok(music, `${p}: music.js has its hash`);
      const res = await fetch(`${base}/js/music.js?v=${music[1]}`);
      assert.strictEqual(res.headers.get('cache-control'), 'private, max-age=31536000, immutable', 'the hash is the one the server caches for good');
    }
  } finally {
    srv.closeAllConnections?.();
    await new Promise((resolve) => srv.close(resolve));
  }
});
