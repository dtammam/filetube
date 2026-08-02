'use strict';

// [INTEGRATION] v1.67 T4 - the FULL-CHAIN bind for card-corner
// customization: a real jsdom `index.html` (runScripts: 'dangerously',
// static files served from disk), the REAL main.js view, a scripted fetch
// stub - so what is asserted is the RENDERED grid and the REAL delegated
// click handlers, never a reducer in isolation (the v1.66 decision-vs-use
// lesson, struck three times; gate attack surface 3: mutating the
// buildCardHtml call back to static defaults MUST turn the custom-layout
// tests below red).
//
// HARNESS: own copy of test/integration/library-pagination.test.js's exact
// loading shape, per this repo's documented small-per-file-harness-
// duplication convention (see that file's header for the prior-art chain).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const INDEX_HTML_PATH = path.join(PUBLIC_DIR, 'index.html');

const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

// Two-item fixture: `yt1` is yt-dlp-managed (channelName -> immediate
// second-tap delete, no modal) WITH a server-derived watchUrl; `local1` is a
// plain local file (no watchUrl -> the share corner must render nothing).
function makeItems() {
  return [
    {
      id: 'yt1', title: 'From YouTube', type: 'video', ext: '.mp4',
      duration: 120, size: 1000, addedAt: 100000, folderName: 'folder',
      progressPercent: 0, channelName: 'A Channel', watchUrl: WATCH_URL,
    },
    {
      id: 'local1', title: 'Local File', type: 'video', ext: '.mp4',
      duration: 60, size: 2000, addedAt: 99999, folderName: 'folder',
      progressPercent: 0,
    },
  ];
}

// Scriptable fetch stub. `opts.meSettings`: object -> 200 {settings}, the
// string 'fail' -> 500, 'network' -> rejected promise. `opts.healthOk`:
// /api/subscriptions/health 200 vs 404. Every call is recorded.
function makeFetchStub(opts) {
  const calls = [];
  const items = opts.items || makeItems();
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    calls.push({ url, method, body: init && init.body });
    if (url === '/api/config' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ folders: ['/media/folder'], folderSettings: {} }) });
    }
    if (url === '/api/settings' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ defaultView: '' }) });
    }
    if (url === '/api/auth/me' && method === 'GET') {
      if (opts.meSettings === 'network') return Promise.reject(new Error('offline'));
      if (opts.meSettings === 'fail') return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 1, username: 'u', settings: opts.meSettings || {} }) });
    }
    if (url === '/api/subscriptions/health' && method === 'GET') {
      return Promise.resolve({ ok: opts.healthOk === true, status: opts.healthOk === true ? 200 : 404, json: async () => ({}) });
    }
    if (url.indexOf('/api/videos?') === 0 && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ items, total: items.length, offset: 0, limit: 60 }) });
    }
    if (url.indexOf('/api/ytdlp/repull-metadata/item/') === 0 && method === 'POST') {
      // ok: true - a real fetch has ok truthy for ANY 2xx (adversarial S2:
      // an ok:false-with-202 stub is this repo's divergent-fixture scar
      // class - it would judge a future res.ok refactor against a lie).
      return Promise.resolve({ ok: true, status: 202, json: async () => ({ started: true }) });
    }
    if (url === '/api/queue/items' && method === 'POST') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ queue: { entries: [{ uid: 'q1', mediaId: 'yt1' }] } }) });
    }
    if (url.indexOf('/api/videos/') === 0 && method === 'DELETE') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, trashed: true }) });
    }
    return new Promise(() => {}); // pins/bell/etc. -- irrelevant here
  };
  return { fetchImpl, calls };
}

function loadIndex(fetchImpl, beforeParseExtra) {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    resources: {
      interceptors: [
        requestInterceptor((request) => {
          const requestUrl = new URL(request.url);
          const filePath = path.join(PUBLIC_DIR, requestUrl.pathname);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const body = fs.readFileSync(filePath, 'utf8');
            return new Response(body, { status: 200, headers: { 'Content-Type': contentTypeFor(filePath) } });
          }
          return new Response('', { status: 404 });
        }),
      ],
    },
    beforeParse(window) {
      window.fetch = fetchImpl;
      window.IntersectionObserver = class {
        observe() {} unobserve() {} disconnect() {}
      };
      window.matchMedia = (query) => ({
        matches: false, media: query,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
      });
      if (beforeParseExtra) beforeParseExtra(window);
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
async function settle(times) { for (let i = 0; i < (times || 8); i++) await flush(); }

function click(dom, el) {
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

// ---------------------------------------------------------------------------

test('DEFAULTS: today\'s layout renders on every card - download TL, delete TR, like BL; queue/share/reheat ABSENT (C5)', async () => {
  const { fetchImpl } = makeFetchStub({ meSettings: {} });
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const cards = document.querySelectorAll('#video-grid .video-card');
    assert.strictEqual(cards.length, 2, 'both fixture items render');
    for (const card of cards) {
      assert.ok(card.querySelector('a.card-download-btn.card-corner-tl'), 'download in TL');
      assert.ok(card.querySelector('button.card-delete-btn.card-corner-tr'), 'delete in TR');
      assert.ok(card.querySelector('button.card-like-btn.card-corner-bl'), 'like in BL');
      assert.strictEqual(card.querySelector('.card-queue-btn'), null, 'queue unassigned by default (the collision fix)');
      assert.strictEqual(card.querySelector('.card-share-btn'), null);
      assert.strictEqual(card.querySelector('.card-reheat-btn'), null);
      assert.ok(card.querySelector('.duration-badge'), 'the duration badge owns bottom-right');
    }
  } finally { dom.window.close(); }
});

test('CUSTOM prefs BIND to the rendered grid (kills the pass-defaults mutant): queue TL, like TR, none BL', async () => {
  const { fetchImpl } = makeFetchStub({ meSettings: { cornerTL: 'queue', cornerTR: 'like', cornerBL: 'none' } });
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const card = document.querySelector('#video-grid .video-card');
    assert.ok(card.querySelector('button.card-queue-btn.card-corner-tl'), 'queue moved to TL');
    assert.ok(card.querySelector('button.card-queue-btn.card-corner-tl i.icon-queue'), 'via the promoted mask');
    assert.ok(card.querySelector('button.card-like-btn.card-corner-tr'), 'like moved to TR');
    assert.strictEqual(card.querySelector('.card-corner-bl'), null, 'none -> an empty corner');
    assert.strictEqual(card.querySelector('.card-download-btn'), null, 'unassigned controls are gone');
    assert.strictEqual(card.querySelector('.card-delete-btn'), null);
  } finally { dom.window.close(); }
});

test('SHARE corner: renders only on items with the server-derived watchUrl; click runs the native share sheet with {title, url}', async () => {
  const { fetchImpl } = makeFetchStub({ meSettings: { cornerTL: 'share' } });
  const shareCalls = [];
  const dom = await loadIndex(fetchImpl, (window) => {
    window.navigator.share = (payload) => { shareCalls.push(payload); return Promise.resolve(); };
  });
  try {
    await settle();
    const { document } = dom.window;
    const ytShare = document.querySelector('#video-grid .card-share-btn[data-id="yt1"]');
    assert.ok(ytShare, 'the yt-dlp item gets the share corner');
    assert.ok(ytShare.classList.contains('card-corner-tl'));
    assert.strictEqual(document.querySelector('#video-grid .card-share-btn[data-id="local1"]'), null,
      'the local item renders NOTHING in that corner (C4) - never a fallback control');

    click(dom, ytShare.querySelector('i') || ytShare);
    await settle();
    assert.strictEqual(shareCalls.length, 1, 'one native share invocation');
    assert.strictEqual(shareCalls[0].url, WATCH_URL, 'the SERVER-derived URL, straight through');
    assert.strictEqual(shareCalls[0].title, 'From YouTube', 'the item title rides into the sheet');
  } finally { dom.window.close(); }
});

test('SHARE corner failure feedback (QA S6): no share sheet AND no clipboard -> a toast, never a silently dead button', async () => {
  const { fetchImpl } = makeFetchStub({ meSettings: { cornerTL: 'share' } });
  // beforeParse adds NO navigator.share; jsdom ships no navigator.clipboard
  // either, so shareExternalUrl resolves 'unavailable' - the card path must
  // surface that (the watch page's metadata block fallback does not exist
  // on a card).
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const btn = document.querySelector('#video-grid .card-share-btn[data-id="yt1"]');
    assert.ok(btn, 'sanity: share corner rendered');
    click(dom, btn.querySelector('i') || btn);
    await settle();
    const toasts = Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent);
    assert.ok(toasts.some((t) => t.includes('Could not share the link.')),
      `expected the failure toast, saw: ${JSON.stringify(toasts)}`);
  } finally { dom.window.close(); }
});

test('REHEAT corner: module health OK -> flame renders; click POSTs the per-item reheat endpoint', async () => {
  const { fetchImpl, calls } = makeFetchStub({ meSettings: { cornerBL: 'reheat' }, healthOk: true });
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const flame = document.querySelector('#video-grid .card-reheat-btn[data-id="yt1"]');
    assert.ok(flame, 'reheat renders when the capability probe says enabled');
    assert.ok(flame.classList.contains('card-corner-bl'));
    assert.ok(flame.querySelector('i.icon-flame'));

    click(dom, flame.querySelector('i') || flame);
    await settle();
    const reheatPosts = calls.filter((c) => c.method === 'POST' && c.url === '/api/ytdlp/repull-metadata/item/yt1');
    assert.strictEqual(reheatPosts.length, 1, 'the same per-item endpoint the watch flame fires');
  } finally { dom.window.close(); }
});

test('REHEAT corner: module health 404 -> the corner renders NOTHING (C4)', async () => {
  const { fetchImpl } = makeFetchStub({ meSettings: { cornerBL: 'reheat' }, healthOk: false });
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    assert.ok(document.querySelector('#video-grid .video-card'), 'cards still render');
    assert.strictEqual(document.querySelector('#video-grid .card-reheat-btn'), null, 'no flame without the module');
    assert.strictEqual(document.querySelector('#video-grid .card-corner-bl'), null, 'and no substitute control either');
  } finally { dom.window.close(); }
});

test('auth/me failure (500) and network failure both fall back to the C5 defaults - the grid never blocks on the pref', async () => {
  for (const mode of ['fail', 'network']) {
    const { fetchImpl } = makeFetchStub({ meSettings: mode });
    const dom = await loadIndex(fetchImpl);
    try {
      await settle();
      const { document } = dom.window;
      const card = document.querySelector('#video-grid .video-card');
      assert.ok(card, `cards render under auth/me ${mode}`);
      assert.ok(card.querySelector('.card-download-btn.card-corner-tl'), `defaults under ${mode}`);
      assert.ok(card.querySelector('.card-delete-btn.card-corner-tr'), `defaults under ${mode}`);
      assert.ok(card.querySelector('.card-like-btn.card-corner-bl'), `defaults under ${mode}`);
    } finally { dom.window.close(); }
  }
});

test('the delete ARM state machine survives relocation: two-tap + "Sure?" confirm in a CUSTOM corner (bottom-left)', async () => {
  const { fetchImpl, calls } = makeFetchStub({ meSettings: { cornerTL: 'none', cornerTR: 'none', cornerBL: 'delete' } });
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const btn = document.querySelector('#video-grid .card-delete-btn[data-id="yt1"]');
    assert.ok(btn, 'delete rendered in the custom corner');
    assert.ok(btn.classList.contains('card-corner-bl'), 'relocated to bottom-left');
    assert.ok(btn.querySelector('.card-delete-confirm'), 'the confirm copy is present');
    assert.strictEqual(btn.querySelector('.card-delete-confirm').textContent, 'Sure?');

    click(dom, btn.querySelector('i') || btn);
    await settle();
    assert.ok(btn.classList.contains('armed'), 'first tap ARMS (no delete yet)');
    assert.strictEqual(calls.filter((c) => c.method === 'DELETE').length, 0, 'no DELETE fired on the arming tap');

    click(dom, btn.querySelector('i') || btn);
    await settle();
    const deletes = calls.filter((c) => c.method === 'DELETE' && c.url === '/api/videos/yt1');
    assert.strictEqual(deletes.length, 1, 'the confirming second tap deletes (yt-dlp-managed item: immediate, v1.65 trash semantics server-side)');
  } finally { dom.window.close(); }
});

test('an assigned QUEUE corner still adds to the queue through the one shared verb (POST /api/queue/items)', async () => {
  const { fetchImpl, calls } = makeFetchStub({ meSettings: { cornerTR: 'queue' } });
  const dom = await loadIndex(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const btn = document.querySelector('#video-grid .card-queue-btn[data-id="yt1"]');
    assert.ok(btn, 'queue rendered in TR');
    click(dom, btn.querySelector('i') || btn);
    await settle();
    const posts = calls.filter((c) => c.method === 'POST' && c.url === '/api/queue/items');
    assert.strictEqual(posts.length, 1, 'one add-to-queue POST');
    assert.strictEqual(JSON.parse(posts[0].body).mediaId, 'yt1');
  } finally { dom.window.close(); }
});
