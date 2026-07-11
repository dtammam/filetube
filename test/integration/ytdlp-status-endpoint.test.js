'use strict';

// [INTEGRATION] T3/FR-E: `GET /api/subscriptions/status` -- the dedicated
// polling endpoint the `/subscriptions` UI hits every ~2.5s, returning
// `activity.getSnapshot()` verbatim. `run.runList`/`run.runDownload` are
// mocked -- no real yt-dlp binary or network is ever touched.

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
const activity = require('../../lib/ytdlp/activity');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-status-'));
  activity.resetForTests();
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  ytdlp.resetPollRerunStateForTests();
  activity.resetForTests();
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

// ---- AC28/30: reflects an in-flight download's state, distinct from -------
// lastStatus, and terminal states are exposed too -----------------------------

test('GET /api/subscriptions/status reflects an in-flight download live (state/title/index/total/percent), distinct from lastStatus', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@livestatus', format: 'video' });

  let resolveDownload;
  run.runList = async () => ({
    ok: true,
    stdout: JSON.stringify({ id: 'vid1', extractor_key: 'Youtube', availability: 'public' }),
    stderr: '',
  });
  run.runDownload = (subArg, config, targetIds, opts) => new Promise((resolve) => {
    // Simulate a real yt-dlp progress patch arriving mid-download.
    opts.onProgress({ state: 'downloading', percent: 42.5, title: 'Some Title' });
    resolveDownload = () => resolve({ ok: true, code: 0, stdout: '', stderr: '' });
  });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const pollPromise = ytdlp.runPoll(deps, enabledConfig());
    // Give the poll a moment to reach the in-flight downloading state.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const midRes = await fetch(`${base}/api/subscriptions/status`);
    assert.equal(midRes.status, 200);
    const midSnap = await midRes.json();
    assert.equal(midSnap.subscriptions[sub.id].state, 'downloading');
    assert.equal(midSnap.subscriptions[sub.id].percent, 42.5);
    assert.equal(midSnap.subscriptions[sub.id].title, 'Some Title');

    // The persisted lastStatus (terminal-summary, distinct field) is still
    // null at this point -- the poll hasn't finished yet.
    const listMid = await (await fetch(`${base}/api/subscriptions`)).json();
    assert.equal(listMid[0].lastStatus, null, 'the durable lastStatus must remain untouched mid-poll (a distinct field from the live status, AC28)');

    resolveDownload();
    await pollPromise;

    const doneRes = await fetch(`${base}/api/subscriptions/status`);
    const doneSnap = await doneRes.json();
    assert.equal(doneSnap.subscriptions[sub.id].state, 'done', 'terminal state must be reflected once the poll cycle completes (AC30)');
  } finally {
    await close();
  }
});

// ---- AC31/NFR3: no cookies path leakage in the status snapshot ------------

test('GET /api/subscriptions/status never surfaces a cookies path, even for an error entry', async () => {
  const cookiesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(cookiesDir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');
  const deps = makeFakeDeps();
  const config = enabledConfig({ FILETUBE_YTDLP_COOKIES_FILE: cookiesFile });
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@cookieleak', format: 'video' });

  run.runList = async () => ({
    ok: false,
    code: 1,
    stdout: '',
    stderr: '',
    error: `Command failed: yt-dlp --cookies ${cookiesFile} -- https://www.youtube.com/@cookieleak`,
  });

  const { base, close } = await startTestApp(deps, config);
  try {
    await ytdlp.runPoll(deps, config);
    const res = await fetch(`${base}/api/subscriptions/status`);
    const snap = await res.json();
    assert.ok(!JSON.stringify(snap).includes(cookiesFile), `cookies path leaked into the status snapshot: ${JSON.stringify(snap)}`);
  } finally {
    fs.rmSync(cookiesDir, { recursive: true, force: true });
    await close();
  }
});

// ---- FIX-6 (two-reviewer gate): a delete mid-download must not be ---------
// resurrected by the in-flight cycle's own terminal write once it finishes --

test('FIX-6 regression: deleting a subscription MID-DOWNLOAD -- once the download finishes, the status snapshot still does not contain the deleted subscription', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@deletemidflight', format: 'video' });

  let resolveDownload;
  run.runList = async () => ({
    ok: true,
    stdout: JSON.stringify({ id: 'vid1', extractor_key: 'Youtube', availability: 'public' }),
    stderr: '',
  });
  run.runDownload = () => new Promise((resolve) => {
    resolveDownload = () => resolve({ ok: true, code: 0, stdout: '', stderr: '' });
  });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const pollPromise = ytdlp.runPoll(deps, enabledConfig());
    // Give the poll a moment to reach the in-flight downloading state --
    // this captured `sub` object keeps running the cycle even after the
    // DELETE below removes its subscription row.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const midSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.ok(midSnap.subscriptions[sub.id], 'sanity: the subscription must be live/in-flight before the delete');

    // Delete the subscription WHILE its download is still in flight.
    const delRes = await fetch(`${base}/api/subscriptions/${sub.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    const rightAfterDeleteSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(rightAfterDeleteSnap.subscriptions[sub.id], undefined, 'the entry must be gone immediately after delete');

    // Now let the in-flight download actually finish -- pre-fix, the
    // orchestrator's own terminal `activity.setSubscription(sub.id, {state:
    // 'done', ...})` call would silently RE-CREATE a permanent, stale entry
    // for an id that no longer has a subscription row.
    resolveDownload();
    await pollPromise;

    const afterFinishSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(afterFinishSnap.subscriptions[sub.id], undefined, 'FIX-6: the deleted subscription must NOT be resurrected by the in-flight cycle\'s own terminal write once the download finishes');
  } finally {
    await close();
  }
});

// ---- QW1 (fast-follow): a NON-TERMINAL onProgress patch arriving after a --
// mid-download delete must not resurrect the subscription either -- FIX-6
// only guarded the cycle's own terminal write; QW1 closes the same window
// for every in-flight progress patch.

test('QW1 regression: a progress patch arriving AFTER a subscription is deleted mid-download does not resurrect it in the status snapshot', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@deletemidprogress', format: 'video' });

  let resolveDownload;
  let capturedOnProgress;
  run.runList = async () => ({
    ok: true,
    stdout: JSON.stringify({ id: 'vid1', extractor_key: 'Youtube', availability: 'public' }),
    stderr: '',
  });
  run.runDownload = (subArg, config, targetIds, opts) => {
    capturedOnProgress = opts.onProgress;
    return new Promise((resolve) => {
      resolveDownload = () => resolve({ ok: true, code: 0, stdout: '', stderr: '' });
    });
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const pollPromise = ytdlp.runPoll(deps, enabledConfig());
    // Give the poll a moment to reach the in-flight downloading state and
    // capture the cycle's onProgress callback.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const midSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.ok(midSnap.subscriptions[sub.id], 'sanity: the subscription must be live/in-flight before the delete');

    // Delete the subscription WHILE its download is still in flight.
    const delRes = await fetch(`${base}/api/subscriptions/${sub.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    const rightAfterDeleteSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(rightAfterDeleteSnap.subscriptions[sub.id], undefined, 'the entry must be gone immediately after delete');

    // A yt-dlp progress line arrives AFTER the delete but BEFORE the cycle's
    // own terminal write -- pre-fix, the unguarded `onProgress` callback
    // would have called `activity.setSubscription(sub.id, ...)` directly and
    // briefly re-created the deleted id's live entry.
    capturedOnProgress({ state: 'downloading', percent: 55, title: 'Late Progress' });

    const afterProgressSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(afterProgressSnap.subscriptions[sub.id], undefined, 'QW1: a non-terminal onProgress patch must NOT resurrect a deleted subscription');

    // Let the in-flight download finish (its own terminal write is already
    // guarded by FIX-6) and re-confirm the entry stays gone.
    resolveDownload();
    await pollPromise;

    const afterFinishSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(afterFinishSnap.subscriptions[sub.id], undefined, 'the deleted subscription must remain absent once the download finishes');
  } finally {
    await close();
  }
});

// ---- clearSubscription: a deleted subscription drops out of the snapshot --

test('deleting a subscription clears its live entry from the status snapshot', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@deleteme', format: 'video' });
  activity.setSubscription(sub.id, { state: 'downloading', percent: 10 });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const before = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.ok(before.subscriptions[sub.id]);

    const delRes = await fetch(`${base}/api/subscriptions/${sub.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    const after = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(after.subscriptions[sub.id], undefined, 'a deleted subscription must never reappear in the live status snapshot');
  } finally {
    await close();
  }
});

// ---- an empty snapshot when nothing is happening ---------------------------

test('GET /api/subscriptions/status returns empty namespaces when nothing has run yet', async () => {
  const deps = makeFakeDeps();
  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/subscriptions/status`);
    assert.equal(res.status, 200);
    // v1.31 P2/P6: `breaker` (null when never tripped) and `ytdlpVersion`
    // (null until the cache's first probe resolves) are additive fields
    // present on every snapshot.
    assert.deepEqual(await res.json(), { subscriptions: {}, oneShots: {}, breaker: null, ytdlpVersion: null });
  } finally {
    await close();
  }
});

// v1.24.8 (T2): the status snapshot carries each subscription's channel `name`
// so the download status chip can label every row (incl. queued ones) by
// channel instead of the generic "Subscription download". Additive/display-only.
test('v1.24.8: GET /api/subscriptions/status includes the channel `name` on each subscription entry', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@namedchannel', format: 'video', name: 'Named Channel' });
  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const snap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    const entry = snap.subscriptions[sub.id];
    assert.ok(entry, 'the subscription should appear in the status snapshot even with no live activity');
    assert.equal(entry.name, 'Named Channel', 'the status entry must carry the channel name for the chip label');
  } finally {
    await close();
  }
});

// ---- v1.24.0 A2 (T14): per-item download-failure attribution end-to-end ---
// (runSubscriptionCycle -> activity.setSubscription -> GET /api/subscriptions/
// status, returned verbatim, no route change) --------------------------------

test('A2: a per-item attributed failure is surfaced in the status snapshot as {videoId, title, reason}, enriched with the video title from the SAME list pass', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@a2attrib', format: 'video' });

  run.runList = async () => ({
    ok: true,
    stdout: JSON.stringify({ id: 'survivor1', extractor_key: 'Youtube', availability: 'public', title: 'A Cool Video Title' }),
    stderr: '',
  });
  run.runDownload = async () => ({
    ok: false,
    code: 1,
    stdout: '',
    stderr: '',
    error: 'yt-dlp exited with code 1',
    itemFailures: [{ videoId: 'survivor1', reason: 'Video unavailable' }],
  });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await ytdlp.runPoll(deps, enabledConfig());
    const snap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    const entry = snap.subscriptions[sub.id];
    assert.equal(entry.state, 'error');
    assert.deepEqual(entry.failures, [
      { videoId: 'survivor1', title: 'A Cool Video Title', reason: 'Video unavailable' },
    ]);
  } finally {
    await close();
  }
});

test('A2: an unattributed failure (videoId: null) is still surfaced in the status snapshot -- never silently dropped', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@a2unattrib', format: 'video' });

  run.runList = async () => ({
    ok: true,
    stdout: JSON.stringify({ id: 'survivor1', extractor_key: 'Youtube', availability: 'public', title: 'Survivor Title' }),
    stderr: '',
  });
  run.runDownload = async () => ({
    ok: false,
    code: 1,
    stdout: '',
    stderr: '',
    error: 'yt-dlp exited with code 1',
    itemFailures: [{ videoId: null, reason: 'An unattributable error line' }],
  });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await ytdlp.runPoll(deps, enabledConfig());
    const snap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    const entry = snap.subscriptions[sub.id];
    assert.deepEqual(entry.failures, [{ videoId: null, reason: 'An unattributable error line' }]);
  } finally {
    await close();
  }
});

test('A2: a successful download cycle never carries a `failures` field at all -- backward-compatible with pre-A2 consumers', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@a2success', format: 'video' });

  run.runList = async () => ({
    ok: true,
    stdout: JSON.stringify({ id: 'survivor1', extractor_key: 'Youtube', availability: 'public', title: 'Fine Video' }),
    stderr: '',
  });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [], itemFailures: [] });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await ytdlp.runPoll(deps, enabledConfig());
    const snap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    const entry = snap.subscriptions[sub.id];
    assert.equal(entry.state, 'done');
    assert.equal('failures' in entry, false, 'a successful cycle must never introduce a failures field at all');
  } finally {
    await close();
  }
});

// FIX-3 (two-reviewer gate, post-release, REVISES this test's original A2
// expectation): the `failures` field is now ALWAYS present on an error
// settle (an empty array when nothing was attributable), never omitted --
// see the FIX-3 regression test below for exactly why (a stale failures[]
// from a PRIOR error cycle must be clearable by a later, unattributed one).
test('A2/FIX-3: a download failure with no per-item itemFailures at all (e.g. a pre-A2-shaped mocked result) still produces the SAME aggregate error, with an EMPTY failures field, no crash', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@a2legacy', format: 'video' });

  run.runList = async () => ({
    ok: true,
    stdout: JSON.stringify({ id: 'survivor1', extractor_key: 'Youtube', availability: 'public' }),
    stderr: '',
  });
  // No `itemFailures` key at all -- mirrors a caller/mock that predates A2.
  run.runDownload = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: 'yt-dlp exited with code 1' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await ytdlp.runPoll(deps, enabledConfig());
    const snap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    const entry = snap.subscriptions[sub.id];
    assert.equal(entry.state, 'error');
    assert.deepEqual(entry.failures, [], 'failures must be present as an empty array, not omitted, on an error settle');
  } finally {
    await close();
  }
});

// ---- FIX-3 (two-reviewer gate, post-release): stale per-item failures ------
// across error -> error cycles -------------------------------------------------
//
// `runSubscriptionCycle`'s download-error branch used to spread `failures`
// in ONLY when non-empty, and `activity.mergeEntry` shallow-merges (never
// clears a field on its own) -- so a SECOND error cycle with no per-item
// attribution (e.g. a listing/network failure) would leave the FIRST cycle's
// `failures[]` surviving in the snapshot, still rendered under the second
// cycle's own, unrelated error. This test reproduces that exact two-cycle
// sequence and asserts the stale entry is gone after cycle 2.
test('FIX-3: a stale failures[] from an earlier error cycle is cleared by a later error cycle with no attribution', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@fix3stale', format: 'video' });

  // Cycle 1: a download error WITH an attributed per-item failure for VID_OLD.
  run.runList = async () => ({
    ok: true,
    stdout: JSON.stringify({ id: 'VID_OLD', extractor_key: 'Youtube', availability: 'public', title: 'Old Video' }),
    stderr: '',
  });
  run.runDownload = async () => ({
    ok: false,
    code: 1,
    stdout: '',
    stderr: '',
    error: 'yt-dlp exited with code 1',
    itemFailures: [{ videoId: 'VID_OLD', reason: 'Video unavailable' }],
  });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await ytdlp.runPoll(deps, enabledConfig());
    const midSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.deepEqual(midSnap.subscriptions[sub.id].failures, [
      { videoId: 'VID_OLD', title: 'Old Video', reason: 'Video unavailable' },
    ], 'sanity: cycle 1 recorded the attributed failure');

    // Cycle 2: a LISTING failure -- no per-item attribution is even possible
    // on this path (it never reaches the download step at all).
    run.runList = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: 'network error listing the channel' });

    await ytdlp.runPoll(deps, enabledConfig());
    const finalSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    const entry = finalSnap.subscriptions[sub.id];
    assert.equal(entry.state, 'error');
    assert.deepEqual(entry.failures, [], "cycle 2's unattributed error must clear cycle 1's stale VID_OLD entry, not let it survive");
  } finally {
    await close();
  }
});
