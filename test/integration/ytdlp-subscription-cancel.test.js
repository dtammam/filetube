'use strict';

// [INTEGRATION] v1.24.8: stop subscription downloads -- the SUBSCRIPTION-side
// twin of test/integration/ytdlp-oneshot-cancel.test.js, one namespace over.
// Covers `POST /api/subscriptions/:id/cancel` (single) and `POST
// /api/subscriptions/downloads/cancel` (stop-all), plus the poll-loop skip
// (`cancelledSubscriptionIds`) and its per-poll lifetime (cleared in
// `runPoll`'s `finally`, never permanently muting a channel). Mirrors the
// one-shot cancel test's pattern throughout: `run.js` is monkey-patched at
// the `run.runList`/`run.runDownload` seam (no real yt-dlp binary), and
// `opts.onChild` is captured/invoked manually with a small fake
// `ChildProcess`-shaped object (a `kill()` spy).

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-sub-cancel-'));
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  // Mirrors ytdlp-poll.test.js's own teardown: never let a leaked follow-up
  // timer from one test wedge `schedulePollRerun`'s single-guard for a later
  // test sharing this module instance.
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

async function addSub(deps, overrides = {}) {
  return store.addSubscription(deps, {
    channelUrl: 'https://www.youtube.com/@somechannel',
    format: 'video',
    quality: 'best',
    ...overrides,
  });
}

function ndjson(videos) {
  return videos.map((v) => JSON.stringify(v)).join('\n');
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

function postJson(base, urlPath, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function makeFakeChild() {
  return { killCalls: [], kill(signal) { this.killCalls.push(signal); } };
}

// ---- Cancelling the ACTIVE subscription download ---------------------------

test('POST /api/subscriptions/:id/cancel: SIGKILLs the active child and settles the subscription as cancelled, never error -- even with a late progress line', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const sub = await addSub(deps);
  const { base, close } = await startTestApp(deps, config);

  let registeredChild = null;
  let capturedOnProgress = null;
  let resolveDownload;
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'survivor1', availability: 'public' }]), stderr: '' });
  run.runDownload = (_sub, _cfg, _targetIds, opts) => {
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

  const pollPromise = ytdlp.runPoll(deps, config);
  // Give the sequential loop a moment to reach the download stage and
  // register the fake child via onChild.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(registeredChild, 'onChild must have registered a fake child by now');
  assert.ok(capturedOnProgress, 'onProgress must have been captured by now');

  try {
    const cancelRes = await postJson(base, `/api/subscriptions/${sub.id}/cancel`);
    assert.equal(cancelRes.status, 200);
    const cancelBody = await cancelRes.json();
    assert.deepEqual(cancelBody, { cancelled: true, id: sub.id });

    assert.deepEqual(registeredChild.killCalls, ['SIGKILL'], 'the tracked subscription child must be sent SIGKILL');

    const midSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(midSnap.subscriptions[sub.id].state, 'cancelled', 'the very next status poll must already reflect the cancellation');

    // T15-class race: a late, pipe-buffered progress line arriving AFTER the
    // cancel but BEFORE the download's own promise settles must never flip
    // the state away from 'cancelled', not even momentarily.
    capturedOnProgress({ state: 'downloading', percent: 77 });
    const afterLateProgress = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(afterLateProgress.subscriptions[sub.id].state, 'cancelled', 'a late progress line must never clobber the cancelled state');

    // Now let the killed child's real, eventual close settle the download
    // promise as an ordinary failure -- exactly what a real SIGKILL produces.
    resolveDownload({ ok: false, code: null, signal: 'SIGKILL', stdout: '', stderr: '', error: 'yt-dlp was killed' });
    await pollPromise;

    const finalSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(finalSnap.subscriptions[sub.id].state, 'cancelled', 'the final settled state must be cancelled, never error');
    assert.equal(finalSnap.subscriptions[sub.id].error, undefined, 'a cancelled subscription must never carry an error field');
  } finally {
    // Defensive: if an assertion above threw before `resolveDownload` ran,
    // settle it anyway so this poll's own `pollBusy`/`cancelledSubscriptionIds`
    // state can never leak into a LATER test sharing this module instance
    // (mirrors ytdlp-oneshot-cancel.test.js's own defensive settle-in-finally).
    if (resolveDownload) {
      resolveDownload({ ok: false, code: null, signal: 'SIGKILL', stdout: '', stderr: '', error: 'yt-dlp was killed' });
      await pollPromise.catch(() => {});
    }
    await close();
  }
});

// ---- FIX 1 (two-reviewer gate): cancel + delete must never resurrect a -----
// ---- ghost activity entry ---------------------------------------------------
//
// Pre-fix repro: cancel latches the subscription id into
// `cancelledSubscriptionIds` -- then `DELETE /api/subscriptions/:id` removes
// its store row and clears its (then-current) activity entry -- then the
// SIGKILLed download's own promise settles `ok:false`, and
// `guardedSetSubscriptionActivity`'s latch check (checked BEFORE the
// existence check, pre-fix) resurrects a `'cancelled'` activity entry for an
// id that no longer has a subscription row. Subscription activity entries
// have no TTL, so that ghost "Cancelled" row would persist forever (until a
// process restart). FIX 1 reorders the guard to check existence FIRST.

test('FIX 1: cancel an active download, then DELETE the subscription before the killed download settles -- no ghost activity entry ever resurfaces', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const sub = await addSub(deps);
  const { base, close } = await startTestApp(deps, config);

  let registeredChild = null;
  let resolveDownload;
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'survivor1', availability: 'public' }]), stderr: '' });
  run.runDownload = (_sub, _cfg, _targetIds, opts) => {
    if (opts && typeof opts.onChild === 'function') {
      registeredChild = makeFakeChild();
      opts.onChild(registeredChild);
    }
    return new Promise((resolve) => {
      resolveDownload = resolve;
    });
  };

  const pollPromise = ytdlp.runPoll(deps, config);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(registeredChild, 'onChild must have registered a fake child by now');

  try {
    // 1) Cancel it -- latches the id and SIGKILLs the child.
    const cancelRes = await postJson(base, `/api/subscriptions/${sub.id}/cancel`);
    assert.equal(cancelRes.status, 200);
    assert.deepEqual(registeredChild.killCalls, ['SIGKILL']);

    const afterCancel = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(afterCancel.subscriptions[sub.id].state, 'cancelled');

    // 2) DELETE the subscription BEFORE the killed download's own promise
    // settles -- removes the store row and clears the (still-latched) live
    // activity entry.
    const deleteRes = await fetch(`${base}/api/subscriptions/${sub.id}`, { method: 'DELETE' });
    assert.equal(deleteRes.status, 200);

    const afterDelete = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(afterDelete.subscriptions[sub.id], undefined, 'the deleted subscription must have no activity entry at all right after the delete');

    // 3) NOW let the killed child's promise settle as an ordinary SIGKILL
    // failure -- exactly what a real kill produces. Pre-fix, this is the
    // write that resurrected the ghost 'cancelled' entry.
    resolveDownload({ ok: false, code: null, signal: 'SIGKILL', stdout: '', stderr: '', error: 'yt-dlp was killed' });
    await pollPromise;

    const finalSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(finalSnap.subscriptions[sub.id], undefined, 'the deleted subscription must never resurface in the status snapshot -- no ghost "cancelled" row, ever');

    // 4) A LATER, independent status fetch must still show it gone -- the
    // ghost (if it existed) would have no TTL and would sit there forever.
    const laterSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(laterSnap.subscriptions[sub.id], undefined, 'the deleted subscription must stay gone across a subsequent, independent status fetch');

    // And the store itself has no record of it either.
    assert.equal(store.listSubscriptions(deps).some((s) => s.id === sub.id), false, 'the subscription must actually be gone from the store, not just the activity snapshot');
  } finally {
    if (resolveDownload) {
      resolveDownload({ ok: false, code: null, signal: 'SIGKILL', stdout: '', stderr: '', error: 'yt-dlp was killed' });
      await pollPromise.catch(() => {});
    }
    await close();
  }
});

// ---- Cancelling a QUEUED subscription before it spawns ---------------------

test('POST /api/subscriptions/:id/cancel: cancelling a QUEUED subscription before it spawns means it never spawns a download child, and its entry is cleared', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanA' });
  const subB = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanB' });
  const { base, close } = await startTestApp(deps, config);

  const listedSubIds = [];
  let resolveListA;
  run.runList = (sub) => {
    listedSubIds.push(sub.id);
    if (sub.id === subA.id) {
      // Hold subA in flight (still in the 'listing' phase) so subB stays
      // QUEUED, never reached, for the whole test.
      return new Promise((resolve) => {
        resolveListA = () => resolve({ ok: true, stdout: '', stderr: '' });
      });
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  let downloadCalls = 0;
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const pollPromise = ytdlp.runPoll(deps, config);
  await new Promise((resolve) => setImmediate(resolve));

  try {
    // subB was set 'queued' synchronously before the sequential loop even
    // started (FIX-7 posture) -- sanity-check it before cancelling.
    const preSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(preSnap.subscriptions[subB.id].state, 'queued');

    const cancelRes = await postJson(base, `/api/subscriptions/${subB.id}/cancel`);
    assert.equal(cancelRes.status, 200);
    const cancelBody = await cancelRes.json();
    assert.deepEqual(cancelBody, { cancelled: true, id: subB.id });

    const midSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    // Note: `GET /api/subscriptions/status` additively merges
    // `lastCheckedAt`/`nextPollDue` onto EVERY known subscription
    // regardless of live activity (see that route's own doc comment) -- so
    // a "cleared" entry is not entirely absent from the snapshot, but it
    // must have no `state` at all (never a stale 'queued').
    assert.equal(midSnap.subscriptions[subB.id].state, undefined, 'a cancelled QUEUED subscription\'s activity entry must be cleared -- no state at all, never a stale \'queued\'');

    // Let subA finish so the loop advances to subB -- which must be SKIPPED
    // entirely by the poll loop's cancel-latch check, never calling runList
    // or runDownload for it at all.
    resolveListA();
    await pollPromise;

    assert.ok(!listedSubIds.includes(subB.id), 'a cancelled QUEUED subscription must never reach runList -- the poll loop must skip it before it can spawn anything');
    assert.equal(downloadCalls, 0, 'a cancelled QUEUED subscription must never spawn a download child');

    const finalSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(finalSnap.subscriptions[subB.id].state, undefined, 'the cleared entry must stay cleared -- nothing in the skipped loop iteration may recreate it');
  } finally {
    // Defensive: never leave subA's runList hanging if an assertion above
    // threw first -- an un-settled poll would leak `pollBusy: true` into
    // every later test sharing this module instance (see the same
    // defensive pattern in the ACTIVE-cancel test above).
    if (resolveListA) {
      resolveListA();
      await pollPromise.catch(() => {});
    }
    await close();
  }
});

// ---- Stop-all --------------------------------------------------------------

test('POST /api/subscriptions/downloads/cancel: cancels the active child, clears every queued entry, clears the pending re-pull, and returns the count', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const subA = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanA' });
  const subB = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanB' });
  const subC = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanC' });
  const { base, close } = await startTestApp(deps, config);

  let registeredChild = null;
  let resolveDownload;
  let listCalls = 0;
  run.runList = async () => {
    listCalls += 1;
    return { ok: true, stdout: ndjson([{ id: 'v1', availability: 'public' }]), stderr: '' };
  };
  run.runDownload = (sub, _cfg, _targetIds, opts) => {
    // subA is processed first (sequential loop) -- only ITS runDownload call
    // ever needs to hang; subB/subC never get their own turn while subA is
    // still in flight, so they stay 'queued' for the whole test.
    if (opts && typeof opts.onChild === 'function' && sub.id === subA.id) {
      registeredChild = makeFakeChild();
      opts.onChild(registeredChild);
    }
    return new Promise((resolve) => {
      if (sub.id === subA.id) resolveDownload = resolve;
      else resolve({ ok: true, code: 0, stdout: '', stderr: '' });
    });
  };

  const pollPromise = ytdlp.runPoll(deps, config);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(registeredChild, 'subA\'s fake child must be registered by now');

  try {
    const preSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(preSnap.subscriptions[subA.id].state, 'downloading');
    assert.equal(preSnap.subscriptions[subB.id].state, 'queued');
    assert.equal(preSnap.subscriptions[subC.id].state, 'queued');

    // A second poll trigger arriving while the first is busy coalesces into
    // a pending follow-up -- stop-all must clear this so it never fires and
    // silently re-spawns the exact backlog just stopped.
    const coalesced = await ytdlp.runPoll(deps, config);
    assert.deepEqual(coalesced, { started: false, reason: 'busy' });

    const cancelRes = await postJson(base, '/api/subscriptions/downloads/cancel');
    assert.equal(cancelRes.status, 200);
    const cancelBody = await cancelRes.json();
    assert.deepEqual(cancelBody, { cancelled: 3 });

    assert.deepEqual(registeredChild.killCalls, ['SIGKILL'], 'the active child must be SIGKILLed');

    const midSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(midSnap.subscriptions[subA.id].state, 'cancelled', 'the active subscription settles as cancelled');
    assert.equal(midSnap.subscriptions[subB.id].state, undefined, 'a stopped queued subscription\'s activity entry is cleared');
    assert.equal(midSnap.subscriptions[subC.id].state, undefined, 'a stopped queued subscription\'s activity entry is cleared');

    resolveDownload({ ok: false, code: null, signal: 'SIGKILL', stdout: '', stderr: '', error: 'yt-dlp was killed' });
    await pollPromise;

    // Give the (should-be-cleared) coalesced follow-up's unref'd
    // setTimeout(0) a chance to fire, if it were ever going to.
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(listCalls, 1, 'stop-all must have cleared the coalesced follow-up -- no second poll (which would call runList again) may ever run');

    const finalSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(finalSnap.subscriptions[subA.id].state, 'cancelled', 'the final settled state must stay cancelled, never error');
  } finally {
    // Defensive settle -- see the ACTIVE-cancel test's own comment above.
    if (resolveDownload) {
      resolveDownload({ ok: false, code: null, signal: 'SIGKILL', stdout: '', stderr: '', error: 'yt-dlp was killed' });
      await pollPromise.catch(() => {});
    }
    await close();
  }
});

test('POST /api/subscriptions/downloads/cancel: a clean no-op (never crashes) when nothing is in progress', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/subscriptions/downloads/cancel');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { cancelled: 0 });
  } finally {
    await close();
  }
});

// ---- Unknown id -------------------------------------------------------------

test('POST /api/subscriptions/:id/cancel: an unknown subscription id 404s, never crashes', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/subscriptions/no-such-subscription/cancel');
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(typeof body.error, 'string');
    assert.ok(body.error.length > 0);
  } finally {
    await close();
  }
});

// FIX 2 (two-reviewer gate): the idempotent no-op branch must report
// `{cancelled: false}`, never `{cancelled: true}` -- a `true` here was a
// silent fake-success (see the route's own doc comment).
test('POST /api/subscriptions/:id/cancel: a KNOWN subscription with nothing currently in progress is a harmless idempotent 200 that reports {cancelled: false}', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const sub = await addSub(deps);
  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, `/api/subscriptions/${sub.id}/cancel`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { cancelled: false, id: sub.id });
  } finally {
    await close();
  }
});

// FIX 2 (two-reviewer gate): a `'listing'` subscription's Cancel request is
// the SAME silent-fake-success shape as the idle case above -- there is no
// child to kill during listing, so it must be an honest {cancelled: false}
// no-op, not a {cancelled: true} that leads the client to believe the
// download was stopped while it actually proceeds to completion.
test('POST /api/subscriptions/:id/cancel: a "listing" subscription is a no-op that reports {cancelled: false} -- never a fake success, and the listing proceeds unaffected', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const sub = await addSub(deps);
  const { base, close } = await startTestApp(deps, config);

  let resolveList;
  run.runList = () => new Promise((resolve) => {
    resolveList = () => resolve({ ok: true, stdout: '', stderr: '' });
  });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const pollPromise = ytdlp.runPoll(deps, config);
  await new Promise((resolve) => setImmediate(resolve));

  try {
    const midSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(midSnap.subscriptions[sub.id].state, 'listing', 'the subscription must genuinely be in the listing phase for this test to be meaningful');

    const cancelRes = await postJson(base, `/api/subscriptions/${sub.id}/cancel`);
    assert.equal(cancelRes.status, 200);
    assert.deepEqual(await cancelRes.json(), { cancelled: false, id: sub.id }, 'a listing subscription has nothing to kill -- the response must honestly report {cancelled: false}, never a fake {cancelled: true}');

    // The listing (and the poll) must proceed completely unaffected -- no
    // latch was armed, so it must complete normally, never land on
    // 'cancelled'.
    resolveList();
    await pollPromise;

    const finalSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(finalSnap.subscriptions[sub.id].state, 'done', 'the no-op cancel must never actually stop the listing/download -- it must complete normally');
  } finally {
    if (resolveList) {
      resolveList();
      await pollPromise.catch(() => {});
    }
    await close();
  }
});

// ---- Orphan-latch regression -----------------------------------------------
//
// Cancelling an IDLE subscription (nothing in progress at all) must NEVER
// add it to the shared, poll-scoped `cancelledSubscriptionIds` latch --
// otherwise that entry would sit unconsumed (nothing is polling it right
// now, so nothing will `continue`-skip it or otherwise clear it) until some
// UNRELATED future poll's `finally` wipes the whole set, silently causing
// THIS subscription's next real poll to be wrongly skipped if it starts
// first.

test('POST /api/subscriptions/:id/cancel: cancelling an IDLE subscription never creates an orphan latch entry -- a poll started right afterward is never silently skipped', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const sub = await addSub(deps);
  const { base, close } = await startTestApp(deps, config);
  try {
    const cancelRes = await postJson(base, `/api/subscriptions/${sub.id}/cancel`);
    assert.equal(cancelRes.status, 200);

    let listCalledForSub = false;
    run.runList = async (polledSub) => {
      if (polledSub.id === sub.id) listCalledForSub = true;
      return { ok: true, stdout: '', stderr: '' };
    };
    run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

    const result = await ytdlp.runPoll(deps, config);
    assert.equal(result.started, true);
    assert.equal(result.count, 1, 'the idle-then-cancelled subscription must still be a normal poll target');
    assert.ok(listCalledForSub, 'a poll starting right after an idle cancel must never silently skip this subscription (no orphan latch entry left behind)');

    const finalSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(finalSnap.subscriptions[sub.id].state, 'done', 'the poll must complete normally, never held at cancelled from the earlier idle no-op');
  } finally {
    await close();
  }
});

// ---- Latch is bounded to the poll -------------------------------------------

test('a subscription cancelled in poll N is polled NORMALLY in poll N+1 -- the latch never permanently mutes a channel', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const sub = await addSub(deps);
  const { base, close } = await startTestApp(deps, config);

  let registeredChild = null;
  let resolveDownload;
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'v1', availability: 'public' }]), stderr: '' });
  run.runDownload = (_sub, _cfg, _targetIds, opts) => {
    if (opts && typeof opts.onChild === 'function') {
      registeredChild = makeFakeChild();
      opts.onChild(registeredChild);
    }
    return new Promise((resolve) => { resolveDownload = resolve; });
  };

  // ---- Poll N: cancel it mid-download ----
  const pollNPromise = ytdlp.runPoll(deps, config);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(registeredChild, 'the fake child must be registered by now');

  try {
    const cancelRes = await postJson(base, `/api/subscriptions/${sub.id}/cancel`);
    assert.equal(cancelRes.status, 200);
    assert.deepEqual(registeredChild.killCalls, ['SIGKILL'], 'poll N\'s active child must be SIGKILLed');
    resolveDownload({ ok: false, code: null, signal: 'SIGKILL', stdout: '', stderr: '', error: 'yt-dlp was killed' });
    await pollNPromise;

    const afterPollN = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(afterPollN.subscriptions[sub.id].state, 'cancelled');

    // ---- Poll N+1: same subscription, normal (non-cancelled) mock flow ----
    let listCalledForSub = false;
    run.runList = async (polledSub) => {
      if (polledSub.id === sub.id) listCalledForSub = true;
      return { ok: true, stdout: '', stderr: '' };
    };
    run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

    const resultN1 = await ytdlp.runPoll(deps, config);
    assert.equal(resultN1.started, true);
    assert.equal(resultN1.count, 1, 'the subscription must be targeted again -- the poll N latch must not have survived into poll N+1');
    assert.ok(listCalledForSub, 'poll N+1 must call runList for this subscription -- it must never be silently skipped again');

    const [persisted] = store.listSubscriptions(deps);
    assert.ok(persisted.lastStatus.startsWith('ok'), `expected a normal, non-cancelled status in poll N+1, got: ${persisted.lastStatus}`);

    const finalSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(finalSnap.subscriptions[sub.id].state, 'done', 'poll N+1 must complete normally, never held at cancelled forever');
  } finally {
    // Defensive settle for poll N -- see the ACTIVE-cancel test's own
    // comment above (a no-op here on the success path, since poll N was
    // already awaited to completion above).
    if (resolveDownload) {
      resolveDownload({ ok: false, code: null, signal: 'SIGKILL', stdout: '', stderr: '', error: 'yt-dlp was killed' });
      await pollNPromise.catch(() => {});
    }
    await close();
  }
});

// ---- FIX 3 (two-reviewer gate): the PERSISTED lastStatus must be honest ----

test('FIX 3: a cancelled download\'s persisted lastStatus is the honest "cancelled" status, never the SIGKILL error string', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  const sub = await addSub(deps);
  const { base, close } = await startTestApp(deps, config);

  let registeredChild = null;
  let resolveDownload;
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'survivor1', availability: 'public' }]), stderr: '' });
  run.runDownload = (_sub, _cfg, _targetIds, opts) => {
    if (opts && typeof opts.onChild === 'function') {
      registeredChild = makeFakeChild();
      opts.onChild(registeredChild);
    }
    return new Promise((resolve) => {
      resolveDownload = resolve;
    });
  };

  const pollPromise = ytdlp.runPoll(deps, config);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(registeredChild, 'onChild must have registered a fake child by now');

  try {
    const cancelRes = await postJson(base, `/api/subscriptions/${sub.id}/cancel`);
    assert.equal(cancelRes.status, 200);

    // Settle exactly like a real SIGKILL: ok:false, with the raw error
    // message a killed yt-dlp process actually produces.
    resolveDownload({ ok: false, code: null, signal: 'SIGKILL', stdout: '', stderr: '', error: 'yt-dlp exited with code SIGKILL' });
    await pollPromise;

    const [persisted] = store.listSubscriptions(deps);
    assert.equal(persisted.lastStatus, 'cancelled', `the durable, persisted lastStatus must read the honest 'cancelled' status, not a synthesized error -- got: ${persisted.lastStatus}`);
    assert.ok(!persisted.lastStatus.includes('SIGKILL'), 'the persisted status must never leak the raw SIGKILL error string');
  } finally {
    if (resolveDownload) {
      resolveDownload({ ok: false, code: null, signal: 'SIGKILL', stdout: '', stderr: '', error: 'yt-dlp was killed' });
      await pollPromise.catch(() => {});
    }
    await close();
  }
});

// ---- Disabled-module no-op --------------------------------------------------

test('both new cancel routes 404 when the module is disabled', async () => {
  const deps = makeFakeDeps();
  const disabledConfig = ytdlp.parseYtdlpConfig({});
  const { base, close } = await startTestApp(deps, disabledConfig);
  try {
    const single = await postJson(base, '/api/subscriptions/some-id/cancel');
    assert.equal(single.status, 404, 'POST /api/subscriptions/:id/cancel must 404 when disabled');

    const all = await postJson(base, '/api/subscriptions/downloads/cancel');
    assert.equal(all.status, 404, 'POST /api/subscriptions/downloads/cancel must 404 when disabled');
  } finally {
    await close();
  }
});
