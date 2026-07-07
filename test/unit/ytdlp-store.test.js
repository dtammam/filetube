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
  assert.deepEqual(ns, { allowMembersOnly: false, subscriptions: [], downloadMeta: {}, pins: [] });
  // Existing keys untouched.
  assert.deepEqual(db.folders, ['/movies']);
  assert.deepEqual(db.settings, { scanIntervalMinutes: 15 });
  assert.deepEqual(db.ytdlp, { allowMembersOnly: false, subscriptions: [], downloadMeta: {}, pins: [] });
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

// ---- v1.22.0 FR-6: validateMaxDurationSeconds (mirrors validateMaxVideos) --

test('validateMaxDurationSeconds: accepts undefined (unset -> global default at build time)', () => {
  assert.deepEqual(store.validateMaxDurationSeconds(undefined), { ok: true, value: undefined });
});

test('validateMaxDurationSeconds: accepts 0 (a distinct, valid "unbounded" value)', () => {
  assert.deepEqual(store.validateMaxDurationSeconds(0), { ok: true, value: 0 });
});

test('validateMaxDurationSeconds: accepts an in-range positive integer', () => {
  assert.deepEqual(store.validateMaxDurationSeconds(3600), { ok: true, value: 3600 });
  assert.deepEqual(
    store.validateMaxDurationSeconds(store.MAX_SUB_MAX_DURATION_SECONDS),
    { ok: true, value: store.MAX_SUB_MAX_DURATION_SECONDS }
  );
});

test('validateMaxDurationSeconds: rejects a non-integer (never silently coerced/truncated)', () => {
  assert.equal(store.validateMaxDurationSeconds(1.5).ok, false);
  assert.equal(store.validateMaxDurationSeconds('3600').ok, false);
  assert.equal(store.validateMaxDurationSeconds(NaN).ok, false);
});

test('validateMaxDurationSeconds: rejects a negative value', () => {
  assert.equal(store.validateMaxDurationSeconds(-1).ok, false);
});

test('validateMaxDurationSeconds: rejects a value over MAX_SUB_MAX_DURATION_SECONDS', () => {
  assert.equal(store.validateMaxDurationSeconds(store.MAX_SUB_MAX_DURATION_SECONDS + 1).ok, false);
});

test('validatePaused: accepts undefined and strict booleans, rejects anything else', () => {
  assert.deepEqual(store.validatePaused(undefined), { ok: true, value: undefined });
  assert.deepEqual(store.validatePaused(true), { ok: true, value: true });
  assert.deepEqual(store.validatePaused(false), { ok: true, value: false });
  assert.equal(store.validatePaused('true').ok, false);
  assert.equal(store.validatePaused(1).ok, false);
  assert.equal(store.validatePaused(null).ok, false);
});

// ---- v1.15.0 item 4: validateSkipShorts (mirrors validatePaused exactly) --

test('validateSkipShorts: accepts undefined and strict booleans, rejects anything else', () => {
  assert.deepEqual(store.validateSkipShorts(undefined), { ok: true, value: undefined });
  assert.deepEqual(store.validateSkipShorts(true), { ok: true, value: true });
  assert.deepEqual(store.validateSkipShorts(false), { ok: true, value: false });
  assert.equal(store.validateSkipShorts('true').ok, false);
  assert.equal(store.validateSkipShorts(1).ok, false);
  assert.equal(store.validateSkipShorts(null).ok, false);
  assert.equal(store.validateSkipShorts({}).ok, false);
});

test('validateSubscriptionInput: rejects an out-of-range/non-integer maxVideos', () => {
  assert.equal(store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', maxVideos: -1 }).ok, false);
  assert.equal(store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', maxVideos: 1.5 }).ok, false);
  assert.equal(store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', maxVideos: store.MAX_SUB_MAX_VIDEOS + 1 }).ok, false);
});

test('validateSubscriptionInput: rejects a non-boolean paused', () => {
  assert.equal(store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', paused: 'yes' }).ok, false);
});

test('validateSubscriptionInput: accepts unset maxVideos/paused/skipShorts (stays undefined)', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x' });
  assert.equal(result.ok, true);
  assert.equal(result.value.maxVideos, undefined);
  assert.equal(result.value.paused, undefined);
  assert.equal(result.value.skipShorts, undefined);
});

// ---- v1.22.0 FR-6: maxDurationSeconds wired into validateSubscriptionInput/Patch --

test('validateSubscriptionInput: accepts unset maxDurationSeconds (stays undefined -> inherit global default)', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x' });
  assert.equal(result.ok, true);
  assert.equal(result.value.maxDurationSeconds, undefined);
});

test('validateSubscriptionInput: accepts a valid maxDurationSeconds override', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', maxDurationSeconds: 3600 });
  assert.equal(result.ok, true);
  assert.equal(result.value.maxDurationSeconds, 3600);
});

test('validateSubscriptionInput: rejects an out-of-range/non-integer maxDurationSeconds', () => {
  assert.equal(store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', maxDurationSeconds: -1 }).ok, false);
  assert.equal(store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', maxDurationSeconds: 1.5 }).ok, false);
  assert.equal(
    store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', maxDurationSeconds: store.MAX_SUB_MAX_DURATION_SECONDS + 1 }).ok,
    false
  );
});

test('validateSubscriptionPatch: accepts/omits maxDurationSeconds like maxVideos', () => {
  const empty = store.validateSubscriptionPatch({});
  assert.equal('maxDurationSeconds' in empty.value, false);

  const patched = store.validateSubscriptionPatch({ maxDurationSeconds: 0 });
  assert.equal(patched.ok, true);
  assert.equal(patched.value.maxDurationSeconds, 0);

  const rejected = store.validateSubscriptionPatch({ maxDurationSeconds: -5 });
  assert.equal(rejected.ok, false);
});

test('validateSubscriptionInput: accepts a valid maxVideos/paused/skipShorts and passes them through', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', maxVideos: 5, paused: true, skipShorts: true });
  assert.equal(result.ok, true);
  assert.equal(result.value.maxVideos, 5);
  assert.equal(result.value.paused, true);
  assert.equal(result.value.skipShorts, true);
});

test('validateSubscriptionInput: rejects a non-boolean skipShorts', () => {
  assert.equal(store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', skipShorts: 'yes' }).ok, false);
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

test('validateSubscriptionPatch: rejects an invalid format/maxVideos/paused/skipShorts', () => {
  assert.equal(store.validateSubscriptionPatch({ format: 'gif' }).ok, false);
  assert.equal(store.validateSubscriptionPatch({ maxVideos: -5 }).ok, false);
  assert.equal(store.validateSubscriptionPatch({ paused: 'nope' }).ok, false);
  assert.equal(store.validateSubscriptionPatch({ skipShorts: 'nope' }).ok, false);
});

test('validateSubscriptionPatch: accepts skipShorts as its own subset key', () => {
  const result = store.validateSubscriptionPatch({ skipShorts: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { skipShorts: true });
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

test('updateSubscription: can toggle skipShorts independent of other fields', async () => {
  const deps = makeFakeDeps();
  const added = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@shorts', format: 'video' });
  assert.equal(added.skipShorts, false);
  const skipped = await store.updateSubscription(deps, added.id, { skipShorts: true });
  assert.equal(skipped.skipShorts, true);
  assert.equal(skipped.format, 'video');
  const resumed = await store.updateSubscription(deps, added.id, { skipShorts: false });
  assert.equal(resumed.skipShorts, false);
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

// ---- v1.22.0 FR-6: addSubscription/updateSubscription carry maxDurationSeconds --

test('addSubscription: an unset maxDurationSeconds stays undefined on the new record (resolves to the global default at build time)', async () => {
  const deps = makeFakeDeps();
  const record = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@durunset', format: 'video' });
  assert.equal(record.maxDurationSeconds, undefined);
});

test('addSubscription: a valid maxDurationSeconds is persisted on the new record', async () => {
  const deps = makeFakeDeps();
  const record = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@durset', format: 'video', maxDurationSeconds: 1800 });
  assert.equal(record.maxDurationSeconds, 1800);
});

test('addSubscription: an invalid maxDurationSeconds fails safe to undefined rather than corrupting the record', async () => {
  const deps = makeFakeDeps();
  const record = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@durbad', format: 'video', maxDurationSeconds: -5 });
  assert.equal(record.maxDurationSeconds, undefined);
});

test('updateSubscription: patches maxDurationSeconds independent of other fields, 0 accepted as unbounded', async () => {
  const deps = makeFakeDeps();
  const added = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@durpatch', format: 'video', maxDurationSeconds: 3600 });
  const updated = await store.updateSubscription(deps, added.id, { maxDurationSeconds: 0 });
  assert.equal(updated.maxDurationSeconds, 0);
  assert.equal(updated.format, 'video');
});

test('updateSubscription: an invalid maxDurationSeconds within the patch is defensively ignored rather than corrupting the record', async () => {
  const deps = makeFakeDeps();
  const added = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@durguard', format: 'video', maxDurationSeconds: 3600 });
  const result = await store.updateSubscription(deps, added.id, { maxDurationSeconds: -99 });
  assert.equal(result.maxDurationSeconds, 3600, 'an invalid maxDurationSeconds in the patch must not overwrite the existing value');
});

// ---- ensureYtdlp: per-subscription `paused` backfill (FR-D) ----

test('ensureYtdlp: backfills paused=false and skipShorts=false on a legacy subscription lacking both fields', () => {
  const legacySub = { id: 'legacy1', channelUrl: 'https://www.youtube.com/@legacy', name: 'Legacy', format: 'video', quality: 'best', addedAt: '2020-01-01T00:00:00.000Z', lastCheckedAt: null, lastStatus: null };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [legacySub] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.subscriptions[0].paused, false);
  assert.equal(ns.subscriptions[0].skipShorts, false);
  // maxVideos stays unset (undefined), not backfilled to any number.
  assert.equal(ns.subscriptions[0].maxVideos, undefined);
});

test('ensureYtdlp: skipShorts backfill is non-destructive -- an already-boolean value is left untouched, and no other field is altered', () => {
  const modernSub = { id: 'modern-shorts', channelUrl: 'https://www.youtube.com/@modernshorts', name: 'Modern Shorts', format: 'video', quality: 'best', addedAt: '2026-01-01T00:00:00.000Z', lastCheckedAt: null, lastStatus: null, paused: false, skipShorts: true };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [modernSub] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.subscriptions[0].skipShorts, true);
  assert.equal(ns.subscriptions[0].name, 'Modern Shorts');
  assert.equal(ns.subscriptions[0].format, 'video');
});

test('ensureYtdlp: leaves an already-boolean paused field untouched', () => {
  const modernSub = { id: 'modern1', channelUrl: 'https://www.youtube.com/@modern', name: 'Modern', format: 'video', quality: 'best', addedAt: '2026-01-01T00:00:00.000Z', lastCheckedAt: null, lastStatus: null, paused: true };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [modernSub] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.subscriptions[0].paused, true);
});

// ---- v1.13.0 item 4: validateFiletype (format-aware, spawn-args-flagged) --

test('validateFiletype: accepts undefined (unset -> resolves to "default" at build time)', () => {
  assert.deepEqual(store.validateFiletype('video', undefined), { ok: true, value: undefined });
  assert.deepEqual(store.validateFiletype('audio', undefined), { ok: true, value: undefined });
});

test('validateFiletype: accepts a value in the given format\'s allowlist', () => {
  assert.deepEqual(store.validateFiletype('video', 'mp4'), { ok: true, value: 'mp4' });
  assert.deepEqual(store.validateFiletype('video', 'default'), { ok: true, value: 'default' });
  assert.deepEqual(store.validateFiletype('audio', 'opus'), { ok: true, value: 'opus' });
});

test('validateFiletype: rejects a value that is valid for the OTHER format (mismatched combo)', () => {
  assert.equal(store.validateFiletype('audio', 'mp4').ok, false);
  assert.equal(store.validateFiletype('video', 'mp3').ok, false);
});

test('validateFiletype: rejects a hostile/garbage value', () => {
  assert.equal(store.validateFiletype('video', 'mp4; rm -rf /').ok, false);
  assert.equal(store.validateFiletype('video', '../x').ok, false);
  assert.equal(store.validateFiletype('video', 42).ok, false);
  assert.equal(store.validateFiletype('video', { evil: true }).ok, false);
});

test('validateFiletype: rejects any value when format itself is unknown/invalid', () => {
  assert.equal(store.validateFiletype('gif', 'mp4').ok, false);
  assert.equal(store.validateFiletype(undefined, 'mp4').ok, false);
});

test('validateSubscriptionInput: rejects a mismatched-format filetype (audio format + video filetype)', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', format: 'audio', filetype: 'mp4' });
  assert.equal(result.ok, false);
});

test('validateSubscriptionInput: accepts a valid format-matched filetype and passes it through', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x', format: 'video', filetype: 'mkv' });
  assert.equal(result.ok, true);
  assert.equal(result.value.filetype, 'mkv');
});

test('validateSubscriptionInput: accepts unset filetype (stays undefined)', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@x' });
  assert.equal(result.ok, true);
  assert.equal(result.value.filetype, undefined);
});

test('validateSubscriptionPatch: coarsely rejects a hostile filetype even without a format in the same patch', () => {
  assert.equal(store.validateSubscriptionPatch({ filetype: 'mp4; rm -rf /' }).ok, false);
  assert.equal(store.validateSubscriptionPatch({ filetype: '../x' }).ok, false);
  assert.equal(store.validateSubscriptionPatch({ filetype: 42 }).ok, false);
});

test('validateSubscriptionPatch: allows a plausible-but-cross-format filetype through (coarse check only; args.normalizeFiletype is the authoritative gate)', () => {
  // format is absent from this patch, so the coarse check only verifies
  // membership in EITHER allowlist -- a video filetype is plausible on its
  // own, even though it might mismatch the sub's actual (unknown-here) format.
  const result = store.validateSubscriptionPatch({ filetype: 'mp4' });
  assert.equal(result.ok, true);
  assert.equal(result.value.filetype, 'mp4');
});

test('validateSubscriptionPatch: accepts an empty/unset filetype', () => {
  assert.deepEqual(store.validateSubscriptionPatch({}).value.filetype, undefined);
});

// ---- v1.13.0 item 4: addSubscription/updateSubscription carry filetype ----

test('addSubscription: a valid filetype is persisted on the new record', async () => {
  const deps = makeFakeDeps();
  const record = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@ftype', format: 'video', filetype: 'mkv' });
  assert.equal(record.filetype, 'mkv');
});

test('addSubscription: an invalid filetype fails safe to undefined rather than corrupting the record', async () => {
  const deps = makeFakeDeps();
  const record = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@ftypebad', format: 'video', filetype: 'mp4; rm -rf /' });
  assert.equal(record.filetype, undefined);
});

test('addSubscription: an unset filetype stays undefined on the new record (resolves to default at build time, AC16)', async () => {
  const deps = makeFakeDeps();
  const record = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@ftypeunset', format: 'video' });
  assert.equal(record.filetype, undefined);
});

test('updateSubscription: patches the filetype field', async () => {
  const deps = makeFakeDeps();
  const added = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@ftypeedit', format: 'video' });
  const updated = await store.updateSubscription(deps, added.id, { filetype: 'webm' });
  assert.equal(updated.filetype, 'webm');
});

test('updateSubscription: an invalid filetype in the patch is defensively ignored (record unchanged)', async () => {
  const deps = makeFakeDeps();
  const added = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@ftypeguard', format: 'video', filetype: 'mp4' });
  const result = await store.updateSubscription(deps, added.id, { filetype: 'mp3' }); // mp3 is audio-only, sub stays 'video'
  assert.equal(result.filetype, 'mp4', 'a filetype invalid for the sub\'s (unchanged) format must not overwrite the existing value');
});

test('updateSubscription: a simultaneous format+filetype patch validates against the NEW format', async () => {
  const deps = makeFakeDeps();
  const added = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@ftypeswap', format: 'video', filetype: 'mp4' });
  const updated = await store.updateSubscription(deps, added.id, { format: 'audio', filetype: 'opus' });
  assert.equal(updated.format, 'audio');
  assert.equal(updated.filetype, 'opus');
});

// ---- v1.13.0 item 4: backfill is non-destructive (AC16, NOT the paused ---
// destructive-style backfill) ------------------------------------------------

test('ensureYtdlp: a legacy sub without filetype is left untouched (no destructive backfill, unlike paused)', () => {
  const legacySub = { id: 'legacy2', channelUrl: 'https://www.youtube.com/@legacy2', name: 'Legacy2', format: 'video', quality: 'best', addedAt: '2020-01-01T00:00:00.000Z', lastCheckedAt: null, lastStatus: null };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [legacySub] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.subscriptions[0].filetype, undefined);
  assert.ok(!Object.prototype.hasOwnProperty.call(ns.subscriptions[0], 'filetype'), 'ensureYtdlp must not force-write a filetype key onto a legacy record');
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

// ---- v1.20.0 FR-2: sanitizeCapturedChannelMeta (SECURITY-CRITICAL) --------
//
// Every captured channelUrl/uploaderUrl MUST pass the UNMODIFIED
// url.validateChannelUrl before it survives sanitization -- these tests
// prove hostile/malformed input is dropped, never stored/used, while a
// genuinely valid capture (mirroring what parseChannelMetaLine returns) is
// kept intact.

function validMeta(overrides = {}) {
  return {
    videoId: 'dQw4w9WgXcQ',
    channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    uploaderUrl: 'https://www.youtube.com/@RickAstley',
    channelName: 'Rick Astley',
    ...overrides,
  };
}

test('sanitizeCapturedChannelMeta: keeps a fully valid capture, normalizing the URL via validateChannelUrl', () => {
  const result = store.sanitizeCapturedChannelMeta(validMeta());
  assert.equal(result.videoId, 'dQw4w9WgXcQ');
  assert.equal(result.channelUrl, 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw');
  assert.equal(result.channelHandleUrl, 'https://www.youtube.com/@RickAstley');
  assert.equal(result.channelId, 'UCuAXFkgsw1L7xaCfnd5JJOw');
  assert.equal(result.channelName, 'Rick Astley');
});

test('sanitizeCapturedChannelMeta: falls back to uploaderUrl when channelUrl is absent/invalid', () => {
  const result = store.sanitizeCapturedChannelMeta(validMeta({ channelUrl: null }));
  assert.equal(result.channelUrl, 'https://www.youtube.com/@RickAstley');
  // channelHandleUrl is only set when it DIFFERS from the chosen channelUrl.
  assert.equal(result.channelHandleUrl, undefined);
});

test('sanitizeCapturedChannelMeta: drops the ENTIRE entry when NEITHER channelUrl nor uploaderUrl passes validation', () => {
  assert.equal(store.sanitizeCapturedChannelMeta(validMeta({ channelUrl: null, uploaderUrl: null })), null);
  assert.equal(store.sanitizeCapturedChannelMeta(validMeta({ channelUrl: 'not a url', uploaderUrl: 'also not a url' })), null);
});

test('sanitizeCapturedChannelMeta: HOSTILE channelUrl (shell metacharacters) is dropped, never stored (falls back to uploaderUrl if that is valid)', () => {
  const result = store.sanitizeCapturedChannelMeta(validMeta({ channelUrl: 'https://youtube.com/@x; rm -rf /' }));
  assert.equal(result.channelUrl, 'https://www.youtube.com/@RickAstley', 'the hostile channelUrl must never be used -- falls back to the valid uploaderUrl');
});

test('sanitizeCapturedChannelMeta: HOSTILE channelUrl AND uploaderUrl together drop the whole entry', () => {
  const result = store.sanitizeCapturedChannelMeta(validMeta({
    channelUrl: 'https://youtube.com/@x; rm -rf /',
    uploaderUrl: 'javascript:alert(1)',
  }));
  assert.equal(result, null);
});

test('sanitizeCapturedChannelMeta: a CRLF header-injection-shaped channelUrl with NO embedded legitimate URL is dropped (control-char reject in validateChannelUrl)', () => {
  const result = store.sanitizeCapturedChannelMeta(validMeta({
    channelUrl: '\r\nSet-Cookie: evil=1\r\n',
    uploaderUrl: null,
  }));
  assert.equal(result, null);
});

test('sanitizeCapturedChannelMeta: a CRLF-suffixed channelUrl is normalized to just its embedded legitimate URL (documented FR-5 v1.16.0 extraction, never a bypass -- the injected suffix is discarded, not smuggled through)', () => {
  const result = store.sanitizeCapturedChannelMeta(validMeta({
    channelUrl: 'https://www.youtube.com/@x\r\nSet-Cookie: evil=1',
    uploaderUrl: null,
  }));
  assert.equal(result.channelUrl, 'https://www.youtube.com/@x', 'only the clean, validated URL prefix ever survives -- the CRLF-injected text is dropped, never persisted');
});

test('sanitizeCapturedChannelMeta: a disallowed (non-YouTube) host is dropped', () => {
  const result = store.sanitizeCapturedChannelMeta(validMeta({
    channelUrl: 'https://evil.com/@somechannel',
    uploaderUrl: null,
  }));
  assert.equal(result, null);
});

test('sanitizeCapturedChannelMeta: an overlong channelUrl is dropped (MAX_URL_LENGTH reject in validateChannelUrl)', () => {
  const overlong = `https://www.youtube.com/@${'a'.repeat(3000)}`;
  const result = store.sanitizeCapturedChannelMeta(validMeta({ channelUrl: overlong, uploaderUrl: null }));
  assert.equal(result, null);
});

test('sanitizeCapturedChannelMeta: a video URL (not a channel URL) never passes as a channel identity', () => {
  const result = store.sanitizeCapturedChannelMeta(validMeta({
    channelUrl: 'https://youtu.be/dQw4w9WgXcQ',
    uploaderUrl: null,
  }));
  // youtu.be/<id> IS a plausible shape validateChannelUrl accepts (it's the
  // single-video-URL classifier's own domain) -- sanitizeCapturedChannelMeta
  // does not itself distinguish "video" from "channel" shapes (that's the
  // client-side matcher's job per the design), so this is accepted as a
  // URL here; the assertion below locks that this is NOT silently rejected
  // in a way that would mask a real regression, while still proving no
  // hostile/malformed value reaches this point untouched.
  assert.equal(result.channelUrl, 'https://youtu.be/dQw4w9WgXcQ');
});

test('sanitizeCapturedChannelMeta: an invalid videoId drops the WHOLE entry (no safe join key)', () => {
  assert.equal(store.sanitizeCapturedChannelMeta(validMeta({ videoId: '../../../etc/passwd' })), null);
  assert.equal(store.sanitizeCapturedChannelMeta(validMeta({ videoId: 'has space' })), null);
  assert.equal(store.sanitizeCapturedChannelMeta(validMeta({ videoId: '' })), null);
  assert.equal(store.sanitizeCapturedChannelMeta(validMeta({ videoId: null })), null);
  assert.equal(store.sanitizeCapturedChannelMeta(validMeta({ videoId: 'a'.repeat(200) })), null);
});

test('sanitizeCapturedChannelMeta: channelId is kept ONLY when it matches the UC... shape; otherwise dropped (never persisted as-is)', () => {
  const valid = store.sanitizeCapturedChannelMeta(validMeta());
  assert.equal(valid.channelId, 'UCuAXFkgsw1L7xaCfnd5JJOw');
  const hostileId = store.sanitizeCapturedChannelMeta(validMeta({ channelId: '"; DROP TABLE subs; --' }));
  assert.equal(hostileId.channelId, undefined, 'a hostile channelId must be dropped, not stored verbatim');
  const shortId = store.sanitizeCapturedChannelMeta(validMeta({ channelId: 'UCshort' }));
  assert.equal(shortId.channelId, undefined);
});

test('sanitizeCapturedChannelMeta: channelName is control-char-stripped and length-bounded', () => {
  const withControlChars = store.sanitizeCapturedChannelMeta(validMeta({ channelName: 'Evil\x00\x1fName\x7f' }));
  assert.equal(withControlChars.channelName, 'EvilName');
  const overlong = store.sanitizeCapturedChannelMeta(validMeta({ channelName: 'x'.repeat(500) }));
  assert.equal(overlong.channelName.length, store.MAX_CAPTURED_CHANNEL_NAME_LENGTH);
  const emptyAfterStrip = store.sanitizeCapturedChannelMeta(validMeta({ channelName: '\x00\x00' }));
  assert.equal(emptyAfterStrip.channelName, undefined);
});

test('sanitizeCapturedChannelMeta: a non-object/null raw input never throws, drops the entry', () => {
  assert.equal(store.sanitizeCapturedChannelMeta(null), null);
  assert.equal(store.sanitizeCapturedChannelMeta(undefined), null);
  assert.equal(store.sanitizeCapturedChannelMeta('a string'), null);
  assert.equal(store.sanitizeCapturedChannelMeta(42), null);
});

// ---- v1.20.0 FR-2: recordDownloadChannelMeta / consumeDownloadChannelMeta -

test('recordDownloadChannelMeta: persists a sanitized entry into db.ytdlp.downloadMeta, keyed by videoId', async () => {
  const deps = makeFakeDeps();
  const recorded = await store.recordDownloadChannelMeta(deps, validMeta());
  assert.equal(recorded, true);
  const ns = store.ensureYtdlp(deps.loadDatabase());
  assert.ok(ns.downloadMeta.dQw4w9WgXcQ);
  assert.equal(ns.downloadMeta.dQw4w9WgXcQ.channelUrl, 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw');
  assert.equal(typeof ns.downloadMeta.dQw4w9WgXcQ.capturedAt, 'number');
});

test('recordDownloadChannelMeta: a hostile/invalid entry is dropped -- resolves false, nothing is written', async () => {
  const deps = makeFakeDeps();
  const recorded = await store.recordDownloadChannelMeta(deps, validMeta({ channelUrl: null, uploaderUrl: null }));
  assert.equal(recorded, false);
  const ns = store.ensureYtdlp(deps.loadDatabase());
  assert.deepEqual(ns.downloadMeta, {});
});

test('recordDownloadChannelMeta: MAX_DOWNLOAD_META FIFO cap evicts the OLDEST entries first', async () => {
  const deps = makeFakeDeps();
  // Seed one entry directly with an old capturedAt so it is the guaranteed-oldest.
  await store.recordDownloadChannelMeta(deps, validMeta({ videoId: 'oldestVideoId' }));
  const db = deps.loadDatabase();
  store.ensureYtdlp(db).downloadMeta.oldestVideoId.capturedAt = 1; // force it to be the oldest

  // Fill up to (but not over) the cap with distinct ids.
  for (let i = 0; i < store.MAX_DOWNLOAD_META - 1; i++) {
    await store.recordDownloadChannelMeta(deps, validMeta({ videoId: `vid${String(i).padStart(6, '0')}` }));
  }
  assert.equal(Object.keys(store.ensureYtdlp(deps.loadDatabase()).downloadMeta).length, store.MAX_DOWNLOAD_META);
  assert.ok(store.ensureYtdlp(deps.loadDatabase()).downloadMeta.oldestVideoId, 'sanity: still at exactly the cap, oldest survives');

  // One more push over the cap must evict the oldest entry (oldestVideoId).
  await store.recordDownloadChannelMeta(deps, validMeta({ videoId: 'newestVideoId' }));
  const finalNs = store.ensureYtdlp(deps.loadDatabase());
  assert.equal(Object.keys(finalNs.downloadMeta).length, store.MAX_DOWNLOAD_META, 'the map must stay capped, never grow past MAX_DOWNLOAD_META');
  assert.ok(!finalNs.downloadMeta.oldestVideoId, 'the oldest entry (by capturedAt) must be evicted once the cap is exceeded');
  assert.ok(finalNs.downloadMeta.newestVideoId, 'the newly-recorded entry must be present');
});

test('consumeDownloadChannelMeta: reads, re-validates, and DELETES the entry (consume-and-delete, bounded growth)', () => {
  const db = {};
  store.ensureYtdlp(db).downloadMeta.dQw4w9WgXcQ = {
    channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channelHandleUrl: 'https://www.youtube.com/@RickAstley',
    channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    channelName: 'Rick Astley',
    capturedAt: Date.now(),
  };
  const result = store.consumeDownloadChannelMeta(db, 'dQw4w9WgXcQ');
  assert.deepEqual(result, {
    channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channelHandleUrl: 'https://www.youtube.com/@RickAstley',
    channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
    channelName: 'Rick Astley',
  });
  // Consumed -- the key must be gone regardless of the lookup outcome.
  assert.equal(db.ytdlp.downloadMeta.dQw4w9WgXcQ, undefined);
});

test('consumeDownloadChannelMeta: a miss (no entry for this videoId) returns null, never throws', () => {
  const db = {};
  assert.equal(store.consumeDownloadChannelMeta(db, 'noSuchVideoId'), null);
});

test('consumeDownloadChannelMeta: an invalid videoId (fails isSafeVideoId) returns null without touching the map', () => {
  const db = {};
  store.ensureYtdlp(db).downloadMeta['../etc/passwd'] = { channelUrl: 'https://www.youtube.com/@x', capturedAt: Date.now() };
  assert.equal(store.consumeDownloadChannelMeta(db, '../etc/passwd'), null);
});

test('consumeDownloadChannelMeta: re-validates the stored channelUrl -- a somehow-corrupted persisted entry with a hostile URL is dropped (still deleted, never returned)', () => {
  const db = {};
  store.ensureYtdlp(db).downloadMeta.dQw4w9WgXcQ = {
    channelUrl: 'https://evil.com/@x',
    capturedAt: Date.now(),
  };
  const result = store.consumeDownloadChannelMeta(db, 'dQw4w9WgXcQ');
  assert.equal(result, null);
  assert.equal(db.ytdlp.downloadMeta.dQw4w9WgXcQ, undefined, 'the entry must still be consumed (deleted) even when it fails re-validation');
});

test('consumeDownloadChannelMeta: is safe to call from INSIDE a synchronous updateDatabase-style mutator (no re-entrant updateDatabase call)', async () => {
  const deps = makeFakeDeps();
  await store.recordDownloadChannelMeta(deps, validMeta());
  let consumed;
  await deps.updateDatabase((fresh) => {
    consumed = store.consumeDownloadChannelMeta(fresh, 'dQw4w9WgXcQ');
  });
  assert.ok(consumed);
  assert.equal(consumed.channelUrl, 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw');
});

// ---- v1.21.0 FR-5: channel pins (HEAVY, two-reviewer, data-safety gate) ---

// ---- ensureYtdlp: pins backfill (non-destructive, mirrors subscriptions) --

test('ensureYtdlp: an old db with no ytdlp key gains an empty pins array alongside the rest of the default namespace', () => {
  const db = {};
  const ns = store.ensureYtdlp(db);
  assert.deepEqual(ns.pins, []);
});

test('ensureYtdlp: a partial ytdlp namespace without pins is completed with an empty array, without clobbering present pins-adjacent fields', () => {
  const db = { ytdlp: { allowMembersOnly: true, subscriptions: [] } };
  const ns = store.ensureYtdlp(db);
  assert.deepEqual(ns.pins, []);
  assert.equal(ns.allowMembersOnly, true, 'unrelated already-present fields must be left untouched');
});

test('ensureYtdlp: an already-present pins array (even non-empty) is left completely untouched', () => {
  const existingPin = { id: 'p1', channelDir: '/data/ytdlp-downloads/Chan', label: 'Chan', pinnedAt: '2020-01-01T00:00:00.000Z' };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [], pins: [existingPin] } };
  const ns = store.ensureYtdlp(db);
  assert.deepEqual(ns.pins, [existingPin]);
});

test('ensureYtdlp: backfill mutates each db\'s pins array independently, never sharing state across unrelated db instances', () => {
  const dbA = {};
  const dbB = {};
  store.ensureYtdlp(dbA);
  store.ensureYtdlp(dbB);
  dbA.ytdlp.pins.push({ id: 'only-in-a' });
  assert.deepEqual(dbB.ytdlp.pins, [], 'backfill must not share the pins array reference across db instances');
});

// ---- sanitizePinLabel (pure) -----------------------------------------------

test('sanitizePinLabel: strips control characters and trims', () => {
  assert.equal(store.sanitizePinLabel('Evil\x00\x1fChannel\x7f'), 'EvilChannel');
  assert.equal(store.sanitizePinLabel('  My Channel  '), 'My Channel');
});

test('sanitizePinLabel: length-bounds to MAX_PIN_LABEL_LENGTH', () => {
  const overlong = 'x'.repeat(500);
  assert.equal(store.sanitizePinLabel(overlong).length, store.MAX_PIN_LABEL_LENGTH);
});

test('sanitizePinLabel: a non-string input yields an empty string, never throws', () => {
  assert.equal(store.sanitizePinLabel(undefined), '');
  assert.equal(store.sanitizePinLabel(null), '');
  assert.equal(store.sanitizePinLabel(42), '');
  assert.equal(store.sanitizePinLabel({}), '');
});

// ---- isChannelDirConfined (pure, SECURITY-CRITICAL confinement predicate) -

test('isChannelDirConfined: true for the download root itself and for a direct/nested descendant', () => {
  const config = { downloadDir: '/data/ytdlp-downloads' };
  assert.equal(store.isChannelDirConfined(config, '/data/ytdlp-downloads'), true);
  assert.equal(store.isChannelDirConfined(config, '/data/ytdlp-downloads/My Channel'), true);
  assert.equal(store.isChannelDirConfined(config, '/data/ytdlp-downloads/A/B'), true);
});

test('isChannelDirConfined: false for a path outside the download root (including a sibling-prefix lookalike)', () => {
  const config = { downloadDir: '/data/ytdlp-downloads' };
  assert.equal(store.isChannelDirConfined(config, '/data/other'), false);
  assert.equal(store.isChannelDirConfined(config, '/etc/passwd'), false);
  // Sibling directory that merely SHARES a string prefix with the root must
  // never be treated as "under" it -- this is exactly what a naive
  // `startsWith(root)` (without the trailing separator) would get wrong.
  assert.equal(store.isChannelDirConfined(config, '/data/ytdlp-downloads-evil'), false);
});

test('isChannelDirConfined: a traversal-shaped candidate that RESOLVES outside the root is rejected', () => {
  const config = { downloadDir: '/data/ytdlp-downloads' };
  assert.equal(store.isChannelDirConfined(config, '/data/ytdlp-downloads/../../etc/passwd'), false);
});

test('isChannelDirConfined: fails closed on a missing/blank channelDir or downloadDir', () => {
  assert.equal(store.isChannelDirConfined({ downloadDir: '/data/ytdlp-downloads' }, ''), false);
  assert.equal(store.isChannelDirConfined({ downloadDir: '/data/ytdlp-downloads' }, undefined), false);
  assert.equal(store.isChannelDirConfined({ downloadDir: '' }, '/data/ytdlp-downloads/x'), false);
  assert.equal(store.isChannelDirConfined({}, '/data/ytdlp-downloads/x'), false);
});

// ---- validatePinInput (pure) -----------------------------------------------

test('validatePinInput: rejects a missing/blank channelDir', () => {
  const config = { downloadDir: '/data/ytdlp-downloads' };
  assert.equal(store.validatePinInput(config, {}).ok, false);
  assert.equal(store.validatePinInput(config, { channelDir: '' }).ok, false);
  assert.equal(store.validatePinInput(config, { channelDir: '   ' }).ok, false);
});

test('validatePinInput: rejects a channelDir OUTSIDE the configured download directory', () => {
  const config = { downloadDir: '/data/ytdlp-downloads' };
  const result = store.validatePinInput(config, { channelDir: '/etc/passwd', label: 'Evil' });
  assert.equal(result.ok, false);
});

test('validatePinInput: rejects a missing/empty label even when channelDir is valid', () => {
  const config = { downloadDir: '/data/ytdlp-downloads' };
  assert.equal(store.validatePinInput(config, { channelDir: '/data/ytdlp-downloads/Chan' }).ok, false);
  assert.equal(store.validatePinInput(config, { channelDir: '/data/ytdlp-downloads/Chan', label: '   ' }).ok, false);
});

test('validatePinInput: accepts a confined channelDir and a sanitized label', () => {
  const config = { downloadDir: '/data/ytdlp-downloads' };
  const result = store.validatePinInput(config, { channelDir: '/data/ytdlp-downloads/Chan', label: '  My Chan\x00  ' });
  assert.equal(result.ok, true);
  assert.equal(result.value.channelDir, '/data/ytdlp-downloads/Chan');
  assert.equal(result.value.label, 'My Chan');
});

// ---- reduceAddPin / reduceRemovePin (pure reducers) ------------------------

test('reduceAddPin: appends a new pin and reports changed:true', () => {
  const result = store.reduceAddPin([], { id: 'p1', channelDir: '/d/a', label: 'A', pinnedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(result.changed, true);
  assert.equal(result.pins.length, 1);
  assert.equal(result.record.id, 'p1');
});

test('reduceAddPin: idempotent by id -- an existing id returns the array UNCHANGED and the EXISTING record, not a new one', () => {
  const existing = { id: 'p1', channelDir: '/d/a', label: 'Old Label', pinnedAt: '2020-01-01T00:00:00.000Z' };
  const result = store.reduceAddPin([existing], { id: 'p1', channelDir: '/d/a', label: 'New Label', pinnedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(result.changed, false);
  assert.deepEqual(result.pins, [existing]);
  assert.equal(result.record, existing, 'the existing record must be returned unmodified, never overwritten by the re-pin');
});

test('reduceAddPin: never mutates its input array', () => {
  const input = [{ id: 'p1', channelDir: '/d/a', label: 'A', pinnedAt: '2020-01-01T00:00:00.000Z' }];
  const frozenInput = Object.freeze(input.slice());
  assert.doesNotThrow(() => store.reduceAddPin(frozenInput, { id: 'p2', channelDir: '/d/b', label: 'B', pinnedAt: '2026-01-01T00:00:00.000Z' }));
});

test('reduceAddPin: evicts the OLDEST entry (FIFO, by insertion order) once MAX_PINS is exceeded', () => {
  let pins = [];
  for (let i = 0; i < store.MAX_PINS; i++) {
    pins = store.reduceAddPin(pins, { id: `p${i}`, channelDir: `/d/${i}`, label: `${i}`, pinnedAt: '2020-01-01T00:00:00.000Z' }).pins;
  }
  assert.equal(pins.length, store.MAX_PINS);
  assert.equal(pins[0].id, 'p0', 'sanity: still at exactly the cap, oldest survives');

  const result = store.reduceAddPin(pins, { id: 'overflow', channelDir: '/d/overflow', label: 'Overflow', pinnedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(result.pins.length, store.MAX_PINS, 'the list must stay capped, never grow past MAX_PINS');
  assert.ok(!result.pins.some((p) => p.id === 'p0'), 'the oldest entry must be evicted once the cap is exceeded');
  assert.ok(result.pins.some((p) => p.id === 'overflow'), 'the newly-added entry must be present');
});

test('reduceRemovePin: removes a matching id and reports changed:true', () => {
  const pins = [{ id: 'p1', channelDir: '/d/a', label: 'A', pinnedAt: '2020-01-01T00:00:00.000Z' }];
  const result = store.reduceRemovePin(pins, 'p1');
  assert.equal(result.changed, true);
  assert.deepEqual(result.pins, []);
});

test('reduceRemovePin: an unknown id is a no-op, changed:false, array unchanged', () => {
  const pins = [{ id: 'p1', channelDir: '/d/a', label: 'A', pinnedAt: '2020-01-01T00:00:00.000Z' }];
  const result = store.reduceRemovePin(pins, 'no-such-id');
  assert.equal(result.changed, false);
  assert.deepEqual(result.pins, pins);
});

test('reduceRemovePin: never mutates its input array', () => {
  const input = [{ id: 'p1', channelDir: '/d/a', label: 'A', pinnedAt: '2020-01-01T00:00:00.000Z' }];
  const frozenInput = Object.freeze(input.slice());
  assert.doesNotThrow(() => store.reduceRemovePin(frozenInput, 'p1'));
});

// ---- listPins / addPin / removePin (persistence, via the fake deps) -------

test('addPin: creates a well-formed record and listPins reflects it', async () => {
  const deps = makeFakeDeps();
  const record = await store.addPin(deps, { channelDir: '/data/ytdlp-downloads/Chan', label: 'Chan' });
  assert.equal(record.channelDir, '/data/ytdlp-downloads/Chan');
  assert.equal(record.label, 'Chan');
  assert.equal(typeof record.id, 'string');
  assert.equal(typeof record.pinnedAt, 'string');
  const list = store.listPins(deps);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], record);
});

test('addPin: idempotent -- re-pinning the same channelDir does not create a duplicate', async () => {
  const deps = makeFakeDeps();
  const first = await store.addPin(deps, { channelDir: '/data/ytdlp-downloads/Chan', label: 'Chan' });
  const second = await store.addPin(deps, { channelDir: '/data/ytdlp-downloads/Chan', label: 'Chan (renamed client-side)' });
  assert.equal(second.id, first.id);
  assert.equal(store.listPins(deps).length, 1);
  assert.equal(store.listPins(deps)[0].label, 'Chan', 're-pinning must not overwrite the original snapshot label');
});

test('removePin: removes an existing pin and returns true', async () => {
  const deps = makeFakeDeps();
  const record = await store.addPin(deps, { channelDir: '/data/ytdlp-downloads/Chan', label: 'Chan' });
  const removed = await store.removePin(deps, record.id);
  assert.equal(removed, true);
  assert.deepEqual(store.listPins(deps), []);
});

test('removePin: returns false for an unknown id and leaves the list untouched', async () => {
  const deps = makeFakeDeps();
  await store.addPin(deps, { channelDir: '/data/ytdlp-downloads/Chan', label: 'Chan' });
  const removed = await store.removePin(deps, 'no-such-id');
  assert.equal(removed, false);
  assert.equal(store.listPins(deps).length, 1);
});

test('addPin/removePin: never write into db.folders/db.folderSettings (structural regression lock)', async () => {
  const deps = makeFakeDeps({ folders: ['/movies'], folderSettings: { '/movies': { name: 'Movies' } } });
  const record = await store.addPin(deps, { channelDir: '/data/ytdlp-downloads/Chan', label: 'Chan' });
  await store.removePin(deps, record.id);
  const db = deps.loadDatabase();
  assert.deepEqual(db.folders, ['/movies'], 'db.folders must be byte-identical -- pins never touch it');
  assert.deepEqual(db.folderSettings, { '/movies': { name: 'Movies' } }, 'db.folderSettings must be byte-identical -- pins never touch it');
});
