'use strict';

// [INTEGRATION] v1.96 Wave A A2 -- the watch action row reveals ONCE, in its
// final state, with NO partial->full pop-in. Boots the REAL watch.html +
// public/js under jsdom (same harness shape as watch-like-button.test.js) and
// drives the DOM-level contract by controlling the resolution ORDER of the two
// async inputs that decide the row's final button set:
//   - GET /api/videos/:id  -> the media record (Move/Like/.../Attribute source)
//   - GET /api/auth/me      -> the write capability (Move/Attribute are gated on
//                              it and mount from whichever resolves LAST)
//
// The row ships `data-loading` (shimmered, children visibility:hidden). It must
// stay set until BOTH inputs have settled, then drop exactly once. These tests
// are the BINDING for the reveal-once barrier -- deleting the media-side release
// leaves the row shimmering forever (Test: both-resolve), and revealing on the
// media record alone shows a partial row (Test: barrier waits on capability).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const WATCH_HTML_PATH = path.join(PUBLIC_DIR, 'watch.html');
const MEDIA_ID = 'reveal-item-1';

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

function mediaResponse() {
  return {
    id: MEDIA_ID,
    title: 'A Revealable Video',
    filePath: `/media/folder/${MEDIA_ID}.mp4`,
    folderName: 'folder',
    channelName: 'folder',
    type: 'video',
    ext: '.mp4',
    duration: 120,
    size: 5000,
    addedAt: 100000,
    liked: false,
  };
}

function meResponse(role) {
  return { user: { id: 'u1', username: 'dean', role } };
}

// A deferred promise we resolve from the test to script resolution order.
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// Build a fetch stub whose /api/videos and /api/auth/me resolutions are driven
// by the returned `mediaGate` / `authGate`. `mediaOk=false` makes the media
// fetch a 404 (the hydration catch path). Everything else that watch.js may
// touch resolves harmlessly or stays pending (irrelevant to the row reveal).
function makeStub({ mediaOk = true, authRole = 'admin' } = {}) {
  const mediaGate = deferred();
  const authGate = deferred();
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    if (url === '/api/config' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ folders: [], folderSettings: {}, syntheticFolders: [] }) });
    }
    if (url === `/api/videos/${MEDIA_ID}` && method === 'GET') {
      return mediaGate.promise.then(() => (mediaOk
        ? { ok: true, status: 200, json: async () => mediaResponse() }
        : { ok: false, status: 404, json: async () => ({ error: 'not found' }) }));
    }
    if (url === '/api/auth/me' && method === 'GET') {
      return authGate.promise.then(() => ({ ok: true, status: 200, json: async () => meResponse(authRole) }));
    }
    // view-ping, comments, subscriptions/health (reheat probe), related, etc. --
    // left pending so they never mount anything that could confound the row.
    return new Promise(() => {});
  };
  return { fetchImpl, mediaGate, authGate };
}

function loadWatch(fetchImpl) {
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
      window.matchMedia = (query) => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    },
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve({ dom }); } };
    dom.window.addEventListener('load', () => setTimeout(finish, 20));
    setTimeout(finish, 5000);
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(times) { for (let i = 0; i < (times || 12); i++) await flush(); }

function actionRow(dom) { return dom.window.document.querySelector('.watch-actions'); }
function isLoading(dom) { return actionRow(dom).hasAttribute('data-loading'); }
function moveBtn(dom) { return dom.window.document.getElementById('move-media-btn'); }

test('reveal-once: the row ships data-loading and stays hidden until BOTH media and capability settle', async () => {
  const { fetchImpl, mediaGate, authGate } = makeStub({ authRole: 'admin' });
  const { dom } = await loadWatch(fetchImpl);
  try {
    // Nothing resolved yet -> the row is still shimmering.
    await settle();
    assert.ok(isLoading(dom), 'row must ship shimmering (data-loading) before either input resolves');

    // Media resolves, capability STILL pending -> must NOT reveal (else Move,
    // which mounts from the later-resolving capability, would pop in post-reveal).
    mediaGate.resolve();
    await settle();
    assert.ok(isLoading(dom), 'row must stay hidden while the write capability is unresolved -- revealing here is the partial-row pop-in bug');

    // Capability (admin) resolves -> Move mounts AND the row reveals in one shot.
    authGate.resolve();
    await settle();
    assert.ok(!isLoading(dom), 'row must reveal once both inputs have settled');
    assert.ok(moveBtn(dom), 'admin capability -> Move is mounted at reveal time (no post-reveal pop-in)');
    assert.ok(dom.window.document.querySelector('.watch-action-btns').contains(moveBtn(dom)),
      'Move lives inside the button sub-group it was revealed with');
  } finally {
    dom.window.close();
  }
});

test('reveal-once: capability-first then media (admin) still reveals with Move present', async () => {
  const { fetchImpl, mediaGate, authGate } = makeStub({ authRole: 'admin' });
  const { dom } = await loadWatch(fetchImpl);
  try {
    // Capability resolves first -- Move can't mount yet (no mediaData), so the
    // row must stay hidden until the media record arrives.
    authGate.resolve();
    await settle();
    assert.ok(isLoading(dom), 'row must stay hidden while the media record is unresolved');
    assert.ok(!moveBtn(dom), 'Move cannot mount before mediaData exists');

    mediaGate.resolve();
    await settle();
    assert.ok(!isLoading(dom), 'row reveals once the media record settles too');
    assert.ok(moveBtn(dom), 'the media path mounts Move (capability already true) before the reveal');
  } finally {
    dom.window.close();
  }
});

test('reveal-once: a read-only user reveals a strictly-complete row (no Move, no shimmer)', async () => {
  const { fetchImpl, mediaGate, authGate } = makeStub({ authRole: 'member' });
  const { dom } = await loadWatch(fetchImpl);
  try {
    mediaGate.resolve();
    authGate.resolve();
    await settle();
    assert.ok(!isLoading(dom), 'row reveals for a read-only user too (capability settles false)');
    assert.ok(!moveBtn(dom), 'a read-only user never gets Move -- its absence is the FINAL state, not a pop-in');
    // The static buttons are present and part of the revealed row.
    assert.ok(dom.window.document.getElementById('download-media-btn'), 'the static Download button survives');
    assert.ok(dom.window.document.getElementById('delete-media-btn'), 'the static Delete button survives');
  } finally {
    dom.window.close();
  }
});

test('reveal-once: a failed media load (404) still reveals the row (the catch path)', async () => {
  const { fetchImpl, mediaGate, authGate } = makeStub({ mediaOk: false, authRole: 'admin' });
  const { dom } = await loadWatch(fetchImpl);
  try {
    mediaGate.resolve();
    authGate.resolve();
    await settle();
    assert.ok(!isLoading(dom), 'a failed record load must still reveal the row -- the static buttons must not stay invisible under the error box');
  } finally {
    dom.window.close();
  }
});
