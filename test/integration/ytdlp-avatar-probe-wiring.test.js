'use strict';

// [INTEGRATION] v1.25 QoL bugfix: proves the two places `run.probeChannelAvatar`
// (lib/ytdlp/run.js) is actually WIRED --
//   1. POST /api/subscriptions: a best-effort, fire-and-forget probe fires
//      AFTER the response is sent, and stores a resolved avatar via
//      `store.recordSubscriptionChannelAvatar`.
//   2. `runPoll` -> `processSubscription`: a self-heal probe runs during a
//      subscription's own normal poll turn whenever `sub.channelAvatarUrl` is
//      missing, and never re-probes once it is present.
// `run.probeChannelAvatar`/`run.runList`/`run.runDownload` are monkey-patched
// (the SAME established pattern as ytdlp-oneshot.test.js/ytdlp-poll.test.js)
// -- no real yt-dlp binary or network is ever touched.

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

const originalProbeChannelAvatar = run.probeChannelAvatar;
const originalRunList = run.runList;
const originalRunDownload = run.runDownload;
const originalConsoleError = console.error;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-avatar-wiring-'));
  console.error = () => {}; // silence expected failure-path logging
});

afterEach(() => {
  run.probeChannelAvatar = originalProbeChannelAvatar;
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  console.error = originalConsoleError;
  ytdlp.resetPollRerunStateForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFakeDeps(initialDb = {}) {
  let db = initialDb;
  const scanCalls = [];
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {
      scanCalls.push(Date.now());
    },
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
    scanCalls,
  };
}

function baseConfig(overrides = {}) {
  return {
    enabled: true,
    cookiesFile: null,
    pollMinutes: 0,
    downloadDir: tmpDir,
    version: null,
    ...overrides,
  };
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
    body: JSON.stringify(body),
  });
}

// The fire-and-forget subscribe probe runs on later microtask/macrotask ticks
// (deliberately AFTER the response is already sent) -- yield back to the
// event loop a few times so it has settled before asserting against it.
function flush(rounds = 5) {
  return (async () => {
    for (let i = 0; i < rounds; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  })();
}

function ndjson(videos) {
  return videos.map((v) => JSON.stringify(v)).join('\n');
}

// Deterministic, `CHANNEL_ID_PATTERN`-shaped (`UC` + 22 chars) fake channelId
// generator -- same approach as test/unit/ytdlp-channel-avatar-registry.test.js's
// own `mkChannelId`, so registry writes below actually validate/persist.
function mkChannelId(seed) {
  const hash = crypto.createHash('md5').update(String(seed)).digest('hex');
  return `UC${hash.slice(0, 22)}`;
}

// ---- 1. POST /api/subscriptions: post-response, fire-and-forget probe -----

test('POST /api/subscriptions: a new subscription is probed for its avatar AFTER the response is already sent, and the avatar is persisted', async () => {
  const deps = makeFakeDeps();
  let probeCalledWith = null;
  run.probeChannelAvatar = async (channelUrl) => {
    probeCalledWith = channelUrl;
    return { avatarUrl: 'https://yt3.googleusercontent.com/probed-avatar.jpg', channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, baseConfig());
  try {
    const res = await postJson(base, '/api/subscriptions', { channelUrl: 'https://www.youtube.com/@newsub', format: 'video' });
    assert.equal(res.status, 201);
    const created = await res.json();
    // The response itself must NOT wait on the probe -- it must never carry
    // an avatar synchronously (the probe hasn't even started yet).
    assert.equal(created.channelAvatarUrl, undefined, 'the 201 response must not block on the avatar probe');

    await flush();

    assert.equal(probeCalledWith, 'https://www.youtube.com/@newsub');
    const [persisted] = store.listSubscriptions(deps);
    assert.equal(persisted.channelAvatarUrl, 'https://yt3.googleusercontent.com/probed-avatar.jpg');
  } finally {
    await close();
  }
});

// v1.25.x QoL bugfix: the SAME post-subscribe probe ALSO backfills the
// subscription's own (previously permanently dead) channelId, and registers
// the result into the canonical channelId-keyed registry -- not just the
// subscription's own cached channelAvatarUrl.
test('POST /api/subscriptions: the post-subscribe probe ALSO backfills channelId and registers into the canonical registry', async () => {
  const deps = makeFakeDeps();
  const channelId = 'UCsubscriberegisteredxxx';
  run.probeChannelAvatar = async (channelUrl) => ({ avatarUrl: 'https://yt3.googleusercontent.com/registered-on-subscribe.jpg', channelId, channelUrl });

  const { base, close } = await startTestApp(deps, baseConfig());
  try {
    const res = await postJson(base, '/api/subscriptions', { channelUrl: 'https://www.youtube.com/@registeronsubscribe', format: 'video' });
    assert.equal(res.status, 201);
    await flush();

    const [persisted] = store.listSubscriptions(deps);
    assert.equal(persisted.channelId, channelId, 'the previously-dead sub.channelId field must now be populated from the subscribe-time probe');
    assert.equal(store.getChannelAvatar(deps.loadDatabase(), channelId), 'https://yt3.googleusercontent.com/registered-on-subscribe.jpg', 'the probe result must ALSO be registered into the canonical registry, not just cached on the subscription');
  } finally {
    await close();
  }
});

test('POST /api/subscriptions: a probe that resolves null (no avatar found) leaves the subscription without one, never throws/errors the request', async () => {
  const deps = makeFakeDeps();
  run.probeChannelAvatar = async () => null;

  const { base, close } = await startTestApp(deps, baseConfig());
  try {
    const res = await postJson(base, '/api/subscriptions', { channelUrl: 'https://www.youtube.com/@noavatar', format: 'video' });
    assert.equal(res.status, 201);
    await flush();
    const [persisted] = store.listSubscriptions(deps);
    assert.equal(persisted.channelAvatarUrl, undefined);
  } finally {
    await close();
  }
});

test('POST /api/subscriptions: a probe failure (rejects) is caught and logged -- never surfaces to the client, never crashes', async () => {
  const deps = makeFakeDeps();
  run.probeChannelAvatar = async () => {
    throw new Error('boom: a defensive-in-depth regression -- probeChannelAvatar is documented to never reject, but the wiring survives it anyway');
  };

  const { base, close } = await startTestApp(deps, baseConfig());
  try {
    const res = await postJson(base, '/api/subscriptions', { channelUrl: 'https://www.youtube.com/@failingprobe', format: 'video' });
    assert.equal(res.status, 201, 'the subscribe response must succeed regardless of the probe outcome');
    await flush();
    const [persisted] = store.listSubscriptions(deps);
    assert.equal(persisted.channelAvatarUrl, undefined);
  } finally {
    await close();
  }
});

test('POST /api/subscriptions: a no-op re-add of an already-known channel (with an avatar already captured) never re-probes', async () => {
  const deps = makeFakeDeps();
  let probeCalls = 0;
  run.probeChannelAvatar = async () => {
    probeCalls += 1;
    return { avatarUrl: 'https://yt3.googleusercontent.com/first-probe.jpg', channelId: null, channelUrl: null };
  };

  const { base, close } = await startTestApp(deps, baseConfig());
  try {
    const firstRes = await postJson(base, '/api/subscriptions', { channelUrl: 'https://www.youtube.com/@repeatsub', format: 'video' });
    assert.equal(firstRes.status, 201);
    await flush();
    assert.equal(probeCalls, 1);

    // Re-POST the SAME channel -- addSubscription's own idempotent-by-id
    // posture returns the EXISTING (already-avatared) record unchanged.
    const secondRes = await postJson(base, '/api/subscriptions', { channelUrl: 'https://www.youtube.com/@repeatsub', format: 'video' });
    assert.equal(secondRes.status, 201);
    const secondBody = await secondRes.json();
    assert.equal(secondBody.channelAvatarUrl, 'https://yt3.googleusercontent.com/first-probe.jpg');
    await flush();
    assert.equal(probeCalls, 1, 'a no-op re-add of an already-avatared channel must never re-probe');
  } finally {
    await close();
  }
});

// ---- 2. runPoll -> processSubscription: poll-time self-heal ---------------

test('runPoll: a subscription with a MISSING channelAvatarUrl is self-healed (probed + stored) during its own normal poll turn', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, {
    channelUrl: 'https://www.youtube.com/@healme',
    format: 'video',
    quality: 'best',
  });
  assert.equal(sub.channelAvatarUrl, undefined, 'sanity: a brand-new subscription starts with no avatar');

  let probeCalls = 0;
  run.probeChannelAvatar = async (channelUrl) => {
    probeCalls += 1;
    assert.equal(channelUrl, 'https://www.youtube.com/@healme');
    return { avatarUrl: 'https://yt3.googleusercontent.com/self-healed.jpg', channelId: null, channelUrl: null };
  };
  run.runList = async () => ({ ok: true, stdout: ndjson([]), stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [] });

  const result = await ytdlp.runPoll(deps, baseConfig());
  assert.equal(result.started, true);
  assert.equal(probeCalls, 1);

  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.channelAvatarUrl, 'https://yt3.googleusercontent.com/self-healed.jpg');
});

test('runPoll: a subscription that ALREADY has a channelAvatarUrl is never re-probed', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, {
    channelUrl: 'https://www.youtube.com/@alreadyhealed',
    format: 'video',
    quality: 'best',
  });
  await store.recordSubscriptionChannelAvatar(deps, 'https://www.youtube.com/@alreadyhealed', 'https://yt3.googleusercontent.com/existing.jpg');

  let probeCalls = 0;
  run.probeChannelAvatar = async () => {
    probeCalls += 1;
    return 'https://yt3.googleusercontent.com/should-not-be-used.jpg';
  };
  run.runList = async () => ({ ok: true, stdout: ndjson([]), stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [] });

  await ytdlp.runPoll(deps, baseConfig());

  assert.equal(probeCalls, 0, 'a subscription that already has an avatar must never be re-probed');
  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.channelAvatarUrl, 'https://yt3.googleusercontent.com/existing.jpg', 'unchanged');
});

// v1.25.x QoL bugfix (two-reviewer gate follow-up): the poll's self-heal now
// ALSO folds a successful probe into the canonical, channelId-keyed registry
// -- previously this only backfilled the subscription's own cached fields,
// so a channel discovered ONLY via self-heal was invisible to
// `db.ytdlp.channelAvatars` until some OTHER populate point ran for it.
test('runPoll: a self-healed channel (probe returns a channelId) is registered into the canonical registry, AND its subscription fields are still written', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, {
    channelUrl: 'https://www.youtube.com/@registerviaselfheal',
    format: 'video',
    quality: 'best',
  });

  const channelId = mkChannelId('registered-via-selfheal');
  run.probeChannelAvatar = async (channelUrl) => ({
    avatarUrl: 'https://yt3.googleusercontent.com/registered-via-selfheal.jpg',
    channelId,
    channelUrl,
  });
  run.runList = async () => ({ ok: true, stdout: ndjson([]), stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [] });

  await ytdlp.runPoll(deps, baseConfig());

  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.channelAvatarUrl, 'https://yt3.googleusercontent.com/registered-via-selfheal.jpg', 'the subscription\'s own cached field must still be written');
  assert.equal(persisted.channelId, channelId, 'the subscription\'s own channelId must still be backfilled');
  assert.equal(
    store.getChannelAvatar(deps.loadDatabase(), channelId),
    'https://yt3.googleusercontent.com/registered-via-selfheal.jpg',
    'a self-healed channel must ALSO be folded into the canonical, channelId-keyed registry, not just cached on the subscription',
  );
});

test('runPoll: a self-heal probe with NO channelId never writes into the canonical registry (nothing to key it by), but still backfills the subscription\'s own avatar', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, {
    channelUrl: 'https://www.youtube.com/@selfhealnoidatall',
    format: 'video',
    quality: 'best',
  });

  run.probeChannelAvatar = async (channelUrl) => ({ avatarUrl: 'https://yt3.googleusercontent.com/no-id-selfheal.jpg', channelId: null, channelUrl });
  run.runList = async () => ({ ok: true, stdout: ndjson([]), stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [] });

  await ytdlp.runPoll(deps, baseConfig());

  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.channelAvatarUrl, 'https://yt3.googleusercontent.com/no-id-selfheal.jpg', 'the subscription\'s own cached field must still be written even with no channelId');
  assert.deepEqual(store.ensureYtdlp(deps.loadDatabase()).channelAvatars, {}, 'no channelId to key the registry write by -- the registry must stay untouched');
});

test('runPoll: a MASS avatar-less backlog self-heal registry writes still respect the AVATAR_SELFHEAL_PER_POLL throttle -- at most 8 registry entries in one poll', async () => {
  const deps = makeFakeDeps();
  const total = ytdlp.AVATAR_SELFHEAL_PER_POLL + 5;
  for (let i = 0; i < total; i += 1) {
    await store.addSubscription(deps, {
      channelUrl: `https://www.youtube.com/@registerbacklog${i}`,
      format: 'video',
      quality: 'best',
    });
  }

  let probeCalls = 0;
  run.probeChannelAvatar = async (channelUrl) => {
    probeCalls += 1;
    return {
      avatarUrl: 'https://yt3.googleusercontent.com/registered-backlog.jpg',
      channelId: mkChannelId(`registered-backlog-${probeCalls}`),
      channelUrl,
    };
  };
  run.runList = async () => ({ ok: true, stdout: ndjson([]), stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [] });

  await ytdlp.runPoll(deps, baseConfig());

  assert.equal(probeCalls, ytdlp.AVATAR_SELFHEAL_PER_POLL, 'sanity: the throttle still caps probes at AVATAR_SELFHEAL_PER_POLL');
  const registeredCount = Object.keys(store.ensureYtdlp(deps.loadDatabase()).channelAvatars).length;
  assert.equal(registeredCount, ytdlp.AVATAR_SELFHEAL_PER_POLL, 'the registry write must be throttled exactly like the probe itself -- never more than AVATAR_SELFHEAL_PER_POLL entries in one poll');
});

test('runPoll: a self-heal probe failure never breaks the poll -- status is still recorded and the scan is still triggered', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, {
    channelUrl: 'https://www.youtube.com/@probefails',
    format: 'video',
    quality: 'best',
  });

  run.probeChannelAvatar = async () => {
    throw new Error('boom: defense-in-depth -- probeChannelAvatar is documented to never reject, but the self-heal wiring survives it anyway');
  };
  run.runList = async () => ({ ok: true, stdout: ndjson([]), stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [] });

  const result = await ytdlp.runPoll(deps, baseConfig());
  assert.equal(result.started, true);

  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.channelAvatarUrl, undefined);
  assert.ok(typeof persisted.lastCheckedAt === 'string' && persisted.lastCheckedAt !== '', 'poll status bookkeeping must still complete despite the probe failure');
  assert.ok(persisted.lastStatus.startsWith('ok'), `expected a successful cycle status, got ${persisted.lastStatus}`);
  assert.equal(deps.scanCalls.length, 1, 'the post-poll scan trigger must still fire despite the probe failure');
});

test('runPoll: self-heal runs regardless of whether the subscription\'s own cycle succeeded or errored', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, {
    channelUrl: 'https://www.youtube.com/@cyclefails',
    format: 'video',
    quality: 'best',
  });

  let probeCalls = 0;
  run.probeChannelAvatar = async () => {
    probeCalls += 1;
    return { avatarUrl: 'https://yt3.googleusercontent.com/healed-despite-error.jpg', channelId: null, channelUrl: null };
  };
  // Force the listing pass itself to fail -- runSubscriptionCycle returns a
  // non-'ok' status, but the self-heal must still run.
  run.runList = async () => ({ ok: false, code: 1, stdout: '', stderr: 'boom', error: 'yt-dlp exited with code 1' });

  await ytdlp.runPoll(deps, baseConfig());

  assert.equal(probeCalls, 1, 'self-heal must run even when the listing/download cycle itself failed');
  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.channelAvatarUrl, 'https://yt3.googleusercontent.com/healed-despite-error.jpg');
  assert.notEqual(persisted.lastStatus, 'ok', 'sanity: the cycle itself really did fail');
});

// ---- v1.25 QoL bugfix (two-reviewer gate follow-up): per-poll throttle ----
//
// AVATAR_SELFHEAL_PER_POLL caps how many avatar self-heal probes a SINGLE
// `runPoll` cycle performs in total, across every targeted subscription --
// see that constant's own doc comment (lib/ytdlp/index.js) for the "don't
// hog the shared download gate on the first post-upgrade poll" rationale.

test('runPoll: a MASS avatar-less backlog (more subs than AVATAR_SELFHEAL_PER_POLL) performs at most AVATAR_SELFHEAL_PER_POLL probes in ONE poll cycle', async () => {
  const deps = makeFakeDeps();
  const total = ytdlp.AVATAR_SELFHEAL_PER_POLL + 5;
  for (let i = 0; i < total; i += 1) {
    await store.addSubscription(deps, {
      channelUrl: `https://www.youtube.com/@backlog${i}`,
      format: 'video',
      quality: 'best',
    });
  }

  let probeCalls = 0;
  run.probeChannelAvatar = async () => {
    probeCalls += 1;
    return { avatarUrl: 'https://yt3.googleusercontent.com/backlog-avatar.jpg', channelId: null, channelUrl: null };
  };
  run.runList = async () => ({ ok: true, stdout: ndjson([]), stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [] });

  const result = await ytdlp.runPoll(deps, baseConfig());
  assert.equal(result.started, true);
  assert.equal(result.count, total, 'sanity: every subscription was still TARGETED by this poll (only the avatar probe itself is throttled, not listing/download)');
  assert.equal(probeCalls, ytdlp.AVATAR_SELFHEAL_PER_POLL, 'at most AVATAR_SELFHEAL_PER_POLL probes must run in one poll cycle');

  const healed = store.listSubscriptions(deps).filter((s) => typeof s.channelAvatarUrl === 'string' && s.channelAvatarUrl !== '');
  assert.equal(healed.length, ytdlp.AVATAR_SELFHEAL_PER_POLL);
});

test('runPoll: a subsequent poll picks up the NEXT batch of avatar-less subscriptions the first poll\'s budget left untouched', async () => {
  const deps = makeFakeDeps();
  // Comfortably more than TWO full budgets' worth, so the second poll still
  // has enough remaining backlog to spend its own FULL budget too (not just
  // whatever scraps were left after the first poll).
  const total = (ytdlp.AVATAR_SELFHEAL_PER_POLL * 2) + 3;
  for (let i = 0; i < total; i += 1) {
    await store.addSubscription(deps, {
      channelUrl: `https://www.youtube.com/@batch${i}`,
      format: 'video',
      quality: 'best',
    });
  }

  let probeCalls = 0;
  const probedUrls = new Set();
  run.probeChannelAvatar = async (channelUrl) => {
    probeCalls += 1;
    probedUrls.add(channelUrl);
    return { avatarUrl: 'https://yt3.googleusercontent.com/batch-avatar.jpg', channelId: null, channelUrl: null };
  };
  run.runList = async () => ({ ok: true, stdout: ndjson([]), stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [] });

  await ytdlp.runPoll(deps, baseConfig());
  assert.equal(probeCalls, ytdlp.AVATAR_SELFHEAL_PER_POLL, 'sanity: first poll only spends its own budget');
  const firstBatchUrls = new Set(probedUrls);
  assert.equal(firstBatchUrls.size, ytdlp.AVATAR_SELFHEAL_PER_POLL, 'sanity: no duplicate probes within the first poll');

  // Second poll: a FRESH budget, and the subs the first poll's budget left
  // untouched (still avatar-less) are exactly what qualifies now.
  await ytdlp.runPoll(deps, baseConfig());
  assert.equal(probeCalls, ytdlp.AVATAR_SELFHEAL_PER_POLL * 2, 'the second poll must spend its own full budget on the REMAINING backlog');
  assert.equal(probedUrls.size, ytdlp.AVATAR_SELFHEAL_PER_POLL * 2, 'the cumulative set of probed URLs must have grown by a FULL fresh batch -- the second poll must never re-probe a URL the first poll already healed');
  for (const url of firstBatchUrls) {
    assert.ok(probedUrls.has(url), 'sanity: the first batch is a subset of the cumulative probed set');
  }

  const healed = store.listSubscriptions(deps).filter((s) => typeof s.channelAvatarUrl === 'string' && s.channelAvatarUrl !== '');
  assert.equal(healed.length, ytdlp.AVATAR_SELFHEAL_PER_POLL * 2, 'exactly two polls\' worth of budget must have been spent, no double-healing');
});

test('runPoll: subscriptions that ALREADY have an avatar are never probed, even when the backlog exceeds the budget (budget is spent only on qualifying subs)', async () => {
  const deps = makeFakeDeps();
  // Two already-healed subs, interleaved with an avatar-less backlog larger
  // than the budget -- the already-healed ones must never consume budget.
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@already1', format: 'video', quality: 'best' });
  await store.recordSubscriptionChannelAvatar(deps, 'https://www.youtube.com/@already1', 'https://yt3.googleusercontent.com/already1.jpg');
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@already2', format: 'video', quality: 'best' });
  await store.recordSubscriptionChannelAvatar(deps, 'https://www.youtube.com/@already2', 'https://yt3.googleusercontent.com/already2.jpg');

  const total = ytdlp.AVATAR_SELFHEAL_PER_POLL + 3;
  for (let i = 0; i < total; i += 1) {
    await store.addSubscription(deps, { channelUrl: `https://www.youtube.com/@needsavatar${i}`, format: 'video', quality: 'best' });
  }

  const probedChannelUrls = [];
  run.probeChannelAvatar = async (channelUrl) => {
    probedChannelUrls.push(channelUrl);
    return { avatarUrl: 'https://yt3.googleusercontent.com/needs-avatar.jpg', channelId: null, channelUrl: null };
  };
  run.runList = async () => ({ ok: true, stdout: ndjson([]), stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [] });

  await ytdlp.runPoll(deps, baseConfig());

  assert.equal(probedChannelUrls.length, ytdlp.AVATAR_SELFHEAL_PER_POLL);
  assert.ok(!probedChannelUrls.includes('https://www.youtube.com/@already1'), 'an already-avatared subscription must never be probed');
  assert.ok(!probedChannelUrls.includes('https://www.youtube.com/@already2'), 'an already-avatared subscription must never be probed');
});

test('POST /api/subscriptions: the subscribe-time probe is UNTHROTTLED -- back-to-back subscribes of more channels than AVATAR_SELFHEAL_PER_POLL each still get their own probe', async () => {
  const deps = makeFakeDeps();
  let probeCalls = 0;
  run.probeChannelAvatar = async () => {
    probeCalls += 1;
    return { avatarUrl: 'https://yt3.googleusercontent.com/unthrottled.jpg', channelId: null, channelUrl: null };
  };

  const total = ytdlp.AVATAR_SELFHEAL_PER_POLL + 4;
  const { base, close } = await startTestApp(deps, baseConfig());
  try {
    for (let i = 0; i < total; i += 1) {
      const res = await postJson(base, '/api/subscriptions', { channelUrl: `https://www.youtube.com/@unthrottled${i}`, format: 'video' });
      assert.equal(res.status, 201);
    }
    await flush();
    assert.equal(probeCalls, total, 'the subscribe-time probe path must never be gated by the poll-only avatar budget');
  } finally {
    await close();
  }
});

// ---- Disabled module: no route, no probe, pure no-op ----------------------

test('disabled module: POST /api/subscriptions 404s and never reaches probeChannelAvatar at all', async () => {
  const deps = makeFakeDeps();
  let probeCalls = 0;
  run.probeChannelAvatar = async () => {
    probeCalls += 1;
    return 'https://yt3.googleusercontent.com/should-never-be-called.jpg';
  };

  const { base, close } = await startTestApp(deps, baseConfig({ enabled: false }));
  try {
    const res = await postJson(base, '/api/subscriptions', { channelUrl: 'https://www.youtube.com/@disabled', format: 'video' });
    assert.equal(res.status, 404, 'the route itself must be absent when disabled -- native Express 404');
    await flush();
    assert.equal(probeCalls, 0, 'a disabled module must never call probeChannelAvatar');
  } finally {
    await close();
  }
});
