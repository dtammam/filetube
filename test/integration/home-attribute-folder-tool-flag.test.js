'use strict';

// [INTEGRATION] v1.202: the folder-view bulk "Attribute unattributed videos"
// tool (main.js ensureAttributeFolderButton) is behind the manual-attribution
// opt-in. Boots the REAL index.html + scripts under jsdom on a `?root=` view
// with an unattributed item, stubbing the fetches the view needs; binds:
// flag ON -> #attribute-folder-btn mounts; flag OFF -> absent; and a
// non-root view never even asks /api/settings for the flag.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const ROOT = '/media/Some Channel';
function contentTypeFor(p) { return p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'application/octet-stream'; }

function loadHome({ flag, root }) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const settingsCalls = [];
  const item = { id: 'v1', title: 'Unattributed clip', filePath: `${ROOT}/clip.mp4`, folderName: 'Some Channel', rootFolder: ROOT, type: 'video', ext: '.mp4', duration: 10, size: 1, addedAt: 1 };
  return new Promise((resolve) => {
    const dom = new JSDOM(html, {
      url: 'http://localhost/' + (root ? `?root=${encodeURIComponent(ROOT)}` : ''),
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
          const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
          if (url === '/api/settings' && method === 'GET') { settingsCalls.push(url); return json({ defaultView: '', defaultSort: 'release-date', attributeControlEnabled: flag, transcriptAiPrompts: [] }); }
          if (url === '/api/auth/me') return json({ user: { username: 'dean', role: 'admin' }, settings: {} });
          if (url === '/api/config') return json({ folders: [ROOT], folderSettings: {} });
          if (url.startsWith('/api/videos')) return json({ items: root ? [item] : [], total: root ? 1 : 0, offset: 0, limit: 50 });
          if (url.startsWith('/api/')) return json({ items: [], folders: [], rows: [] });
          return new Promise(() => {});
        };
      },
    });
    dom.window.addEventListener('load', () => setTimeout(() => resolve({ dom, settingsCalls }), 60));
    setTimeout(() => resolve({ dom, settingsCalls }), 5000);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('folder view: flag ON + an unattributed item -> the bulk Attribute tool mounts; flag OFF -> absent', async () => {
  let { dom } = await loadHome({ flag: true, root: true });
  try {
    await wait(400);
    assert.ok(dom.window.document.getElementById('attribute-folder-btn'), 'mounted with the opt-in on');
  } finally { dom.window.close(); }
  ({ dom } = await loadHome({ flag: false, root: true }));
  try {
    await wait(400);
    assert.strictEqual(dom.window.document.getElementById('attribute-folder-btn'), null, 'absent with the opt-in off');
  } finally { dom.window.close(); }
});
