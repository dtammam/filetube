'use strict';

// [INTEGRATION] v1.33.1 (Dean) -- the count-gated Liked sidebar entry on the
// WATCH page (the surface Dean reported it missing from: "Liked only shows
// on Home"). Boots the REAL watch.html + public/js scripts under jsdom (same
// harness as watch-like-button.test.js) and asserts:
//
//   - liked videos exist -> the sidebar folder list gets the Liked entry,
//     prepended before the folder links
//   - zero liked videos -> NO entry anywhere
//   - liking the current video (first like ever) -> the entry APPEARS
//     without a reload (the force-refresh hook on the like toggle)
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const WATCH_HTML_PATH = path.join(PUBLIC_DIR, 'watch.html');

const MEDIA_ID = 'liked-sidebar-item-1';

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

// Stub fetch: /api/config returns one folder (so the sidebar renders a real
// list), /api/liked?limit=1 returns the CURRENT likedTotal (mutable), the
// like toggle mutates it -- exactly the server's own membership semantics.
function makeFetchStub(initialLikedTotal) {
  const state = { likedTotal: initialLikedTotal, liked: initialLikedTotal > 0 };
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    if (url === '/api/config' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ folders: ['/media/library'], folderSettings: {} }) });
    }
    if (url === `/api/videos/${MEDIA_ID}` && method === 'GET') {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({
          id: MEDIA_ID, title: 'Sidebar Test Video', filePath: `/media/library/${MEDIA_ID}.mp4`,
          folderName: 'library', type: 'video', ext: '.mp4', duration: 120, size: 5000,
          addedAt: 100000, liked: state.liked,
        }),
      });
    }
    if (url === '/api/liked?limit=1' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [], total: state.likedTotal, offset: 0, limit: 1 }) });
    }
    if (url === `/api/liked/${MEDIA_ID}` && (method === 'POST' || method === 'DELETE')) {
      state.liked = method === 'POST';
      state.likedTotal += method === 'POST' ? 1 : -1;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, liked: state.liked }) });
    }
    return new Promise(() => {}); // everything else -- irrelevant here
  };
  return { fetchImpl, state };
}

function loadWatch(fetchImpl) {
  const html = fs.readFileSync(WATCH_HTML_PATH, 'utf8');
  const dom = new JSDOM(html, {
    url: `http://localhost/watch.html?v=${MEDIA_ID}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    resources: {
      interceptors: [
        requestInterceptor((request) => {
          const requestUrl = new URL(request.url);
          const filePath = path.join(PUBLIC_DIR, requestUrl.pathname);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return new Response(fs.readFileSync(filePath, 'utf8'), { status: 200, headers: { 'Content-Type': contentTypeFor(filePath) } });
          }
          return new Response('', { status: 404 });
        }),
      ],
    },
    beforeParse(window) {
      window.fetch = fetchImpl;
      window.matchMedia = (query) => ({
        matches: false, media: query,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
      });
    },
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve({ dom }); } };
    dom.window.addEventListener('load', () => setTimeout(finish, 20));
    setTimeout(finish, 5000);
  });
}

async function settle(times) {
  for (let i = 0; i < (times || 10); i++) await new Promise((r) => setTimeout(r, 0));
}

test('watch page: with liked videos existing, the sidebar folder list shows the Liked entry FIRST', async () => {
  const { fetchImpl } = makeFetchStub(3);
  const { dom } = await loadWatch(fetchImpl);
  try {
    await settle();
    const list = dom.window.document.getElementById('sidebar-folders-list');
    const entry = list.querySelector('.sidebar-item-liked');
    assert.ok(entry, 'expected the Liked entry on the WATCH page sidebar (the surface it was missing from)');
    assert.strictEqual(entry.getAttribute('href'), '/?liked=1');
    assert.strictEqual(list.firstElementChild, entry, 'the Liked entry must be prepended before the folder links');
    assert.ok(list.querySelectorAll('.sidebar-item').length >= 2, 'sanity: the folder link itself still renders');
  } finally {
    dom.window.close();
  }
});

test('watch page: with ZERO liked videos, no Liked entry renders anywhere', async () => {
  const { fetchImpl } = makeFetchStub(0);
  const { dom } = await loadWatch(fetchImpl);
  try {
    await settle();
    assert.strictEqual(dom.window.document.querySelector('.sidebar-item-liked'), null);
  } finally {
    dom.window.close();
  }
});

test('watch page: liking the current video (the FIRST like ever) makes the sidebar entry appear without a reload', async () => {
  const { fetchImpl } = makeFetchStub(0);
  const { dom } = await loadWatch(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    assert.strictEqual(document.querySelector('.sidebar-item-liked'), null, 'sanity: no entry before the like');

    const likeBtn = document.getElementById('like-media-btn');
    assert.ok(likeBtn, 'sanity: the Like button is mounted');
    likeBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await settle(20);

    const entry = document.getElementById('sidebar-folders-list').querySelector('.sidebar-item-liked');
    assert.ok(entry, 'the Liked entry must appear the moment the first like lands (force-refreshed count)');
  } finally {
    dom.window.close();
  }
});
