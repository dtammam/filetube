'use strict';

// [INTEGRATION] v1.339 S2 (plan docs/exec-plans/completed/2026-09-26-fouc-toctou-audit.md,
// finding T-C1, decision D2): the HOME sidebar drag, driven through the real
// index.html + main.js + common.js in jsdom.
//
// The data-loss shape: home loads the folder config once (and the cached-home
// restore re-renders that same init-time copy); another device then adds a
// folder; a drag here used to POST the init-time list back, and the server
// replaced the tables with it - dropping the new folder. Now the drop re-GETs
// the config, applies the move BY PATH onto that fresh list, and POSTs it with
// the fresh folderSettings and `baseVersion`; a 409 retries once from a new GET.
//
// Each test boots home with the server holding [A, B], then swaps the server's
// config (the other device's write) BEFORE the drag, so the page's own copy is
// stale exactly as it would be on a device.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const A = '/media/Alpha';
const B = '/media/Bravo';
const C = '/media/Charlie';
function contentTypeFor(p) { return p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'application/octet-stream'; }

// `state.config` is what GET /api/config answers (mutable by the test);
// `state.postStatus(n)` picks the n-th POST's status.
function bootHome(state) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const posts = [];
  const configGets = [];
  return new Promise((resolve) => {
    const dom = new JSDOM(html, {
      url: 'http://localhost/',
      runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
      resources: { interceptors: [requestInterceptor((request) => {
        const p = new URL(request.url).pathname; const f = path.join(PUBLIC_DIR, p);
        if (fs.existsSync(f) && fs.statSync(f).isFile()) return new Response(fs.readFileSync(f, 'utf8'), { status: 200, headers: { 'Content-Type': contentTypeFor(f) } });
        return new Response('', { status: 404 });
      })] },
      beforeParse(window) {
        window.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        window.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          const method = (init && init.method) || 'GET';
          const json = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
          if (url === '/api/config' && method === 'POST') {
            posts.push(JSON.parse(init.body));
            const status = state.postStatus ? state.postStatus(posts.length) : 200;
            if (status === 409) return json({ error: 'stale', configVersion: 'v-moved' }, 409);
            return json({ success: true, folders: [], folderSettings: {}, configVersion: 'v-after' });
          }
          if (url === '/api/config') { configGets.push(url); return json(state.config()); }
          if (url === '/api/settings' && method === 'GET') return json({ defaultView: '', defaultSort: 'release-date' });
          if (url === '/api/auth/me') return json({ user: { username: 'dean', role: 'admin' }, settings: {} });
          if (url.startsWith('/api/videos')) return json({ items: [], total: 0, offset: 0, limit: 50 });
          if (url.startsWith('/api/')) return json({ items: [], folders: [], rows: [] });
          return Promise.resolve({ ok: true, status: 200, url: 'http://localhost' + url, redirected: false, headers: { get: (h) => (/content-type/i.test(h) ? 'text/html' : null) }, text: async () => html });
        };
      },
    });
    dom.window.addEventListener('load', () => setTimeout(() => resolve({ dom, posts, configGets }), 60));
    setTimeout(() => resolve({ dom, posts, configGets }), 5000);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rowsOf = (dom) => Array.from(dom.window.document.querySelectorAll('#sidebar-folders-list .sidebar-item[data-index]'));

// A mouse drag of row `from` to `clientY`, through the shared pointer layer
// (rows laid out 30px apart - jsdom does no layout).
function drag(dom, from, clientY) {
  const rows = rowsOf(dom);
  rows.forEach((row, i) => { row.getBoundingClientRect = () => ({ top: i * 30, bottom: i * 30 + 30, height: 30, left: 0, right: 200, width: 200 }); });
  const at = (el, type, y) => el.dispatchEvent(new dom.window.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: y,
  }));
  const start = from * 30 + 5;
  at(rows[from], 'pointerdown', start);
  at(dom.window.document, 'pointermove', start + 10);
  at(dom.window.document, 'pointermove', clientY);
  at(dom.window.document, 'pointerup', clientY);
}

const PAGE = { folders: [A, B], folderSettings: {}, syntheticFolders: [], folderDisplayNames: {}, configVersion: 'v-page' };
const FRESH = {
  folders: [A, B, C],
  folderSettings: { [B]: { name: 'Bravo Renamed', hidden: false, hiddenFromSidebar: false }, [C]: { name: 'Charlie', hidden: false, hiddenFromSidebar: false } },
  syntheticFolders: [], folderDisplayNames: {}, configVersion: 'v-fresh',
};

test('home sidebar drag: the init-time list lacks C but the server has it -> the POST carries C, the FRESH settings and the fresh base', async () => {
  let current = PAGE;
  const { dom, posts } = await bootHome({ config: () => current });
  try {
    await wait(300);
    assert.deepStrictEqual(rowsOf(dom).map((r) => r.getAttribute('title')), [A, B], 'populated: home rendered its two folders');
    current = FRESH; // another device adds C and renames B
    drag(dom, 0, 30 + 22); // Alpha -> after Bravo
    await wait(200);
    assert.strictEqual(posts.length, 1, 'exactly one POST');
    assert.deepStrictEqual(posts[0].folders, [B, A, C], 'the move landed by path on the fresh list - C survives');
    assert.deepStrictEqual(posts[0].folderSettings, FRESH.folderSettings, 'the fresh settings (the rename survives)');
    assert.strictEqual(posts[0].baseVersion, 'v-fresh');
  } finally { dom.window.close(); }
});

test('home sidebar drag: a 409 retries once from a new GET; a second 409 stops and re-renders from storage', async () => {
  let current = PAGE;
  const { dom, posts } = await bootHome({ config: () => current, postStatus: () => 409 });
  try {
    await wait(300);
    current = FRESH;
    drag(dom, 1, 5); // Bravo -> before Alpha
    await wait(200);
    assert.strictEqual(posts.length, 2, 'one retry, never a third write');
    assert.deepStrictEqual(posts.map((p) => p.baseVersion), ['v-fresh', 'v-fresh']);
    assert.deepStrictEqual(posts[1].folders, [B, A, C]);
    assert.deepStrictEqual(rowsOf(dom).map((r) => r.getAttribute('title')), [A, B, C], 'the sidebar now shows the stored config, C included');
  } finally { dom.window.close(); }
});
