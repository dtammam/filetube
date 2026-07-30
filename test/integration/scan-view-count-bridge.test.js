'use strict';

// [INTEGRATION] v1.48 item 2 -- day-of view counts, against the REAL server.js
// scan path.
//
// THIS FILE EXISTS BECAUSE THE GATE'S QA SEAT CAUGHT ITS ABSENCE (CRITICAL).
// Every other test for this feature is a PURE unit test: parseCapturedViewCount,
// resolveViewCountLabel, parseChannelMetaLine. None of them boot the scan, so
// none of them would fail if the wiring between the capture bridge and
// `item.sourceViewCount` were severed. Deleting the `applyCapturedViewCount`
// call on the plain-YouTube path left the entire suite green while every
// download silently reverted to a fabricated mock count -- the exact
// "headline fix shipped as dead code, suite stayed green" class of v1.47.4.
//
// So these tests deliberately assert on the OUTPUT of `scanDirectories()`
// rather than on any hand-authored intermediate value (the divergent-fixture
// lesson): the only thing seeded is the bridge entry a real download would have
// written, and everything after that is the production path.
//
// Coverage here mirrors the carriers the persist-gate/stale-snapshot bug class
// has broken before (v1.32, v1.33, v1.34, v1.41.5):
//   1. the bridge itself (YouTube lane + universal lane)
//   2. survival across an unchanged rescan (reuse fast path)
//   3. survival across a CHANGED file (the re-init carry-forward)
//   4. the legacy `viewCount` local watch counter staying untouched throughout
//
// Isolated DATA_DIR before requiring the app, per the established pattern.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-viewcount-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { scanDirectories, loadDatabase, updateDatabase, getMediaId } = require('../../server');
const store = require('../../lib/ytdlp/store');

let downloadDir;

before(() => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-viewcount-dl-'));
});

after(() => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

function withYtdlpEnv(fn) {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  return fn().finally(() => {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  });
}

// A fixed, obviously-synthetic capture instant. Not Date.now(): the assertions
// below compare the stored date to THIS value, so a wiring bug that stamped
// "now" instead of carrying the capture time would otherwise pass unnoticed.
const CAPTURED_AT = Date.UTC(2026, 0, 15, 12, 0, 0);

test('bridge (YouTube lane): a seeded downloadMeta viewCount lands on the item as sourceViewCount + its capture DATE', () => withYtdlpEnv(async () => {
  const filePath = path.join(downloadDir, 'Some Video [eeeeeeeeeee].mp4');
  fs.writeFileSync(filePath, 'not a real video');

  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta.eeeeeeeeeee = {
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelName: 'Some Channel',
      sourceViewCount: 1672000000,
      capturedAt: CAPTURED_AT,
    };
  });

  await scanDirectories();

  const id = getMediaId(filePath);
  const item = loadDatabase().metadata[id];
  assert.equal(item.sourceViewCount, 1672000000, 'the captured count reached the item through the real scan');
  assert.equal(item.sourceViewCountCapturedAt, CAPTURED_AT,
    "the entry's OWN capturedAt is carried, never re-stamped to scan time");
  // The collision guard, asserted against real scan output rather than a unit
  // fixture: the legacy LOCAL watch counter must not have been written.
  assert.equal(item.viewCount, undefined,
    'the legacy local watch counter is NOT where a source view count goes');
}));

test('v1.54: the FOLLOWER count rides both lanes as a unit with its capture date', () => withYtdlpEnv(async () => {
  const filePath = path.join(downloadDir, 'Follower Video [ffffffffff2].mp4');
  fs.writeFileSync(filePath, 'not a real video');
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta.ffffffffff2 = {
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelName: 'Fôllowed Channel',
      sourceViewCount: 100,
      sourceFollowerCount: 24000,
      capturedAt: CAPTURED_AT,
    };
  });
  const uBase = 'Follower Universal [Vimeo=424242].mp4';
  const uPath = path.join(downloadDir, uBase);
  fs.writeFileSync(uPath, 'not a real video');
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta[uBase] = {
      universal: true, sourceExtractor: 'Vimeo', sourceId: '424242',
      channelName: 'Fôllowed Studio', sourceFollowerCount: 313, capturedAt: CAPTURED_AT,
    };
  });

  await scanDirectories();

  const yt = loadDatabase().metadata[getMediaId(filePath)];
  assert.equal(yt.sourceFollowerCount, 24000, 'YouTube lane captured through the real scan');
  assert.equal(yt.sourceFollowerCountCapturedAt, CAPTURED_AT, 'unit-paired with the capture moment, never scan time');
  const u = loadDatabase().metadata[getMediaId(uPath)];
  assert.equal(u.sourceFollowerCount, 313, 'universal lane too');
  assert.equal(u.sourceFollowerCountCapturedAt, CAPTURED_AT);
}));

test('bridge (universal lane): a composite-keyed capture lands on the item too', () => withYtdlpEnv(async () => {
  const base = 'A Vimeo Film [Vimeo=76979871].mp4';
  const filePath = path.join(downloadDir, base);
  fs.writeFileSync(filePath, 'not a real video');

  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    // Universal entries are keyed by the RENDERED on-disk basename (design D5).
    ns.downloadMeta[base] = {
      universal: true,
      sourceExtractor: 'Vimeo',
      sourceId: '76979871',
      channelName: 'Some Studio',
      sourceViewCount: 4242,
      capturedAt: CAPTURED_AT,
    };
  });

  await scanDirectories();

  const item = loadDatabase().metadata[getMediaId(filePath)];
  assert.equal(item.sourceViewCount, 4242, 'the universal consume path carries it too');
  assert.equal(item.sourceViewCountCapturedAt, CAPTURED_AT);
  assert.equal(item.viewCount, undefined);
}));

test('a captured count survives an UNCHANGED rescan (reuse fast path)', () => withYtdlpEnv(async () => {
  const filePath = path.join(downloadDir, 'Stable File [fffffffffff].mp4');
  fs.writeFileSync(filePath, 'not a real video');

  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta.fffffffffff = {
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      sourceViewCount: 555,
      sourceFollowerCount: 66000,
      capturedAt: CAPTURED_AT,
    };
  });

  await scanDirectories();
  const id = getMediaId(filePath);
  assert.equal(loadDatabase().metadata[id].sourceViewCount, 555, 'precondition: the bridge fired');

  // The bridge entry is CONSUMED (deleted) by the first scan, so a later scan
  // has nothing to re-bridge from -- if the item did not retain the value
  // itself, it would be gone for good.
  await scanDirectories();
  const item = loadDatabase().metadata[id];
  assert.equal(item.sourceViewCount, 555, 'still there after a rescan');
  assert.equal(item.sourceViewCountCapturedAt, CAPTURED_AT, 'and still correctly dated');
  // v1.54 gate round 1 W2: the follower pair rides the same cell.
  assert.equal(item.sourceFollowerCount, 66000, 'the follower count survives the rescan too');
  assert.equal(item.sourceFollowerCountCapturedAt, CAPTURED_AT);
}));

test('a captured count survives a CHANGED file (re-init carry-forward OR the Phase-2 gap-fill)', () => withYtdlpEnv(async () => {
  // The headline persist-gate case. A view count cannot be re-derived from
  // anything on disk -- it came from a network capture at a moment in time --
  // so if a re-encoded file loses it, that item silently reverts to a
  // fabricated mock count with no way back short of a manual reheat.
  //
  // HONEST SCOPE (delta gate fix, adversarial W-D1): this test asserts the
  // OUTCOME, and on a plain changed-file rescan the value is actually restored
  // by the Phase-2 partial-reheat gap-fill, NOT by the re-init carry-forward at
  // server.js:4014-4018 -- the two guards mutually mask, and deleting either
  // one alone leaves this test green. The carry-forward is isolated by the
  // NEXT test. This comment used to claim it covered the re-init branch, which
  // was false, and a false claim in a test comment is exactly what the wave's
  // headline finding was about.
  const filePath = path.join(downloadDir, 'Re-encoded [ggggggggggg].mp4');
  fs.writeFileSync(filePath, 'original bytes');

  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta.ggggggggggg = {
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      sourceViewCount: 987654,
      sourceFollowerCount: 24000,
      capturedAt: CAPTURED_AT,
    };
  });

  await scanDirectories();
  const id = getMediaId(filePath);
  assert.equal(loadDatabase().metadata[id].sourceViewCount, 987654, 'precondition: the bridge fired');

  // Same path, different SIZE -> the scan takes its re-init branch and rebuilds
  // the item from scratch. The id is path-derived, so it is unchanged.
  fs.writeFileSync(filePath, 'a completely different, much longer set of bytes than before');

  await scanDirectories();
  const item = loadDatabase().metadata[id];
  assert.equal(item.sourceViewCount, 987654, 'the count survives a re-encode');
  assert.equal(item.sourceViewCountCapturedAt, CAPTURED_AT, 'with its original capture date, not a fresh one');
  // v1.54 gate round 1 W2: the follower pair must survive the same re-encode.
  assert.equal(item.sourceFollowerCount, 24000, 'the follower count survives a re-encode');
  assert.equal(item.sourceFollowerCountCapturedAt, CAPTURED_AT);
}));

test('the re-init carry-forward ALONE preserves a count when the Phase-2 gap-fill cannot', () => withYtdlpEnv(async () => {
  // DELTA GATE FIX (adversarial W-D1). Isolates server.js:4014-4018, which the
  // test above cannot reach because the Phase-2 gap-fill masks it.
  //
  // The construction: a concurrent writer STRIPS the count off the live db row,
  // so at merge time the gap-fill's source (`freshItem`) has nothing to offer
  // and the only thing that can still carry the value is the scan's own re-init
  // carry-forward, which read it from the Phase-1 snapshot taken before the
  // strip. Delete the carry-forward and this test fails; that is the point.
  //
  // PRECONDITION, AND IT IS EXACT (delta gate fix, adversarial W-E1). The strip's
  // `updateDatabase` MUST be enqueued in the SAME SYNCHRONOUS TURN as
  // `scanDirectories()`, so it takes the save lock ahead of the scan's Phase-2
  // acquisition. That ordering is guaranteed by event-loop semantics rather than
  // by timing -- the reviewer measured 30/30 green including under 2x CPU
  // oversubscription, and separately measured that inserting even a 1ms delay
  // makes the strip the LAST writer, which deletes the fields from the final
  // state and fails this test.
  //
  // So: DO NOT introduce an `await` between the two calls below -- not a log, not
  // a helper wrapper, not `await Promise.resolve()`. There is no timing window to
  // widen; there is an ordering requirement to preserve. The failure mode is a
  // false FAILURE (production fine, test red), which is the safe direction, but
  // it would still block a release.
  const filePath = path.join(downloadDir, 'Carry Forward Only [ooooooooooo].mp4');
  fs.writeFileSync(filePath, 'original bytes');

  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta.ooooooooooo = {
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      sourceViewCount: 424242,
      sourceFollowerCount: 313313,
      capturedAt: CAPTURED_AT,
    };
  });

  await scanDirectories();
  const id = getMediaId(filePath);
  assert.equal(loadDatabase().metadata[id].sourceViewCount, 424242, 'precondition: the bridge fired');

  // Same path, NEW size -> the next scan rebuilds this item via the re-init
  // branch. A brand-new sibling file gives that scan an async probe to await.
  fs.writeFileSync(filePath, 'a completely different, much longer set of bytes than before');
  fs.writeFileSync(path.join(downloadDir, 'Yield Sibling [ppppppppppp].mp4'), 'new-video-bytes');

  const scanPromise = scanDirectories();
  const stripPromise = updateDatabase((db) => {
    const live = db.metadata[id];
    if (live) {
      delete live.sourceViewCount;
      delete live.sourceViewCountCapturedAt;
      delete live.sourceFollowerCount;
      delete live.sourceFollowerCountCapturedAt;
    }
    return true;
  });

  await Promise.all([scanPromise, stripPromise]);

  const item = loadDatabase().metadata[id];
  assert.equal(item.sourceViewCount, 424242,
    'the re-init carry-forward supplied it -- the gap-fill had nothing to supply');
  assert.equal(item.sourceViewCountCapturedAt, CAPTURED_AT,
    'and the ORIGINAL capture date came with it');
  // v1.54 gate round 1 W2: the follower carry-forward branch, isolated the
  // same way -- delete server.js's follower re-init carry pair and this fails.
  assert.equal(item.sourceFollowerCount, 313313,
    'the follower re-init carry-forward supplied it too');
  assert.equal(item.sourceFollowerCountCapturedAt, CAPTURED_AT);
}));

test('an item with NO capture never gains a sourceViewCount (the mock fallback stays the render-side default)', () => withYtdlpEnv(async () => {
  const filePath = path.join(downloadDir, 'No Capture At All.mp4');
  fs.writeFileSync(filePath, 'v');

  await scanDirectories();

  const item = loadDatabase().metadata[getMediaId(filePath)];
  assert.equal(item.sourceViewCount, undefined,
    'absent, not 0 -- 0 is a REAL count and the renderer must be able to tell them apart');
  assert.equal(item.sourceViewCountCapturedAt, undefined);
}));

test('a ZERO captured count survives the scan as a real 0, not as "absent"', () => withYtdlpEnv(async () => {
  // A brand-new upload genuinely has 0 views. Any truthiness test anywhere in
  // the chain collapses this to absent and the UI substitutes a fabricated
  // number that is guaranteed to be wrong.
  const filePath = path.join(downloadDir, 'Brand New [hhhhhhhhhhh].mp4');
  fs.writeFileSync(filePath, 'v');

  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta.hhhhhhhhhhh = {
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      sourceViewCount: 0,
      capturedAt: CAPTURED_AT,
    };
  });

  await scanDirectories();

  const item = loadDatabase().metadata[getMediaId(filePath)];
  assert.equal(item.sourceViewCount, 0, 'stored as a genuine 0');
  assert.equal(item.sourceViewCountCapturedAt, CAPTURED_AT, 'and dated, so the UI can label it');
}));

test('a hostile/invalid captured count is rejected at the boundary and never reaches the item', () => withYtdlpEnv(async () => {
  const filePath = path.join(downloadDir, 'Hostile Capture [iiiiiiiiiii].mp4');
  fs.writeFileSync(filePath, 'v');

  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.downloadMeta.iiiiiiiiiii = {
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      sourceViewCount: -999,
      capturedAt: CAPTURED_AT,
    };
  });

  await scanDirectories();

  const item = loadDatabase().metadata[getMediaId(filePath)];
  assert.equal(item.sourceViewCount, undefined, 'a negative count never becomes item state');
  assert.equal(item.sourceViewCountCapturedAt, undefined, 'and no orphan date is left behind');
}));

// ---- GATE FIX (adversarial CRITICAL C1): the remaining write paths ----------
//
// The mutation survivors that made this section necessary:
//   MUTANT-B  Phase-2 completed-mid-scan adoption -> if (false)
//   MUTANT-C  Phase-2 partial-reheat gap-fill     -> if (false)
//   MUTANT-D  applyCapturedViewCount on the D1a proxy-host lane -> commented out
// All three were green against the whole suite.

test('D1a proxy-host lane: a [Youtube=<id>]-bracketed file still receives its captured count', () => withYtdlpEnv(async () => {
  // A proxy-host YouTube item carries the UNIVERSAL bracket shape on disk, so
  // the plain-bracket `videoId` path never runs -- but its capture was stored by
  // the YouTube sanitize branch under the BARE video id. This is the recovery
  // path (gate W2 of v1.41.13), and its view-count call was the one mutation the
  // new bridge tests did not cover.
  const base = 'Proxied Clip [Youtube=jjjjjjjjjjj].mp4';
  const filePath = path.join(downloadDir, base);
  fs.writeFileSync(filePath, 'not a real video');

  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    // Keyed by the BARE id (the YouTube branch's key), NOT the composite.
    ns.downloadMeta.jjjjjjjjjjj = {
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelName: 'Proxied Channel',
      sourceViewCount: 31337,
      sourceFollowerCount: 777000,
      capturedAt: CAPTURED_AT,
    };
  });

  await scanDirectories();

  const item = loadDatabase().metadata[getMediaId(filePath)];
  assert.equal(item.youtubeId, 'jjjjjjjjjjj', 'precondition: the D1a recovery ran');
  assert.equal(item.sourceViewCount, 31337, 'and it carried the view count too');
  assert.equal(item.sourceViewCountCapturedAt, CAPTURED_AT);
  // v1.54 gate round 1 (adversarial W1): this apply site was the one
  // follower-count mutation survivor -- deleting it left the suite green.
  assert.equal(item.sourceFollowerCount, 777000, 'the D1a lane carries the follower count too');
  assert.equal(item.sourceFollowerCountCapturedAt, CAPTURED_AT);
}));

test('Phase-2 adoption: a reheat-written count landing MID-SCAN survives the final merge', () => withYtdlpEnv(async () => {
  // MUTANT-B. The scan replaces db.metadata wholesale from its Phase-1
  // snapshot; without the adoption branch, a count the reheat wrote while the
  // scan was awaiting a probe is reverted to the pre-reheat value -- silently
  // undoing the refresh Dean triggered.
  const { recordRepulledItemMeta } = require('../../server');

  // A brand-new file forces the scan through its async probe yield window.
  const yieldPath = path.join(downloadDir, 'Fresh Yield [kkkkkkkkkkk].mp4');
  fs.writeFileSync(yieldPath, 'new-video-bytes');

  // An already-indexed, unchanged, codec-fields-present item -> reuse fast path.
  const reheatPath = path.join(downloadDir, 'Reheated Views Mid Scan.mp4');
  fs.writeFileSync(reheatPath, 'existing-bytes');
  const reheatId = getMediaId(reheatPath);

  await updateDatabase((db) => {
    db.metadata[reheatId] = {
      id: reheatId, name: path.basename(reheatPath), title: 'Reheated Views Mid Scan', filePath: reheatPath,
      folderName: path.basename(downloadDir), size: fs.statSync(reheatPath).size, ext: '.mp4',
      type: 'video', addedAt: 1700000000000, duration: 30, hasThumbnail: false, artist: '',
      tags: {}, needsTranscode: false, videoCodec: 'h264', audioCodec: 'aac',
      releaseDate: 1000, rootFolder: downloadDir, youtubeId: 'lllllllllll',
      sourceViewCount: 100, sourceViewCountCapturedAt: 1000,
      sourceFollowerCount: 200, sourceFollowerCountCapturedAt: 1000,
    };
    return true;
  });

  const scanPromise = scanDirectories();
  const reheatPromise = recordRepulledItemMeta(
    { loadDatabase, updateDatabase, getMediaId },
    reheatId,
    { filePath: reheatPath, sourceViewCount: 9_000_000, sourceFollowerCount: 12_000, markComplete: true },
    1_800_000_000_000,
  );

  await Promise.all([scanPromise, reheatPromise]);

  const item = loadDatabase().metadata[reheatId];
  assert.equal(item.sourceViewCount, 9_000_000,
    'the mid-scan reheat count must survive the final merge, not revert to 100');
  assert.equal(item.sourceViewCountCapturedAt, 1_800_000_000_000, 'with its fresh date');
  // v1.54 gate round 1 W2: the follower completed-adoption pair, same merge.
  assert.equal(item.sourceFollowerCount, 12_000,
    'the mid-scan reheat FOLLOWER count must survive the final merge, not revert to 200');
  assert.equal(item.sourceFollowerCountCapturedAt, 1_800_000_000_000);
}));

test('Phase-2 gap-fill: a PARTIAL mid-scan reheat that first populated a count is not lost to the snapshot', () => withYtdlpEnv(async () => {
  // MUTANT-C. A reheat that did NOT advance the completion marker still
  // populated a count for the first time; the completed-adoption branch above
  // does not fire for it, so without the gap-fill the item keeps rendering a
  // fabricated mock count.
  const { recordRepulledItemMeta } = require('../../server');

  const yieldPath = path.join(downloadDir, 'Fresh Yield Two [mmmmmmmmmmm].mp4');
  fs.writeFileSync(yieldPath, 'new-video-bytes');

  const partialPath = path.join(downloadDir, 'Partially Reheated.mp4');
  fs.writeFileSync(partialPath, 'existing-bytes');
  const partialId = getMediaId(partialPath);

  await updateDatabase((db) => {
    db.metadata[partialId] = {
      id: partialId, name: path.basename(partialPath), title: 'Partially Reheated', filePath: partialPath,
      folderName: path.basename(downloadDir), size: fs.statSync(partialPath).size, ext: '.mp4',
      type: 'video', addedAt: 1700000000000, duration: 30, hasThumbnail: false, artist: '',
      tags: {}, needsTranscode: false, videoCodec: 'h264', audioCodec: 'aac',
      releaseDate: 1000, rootFolder: downloadDir, youtubeId: 'nnnnnnnnnnn',
      // NO sourceViewCount (and no sourceFollowerCount) at all -- this
      // reheat is its first.
    };
    return true;
  });

  const scanPromise = scanDirectories();
  const reheatPromise = recordRepulledItemMeta(
    { loadDatabase, updateDatabase, getMediaId },
    partialId,
    { filePath: partialPath, sourceViewCount: 555_000, sourceFollowerCount: 44_000, markComplete: false }, // PARTIAL: marker withheld
    1_800_000_000_000,
  );

  await Promise.all([scanPromise, reheatPromise]);

  const item = loadDatabase().metadata[partialId];
  assert.equal(item.sourceViewCount, 555_000,
    'a first-ever count from a PARTIAL reheat must survive the merge');
  assert.equal(item.sourceViewCountCapturedAt, 1_800_000_000_000);
  // v1.54 gate round 1 W2: the follower gap-fill pair, same merge.
  assert.equal(item.sourceFollowerCount, 44_000,
    'a first-ever FOLLOWER count from a PARTIAL reheat must survive the merge');
  assert.equal(item.sourceFollowerCountCapturedAt, 1_800_000_000_000);
}));
