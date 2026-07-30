'use strict';

// [UNIT] v1.56 (Dean's bulk subscriber-count reheat) --
// `recordChannelFollowerCountFanout`, the ONE channel->items fan-out writer
// (server.js, deps-injected into lib/ytdlp/index.js's reheat-subs batch).
//
// The writer's blast radius is EVERY item in db.metadata, so this suite pins
// the match rule adversarially rather than just the happy path:
//   - channelId decides when BOTH sides know one (recordRepulledItemMeta's
//     `sameChannel` rule) -- a URL-equal item with a DIFFERENT id must NOT be
//     stamped, and an id-equal item with a different URL spelling MUST be.
//   - URL equality (channelUrl AND channelHandleUrl, against the target's url
//     and the probe's canonical url alike) is the fallback when either side
//     has no id.
//   - supersede is UNCONDITIONAL (the v1.54 no-monotonicity decision): a
//     LOWER fresh count replaces a higher stored one.
//   - count + capture date written as a UNIT from the injected clock.
//   - an invalid count is a total no-op: resolves 0, never even calls
//     updateDatabase.
//   - a pass that matches nothing returns `false` from the mutator (the
//     skip-the-save contract) and resolves 0.
//
// Deps are FAKE (an in-memory db object) -- the writer touches nothing but
// `deps.updateDatabase`, so no server boot, filesystem, or scan is involved.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-reheat-subs-fanout-'));

const { test } = require('node:test');
const assert = require('node:assert');
const { recordChannelFollowerCountFanout } = require('../../server');

const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);
const UC_A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const UC_B = 'UCbbbbbbbbbbbbbbbbbbbbbb';
const URL_A = 'https://www.youtube.com/channel/' + UC_A;
const HANDLE_A = 'https://www.youtube.com/@channel-a';

function makeDeps(metadata) {
  const db = { metadata };
  const mutatorReturns = [];
  return {
    db,
    mutatorReturns,
    deps: {
      updateDatabase: (fn) => {
        const result = fn(db);
        mutatorReturns.push(result);
        return Promise.resolve(result);
      },
    },
  };
}

test('stamps count + capture date as a UNIT (injected clock) on every channelId-matched item; unmatched items untouched', async () => {
  const { deps, db } = makeDeps({
    a1: { id: 'a1', channelId: UC_A, channelUrl: URL_A },
    a2: { id: 'a2', channelId: UC_A, channelUrl: 'https://www.youtube.com/@a-different-spelling' },
    b1: { id: 'b1', channelId: UC_B, channelUrl: 'https://www.youtube.com/channel/' + UC_B, sourceFollowerCount: 5, sourceFollowerCountCapturedAt: 123 },
  });
  const updated = await recordChannelFollowerCountFanout(
    deps,
    { channelId: UC_A, channelUrl: URL_A },
    { followerCount: 2470000, channelId: UC_A, channelUrl: URL_A },
    NOW,
  );
  assert.strictEqual(updated, 2);
  assert.strictEqual(db.metadata.a1.sourceFollowerCount, 2470000);
  assert.strictEqual(db.metadata.a1.sourceFollowerCountCapturedAt, NOW);
  assert.strictEqual(db.metadata.a2.sourceFollowerCount, 2470000, 'id match must win even when the URL spelling differs');
  assert.strictEqual(db.metadata.a2.sourceFollowerCountCapturedAt, NOW);
  assert.strictEqual(db.metadata.b1.sourceFollowerCount, 5, 'a different channel must never be stamped');
  assert.strictEqual(db.metadata.b1.sourceFollowerCountCapturedAt, 123);
});

test('channelId DECIDES when both sides know one: a URL-equal item with a DIFFERENT id is never stamped', async () => {
  const { deps, db } = makeDeps({
    impostor: { id: 'impostor', channelId: UC_B, channelUrl: URL_A },
  });
  const updated = await recordChannelFollowerCountFanout(
    deps,
    { channelId: UC_A, channelUrl: URL_A },
    { followerCount: 100, channelId: UC_A, channelUrl: URL_A },
    NOW,
  );
  assert.strictEqual(updated, 0);
  assert.strictEqual(db.metadata.impostor.sourceFollowerCount, undefined);
});

test('URL fallback when the item has no channelId: matches the TARGET url, the PROBE canonical url, and channelHandleUrl alike', async () => {
  const { deps, db } = makeDeps({
    byTargetUrl: { id: 'byTargetUrl', channelUrl: HANDLE_A },
    byCanonicalUrl: { id: 'byCanonicalUrl', channelUrl: URL_A },
    byHandleField: { id: 'byHandleField', channelUrl: 'https://example.com/elsewhere', channelHandleUrl: HANDLE_A },
    noIdentity: { id: 'noIdentity', title: 'no channel fields at all' },
  });
  // Target enumerated from items that only knew the HANDLE url; the probe
  // resolved the canonical /channel/UC... form (no ids known on either side
  // for the fallback items).
  const updated = await recordChannelFollowerCountFanout(
    deps,
    { channelId: null, channelUrl: HANDLE_A },
    { followerCount: 777, channelId: null, channelUrl: URL_A },
    NOW,
  );
  assert.strictEqual(updated, 3);
  assert.strictEqual(db.metadata.byTargetUrl.sourceFollowerCount, 777);
  assert.strictEqual(db.metadata.byCanonicalUrl.sourceFollowerCount, 777);
  assert.strictEqual(db.metadata.byHandleField.sourceFollowerCount, 777);
  assert.strictEqual(db.metadata.noIdentity.sourceFollowerCount, undefined, 'an identity-less item must never match anything');
});

test('an item WITH a channelId still matches by id when the probe discovered the id the target lacked', async () => {
  const { deps, db } = makeDeps({
    idOnly: { id: 'idOnly', channelId: UC_A, channelUrl: 'https://www.youtube.com/@yet-another-spelling' },
  });
  const updated = await recordChannelFollowerCountFanout(
    deps,
    { channelId: null, channelUrl: HANDLE_A },
    { followerCount: 42, channelId: UC_A, channelUrl: URL_A },
    NOW,
  );
  assert.strictEqual(updated, 1, 'the probe-discovered id must vouch for id-bearing items');
  assert.strictEqual(db.metadata.idOnly.sourceFollowerCount, 42);
});

test('supersedes UNCONDITIONALLY: a LOWER fresh count replaces a higher stored one (v1.54 no-monotonicity decision)', async () => {
  const { deps, db } = makeDeps({
    a1: { id: 'a1', channelId: UC_A, sourceFollowerCount: 1000000, sourceFollowerCountCapturedAt: 123 },
  });
  const updated = await recordChannelFollowerCountFanout(
    deps,
    { channelId: UC_A, channelUrl: URL_A },
    { followerCount: 900000, channelId: UC_A, channelUrl: URL_A },
    NOW,
  );
  assert.strictEqual(updated, 1);
  assert.strictEqual(db.metadata.a1.sourceFollowerCount, 900000);
  assert.strictEqual(db.metadata.a1.sourceFollowerCountCapturedAt, NOW);
});

test('a genuine 0 count is a real value and lands; legacy viewCount and sourceViewCount stay untouched', async () => {
  const { deps, db } = makeDeps({
    a1: { id: 'a1', channelId: UC_A, viewCount: 3, sourceViewCount: 12000, sourceViewCountCapturedAt: 456 },
  });
  const updated = await recordChannelFollowerCountFanout(
    deps,
    { channelId: UC_A, channelUrl: URL_A },
    { followerCount: 0, channelId: UC_A, channelUrl: URL_A },
    NOW,
  );
  assert.strictEqual(updated, 1);
  assert.strictEqual(db.metadata.a1.sourceFollowerCount, 0);
  assert.strictEqual(db.metadata.a1.viewCount, 3, 'the legacy LOCAL watch counter must never be touched');
  assert.strictEqual(db.metadata.a1.sourceViewCount, 12000);
  assert.strictEqual(db.metadata.a1.sourceViewCountCapturedAt, 456);
});

test('a manually-attributed item is still stamped: the count belongs to the channel its hand-set identity names', async () => {
  const { deps, db } = makeDeps({
    manual: { id: 'manual', channelUrl: URL_A, channelAttributedManually: true },
  });
  const updated = await recordChannelFollowerCountFanout(
    deps,
    { channelId: null, channelUrl: URL_A },
    { followerCount: 555, channelId: null, channelUrl: null },
    NOW,
  );
  assert.strictEqual(updated, 1);
  assert.strictEqual(db.metadata.manual.sourceFollowerCount, 555);
});

test('an INVALID count is a total no-op: resolves 0 and never calls updateDatabase (re-validated at the write boundary, never trusted)', async () => {
  for (const bad of [undefined, null, -1, 1.5, 'lots', Number.NaN, Infinity, 1e13]) {
    const { deps, db, mutatorReturns } = makeDeps({
      a1: { id: 'a1', channelId: UC_A, sourceFollowerCount: 5, sourceFollowerCountCapturedAt: 123 },
    });
    const updated = await recordChannelFollowerCountFanout(
      deps,
      { channelId: UC_A, channelUrl: URL_A },
      { followerCount: bad, channelId: UC_A, channelUrl: URL_A },
      NOW,
    );
    assert.strictEqual(updated, 0, `count ${String(bad)} must update nothing`);
    assert.strictEqual(mutatorReturns.length, 0, `count ${String(bad)} must never reach updateDatabase`);
    assert.strictEqual(db.metadata.a1.sourceFollowerCount, 5);
    assert.strictEqual(db.metadata.a1.sourceFollowerCountCapturedAt, 123);
  }
});

test('a pass that matches nothing returns false from the mutator (save skipped) and resolves 0', async () => {
  const { deps, mutatorReturns } = makeDeps({
    b1: { id: 'b1', channelId: UC_B, channelUrl: 'https://www.youtube.com/channel/' + UC_B },
  });
  const updated = await recordChannelFollowerCountFanout(
    deps,
    { channelId: UC_A, channelUrl: URL_A },
    { followerCount: 9, channelId: UC_A, channelUrl: URL_A },
    NOW,
  );
  assert.strictEqual(updated, 0);
  assert.deepStrictEqual(mutatorReturns, [false], 'the mutator must return false so the save is skipped entirely');
});

test('a target/probe pair with NO usable identity at all is a no-op that never calls updateDatabase', async () => {
  const { deps, mutatorReturns } = makeDeps({
    a1: { id: 'a1', channelId: UC_A },
  });
  const updated = await recordChannelFollowerCountFanout(
    deps,
    { channelId: null, channelUrl: null },
    { followerCount: 9, channelId: null, channelUrl: null },
    NOW,
  );
  assert.strictEqual(updated, 0);
  assert.strictEqual(mutatorReturns.length, 0);
});

test('missing/malformed deps resolve 0, never throw', async () => {
  assert.strictEqual(await recordChannelFollowerCountFanout(null, { channelId: UC_A }, { followerCount: 9 }, NOW), 0);
  assert.strictEqual(await recordChannelFollowerCountFanout({}, { channelId: UC_A }, { followerCount: 9 }, NOW), 0);
  const { deps } = makeDeps({});
  assert.strictEqual(await recordChannelFollowerCountFanout(deps, null, null, NOW), 0);
});
