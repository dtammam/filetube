'use strict';

// [INTEGRATION] v1.24.0 A3: `POST /api/ytdlp/download/:jobId/cancel` -- the
// one-shot cancel route + the module-level `Map<jobId, ChildProcess>` its
// lifecycle depends on. Mirrors ytdlp-oneshot.test.js's pattern: `run.js` is
// monkey-patched at the `run.runDownload` seam (no real yt-dlp binary), and
// `opts.onChild` is captured/invoked manually with a small fake
// `ChildProcess`-shaped object (a `kill()` spy) to drive the registration
// half of the contract -- `run.js`'s OWN spawn-boundary half (that
// `spawnYtdlpDownload` really does call `opts.onChild` synchronously after a
// real `cp.spawn`) is covered separately in
// test/integration/ytdlp-spawn-security.test.js.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');

const originalRunDownload = run.runDownload;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cancel-'));
});

afterEach(() => {
  run.runDownload = originalRunDownload;
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

const SINGLE_VIDEO_URL = 'https://youtu.be/dQw4w9WgXcQ';

function postJson(base, urlPath, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// A minimal fake `ChildProcess`-shaped handle -- just enough (`.kill()`) for
// the cancel route to drive; this file never touches `cp.spawn` itself (see
// the module comment above).
function makeFakeChild() {
  return { killCalls: [], kill(signal) { this.killCalls.push(signal); } };
}

// Starts a one-shot download whose `run.runDownload` never resolves until the
// test explicitly settles it -- captures the `onChild`-registered fake child,
// the `opts.onProgress` callback `runOneShot` wires up, and the `jobId` so a
// test can drive every half of the cancel flow (including a simulated LATE
// progress line -- see the FIX-1 regression test below).
async function startInFlightOneShot(deps, config, base) {
  let registeredChild = null;
  let capturedOnProgress = null;
  let resolveDownload;
  run.runDownload = (sub, cfg, targetIds, opts) => {
    if (opts && typeof opts.onChild === 'function') {
      registeredChild = makeFakeChild();
      opts.onChild(registeredChild);
    }
    if (opts && typeof opts.onProgress === 'function') {
      capturedOnProgress = opts.onProgress;
    }
    return new Promise((resolve) => {
      resolveDownload = resolve;
    });
  };
  const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
  assert.equal(res.status, 202);
  const { jobId } = await res.json();
  // Give the fire-and-forget runOneShot a moment to actually start and
  // register its child via onChild.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(registeredChild, 'onChild must have registered a fake child by now');
  assert.ok(capturedOnProgress, 'onProgress must have been captured by now');
  return {
    jobId,
    child: registeredChild,
    onProgress: capturedOnProgress,
    settleDownload: (result) => resolveDownload(result),
  };
}

// ---- [UNIT] AC: cancelling a tracked in-progress spawn sends SIGKILL and --
// transitions the job to 'cancelled', never 'error' -----------------------

test('POST /api/ytdlp/download/:jobId/cancel: kills the tracked child (SIGKILL) and transitions the job to cancelled', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const { base, close } = await startTestApp(deps, config);
  let settleDownload = null;
  try {
    const started = await startInFlightOneShot(deps, config, base);
    const { jobId, child } = started;
    settleDownload = started.settleDownload;

    const cancelRes = await postJson(base, `/api/ytdlp/download/${jobId}/cancel`);
    assert.equal(cancelRes.status, 200);
    const cancelBody = await cancelRes.json();
    assert.deepEqual(cancelBody, { cancelled: true, jobId });

    assert.deepEqual(child.killCalls, ['SIGKILL'], 'the tracked child must be sent SIGKILL, same posture as the timeout-kill path');

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    const snap = await statusRes.json();
    assert.equal(snap.oneShots[jobId].state, 'cancelled', 'the job must transition to the new cancelled terminal state');
  } finally {
    // Settle the deferred run.runDownload promise this test started (mirrors
    // the killed child's own eventual, real 'close' event) -- the shared
    // module-level runExclusive FIFO (lib/ytdlp/index.js) would otherwise
    // stay permanently blocked on it, wedging every LATER test in this file
    // (see ytdlp-oneshot.test.js's FIX-10 test for the same lesson).
    if (settleDownload) {
      settleDownload({ ok: false, code: null, signal: 'SIGKILL', stdout: '', stderr: '', error: 'yt-dlp timed out and was killed' });
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await close();
  }
});

// ---- Never clobbered back to 'error' once the killed child's own -----------
// (asynchronous) close/settle eventually reaches runOneShot ------------------

test('POST /api/ytdlp/download/:jobId/cancel: the cancelled state is never clobbered back to error once the killed download\'s promise later settles as a failure', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const { base, close } = await startTestApp(deps, config);
  try {
    const { jobId, settleDownload } = await startInFlightOneShot(deps, config, base);

    const cancelRes = await postJson(base, `/api/ytdlp/download/${jobId}/cancel`);
    assert.equal(cancelRes.status, 200);

    // Sanity: 'cancelled' is already visible immediately after the cancel
    // response, before the killed child's own close-driven settle below.
    const midSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(midSnap.oneShots[jobId].state, 'cancelled');

    // Simulate the REAL SIGKILL's eventual, asynchronous effect: the killed
    // child's process actually exits some time later, and run.runDownload's
    // promise settles as an ordinary failure (exactly what a real SIGKILL
    // produces) -- runOneShot's own terminal-state write must not stomp the
    // 'cancelled' state that was already written.
    settleDownload({ ok: false, code: null, signal: 'SIGKILL', stdout: '', stderr: '', error: 'yt-dlp timed out and was killed' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const finalSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(finalSnap.oneShots[jobId].state, 'cancelled', 'the terminal state must remain cancelled, never overwritten to error');
  } finally {
    await close();
  }
});

// ---- FIX-1 (two-reviewer gate, post-release): a LATE, pipe-buffered -------
// progress line arriving AFTER cancel but BEFORE the download promise
// settles must never even momentarily flip the live state away from
// 'cancelled' -- distinct from the test above, which only covers a late
// CLOSE-driven settle. This is the specific gap the original A3 race test
// never covered: `run.js`'s `onProgress` can fire (from a still-buffered
// stdout 'data' event, or its close-time flush) strictly BEFORE the
// download's own promise resolves, and pre-fix that call went straight
// through to `activity.setOneShot(jobId, {state:'downloading'})`,
// clobbering 'cancelled' -- readable by a status poll landing in that exact
// window, and, worse, still present when `runOneShot`'s OWN terminal-state
// write ran afterward and read a live-state snapshot that no longer said
// 'cancelled' at all (the original bug this latch fixes).

test('POST /api/ytdlp/download/:jobId/cancel: a late progress line arriving AFTER cancel but BEFORE the download settles never flips the state off cancelled', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const { base, close } = await startTestApp(deps, config);
  try {
    const { jobId, onProgress, settleDownload } = await startInFlightOneShot(deps, config, base);

    const cancelRes = await postJson(base, `/api/ytdlp/download/${jobId}/cancel`);
    assert.equal(cancelRes.status, 200);

    const midSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(midSnap.oneShots[jobId].state, 'cancelled', 'sanity: cancelled immediately after the cancel response');

    // Simulate the late, pipe-buffered progress `data` line (or the
    // close-time flush) that `run.js` can still dispatch AFTER the cancel
    // route's SIGKILL but BEFORE `run.runDownload`'s own promise settles --
    // this is exactly `onProgress`, called directly, the same seam
    // `spawnYtdlpDownload` itself calls it through.
    onProgress({ state: 'downloading', percent: 42 });

    // The state must NOT have flipped to 'downloading' even momentarily --
    // a status poll landing right here must still see 'cancelled'.
    const afterLateProgressSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(
      afterLateProgressSnap.oneShots[jobId].state,
      'cancelled',
      'a late progress line must never clobber the cancelled state, not even momentarily',
    );

    // Now let the download's own promise actually settle (the killed
    // child's real, eventual close) -- the final state must still be
    // 'cancelled', never 'error'.
    settleDownload({ ok: false, code: null, signal: 'SIGKILL', stdout: '', stderr: '', error: 'yt-dlp timed out and was killed' });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const finalSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(finalSnap.oneShots[jobId].state, 'cancelled', 'the final settled state must be cancelled, never error');
    assert.equal(finalSnap.oneShots[jobId].error, undefined, 'a cancelled job must never carry an error field');
  } finally {
    await close();
  }
});

// ---- [UNIT] AC: cancelling an id with no in-progress job is a clean --------
// no-op (404), never a crash -------------------------------------------------

test('POST /api/ytdlp/download/:jobId/cancel: an unknown/never-existed job id responds 404, never crashes', async () => {
  const deps = makeFakeDeps();
  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download/does-not-exist/cancel');
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(typeof body.error, 'string');
    assert.ok(body.error.length > 0);
  } finally {
    await close();
  }
});

test('POST /api/ytdlp/download/:jobId/cancel: a job that already completed responds 404 -- it is no longer cancellable', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    const { jobId } = await res.json();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    const snap = await statusRes.json();
    assert.equal(snap.oneShots[jobId].state, 'done', 'sanity: the job must have completed already');

    const cancelRes = await postJson(base, `/api/ytdlp/download/${jobId}/cancel`);
    assert.equal(cancelRes.status, 404, 'a completed job must no longer be cancellable');
  } finally {
    await close();
  }
});

// ---- [UNIT] AC: the handle Map is cleaned up when the promise settles ------
// (no leak) -- proven indirectly: cancelling the SAME jobId again after it --
// has already settled must 404, since the handle was removed. --------------

test('the tracked child handle is removed once the download settles -- a SECOND cancel attempt after natural completion 404s (no leak)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    const { jobId } = await res.json();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const first = await postJson(base, `/api/ytdlp/download/${jobId}/cancel`);
    assert.equal(first.status, 404);
    const second = await postJson(base, `/api/ytdlp/download/${jobId}/cancel`);
    assert.equal(second.status, 404);
  } finally {
    await close();
  }
});

test('the tracked child handle is removed once a FAILED download settles too -- cancel 404s afterward (no leak on the error path)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.runDownload = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: 'yt-dlp exited with code 1' });

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    const { jobId } = await res.json();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    const snap = await statusRes.json();
    assert.equal(snap.oneShots[jobId].state, 'error');

    const cancelRes = await postJson(base, `/api/ytdlp/download/${jobId}/cancel`);
    assert.equal(cancelRes.status, 404, 'a job that failed on its own must no longer be cancellable');
  } finally {
    await close();
  }
});

// ---- Scope: cancel is one-shot-only -- a subscription id (never a one-shot
// jobId) is never reachable via this route either, since the Map only ever
// contains one-shot children.

test('POST /api/ytdlp/download/:jobId/cancel: an id that only ever exists as a subscription (never a one-shot job) 404s -- scope is one-shot only', async () => {
  const deps = makeFakeDeps();
  const store = require('../../lib/ytdlp/store');
  const config = enabledConfig();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, `/api/ytdlp/download/${sub.id}/cancel`);
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});
