'use strict';

// [INTEGRATION] v1.96 Wave A A2 -- the watch action row reveals ONCE, in its
// final state, with NO partial->full pop-in. Boots the REAL watch.html +
// public/js under jsdom (same harness shape as watch-like-button.test.js) and
// drives the DOM-level contract by controlling the resolution ORDER of the two
// async inputs that decide the page's final action set:
//   - GET /api/videos/:id  -> the media record (which bar buttons exist: Share, Transcript)
//   - GET /api/auth/me      -> the write capability (UI pass S3: Move / Move to Trash /
//                              Attribute are More-menu entries gated on it; the barrier
//                              keeps it so the first More at reveal is already complete)
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
    // v1.202: the reveal barrier's THIRD input - the attribution opt-in. The
    // real server always answers; this suite is about the media/capability
    // race, so the flag answers at once (OFF).
    if (url === '/api/settings' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ attributeControlEnabled: false, transcriptAiPrompts: [] }) });
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
// UI pass sweep S3 (D4.9): Move is a More-menu entry (built from the live capability at each
// open) - "Move present at reveal" = the first More opened at reveal already offers it.
async function moveOffered(dom) {
  const d = dom.window.document;
  d.getElementById('more-actions-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  const labels = Array.from(d.querySelectorAll('.ui-sheet.is-open .ui-row')).map((r) => r.textContent.trim());
  const x = d.querySelector('.ui-sheet.is-open [aria-label="Close"]');
  if (x) x.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40));
  return labels.includes('Move to another folder');
}

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
    assert.ok(await moveOffered(dom), 'admin capability -> More offers Move at reveal time (no post-reveal change)');
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
    assert.strictEqual(dom.window.document.getElementById('more-actions-btn'), null, 'no bar buttons before mediaData exists');

    mediaGate.resolve();
    await settle();
    assert.ok(!isLoading(dom), 'row reveals once the media record settles too');
    assert.ok(await moveOffered(dom), 'More offers Move (capability already true) at the reveal');
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
    assert.ok(!(await moveOffered(dom)), 'a read-only user never gets Move -- its absence is the FINAL state');
    // the bar itself is complete: Like, Listen and More (the stub item has no link / captions)
    const ids = Array.from(dom.window.document.querySelectorAll('#watch-actions > .ui-btn')).map((b) => b.id);
    assert.deepStrictEqual(ids, ['like-media-btn', 'listen-media-btn', 'more-actions-btn']);
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
