'use strict';

// [INTEGRATION] Wave B - the unified-search CLIENT against a real jsdom
// index.html + main.js. Binds: a GLOBAL header search (?search=) fetches
// /api/search (NOT /api/videos); the mixed-type results render as cards with a
// type badge; the content-TYPE chip row mounts (not the video-only searchIn
// toggle); a chip click refetches with ?type=. Harness = card-corners-
// fullchain's loading shape (the repo's small-per-file-harness convention).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const INDEX_HTML_PATH = path.join(PUBLIC_DIR, 'index.html');

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

// The blended /api/search result set (one item per representative type).
function searchItems() {
  return [
    { resultType: 'music', kind: 'track', id: 'tz', title: 'Zephyr', artist: 'Band', identityText: 'Band' },
    { resultType: 'book', kind: 'book', id: 'bz', title: 'Zephyr', author: 'Writer', identityText: 'Writer' },
    { resultType: 'tv-show', kind: 'tv-show', id: 'shZ', title: 'Zephyr Chronicles', posterEpisodeId: 'tve', identityText: '' },
    { resultType: 'tv-episode', kind: 'tv-episode', id: 'tve', title: 'The Storm', showId: 'shZ', showName: 'Zephyr Chronicles', identityText: 'Zephyr Chronicles' },
    { resultType: 'video', id: 'vzw', title: 'Zephyr Winds', type: 'video', ext: '.mp4', duration: 10, watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  ];
}

function makeFetchStub() {
  const calls = [];
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    calls.push({ url, method });
    if (url === '/api/config') return Promise.resolve({ ok: true, status: 200, json: async () => ({ folders: ['/media/f'], folderSettings: {} }) });
    if (url === '/api/settings') return Promise.resolve({ ok: true, status: 200, json: async () => ({ defaultView: '' }) });
    if (url === '/api/auth/me') return Promise.resolve({ ok: true, status: 200, json: async () => ({ user: { id: 1, username: 'u', role: 'admin', canModifyLibrary: true }, settings: {} }) });
    if (url === '/api/subscriptions/health') return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    if (url.indexOf('/api/search?') === 0) {
      const items = searchItems();
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ items, total: items.length, offset: 0, limit: 60 }) });
    }
    if (url.indexOf('/api/videos?') === 0) {
      // must NOT be hit for a global search - record + return empty so a
      // regression (falling back to /api/videos) is visible in `calls`.
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [], total: 0, offset: 0, limit: 60 }) });
    }
    return new Promise(() => {});
  };
  return { fetchImpl, calls };
}

function loadIndex(fetchImpl, url) {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    resources: {
      interceptors: [requestInterceptor((request) => {
        const requestUrl = new URL(request.url);
        const filePath = path.join(PUBLIC_DIR, requestUrl.pathname);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          return new Response(fs.readFileSync(filePath, 'utf8'), { status: 200, headers: { 'Content-Type': contentTypeFor(filePath) } });
        }
        return new Response('', { status: 404 });
      })],
    },
    beforeParse(window) {
      window.fetch = fetchImpl;
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    },
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(dom); } };
    dom.window.addEventListener('load', () => setTimeout(finish, 20));
    setTimeout(finish, 5000);
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(n) { for (let i = 0; i < (n || 10); i++) await flush(); }
function click(dom, el) { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); }

test('a GLOBAL header search fetches /api/search (never /api/videos) and renders the blended results', async () => {
  const { fetchImpl, calls } = makeFetchStub();
  const dom = await loadIndex(fetchImpl, 'http://localhost/?search=zephyr');
  try {
    await settle();
    const searchCalls = calls.filter((c) => c.url.indexOf('/api/search?') === 0);
    assert.ok(searchCalls.length >= 1, 'the unified endpoint was called');
    assert.ok(searchCalls.some((c) => /[?&]q=zephyr(&|$)/.test(c.url)), 'q=zephyr on the request');
    assert.strictEqual(calls.filter((c) => c.url.indexOf('/api/videos?') === 0).length, 0, '/api/videos NOT hit for a global search');
    const cards = dom.window.document.querySelectorAll('#video-grid .video-card');
    assert.strictEqual(cards.length, 5, 'all five blended results render');
  } finally { dom.window.close(); }
});

test('mixed cards carry a type badge and route correctly (tv-show -> /tv?show=, tv-episode -> /watch.html?tv=)', async () => {
  const { fetchImpl } = makeFetchStub();
  const dom = await loadIndex(fetchImpl, 'http://localhost/?search=zephyr');
  try {
    await settle();
    const { document } = dom.window;
    const badges = Array.from(document.querySelectorAll('#video-grid .card-type-badge')).map((b) => b.textContent.trim());
    assert.ok(badges.includes('Music') && badges.includes('Book') && badges.includes('Show') && badges.includes('Episode') && badges.includes('Video'),
      `expected type badges, saw ${JSON.stringify(badges)}`);
    // tv-show card links to the Shows page scrolled to it
    const showLink = Array.from(document.querySelectorAll('#video-grid a.thumbnail-container')).map((a) => a.getAttribute('href'));
    assert.ok(showLink.some((h) => h === '/tv?show=shZ'), `tv-show routes to /tv?show=shZ (saw ${JSON.stringify(showLink)})`);
    assert.ok(showLink.some((h) => h === '/watch.html?tv=tve'), 'tv-episode routes to the shared watch page');
    // v1.205 gate (adversarial): a TV card must render NO download/like corner
    // (default corners are download TL + like BL) - no route backs them.
    const tvCards = Array.from(document.querySelectorAll('#video-grid .video-card')).filter((c) => {
      const a = c.querySelector('a.thumbnail-container');
      const href = a && a.getAttribute('href');
      return href === '/tv?show=shZ' || href === '/watch.html?tv=tve';
    });
    assert.strictEqual(tvCards.length, 2, 'both TV cards present');
    for (const c of tvCards) {
      assert.strictEqual(c.querySelector('.card-download-btn'), null, 'TV card: no download corner');
      assert.strictEqual(c.querySelector('.card-like-btn'), null, 'TV card: no like corner');
    }
  } finally { dom.window.close(); }
});

test('the content-TYPE chip row mounts for a global search (not the video-only searchIn toggle); a chip refetches with ?type=', async () => {
  const { fetchImpl, calls } = makeFetchStub();
  const dom = await loadIndex(fetchImpl, 'http://localhost/?search=zephyr');
  try {
    await settle();
    const { document } = dom.window;
    const chips = document.querySelector('#library-search-type-chips');
    assert.ok(chips, 'the type-chip row is mounted');
    assert.strictEqual(document.querySelector('#library-search-scope-toggle'), null, 'the video-only searchIn toggle is NOT mounted');
    const musicChip = chips.querySelector('[data-search-type="music"]');
    assert.ok(musicChip, 'a Music chip exists');
    const before = calls.length;
    click(dom, musicChip);
    await settle();
    const after = calls.slice(before).filter((c) => c.url.indexOf('/api/search?') === 0);
    assert.ok(after.some((c) => /[?&]type=music(&|$)/.test(c.url)), `clicking Music refetches with type=music (saw ${after.map((c) => c.url)})`);
  } finally { dom.window.close(); }
});
