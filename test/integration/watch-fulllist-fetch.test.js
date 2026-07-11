'use strict';

// [INTEGRATION] v1.30.0 T7 (v1.30 Scale Performance + Polish Wave, A5) --
// watch.js's `loadRelatedFiles()` and `setupPrevNext()` both fetch
// `GET /api/videos` to compute their own ordering (fuzzy-similarity ranking,
// and the home sort order, respectively). T6 made that endpoint paginated
// (`{ items, total, offset, limit }`, default page size 60) -- both callers
// MUST now (a) read `response.items` (not treat the response object itself
// as the array) AND (b) request the FULL matching set, or a library/folder
// over 60 items would silently break related ranking / prev-next for any
// item whose neighbor sits past the truncated first page.
//
// This suite proves BOTH halves BEHAVIORALLY, not just "a big `limit` param
// was sent": the current item's true best-match / folder neighbor is
// deliberately placed at position 65 (past the 60-item page boundary) in a
// scripted 70-item fixture. If either caller only asked for (or only used)
// page 1, that item would be invisible to it and this suite's assertions on
// the RENDERED DOM (the related card list / prev-next button state) would
// fail.
//
// HARNESS: mirrors test/integration/rescan-scan-poll.test.js's exact
// `loadIndexWithFetchStub`-style loading shape (own copy, watch.html this
// time), scripting just the endpoints this suite cares about
// (/api/config, /api/videos/:id, and the two /api/videos list requests) and
// leaving everything else (comments/autoplay-toggle/subscribe-probe/view-
// ping/subscriptions-pins, and the persistent player controller's own
// internal fetches) on a permanently-unresolved Promise -- mirrors shell-
// smoke.test.js's own "don't care about it" stubbing philosophy. This suite
// does NOT assert a zero-window-errors bar (unlike shell-smoke.test.js) --
// player.js's live playback-engine side effects are documented elsewhere
// (test/unit/player-loop-toggle.test.js's header comment) as this repo's
// deliberate no-jsdom-harness boundary; this suite only asserts the two
// watch.js-owned DOM signals it actually cares about.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const WATCH_HTML_PATH = path.join(PUBLIC_DIR, 'watch.html');

const MEDIA_ID = 'item-65';
const FOLDER = '/media/folder';
const TOTAL_LIBRARY_SIZE = 70; // > 60 -- the whole point: page 1 alone must not be enough

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

function resolveResourcePath(pathname) {
  return path.join(PUBLIC_DIR, pathname);
}

// The "current" item being watched -- deliberately carries a rare,
// distinctive title token ("zephyrfoobar") shared with exactly ONE other
// library item (see makeFolderList/makeRelatedPool below), and sits at
// folder-position 65 (0-indexed) of a 70-item, `newest`-sorted folder --
// past the 60-item page-1 boundary either way.
const mediaResponse = {
  id: MEDIA_ID,
  title: 'Zephyrfoobar Live at the Grotto',
  filePath: `${FOLDER}/${MEDIA_ID}.mp4`,
  folderName: 'folder',
  type: 'video',
  ext: '.mp4',
  duration: 300,
  size: 5000,
  addedAt: 100000 - 65,
};

// Folder listing for setupPrevNext's `?root=<FOLDER>` fetch: 70 items,
// `newest` order (addedAt descending) == index order, INCLUDING the current
// item itself at position 65 -- its true prev/next neighbors (item-64/
// item-66) are only discoverable if the full 70-item set is fetched.
function makeFolderList() {
  const list = [];
  for (let i = 0; i < TOTAL_LIBRARY_SIZE; i++) {
    if (i === 65) {
      list.push({ ...mediaResponse });
      continue;
    }
    list.push({
      id: `item-${i}`,
      title: `Video ${i}`,
      filePath: `${FOLDER}/item-${i}.mp4`,
      folderName: 'folder',
      type: 'video',
      ext: '.mp4',
      duration: 120,
      size: 1000 + i,
      addedAt: 100000 - i,
    });
  }
  return list;
}

// Library-wide pool for loadRelatedFiles' UNSCOPED fetch: 70 generic items
// plus exactly ONE genuinely similar item ("Zephyrfoobar Highlights") at
// position 65 -- rankRelated's token-overlap scoring should surface it FIRST
// (ahead of the plain most-recent fallback ordering) only if it's actually
// present in the candidate set fetched.
function makeRelatedPool() {
  const list = [];
  for (let i = 0; i < TOTAL_LIBRARY_SIZE; i++) {
    if (i === 65) {
      list.push({
        id: 'related-match',
        title: 'Zephyrfoobar Highlights',
        filePath: `${FOLDER}/related-match.mp4`,
        folderName: 'other-folder',
        type: 'video',
        ext: '.mp4',
        duration: 90,
        size: 900,
        addedAt: 100000 - 65,
      });
      continue;
    }
    list.push({
      id: `pool-${i}`,
      title: `Unrelated clip ${i}`,
      filePath: `${FOLDER}/pool-${i}.mp4`,
      folderName: 'other-folder',
      type: 'video',
      ext: '.mp4',
      duration: 60,
      size: 500 + i,
      addedAt: 100000 - i,
    });
  }
  return list;
}

function makeWatchFetchStub() {
  const calls = [];
  const folderList = makeFolderList();
  const relatedPool = makeRelatedPool();
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    calls.push({ url, method });
    if (url === '/api/config' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ folders: [FOLDER], folderSettings: {} }) });
    }
    if (url === `/api/videos/${MEDIA_ID}` && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => mediaResponse });
    }
    if (url.indexOf('/api/videos?root=') === 0 && method === 'GET') {
      const total = folderList.length;
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ items: folderList, total, offset: 0, limit: total }),
      });
    }
    if (url.indexOf('/api/videos?limit=') === 0 && method === 'GET') {
      const total = relatedPool.length;
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ items: relatedPool, total, offset: 0, limit: total }),
      });
    }
    return new Promise(() => {}); // everything else (comments/settings/subscriptions/view-ping/...) -- irrelevant here
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

test('watch page: loadRelatedFiles + setupPrevNext request the FULL list (>60) and correctly use an item past position 60', async () => {
  const { fetchImpl, calls } = makeWatchFetchStub();
  const { dom } = await loadWatchWithFetchStub(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;

    // ---- both callers must have requested the FULL set, not a 60-item page ----
    const relatedCall = calls.find((c) => c.url.indexOf('/api/videos?limit=') === 0);
    assert.ok(relatedCall, 'expected loadRelatedFiles() to have fetched /api/videos?limit=...');
    const relatedLimit = parseInt(new URL(relatedCall.url, 'http://localhost').searchParams.get('limit'), 10);
    assert.ok(relatedLimit > 60, `expected loadRelatedFiles()'s requested limit (${relatedLimit}) to exceed the 60-item default page size`);

    const prevNextCall = calls.find((c) => c.url.indexOf('/api/videos?root=') === 0);
    assert.ok(prevNextCall, 'expected setupPrevNext() to have fetched /api/videos?root=...&limit=...');
    const prevNextLimit = parseInt(new URL(prevNextCall.url, 'http://localhost').searchParams.get('limit'), 10);
    assert.ok(prevNextLimit > 60, `expected setupPrevNext()'s requested limit (${prevNextLimit}) to exceed the 60-item default page size`);

    // ---- setupPrevNext: the current item (folder-position 65) must have
    // BOTH neighbors resolved -- impossible unless the full 70-item folder
    // listing was actually used (a 60-item page wouldn't even contain
    // position 65, so computeNeighbors couldn't find the current item at
    // all, and BOTH buttons would stay disabled). ----
    const prevBtn = document.getElementById('watch-prev-btn');
    const nextBtn = document.getElementById('watch-next-btn');
    assert.ok(prevBtn && nextBtn, 'expected the prev/next buttons to exist');
    assert.strictEqual(prevBtn.disabled, false, 'expected Prev to be enabled -- only possible if the FULL folder list (past position 60) was used');
    assert.strictEqual(nextBtn.disabled, false, 'expected Next to be enabled -- only possible if the FULL folder list (past position 60) was used');

    // ---- loadRelatedFiles: the one genuinely similar item ("Zephyrfoobar
    // Highlights", pool-position 65) must appear, and RANKED FIRST (ahead of
    // the plain most-recent fallback ordering) -- impossible unless the full
    // 70-item pool was fetched. ----
    const relatedContainer = document.getElementById('related-files-container');
    assert.ok(relatedContainer, 'expected the related-files container to exist');
    const firstTitle = relatedContainer.querySelector('.related-title');
    assert.ok(firstTitle, 'expected at least one related card to have rendered');
    assert.strictEqual(
      firstTitle.textContent.trim(), 'Zephyrfoobar Highlights',
      'expected the token-matched item (only present past position 60) to rank FIRST among related videos'
    );
  } finally {
    dom.window.close();
  }
});
