'use strict';

// [INTEGRATION] The T4 download-loop orchestration (lib/ytdlp/index.js's
// `runPoll`), covering AC 14-17, 19. `run.runList`/`run.runDownload` are
// MOCKED by monkey-patching the module object's own methods (mirrors the
// pattern already used for `store` -- `index.js` calls `run.runList(...)`/
// `run.runDownload(...)`, never a destructured local, specifically so this
// works) -- NO real yt-dlp binary or network is ever touched. Uses the same
// tiny in-memory fake `updateDatabase`/`loadDatabase` deps established in
// test/unit/ytdlp-store.test.js, extended here to record WHEN each
// updateDatabase call happens (for the no-lock-across-download proof).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const store = require('../../lib/ytdlp/store');
const args = require('../../lib/ytdlp/args');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-poll-'));
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// A minimal fake of server.js's updateDatabase/loadDatabase pair (same shape
// as ytdlp-store.test.js's makeFakeDeps), extended with call-order/timing
// instrumentation and a fake scanDirectories so tests can assert both were
// invoked and WHEN, without a real db.json or a real scanner.
function makeFakeDeps(initialDb = {}) {
  let db = initialDb;
  const events = [];
  const scanCalls = [];
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => {
      events.push({ type: 'updateDatabase', at: Date.now() });
      const result = mutatorFn(db);
      return Promise.resolve(result);
    },
    scanDirectories: async () => {
      scanCalls.push(Date.now());
    },
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
    events,
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

// ---- AC14/17/20-26: a poll applies the filters, downloads only survivors,
// records a SAFE status, and triggers a scan --------------------------------

test('runPoll applies isArchived/premiere/skip filters, downloads only survivors, records a SAFE status, and triggers a scan', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps);

  const archivedVideo = { id: 'archived1', extractor_key: 'youtube', availability: 'public' };
  const premiereVideo = { id: 'premiere1', availability: 'public', live_status: 'is_upcoming' };
  const membersVideo = { id: 'members1', availability: 'subscriber_only' };
  const survivorVideo = { id: 'survivor1', availability: 'public' };

  // Archive already contains `archivedVideo`'s id -- write it to the REAL
  // archive path this config resolves to, since `readArchiveTextSafely`
  // reads the actual file (this is what proves AC18/19 dedup end-to-end).
  fs.writeFileSync(args.resolveArchivePath(baseConfig()), 'youtube archived1\n', 'utf8');

  let downloadCalls = 0;
  run.runList = async () => ({ ok: true, stdout: ndjson([archivedVideo, premiereVideo, membersVideo, survivorVideo]), stderr: '' });
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const config = baseConfig();
  const result = await ytdlp.runPoll(deps, config);
  assert.equal(result.started, true);
  assert.equal(result.count, 1);

  // Only the one true survivor should have triggered a download attempt --
  // archived/premiere/members-only videos never cause a spawn (a SINGLE
  // runDownload call handles the whole channel's survivors).
  assert.equal(downloadCalls, 1);

  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.id, sub.id);
  assert.ok(persisted.lastStatus.startsWith('ok'), `expected a safe ok status, got: ${persisted.lastStatus}`);
  assert.ok(persisted.lastCheckedAt);

  assert.equal(deps.scanCalls.length, 1, 'scanDirectories must be triggered after processing the subscription (AC17)');
});

// ---- AC19: re-polling with nothing new means zero download attempts -------

test('re-polling a subscription with no new videos (all already archived) results in zero download attempts (AC19)', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  const config = baseConfig();
  fs.writeFileSync(args.resolveArchivePath(config), 'youtube already-have-it\n', 'utf8');

  let downloadCalls = 0;
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'already-have-it', extractor_key: 'youtube', availability: 'public' }]), stderr: '' });
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  await ytdlp.runPoll(deps, config);
  assert.equal(downloadCalls, 0, 'an already-archived video must never trigger a download attempt');

  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.lastStatus, 'ok: no new videos');
});

// ---- AC15/16: re-pull-all / re-pull-one, unknown id -> not-found ----------

test('runPoll(deps, config) with no subId polls every subscription', async () => {
  const deps = makeFakeDeps();
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanA' });
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanB' });

  let listCalls = 0;
  run.runList = async () => {
    listCalls += 1;
    return { ok: true, stdout: '', stderr: '' };
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const result = await ytdlp.runPoll(deps, baseConfig());
  assert.equal(result.started, true);
  assert.equal(result.count, 2);
  assert.equal(listCalls, 2);
});

test('runPoll(deps, config, subId) polls only that one subscription', async () => {
  const deps = makeFakeDeps();
  const subA = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanA' });
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanB' });

  const listedSubs = [];
  run.runList = async (sub) => {
    listedSubs.push(sub.id);
    return { ok: true, stdout: '', stderr: '' };
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const result = await ytdlp.runPoll(deps, baseConfig(), subA.id);
  assert.equal(result.started, true);
  assert.equal(result.count, 1);
  assert.deepEqual(listedSubs, [subA.id]);
});

test('runPoll(deps, config, unknownId) returns not-found without calling runList', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  let listCalls = 0;
  run.runList = async () => {
    listCalls += 1;
    return { ok: true, stdout: '', stderr: '' };
  };

  const result = await ytdlp.runPoll(deps, baseConfig(), 'no-such-subscription-id');
  assert.deepEqual(result, { started: false, reason: 'not-found' });
  assert.equal(listCalls, 0);
});

// ---- NFR5: a failing subscription logs redacted + the loop continues ------

test('a subscription whose runList fails does not crash/hang the loop -- the next subscription still runs', async () => {
  const deps = makeFakeDeps();
  const subA = await addSub(deps, { channelUrl: 'https://www.youtube.com/@failing' });
  const subB = await addSub(deps, { channelUrl: 'https://www.youtube.com/@healthy' });

  const attempted = [];
  run.runList = async (sub) => {
    attempted.push(sub.id);
    if (sub.id === subA.id) {
      return { ok: false, code: 1, stdout: '', stderr: '', error: 'yt-dlp exited with code 1' };
    }
    return { ok: true, stdout: '', stderr: '' };
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const result = await ytdlp.runPoll(deps, baseConfig());
  assert.equal(result.started, true);
  assert.equal(result.count, 2);
  assert.deepEqual(attempted.sort(), [subA.id, subB.id].sort(), 'both subscriptions must have been attempted -- the failure must not stop the loop');

  const subs = store.listSubscriptions(deps);
  const failedRecord = subs.find((s) => s.id === subA.id);
  const healthyRecord = subs.find((s) => s.id === subB.id);
  assert.ok(failedRecord.lastStatus.startsWith('error:'), `expected an error status for the failing subscription, got: ${failedRecord.lastStatus}`);
  assert.ok(healthyRecord.lastStatus.startsWith('ok'), `expected the healthy subscription to still succeed, got: ${healthyRecord.lastStatus}`);
});

test('a subscription whose runDownload throws synchronously is caught, logged, and the loop continues', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'x1', availability: 'public' }]), stderr: '' });
  run.runDownload = () => {
    throw new Error('synchronous boom from a hostile builder input');
  };

  const result = await ytdlp.runPoll(deps, baseConfig());
  assert.equal(result.started, true, 'a synchronous throw inside one subscription must never propagate out of runPoll');

  const [persisted] = store.listSubscriptions(deps);
  assert.ok(persisted.lastStatus.startsWith('error:'));
});

// ---- Overlap guard: two concurrent polls never stack -----------------------

test('a second runPoll call while one is in-flight coalesces to a busy no-op', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  let resolveList;
  run.runList = () => new Promise((resolve) => {
    resolveList = () => resolve({ ok: true, stdout: '', stderr: '' });
  });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const firstPollPromise = ytdlp.runPoll(deps, baseConfig());
  // Give the first call a tick to reach its in-flight `pollBusy = true` state
  // before firing the second trigger.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ytdlp.isPollBusy(), true);

  const secondResult = await ytdlp.runPoll(deps, baseConfig());
  assert.deepEqual(secondResult, { started: false, reason: 'busy' });

  resolveList();
  const firstResult = await firstPollPromise;
  assert.equal(firstResult.started, true);
  assert.equal(ytdlp.isPollBusy(), false);
});

// ---- The v1.9.0 lesson: the updateDatabase lock is NEVER held across the
// (mocked) download await --------------------------------------------------

test('the updateDatabase lock (mutator call) never happens while a download is in flight', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  const timeline = [];
  const originalUpdateDatabase = deps.updateDatabase;
  deps.updateDatabase = (mutatorFn) => {
    timeline.push({ type: 'updateDatabase', at: Date.now() });
    return originalUpdateDatabase(mutatorFn);
  };

  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'v1', availability: 'public' }]), stderr: '' });
  run.runDownload = async () => {
    timeline.push({ type: 'download-start', at: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, 15));
    timeline.push({ type: 'download-end', at: Date.now() });
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  await ytdlp.runPoll(deps, baseConfig());

  const downloadStart = timeline.find((e) => e.type === 'download-start').at;
  const downloadEnd = timeline.find((e) => e.type === 'download-end').at;
  const updateDatabaseCalls = timeline.filter((e) => e.type === 'updateDatabase');
  assert.ok(updateDatabaseCalls.length >= 1, 'the status write must still happen');
  for (const call of updateDatabaseCalls) {
    assert.ok(
      call.at < downloadStart || call.at >= downloadEnd,
      'updateDatabase must never be called WHILE a download await is in flight (the v1.9.0 lock-across-await lesson)',
    );
  }
});

// ---- SF1: lastStatus never carries a cookies path, even from an upstream-
// leaked error message ------------------------------------------------------

test('lastStatus never contains the cookies path, even when the mocked download "leaks" it in error.message', async () => {
  const deps = makeFakeDeps();
  const cookiesPath = '/very/secret/mounted/cookies.txt';
  const config = baseConfig({ cookiesFile: cookiesPath });
  await addSub(deps);

  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'v1', availability: 'public' }]), stderr: '' });
  // Simulate the pre-SF1 leak class: an upstream error whose message still
  // embeds the cookies path (as if run.js's own redaction had somehow been
  // bypassed) -- this proves index.js's OWN redaction pass is a real,
  // independent second line of defense, not just trusting run.js.
  run.runDownload = async () => ({
    ok: false,
    code: 1,
    stdout: '',
    stderr: '',
    error: `Command failed: yt-dlp --dump-json --cookies ${cookiesPath} -- https://www.youtube.com/@x\nsome stderr mentioning ${cookiesPath} again`,
  });

  await ytdlp.runPoll(deps, config);

  const [persisted] = store.listSubscriptions(deps);
  assert.ok(!persisted.lastStatus.includes(cookiesPath), `cookies path leaked into lastStatus: ${persisted.lastStatus}`);
  assert.ok(persisted.lastStatus.startsWith('error:'));
});

test('lastStatus never contains the cookies path when runList itself fails with a leaking message', () => {
  const deps = makeFakeDeps();
  const cookiesPath = '/another/secret/cookies.txt';
  const config = baseConfig({ cookiesFile: cookiesPath });

  return addSub(deps).then(async () => {
    run.runList = async () => ({
      ok: false,
      code: 1,
      stdout: '',
      stderr: '',
      error: `Command failed: yt-dlp --dump-json --cookies ${cookiesPath} -- https://www.youtube.com/@x`,
    });

    await ytdlp.runPoll(deps, config);
    const [persisted] = store.listSubscriptions(deps);
    assert.ok(!persisted.lastStatus.includes(cookiesPath), `cookies path leaked into lastStatus: ${persisted.lastStatus}`);
  });
});

// ---- SF4: an escaped downloaded file (symlink trick) is quarantined, never
// silently indexed -----------------------------------------------------------

test('a file that resolves outside the confined channel dir after download is quarantined (removed) before the scan trigger', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps);
  const config = baseConfig();

  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'v1', availability: 'public' }]), stderr: '' });

  const channelDir = args.resolveChannelDir(config, sub);
  fs.mkdirSync(channelDir, { recursive: true });
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-outside-'));
  const outsideFile = path.join(outsideDir, 'escaped.mp4');
  fs.writeFileSync(outsideFile, 'not a real video');
  const escapedLinkPath = path.join(channelDir, 'escaped-link.mp4');
  try {
    fs.symlinkSync(outsideFile, escapedLinkPath);
  } catch (err) {
    // Some sandboxed CI environments disallow symlink creation entirely --
    // this test is meaningless there either way, so skip gracefully rather
    // than fail on an environment limitation unrelated to the code under test.
    if (err && err.code === 'EPERM') return;
    throw err;
  }

  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  await ytdlp.runPoll(deps, config);

  assert.equal(fs.existsSync(escapedLinkPath), false, 'the escaped symlink must have been quarantined (removed)');
  assert.equal(fs.existsSync(outsideFile), true, 'quarantine must only remove the link INSIDE the channel dir, never the outside target');

  const [persisted] = store.listSubscriptions(deps);
  assert.ok(persisted.lastStatus.includes('quarantined'), `expected a quarantine-mentioning status, got: ${persisted.lastStatus}`);

  fs.rmSync(outsideDir, { recursive: true, force: true });
});
