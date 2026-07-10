'use strict';

// [UNIT] v1.25.x QoL bugfix: `lib/ytdlp/index.js`'s channel-avatar REGISTRY
// populate machinery -- `ensureChannelAvatar` (the populate-once dedup gate
// every avatar-populate call site now routes a probe through) and
// `collectDistinctChannelAvatarTargets` (the pure helper the refresh-avatars
// batch uses to compute its unit of work). Both are exercised directly
// against a tiny in-memory fake of the `updateDatabase`/`loadDatabase` deps
// (mirrors test/unit/ytdlp-store.test.js's own fake), with `run.probeChannelAvatar`
// monkey-patched -- no real yt-dlp binary/network, no HTTP boot needed.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const store = require('../../lib/ytdlp/store');

const originalProbeChannelAvatar = run.probeChannelAvatar;

afterEach(() => {
  run.probeChannelAvatar = originalProbeChannelAvatar;
});

function makeFakeDeps(initialDb = {}) {
  let db = initialDb;
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
  };
}

function mkChannelId(seed) {
  const hash = crypto.createHash('md5').update(String(seed)).digest('hex');
  return `UC${hash.slice(0, 22)}`;
}

function baseConfig(overrides = {}) {
  return { enabled: true, cookiesFile: null, pollMinutes: 0, downloadDir: '/tmp/irrelevant', version: null, ...overrides };
}

// ---- ensureChannelAvatar: populate-once dedup gate -------------------------

test('ensureChannelAvatar: probes and registers when no registry entry exists yet', async () => {
  const deps = makeFakeDeps();
  const config = baseConfig();
  const channelId = mkChannelId('probe-fresh');
  const channelUrl = 'https://www.youtube.com/channel/' + channelId;

  let probeCalls = 0;
  run.probeChannelAvatar = async (url) => {
    probeCalls += 1;
    return { avatarUrl: 'https://yt3.ggpht.com/fresh.jpg', channelId, channelUrl: url };
  };

  const result = await ytdlp.ensureChannelAvatar(deps, config, { channelId, channelUrl });
  assert.equal(probeCalls, 1, 'no existing entry -- must probe');
  assert.equal(result.avatarUrl, 'https://yt3.ggpht.com/fresh.jpg');

  assert.equal(store.getChannelAvatar(deps.loadDatabase(), channelId), 'https://yt3.ggpht.com/fresh.jpg', 'a successful probe must be registered into the canonical registry');
});

test('ensureChannelAvatar: does NOT re-probe when a fresh entry already exists (dedup)', async () => {
  const deps = makeFakeDeps();
  const config = baseConfig();
  const channelId = mkChannelId('already-fresh');
  const channelUrl = 'https://www.youtube.com/channel/' + channelId;

  await store.registerChannelAvatar(deps, { channelId, avatarUrl: 'https://yt3.ggpht.com/existing.jpg', channelUrl });

  let probeCalls = 0;
  run.probeChannelAvatar = async () => {
    probeCalls += 1;
    return { avatarUrl: 'https://yt3.ggpht.com/should-not-be-used.jpg', channelId, channelUrl };
  };

  const result = await ytdlp.ensureChannelAvatar(deps, config, { channelId, channelUrl });
  assert.equal(probeCalls, 0, 'a fresh registry entry must skip the probe entirely');
  assert.equal(result, null);
  assert.equal(store.getChannelAvatar(deps.loadDatabase(), channelId), 'https://yt3.ggpht.com/existing.jpg', 'the existing entry must be untouched');
});

test('ensureChannelAvatar: force:true bypasses the freshness gate and always probes', async () => {
  const deps = makeFakeDeps();
  const config = baseConfig();
  const channelId = mkChannelId('force-refresh');
  const channelUrl = 'https://www.youtube.com/channel/' + channelId;

  await store.registerChannelAvatar(deps, { channelId, avatarUrl: 'https://yt3.ggpht.com/old.jpg', channelUrl });

  let probeCalls = 0;
  run.probeChannelAvatar = async () => {
    probeCalls += 1;
    return { avatarUrl: 'https://yt3.ggpht.com/forced-fresh.jpg', channelId, channelUrl };
  };

  await ytdlp.ensureChannelAvatar(deps, config, { channelId, channelUrl }, { force: true });
  assert.equal(probeCalls, 1, 'force:true must always probe, even with a fresh existing entry');
  assert.equal(store.getChannelAvatar(deps.loadDatabase(), channelId), 'https://yt3.ggpht.com/forced-fresh.jpg');
});

test('ensureChannelAvatar: no channelId known up front -- still probes (this IS the discovery step) and registers under the PROBED channelId', async () => {
  const deps = makeFakeDeps();
  const config = baseConfig();
  const channelUrl = 'https://www.youtube.com/@discoverme';
  const discoveredId = mkChannelId('discovered');

  run.probeChannelAvatar = async (url) => ({ avatarUrl: 'https://yt3.ggpht.com/discovered.jpg', channelId: discoveredId, channelUrl: url });

  const result = await ytdlp.ensureChannelAvatar(deps, config, { channelUrl });
  assert.equal(result.channelId, discoveredId);
  assert.equal(store.getChannelAvatar(deps.loadDatabase(), discoveredId), 'https://yt3.ggpht.com/discovered.jpg');
});

test('ensureChannelAvatar: resolves null and never throws on a missing channelUrl', async () => {
  const deps = makeFakeDeps();
  const config = baseConfig();
  let probeCalls = 0;
  run.probeChannelAvatar = async () => { probeCalls += 1; return null; };
  assert.equal(await ytdlp.ensureChannelAvatar(deps, config, {}), null);
  assert.equal(await ytdlp.ensureChannelAvatar(deps, config, { channelUrl: '' }), null);
  assert.equal(probeCalls, 0, 'no usable channelUrl -- must never spawn a probe');
});

test('ensureChannelAvatar: a probe that resolves null (nothing usable found) is a silent no-op, never throws', async () => {
  const deps = makeFakeDeps();
  const config = baseConfig();
  const channelUrl = 'https://www.youtube.com/@nothingfound';
  run.probeChannelAvatar = async () => null;
  const result = await ytdlp.ensureChannelAvatar(deps, config, { channelUrl });
  assert.equal(result, null);
});

test('ensureChannelAvatar: a throwing probeChannelAvatar never breaks the caller -- defense-in-depth, resolves null', async () => {
  const deps = makeFakeDeps();
  const config = baseConfig();
  const channelUrl = 'https://www.youtube.com/@throws';
  run.probeChannelAvatar = async () => { throw new Error('boom: probeChannelAvatar is documented to never reject, but ensureChannelAvatar must survive it anyway'); };
  const result = await ytdlp.ensureChannelAvatar(deps, config, { channelUrl });
  assert.equal(result, null);
});

test('ensureChannelAvatar: a probe that finds an avatar but NO channelId (neither probed nor passed in) never registers into the registry', async () => {
  const deps = makeFakeDeps();
  const config = baseConfig();
  const channelUrl = 'https://www.youtube.com/@noidatall';
  run.probeChannelAvatar = async (url) => ({ avatarUrl: 'https://yt3.ggpht.com/no-id.jpg', channelId: null, channelUrl: url });
  const result = await ytdlp.ensureChannelAvatar(deps, config, { channelUrl });
  assert.equal(result.avatarUrl, 'https://yt3.ggpht.com/no-id.jpg');
  const db = deps.loadDatabase();
  assert.deepEqual(store.ensureYtdlp(db).channelAvatars, {}, 'no channelId to key the registry write by -- nothing must be registered');
});

// ---- collectDistinctChannelAvatarTargets: pure target collector -----------

test('collectDistinctChannelAvatarTargets: one target per subscription, preserving relative order', () => {
  const idA = mkChannelId('collect-a');
  const db = {
    ytdlp: {
      subscriptions: [
        { id: 'sub-a', channelUrl: 'https://www.youtube.com/@a', channelId: idA, order: 0 },
        { id: 'sub-b', channelUrl: 'https://www.youtube.com/@b', order: 1 },
      ],
    },
  };
  const targets = ytdlp.collectDistinctChannelAvatarTargets(db);
  assert.deepEqual(targets, [
    { channelId: idA, channelUrl: 'https://www.youtube.com/@a', subId: 'sub-a' },
    { channelId: null, channelUrl: 'https://www.youtube.com/@b', subId: 'sub-b' },
  ]);
});

test('collectDistinctChannelAvatarTargets: a subscription with no channelUrl at all is still included (as an unprobeable target)', () => {
  const db = { ytdlp: { subscriptions: [{ id: 'sub-empty', channelUrl: '', order: 0 }] } };
  const targets = ytdlp.collectDistinctChannelAvatarTargets(db);
  assert.deepEqual(targets, [{ channelId: null, channelUrl: null, subId: 'sub-empty' }]);
});

test('collectDistinctChannelAvatarTargets: adds a distinct channel from db.metadata with NO matching subscription', () => {
  const subId = mkChannelId('sub-channel');
  const itemId = mkChannelId('item-channel');
  const db = {
    ytdlp: { subscriptions: [{ id: 'sub-a', channelUrl: 'https://www.youtube.com/@a', channelId: subId, order: 0 }] },
    metadata: {
      item1: { id: 'item1', channelId: itemId, channelUrl: 'https://www.youtube.com/channel/' + itemId },
    },
  };
  const targets = ytdlp.collectDistinctChannelAvatarTargets(db);
  assert.equal(targets.length, 2);
  assert.deepEqual(targets[1], { channelId: itemId, channelUrl: 'https://www.youtube.com/channel/' + itemId, subId: null });
});

test('collectDistinctChannelAvatarTargets: a db.metadata item whose channelId is ALREADY covered by a subscription is deduplicated (not added twice)', () => {
  const sharedId = mkChannelId('shared');
  const db = {
    ytdlp: { subscriptions: [{ id: 'sub-a', channelUrl: 'https://www.youtube.com/@a', channelId: sharedId, order: 0 }] },
    metadata: {
      item1: { id: 'item1', channelId: sharedId, channelUrl: 'https://www.youtube.com/channel/' + sharedId },
    },
  };
  const targets = ytdlp.collectDistinctChannelAvatarTargets(db);
  assert.equal(targets.length, 1, 'the item shares the subscription\'s already-known channelId -- must not add a second target');
});

test('collectDistinctChannelAvatarTargets: an item with only a channelHandleUrl (no channelUrl/channelId) is still collected by that handle URL', () => {
  const db = {
    ytdlp: { subscriptions: [] },
    metadata: {
      item1: { id: 'item1', channelHandleUrl: 'https://www.youtube.com/@handleonly' },
    },
  };
  const targets = ytdlp.collectDistinctChannelAvatarTargets(db);
  assert.deepEqual(targets, [{ channelId: null, channelUrl: 'https://www.youtube.com/@handleonly', subId: null }]);
});

test('collectDistinctChannelAvatarTargets: an item with neither channelId nor any channelUrl is skipped entirely', () => {
  const db = { ytdlp: { subscriptions: [] }, metadata: { item1: { id: 'item1' } } };
  assert.deepEqual(ytdlp.collectDistinctChannelAvatarTargets(db), []);
});

test('collectDistinctChannelAvatarTargets: never mutates the subscriptions/metadata it reads, and is idempotent (same input -> same output)', () => {
  const db = {
    ytdlp: { subscriptions: [{ id: 'sub-a', channelUrl: 'https://www.youtube.com/@a', order: 0 }] },
    metadata: {},
  };
  // NOTE: `store.ensureYtdlp` (called internally) DOES perform its own
  // documented additive, non-destructive backfill of `db.ytdlp` (same as
  // every other read anywhere in this codebase) -- that is expected, not a
  // violation of purity here. What must NEVER change is the actual
  // subscription/metadata CONTENT this function reads from.
  const first = ytdlp.collectDistinctChannelAvatarTargets(db);
  const second = ytdlp.collectDistinctChannelAvatarTargets(db);
  assert.deepEqual(first, second, 'calling it twice against the same db must yield the identical target list');
  assert.equal(db.ytdlp.subscriptions.length, 1, 'must never add/remove a subscription record');
  assert.equal(db.ytdlp.subscriptions[0].channelUrl, 'https://www.youtube.com/@a', 'must never alter an existing subscription\'s own fields');
});

test('collectDistinctChannelAvatarTargets: no db.metadata at all (module just enabled, no scan yet) never throws, still returns subscription targets', () => {
  const db = { ytdlp: { subscriptions: [{ id: 'sub-a', channelUrl: 'https://www.youtube.com/@a', order: 0 }] } };
  const targets = ytdlp.collectDistinctChannelAvatarTargets(db);
  assert.equal(targets.length, 1);
});

test('collectDistinctChannelAvatarTargets: a null/non-object db is a silent no-op, never throws (contract, not just reachability)', () => {
  assert.deepEqual(ytdlp.collectDistinctChannelAvatarTargets(null), []);
  assert.deepEqual(ytdlp.collectDistinctChannelAvatarTargets(undefined), []);
  assert.deepEqual(ytdlp.collectDistinctChannelAvatarTargets('not-a-db'), []);
});

test('collectDistinctChannelAvatarTargets: a channelId-less item followed by an id-bearing item for the SAME channelUrl yields exactly ONE target, carrying the channelId (dedup reconcile)', () => {
  const sharedUrl = 'https://www.youtube.com/@shared-channel';
  const laterId = mkChannelId('reconcile-later');
  const db = {
    ytdlp: { subscriptions: [] },
    metadata: {
      // Insertion order matters: the id-LESS item is walked FIRST, claiming
      // `sharedUrl` with no channelId yet -- then a SECOND item for the SAME
      // real channel arrives with its channelId now known. Before the fix
      // both survived as separate targets (the same channel probed twice in
      // one refresh); the fix must collapse them into one.
      item1: { id: 'item1', channelUrl: sharedUrl },
      item2: { id: 'item2', channelId: laterId, channelUrl: sharedUrl },
    },
  };
  const targets = ytdlp.collectDistinctChannelAvatarTargets(db);
  assert.equal(targets.length, 1, 'the id-less item and its later id-bearing counterpart must collapse into a single target');
  assert.deepEqual(targets[0], { channelId: laterId, channelUrl: sharedUrl, subId: null });
});

test('collectDistinctChannelAvatarTargets: a channelId-less SUBSCRIPTION followed by an id-bearing item for the SAME channelUrl yields exactly ONE target, carrying the channelId', () => {
  const sharedUrl = 'https://www.youtube.com/@shared-legacy-sub';
  const discoveredId = mkChannelId('reconcile-sub-then-item');
  const db = {
    ytdlp: { subscriptions: [{ id: 'sub-legacy', channelUrl: sharedUrl, order: 0 }] },
    metadata: {
      item1: { id: 'item1', channelId: discoveredId, channelUrl: sharedUrl },
    },
  };
  const targets = ytdlp.collectDistinctChannelAvatarTargets(db);
  assert.equal(targets.length, 1, 'the legacy id-less subscription and the id-bearing item for the same channel must collapse into a single target');
  assert.deepEqual(targets[0], { channelId: discoveredId, channelUrl: sharedUrl, subId: 'sub-legacy' }, 'the upgraded target must preserve the original subscription\'s subId');
});
