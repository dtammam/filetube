'use strict';

// [UNIT] C1 (v1.24 UX Round, Wave 3) -- client half of the move-files
// feature: `requestMoveItem` (the `POST /api/videos/:id/move` caller). The
// picker dialog (`showMoveModal`) is tested in overlays-dialogs-s9.test.js
// since sweep S9.

const { test } = require('node:test');
const assert = require('node:assert');
const { requestMoveItem } = require('../../public/js/common.js');

// Sweep S9 (AC12): showMoveModal is a ui.sheet dialog now; its DOM tests (the folder
// options, disabled with no folders, one onMove per tap, the busy guard refusing Cancel /
// Close / Esc / the scrim mid-request, reenable and retry, textContent, the fallback label,
// caller-owned teardown) moved to test/unit/overlays-dialogs-s9.test.js, in jsdom with the
// real ui.js.

// ---- requestMoveItem: the POST /api/videos/:id/move caller -----------------

function fakeFetchErr(status, body) {
  return () => Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) });
}

test('requestMoveItem: POSTs the correct URL/method/body and resolves with the parsed JSON on success', async () => {
  const calls = [];
  const fetchImpl = (url, opts) => {
    calls.push({ url, opts });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, id: 'newId' }) });
  };
  const result = await requestMoveItem('abc123', '/media/other', fetchImpl);
  assert.deepStrictEqual(result, { success: true, id: 'newId' });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, '/api/videos/abc123/move');
  assert.strictEqual(calls[0].opts.method, 'POST');
  assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { targetFolder: '/media/other' });
});

test('requestMoveItem: URL-encodes the id', async () => {
  const calls = [];
  const fetchImpl = (url) => { calls.push(url); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }); };
  await requestMoveItem('id with spaces/slash', '/media/other', fetchImpl);
  assert.strictEqual(calls[0], `/api/videos/${encodeURIComponent('id with spaces/slash')}/move`);
});

test('requestMoveItem: rejects with the server-provided error message on a non-2xx response', async () => {
  await assert.rejects(
    () => requestMoveItem('abc123', '/media/other', fakeFetchErr(400, { error: 'targetFolder is outside every configured/allowed library folder' })),
    /outside every configured/,
  );
});

test('requestMoveItem: rejects with a generic message when the server error body is malformed/empty', async () => {
  await assert.rejects(
    () => requestMoveItem('abc123', '/media/other', fakeFetchErr(500, {})),
    /Move failed \(500\)/,
  );
});

test('requestMoveItem: resolves on a plain 200 with no body edge case (never throws on an empty/malformed JSON body)', async () => {
  const fetchImpl = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('no body')) });
  const result = await requestMoveItem('abc123', '/media/other', fetchImpl);
  assert.deepStrictEqual(result, {});
});

test('requestMoveItem: rejects cleanly when fetch itself is unavailable (no global fetch, no injected fetchImpl)', async () => {
  // Node 22 provides a global `fetch` -- temporarily remove it so this test
  // exercises the "no fetch at all" branch deterministically, restoring it
  // afterward so no other test in this process is affected.
  const realFetch = global.fetch;
  delete global.fetch;
  try {
    await assert.rejects(() => requestMoveItem('abc123', '/media/other', null), /fetch is not available/);
  } finally {
    global.fetch = realFetch;
  }
});
