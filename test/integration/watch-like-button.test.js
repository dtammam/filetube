'use strict';

// [INTEGRATION] v1.30 C2 (Visual polish cluster, T11) -- the watch-page
// "Like" toggle. Boots the REAL watch.html + public/js scripts under jsdom
// (mirrors test/integration/watch-fulllist-fetch.test.js's own
// `loadWatchWithFetchStub`-style harness, own copy here) with a scripted
// fetch stub, and asserts the DOM-level contract directly:
//
//   - the button reflects the INITIAL liked state read off
//     `GET /api/videos/:id`'s server-derived `liked` field (membership, not
//     a stored flag)
//   - clicking it toggles via `POST`/`DELETE /api/liked/:id` and re-renders
//     to the new state only after the request resolves
//
// Every other endpoint (comments/settings/subscriptions/view-ping/pins/...)
// is left on a permanently-unresolved Promise -- mirrors
// watch-fulllist-fetch.test.js's own "don't care about it" stubbing
// philosophy; this suite only asserts the Like button's own DOM signals.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const WATCH_HTML_PATH = path.join(PUBLIC_DIR, 'watch.html');

const MEDIA_ID = 'like-item-1';

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

function resolveResourcePath(pathname) {
  return path.join(PUBLIC_DIR, pathname);
}

function makeMediaResponse(liked) {
  return {
    id: MEDIA_ID,
    title: 'A Likeable Video',
    filePath: `/media/folder/${MEDIA_ID}.mp4`,
    folderName: 'folder',
    type: 'video',
    ext: '.mp4',
    duration: 120,
    size: 5000,
    addedAt: 100000,
    liked,
  };
}

// `initialLiked` seeds the GET /api/videos/:id response's `liked` field
// (the server-derived membership signal). Records every /api/liked/:id
// call (method + url) so tests can assert the toggle round-trip.
function makeWatchFetchStub(initialLiked) {
  const calls = [];
  let liked = initialLiked;
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    if (url === '/api/config' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ folders: [], folderSettings: {} }) });
    }
    if (url === `/api/videos/${MEDIA_ID}` && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => makeMediaResponse(liked) });
    }
    if (url === `/api/liked/${MEDIA_ID}` && (method === 'POST' || method === 'DELETE')) {
      calls.push({ url, method });
      liked = method === 'POST';
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, liked }) });
    }
    return new Promise(() => {}); // everything else -- irrelevant here
  };
  return { fetchImpl, calls };
}

function loadWatchWithFetchStub(fetchImpl) {
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

// v1.47.6: the Like button is now `<i class="icon-heart"> <span class="btn-label">`
// rather than a bare text node, so the phone breakpoint can hide the WORD and
// keep the glyph. These assertions therefore read the label span. The unicode
// heart is gone deliberately -- this repo's v1.38 lesson is "draw glyphs in CSS,
// never emoji codepoints" (iOS renders them inconsistently), and `.icon-heart`
// has existed since v1.40.
function likeLabel(btn) {
  const label = btn && btn.querySelector('.btn-label');
  return label ? label.textContent : null;
}

// The glyph must accompany the label, or hiding the label at phone widths would
// leave an EMPTY button -- the specific regression this shape exists to prevent.
function likeHasIcon(btn) {
  return Boolean(btn && btn.querySelector('i.icon-heart'));
}

test('watch page: the Like button reflects the initial NOT-liked membership state', async () => {
  const { fetchImpl } = makeWatchFetchStub(false);
  const { dom } = await loadWatchWithFetchStub(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const likeBtn = document.getElementById('like-media-btn');
    assert.ok(likeBtn, 'expected a #like-media-btn to be mounted');
    assert.ok(
      document.querySelector('.watch-action-btns').contains(likeBtn),
      'expected the Like button to live inside .watch-action-btns, alongside Download/Delete/Move'
    );
    assert.strictEqual(likeLabel(likeBtn), 'Like');
    assert.ok(likeHasIcon(likeBtn), 'the glyph must survive alongside the hideable label');
    assert.strictEqual(likeBtn.getAttribute('aria-pressed'), 'false');
    // v1.108 (Dean): the YouTube heart convention -- NOT-liked is the neutral
    // grey resting state (no `.liked`, and deliberately no `.btn-primary`: the
    // old red-as-actionable convention is REVERSED).
    assert.ok(!likeBtn.classList.contains('liked'), 'not-yet-liked must be the neutral/grey resting state');
    assert.ok(!likeBtn.classList.contains('btn-primary'), 'not-yet-liked is NO LONGER the primary/red CTA (convention reversed)');
  } finally {
    dom.window.close();
  }
});

test('watch page: the Like button reflects the initial ALREADY-liked membership state', async () => {
  const { fetchImpl } = makeWatchFetchStub(true);
  const { dom } = await loadWatchWithFetchStub(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const likeBtn = document.getElementById('like-media-btn');
    assert.ok(likeBtn, 'expected a #like-media-btn to be mounted');
    assert.strictEqual(likeLabel(likeBtn), 'Liked');
    assert.strictEqual(likeBtn.getAttribute('aria-pressed'), 'true');
    // v1.108: LIKED fills the heart red via the `.liked` class (mirrors
    // `.card-like-btn.liked`); never `.btn-primary`.
    assert.ok(likeBtn.classList.contains('liked'), 'already-liked must carry .liked (red heart)');
    assert.ok(!likeBtn.classList.contains('btn-primary'), 'liked state is red-via-.liked, never btn-primary');
  } finally {
    dom.window.close();
  }
});

test('watch page: clicking Like toggles via POST then DELETE /api/liked/:id, re-rendering only after each request resolves', async () => {
  const { fetchImpl, calls } = makeWatchFetchStub(false);
  const { dom } = await loadWatchWithFetchStub(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const likeBtn = document.getElementById('like-media-btn');
    assert.strictEqual(likeLabel(likeBtn), 'Like');
    assert.ok(likeHasIcon(likeBtn), 'the glyph must survive alongside the hideable label');

    likeBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await settle();

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], { url: `/api/liked/${MEDIA_ID}`, method: 'POST' });
    assert.strictEqual(likeLabel(likeBtn), 'Liked', 'expected the button to flip to liked AFTER the POST resolved');
    assert.strictEqual(likeBtn.getAttribute('aria-pressed'), 'true');
    assert.ok(likeBtn.classList.contains('liked'), 'liked after POST => .liked (red heart)');
    assert.ok(!likeBtn.classList.contains('btn-primary'));

    likeBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await settle();

    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(calls[1], { url: `/api/liked/${MEDIA_ID}`, method: 'DELETE' });
    assert.strictEqual(likeLabel(likeBtn), 'Like', 'expected the button to flip back to not-liked AFTER the DELETE resolved');
    assert.strictEqual(likeBtn.getAttribute('aria-pressed'), 'false');
    assert.ok(!likeBtn.classList.contains('liked'), 'un-liked after DELETE => no .liked (grey heart)');
    assert.ok(!likeBtn.classList.contains('btn-primary'));
  } finally {
    dom.window.close();
  }
});

// v1.108 gate SUGGESTION T1-S1: the JS toggles `.liked`, but the VISUAL half of
// the convention -- `.btn.liked` painting the heart red -- lived only in CSS
// with no lock, so a refactor could silently drop the red heart and leave every
// behavioural test green (the mirror `.card-like-btn.liked` IS locked in
// card-like.test.js). Bind it here. Delete the CSS rule and this goes red.
test('watch page: the .btn.liked CSS rule paints the liked heart red (source-lock)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(
    css,
    /\.btn\.liked\s*\{[^}]*color:\s*var\(--yt-red\)/,
    'liked watch button must tint the heart red via color: var(--yt-red)'
  );
});
