'use strict';

// [INTEGRATION] T3/FR-D: `PATCH /api/subscriptions/:id` (edit an existing
// subscription's format/quality/maxVideos/paused without a delete+re-add) and
// the pause semantics wired into `runPoll` (a paused subscription is skipped
// by the scheduled/re-pull-all case, but a manual per-row re-pull still runs
// it). `run.runList`/`run.runDownload` are mocked -- no real yt-dlp binary or
// network is ever touched. Uses a fresh `express()` app per test, the same
// pattern as ytdlp-repull-endpoints.test.js.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const store = require('../../lib/ytdlp/store');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-patch-'));
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  ytdlp.resetPollRerunStateForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFakeDeps(initialDb = {}) {
  let db = initialDb;
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
  };
}

function enabledConfig(overrides = {}) {
  return ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir,
    ...overrides,
  });
}

async function startTestApp(deps, config) {
  const app = express();
  app.use(express.json());
  ytdlp.registerRoutes(app, deps, config);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function patchJson(base, urlPath, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---- AC21: PATCH edits fields, preserves addedAt/lastCheckedAt/lastStatus --

test('PATCH /api/subscriptions/:id changes format/quality/maxVideos without a delete+re-add, preserving addedAt/id/channelUrl/name', async () => {
  const deps = makeFakeDeps();
  const created = await store.addSubscription(deps, {
    channelUrl: 'https://www.youtube.com/@editme',
    format: 'video',
    quality: 'best',
  });
  await store.setSubscriptionStatus(deps, created.id, { lastCheckedAt: '2026-01-01T00:00:00.000Z', lastStatus: 'ok: downloaded 1 new video(s)' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await patchJson(base, `/api/subscriptions/${created.id}`, { format: 'audio', quality: '720p', maxVideos: 10 });
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.format, 'audio');
    assert.equal(updated.quality, '720p');
    assert.equal(updated.maxVideos, 10);
    assert.equal(updated.id, created.id);
    assert.equal(updated.channelUrl, created.channelUrl);
    assert.equal(updated.name, created.name);
    assert.equal(updated.addedAt, created.addedAt);
    assert.equal(updated.lastCheckedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(updated.lastStatus, 'ok: downloaded 1 new video(s)');
  } finally {
    await close();
  }
});

// v1.21.0 FR-1/FR-3 (T3), AC2: regression-locks the already-correct
// server-side PATCH -> GET round-trip for `maxVideos`, INCLUDING the `0`
// "unlimited" sentinel -- the pre-v1.21 bug (a client render-timing race,
// see the settings-sheet/poll fix in lib/ytdlp/client/subscriptions.js) was
// never a server-side validation/persistence problem, so this proves the
// server path this round's UI rearchitect builds on top of stays correct.
test('PATCH /api/subscriptions/:id -> GET /api/subscriptions round-trips maxVideos, including 0 (unlimited)', async () => {
  const deps = makeFakeDeps();
  const created = await store.addSubscription(deps, {
    channelUrl: 'https://www.youtube.com/@maxvideosroundtrip',
    format: 'video',
    maxVideos: 3,
  });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    // 3 -> 2 (a normal, finite value -- the exact edit Dean's on-device AC3
    // scenario exercises via the new settings sheet).
    const toTwo = await patchJson(base, `/api/subscriptions/${created.id}`, { maxVideos: 2 });
    assert.equal(toTwo.status, 200);
    assert.equal((await toTwo.json()).maxVideos, 2);
    const afterTwo = await fetch(`${base}/api/subscriptions`);
    assert.equal((await afterTwo.json())[0].maxVideos, 2);

    // 2 -> 0 (the "unlimited" sentinel -- must be preserved as the literal
    // number 0, never dropped/treated as falsy-therefore-unset).
    const toZero = await patchJson(base, `/api/subscriptions/${created.id}`, { maxVideos: 0 });
    assert.equal(toZero.status, 200);
    assert.equal((await toZero.json()).maxVideos, 0);
    const afterZero = await fetch(`${base}/api/subscriptions`);
    const [listedAfterZero] = await afterZero.json();
    assert.equal(listedAfterZero.maxVideos, 0, 'maxVideos:0 (unlimited) must round-trip as 0, not be lost/treated as unset');
  } finally {
    await close();
  }
});

test('PATCH /api/subscriptions/:id toggles paused independent of other fields', async () => {
  const deps = makeFakeDeps();
  const created = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@pauseme', format: 'video' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const pauseRes = await patchJson(base, `/api/subscriptions/${created.id}`, { paused: true });
    assert.equal(pauseRes.status, 200);
    assert.equal((await pauseRes.json()).paused, true);

    const listRes = await fetch(`${base}/api/subscriptions`);
    const [listed] = await listRes.json();
    assert.equal(listed.paused, true);
  } finally {
    await close();
  }
});

// ---- v1.15.0 item 4: PATCH round-trips skipShorts (AC4.3) ------------------

test('PATCH /api/subscriptions/:id round-trips skipShorts: set true -> read back true; set false -> read back false', async () => {
  const deps = makeFakeDeps();
  const created = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@skipshorts', format: 'video' });
  assert.equal(created.skipShorts, false, 'default is false (download everything)');

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const onRes = await patchJson(base, `/api/subscriptions/${created.id}`, { skipShorts: true });
    assert.equal(onRes.status, 200);
    assert.equal((await onRes.json()).skipShorts, true);

    const listAfterOn = await fetch(`${base}/api/subscriptions`);
    assert.equal((await listAfterOn.json())[0].skipShorts, true);

    const offRes = await patchJson(base, `/api/subscriptions/${created.id}`, { skipShorts: false });
    assert.equal(offRes.status, 200);
    assert.equal((await offRes.json()).skipShorts, false);

    const listAfterOff = await fetch(`${base}/api/subscriptions`);
    assert.equal((await listAfterOff.json())[0].skipShorts, false);
  } finally {
    await close();
  }
});

test('PATCH /api/subscriptions/:id with a non-boolean skipShorts responds 400 and leaves the record unchanged', async () => {
  const deps = makeFakeDeps();
  const created = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@skipshortsbad', format: 'video' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await patchJson(base, `/api/subscriptions/${created.id}`, { skipShorts: 'yes-please' });
    assert.equal(res.status, 400);

    const listRes = await fetch(`${base}/api/subscriptions`);
    const [listed] = await listRes.json();
    assert.equal(listed.skipShorts, false, 'the rejected patch must not have written anything');
  } finally {
    await close();
  }
});

// ---- AC24: PATCH on an unknown id -> 404 -----------------------------------

test('PATCH /api/subscriptions/:id with an unknown id responds 404', async () => {
  const deps = makeFakeDeps();
  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await patchJson(base, '/api/subscriptions/no-such-id', { paused: true });
    assert.equal(res.status, 404);
    assert.ok((await res.json()).error);
  } finally {
    await close();
  }
});

// ---- 400 on an invalid patch body ------------------------------------------

test('PATCH /api/subscriptions/:id with an invalid body responds 400 (bad format/maxVideos/paused)', async () => {
  const deps = makeFakeDeps();
  const created = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@badpatch', format: 'video' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const badFormat = await patchJson(base, `/api/subscriptions/${created.id}`, { format: 'gif' });
    assert.equal(badFormat.status, 400);

    const badMaxVideos = await patchJson(base, `/api/subscriptions/${created.id}`, { maxVideos: -5 });
    assert.equal(badMaxVideos.status, 400);

    const badPaused = await patchJson(base, `/api/subscriptions/${created.id}`, { paused: 'yes-please' });
    assert.equal(badPaused.status, 400);

    // The record must be unchanged after every rejected patch.
    const listRes = await fetch(`${base}/api/subscriptions`);
    const [listed] = await listRes.json();
    assert.equal(listed.format, 'video');
    assert.equal(listed.maxVideos, undefined);
    assert.equal(listed.paused, false);
  } finally {
    await close();
  }
});

// ---- v1.13.0 item 4: PATCH accepts/validates filetype ----------------------

test('PATCH /api/subscriptions/:id accepts a valid filetype patch', async () => {
  const deps = makeFakeDeps();
  const created = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@ftypepatch', format: 'video' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await patchJson(base, `/api/subscriptions/${created.id}`, { filetype: 'webm' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).filetype, 'webm');
  } finally {
    await close();
  }
});

test('PATCH /api/subscriptions/:id with a hostile filetype value responds 400 (coarse boundary reject)', async () => {
  const deps = makeFakeDeps();
  const created = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@ftypehostile', format: 'video' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await patchJson(base, `/api/subscriptions/${created.id}`, { filetype: 'mp4; rm -rf /' });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);

    const listRes = await fetch(`${base}/api/subscriptions`);
    const [listed] = await listRes.json();
    assert.equal(listed.filetype, undefined, 'the rejected patch must not have written anything');
  } finally {
    await close();
  }
});

// ---- AC22/23: pause skips the scheduled/re-pull-all case, unpause resumes --

test('a paused subscription is skipped by runPoll(deps, config) with no subId (the scheduled/re-pull-all case)', async () => {
  const deps = makeFakeDeps();
  const active = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@active', format: 'video' });
  const paused = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@paused', format: 'video', paused: true });

  const polled = [];
  run.runList = async (sub) => {
    polled.push(sub.id);
    return { ok: true, stdout: '', stderr: '' };
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const result = await ytdlp.runPoll(deps, enabledConfig());
  assert.equal(result.started, true);
  assert.equal(result.count, 1, 'only the non-paused subscription should be counted/targeted');
  assert.deepEqual(polled, [active.id]);
  assert.ok(!polled.includes(paused.id), 'a paused subscription must never be polled by the all-subscriptions case');
});

test('unpausing (paused: false) resumes normal inclusion in the poll loop on the next cycle', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@resumeme', format: 'video', paused: true });

  const polled = [];
  run.runList = async (s) => {
    polled.push(s.id);
    return { ok: true, stdout: '', stderr: '' };
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const firstPoll = await ytdlp.runPoll(deps, enabledConfig());
  assert.equal(firstPoll.count, 0, 'paused subscription must be excluded initially');
  assert.deepEqual(polled, []);

  await store.updateSubscription(deps, sub.id, { paused: false });

  const secondPoll = await ytdlp.runPoll(deps, enabledConfig());
  assert.equal(secondPoll.count, 1);
  assert.deepEqual(polled, [sub.id], 'once unpaused, the subscription must be polled on the next cycle');
});

// ---- Manual per-row re-pull of a PAUSED subscription is still allowed ------

test('a manual per-row re-pull (POST /api/subscriptions/:id/repull) of a PAUSED subscription still runs it (no 409)', async () => {
  const deps = makeFakeDeps();
  const paused = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@pausedmanual', format: 'video', paused: true });

  const polled = [];
  run.runList = async (s) => {
    polled.push(s.id);
    return { ok: true, stdout: '', stderr: '' };
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/${paused.id}/repull`, { method: 'POST' });
    assert.equal(res.status, 202, 'a manual re-pull of a paused subscription must never 409 -- pause governs only the automatic loop');

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(polled, [paused.id], 'the paused subscription must actually have been polled by the manual per-row trigger');
  } finally {
    await close();
  }
});

test('a general re-pull-all (POST /api/subscriptions/repull) still skips a paused subscription (AC22)', async () => {
  const deps = makeFakeDeps();
  const active = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@activeall', format: 'video' });
  const paused = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@pausedall', format: 'video', paused: true });

  const polled = [];
  run.runList = async (s) => {
    polled.push(s.id);
    return { ok: true, stdout: '', stderr: '' };
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/repull`, { method: 'POST' });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(polled, [active.id]);
    assert.ok(!polled.includes(paused.id));
  } finally {
    await close();
  }
});
