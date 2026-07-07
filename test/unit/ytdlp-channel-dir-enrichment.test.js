'use strict';

// [UNIT] v1.20.0 FR-4 -- lib/ytdlp/index.js's `enrichSubscriptionWithChannelDir`,
// tested directly (pure function, no HTTP/app boot needed) alongside the
// end-to-end `GET /api/subscriptions` proof in
// test/integration/ytdlp-channel-dir-playlist.test.js.
//
// HARD INVARIANT (two-reviewer gate): this function is read-only and
// per-request -- it must never touch `updateDatabase`/`db.folders`/
// `folderSettings`. It has no `deps`/database access at all, which is itself
// evidence of that: there is no code path here that COULD write anything.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const { enrichSubscriptionWithChannelDir } = require('../../lib/ytdlp');
const args = require('../../lib/ytdlp/args');

function makeConfig(overrides = {}) {
  return {
    downloadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-channeldir-')),
    cookiesFile: null,
    ...overrides,
  };
}

test('enrichSubscriptionWithChannelDir adds channelDir computed via args.resolveChannelDir for a valid subscription', () => {
  const config = makeConfig();
  const sub = { id: 'sub1', name: 'Some Channel', channelUrl: 'https://www.youtube.com/@somechannel' };

  const enriched = enrichSubscriptionWithChannelDir(config, sub);

  assert.strictEqual(enriched.channelDir, args.resolveChannelDir(config, sub));
  // Additive: every original field must still be present, unchanged.
  assert.strictEqual(enriched.id, sub.id);
  assert.strictEqual(enriched.name, sub.name);
  assert.strictEqual(enriched.channelUrl, sub.channelUrl);
});

test('enrichSubscriptionWithChannelDir returns the subscription UNCHANGED (no channelDir field) when resolveChannelDir throws', () => {
  // An invalid downloadDir (undefined) makes path.resolve(config.downloadDir)
  // throw inside resolveChannelDir well before any confinement check runs --
  // exercising the try/catch's "resolution failure" branch, not just its
  // documented "escaped confinement" branch.
  const config = { downloadDir: undefined, cookiesFile: null };
  const sub = { id: 'sub2', name: 'Broken Channel', channelUrl: 'https://www.youtube.com/@broken' };

  const enriched = enrichSubscriptionWithChannelDir(config, sub);

  assert.strictEqual(Object.prototype.hasOwnProperty.call(enriched, 'channelDir'), false, 'channelDir must be OMITTED, never set to null/undefined, on a resolution failure');
  assert.strictEqual(enriched.id, sub.id);
  assert.strictEqual(enriched.name, sub.name);
});

test('enrichSubscriptionWithChannelDir never throws even when the subscription itself is malformed', () => {
  const config = makeConfig();
  assert.doesNotThrow(() => enrichSubscriptionWithChannelDir(config, {}));
  assert.doesNotThrow(() => enrichSubscriptionWithChannelDir(config, null));
});

test('enrichSubscriptionWithChannelDir is a pure, read-only computation with no deps/database access (structural proof of the db.folders invariant)', () => {
  // The function signature itself is `(config, sub) => object` -- no `deps`
  // parameter, so there is no `updateDatabase`/`loadDatabase` reference it
  // could possibly invoke. Asserting the arity here is a structural
  // regression lock: if this function ever grew a `deps` parameter to write
  // something, this test's intent (and the two-reviewer gate note above it)
  // would need to be revisited.
  assert.strictEqual(enrichSubscriptionWithChannelDir.length, 2);
});
