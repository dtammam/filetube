'use strict';

// [UNIT] v1.22.0 FR-2 -- lib/ytdlp/index.js's retroactive, folder-based
// Subscribe-button backfill: the pure `matchChannelDirToSubscription`
// matcher (AC15) and the `backfillChannelIdentityFromFolder` module wrapper
// (per-scan memoization + AC18 re-validation), tested directly (no HTTP/app
// boot needed) alongside the end-to-end scan proof in
// test/integration/ytdlp-folder-backfill.test.js.
//
// See docs/exec-plans/active/2026-07-08-v1.22-player-parity.md's
// "### FR-2 -- retroactive Subscribe-button backfill / creator re-association"
// design section.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const { matchChannelDirToSubscription, backfillChannelIdentityFromFolder } = require('../../lib/ytdlp');
const args = require('../../lib/ytdlp/args');

function makeConfig(overrides = {}) {
  return {
    downloadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-folder-backfill-')),
    cookiesFile: null,
    ...overrides,
  };
}

function resolveDir(config, sub) {
  return args.resolveChannelDir(config, sub);
}

// ---- matchChannelDirToSubscription (AC15) ----------------------------------

test('matchChannelDirToSubscription: EXACT parent-dir match returns the matched subscription\'s identity', () => {
  const config = makeConfig();
  const sub = { id: 'sub1', name: 'Some Channel', channelUrl: 'https://www.youtube.com/@somechannel', channelDir: resolveDir(config, { name: 'Some Channel' }) };
  const filePath = path.join(sub.channelDir, 'A Great Video [dQw4w9WgXcQ].mp4');

  const result = matchChannelDirToSubscription(filePath, [sub]);

  assert.deepEqual(result, { channelUrl: sub.channelUrl, channelName: sub.name });
});

test('matchChannelDirToSubscription: a file merely sharing a path PREFIX (not the exact parent dir) is REJECTED', () => {
  const config = makeConfig();
  const sub = { id: 'sub1', name: 'Some Channel', channelUrl: 'https://www.youtube.com/@somechannel', channelDir: resolveDir(config, { name: 'Some Channel' }) };
  // "Some Channel 2" is a sibling directory, not a child of sub.channelDir --
  // a startsWith/prefix test would wrongly match this; exact equality must not.
  const siblingDir = `${sub.channelDir} 2`;
  fs.mkdirSync(siblingDir, { recursive: true });
  const filePath = path.join(siblingDir, 'Unrelated Video [zzzzzzzzzz1].mp4');

  assert.equal(matchChannelDirToSubscription(filePath, [sub]), null);
});

test('matchChannelDirToSubscription: a file in a nested subdirectory of the channelDir does not match (yt-dlp lands files FLAT)', () => {
  const config = makeConfig();
  const sub = { id: 'sub1', name: 'Some Channel', channelUrl: 'https://www.youtube.com/@somechannel', channelDir: resolveDir(config, { name: 'Some Channel' }) };
  const filePath = path.join(sub.channelDir, 'nested', 'Video [zzzzzzzzzz2].mp4');

  assert.equal(matchChannelDirToSubscription(filePath, [sub]), null);
});

test('matchChannelDirToSubscription: disambiguates correctly among MULTIPLE subscriptions', () => {
  const config = makeConfig();
  const subA = { id: 'subA', name: 'Channel A', channelUrl: 'https://www.youtube.com/@channela', channelDir: resolveDir(config, { name: 'Channel A' }) };
  const subB = { id: 'subB', name: 'Channel B', channelUrl: 'https://www.youtube.com/@channelb', channelDir: resolveDir(config, { name: 'Channel B' }) };
  const filePath = path.join(subB.channelDir, 'B Video [zzzzzzzzzz3].mp4');

  const result = matchChannelDirToSubscription(filePath, [subA, subB]);

  assert.deepEqual(result, { channelUrl: subB.channelUrl, channelName: subB.name });
});

test('matchChannelDirToSubscription: returns null when there is no matching subscription', () => {
  const config = makeConfig();
  const sub = { id: 'sub1', name: 'Some Channel', channelUrl: 'https://www.youtube.com/@somechannel', channelDir: resolveDir(config, { name: 'Some Channel' }) };
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-unrelated-'));
  const filePath = path.join(otherDir, 'Video [zzzzzzzzzz4].mp4');

  assert.equal(matchChannelDirToSubscription(filePath, [sub]), null);
});

test('matchChannelDirToSubscription: a subscription that failed channelDir resolution/confinement (no channelDir field) is skipped, never matched', () => {
  const config = makeConfig();
  const unresolved = { id: 'sub1', name: 'Broken', channelUrl: 'https://www.youtube.com/@broken' }; // no channelDir
  const filePath = path.join(config.downloadDir, 'Broken', 'Video [zzzzzzzzzz5].mp4');

  assert.equal(matchChannelDirToSubscription(filePath, [unresolved]), null);
});

test('matchChannelDirToSubscription: includes channelId only when the matched subscription actually has one', () => {
  const config = makeConfig();
  const subWithId = { id: 'sub1', name: 'Has Id', channelUrl: 'https://www.youtube.com/channel/UC12345', channelId: 'UC12345', channelDir: resolveDir(config, { name: 'Has Id' }) };
  const filePath = path.join(subWithId.channelDir, 'Video [zzzzzzzzzz6].mp4');

  assert.deepEqual(matchChannelDirToSubscription(filePath, [subWithId]), {
    channelUrl: subWithId.channelUrl,
    channelName: subWithId.name,
    channelId: 'UC12345',
  });
});

test('matchChannelDirToSubscription: malformed/missing input never throws -- null', () => {
  assert.equal(matchChannelDirToSubscription(null, []), null);
  assert.equal(matchChannelDirToSubscription(undefined, []), null);
  assert.equal(matchChannelDirToSubscription('', []), null);
  assert.equal(matchChannelDirToSubscription('/some/path.mp4', null), null);
  assert.equal(matchChannelDirToSubscription('/some/path.mp4', undefined), null);
  assert.doesNotThrow(() => matchChannelDirToSubscription('/some/path.mp4', [null, undefined, {}]));
});

// ---- backfillChannelIdentityFromFolder (module wrapper) ---------------------

test('backfillChannelIdentityFromFolder: backfills channelUrl + channelName for an item under a configured subscription\'s channelDir', () => {
  const config = makeConfig();
  const channelDir = resolveDir(config, { name: 'My Creator' });
  const fresh = { ytdlp: { subscriptions: [{ id: 'sub1', name: 'My Creator', channelUrl: 'https://www.youtube.com/@mycreator' }] } };
  const item = { filePath: path.join(channelDir, 'Great Video [zzzzzzzzzz7].mp4') };

  const result = backfillChannelIdentityFromFolder(fresh, item, config);

  assert.deepEqual(result, { channelUrl: 'https://www.youtube.com/@mycreator', channelName: 'My Creator' });
});

test('backfillChannelIdentityFromFolder: NEVER-OVERWRITE guard is the CALLER\'s responsibility -- this function itself is a pure lookup that always returns a match when one exists (server.js is what skips calling it for an item that already has channelUrl)', () => {
  // Documents the layering: the wrapper does not know/care whether the
  // caller already has an existing channelUrl -- server.js's scan mutator
  // is solely responsible for the `!item.channelUrl` guard before ever
  // calling this function (see server.js's Phase-2 mutator comment). This
  // test proves the function has no such internal state to accidentally
  // rely on: calling it twice for the same item is idempotent/side-effect-free.
  const config = makeConfig();
  const channelDir = resolveDir(config, { name: 'Idempotent Channel' });
  const fresh = { ytdlp: { subscriptions: [{ id: 'sub1', name: 'Idempotent Channel', channelUrl: 'https://www.youtube.com/@idempotent' }] } };
  const item = { filePath: path.join(channelDir, 'Video [zzzzzzzzzz8].mp4') };

  const first = backfillChannelIdentityFromFolder(fresh, item, config);
  const second = backfillChannelIdentityFromFolder(fresh, item, config);

  assert.deepEqual(first, second);
});

test('backfillChannelIdentityFromFolder: memoizes resolvedSubs ONCE per `fresh` db object -- a later mutation to fresh.ytdlp.subscriptions within the SAME scan is not picked up', () => {
  const config = makeConfig();
  const channelDirA = resolveDir(config, { name: 'Channel A' });
  const channelDirLate = resolveDir(config, { name: 'Late Added Channel' });
  const fresh = { ytdlp: { subscriptions: [{ id: 'subA', name: 'Channel A', channelUrl: 'https://www.youtube.com/@channela' }] } };

  // First call memoizes resolvedSubs from the subscriptions array as it
  // exists right now.
  const itemA = { filePath: path.join(channelDirA, 'Video [zzzzzzzzzz9].mp4') };
  assert.ok(backfillChannelIdentityFromFolder(fresh, itemA, config));

  // Mutating fresh.ytdlp.subscriptions AFTER the first call (simulating a
  // hypothetical mid-scan change) must NOT be picked up -- the memoized
  // snapshot for this `fresh` object is fixed for the rest of the scan.
  fresh.ytdlp.subscriptions.push({ id: 'subLate', name: 'Late Added Channel', channelUrl: 'https://www.youtube.com/@lateadded' });
  const itemLate = { filePath: path.join(channelDirLate, 'Video [zzzzzzzzz10].mp4') };

  assert.equal(backfillChannelIdentityFromFolder(fresh, itemLate, config), null, 'a subscription added to fresh.ytdlp.subscriptions AFTER the first call must not be visible -- resolvedSubs is memoized once per fresh object');
});

test('backfillChannelIdentityFromFolder: a DIFFERENT fresh db object gets its own independent memoization (no cross-scan leakage)', () => {
  const config = makeConfig();
  const channelDir = resolveDir(config, { name: 'Fresh Scoped Channel' });
  const freshScan1 = { ytdlp: { subscriptions: [] } };
  const freshScan2 = { ytdlp: { subscriptions: [{ id: 'sub1', name: 'Fresh Scoped Channel', channelUrl: 'https://www.youtube.com/@freshscoped' }] } };
  const item = { filePath: path.join(channelDir, 'Video [zzzzzzzz11].mp4') };

  assert.equal(backfillChannelIdentityFromFolder(freshScan1, item, config), null, 'scan 1 has no subscriptions -- no match');
  assert.deepEqual(
    backfillChannelIdentityFromFolder(freshScan2, item, config),
    { channelUrl: 'https://www.youtube.com/@freshscoped', channelName: 'Fresh Scoped Channel' },
    'scan 2 is an independently memoized fresh object -- its own subscriptions must be visible'
  );
});

test('backfillChannelIdentityFromFolder (AC18): a matched channelUrl that FAILS re-validation is dropped, never returned', () => {
  const config = makeConfig();
  const channelDir = resolveDir(config, { name: 'Hostile Channel' });
  // Simulates a corrupted/hand-edited subscription record bypassing
  // validateSubscriptionInput entirely -- the backfill must independently
  // re-validate, never trust a stored channelUrl blindly.
  const fresh = { ytdlp: { subscriptions: [{ id: 'sub1', name: 'Hostile Channel', channelUrl: 'https://evil.com/@x; rm -rf /' }] } };
  const item = { filePath: path.join(channelDir, 'Video [zzzzzzzz12].mp4') };

  assert.equal(backfillChannelIdentityFromFolder(fresh, item, config), null);
});

test('backfillChannelIdentityFromFolder: no subscriptions configured (disabled module / none added) -> null, never throws (AC21)', () => {
  const config = makeConfig();
  const fresh = { ytdlp: { subscriptions: [] } };
  const item = { filePath: path.join(config.downloadDir, 'Orphan Channel', 'Video [zzzzzzzz13].mp4') };

  assert.equal(backfillChannelIdentityFromFolder(fresh, item, config), null);
});

test('backfillChannelIdentityFromFolder: malformed item (no filePath) -> null, never throws', () => {
  const config = makeConfig();
  const fresh = { ytdlp: { subscriptions: [{ id: 'sub1', name: 'X', channelUrl: 'https://www.youtube.com/@x' }] } };

  assert.equal(backfillChannelIdentityFromFolder(fresh, {}, config), null);
  assert.equal(backfillChannelIdentityFromFolder(fresh, null, config), null);
  assert.equal(backfillChannelIdentityFromFolder(fresh, undefined, config), null);
});

test('backfillChannelIdentityFromFolder: an absent/malformed fresh.ytdlp namespace is treated as no subscriptions, never throws (mirrors store.ensureYtdlp\'s backfill)', () => {
  const config = makeConfig();
  const channelDir = resolveDir(config, { name: 'No Namespace' });
  const item = { filePath: path.join(channelDir, 'Video [zzzzzzzz14].mp4') };

  assert.equal(backfillChannelIdentityFromFolder({}, item, config), null);
});
