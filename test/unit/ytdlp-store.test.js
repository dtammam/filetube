'use strict';

// [UNIT] Pure-logic + persistence-accessor coverage for lib/ytdlp/store.js.
// No DATA_DIR isolation / server import needed -- this file exercises the
// store functions against a tiny in-memory fake of the `updateDatabase`/
// `loadDatabase`/`getMediaId` deps, mirroring the real serialized-writer
// contract (mutator is synchronous, `false` skips the save) without ever
// touching a real db.json. Covers AC 10-13, 33.

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const store = require('../../lib/ytdlp/store');

// A minimal fake of server.js's updateDatabase/loadDatabase pair: one
// in-memory `db` object, mutated synchronously, "saved" by simply keeping
// the reference (no real fs involved). Good enough to prove the store's
// backfill + CRUD logic without a real server/db.json.
function makeFakeDeps(initialDb = {}) {
  let db = initialDb;
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => {
      const result = mutatorFn(db);
      // Mirrors the real primitive: a `false` return skips the "save" (here,
      // a no-op since we already mutated in place) but the contract is the
      // same shape either way -- return a resolved promise.
      return Promise.resolve(result);
    },
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
  };
}

// ---- Backfill: no data loss, existing keys intact (AC 10) ----

test('ensureYtdlp: an old db with no ytdlp key gains the default namespace, no data loss', () => {
  const db = { folders: ['/movies'], settings: { scanIntervalMinutes: 15 } };
  const ns = store.ensureYtdlp(db);
  assert.deepEqual(ns, { allowMembersOnly: false, subscriptions: [] });
  // Existing keys untouched.
  assert.deepEqual(db.folders, ['/movies']);
  assert.deepEqual(db.settings, { scanIntervalMinutes: 15 });
  assert.deepEqual(db.ytdlp, { allowMembersOnly: false, subscriptions: [] });
});

test('ensureYtdlp: a partial ytdlp namespace is completed without clobbering present fields', () => {
  const existingSub = { id: 'abc', channelUrl: 'https://example.com/@x', name: 'x', format: 'video', quality: 'best', addedAt: '2020-01-01T00:00:00.000Z', lastCheckedAt: null, lastStatus: null };
  const db = { ytdlp: { subscriptions: [existingSub] } }; // allowMembersOnly missing
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.allowMembersOnly, false);
  assert.deepEqual(ns.subscriptions, [existingSub]);
});

test('ensureYtdlp: does not throw and never mutates unrelated keys when db is otherwise empty', () => {
  const db = {};
  assert.doesNotThrow(() => store.ensureYtdlp(db));
  assert.deepEqual(Object.keys(db), ['ytdlp']);
});

// ---- Subscription shape / validation (AC 12, 33) ----

test('validateSubscriptionInput: rejects an empty/missing channelUrl', () => {
  assert.equal(store.validateSubscriptionInput({}).ok, false);
  assert.equal(store.validateSubscriptionInput({ channelUrl: '' }).ok, false);
  assert.equal(store.validateSubscriptionInput({ channelUrl: '   ' }).ok, false);
});

test('validateSubscriptionInput: rejects a non-http(s) scheme', () => {
  assert.equal(store.validateSubscriptionInput({ channelUrl: 'ftp://example.com' }).ok, false);
  assert.equal(store.validateSubscriptionInput({ channelUrl: 'javascript:alert(1)' }).ok, false);
  assert.equal(store.validateSubscriptionInput({ channelUrl: 'not a url' }).ok, false);
});

test('validateSubscriptionInput: rejects an invalid format', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', format: 'gif' });
  assert.equal(result.ok, false);
});

test('validateSubscriptionInput: rejects a non-YouTube host even with a plausible path shape', () => {
  // T3 upgrade: the URL check is no longer a bare http(s)-scheme check --
  // it now runs the full lib/ytdlp/url.js allowlist via validateChannelUrl.
  const result = store.validateSubscriptionInput({ channelUrl: 'https://example.com/@x' });
  assert.equal(result.ok, false);
});

test('validateSubscriptionInput: accepts a valid https URL and defaults format to video, quality to best', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@channel' });
  assert.equal(result.ok, true);
  assert.equal(result.value.format, 'video');
  assert.equal(result.value.quality, 'best');
});

test('validateSubscriptionInput: quality defaults to best when omitted, passes through when supplied', () => {
  const withoutQuality = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', format: 'audio' });
  assert.equal(withoutQuality.value.quality, 'best');
  const withQuality = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', format: 'audio', quality: '720p' });
  assert.equal(withQuality.value.quality, '720p');
});

test('validateSubscriptionInput: normalizes the persisted channelUrl (lowercased host)', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://WWW.YOUTUBE.COM/@Mixed' });
  assert.equal(result.ok, true);
  assert.equal(result.value.channelUrl, 'https://www.youtube.com/@Mixed');
});

// ---- deriveDisplayName (pure) ----

test('deriveDisplayName: prefers an @handle path segment', () => {
  assert.equal(store.deriveDisplayName('https://www.youtube.com/@somechannel'), '@somechannel');
});

test('deriveDisplayName: falls back to the last path segment when no @handle is present', () => {
  assert.equal(store.deriveDisplayName('https://www.youtube.com/channel/UC12345'), 'UC12345');
});

test('deriveDisplayName: falls back to the hostname when there is no path', () => {
  assert.equal(store.deriveDisplayName('https://www.youtube.com'), 'www.youtube.com');
});

test('deriveDisplayName: never throws on a malformed input', () => {
  assert.equal(store.deriveDisplayName(''), 'Untitled channel');
  assert.equal(store.deriveDisplayName(undefined), 'Untitled channel');
  assert.equal(store.deriveDisplayName('not a url'), 'not a url');
});

// ---- addSubscription: id stability / idempotency (AC 11) ----

test('addSubscription: same channelUrl always yields the same id (idempotent, no duplicate)', async () => {
  const deps = makeFakeDeps();
  const first = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@channel', format: 'video', quality: 'best' });
  const second = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@channel', format: 'audio', quality: '720p' });
  assert.equal(second.id, first.id);
  const list = store.listSubscriptions(deps);
  assert.equal(list.length, 1, 'a re-add of the same channel must not create a duplicate');
  // The original record's format/quality are preserved (no-op re-add).
  assert.equal(list[0].format, 'video');
});

test('addSubscription: creates a well-formed record with quality defaulting to best', async () => {
  const deps = makeFakeDeps();
  const record = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@another', format: 'video' });
  assert.equal(record.format, 'video');
  assert.equal(record.quality, 'best');
  assert.equal(record.lastCheckedAt, null);
  assert.equal(record.lastStatus, null);
  assert.equal(typeof record.addedAt, 'string');
  assert.equal(typeof record.id, 'string');
  assert.equal(record.channelUrl, 'https://www.youtube.com/@another');
});

// ---- deleteSubscription: found vs unknown (AC 33) ----

test('deleteSubscription: removes an existing subscription and returns true', async () => {
  const deps = makeFakeDeps();
  const record = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@gone', format: 'video' });
  const removed = await store.deleteSubscription(deps, record.id);
  assert.equal(removed, true);
  assert.deepEqual(store.listSubscriptions(deps), []);
});

test('deleteSubscription: returns false for an unknown id and leaves the list untouched', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@stays', format: 'video' });
  const removed = await store.deleteSubscription(deps, 'no-such-id');
  assert.equal(removed, false);
  assert.equal(store.listSubscriptions(deps).length, 1);
});

// ---- getAllowMembersOnly / setAllowMembersOnly (AC 23) ----

test('getAllowMembersOnly defaults to false and setAllowMembersOnly persists a boolean', async () => {
  const deps = makeFakeDeps();
  assert.equal(store.getAllowMembersOnly(deps), false);
  await store.setAllowMembersOnly(deps, true);
  assert.equal(store.getAllowMembersOnly(deps), true);
  await store.setAllowMembersOnly(deps, false);
  assert.equal(store.getAllowMembersOnly(deps), false);
});

// ---- setSubscriptionStatus (used by T4, exercised lightly here) ----

test('setSubscriptionStatus updates lastCheckedAt/lastStatus for a known id, false for unknown', async () => {
  const deps = makeFakeDeps();
  const record = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@status', format: 'video' });
  const updated = await store.setSubscriptionStatus(deps, record.id, { lastCheckedAt: '2026-07-05T00:00:00.000Z', lastStatus: 'ok' });
  assert.equal(updated, true);
  const [sub] = store.listSubscriptions(deps);
  assert.equal(sub.lastStatus, 'ok');
  const missing = await store.setSubscriptionStatus(deps, 'nope', { lastStatus: 'ok' });
  assert.equal(missing, false);
});

// ---- FR-C/FR-D: validateMaxVideos / validatePaused (AC20) ----

test('validateMaxVideos: accepts undefined (unset -> global default at build time)', () => {
  assert.deepEqual(store.validateMaxVideos(undefined), { ok: true, value: undefined });
});

test('validateMaxVideos: accepts 0 (a distinct, valid "unlimited" value)', () => {
  assert.deepEqual(store.validateMaxVideos(0), { ok: true, value: 0 });
});

test('validateMaxVideos: accepts an in-range positive integer', () => {
  assert.deepEqual(store.validateMaxVideos(10), { ok: true, value: 10 });
  assert.deepEqual(store.validateMaxVideos(store.MAX_SUB_MAX_VIDEOS), { ok: true, value: store.MAX_SUB_MAX_VIDEOS });
});

test('validateMaxVideos: rejects a non-integer (never silently coerced/truncated)', () => {
  assert.equal(store.validateMaxVideos(1.5).ok, false);
  assert.equal(store.validateMaxVideos('10').ok, false);
  assert.equal(store.validateMaxVideos(NaN).ok, false);
});

test('validateMaxVideos: rejects a negative value', () => {
  assert.equal(store.validateMaxVideos(-1).ok, false);
});

test('validateMaxVideos: rejects a value over MAX_SUB_MAX_VIDEOS', () => {
  assert.equal(store.validateMaxVideos(store.MAX_SUB_MAX_VIDEOS + 1).ok, false);
});

test('validatePaused: accepts undefined and strict booleans, rejects anything else', () => {
  assert.deepEqual(store.validatePaused(undefined), { ok: true, value: undefined });
  assert.deepEqual(store.validatePaused(true), { ok: true, value: true });
  assert.deepEqual(store.validatePaused(false), { ok: true, value: false });
  assert.equal(store.validatePaused('true').ok, false);
  assert.equal(store.validatePaused(1).ok, false);
  assert.equal(store.validatePaused(null).ok, false);
});

test('validateSubscriptionInput: rejects an out-of-range/non-integer maxVideos', () => {
  assert.equal(store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', maxVideos: -1 }).ok, false);
  assert.equal(store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', maxVideos: 1.5 }).ok, false);
  assert.equal(store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', maxVideos: store.MAX_SUB_MAX_VIDEOS + 1 }).ok, false);
});

test('validateSubscriptionInput: rejects a non-boolean paused', () => {
  assert.equal(store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', paused: 'yes' }).ok, false);
});

test('validateSubscriptionInput: accepts unset maxVideos/paused (stays undefined)', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x' });
  assert.equal(result.ok, true);
  assert.equal(result.value.maxVideos, undefined);
  assert.equal(result.value.paused, undefined);
});

test('validateSubscriptionInput: accepts a valid maxVideos/paused and passes them through', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', maxVideos: 5, paused: true });
  assert.equal(result.ok, true);
  assert.equal(result.value.maxVideos, 5);
  assert.equal(result.value.paused, true);
});

// ---- validateSubscriptionPatch (PATCH /api/subscriptions/:id body) ----

test('validateSubscriptionPatch: accepts an empty patch (no-op)', () => {
  assert.deepEqual(store.validateSubscriptionPatch({}), { ok: true, value: {} });
});

test('validateSubscriptionPatch: accepts a subset of fields, only including provided keys', () => {
  const result = store.validateSubscriptionPatch({ paused: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { paused: true });
});

test('validateSubscriptionPatch: rejects an invalid format/maxVideos/paused', () => {
  assert.equal(store.validateSubscriptionPatch({ format: 'gif' }).ok, false);
  assert.equal(store.validateSubscriptionPatch({ maxVideos: -5 }).ok, false);
  assert.equal(store.validateSubscriptionPatch({ paused: 'nope' }).ok, false);
});

// ---- FR-D: updateSubscription (AC21, AC24) ----

test('updateSubscription: patches only the provided fields, preserving addedAt/lastCheckedAt/lastStatus/id/channelUrl/name', async () => {
  const deps = makeFakeDeps();
  const added = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@edit', format: 'video', quality: 'best', name: 'Edit Me' });
  await store.setSubscriptionStatus(deps, added.id, { lastCheckedAt: '2026-07-05T00:00:00.000Z', lastStatus: 'ok: 3 downloaded' });

  const updated = await store.updateSubscription(deps, added.id, { format: 'audio', maxVideos: 7 });

  assert.equal(updated.format, 'audio');
  assert.equal(updated.maxVideos, 7);
  // Untouched fields preserved exactly.
  assert.equal(updated.id, added.id);
  assert.equal(updated.channelUrl, added.channelUrl);
  assert.equal(updated.name, 'Edit Me');
  assert.equal(updated.addedAt, added.addedAt);
  assert.equal(updated.lastCheckedAt, '2026-07-05T00:00:00.000Z');
  assert.equal(updated.lastStatus, 'ok: 3 downloaded');
  // quality/paused untouched since they were not in the patch.
  assert.equal(updated.quality, 'best');
});

test('updateSubscription: can toggle paused independent of other fields', async () => {
  const deps = makeFakeDeps();
  const added = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@pause', format: 'video' });
  assert.equal(added.paused, false);
  const paused = await store.updateSubscription(deps, added.id, { paused: true });
  assert.equal(paused.paused, true);
  assert.equal(paused.format, 'video');
  const resumed = await store.updateSubscription(deps, added.id, { paused: false });
  assert.equal(resumed.paused, false);
});

test('updateSubscription: returns null for an unknown id and does not create a new record', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@stays', format: 'video' });
  const result = await store.updateSubscription(deps, 'no-such-id', { paused: true });
  assert.equal(result, null);
  assert.equal(store.listSubscriptions(deps).length, 1);
});

test('updateSubscription: an invalid value within the patch is defensively ignored rather than corrupting the record', async () => {
  const deps = makeFakeDeps();
  const added = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@guard', format: 'video', quality: 'best', maxVideos: 3 });
  // A hostile/garbage maxVideos slipping past an upstream validator must not
  // be written -- the field stays at its previous value.
  const result = await store.updateSubscription(deps, added.id, { maxVideos: -99, format: 'gif' });
  assert.equal(result.maxVideos, 3, 'an invalid maxVideos in the patch must not overwrite the existing value');
  assert.equal(result.format, 'video', 'an invalid format in the patch must not overwrite the existing value');
});

// ---- ensureYtdlp: per-subscription `paused` backfill (FR-D) ----

test('ensureYtdlp: backfills paused=false on a legacy subscription lacking the field', () => {
  const legacySub = { id: 'legacy1', channelUrl: 'https://www.youtube.com/@legacy', name: 'Legacy', format: 'video', quality: 'best', addedAt: '2020-01-01T00:00:00.000Z', lastCheckedAt: null, lastStatus: null };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [legacySub] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.subscriptions[0].paused, false);
  // maxVideos stays unset (undefined), not backfilled to any number.
  assert.equal(ns.subscriptions[0].maxVideos, undefined);
});

test('ensureYtdlp: leaves an already-boolean paused field untouched', () => {
  const modernSub = { id: 'modern1', channelUrl: 'https://www.youtube.com/@modern', name: 'Modern', format: 'video', quality: 'best', addedAt: '2026-01-01T00:00:00.000Z', lastCheckedAt: null, lastStatus: null, paused: true };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [modernSub] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.subscriptions[0].paused, true);
});

test('ensureYtdlp: backfill mutates each sub object independently, never sharing state across unrelated db instances', () => {
  const subA = { id: 'a', channelUrl: 'https://www.youtube.com/@a', name: 'A' };
  const subB = { id: 'b', channelUrl: 'https://www.youtube.com/@b', name: 'B' };
  const dbA = { ytdlp: { allowMembersOnly: false, subscriptions: [subA] } };
  const dbB = { ytdlp: { allowMembersOnly: false, subscriptions: [subB] } };
  store.ensureYtdlp(dbA);
  store.ensureYtdlp(dbB);
  assert.equal(dbA.ytdlp.subscriptions[0].paused, false);
  assert.equal(dbB.ytdlp.subscriptions[0].paused, false);
  // Mutating one sub's paused flag must never affect the other db's sub.
  dbA.ytdlp.subscriptions[0].paused = true;
  assert.equal(dbB.ytdlp.subscriptions[0].paused, false, 'backfill must not share sub objects/arrays across db instances');
});
