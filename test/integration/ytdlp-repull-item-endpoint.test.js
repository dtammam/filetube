'use strict';

// [INTEGRATION] v1.49 per-video reheat: `POST /api/ytdlp/repull-metadata/item/:mediaId`
// and its confirm sibling `POST /api/ytdlp/repull-metadata/item/:mediaId/relocate`.
//
// DISTINCT from test/integration/ytdlp-repull-metadata-endpoint.test.js, which
// owns the LIBRARY-WIDE trigger. This file owns the per-video HTTP surface and
// its orchestration contract: the 202 posture, force being implicit, the shared
// single-flight latch in BOTH directions, the honest cancel answer, the
// before/after diff, the relocation PROPOSAL, and -- the load-bearing one --
// that the metadata route NEVER moves a file.
//
// Same stubbing boundary as its sibling: `run.repullItemMetaAndSubs` and the
// `deps` seams are faked, because their internals are covered by
// test/integration/ytdlp-repull.test.js and test/integration/repull-persist.test.js.
// Mirrors that file's same-process fake-`express()`-app + fake-`deps` pattern.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const activity = require('../../lib/ytdlp/activity');

const originalRepullItemMetaAndSubs = run.repullItemMetaAndSubs;
const originalProbeChannelAvatar = run.probeChannelAvatar;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-repull-item-'));
  ytdlp.resetRepullMetadataStateForTests();
  activity.resetForTests();
});

afterEach(() => {
  run.repullItemMetaAndSubs = originalRepullItemMetaAndSubs;
  run.probeChannelAvatar = originalProbeChannelAvatar;
  ytdlp.resetRepullMetadataStateForTests();
  activity.resetForTests();
  ytdlp.armYtdlpTimer(ytdlp.parseYtdlpConfig({}));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const MEDIA_ID = 'media-aaaaaaaaaaa';

function makeItem(overrides = {}) {
  const videoId = overrides.videoId || 'aaaaaaaaaaa';
  return {
    mediaId: `media-${videoId}`,
    filePath: `/downloads/chan/Some Video [${videoId}].mp4`,
    videoId,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    inDownloadRoot: true,
    alreadyRepulled: false,
    ...overrides,
  };
}

// A db whose metadata carries the BEFORE state the diff is built from.
function makeDb(itemFields = {}) {
  return {
    metadata: {
      [MEDIA_ID]: {
        filePath: `/downloads/chan/Some Video [aaaaaaaaaaa].mp4`,
        title: 'Old Title',
        sourceViewCount: 1000,
        hasSubtitles: false,
        ...itemFields,
      },
    },
  };
}

function makeFakeDeps(initialDb = makeDb()) {
  const db = initialDb;
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
    enumerateRepullableItems: () => ({ items: [makeItem()], eligible: 1, ineligible: 0, withSourceId: 1 }),
    recordRepulledItemMeta: async () => true,
    planImportRelocation: () => ({ action: 'skip', reason: 'already-in-download-root' }),
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

function flush(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function itemEntry() {
  return activity.getSnapshot().oneShots[ytdlp.REPULL_ITEM_ACTIVITY_ID];
}

function itemUrl(base, id = MEDIA_ID) {
  return `${base}/api/ytdlp/repull-metadata/item/${encodeURIComponent(id)}`;
}

// ---- Disabled module -------------------------------------------------------

test('disabled module: both per-video routes are native 404s and nothing is spawned', async () => {
  let called = false;
  run.repullItemMetaAndSubs = async () => { called = true; return null; };

  const { base, close } = await startTestApp(makeFakeDeps(), ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'false',
    FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir,
  }));
  try {
    assert.equal((await fetch(itemUrl(base), { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${itemUrl(base)}/relocate`, { method: 'POST' })).status, 404);
    await flush();
    assert.equal(called, false);
  } finally {
    await close();
  }
});

// ---- The happy path --------------------------------------------------------

test('202 {started, mediaId}, then the shared per-item pass runs and persists with allowViewCountDecrease', async () => {
  const deps = makeFakeDeps();
  const recordCalls = [];
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => { recordCalls.push({ mediaId, meta }); return true; };
  const repullCalls = [];
  run.repullItemMetaAndSubs = async (watchUrl, filePath) => {
    repullCalls.push({ watchUrl, filePath });
    return { sourceTitle: 'Real Title', sourceViewCount: 4242, wroteSubs: true };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(itemUrl(base), { method: 'POST' });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { started: true, mediaId: MEDIA_ID });

    await flush();
    assert.equal(repullCalls.length, 1, 'exactly one item is re-pulled');
    assert.equal(repullCalls[0].watchUrl, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    assert.equal(recordCalls.length, 1);
    assert.equal(recordCalls[0].mediaId, MEDIA_ID);
    assert.equal(recordCalls[0].meta.allowViewCountDecrease, true,
      'the per-video force is the ONE caller allowed to override the monotonicity guard (intake decision 2)');
    assert.equal(recordCalls[0].meta.sourceViewCount, 4242);
    assert.equal(recordCalls[0].meta.markComplete, true);

    const entry = itemEntry();
    assert.equal(entry.state, 'done');
    assert.equal(entry.done, 1);
    assert.equal(entry.total, 1);
    assert.equal(entry.mediaId, MEDIA_ID);
    assert.equal(entry.networkRan, true);
  } finally {
    await close();
  }
});

test('v1.53 gate (M14-M16): an attributionConflict set at the persist boundary rides the one-shot, and the next run RESETS it', async () => {
  const deps = makeFakeDeps();
  let conflictThisRun = true;
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    // The production write side sets this OUT-FIELD when a manual
    // attribution declines a conflicting network identity (server.js) --
    // the fake reproduces the contract so every hop from persist to
    // one-shot is runtime-bound (the mutation audit proved all three hops
    // were deletable with the suite green).
    if (conflictThisRun) meta.attributionConflict = { kept: 'Mänual Channel', discovered: 'Nétwork Channel' };
    return true;
  };
  run.repullItemMetaAndSubs = async () => ({ sourceTitle: 'T', wroteSubs: false });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    assert.equal((await fetch(itemUrl(base), { method: 'POST' })).status, 202);
    await flush();
    let entry = itemEntry();
    assert.equal(entry.state, 'done');
    assert.deepEqual(entry.attributionConflict, { kept: 'Mänual Channel', discovered: 'Nétwork Channel' },
      'the conflict reached the one-shot (M14: reheatOneItem return; M16: terminal stamp)');

    // Second run with NO conflict: the `running` write must RESET the field
    // (setOneShot MERGES -- M15), so a stale conflict can never ride a new
    // run's entry.
    conflictThisRun = false;
    assert.equal((await fetch(itemUrl(base), { method: 'POST' })).status, 202);
    await flush();
    entry = itemEntry();
    assert.equal(entry.state, 'done');
    assert.equal(entry.attributionConflict, null, 'a conflict-free run carries null, never the previous run\'s conflict');
  } finally {
    await close();
  }
});

test('the activity entry carries a BEFORE/AFTER diff read back from the database, not from what the pass intended', async () => {
  // The AFTER snapshot must come from a fresh read: recordRepulledItemMeta's
  // own guards can decline a value the pass produced, and a diff built from
  // intent would tell the user something changed when it did not.
  const deps = makeFakeDeps();
  deps.recordRepulledItemMeta = async (d, mediaId, meta) => {
    // Persist the title but DECLINE the view count, exactly as a guard would.
    const db = deps.loadDatabase();
    db.metadata[mediaId].title = meta.sourceTitle;
    db.metadata[mediaId].sourceTitle = meta.sourceTitle;
    return true;
  };
  run.repullItemMetaAndSubs = async () => ({ sourceTitle: 'Real Title', sourceViewCount: 9, wroteSubs: true });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(itemUrl(base), { method: 'POST' });
    await flush();

    const entry = itemEntry();
    assert.equal(entry.before.title, 'Old Title');
    assert.equal(entry.after.title, 'Real Title', 'the accepted change shows in the diff');
    assert.equal(entry.before.sourceViewCount, 1000);
    assert.equal(entry.after.sourceViewCount, 1000,
      'the DECLINED change must NOT show as changed -- the diff reflects the database, not the attempt');
  } finally {
    await close();
  }
});

test('force is implicit: an item already carrying the reheat marker is still re-pulled (the batch would skip it)', async () => {
  const deps = makeFakeDeps();
  deps.enumerateRepullableItems = () => ({ items: [makeItem({ alreadyRepulled: true })], eligible: 1, ineligible: 0, withSourceId: 1 });
  let spawned = 0;
  run.repullItemMetaAndSubs = async () => { spawned += 1; return { sourceTitle: 'T', wroteSubs: true }; };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(itemUrl(base), { method: 'POST' });
    await flush();
    assert.equal(spawned, 1, 'the whole point of the feature is that a done item can be redone on demand');
  } finally {
    await close();
  }
});

// ---- Decision 3: a video with no YouTube identity ---------------------------

test('a video with no derivable YouTube identity never touches the network and is counted skipped, not done', async () => {
  const deps = makeFakeDeps();
  deps.enumerateRepullableItems = () => ({
    items: [makeItem({ videoId: null, watchUrl: null, inDownloadRoot: false, mediaId: MEDIA_ID })],
    eligible: 1, ineligible: 0, withSourceId: 0,
  });
  // The local ffprobe pass RAN and found nothing -- that is what establishes
  // "exhausted" (a null return would mean a transient failure, still retryable).
  deps.probeEmbeddedTags = async () => ({});
  let spawned = 0;
  run.repullItemMetaAndSubs = async () => { spawned += 1; return {}; };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(itemUrl(base), { method: 'POST' });
    await flush();

    assert.equal(spawned, 0, 'a home video must never reach the network');
    const entry = itemEntry();
    assert.equal(entry.networkRan, false, 'the client needs this to say "nothing to refresh" honestly');
    assert.equal(entry.skipped, 1, 'nothing was fetched, so this is a skip');
    assert.equal(entry.done, 0, 'and emphatically NOT a success');
  } finally {
    await close();
  }
});

// ---- Eligibility + the shared latch ----------------------------------------

test('404 when the id is not among the enumerated (reheatable) items -- never a 202 that resolves to a silent no-op', async () => {
  const deps = makeFakeDeps();
  let spawned = 0;
  run.repullItemMetaAndSubs = async () => { spawned += 1; return {}; };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(itemUrl(base, 'media-not-in-library'), { method: 'POST' });
    assert.equal(res.status, 404);
    await flush();
    assert.equal(spawned, 0);
  } finally {
    await close();
  }
});

test('the single-flight latch holds in BOTH directions: item blocks batch, batch blocks item', async () => {
  const deps = makeFakeDeps();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  run.repullItemMetaAndSubs = async () => { await gate; return { sourceTitle: 'T', wroteSubs: true }; };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    assert.equal((await fetch(itemUrl(base), { method: 'POST' })).status, 202);
    await flush(10);

    const batchRes = await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' });
    assert.equal(batchRes.status, 409, 'a library batch must not start underneath an in-flight per-video reheat');
    assert.deepEqual(await batchRes.json(), { started: false, alreadyRunning: true });

    const secondItem = await fetch(itemUrl(base), { method: 'POST' });
    assert.equal(secondItem.status, 409, 'and neither must a second per-video reheat');

    release();
    await flush();
    // Latch released: the next request is accepted again.
    assert.equal((await fetch(itemUrl(base), { method: 'POST' })).status, 202);
    await flush();
  } finally {
    release();
    await flush();
    await close();
  }
});

test('cancel is HONEST about a single-item run: it reports cancelled:false rather than claiming a cancellation it cannot perform', async () => {
  const deps = makeFakeDeps();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  run.repullItemMetaAndSubs = async () => { await gate; return { sourceTitle: 'T', wroteSubs: true }; };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(itemUrl(base), { method: 'POST' });
    await flush(10);

    const res = await fetch(`${base}/api/ytdlp/repull-metadata/cancel`, { method: 'POST' });
    assert.deepEqual(await res.json(), { cancelled: false, reason: 'single-item' });
  } finally {
    release();
    await flush();
    await close();
  }
});

// ---- THE load-bearing one: the metadata route never moves a file ------------

test('the metadata route NEVER relocates -- it only PROPOSES, with the destination and transfer method from the shared plan', async () => {
  const deps = makeFakeDeps();
  let relocateCalls = 0;
  deps.relocateHydratedImport = async () => { relocateCalls += 1; return { status: 'moved' }; };
  deps.planImportRelocation = () => ({
    action: 'move',
    destinationPath: '/downloads/Veritasium/Real Title [aaaaaaaaaaa].mp4',
    currentPath: '/library/imports/whatever.mp4',
    transfer: 'copy',
    sameDevice: false,
    sizeBytes: 1234567,
  });
  run.repullItemMetaAndSubs = async () => ({ sourceTitle: 'Real Title', wroteSubs: true });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(itemUrl(base), { method: 'POST' });
    await flush();

    assert.equal(relocateCalls, 0,
      'Dean has no media backup: the irreversible half must never be a side effect of the reversible half');
    const { relocation } = itemEntry();
    assert.equal(relocation.available, true);
    assert.equal(relocation.destinationPath, '/downloads/Veritasium/Real Title [aaaaaaaaaaa].mp4');
    assert.equal(relocation.transfer, 'copy');
    assert.equal(relocation.sameDevice, false);
    assert.equal(relocation.sizeBytes, 1234567);
  } finally {
    await close();
  }
});

test('a non-candidate reports available:false with the plan\'s own reason, never a silent omission', async () => {
  const deps = makeFakeDeps();
  deps.planImportRelocation = () => ({ action: 'skip', reason: 'destination-occupied' });
  run.repullItemMetaAndSubs = async () => ({ sourceTitle: 'T', wroteSubs: true });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(itemUrl(base), { method: 'POST' });
    await flush();
    assert.deepEqual(itemEntry().relocation, { available: false, reason: 'destination-occupied' });
  } finally {
    await close();
  }
});

test('a relocation proposal is computed AFTER the persist -- hydration is what makes an import relocatable in the first place', async () => {
  const deps = makeFakeDeps();
  const order = [];
  deps.recordRepulledItemMeta = async () => { order.push('persist'); return true; };
  deps.planImportRelocation = () => { order.push('plan'); return { action: 'skip', reason: 'x' }; };
  run.repullItemMetaAndSubs = async () => ({ sourceTitle: 'T', wroteSubs: true });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(itemUrl(base), { method: 'POST' });
    await flush();
    assert.deepEqual(order, ['persist', 'plan'],
      'planning first would report "not a candidate" for exactly the imports this feature exists for');
  } finally {
    await close();
  }
});

// ---- The confirm route -----------------------------------------------------

test('the confirm route performs the move and returns the NEW id (the move re-keys the item)', async () => {
  const deps = makeFakeDeps();
  const calls = [];
  deps.relocateHydratedImport = async (d, config, mediaId) => {
    calls.push(mediaId);
    return { status: 'moved', newId: 'media-new-id', newPath: '/downloads/Veritasium/x.mp4', archived: true };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${itemUrl(base)}/relocate`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      status: 'moved', newId: 'media-new-id', newPath: '/downloads/Veritasium/x.mp4', archived: true,
    });
    assert.deepEqual(calls, [MEDIA_ID]);
  } finally {
    await close();
  }
});

test('the confirm route surfaces archived:false rather than burying it (a subscription poll may re-download the file)', async () => {
  const deps = makeFakeDeps();
  deps.relocateHydratedImport = async () => ({ status: 'moved', newId: 'n', newPath: '/p', archived: false });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const body = await (await fetch(`${itemUrl(base)}/relocate`, { method: 'POST' })).json();
    assert.equal(body.archived, false);
  } finally {
    await close();
  }
});

test('a skipped relocation is reported with its reason and is NOT an error (two copies of one video is information, not failure)', async () => {
  const deps = makeFakeDeps();
  deps.relocateHydratedImport = async () => ({ status: 'skipped', reason: 'destination-occupied' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${itemUrl(base)}/relocate`, { method: 'POST' });
    assert.equal(res.status, 200);
    // v1.49 gate fix (adversarial WARNING 3): `failed` rides along so the client
    // can tell an integrity FAILURE (a cross-device checksum mismatch on an
    // irreplaceable file) apart from a benign skip. A skip is `failed: false`.
    assert.deepEqual(await res.json(), { status: 'skipped', failed: false, reason: 'destination-occupied' });
  } finally {
    await close();
  }
});

test('the confirm route re-runs the real decision every time -- it never trusts the proposal it was shown', async () => {
  // The proposal can be minutes old. The destination may have become occupied,
  // the setting switched off, the item re-keyed by a scan. A confirm is
  // permission to ATTEMPT the move, never a cached authorisation.
  const deps = makeFakeDeps();
  let seen = 0;
  deps.relocateHydratedImport = async () => {
    seen += 1;
    return { status: 'skipped', reason: 'setting-off' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(`${itemUrl(base)}/relocate`, { method: 'POST' });
    await fetch(`${itemUrl(base)}/relocate`, { method: 'POST' });
    assert.equal(seen, 2, 'every confirm goes through the executor, which re-plans against a fresh db');
  } finally {
    await close();
  }
});

test('the confirm route refuses while a reheat holds the latch', async () => {
  const deps = makeFakeDeps();
  let relocated = 0;
  deps.relocateHydratedImport = async () => { relocated += 1; return { status: 'moved', newId: 'n' }; };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  run.repullItemMetaAndSubs = async () => { await gate; return { sourceTitle: 'T', wroteSubs: true }; };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(itemUrl(base), { method: 'POST' });
    await flush(10);
    const res = await fetch(`${itemUrl(base)}/relocate`, { method: 'POST' });
    assert.equal(res.status, 409, 'a move must never race the metadata write that decides whether it is legal');
    assert.equal(relocated, 0);
  } finally {
    release();
    await flush();
    await close();
  }
});

// ---- Missing wiring --------------------------------------------------------

test('a deps bundle with no relocation seam gives a clean 503 on the confirm route, and no proposal on the metadata route', async () => {
  const deps = makeFakeDeps();
  delete deps.planImportRelocation;
  run.repullItemMetaAndSubs = async () => ({ sourceTitle: 'T', wroteSubs: true });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(itemUrl(base), { method: 'POST' });
    await flush();
    assert.deepEqual(itemEntry().relocation, { available: false, reason: 'unavailable' },
      'the metadata half must still work with a minimal deps bundle');

    const res = await fetch(`${itemUrl(base)}/relocate`, { method: 'POST' });
    assert.equal(res.status, 503);
  } finally {
    await close();
  }
});

// ---- Outcome honesty -------------------------------------------------------

test('an item whose subtitle pass did not complete is reported outcome:failed, NOT a success', async () => {
  // markComplete is gated on the subs pass completing (or being structurally
  // skipped, or the item being exhausted). A transient subs failure leaves the
  // item retryable -- and must not be dressed up as a finished reheat.
  const deps = makeFakeDeps();
  run.repullItemMetaAndSubs = async () => ({ sourceTitle: 'Real Title', wroteSubs: false });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(itemUrl(base), { method: 'POST' });
    await flush();
    const entry = itemEntry();
    assert.equal(entry.outcome, 'failed', 'the RESULT field says failed');
    assert.equal(entry.failed, 1);
    assert.equal(entry.done, 0);
    assert.equal(entry.state, 'done',
      'while `state` -- the LIFECYCLE marker -- still reads done, which is exactly why outcome exists separately');
  } finally {
    await close();
  }
});

test('an item that vanished mid-run (the persist no-ops) is reported failed, and its file is never proposed for a move on the strength of a write that did not land', async () => {
  const deps = makeFakeDeps();
  deps.recordRepulledItemMeta = async () => false; // the item was deleted concurrently
  run.repullItemMetaAndSubs = async () => ({ sourceTitle: 'T', wroteSubs: true });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await fetch(itemUrl(base), { method: 'POST' });
    await flush();
    assert.equal(itemEntry().outcome, 'failed');
  } finally {
    await close();
  }
});

test('the running entry does not leak the PREVIOUS video\'s result (setOneShot merges into a fixed key)', async () => {
  const deps = makeFakeDeps();
  deps.planImportRelocation = () => ({
    action: 'move', destinationPath: '/downloads/A/first.mp4', currentPath: '/lib/first.mp4',
    transfer: 'hardlink', sameDevice: true, sizeBytes: 10,
  });
  run.repullItemMetaAndSubs = async () => ({ sourceTitle: 'First', wroteSubs: true });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    // Run one to completion so a terminal entry (with a relocation proposal)
    // sits under the fixed one-shot key.
    await fetch(itemUrl(base), { method: 'POST' });
    await flush();
    assert.equal(itemEntry().relocation.available, true, 'precondition: a proposal is on record');

    // Now start a SECOND run and inspect the entry while it is still running.
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    run.repullItemMetaAndSubs = async () => { await gate; return { sourceTitle: 'Second', wroteSubs: true }; };
    await fetch(itemUrl(base), { method: 'POST' });
    await flush(10);

    const running = itemEntry();
    assert.equal(running.state, 'running');
    assert.equal(running.relocation, null,
      'a client polling mid-run must never read the previous video\'s relocation proposal and offer to move the wrong file');
    assert.equal(running.before, null);
    assert.equal(running.after, null);
    assert.equal(running.mediaId, MEDIA_ID, 'and mediaId is stamped from the start, so a poller can tell whose run it is');

    release();
    await flush();
  } finally {
    await close();
  }
});

// ---- THE ANTI-DRIFT LOCK ---------------------------------------------------
//
// v1.49 gate fix (QA WARNING): the plan called for this and the implementation
// shipped without it. `reheatOneItem` is the per-item metadata pass EXTRACTED so
// the library batch and the per-video route cannot diverge -- but every other
// test in this file and its sibling asserts each path INDEPENDENTLY, which locks
// each path's behaviour without ever locking that they AGREE. This drives one
// identical item through both routes with identical stubs and diffs the payload
// that actually reaches the single database writer.
//
// The one permitted difference is `allowViewCountDecrease` (intake decision 2),
// and it is asserted to be the ONLY one rather than merely excluded -- a
// deletion-based comparison would silently absorb any NEW field a future fork
// added to one path and not the other.

test('anti-drift: the library batch and the per-video route persist IDENTICAL metadata for the same item, differing ONLY in allowViewCountDecrease', async () => {
  const NETWORK_RESULT = {
    sourceTitle: 'Real Title',
    sourceViewCount: 4242,
    releaseDate: 1700000000000,
    chapters: [{ startTime: 0, title: 'Intro' }],
    channel: { channelUrl: 'https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', channelName: 'Chan' },
    wroteSubs: true,
  };

  async function capture(trigger) {
    ytdlp.resetRepullMetadataStateForTests();
    activity.resetForTests();
    const deps = makeFakeDeps();
    let captured = null;
    deps.recordRepulledItemMeta = async (d, mediaId, meta) => { captured = { mediaId, meta }; return true; };
    // Probed identically on both paths: a channel avatar is part of the payload.
    run.probeChannelAvatar = async () => ({ avatarUrl: 'https://example.com/a.jpg', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' });
    run.repullItemMetaAndSubs = async () => ({ ...NETWORK_RESULT });

    const { base, close } = await startTestApp(deps, enabledConfig());
    try {
      await trigger(base);
      await flush(60);
    } finally {
      await close();
    }
    return captured;
  }

  const viaBatch = await capture((base) => fetch(`${base}/api/ytdlp/repull-metadata`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }),
  }));
  const viaItem = await capture((base) => fetch(itemUrl(base), { method: 'POST' }));

  assert.ok(viaBatch && viaItem, 'both paths must have reached the database writer');
  assert.equal(viaBatch.mediaId, viaItem.mediaId, 'both must write to the same item');

  // Every key present on either side, compared field by field.
  const keys = new Set([...Object.keys(viaBatch.meta), ...Object.keys(viaItem.meta)]);
  const differing = [];
  for (const key of keys) {
    const a = JSON.stringify(viaBatch.meta[key]);
    const b = JSON.stringify(viaItem.meta[key]);
    if (a !== b) differing.push({ key, batch: viaBatch.meta[key], item: viaItem.meta[key] });
  }

  assert.deepEqual(
    differing.map((d) => d.key).sort(),
    ['allowViewCountDecrease'],
    `the ONLY permitted divergence is allowViewCountDecrease; found: ${JSON.stringify(differing)}`,
  );
  assert.equal(viaBatch.meta.allowViewCountDecrease, false, 'the batch keeps the v1.48 monotonicity guard');
  assert.equal(viaItem.meta.allowViewCountDecrease, true, 'the explicit per-video force overrides it');

  // And the payload is not vacuously equal -- it really did carry the work.
  assert.equal(viaItem.meta.sourceTitle, 'Real Title');
  assert.equal(viaItem.meta.sourceViewCount, 4242);
  assert.equal(viaItem.meta.markComplete, true);
  assert.equal(viaItem.meta.channel.channelId, 'UCaaaaaaaaaaaaaaaaaaaaaa');
});

test('v1.49 gate fix: the relocate route HOLDS the shared latch for the duration -- a reheat cannot start mid-move', async () => {
  // The route always CHECKED the latch; until the gate caught it, it never HELD
  // one, so "409 both ways" was only true in the direction the earlier test
  // exercised. A library batch starting while this relocation is mid-copy
  // resolves safely today only because of machinery this feature does not own.
  const deps = makeFakeDeps();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  deps.relocateHydratedImport = async () => { await gate; return { status: 'moved', newId: 'n', newPath: '/p', archived: true }; };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const moving = fetch(`${itemUrl(base)}/relocate`, { method: 'POST' });
    await flush(10);

    assert.equal((await fetch(itemUrl(base), { method: 'POST' })).status, 409,
      'a per-video reheat must not start while a move is in flight');
    assert.equal((await fetch(`${base}/api/ytdlp/repull-metadata`, { method: 'POST' })).status, 409,
      'and neither must a library-wide batch');
    assert.equal((await fetch(`${itemUrl(base)}/relocate`, { method: 'POST' })).status, 409,
      'nor a second move of the same file');

    release();
    assert.equal((await moving).status, 200);
    await flush(10);

    // ...and the latch is RELEASED afterwards, or the feature would wedge.
    assert.equal((await fetch(itemUrl(base), { method: 'POST' })).status, 202);
    await flush();
  } finally {
    release();
    await flush();
    await close();
  }
});

test('v1.49 gate fix: a relocation that THROWS still releases the latch (a wedged latch would disable every reheat route)', async () => {
  const deps = makeFakeDeps();
  deps.relocateHydratedImport = async () => { throw new Error('disk fell over'); };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    assert.equal((await fetch(`${itemUrl(base)}/relocate`, { method: 'POST' })).status, 500);
    assert.equal((await fetch(itemUrl(base), { method: 'POST' })).status, 202,
      'the finally must have released the latch');
    await flush();
  } finally {
    await close();
  }
});

test('v1.49 gate fix: cancel stays honest during a relocation -- it cannot abandon a move mid-copy', async () => {
  const deps = makeFakeDeps();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  deps.relocateHydratedImport = async () => { await gate; return { status: 'moved', newId: 'n' }; };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const moving = fetch(`${itemUrl(base)}/relocate`, { method: 'POST' });
    await flush(10);
    const res = await fetch(`${base}/api/ytdlp/repull-metadata/cancel`, { method: 'POST' });
    assert.deepEqual(await res.json(), { cancelled: false, reason: 'relocating' });
    release();
    await moving;
  } finally {
    release();
    await flush();
    await close();
  }
});

test('v1.49 gate fix: a PARTIAL expect is refused with 400, never silently degraded to a weaker binding', async () => {
  // "Be kind to an older caller" was a false justification: `expect` and
  // `transfer` shipped in the same unreleased wave, so no deployed client knows
  // this route but not that field. The only thing that would ever send a
  // partial object is a client refactor that dropped one -- this repo's
  // most-repeated bug class -- and silent degradation is how that survives a
  // release.
  const deps = makeFakeDeps();
  let relocated = 0;
  deps.relocateHydratedImport = async () => { relocated += 1; return { status: 'moved', newId: 'n' }; };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${itemUrl(base)}/relocate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expect: { currentPath: '/a', destinationPath: '/b' } }), // transfer + sizeBytes missing
    });
    assert.equal(res.status, 400);
    assert.equal(relocated, 0, 'and nothing was moved on the strength of a half-checked expectation');
  } finally {
    await close();
  }
});

test('v1.49 gate fix: omitting expect ENTIRELY is still supported (the batch/preview escape hatch)', async () => {
  const deps = makeFakeDeps();
  deps.relocateHydratedImport = async () => ({ status: 'moved', newId: 'n', newPath: '/p', archived: true });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${itemUrl(base)}/relocate`, { method: 'POST' });
    assert.equal(res.status, 200, 'no expect at all is a supported caller shape, unlike a partial one');
  } finally {
    await close();
  }
});

test('v1.49 gate fix (QA S2): an honest echo of sizeBytes:null is accepted, not 400d', async () => {
  // planImportRelocation legitimately yields sizeBytes: null when its statSync
  // loses a TOCTOU race with its own existsSync. A client faithfully echoing
  // back the proposal it was SHOWN must not be refused for reporting what it
  // was given; the size comparison simply degrades to not-compared.
  const deps = makeFakeDeps();
  let seen = null;
  deps.relocateHydratedImport = async (d, config, mediaId, opts) => {
    seen = opts;
    return { status: 'moved', newId: 'n', newPath: '/p', archived: true };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${itemUrl(base)}/relocate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expect: { currentPath: '/a', destinationPath: '/b', transfer: 'unknown', sizeBytes: null } }),
    });
    assert.equal(res.status, 200);
    assert.equal(seen.expect.sizeBytes, undefined,
      'an unmeasurable size is not forwarded, so the executor skips that comparison instead of failing it');
    assert.equal(seen.expect.transfer, 'unknown', "...while 'unknown' IS a real planner value and is still bound");
  } finally {
    await close();
  }
});
