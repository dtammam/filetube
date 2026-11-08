'use strict';

// [INTEGRATION] v1.406.0 W1 A1 (plan docs/exec-plans/active/2026-11-08-smoothness.md): a home ROW card (Classic's Continue
// watching, the feed layout's rows) stashes the same watch seed a grid card does, so the player starts at the tap instead of
// waiting for the watch page's fetches. FULL CHAIN: the real index.html with common.js and main.js loaded as in the browser
// (the multi-select-fullchain loading shape, own copy per the small-per-file-harness convention), the REAL row builder and the
// REAL click; the seed is read back through the real consumeWatchSeed.

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


const ROW_ITEM = { id: 'r1', title: 'Row video', type: 'video', ext: '.mp4', duration: 300, size: 4000, filePath: '/media/folder/r1.mp4', folderName: 'folder', hasThumbnail: true, needsTranscode: false, progressPercent: 40 };

// the server-emitted feed row shape (server.js resolveHomeItem + watchSeedFields): no size, no filePath
const FEED_ITEM = { id: 'f1', kind: 'media', title: 'Feed video', subtitle: 'folder', thumbnailUrl: '/thumbnail/f1', href: '/watch.html?v=f1', progressPercent: 0, type: 'video', duration: 200, hasThumbnail: true, needsTranscode: false };

function makeFetchStub() {
  const calls = [];
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    calls.push({ url, method });
    const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    if (url === '/api/config') return ok({ folders: ['/media/folder'], folderSettings: {} });
    if (url === '/api/settings') return ok({ defaultView: '' });
    if (url === '/api/auth/me') return ok({ user: { id: 1, username: 'u', role: 'member', canModifyLibrary: true }, settings: {} });
    if (url === '/api/home') return ok({ rows: [{ id: 'continue-watching', title: 'Continue watching', items: [FEED_ITEM, { id: 't9', kind: 'track', title: 'A song', subtitle: 'Artist', thumbnailUrl: '/albumart/t9', href: '/music?play=t9', progressPercent: 0 }] }] });
    if (url.indexOf('/api/videos?filter=recent-watching') === 0) return ok({ items: [ROW_ITEM], total: 1, offset: 0, limit: 5 });
    if (url.indexOf('/api/videos?') === 0) return ok({ items: [], total: 0, offset: 0, limit: 60 });
    return new Promise(() => {}); // everything else (the watch shell after the tap) never answers here
  };
  return { fetchImpl, calls };
}

function loadIndex(fetchImpl, pageUrl, beforeParseExtra) {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const dom = new JSDOM(html, {
    url: pageUrl || 'http://localhost/',
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
      // The grid's infinite-scroll sentinel observer: its callback is captured so a test can
      // "scroll" the sentinel into view and append page 2.
      window.__io = [];
      window.IntersectionObserver = class {
        constructor(cb) { window.__io.push(cb); }
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      window.matchMedia = (query) => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      if (beforeParseExtra) beforeParseExtra(window);
    },
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(dom); } };
    dom.window.addEventListener('load', () => setTimeout(finish, 20));
    setTimeout(finish, 5000).unref();
  });
}


const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('A1: a Classic Continue watching ROW card stashes the full watch seed on tap (consumed by id, the player\'s fields intact)', async () => {
  const stub = makeFetchStub();
  const dom = await loadIndex(stub.fetchImpl);
  try {
    const doc = dom.window.document;
    let row = null;
    for (let i = 0; i < 100 && !row; i++) { await sleep(20); row = doc.querySelector('a.video-row-card[href*="/watch.html?v=r1"]'); }
    assert.ok(row, 'the Continue watching row rendered its card');
    row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    const seed = dom.window.consumeWatchSeed('r1');
    assert.ok(seed, 'the tap stashed a seed for this id');
    assert.strictEqual(seed.item.id, 'r1');
    assert.strictEqual(dom.window.isFullWatchSeedItem(seed.item), true, 'a seed the player starts from');
    assert.strictEqual(seed.item.hasThumbnail, true);
  } finally { dom.window.close(); }
});

test('A1: a feed-layout ROW card (GET /api/home) stashes the full watch seed; a track row stashes nothing', async () => {
  const stub = makeFetchStub();
  const dom = await loadIndex(stub.fetchImpl, null, (w) => { w.localStorage.setItem('ft-home-feed', 'on'); });
  try {
    const doc = dom.window.document;
    let row = null;
    for (let i = 0; i < 100 && !row; i++) { await sleep(20); row = doc.querySelector('a.video-row-card[href*="/watch.html?v=f1"]'); }
    assert.ok(row, 'the feed row rendered its media card');
    row.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    const seed = dom.window.consumeWatchSeed('f1');
    assert.ok(seed, 'the tap stashed a seed');
    assert.strictEqual(dom.window.isFullWatchSeedItem(seed.item), true);
    const track = doc.querySelector('a.video-row-card[href*="/music?play=t9"]');
    assert.ok(track, 'the track card is there');
    track.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    assert.strictEqual(dom.window.consumeWatchSeed('t9'), null, 'a track never primes a watch page');
  } finally { dom.window.close(); }
});
