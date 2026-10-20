'use strict';

// [INTEGRATION] v1.392.0 (plan 2026-10-20-download-hang, F2 + R5): the boot catch-up poll. `startBackground` only
// armed a `setInterval` of `pollMinutes`, so every restart pushed the next subscription poll a full interval out
// (releases less than an interval apart meant no poll ever ran). The poll now keeps a persisted ledger
// (`lastPollAt`, in the engine state store) and runs ONE catch-up poll after boot when it is missing or overdue.
// Driven through the real `startBackground` (reachability), with the poll's list step stubbed at the
// `run.runList` seam so a poll is observable (and touches no network).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const ytdlp = require('../../lib/ytdlp');
const engine = require('../../lib/ytdlp/engine');
const run = require('../../lib/ytdlp/run');
const store = require('../../lib/ytdlp/store');
const ytdlpStoreModule = require('../../lib/ytdlp/store');
const { featureStoreFor, docView } = require('../helpers/scratch-feature-store');

const originalRunList = run.runList;
const originalVersion = run.getYtdlpVersion;
const originalAvatar = run.probeChannelAvatar;
const originalFollowers = run.probeChannelFollowerCount;
const DELAY_MS = 30;
let dataDir;
let listCalls;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-boot-poll-'));
  listCalls = 0;
  run.runList = async () => {
    listCalls += 1;
    return { ok: true, stdout: '', stderr: '' };
  };
  run.getYtdlpVersion = async () => null; // startBackground's version-cache prime: no real spawn
  run.probeChannelAvatar = async () => null; // the poll's channel probes: no real spawn, no network
  run.probeChannelFollowerCount = async () => null;
  ytdlp.setBootPollDelayForTests(DELAY_MS);
});

afterEach(() => {
  for (const t of [ytdlp.currentYtdlpPollTimer(), ytdlp.currentEngineTimer()]) if (t) clearInterval(t);
  const boot = ytdlp.currentBootPollTimer();
  if (boot) clearTimeout(boot);
  ytdlp.setBootPollDelayForTests(undefined);
  ytdlp.resetPollRerunStateForTests();
  run.runList = originalRunList;
  run.getYtdlpVersion = originalVersion;
  run.probeChannelAvatar = originalAvatar;
  run.probeChannelFollowerCount = originalFollowers;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeDeps() {
  const db = {};
  return {
    dataDir,
    ytdlpDb: featureStoreFor(ytdlpStoreModule.FEATURE, db),
    loadDatabase: () => docView(db, featureStoreFor(ytdlpStoreModule.FEATURE, db)),
    updateDatabase: (fn) => Promise.resolve(fn(db)),
    scanDirectories: async () => {},
    getMediaId: (s) => crypto.createHash('md5').update(s).digest('hex'),
  };
}

function config(pollMinutes, extra = {}) {
  return ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: String(pollMinutes),
    FILETUBE_YTDLP_DOWNLOAD_DIR: path.join(dataDir, 'dl'),
    ...extra,
  });
}

async function withSubscription(deps) {
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@somechannel', format: 'video', quality: 'best' });
}

function setLedger(lastPollAt) {
  const state = engine.readState(dataDir);
  state.lastPollAt = lastPollAt;
  engine.writeState(dataDir, state);
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

test('boot with an OVERDUE ledger: startBackground runs exactly one catch-up poll after the delay, and records the ledger', async () => {
  const deps = makeDeps();
  await withSubscription(deps);
  setLedger(Date.now() - 3 * 60 * 60 * 1000); // 3 h ago, interval 60 min
  const before = Date.now();
  ytdlp.startBackground(deps, config(60));
  assert.ok(ytdlp.currentBootPollTimer(), 'a catch-up poll is armed');
  assert.ok(ytdlp.currentYtdlpPollTimer(), 'the interval stays armed as before');
  assert.equal(listCalls, 0, 'not at boot itself: after the delay');
  await settle(DELAY_MS + 400);
  assert.equal(listCalls, 1, 'exactly one catch-up poll ran');
  assert.ok(engine.readState(dataDir).lastPollAt >= before, 'the finished poll recorded the ledger');
});

test('first boot with NO ledger counts as due', async () => {
  const deps = makeDeps();
  await withSubscription(deps);
  ytdlp.startBackground(deps, config(60));
  await settle(DELAY_MS + 400);
  assert.equal(listCalls, 1);
});

test('boot with a FRESH ledger does not poll (the interval alone covers it)', async () => {
  const deps = makeDeps();
  await withSubscription(deps);
  setLedger(Date.now() - 5 * 60 * 1000); // 5 min ago, interval 60 min
  ytdlp.startBackground(deps, config(60));
  assert.equal(ytdlp.currentBootPollTimer(), null);
  await settle(DELAY_MS + 300);
  assert.equal(listCalls, 0);
});

test('pollMinutes 0 (manual only) never polls at boot, even with no ledger', async () => {
  const deps = makeDeps();
  await withSubscription(deps);
  ytdlp.startBackground(deps, config(0));
  assert.equal(ytdlp.currentBootPollTimer(), null);
  await settle(DELAY_MS + 300);
  assert.equal(listCalls, 0);
});

test('read-only media mode stays a no-op at boot', async () => {
  const deps = makeDeps();
  await withSubscription(deps);
  ytdlp.startBackground(deps, config(60, { FILETUBE_READ_ONLY_MEDIA: '1' }));
  assert.equal(ytdlp.currentBootPollTimer(), null);
  await settle(DELAY_MS + 300);
  assert.equal(listCalls, 0);
});

test('the ledger survives a reload and the engine\'s own writes (same store, same atomic write)', () => {
  const at = Date.now() - 1234;
  ytdlp.recordPollRan({ dataDir }, at);
  const raw = JSON.parse(fs.readFileSync(engine.resolveStatePath(dataDir), 'utf8'));
  assert.equal(raw.lastPollAt, at, 'written to the engine state file');
  assert.equal(engine.readState(dataDir).lastPollAt, at, 'read back after a reload (the sanitizer keeps it)');
  engine.setAutoUpdate({ dataDir, enabled: true });
  assert.equal(engine.readState(dataDir).lastPollAt, at, 'an engine write keeps the poll ledger');
});

test('only an all-subscriptions poll writes the ledger; a single-channel re-pull does not', async () => {
  const deps = makeDeps();
  await withSubscription(deps);
  const sub = store.listSubscriptions(deps)[0];
  await ytdlp.runPoll(deps, config(60), sub.id);
  assert.equal(engine.readState(dataDir).lastPollAt, null, 'a single-channel re-pull is not the timer\'s poll');
  await ytdlp.runPoll(deps, config(60));
  assert.ok(engine.readState(dataDir).lastPollAt > 0, 'the all-subscriptions poll records it');
});

test('bootPollDue: missing = due, older than the interval = due, inside it = not, interval 0 = never', () => {
  const now = 10 * 60 * 60 * 1000;
  assert.equal(ytdlp.bootPollDue(null, 60, now), true);
  assert.equal(ytdlp.bootPollDue(now - 60 * 60 * 1000, 60, now), true);
  assert.equal(ytdlp.bootPollDue(now - 59 * 60 * 1000, 60, now), false);
  assert.equal(ytdlp.bootPollDue(null, 0, now), false);
  assert.equal(ytdlp.bootPollDue(now + 60 * 60 * 1000, 60, now), true, 'a ledger in the future (clock moved back) is not trusted');
  assert.equal(ytdlp.BOOT_POLL_DELAY_MS, 2 * 60 * 1000, 'production waits 2 min after boot');
});
