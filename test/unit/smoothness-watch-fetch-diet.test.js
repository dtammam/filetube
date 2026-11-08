'use strict';

// v1.406.0 W1 H (plan docs/exec-plans/active/2026-11-08-smoothness.md): the watch page keeps its two WHOLE-library list
// fetches (the related rail, the prev / next context) out of the video's first bytes - they start on the player's first
// 'playing', or after WATCH_LIST_DEFER_CAP_MS when it never plays (a refused autoplay), at once when it already plays - and
// it reads GET /api/settings ONCE per view (three readers shared it). The REAL watch view (watch-view-harness) with a real
// <video id="media-player"> in the slot (the persistent player mounts it there in the app).

const { test } = require('node:test');
const assert = require('node:assert');
const { watchViewRealm } = require('../helpers/watch-view-harness');

const FULL = '/api/videos?limit=1000000';
const fullListCalls = (r) => r.fetches.filter((f) => f.method === 'GET' && f.url.indexOf('limit=1000000') >= 0);

function withVideo(r, paused) {
  const v = r.doc.createElement('video');
  v.id = 'media-player';
  if (paused === false) Object.defineProperty(v, 'paused', { configurable: true, get: () => false });
  r.doc.getElementById('player-slot').appendChild(v);
  return v;
}

test('H: the two full-list fetches wait for the first playing; then both start', async () => {
  const r = watchViewRealm();
  try {
    const v = withVideo(r);
    r.init();
    await r.settle(30);
    assert.strictEqual(fullListCalls(r).length, 0, 'nothing heavy while the video starts');
    v.dispatchEvent(new r.w.Event('playing'));
    await r.settle(30);
    const calls = fullListCalls(r).map((f) => f.url);
    assert.ok(calls.includes(FULL), 'the related rail');
    assert.strictEqual(calls.length, 2, 'the rail and the prev / next context, once each');
    v.dispatchEvent(new r.w.Event('playing'));
    await r.settle(10);
    assert.strictEqual(fullListCalls(r).length, 2, 'a second playing starts nothing again');
  } finally { r.close(); }
});

test('H: a video that never plays still gets its rail and prev / next after the cap', async () => {
  const r = watchViewRealm();
  try {
    withVideo(r);
    r.init();
    await r.settle(30);
    assert.strictEqual(fullListCalls(r).length, 0);
    await new Promise((res) => setTimeout(res, 1600));
    await r.settle(10);
    assert.strictEqual(fullListCalls(r).length, 2, 'the cap released both');
  } finally { r.close(); }
});

test('H: already playing (an adopt) - both start at once; a view left before playing never fetches them', async () => {
  const r = watchViewRealm();
  try {
    withVideo(r, false);
    r.init();
    await r.settle(30);
    assert.strictEqual(fullListCalls(r).length, 2, 'no wait when the picture is already live');
  } finally { r.close(); }
  const r2 = watchViewRealm();
  try {
    const v = withVideo(r2);
    r2.init();
    await r2.settle(30);
    r2.destroy();
    v.dispatchEvent(new r2.w.Event('playing'));
    await new Promise((res) => setTimeout(res, 1600));
    assert.strictEqual(fullListCalls(r2).length, 0, 'aborted with the view');
  } finally { r2.close(); }
});

test('H: GET /api/settings once per watch view (the action bar flag, the autoplay toggle, the sort fallback share it)', async () => {
  const r = watchViewRealm({ settings: { autoplayNext: true, attributeControlEnabled: true } });
  try {
    const v = withVideo(r);
    try { r.w.localStorage.removeItem('filetube_sort'); } catch (_) { /* storage off */ }
    r.init();
    await r.settle(30);
    v.dispatchEvent(new r.w.Event('playing'));
    await r.settle(40);
    assert.strictEqual(r.calls('GET', '/api/settings').length, 1, 'one read');
    const check = r.doc.querySelector('#watch-autoplay-check');
    if (check) assert.strictEqual(check.checked, true, 'the autoplay toggle still reads its value');
  } finally { r.close(); }
});
