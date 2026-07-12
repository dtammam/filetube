'use strict';

// [INTEGRATION] v1.33 T2 -- the watch-page "Share" button. Boots the REAL
// watch.html + public/js scripts under jsdom (same harness as
// test/integration/watch-like-button.test.js) with a scripted fetch stub,
// and asserts the DOM-level contract directly:
//
//   - the button mounts inside `.watch-action-btns` ONLY when
//     `GET /api/videos/:id` carries a server-derived `watchUrl`
//   - an item WITHOUT a watchUrl gets no button at all
//   - clicking it calls `navigator.share({title, url})` with the ORIGINAL
//     YouTube link when the API exists
//   - without navigator.share, it falls back to `navigator.clipboard
//     .writeText(url)` and shows the transient "Copied!" label
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const WATCH_HTML_PATH = path.join(PUBLIC_DIR, 'watch.html');

const MEDIA_ID = 'share-item-1';
const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

function resolveResourcePath(pathname) {
  return path.join(PUBLIC_DIR, pathname);
}

function makeMediaResponse(withWatchUrl) {
  return {
    id: MEDIA_ID,
    title: 'A Shareable Video 🎵',
    filePath: `/media/folder/${MEDIA_ID}.mp4`,
    folderName: 'folder',
    type: 'video',
    ext: '.mp4',
    duration: 120,
    size: 5000,
    addedAt: 100000,
    liked: false,
    ...(withWatchUrl ? { watchUrl: WATCH_URL, youtubeId: 'dQw4w9WgXcQ' } : {}),
  };
}

function makeWatchFetchStub(withWatchUrl) {
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    if (url === '/api/config' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ folders: [], folderSettings: {} }) });
    }
    if (url === `/api/videos/${MEDIA_ID}` && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => makeMediaResponse(withWatchUrl) });
    }
    return new Promise(() => {}); // everything else -- irrelevant here
  };
  return { fetchImpl };
}

// `configureNavigator(window)` runs in beforeParse so tests can install/omit
// navigator.share / navigator.clipboard before any page script executes.
function loadWatchWithFetchStub(fetchImpl, configureNavigator) {
  const html = fs.readFileSync(WATCH_HTML_PATH, 'utf8');
  const virtualConsole = new VirtualConsole();

  const dom = new JSDOM(html, {
    url: `http://localhost/watch.html?v=${MEDIA_ID}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    resources: {
      interceptors: [
        requestInterceptor((request) => {
          const requestUrl = new URL(request.url);
          const filePath = resolveResourcePath(requestUrl.pathname);
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
      window.matchMedia = function (query) {
        return {
          matches: false,
          media: query,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
        };
      };
      if (configureNavigator) configureNavigator(window);
    },
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve({ dom });
    };
    dom.window.addEventListener('load', () => setTimeout(finish, 20));
    setTimeout(finish, 5000);
  });
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function settle(times) {
  for (let i = 0; i < (times || 10); i++) await flush();
}

test('watch page: the Share button mounts inside .watch-action-btns when the item carries a watchUrl', async () => {
  const { fetchImpl } = makeWatchFetchStub(true);
  const { dom } = await loadWatchWithFetchStub(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const shareBtn = document.getElementById('share-media-btn');
    assert.ok(shareBtn, 'expected a #share-media-btn to be mounted');
    assert.ok(
      document.querySelector('.watch-action-btns').contains(shareBtn),
      'expected the Share button to live inside .watch-action-btns, alongside Download/Delete/Move/Like'
    );
    assert.strictEqual(shareBtn.textContent, 'Share');
  } finally {
    dom.window.close();
  }
});

test('watch page: NO Share button for an item without a watchUrl (a plain local file has nothing to share)', async () => {
  const { fetchImpl } = makeWatchFetchStub(false);
  const { dom } = await loadWatchWithFetchStub(fetchImpl);
  try {
    await settle();
    assert.strictEqual(dom.window.document.getElementById('share-media-btn'), null);
  } finally {
    dom.window.close();
  }
});

test('watch page: clicking Share calls navigator.share with the ORIGINAL YouTube link and the display title', async () => {
  const shareCalls = [];
  const { fetchImpl } = makeWatchFetchStub(true);
  const { dom } = await loadWatchWithFetchStub(fetchImpl, (window) => {
    window.navigator.share = (payload) => {
      shareCalls.push(payload);
      return Promise.resolve();
    };
  });
  try {
    await settle();
    const shareBtn = dom.window.document.getElementById('share-media-btn');
    assert.ok(shareBtn, 'sanity: button mounted');

    shareBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await settle();

    assert.strictEqual(shareCalls.length, 1);
    // Field-by-field (not deepStrictEqual): the payload object was created
    // inside the jsdom realm, so its prototype is not this realm's
    // Object.prototype.
    assert.strictEqual(shareCalls[0].title, 'A Shareable Video 🎵');
    assert.strictEqual(shareCalls[0].url, WATCH_URL);
    assert.strictEqual(Object.keys(shareCalls[0]).length, 2, 'exactly {title, url} -- nothing else leaks into the sheet');
    assert.strictEqual(shareBtn.textContent, 'Share', 'the native-sheet path never rewrites the label');
  } finally {
    dom.window.close();
  }
});

test('watch page: without navigator.share, clicking Share copies the link to the clipboard and shows the transient "Copied!" label', async () => {
  const writes = [];
  const { fetchImpl } = makeWatchFetchStub(true);
  const { dom } = await loadWatchWithFetchStub(fetchImpl, (window) => {
    // jsdom has no navigator.share by default -- leave it absent; install a
    // recording clipboard.
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text) => {
          writes.push(text);
          return Promise.resolve();
        },
      },
    });
  });
  try {
    await settle();
    const shareBtn = dom.window.document.getElementById('share-media-btn');
    assert.ok(shareBtn, 'sanity: button mounted');
    assert.strictEqual(typeof dom.window.navigator.share, 'undefined', 'sanity: this test exercises the no-share-sheet path');

    shareBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await settle();

    assert.deepStrictEqual(writes, [WATCH_URL]);
    assert.strictEqual(shareBtn.textContent, 'Copied!', 'transient feedback after the clipboard write resolves');
  } finally {
    dom.window.close();
  }
});
