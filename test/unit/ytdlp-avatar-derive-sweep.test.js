'use strict';

// [UNIT] v1.142 (Dean's one-off avatar gap): a channel with a KNOWN `UC…`
// channelId but no captured channelUrl was unprobeable at EVERY avatar
// populate point - Dean's on-device repro: a one-off download's item carries
// `channelId` but `channelAvatarUrl` stays blank forever. Three limbs close
// it: (1) `store.deriveChannelUrlFromId` derives the canonical channel URL
// from a bare id, wired into `ensureChannelAvatar` (THE shared choke point,
// so the refresh batch + subscribe path inherit it), the one-off fold, and
// the batch's skip decision; (2) the one-off fold's over-broad
// `folderIsExplicit` skip is gone (the FTCHMETA capture exists regardless of
// folder choice); (3) `sweepItemChannelAvatars` - the automatic poll-tail
// self-heal for ITEM-only channels, spending the cycle's leftover
// avatarBudget, with an in-process attempted-memo so a permanently
// unprobeable channel is tried once per server run, never every poll.
//
// Harness mirrors test/unit/ytdlp-channel-avatar-registry.test.js: in-memory
// fake deps + `run.probeChannelAvatar` monkey-patched; no yt-dlp binary, no
// network. The one-off fold and runPoll wiring are source-locked on
// comment-STRIPPED source (the v1.140 comment-porous-lock lesson).

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

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

// ---- deriveChannelUrlFromId (pure) -----------------------------------------

test('deriveChannelUrlFromId: a valid UC… id derives the canonical channel URL', () => {
  const id = mkChannelId('derive-ok');
  assert.strictEqual(store.deriveChannelUrlFromId(id), `https://www.youtube.com/channel/${id}`);
});

test('deriveChannelUrlFromId: anything not matching CHANNEL_ID_PATTERN derives nothing', () => {
  assert.strictEqual(store.deriveChannelUrlFromId('@somehandle'), null, 'a handle is not an id');
  assert.strictEqual(store.deriveChannelUrlFromId('UCshort'), null, 'wrong length');
  assert.strictEqual(store.deriveChannelUrlFromId(`XX${'a'.repeat(22)}`), null, 'wrong prefix');
  assert.strictEqual(store.deriveChannelUrlFromId(`UC${'a'.repeat(21)}$`), null, 'invalid charset never builds a URL');
  assert.strictEqual(store.deriveChannelUrlFromId(''), null);
  assert.strictEqual(store.deriveChannelUrlFromId(null), null);
  assert.strictEqual(store.deriveChannelUrlFromId(undefined), null);
  assert.strictEqual(store.deriveChannelUrlFromId(42), null, 'non-string');
});

// ---- sanitizeCapturedChannelMeta: a bare id IS identity --------------------

test('sanitizeCapturedChannelMeta: a capture with a valid channelId but NO usable URL keeps its identity via the derived canonical URL', () => {
  const channelId = mkChannelId('sanitize-bare-id');
  const sanitized = store.sanitizeCapturedChannelMeta({
    videoId: 'dQw4w9WgXcQ', channelId, channelUrl: null, uploaderUrl: null, channelName: 'Bare Id Channel',
  });
  assert.ok(sanitized, 'pre-v1.142 this whole capture was dropped as "no identity" - id and all');
  assert.equal(sanitized.channelUrl, `https://www.youtube.com/channel/${channelId}`);
  assert.equal(sanitized.channelId, channelId);
});

test('sanitizeCapturedChannelMeta: no URL and no valid id still drops the capture entirely (the boundary holds)', () => {
  assert.strictEqual(store.sanitizeCapturedChannelMeta({
    videoId: 'dQw4w9WgXcQ', channelId: '@handle-not-id', channelUrl: null, uploaderUrl: null,
  }), null);
});

// ---- ensureChannelAvatar: bare-id derivation (the shared choke point) ------

test('ensureChannelAvatar: a bare channelId (no channelUrl) probes the DERIVED canonical URL and registers', async () => {
  const deps = makeFakeDeps({});
  const config = baseConfig();
  const channelId = mkChannelId('bare-id-probe');

  const probedUrls = [];
  run.probeChannelAvatar = async (url) => {
    probedUrls.push(url);
    return { avatarUrl: 'https://yt3.ggpht.com/derived.jpg', channelId, channelUrl: url };
  };

  const result = await ytdlp.ensureChannelAvatar(deps, config, { channelId });
  assert.deepStrictEqual(probedUrls, [`https://www.youtube.com/channel/${channelId}`],
    'the probe hits the id-derived canonical URL - before v1.142 this bailed with NO probe at all');
  assert.equal(result.avatarUrl, 'https://yt3.ggpht.com/derived.jpg');
  const db = deps.loadDatabase();
  assert.equal(store.getChannelAvatar(db, channelId), 'https://yt3.ggpht.com/derived.jpg',
    'the derived-URL probe registers into the canonical registry like any other');
});

test('ensureChannelAvatar: neither a channelUrl nor a derivable id stays a no-probe null', async () => {
  const deps = makeFakeDeps({});
  let probeCalls = 0;
  run.probeChannelAvatar = async () => { probeCalls += 1; return null; };
  assert.strictEqual(await ytdlp.ensureChannelAvatar(deps, baseConfig(), { channelId: '@not-an-id' }), null);
  assert.strictEqual(await ytdlp.ensureChannelAvatar(deps, baseConfig(), {}), null);
  assert.equal(probeCalls, 0, 'truly unprobeable targets never spawn');
});

// ---- sweepItemChannelAvatars (the automatic poll-tail self-heal) -----------

test('sweep: an ITEM-only bare-id channel is probed via its derived URL and lands in the registry', async () => {
  const channelId = mkChannelId('sweep-item-bare');
  const deps = makeFakeDeps({ metadata: { item1: { channelId } } });
  const probedUrls = [];
  run.probeChannelAvatar = async (url) => {
    probedUrls.push(url);
    return { avatarUrl: 'https://yt3.ggpht.com/swept.jpg', channelId, channelUrl: url };
  };

  const budget = { remaining: 3 };
  await ytdlp.sweepItemChannelAvatars(deps, baseConfig(), budget);

  assert.deepStrictEqual(probedUrls, [`https://www.youtube.com/channel/${channelId}`]);
  assert.equal(budget.remaining, 2, 'the sweep spends the SHARED avatarBudget, one attempt per channel');
  assert.equal(store.getChannelAvatar(deps.loadDatabase(), channelId), 'https://yt3.ggpht.com/swept.jpg');
});

test('sweep: an exhausted budget probes nothing (the AVATAR_SELFHEAL_PER_POLL contract holds)', async () => {
  const channelId = mkChannelId('sweep-no-budget');
  const deps = makeFakeDeps({ metadata: { item1: { channelId } } });
  let probeCalls = 0;
  run.probeChannelAvatar = async () => { probeCalls += 1; return null; };
  await ytdlp.sweepItemChannelAvatars(deps, baseConfig(), { remaining: 0 });
  assert.equal(probeCalls, 0);
});

test('sweep: a subscription-covered channel is NOT the sweep\'s job (the poll self-heal owns it)', async () => {
  const channelId = mkChannelId('sweep-sub-covered');
  const channelUrl = `https://www.youtube.com/channel/${channelId}`;
  const deps = makeFakeDeps({
    ytdlp: { subscriptions: [{ id: 'sub1', channelUrl, channelId, name: 'Covered' }] },
    metadata: { item1: { channelId, channelUrl } },
  });
  let probeCalls = 0;
  run.probeChannelAvatar = async () => { probeCalls += 1; return null; };
  await ytdlp.sweepItemChannelAvatars(deps, baseConfig(), { remaining: 5 });
  assert.equal(probeCalls, 0, 'targets with a subId are filtered out - never double-handled');
});

test('sweep: a channel with a FRESH registry entry costs zero probes', async () => {
  const channelId = mkChannelId('sweep-fresh');
  const deps = makeFakeDeps({
    metadata: { item1: { channelId } },
    ytdlp: { channelAvatars: { [channelId]: { avatarUrl: 'https://yt3.ggpht.com/have.jpg', fetchedAt: Date.now() } } },
  });
  let probeCalls = 0;
  run.probeChannelAvatar = async () => { probeCalls += 1; return null; };
  await ytdlp.sweepItemChannelAvatars(deps, baseConfig(), { remaining: 5 });
  assert.equal(probeCalls, 0);
});

test('sweep: a FAILED probe is memoized - never re-attempted on later cycles this server run', async () => {
  const channelId = mkChannelId('sweep-memo-miss');
  const deps = makeFakeDeps({ metadata: { item1: { channelId } } });
  let probeCalls = 0;
  run.probeChannelAvatar = async () => { probeCalls += 1; return null; };

  await ytdlp.sweepItemChannelAvatars(deps, baseConfig(), { remaining: 5 });
  await ytdlp.sweepItemChannelAvatars(deps, baseConfig(), { remaining: 5 });

  assert.equal(probeCalls, 1,
    'one attempt per channel per process lifetime - a permanently unprobeable channel must not be hammered every poll');
});

// ---- source locks (comment-stripped - the v1.140 lesson) -------------------

const INDEX_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'index.js'), 'utf8')
  .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');

test('the one-off fold no longer gates on folderIsExplicit and probes the derived-or-captured URL', () => {
  assert.ok(!/folderIsExplicit\s*&&\s*Array\.isArray\(downloadResult\.channelMeta\)/.test(INDEX_SRC),
    'the over-broad explicit-folder skip is GONE - the FTCHMETA capture exists regardless of folder choice');
  assert.match(INDEX_SRC, /const avatarProbeUrl = sanitizedForAvatar\s*\?\s*\(sanitizedForAvatar\.channelUrl \|\| store\.deriveChannelUrlFromId\(sanitizedForAvatar\.channelId\)\)\s*:\s*null;/,
    'the fold derives a probeable URL from a bare captured channelId');
  assert.match(INDEX_SRC, /run\.probeChannelAvatar\(avatarProbeUrl, config\)/,
    'and the probe actually consumes it (the enabling wire, not just the derivation)');
});

test('runPoll wires the item sweep at the cycle tail, breaker-gated, on the SHARED budget', () => {
  assert.match(INDEX_SRC, /if \(!breakerTripped\) \{\s*await sweepItemChannelAvatars\(deps, config, avatarBudget\);\s*\}/,
    'the sweep runs each poll cycle on leftover budget - and NEVER after the breaker tripped (a throttled session must not be hammered with probes)');
});

test('ensureChannelAvatar consumes the derived URL (the enabling wire of the whole wave)', () => {
  assert.match(INDEX_SRC, /const probeUrl = \(typeof channelUrl === 'string' && channelUrl !== ''\)\s*\?\s*channelUrl\s*:\s*store\.deriveChannelUrlFromId\(channelId\);/,
    'the shared choke point derives');
  assert.match(INDEX_SRC, /run\.probeChannelAvatar\(probeUrl, config\)/, 'and probes what it derived');
});
