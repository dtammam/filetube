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
const activity = require('../../lib/ytdlp/activity');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-poll-'));
  activity.resetForTests();
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  activity.resetForTests();
  // F3 (T4 cleanup pass): `pollRerunTimer`/`pollRerunTarget` are module-level
  // singleton state shared by every test in this file (all requiring the
  // SAME `lib/ytdlp` instance). The E4 follow-up timer is an unref'd
  // `setTimeout(0)` -- each test that arms one already waits ~20ms for it to
  // fire, but that's a best-effort drain, not a guarantee. Reset explicitly
  // here so a slow/starved event loop in one test can never leave
  // `pollRerunTimer` dangling non-null and silently block every subsequent
  // test's `schedulePollRerun` call (`if (pollRerunTimer) return;`).
  ytdlp.resetPollRerunStateForTests();
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

  // C2 fixture correction: `extractor_key` is realistically TitleCase
  // (`Youtube`), as `--dump-json` actually reports it -- the archive file
  // itself is lowercase (`youtube <id>`, below), exactly as yt-dlp writes it.
  // The unrealistic all-lowercase `'youtube'` fixture this test used to carry
  // masked the C2 case-mismatch bug (a case-SENSITIVE compare never matched a
  // real archived YouTube video, so nothing was ever correctly deduped).
  const archivedVideo = { id: 'archived1', extractor_key: 'Youtube', availability: 'public' };
  const premiereVideo = { id: 'premiere1', availability: 'public', live_status: 'is_upcoming' };
  const membersVideo = { id: 'members1', availability: 'subscriber_only' };
  const survivorVideo = { id: 'survivor1', availability: 'public' };

  // Archive already contains `archivedVideo`'s id -- write it to the REAL
  // archive path this config resolves to, since `readArchiveTextSafely`
  // reads the actual file (this is what proves AC18/19 dedup end-to-end).
  fs.writeFileSync(args.resolveArchivePath(baseConfig()), 'youtube archived1\n', 'utf8');

  let downloadCalls = 0;
  let capturedTargetIds = null;
  run.runList = async () => ({ ok: true, stdout: ndjson([archivedVideo, premiereVideo, membersVideo, survivorVideo]), stderr: '' });
  run.runDownload = async (_sub, _config, targetIds) => {
    downloadCalls += 1;
    capturedTargetIds = targetIds;
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
  // C1: assert the CONCRETE target id set, not merely the call count -- the
  // archived (C2, case-insensitive extractor match), deferred premiere, and
  // skipped members-only ids must never appear among the actual download
  // targets.
  assert.deepEqual(capturedTargetIds, ['survivor1']);

  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.id, sub.id);
  assert.ok(persisted.lastStatus.startsWith('ok'), `expected a safe ok status, got: ${persisted.lastStatus}`);
  assert.ok(persisted.lastCheckedAt);

  assert.equal(deps.scanCalls.length, 1, 'scanDirectories must be triggered after processing the subscription (AC17)');
});

// ---- v1.37.5 (Dean's "Skip" action): a skip-listed video is never a survivor

test('a video on the permanent skip list is excluded from the download targets, like the archive', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  const skippedVideo = { id: 'skipped1', extractor_key: 'Youtube', availability: 'public' };
  const survivorVideo = { id: 'survivor1', availability: 'public' };

  // The skip list lives at its own resolved path, sharing the archive's
  // `<extractor> <id>` line format (lowercase extractor, as yt-dlp writes it).
  fs.writeFileSync(args.resolveSkiplistPath(baseConfig()), 'youtube skipped1\n', 'utf8');

  let capturedTargetIds = null;
  run.runList = async () => ({ ok: true, stdout: ndjson([skippedVideo, survivorVideo]), stderr: '' });
  run.runDownload = async (_sub, _config, targetIds) => {
    capturedTargetIds = targetIds;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const result = await ytdlp.runPoll(deps, baseConfig());
  assert.equal(result.started, true);
  assert.deepEqual(capturedTargetIds, ['survivor1'], 'the skip-listed id must never appear among download targets');
});

// ---- D5: survivorIds is de-duplicated before building download args -------

test('D5: a video listed twice in one channel dump (duplicate id, e.g. under two tabs) counts once and produces a single download target', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  const dupVideo = { id: 'dupSurvivor', availability: 'public' };
  run.runList = async () => ({ ok: true, stdout: ndjson([dupVideo, dupVideo]), stderr: '' });

  let capturedTargetIds = null;
  run.runDownload = async (_sub, _config, targetIds) => {
    capturedTargetIds = targetIds;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  await ytdlp.runPoll(deps, baseConfig());

  assert.deepEqual(capturedTargetIds, ['dupSurvivor'], 'a duplicated id must appear exactly ONCE in the download target set (D5)');

  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.lastStatus, 'ok: downloaded 1 new video(s)', 'the persisted count must reflect ONE unique survivor, not two');
});

// ---- AC19: re-polling with nothing new means zero download attempts -------

test('re-polling a subscription with no new videos (all already archived) results in zero download attempts (AC19)', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  const config = baseConfig();
  // The archive file is lowercase, exactly as yt-dlp itself writes it --
  // `extractor_key` below is the realistic TitleCase `--dump-json` reports
  // (C2 fixture correction: this was an unrealistic all-lowercase `'youtube'`
  // that masked the case-mismatch bug).
  fs.writeFileSync(args.resolveArchivePath(config), 'youtube already-have-it\n', 'utf8');

  let downloadCalls = 0;
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'already-have-it', extractor_key: 'Youtube', availability: 'public' }]), stderr: '' });
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  await ytdlp.runPoll(deps, config);
  assert.equal(downloadCalls, 0, 'an already-archived video must never trigger a download attempt');

  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.lastStatus, 'ok: no new videos');
});

// ---- C1 MANDATED regression test: the download child's target set is -----
// ---- STRUCTURALLY bound to survivors -- a deferred premiere/live id and ---
// ---- a skipped members-only id must be ABSENT from the actual target set,--
// ---- not merely reflected in a call count. --------------------------------

test('C1: the download child is targeted ONLY at the surviving id -- a deferred is_live id and a skipped subscriber_only id are structurally absent from the target set', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  const survivorVideo = { id: 'publicSurvivorA', availability: 'public' };
  const deferredLiveVideo = { id: 'deferredLiveB', availability: 'public', live_status: 'is_live' };
  const skippedMembersVideo = { id: 'skippedMembersC', availability: 'subscriber_only' };

  run.runList = async () => ({
    ok: true,
    stdout: ndjson([survivorVideo, deferredLiveVideo, skippedMembersVideo]),
    stderr: '',
  });

  let capturedTargetIds = null;
  let capturedBuiltArgs = null;
  run.runDownload = async (capturedSub, capturedConfig, targetIds) => {
    capturedTargetIds = targetIds;
    // Build the REAL argv (via the production arg builder) from the actual
    // targetIds this call received, so the assertions below inspect the
    // concrete positional URLs after `--` handed to the spawn boundary, not
    // just the intermediate id array.
    capturedBuiltArgs = args.buildYtdlpDownloadArgs(capturedSub, capturedConfig, targetIds);
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  await ytdlp.runPoll(deps, baseConfig());

  // Assert on the CONCRETE target arg set -- never merely a call count.
  assert.deepEqual(capturedTargetIds, ['publicSurvivorA']);
  assert.ok(!capturedTargetIds.includes('deferredLiveB'), 'the deferred is_live id must never reach the download target set');
  assert.ok(!capturedTargetIds.includes('skippedMembersC'), 'the skipped members-only id must never reach the download target set');

  const sepIndex = capturedBuiltArgs.indexOf('--');
  assert.ok(sepIndex >= 0);
  const targetUrls = capturedBuiltArgs.slice(sepIndex + 1);
  assert.deepEqual(targetUrls, ['https://www.youtube.com/watch?v=publicSurvivorA']);
  assert.ok(!targetUrls.some((u) => u.includes('deferredLiveB')));
  assert.ok(!targetUrls.some((u) => u.includes('skippedMembersC')));
});

// ---- v1.15.0 item 4: BINDING Shorts exclusion in the survivor loop --------

test('skipShorts: true on the subscription excludes a Shorts video (JS filter, structurally binding) while a normal video still survives', async () => {
  const deps = makeFakeDeps();
  await addSub(deps, { skipShorts: true });

  const shortVideo = { id: 'shortA', availability: 'public', webpage_url: 'https://www.youtube.com/shorts/shortA' };
  const normalVideo = { id: 'normalB', availability: 'public', webpage_url: 'https://www.youtube.com/watch?v=normalB' };
  run.runList = async () => ({ ok: true, stdout: ndjson([shortVideo, normalVideo]), stderr: '' });

  let capturedTargetIds = null;
  run.runDownload = async (_sub, _config, targetIds) => {
    capturedTargetIds = targetIds;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  await ytdlp.runPoll(deps, baseConfig());

  assert.deepEqual(capturedTargetIds, ['normalB']);
  assert.ok(!capturedTargetIds.includes('shortA'), 'a Short must never reach the download target set when skipShorts is enabled');
});

test('skipShorts: false/absent on the subscription downloads BOTH Shorts and normal videos (default = download everything)', async () => {
  const deps = makeFakeDeps();
  await addSub(deps); // skipShorts unset -> backfilled/defaulted to false

  const shortVideo = { id: 'shortC', availability: 'public', webpage_url: 'https://www.youtube.com/shorts/shortC' };
  const normalVideo = { id: 'normalD', availability: 'public', webpage_url: 'https://www.youtube.com/watch?v=normalD' };
  run.runList = async () => ({ ok: true, stdout: ndjson([shortVideo, normalVideo]), stderr: '' });

  let capturedTargetIds = null;
  run.runDownload = async (_sub, _config, targetIds) => {
    capturedTargetIds = targetIds;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  await ytdlp.runPoll(deps, baseConfig());

  assert.deepEqual(capturedTargetIds.sort(), ['normalD', 'shortC']);
});

// ---- Members-only, cookies-present-but-toggle-off MANDATED regression -----
// ---- test: proves breach (b) (D2) is closed STRUCTURALLY, independent of --
// ---- whether a cookies file happens to exist on disk. ---------------------

test('members-only with a cookies file PRESENT on disk but allowMembersOnly toggle OFF: the id never enters the download target set', async () => {
  const cookiesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(cookiesDir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123'); // the file genuinely EXISTS on disk
  const deps = makeFakeDeps();
  await addSub(deps);
  // allowMembersOnly defaults to false (store.js's DEFAULT_YTDLP_NAMESPACE) --
  // never toggled on in this test.

  const membersOnlyVideo = { id: 'membersOnlyD', availability: 'subscriber_only' };
  const publicVideo = { id: 'publicE', availability: 'public' };
  run.runList = async () => ({ ok: true, stdout: ndjson([membersOnlyVideo, publicVideo]), stderr: '' });

  let capturedTargetIds = null;
  run.runDownload = async (_sub, _config, targetIds) => {
    capturedTargetIds = targetIds;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  try {
    await ytdlp.runPoll(deps, baseConfig({ cookiesFile }));

    assert.ok(!capturedTargetIds.includes('membersOnlyD'), 'a members-only id must never reach the download child, even though a cookies file exists on disk, when the toggle is off');
    assert.deepEqual(capturedTargetIds, ['publicE']);
  } finally {
    fs.rmSync(cookiesDir, { recursive: true, force: true });
  }
});

// ---- MAX_STATUS_LENGTH bound: a pathologically long redacted status is ----
// ---- truncated, never persisted unbounded. --------------------------------

test('a pathologically long download error is truncated to MAX_STATUS_LENGTH + "..." before being persisted', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  const hugeError = 'x'.repeat(ytdlp.MAX_STATUS_LENGTH * 5);
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'v1', availability: 'public' }]), stderr: '' });
  run.runDownload = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: hugeError });

  await ytdlp.runPoll(deps, baseConfig());

  const [persisted] = store.listSubscriptions(deps);
  assert.ok(persisted.lastStatus.startsWith('error:'));
  assert.ok(persisted.lastStatus.endsWith('...'), `expected a truncation marker, got: ${persisted.lastStatus}`);
  // 'error: ' (7 chars) + MAX_STATUS_LENGTH + '...' (3 chars).
  assert.equal(persisted.lastStatus.length, 7 + ytdlp.MAX_STATUS_LENGTH + 3);
});

// ---- C5: a coalesced re-pull requested mid-poll runs exactly ONCE more as -
// ---- a follow-up, never dropped, never an unbounded queue. ----------------

test('C5: a runPoll trigger arriving while one is in-flight is coalesced into exactly ONE follow-up poll', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  let listCalls = 0;
  let resolveFirstList;
  run.runList = () => {
    listCalls += 1;
    if (listCalls === 1) {
      return new Promise((resolve) => {
        resolveFirstList = () => resolve({ ok: true, stdout: '', stderr: '' });
      });
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const firstPollPromise = ytdlp.runPoll(deps, baseConfig());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ytdlp.isPollBusy(), true);

  // This second trigger, arriving while the first is still in flight, must
  // coalesce into a single follow-up rather than being silently dropped.
  const secondResult = await ytdlp.runPoll(deps, baseConfig());
  assert.deepEqual(secondResult, { started: false, reason: 'busy' });

  resolveFirstList();
  await firstPollPromise;

  // Give the unref'd setTimeout(0) follow-up a tick to actually run.
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(listCalls, 2, 'exactly ONE follow-up poll must have run (not zero, not more than one)');
  assert.equal(ytdlp.isPollBusy(), false);
});

// ---- D3: the coalesced follow-up re-runs only the requested target --------

test('D3: a coalesced re-pull-ONE re-runs only the requested subscription, never a full re-pull-all', async () => {
  const deps = makeFakeDeps();
  const subA = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanA' });
  const subB = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanB' });

  const listedSubIds = [];
  let resolveFirstList;
  run.runList = (sub) => {
    listedSubIds.push(sub.id);
    if (listedSubIds.length === 1) {
      return new Promise((resolve) => {
        resolveFirstList = () => resolve({ ok: true, stdout: '', stderr: '' });
      });
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  // A re-pull-ONE for subA is in flight (hung on runList).
  const firstPollPromise = ytdlp.runPoll(deps, baseConfig(), subA.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ytdlp.isPollBusy(), true);

  // While busy, a re-pull-ONE for a DIFFERENT subscription (subB) coalesces.
  const coalesced = await ytdlp.runPoll(deps, baseConfig(), subB.id);
  assert.deepEqual(coalesced, { started: false, reason: 'busy' });

  resolveFirstList();
  await firstPollPromise;

  // Give the unref'd setTimeout(0) follow-up a tick to actually run.
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(listedSubIds, [subA.id, subB.id], 'the follow-up must have polled ONLY subB -- never re-polling subA, never polling every subscription (D3)');
});

test('D3: a specific re-pull-one and a general re-pull-all coalescing together escalate the follow-up to a full re-pull-all', async () => {
  const deps = makeFakeDeps();
  const subA = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanA' });
  const subB = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanB' });

  const listedSubIds = [];
  let resolveFirstList;
  run.runList = (sub) => {
    listedSubIds.push(sub.id);
    if (listedSubIds.length === 1) {
      return new Promise((resolve) => {
        resolveFirstList = () => resolve({ ok: true, stdout: '', stderr: '' });
      });
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const firstPollPromise = ytdlp.runPoll(deps, baseConfig(), subA.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ytdlp.isPollBusy(), true);

  // A specific coalesce (subB) followed by a general ("all") coalesce, both
  // while busy -- together these must escalate the single follow-up to a
  // full re-pull-all so neither request is silently dropped.
  const coalescedSpecific = await ytdlp.runPoll(deps, baseConfig(), subB.id);
  assert.deepEqual(coalescedSpecific, { started: false, reason: 'busy' });
  const coalescedGeneral = await ytdlp.runPoll(deps, baseConfig());
  assert.deepEqual(coalescedGeneral, { started: false, reason: 'busy' });

  resolveFirstList();
  await firstPollPromise;

  await new Promise((resolve) => setTimeout(resolve, 20));

  // Initial poll targeted only subA; the escalated follow-up must poll EVERY
  // subscription (both subA and subB), not just the last-coalesced target.
  assert.deepEqual(listedSubIds, [subA.id, subA.id, subB.id], 'a specific + a general coalesced request must escalate to a full re-pull-all (D3)');
});

// ---- D4: an unknown subId 404s (not-found) even while a poll is busy, ------
// ---- and never arms a spurious coalesced follow-up. ------------------------

test('D4: an unknown subId returns not-found even while a poll is busy, and arms no coalesced follow-up', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  let listCalls = 0;
  let resolveFirstList;
  run.runList = () => {
    listCalls += 1;
    if (listCalls === 1) {
      return new Promise((resolve) => {
        resolveFirstList = () => resolve({ ok: true, stdout: '', stderr: '' });
      });
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const firstPollPromise = ytdlp.runPoll(deps, baseConfig());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ytdlp.isPollBusy(), true);

  const bogusResult = await ytdlp.runPoll(deps, baseConfig(), 'no-such-subscription-id');
  assert.deepEqual(bogusResult, { started: false, reason: 'not-found' }, 'a bogus id must resolve not-found even while a poll is busy, never coalescing into a follow-up (D4)');

  resolveFirstList();
  await firstPollPromise;

  // Give any (erroneous) follow-up a chance to fire, then assert none did.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(listCalls, 1, 'the bogus-id request must never have armed a coalesced follow-up poll');
});

// ---- T5/R1.5: the optional 5th `onDecision` param fires SYNCHRONOUSLY, ----
// ---- exactly once, before `runPoll`'s first `await` -- proving the ---------
// ---- repull routes can read the busy-vs-started decision without ----------
// ---- awaiting the whole (possibly long-running) poll. ----------------------

test('T5: onDecision fires synchronously with {started:true} before the first await, on the started path', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  run.runList = async () => ({ ok: true, stdout: '', stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const decisions = [];
  const pollPromise = ytdlp.runPoll(deps, baseConfig(), undefined, undefined, (decision) => {
    decisions.push(decision);
  });

  // No `await`/microtask yield has happened yet -- if `onDecision` fired
  // synchronously (before the function's first `await`), it has already run
  // by this line.
  assert.deepEqual(decisions, [{ started: true }], 'onDecision must have fired synchronously, before this line, with {started:true}');

  await pollPromise;
  assert.equal(decisions.length, 1, 'onDecision must fire EXACTLY once');
});

test('T5: onDecision fires synchronously with {started:false,reason:"busy"} before the first await, on the busy-coalesce path', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  let listCalls = 0;
  let resolveFirstList;
  run.runList = () => {
    listCalls += 1;
    if (listCalls === 1) {
      return new Promise((resolve) => {
        resolveFirstList = () => resolve({ ok: true, stdout: '', stderr: '' });
      });
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const firstPollPromise = ytdlp.runPoll(deps, baseConfig());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ytdlp.isPollBusy(), true);

  const decisions = [];
  const secondPollPromise = ytdlp.runPoll(deps, baseConfig(), undefined, undefined, (decision) => {
    decisions.push(decision);
  });
  // Again, no yield to the event loop has happened between the call above
  // and this assertion -- the busy-coalesce return path is itself entirely
  // synchronous (no `await` before it), so onDecision must already have run.
  assert.deepEqual(decisions, [{ started: false, reason: 'busy' }]);

  const secondResult = await secondPollPromise;
  assert.deepEqual(secondResult, { started: false, reason: 'busy' }, "runPoll's own return value is unchanged by onDecision");
  assert.equal(decisions.length, 1, 'onDecision must fire EXACTLY once');

  resolveFirstList();
  await firstPollPromise;
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test('T5: onDecision fires with {started:false,reason:"not-found"} for a bogus subId (defensive -- the route pre-checks existence)', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  const decisions = [];
  const result = await ytdlp.runPoll(deps, baseConfig(), 'no-such-subscription-id', undefined, (decision) => {
    decisions.push(decision);
  });

  assert.deepEqual(result, { started: false, reason: 'not-found' });
  assert.deepEqual(decisions, [{ started: false, reason: 'not-found' }]);
});

test('T5: an omitted onDecision (every pre-T5 caller) is a no-op -- runPoll behaves exactly as before', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);

  run.runList = async () => ({ ok: true, stdout: '', stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  // Positional 4th-arg (`nowMs`) callers must still work unaffected by the
  // new optional 5th param.
  const nowMs = Date.parse('2026-01-01T00:00:00Z');
  const result = await ytdlp.runPoll(deps, baseConfig(), undefined, nowMs);
  assert.deepEqual(result, { started: true, count: 1 });
});

// ---- E4 (T4 fix round #3): the coalesced follow-up timer now DRAINS -------
// ---- `pollRerunTarget` at fire time instead of a closure-captured value, --
// ---- so a target can never be lost regardless of interleaving. -----------

test('E4: the same target coalescing twice while busy stays scoped to that subId (no escalation)', async () => {
  const deps = makeFakeDeps();
  const subA = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanA' });
  const subB = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanB' });

  const listedSubIds = [];
  let resolveFirstList;
  run.runList = (sub) => {
    listedSubIds.push(sub.id);
    if (listedSubIds.length === 1) {
      return new Promise((resolve) => {
        resolveFirstList = () => resolve({ ok: true, stdout: '', stderr: '' });
      });
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const firstPollPromise = ytdlp.runPoll(deps, baseConfig(), subA.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ytdlp.isPollBusy(), true);

  // The SAME target (subB) coalesces TWICE while busy -- this must stay
  // scoped to subB, never escalating to a full re-pull-all just because it
  // was requested more than once (requestPollRerun's escalation rule only
  // fires on a DIFFERENT target).
  const first = await ytdlp.runPoll(deps, baseConfig(), subB.id);
  const second = await ytdlp.runPoll(deps, baseConfig(), subB.id);
  assert.deepEqual(first, { started: false, reason: 'busy' });
  assert.deepEqual(second, { started: false, reason: 'busy' });

  resolveFirstList();
  await firstPollPromise;

  // Give the unref'd setTimeout(0) follow-up a tick to actually run.
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(
    listedSubIds,
    [subA.id, subB.id],
    'requesting the same target twice while busy must stay scoped to that subId -- never escalating to a full re-pull-all (E4)',
  );
});

test('E4: a target recorded while a follow-up timer is already armed still runs (never dropped)', async () => {
  const deps = makeFakeDeps();
  const subA = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanA' });
  const subB = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanB' });
  const subC = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanC' });
  const subD = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanD' });

  const listedSubIds = [];
  const resolvers = [];
  let callCount = 0;
  run.runList = (sub) => {
    callCount += 1;
    listedSubIds.push(sub.id);
    // Only the first TWO real (non-coalesced) polls -- subA (P1) and subC
    // (P2) below -- ever block; every later call (including the eventual
    // drained follow-up's polls of every subscription) resolves immediately.
    if (callCount <= 2) {
      return new Promise((resolve) => resolvers.push(() => resolve({ ok: true, stdout: '', stderr: '' })));
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  // P1: a direct poll for subA, blocked on runList (call #1). Calling an
  // async function runs synchronously up to its first `await`, so `pollBusy`
  // is already `true` here with no need to yield to the event loop first.
  const p1 = ytdlp.runPoll(deps, baseConfig(), subA.id);
  assert.equal(ytdlp.isPollBusy(), true);

  // While P1 is busy, subB coalesces -- recorded via `requestPollRerun`
  // (the busy branch runs synchronously too, with no `await` before its
  // early return).
  const coalescedB = ytdlp.runPoll(deps, baseConfig(), subB.id);

  resolvers[0](); // unblock P1
  await p1;
  await coalescedB;

  // P1's `finally` has now armed a follow-up timer that will (eventually)
  // drain whatever is in `pollRerunTarget` -- currently subB. It must NOT
  // have fired yet: everything from here up to this point ran through
  // microtasks only (Promise resolutions/awaits, no timer/setImmediate
  // wait), so the real `setTimeout(0)` macrotask has had no opportunity to
  // run -- this is what lets the next step reliably observe it "already
  // armed."

  // P2: a direct (non-coalesced) poll for subC, blocked on runList (call #2).
  const p2 = ytdlp.runPoll(deps, baseConfig(), subC.id);
  assert.equal(ytdlp.isPollBusy(), true);

  // While P2 is busy, subD coalesces. `pollRerunTarget` still holds subB
  // (the already-armed timer has not drained it yet) -- subD !== subB, so
  // this ESCALATES the pending target to a full re-pull-all rather than
  // overwriting/losing subB.
  const coalescedD = ytdlp.runPoll(deps, baseConfig(), subD.id);

  resolvers[1](); // unblock P2
  await p2;
  await coalescedD;

  // Give the ALREADY-ARMED (from P1) follow-up timer a chance to actually
  // fire now. Under the PRE-E4 behavior, P2's `finally` would have found
  // `pollRerunTimer` already set and silently dropped subD's escalation --
  // this is the exact race E4 fixes.
  await new Promise((resolve) => setTimeout(resolve, 20));

  // The single drained follow-up must have polled EVERY subscription (the
  // escalation to re-pull-all) -- proving subD's coalesced request, recorded
  // while a follow-up timer was ALREADY ARMED for subB, was never dropped.
  const followUpIds = listedSubIds.slice(2); // after subA (P1) and subC (P2)
  assert.deepEqual(
    new Set(followUpIds),
    new Set([subA.id, subB.id, subC.id, subD.id]),
    'a target recorded while a follow-up timer is already armed must still run (via RERUN_ALL escalation), never silently dropped (E4)',
  );
});

// ---- F3 (T4 cleanup pass): a leaked `pollRerunTimer` handle can be reset, --
// ---- and a subsequent follow-up still arms afterward. ---------------------

test('F3: resetPollRerunStateForTests clears a leaked timer so a later follow-up can still arm', async () => {
  const deps = makeFakeDeps();
  const subA = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanA' });
  const subB = await addSub(deps, { channelUrl: 'https://www.youtube.com/@chanB' });

  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  // Simulate the exact wedge this hook guards against: a poll blocked on
  // runList, a coalesced request recorded while busy, and the follow-up
  // timer armed by `finally` -- but never given a chance to fire (no wait
  // here), leaving `pollRerunTimer` non-null, as if the process/test starved
  // the event loop before the unref'd `setTimeout(0)` ran.
  let resolveList;
  run.runList = () => new Promise((resolve) => { resolveList = () => resolve({ ok: true, stdout: '', stderr: '' }); });
  const p1 = ytdlp.runPoll(deps, baseConfig(), subA.id);
  assert.equal(ytdlp.isPollBusy(), true);
  const coalesced = ytdlp.runPoll(deps, baseConfig(), subB.id);
  resolveList();
  await p1;
  await coalesced;
  // No `setTimeout` wait here -- the follow-up timer is armed but has not
  // fired. Resetting must clear it (and its pending target) without ever
  // letting the stale drain run.

  ytdlp.resetPollRerunStateForTests();

  // Give the (now-cleared) original timer's macrotask slot a chance to have
  // fired, proving the reset actually prevented the stale drain rather than
  // merely racing it.
  await new Promise((resolve) => setTimeout(resolve, 20));

  // A brand-new busy-then-coalesce cycle must still be able to arm its OWN
  // follow-up -- proving the reset didn't leave `pollRerunTimer` wedged.
  const listedAfterReset = [];
  let resolveSecondList;
  run.runList = (sub) => {
    listedAfterReset.push(sub.id);
    if (listedAfterReset.length === 1) {
      return new Promise((resolve) => { resolveSecondList = () => resolve({ ok: true, stdout: '', stderr: '' }); });
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  const p2 = ytdlp.runPoll(deps, baseConfig(), subA.id);
  assert.equal(ytdlp.isPollBusy(), true);
  const coalesced2 = ytdlp.runPoll(deps, baseConfig(), subB.id);
  resolveSecondList();
  await p2;
  await coalesced2;
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(
    listedAfterReset,
    [subA.id, subB.id],
    'a follow-up poll must still arm and run after resetPollRerunStateForTests clears a leaked timer',
  );
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

// ---- C6: quarantine runs on the FAILURE path too, not just success --------

test('C6: an escaped symlink is quarantined even when the download itself reports a FAILURE (ok:false)', async () => {
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
    if (err && err.code === 'EPERM') return; // sandboxed CI without symlink support
    throw err;
  }

  // Previously (pre-C6) an early return on `!downloadResult.ok` skipped
  // quarantine entirely, even though `processSubscription` still fires
  // `scanDirectories()` unconditionally -- so a partial-success-then-
  // nonzero-exit download's escaped symlink was never unlinked before being
  // indexed. This proves quarantine now runs on this path too.
  run.runDownload = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: 'yt-dlp exited with code 1' });

  await ytdlp.runPoll(deps, config);

  assert.equal(fs.existsSync(escapedLinkPath), false, 'the escaped symlink must be quarantined even when the download itself failed');
  assert.equal(fs.existsSync(outsideFile), true, 'quarantine must only remove the link INSIDE the channel dir, never the outside target');

  const [persisted] = store.listSubscriptions(deps);
  assert.ok(persisted.lastStatus.startsWith('error:'), `expected the download failure to still surface as an error status, got: ${persisted.lastStatus}`);

  fs.rmSync(outsideDir, { recursive: true, force: true });
});

// ---- quarantine flat-output assumption: yt-dlp's -o template never nests --
// ---- subdirectories, so quarantine deliberately does NOT recurse ----------

test('quarantine does not recurse into subdirectories (documents the flat OUTPUT_TEMPLATE assumption)', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps);
  const config = baseConfig();

  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'v1', availability: 'public' }]), stderr: '' });

  const channelDir = args.resolveChannelDir(config, sub);
  const nestedDir = path.join(channelDir, 'nested-subdir');
  fs.mkdirSync(nestedDir, { recursive: true });
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-outside-'));
  const outsideFile = path.join(outsideDir, 'escaped.mp4');
  fs.writeFileSync(outsideFile, 'not a real video');
  // Plant an escaping symlink ONE level DEEPER than yt-dlp's flat output
  // template would ever produce -- quarantine must not reach into it.
  const nestedEscapedLink = path.join(nestedDir, 'escaped-link.mp4');
  try {
    fs.symlinkSync(outsideFile, nestedEscapedLink);
  } catch (err) {
    if (err && err.code === 'EPERM') return; // sandboxed CI without symlink support
    throw err;
  }

  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  await ytdlp.runPoll(deps, config);

  assert.equal(fs.existsSync(nestedEscapedLink), true, 'quarantine deliberately does not recurse into subdirectories (yt-dlp\'s -o template is flat)');

  fs.rmSync(outsideDir, { recursive: true, force: true });
});

// ---- v1.15.1 hotfix: yt-dlp intermediate/partial artifacts left by a
// FAILED/timed-out download are cleaned up (defense-in-depth on top of
// server.js's scan-time exclusion), while a completed/final file in the same
// dir is left untouched --------------------------------------------------

test('a FAILED download cleans up yt-dlp intermediate artifacts in the channel dir, but leaves a completed final file untouched', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps);
  const config = baseConfig();

  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'v1', availability: 'public' }]), stderr: '' });

  const channelDir = args.resolveChannelDir(config, sub);
  fs.mkdirSync(channelDir, { recursive: true });
  const finalPath = path.join(channelDir, 'Already Downloaded [dQw4w9WgXcQ].mp4');
  const fragmentPath = path.join(channelDir, 'Killed Video [wSx0Or20MZE].f399.mp4');
  const audioFragmentPath = path.join(channelDir, 'Killed Video [wSx0Or20MZE].f251.webm');
  const mergeTempPath = path.join(channelDir, 'Killed Video [wSx0Or20MZE].temp.mp4');
  const partPath = path.join(channelDir, 'Killed Video [wSx0Or20MZE].mp4.part');
  fs.writeFileSync(finalPath, 'a real, already-completed video');
  for (const p of [fragmentPath, audioFragmentPath, mergeTempPath, partPath]) {
    fs.writeFileSync(p, 'yt-dlp leftover bytes');
  }

  run.runDownload = async () => ({ ok: false, code: 'ETIMEDOUT', stdout: '', stderr: '', error: 'yt-dlp download timed out after 180m (absolute ceiling) and was killed' });

  await ytdlp.runPoll(deps, config);

  for (const p of [fragmentPath, audioFragmentPath, mergeTempPath, partPath]) {
    assert.equal(fs.existsSync(p), false, `intermediate ${p} must be cleaned up after a failed download`);
  }
  assert.equal(fs.existsSync(finalPath), true, 'a completed/final file must never be removed by the cleanup');

  const [persisted] = store.listSubscriptions(deps);
  assert.ok(persisted.lastStatus.startsWith('error:'), `the download failure must still surface as an error status, got: ${persisted.lastStatus}`);
});

test('the intermediate cleanup is best-effort: a vanished/unreadable channel dir never throws and still reports the download failure', async () => {
  const deps = makeFakeDeps();
  await addSub(deps);
  const config = baseConfig();

  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'v1', availability: 'public' }]), stderr: '' });
  // Deliberately never mkdir the channel dir -- cleanupFailedDownloadIntermediates's
  // own readdirSync will throw ENOENT internally; this proves that failure is
  // swallowed rather than propagating out of runSubscriptionCycle.
  run.runDownload = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: 'yt-dlp exited with code 1' });

  await assert.doesNotReject(ytdlp.runPoll(deps, config));

  const [persisted] = store.listSubscriptions(deps);
  assert.ok(persisted.lastStatus.startsWith('error:'), `expected the download failure to still surface as an error status, got: ${persisted.lastStatus}`);
});

// ---- v1.20.0 FR-2: capture persistence + subscription fallback -----------

test('runPoll: a successfully captured channelMeta entry is recorded into db.ytdlp.downloadMeta after a successful download', async () => {
  const deps = makeFakeDeps();
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@somechannel', name: 'Some Channel' });

  const survivorVideo = { id: 'survivor1', availability: 'public' };
  run.runList = async () => ({ ok: true, stdout: ndjson([survivorVideo]), stderr: '' });
  run.runDownload = async () => ({
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    channelMeta: [{
      videoId: 'survivor1',
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
      uploaderUrl: 'https://www.youtube.com/@somechannel',
      channelName: 'Some Channel (captured)',
    }],
  });

  await ytdlp.runPoll(deps, baseConfig());

  const ns = store.ensureYtdlp(deps.loadDatabase());
  assert.ok(ns.downloadMeta.survivor1, 'the captured entry must be persisted');
  assert.equal(ns.downloadMeta.survivor1.channelUrl, 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw');
  assert.equal(ns.downloadMeta.survivor1.channelName, 'Some Channel (captured)');
});

test('runPoll: a survivor with NO usable capture falls back to the subscription\'s own already-validated channelUrl/name', async () => {
  const deps = makeFakeDeps();
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@fallbackchannel', name: 'Fallback Channel' });

  const survivorVideo = { id: 'survivor2', availability: 'public' };
  run.runList = async () => ({ ok: true, stdout: ndjson([survivorVideo]), stderr: '' });
  // No channelMeta at all (e.g. an edge container/postprocess that never
  // fired the print) -- must still get an identity via fallback.
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [] });

  await ytdlp.runPoll(deps, baseConfig());

  const ns = store.ensureYtdlp(deps.loadDatabase());
  assert.ok(ns.downloadMeta.survivor2, 'the fallback entry must be persisted');
  assert.equal(ns.downloadMeta.survivor2.channelUrl, 'https://www.youtube.com/@fallbackchannel');
  assert.equal(ns.downloadMeta.survivor2.channelName, 'Fallback Channel');
});

test('runPoll: a HOSTILE captured channelUrl is dropped by the sanitizer, and the survivor still falls back to the subscription\'s own channelUrl', async () => {
  const deps = makeFakeDeps();
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@fallbackchannel2', name: 'Fallback Channel 2' });

  const survivorVideo = { id: 'survivor3', availability: 'public' };
  run.runList = async () => ({ ok: true, stdout: ndjson([survivorVideo]), stderr: '' });
  run.runDownload = async () => ({
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    channelMeta: [{
      videoId: 'survivor3',
      channelUrl: 'https://evil.com/@x; rm -rf /',
      channelId: null,
      uploaderUrl: null,
      channelName: 'Hostile',
    }],
  });

  await ytdlp.runPoll(deps, baseConfig());

  const ns = store.ensureYtdlp(deps.loadDatabase());
  assert.ok(ns.downloadMeta.survivor3, 'a fallback entry must still be recorded for this survivor');
  assert.equal(ns.downloadMeta.survivor3.channelUrl, 'https://www.youtube.com/@fallbackchannel2', 'the hostile captured URL must never be stored -- the subscription\'s own trusted channelUrl is used instead');
});

test('runPoll: multiple survivors each get their OWN captured identity (no cross-contamination between videos in the same cycle)', async () => {
  const deps = makeFakeDeps();
  await addSub(deps, { channelUrl: 'https://www.youtube.com/@multi', name: 'Multi Channel' });

  const videos = [{ id: 'multi1', availability: 'public' }, { id: 'multi2', availability: 'public' }];
  run.runList = async () => ({ ok: true, stdout: ndjson(videos), stderr: '' });
  run.runDownload = async () => ({
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    channelMeta: [
      { videoId: 'multi1', channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw', channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw', uploaderUrl: null, channelName: 'Multi Channel' },
      { videoId: 'multi2', channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw', channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw', uploaderUrl: null, channelName: 'Multi Channel' },
    ],
  });

  await ytdlp.runPoll(deps, baseConfig());

  const ns = store.ensureYtdlp(deps.loadDatabase());
  assert.ok(ns.downloadMeta.multi1);
  assert.ok(ns.downloadMeta.multi2);
});

// ---- FIX 1 (two-reviewer gate, post-v1.25.0, BLOCKER): a fully-successful --
// poll cycle (clean listing, zero download failures) advances the polled ----
// subscription's `cutoffDate` forward to "today" -- closing the unbounded-  --
// re-listing blocker where a fixed cutoffDate made EVERY future poll re-    --
// LIST (`--dump-json`) every video published since the ORIGINAL cutoff,     --
// forever, rather than just since the last successful poll. `nowMs` is      --
// threaded through `ytdlp.runPoll(deps, config, subId, nowMs)` for a        --
// deterministic "today."

test('FIX 1: a clean successful poll (no new videos) advances cutoffDate to today', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps, { cutoffDate: '20200101' });
  run.runList = async () => ({ ok: true, stdout: '', stderr: '' });
  run.runDownload = async () => {
    throw new Error('must never be called -- there are no survivors to download');
  };

  const nowMs = Date.UTC(2026, 6, 10); // 2026-07-10T00:00:00Z
  await ytdlp.runPoll(deps, baseConfig(), undefined, nowMs);

  const [persisted] = store.listSubscriptions(deps).filter((s) => s.id === sub.id);
  assert.equal(persisted.lastStatus, 'ok: no new videos');
  assert.equal(persisted.cutoffDate, '20260710', 'a clean successful cycle must advance cutoffDate to "today" (nowMs)');
});

test('FIX 1: a successful poll that downloads new survivors also advances cutoffDate to today', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps, { cutoffDate: '20200101' });
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'survivor1', availability: 'public' }]), stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const nowMs = Date.UTC(2026, 6, 10);
  await ytdlp.runPoll(deps, baseConfig(), undefined, nowMs);

  const [persisted] = store.listSubscriptions(deps).filter((s) => s.id === sub.id);
  assert.equal(persisted.lastStatus, 'ok: downloaded 1 new video(s)');
  assert.equal(persisted.cutoffDate, '20260710');
});

test('FIX 1: an errored poll (listing failure) leaves cutoffDate unchanged', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps, { cutoffDate: '20200101' });
  run.runList = async () => ({ ok: false, stdout: '', stderr: '', error: 'network unreachable' });
  run.runDownload = async () => {
    throw new Error('must never be called -- listing already failed');
  };

  const nowMs = Date.UTC(2026, 6, 10);
  await ytdlp.runPoll(deps, baseConfig(), undefined, nowMs);

  const [persisted] = store.listSubscriptions(deps).filter((s) => s.id === sub.id);
  assert.ok(persisted.lastStatus.startsWith('error'), `expected an error status, got: ${persisted.lastStatus}`);
  assert.equal(persisted.cutoffDate, '20200101', 'a listing failure must never advance cutoffDate -- the window must stay wide for the next retry');
});

test('FIX 1: a poll where the download itself fails leaves cutoffDate unchanged (a genuine download error must stay in the window for retry)', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps, { cutoffDate: '20200101' });
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'survivor1', availability: 'public' }]), stderr: '' });
  run.runDownload = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: 'yt-dlp exited with code 1' });

  const nowMs = Date.UTC(2026, 6, 10);
  await ytdlp.runPoll(deps, baseConfig(), undefined, nowMs);

  const [persisted] = store.listSubscriptions(deps).filter((s) => s.id === sub.id);
  assert.ok(persisted.lastStatus.startsWith('error'), `expected an error status, got: ${persisted.lastStatus}`);
  assert.equal(persisted.cutoffDate, '20200101', 'a failed download must never advance cutoffDate -- the un-archived video must stay in the window for retry');
});

test('FIX 1: cutoffDate never advances BACKWARD, even if nowMs is somehow earlier than the sub\'s existing cutoffDate', async () => {
  const deps = makeFakeDeps();
  // A cutoffDate deliberately set in the FUTURE relative to `nowMs` below
  // (e.g. a user-entered future date) -- a clean successful poll must never
  // regress it back to "today."
  const sub = await addSub(deps, { cutoffDate: '20270101' });
  run.runList = async () => ({ ok: true, stdout: '', stderr: '' });
  run.runDownload = async () => {
    throw new Error('must never be called');
  };

  const nowMs = Date.UTC(2026, 6, 10); // "today" is BEFORE the sub's existing cutoffDate
  await ytdlp.runPoll(deps, baseConfig(), undefined, nowMs);

  const [persisted] = store.listSubscriptions(deps).filter((s) => s.id === sub.id);
  assert.equal(persisted.lastStatus, 'ok: no new videos');
  assert.equal(persisted.cutoffDate, '20270101', 'cutoffDate must only ever advance FORWARD, never regress');
});

test('FIX 1 end-to-end narrowing: an old cutoff pulls history on the first poll, then narrows to "since today" so the second poll lists a tight window', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps, { cutoffDate: '20200101' });
  const config = baseConfig();

  const capturedSubsByCall = [];
  run.runList = async (subArg) => {
    capturedSubsByCall.push({ cutoffDate: subArg.cutoffDate });
    return { ok: true, stdout: '', stderr: '' };
  };
  run.runDownload = async () => {
    throw new Error('must never be called -- no survivors in either cycle');
  };

  // First poll: the wide, user-set history window is what actually reaches
  // the LIST pass.
  const firstPollNowMs = Date.UTC(2026, 6, 10);
  await ytdlp.runPoll(deps, config, undefined, firstPollNowMs);
  assert.equal(capturedSubsByCall[0].cutoffDate, '20200101', 'the FIRST poll must still list using the original, wide cutoff (the one-time history pull)');

  let [persisted] = store.listSubscriptions(deps).filter((s) => s.id === sub.id);
  assert.equal(persisted.cutoffDate, '20260710', 'the first clean poll narrows the window to today');

  // Second poll, a day later: the LIST pass now uses the NARROWED cutoff --
  // proving the window is bounded/incremental from here on, never re-
  // re-listing the whole back catalog again.
  const secondPollNowMs = Date.UTC(2026, 6, 11);
  await ytdlp.runPoll(deps, config, undefined, secondPollNowMs);
  assert.equal(capturedSubsByCall[1].cutoffDate, '20260710', 'the SECOND poll must list using the narrowed "since the first poll" cutoff, not the original wide one');

  [persisted] = store.listSubscriptions(deps).filter((s) => s.id === sub.id);
  assert.equal(persisted.cutoffDate, '20260711', 'the second clean poll narrows the window forward again, to its own "today"');
});

// ---- F1 (v1.26 code-review fix): a `phase` left dangling by a prior cycle --
// must never leak into the NEXT cycle's fresh downloading window. A
// subscription's activity entry is keyed by the stable `sub.id` and reused
// (never recreated) across polling cycles, so `mergeEntry`'s shallow merge
// would otherwise let a stale `phase: 'merging'`/`'converting'` survive
// straight through an errored cycle's terminal write (which never itself
// touches `phase`) and render under a brand new cycle's fresh
// "Downloading…"/extraction window as a stale "Merging…" label.

test('F1: a "merging" phase left by a cycle that ends in ERROR is cleared before the next cycle\'s own cycle-start write', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps);

  // Cycle 1: a postprocess "merging" phase arrives mid-download, then the
  // download itself settles as a FAILURE -- the terminal 'error' write
  // (lib/ytdlp/index.js) never includes `percent`, so it was never in F1's
  // "seeds percent but not phase" scope and leaves `phase` dangling on
  // purpose for this test to prove the NEXT cycle-start write cleans it up.
  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'v1', availability: 'public' }]), stderr: '' });
  run.runDownload = async (_sub, _config, _targetIds, opts) => {
    opts.onProgress({ state: 'downloading', phase: 'merging' });
    return { ok: false, code: 1, stdout: '', stderr: '', error: 'ffmpeg merge failed' };
  };

  await ytdlp.runPoll(deps, baseConfig());
  const afterCycle1 = activity.getSnapshot().subscriptions[sub.id];
  assert.equal(afterCycle1.state, 'error');
  assert.equal(afterCycle1.phase, 'merging', 'sanity check: cycle 1 really did leave a dangling "merging" phase behind');

  // v1.36 F2: cycle 1's failure put this sub in check-failure backoff --
  // clear it so cycle 2 (this test's actual subject) is eligible again.
  await store.setSubscriptionStatus(deps, sub.id, { backoffUntil: null });

  // Cycle 2: a fresh cycle for the SAME subscription id. Assert the phase
  // seen at the very moment `runDownload` is invoked (i.e. right after the
  // cycle-start 'downloading' write, before any new progress patch has had a
  // chance to arrive) is already `null`, not the stale 'merging' value.
  let phaseAtCycleStart = 'unchecked';
  run.runDownload = async () => {
    phaseAtCycleStart = activity.getSnapshot().subscriptions[sub.id].phase;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
  await ytdlp.runPoll(deps, baseConfig());

  assert.equal(phaseAtCycleStart, null, 'F1: the cycle-start "downloading" write must clear a phase left over from a prior cycle');
});

test('F1: a "converting" phase left dangling is cleared by the "no new videos" terminal write', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps);

  // Manually seed a dangling phase on this subscription's activity entry, as
  // if a prior cycle's postprocess window had left it there.
  activity.setSubscription(sub.id, { state: 'downloading', phase: 'converting' });
  assert.equal(activity.getSnapshot().subscriptions[sub.id].phase, 'converting');

  // A cycle with zero survivors takes the early "no new videos" terminal
  // branch (percent: 100, state: 'done') -- this must also clear `phase`.
  run.runList = async () => ({ ok: true, stdout: '', stderr: '' });
  run.runDownload = async () => {
    throw new Error('must never be called -- there are no survivors to download');
  };

  await ytdlp.runPoll(deps, baseConfig());

  const snap = activity.getSnapshot().subscriptions[sub.id];
  assert.equal(snap.state, 'done');
  assert.equal(snap.phase, null, 'F1: the "no new videos" terminal write must clear a leftover phase');
});

test('F1: a "merging" phase left dangling is cleared by the successful-completion terminal write', async () => {
  const deps = makeFakeDeps();
  const sub = await addSub(deps);

  run.runList = async () => ({ ok: true, stdout: ndjson([{ id: 'v1', availability: 'public' }]), stderr: '' });
  run.runDownload = async (_sub, _config, _targetIds, opts) => {
    // Simulate a postprocess merge phase mid-download, then a clean success.
    opts.onProgress({ state: 'downloading', phase: 'merging' });
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  await ytdlp.runPoll(deps, baseConfig());

  const snap = activity.getSnapshot().subscriptions[sub.id];
  assert.equal(snap.state, 'done');
  assert.equal(snap.phase, null, 'F1: the successful-completion terminal write must clear a leftover phase');
});
