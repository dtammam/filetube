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
  assert.deepEqual(ns, { allowMembersOnly: false, subscriptions: [], downloadMeta: {}, pins: [], channelAvatars: {} });
  // Existing keys untouched.
  assert.deepEqual(db.folders, ['/movies']);
  assert.deepEqual(db.settings, { scanIntervalMinutes: 15 });
  assert.deepEqual(db.ytdlp, { allowMembersOnly: false, subscriptions: [], downloadMeta: {}, pins: [], channelAvatars: {} });
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

// ---- FIX 1 (two-reviewer gate, post-v1.25.0): setSubscriptionStatus's own --
// forward-only cutoffDate guard (defense-in-depth on top of the CALLER's --
// own "did this cycle qualify to advance" decision, lib/ytdlp/index.js's
// processSubscription) ----

test('setSubscriptionStatus: an omitted cutoffDate leaves the existing value completely untouched', async () => {
  const deps = makeFakeDeps();
  const record = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@cutoffomit', format: 'video', cutoffDate: '20250601' });
  await store.setSubscriptionStatus(deps, record.id, { lastCheckedAt: '2026-07-05T00:00:00.000Z', lastStatus: 'ok: no new videos' });
  const [sub] = store.listSubscriptions(deps).filter((s) => s.id === record.id);
  assert.equal(sub.cutoffDate, '20250601');
});

test('setSubscriptionStatus: a strictly-later cutoffDate is applied', async () => {
  const deps = makeFakeDeps();
  const record = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@cutoffadvance', format: 'video', cutoffDate: '20250601' });
  await store.setSubscriptionStatus(deps, record.id, { lastStatus: 'ok: no new videos', cutoffDate: '20250701' });
  const [sub] = store.listSubscriptions(deps).filter((s) => s.id === record.id);
  assert.equal(sub.cutoffDate, '20250701');
});

test('setSubscriptionStatus: a cutoffDate that is NOT strictly later than the current value is silently ignored (never regresses, and never no-ops the whole call)', async () => {
  const deps = makeFakeDeps();
  const record = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@cutoffguard2', format: 'video', cutoffDate: '20250701' });

  // Equal to the current value: a no-op, not an error.
  const updatedEqual = await store.setSubscriptionStatus(deps, record.id, { lastStatus: 'ok', cutoffDate: '20250701' });
  assert.equal(updatedEqual, true, 'the call itself must still succeed even when the cutoffDate sub-write is a no-op');
  let [sub] = store.listSubscriptions(deps).filter((s) => s.id === record.id);
  assert.equal(sub.cutoffDate, '20250701');

  // Strictly EARLIER than the current value: must never regress it.
  await store.setSubscriptionStatus(deps, record.id, { lastStatus: 'ok', cutoffDate: '20250101' });
  [sub] = store.listSubscriptions(deps).filter((s) => s.id === record.id);
  assert.equal(sub.cutoffDate, '20250701', 'cutoffDate must only ever advance forward, never regress');
});

test('setSubscriptionStatus: a malformed/implausible cutoffDate is silently ignored, never corrupts the stored value', async () => {
  const deps = makeFakeDeps();
  const record = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@cutoffmalformed', format: 'video', cutoffDate: '20250601' });
  await store.setSubscriptionStatus(deps, record.id, { lastStatus: 'ok', cutoffDate: '20230230' }); // Feb 30 -- impossible calendar date
  const [sub] = store.listSubscriptions(deps).filter((s) => s.id === record.id);
  assert.equal(sub.cutoffDate, '20250601', 'a malformed cutoffDate must never overwrite the existing valid value');
});

test('setSubscriptionStatus: lastCheckedAt/lastStatus are still updated even when the accompanying cutoffDate write is rejected', async () => {
  const deps = makeFakeDeps();
  const record = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@cutoffindependent', format: 'video', cutoffDate: '20250701' });
  await store.setSubscriptionStatus(deps, record.id, { lastCheckedAt: '2026-07-05T00:00:00.000Z', lastStatus: 'ok: no new videos', cutoffDate: '20250101' });
  const [sub] = store.listSubscriptions(deps).filter((s) => s.id === record.id);
  assert.equal(sub.lastCheckedAt, '2026-07-05T00:00:00.000Z');
  assert.equal(sub.lastStatus, 'ok: no new videos');
  assert.equal(sub.cutoffDate, '20250701', 'the rejected cutoffDate write must not affect the other, independent fields');
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

// ---- v1.24.0 C5-ytdlp: parseCapturedReleaseDate (pure) ---------------------

test('parseCapturedReleaseDate: a valid YYYYMMDD string parses to the correct UTC-midnight epoch ms', () => {
  const ms = store.parseCapturedReleaseDate('20230615');
  assert.equal(ms, Date.UTC(2023, 5, 15));
});

test('parseCapturedReleaseDate: malformed/wrong-length/non-digit input is dropped, never throws', () => {
  assert.equal(store.parseCapturedReleaseDate('2023-06-15'), null);
  assert.equal(store.parseCapturedReleaseDate('2023061'), null); // too short
  assert.equal(store.parseCapturedReleaseDate('202306155'), null); // too long
  assert.equal(store.parseCapturedReleaseDate('2023061x'), null); // non-digit
  assert.equal(store.parseCapturedReleaseDate(''), null);
  assert.equal(store.parseCapturedReleaseDate(null), null);
  assert.equal(store.parseCapturedReleaseDate(undefined), null);
  assert.equal(store.parseCapturedReleaseDate(20230615), null); // a number, not a string
});

test('parseCapturedReleaseDate: an out-of-range month/day is dropped outright, never silently rolled forward', () => {
  assert.equal(store.parseCapturedReleaseDate('20231301'), null); // month 13
  assert.equal(store.parseCapturedReleaseDate('20230001'), null); // month 0
  assert.equal(store.parseCapturedReleaseDate('20230230'), null); // Feb 30 -- Date.UTC would silently overflow into March
  assert.equal(store.parseCapturedReleaseDate('20230100'), null); // day 0
  assert.equal(store.parseCapturedReleaseDate('20230132'), null); // day 32
});

test('parseCapturedReleaseDate: a plausible boundary (Feb 29 on a real leap year) is accepted', () => {
  const ms = store.parseCapturedReleaseDate('20200229'); // 2020 is a leap year
  assert.equal(ms, Date.UTC(2020, 1, 29));
});

test('parseCapturedReleaseDate: a HOSTILE oversized numeric string is dropped by the fixed 8-digit shape check', () => {
  assert.equal(store.parseCapturedReleaseDate('9'.repeat(1000)), null);
});

test('parseCapturedReleaseDate: implausibly old or far-future dates are dropped (bounds check)', () => {
  assert.equal(store.parseCapturedReleaseDate('19991231'), null); // before the plausible floor
  const farFutureYear = new Date().getUTCFullYear() + 50;
  assert.equal(store.parseCapturedReleaseDate(`${farFutureYear}0101`), null);
});

// ---- v1.24.0 C6: sanitizeChannelAvatarUrl (pure) ---------------------------

test('sanitizeChannelAvatarUrl: a well-formed https URL is kept, normalized via the URL constructor', () => {
  assert.equal(
    store.sanitizeChannelAvatarUrl('https://yt3.ggpht.com/abc123=s176-c-k-c0x00ffffff-no-rj'),
    'https://yt3.ggpht.com/abc123=s176-c-k-c0x00ffffff-no-rj',
  );
});

test('sanitizeChannelAvatarUrl: non-https schemes are ALWAYS rejected (http, javascript, data, file)', () => {
  assert.equal(store.sanitizeChannelAvatarUrl('http://yt3.ggpht.com/abc'), null);
  assert.equal(store.sanitizeChannelAvatarUrl('javascript:alert(1)'), null);
  assert.equal(store.sanitizeChannelAvatarUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(store.sanitizeChannelAvatarUrl('file:///etc/passwd'), null);
});

test('sanitizeChannelAvatarUrl: malformed/relative/empty input is dropped, never throws', () => {
  assert.equal(store.sanitizeChannelAvatarUrl(''), null);
  assert.equal(store.sanitizeChannelAvatarUrl('   '), null);
  assert.equal(store.sanitizeChannelAvatarUrl('not a url'), null);
  assert.equal(store.sanitizeChannelAvatarUrl('/relative/path.jpg'), null);
  assert.equal(store.sanitizeChannelAvatarUrl(null), null);
  assert.equal(store.sanitizeChannelAvatarUrl(undefined), null);
  assert.equal(store.sanitizeChannelAvatarUrl(42), null);
});

test('sanitizeChannelAvatarUrl: control characters embedded in the raw string are rejected outright', () => {
  assert.equal(store.sanitizeChannelAvatarUrl('https://yt3.ggpht.com/abc\r\nSet-Cookie: evil=1'), null);
  assert.equal(store.sanitizeChannelAvatarUrl('https://yt3.ggpht.com/abc\x00def'), null);
});

test('sanitizeChannelAvatarUrl: an oversized URL is dropped (MAX_CHANNEL_AVATAR_URL_LENGTH reject)', () => {
  const overlong = `https://yt3.ggpht.com/${'a'.repeat(store.MAX_CHANNEL_AVATAR_URL_LENGTH)}`;
  assert.equal(store.sanitizeChannelAvatarUrl(overlong), null);
});

// FIX 3 (v1.24 UX Round, Wave 3 two-reviewer gate) -- mirrors
// `validateChannelUrl`'s SF6 posture: a URL carrying embedded `user:pass@`
// credentials is rejected outright, never silently stripped.
test('sanitizeChannelAvatarUrl: a URL carrying embedded userinfo (user:pass@) is rejected outright', () => {
  assert.equal(store.sanitizeChannelAvatarUrl('https://user:pass@host/x.jpg'), null);
});

// ---- v1.24.0 C5-ytdlp/C6: sanitizeCapturedChannelMeta releaseDate/channelAvatarUrl

test('sanitizeCapturedChannelMeta: a valid releaseDate/uploadDate + channelThumbnail are captured onto the sanitized result', () => {
  const result = store.sanitizeCapturedChannelMeta(validMeta({
    releaseDate: '20230615',
    uploadDate: '20230610',
    channelThumbnail: 'https://yt3.ggpht.com/avatar123',
  }));
  // release_date is preferred over upload_date when both are present.
  assert.equal(result.releaseDate, Date.UTC(2023, 5, 15));
  assert.equal(result.channelAvatarUrl, 'https://yt3.ggpht.com/avatar123');
});

test('sanitizeCapturedChannelMeta: falls back to uploadDate when releaseDate is absent/malformed', () => {
  const result = store.sanitizeCapturedChannelMeta(validMeta({ releaseDate: null, uploadDate: '20230610' }));
  assert.equal(result.releaseDate, Date.UTC(2023, 5, 10));
  const malformed = store.sanitizeCapturedChannelMeta(validMeta({ releaseDate: 'not-a-date', uploadDate: '20230610' }));
  assert.equal(malformed.releaseDate, Date.UTC(2023, 5, 10));
});

test('sanitizeCapturedChannelMeta: releaseDate is absent from the result when neither field survives parsing', () => {
  const result = store.sanitizeCapturedChannelMeta(validMeta({ releaseDate: 'garbage', uploadDate: null }));
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'releaseDate'), false);
});

test('sanitizeCapturedChannelMeta: a HOSTILE channelThumbnail (javascript: scheme) is dropped, never persisted', () => {
  const result = store.sanitizeCapturedChannelMeta(validMeta({ channelThumbnail: 'javascript:alert(document.cookie)' }));
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'channelAvatarUrl'), false);
});

test('sanitizeCapturedChannelMeta: an absent channelThumbnail/releaseDate/uploadDate leaves the result byte-identical to the pre-C5/C6 shape', () => {
  const result = store.sanitizeCapturedChannelMeta(validMeta());
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'releaseDate'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'channelAvatarUrl'), false);
});

// ---- v1.24.0 C5-ytdlp/C6: recordDownloadChannelMeta/consumeDownloadChannelMeta

test('recordDownloadChannelMeta -> consumeDownloadChannelMeta: releaseDate and channelAvatarUrl round-trip through db.ytdlp.downloadMeta', async () => {
  const deps = makeFakeDeps();
  await store.recordDownloadChannelMeta(deps, validMeta({
    releaseDate: '20230615',
    channelThumbnail: 'https://yt3.ggpht.com/avatar123',
  }));
  const ns = store.ensureYtdlp(deps.loadDatabase());
  assert.equal(ns.downloadMeta.dQw4w9WgXcQ.releaseDate, Date.UTC(2023, 5, 15));
  assert.equal(ns.downloadMeta.dQw4w9WgXcQ.channelAvatarUrl, 'https://yt3.ggpht.com/avatar123');

  const consumed = store.consumeDownloadChannelMeta(deps.loadDatabase(), 'dQw4w9WgXcQ');
  assert.equal(consumed.releaseDate, Date.UTC(2023, 5, 15));
  assert.equal(consumed.channelAvatarUrl, 'https://yt3.ggpht.com/avatar123');
});

test('consumeDownloadChannelMeta: re-validates a persisted channelAvatarUrl -- a somehow-corrupted entry with a hostile scheme is dropped from the result (still consumed)', () => {
  const db = {};
  store.ensureYtdlp(db).downloadMeta.dQw4w9WgXcQ = {
    channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channelAvatarUrl: 'javascript:alert(1)',
    capturedAt: Date.now(),
  };
  const result = store.consumeDownloadChannelMeta(db, 'dQw4w9WgXcQ');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'channelAvatarUrl'), false);
  assert.equal(db.ytdlp.downloadMeta.dQw4w9WgXcQ, undefined, 'still consumed regardless of the re-validation outcome');
});

test('consumeDownloadChannelMeta: re-validates a persisted releaseDate -- an out-of-bounds/non-finite value is dropped from the result', () => {
  const db = {};
  store.ensureYtdlp(db).downloadMeta.dQw4w9WgXcQ = {
    channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    releaseDate: Infinity,
    capturedAt: Date.now(),
  };
  const result = store.consumeDownloadChannelMeta(db, 'dQw4w9WgXcQ');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'releaseDate'), false);
});

test('consumeDownloadChannelMeta: an entry with no releaseDate/channelAvatarUrl at all round-trips exactly as before C5/C6 (no new keys added)', () => {
  const db = {};
  store.ensureYtdlp(db).downloadMeta.dQw4w9WgXcQ = {
    channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channelName: 'Rick Astley',
    capturedAt: Date.now(),
  };
  const result = store.consumeDownloadChannelMeta(db, 'dQw4w9WgXcQ');
  assert.deepEqual(result, {
    channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
    channelName: 'Rick Astley',
  });
});

// ---- v1.24.0 C6: recordSubscriptionChannelAvatar ---------------------------

test('recordSubscriptionChannelAvatar: sets channelAvatarUrl on the matching subscription by channelUrl', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@somechannel', format: 'video' });
  const changed = await store.recordSubscriptionChannelAvatar(deps, 'https://www.youtube.com/@somechannel', 'https://yt3.ggpht.com/avatar123');
  assert.equal(changed, true);
  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.id, sub.id);
  assert.equal(persisted.channelAvatarUrl, 'https://yt3.ggpht.com/avatar123');
});

test('recordSubscriptionChannelAvatar: OVERWRITES a previously captured avatar with a newer one', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@somechannel', format: 'video' });
  await store.recordSubscriptionChannelAvatar(deps, 'https://www.youtube.com/@somechannel', 'https://yt3.ggpht.com/old');
  const changed = await store.recordSubscriptionChannelAvatar(deps, 'https://www.youtube.com/@somechannel', 'https://yt3.ggpht.com/new');
  assert.equal(changed, true);
  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.channelAvatarUrl, 'https://yt3.ggpht.com/new');
});

test('recordSubscriptionChannelAvatar: a no-match channelUrl is a silent no-op, never throws', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@somechannel', format: 'video' });
  const changed = await store.recordSubscriptionChannelAvatar(deps, 'https://www.youtube.com/@no-such-channel', 'https://yt3.ggpht.com/avatar123');
  assert.equal(changed, false);
  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.channelAvatarUrl, undefined);
});

test('recordSubscriptionChannelAvatar: a HOSTILE avatarUrl (javascript: scheme) is rejected, resolves false, nothing written', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@somechannel', format: 'video' });
  const changed = await store.recordSubscriptionChannelAvatar(deps, 'https://www.youtube.com/@somechannel', 'javascript:alert(1)');
  assert.equal(changed, false);
  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.channelAvatarUrl, undefined);
});

test('recordSubscriptionChannelAvatar: setting the SAME already-current avatar again is a no-op (resolves false)', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@somechannel', format: 'video' });
  await store.recordSubscriptionChannelAvatar(deps, 'https://www.youtube.com/@somechannel', 'https://yt3.ggpht.com/avatar123');
  const changedAgain = await store.recordSubscriptionChannelAvatar(deps, 'https://www.youtube.com/@somechannel', 'https://yt3.ggpht.com/avatar123');
  assert.equal(changedAgain, false);
});

// ---- v1.25.x QoL bugfix: recordSubscriptionChannelId (finally giving subs --
// a stable id -- the root-cause fix for the dead sub.channelId field) -------

test('recordSubscriptionChannelId: sets channelId on the matching subscription by channelUrl (previously permanently dead)', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@somechannel', format: 'video' });
  assert.equal(sub.channelId, undefined, 'sanity: addSubscription never writes channelId -- this is the confirmed root cause');
  const changed = await store.recordSubscriptionChannelId(deps, 'https://www.youtube.com/@somechannel', mkChannelId('recordid'));
  assert.equal(changed, true);
  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.channelId, mkChannelId('recordid'));
});

test('recordSubscriptionChannelId: write-once -- never overwrites an already-set channelId (unlike recordSubscriptionChannelAvatar)', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@somechannel', format: 'video' });
  await store.recordSubscriptionChannelId(deps, 'https://www.youtube.com/@somechannel', mkChannelId('first'));
  const changedAgain = await store.recordSubscriptionChannelId(deps, 'https://www.youtube.com/@somechannel', mkChannelId('second'));
  assert.equal(changedAgain, false);
  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.channelId, mkChannelId('first'), 'the FIRST recorded channelId must never be reassigned');
});

test('recordSubscriptionChannelId: rejects an invalid channelId (wrong shape), a no-match channelUrl -- silent no-op, never throws', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@somechannel', format: 'video' });
  assert.equal(await store.recordSubscriptionChannelId(deps, 'https://www.youtube.com/@somechannel', 'not-a-real-id'), false);
  assert.equal(await store.recordSubscriptionChannelId(deps, 'https://www.youtube.com/@no-such-channel', mkChannelId('nomatch')), false);
  const [persisted] = store.listSubscriptions(deps);
  assert.equal(persisted.channelId, undefined);
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

// ---- v1.24.0 B4 (FR-8): `order` field backfill + reduceReorder/reorderSubscriptions ----

test('ensureYtdlp: backfills order by current array index on legacy subscriptions lacking the field', () => {
  const legacyA = { id: 'legacy-a', channelUrl: 'https://www.youtube.com/@a', name: 'A', format: 'video', quality: 'best', addedAt: '2020-01-01T00:00:00.000Z', lastCheckedAt: null, lastStatus: null };
  const legacyB = { id: 'legacy-b', channelUrl: 'https://www.youtube.com/@b', name: 'B', format: 'video', quality: 'best', addedAt: '2020-01-02T00:00:00.000Z', lastCheckedAt: null, lastStatus: null };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [legacyA, legacyB] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.subscriptions[0].order, 0);
  assert.equal(ns.subscriptions[1].order, 1);
});

test('ensureYtdlp: order backfill is non-destructive -- an already-integer order is left untouched even if it does not match array position', () => {
  const sub = { id: 'modern-order', channelUrl: 'https://www.youtube.com/@modernorder', name: 'Modern', format: 'video', quality: 'best', addedAt: '2026-01-01T00:00:00.000Z', lastCheckedAt: null, lastStatus: null, order: 42 };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [sub] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.subscriptions[0].order, 42);
});

test('ensureYtdlp: re-backfills a present-but-non-integer (corrupt) order value rather than trusting it', () => {
  const sub = { id: 'corrupt-order', channelUrl: 'https://www.youtube.com/@corrupt', name: 'Corrupt', format: 'video', quality: 'best', addedAt: '2020-01-01T00:00:00.000Z', lastCheckedAt: null, lastStatus: null, order: 'not-a-number' };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [sub] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.subscriptions[0].order, 0);
});

test('addSubscription: assigns order = the tail position (current length) to a newly-added subscription', async () => {
  const deps = makeFakeDeps();
  const first = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@ordfirst', format: 'video' });
  const second = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@ordsecond', format: 'video' });
  assert.equal(first.order, 0);
  assert.equal(second.order, 1);
});

test('addSubscription: a new subscription always sorts LAST even after deletions left gaps in order (regression)', async () => {
  // Reproduction: add A,B,C,D (order 0-3) -> delete B,C (order gap: a=0,
  // d=3) -> add E. Before the fix, E.order was `ns.subscriptions.length`
  // (2 at this point), landing E BETWEEN a and d (A, E, D) instead of last.
  const deps = makeFakeDeps();
  const a = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@gapa', format: 'video' });
  const b = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@gapb', format: 'video' });
  const c = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@gapc', format: 'video' });
  const d = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@gapd', format: 'video' });
  await store.deleteSubscription(deps, b.id);
  await store.deleteSubscription(deps, c.id);
  const e = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@gape', format: 'video' });
  assert.ok(e.order > d.order, 'a newly-added subscription must always sort after every surviving one, even across a gapped order sequence');
  const list = store.listSubscriptions(deps);
  assert.deepEqual(list.map((s) => s.id), [a.id, d.id, e.id], 'E must render LAST, with A and D retaining their relative order');
});

test('listSubscriptions: returns subscriptions sorted by order ascending, regardless of underlying array/insertion order', () => {
  const subA = { id: 'a', channelUrl: 'https://www.youtube.com/@a', name: 'A', format: 'video', quality: 'best', addedAt: '2020-01-01T00:00:00.000Z', lastCheckedAt: null, lastStatus: null, order: 2 };
  const subB = { id: 'b', channelUrl: 'https://www.youtube.com/@b', name: 'B', format: 'video', quality: 'best', addedAt: '2020-01-02T00:00:00.000Z', lastCheckedAt: null, lastStatus: null, order: 0 };
  const subC = { id: 'c', channelUrl: 'https://www.youtube.com/@c', name: 'C', format: 'video', quality: 'best', addedAt: '2020-01-03T00:00:00.000Z', lastCheckedAt: null, lastStatus: null, order: 1 };
  // Insertion order is A, B, C -- but `order` says B, C, A.
  const deps = makeFakeDeps({ ytdlp: { allowMembersOnly: false, subscriptions: [subA, subB, subC] } });
  const list = store.listSubscriptions(deps);
  assert.deepEqual(list.map((s) => s.id), ['b', 'c', 'a']);
});

test('listSubscriptions: never mutates the underlying db.ytdlp.subscriptions array order', () => {
  const subA = { id: 'a', order: 1 };
  const subB = { id: 'b', order: 0 };
  const deps = makeFakeDeps({ ytdlp: { allowMembersOnly: false, subscriptions: [subA, subB] } });
  store.listSubscriptions(deps);
  const db = deps.loadDatabase();
  assert.deepEqual(db.ytdlp.subscriptions.map((s) => s.id), ['a', 'b'], 'a read must never reorder the persisted array itself');
});

test('reduceReorder: assigns order = position for every id present in orderedIds', () => {
  const subs = [
    { id: 'a', order: 0 },
    { id: 'b', order: 1 },
    { id: 'c', order: 2 },
  ];
  const result = store.reduceReorder(subs, ['c', 'a', 'b']);
  assert.equal(result.find((s) => s.id === 'c').order, 0);
  assert.equal(result.find((s) => s.id === 'a').order, 1);
  assert.equal(result.find((s) => s.id === 'b').order, 2);
});

test('reduceReorder: ignores unknown ids in orderedIds -- they never create phantom entries or shift real positions', () => {
  const subs = [
    { id: 'a', order: 0 },
    { id: 'b', order: 1 },
  ];
  const result = store.reduceReorder(subs, ['b', 'no-such-id', 'a']);
  assert.equal(result.length, 2, 'an unknown id must never add an entry to the result');
  assert.equal(result.find((s) => s.id === 'b').order, 0);
  assert.equal(result.find((s) => s.id === 'a').order, 1);
});

test('reduceReorder: ids missing from orderedIds keep tail order, in their original relative order', () => {
  const subs = [
    { id: 'a', order: 0 },
    { id: 'b', order: 1 },
    { id: 'c', order: 2 },
    { id: 'd', order: 3 },
  ];
  // Only 'c' is explicitly reordered to the front; b/a/d never appear.
  const result = store.reduceReorder(subs, ['c']);
  assert.equal(result.find((s) => s.id === 'c').order, 0, 'the explicitly-ordered id gets position 0');
  // Tail keeps ORIGINAL relative order (a, b, d), not orderedIds order.
  assert.equal(result.find((s) => s.id === 'a').order, 1);
  assert.equal(result.find((s) => s.id === 'b').order, 2);
  assert.equal(result.find((s) => s.id === 'd').order, 3);
});

test('reduceReorder: a duplicate id in orderedIds is only honored on its first occurrence', () => {
  const subs = [
    { id: 'a', order: 0 },
    { id: 'b', order: 1 },
  ];
  const result = store.reduceReorder(subs, ['b', 'b', 'a']);
  assert.equal(result.find((s) => s.id === 'b').order, 0);
  assert.equal(result.find((s) => s.id === 'a').order, 1);
});

test('reduceReorder: an empty orderedIds is a pure identity re-numbering by existing array order', () => {
  const subs = [
    { id: 'a', order: 5 },
    { id: 'b', order: 9 },
  ];
  const result = store.reduceReorder(subs, []);
  assert.equal(result.find((s) => s.id === 'a').order, 0);
  assert.equal(result.find((s) => s.id === 'b').order, 1);
});

test('reduceReorder: never mutates its input array or subscription objects', () => {
  const subA = Object.freeze({ id: 'a', order: 0 });
  const subB = Object.freeze({ id: 'b', order: 1 });
  const input = Object.freeze([subA, subB]);
  assert.doesNotThrow(() => store.reduceReorder(input, ['b', 'a']));
  assert.equal(subA.order, 0, 'the original object must be untouched');
  assert.equal(subB.order, 1, 'the original object must be untouched');
});

test('reduceReorder: defends against a non-array orderedIds by falling back to identity re-numbering', () => {
  const subs = [{ id: 'a', order: 0 }, { id: 'b', order: 1 }];
  assert.doesNotThrow(() => store.reduceReorder(subs, undefined));
  assert.doesNotThrow(() => store.reduceReorder(subs, 'not-an-array'));
  const result = store.reduceReorder(subs, null);
  assert.equal(result.find((s) => s.id === 'a').order, 0);
  assert.equal(result.find((s) => s.id === 'b').order, 1);
});

test('reorderSubscriptions: persists the new order so a subsequent listSubscriptions reflects it', async () => {
  const deps = makeFakeDeps();
  const first = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@reordone', format: 'video' });
  const second = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@reordtwo', format: 'video' });
  assert.deepEqual(store.listSubscriptions(deps).map((s) => s.id), [first.id, second.id]);
  await store.reorderSubscriptions(deps, [second.id, first.id]);
  assert.deepEqual(store.listSubscriptions(deps).map((s) => s.id), [second.id, first.id]);
});

test('reorderSubscriptions: never writes into db.folders/db.folderSettings (structural regression lock)', async () => {
  const deps = makeFakeDeps({ folders: ['/movies'], folderSettings: { '/movies': { name: 'Movies' } } });
  const first = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@reordguarda', format: 'video' });
  const second = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@reordguardb', format: 'video' });
  await store.reorderSubscriptions(deps, [second.id, first.id]);
  const db = deps.loadDatabase();
  assert.deepEqual(db.folders, ['/movies'], 'db.folders must be byte-identical -- reorder never touches it');
  assert.deepEqual(db.folderSettings, { '/movies': { name: 'Movies' } }, 'db.folderSettings must be byte-identical -- reorder never touches it');
});

// ---- v1.24.3: pinned-channel `order` field backfill + reducePinReorder/reorderPins ----

test('ensureYtdlp: backfills pin order by current array index on legacy pins lacking the field', () => {
  const legacyA = { id: 'legacy-pin-a', channelDir: '/d/a', label: 'A', pinnedAt: '2020-01-01T00:00:00.000Z' };
  const legacyB = { id: 'legacy-pin-b', channelDir: '/d/b', label: 'B', pinnedAt: '2020-01-02T00:00:00.000Z' };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [], pins: [legacyA, legacyB] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.pins[0].order, 0);
  assert.equal(ns.pins[1].order, 1);
});

test('ensureYtdlp: pin order backfill is non-destructive -- an already-integer order is left untouched even if it does not match array position', () => {
  const pin = { id: 'modern-pin', channelDir: '/d/modern', label: 'Modern', pinnedAt: '2026-01-01T00:00:00.000Z', order: 42 };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [], pins: [pin] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.pins[0].order, 42);
});

test('ensureYtdlp: re-backfills a present-but-non-integer (corrupt) pin order value rather than trusting it', () => {
  const pin = { id: 'corrupt-pin', channelDir: '/d/corrupt', label: 'Corrupt', pinnedAt: '2020-01-01T00:00:00.000Z', order: 'not-a-number' };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [], pins: [pin] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.pins[0].order, 0);
});

test('reduceAddPin: assigns order = the tail position (current length) to a newly-added pin', () => {
  const first = store.reduceAddPin([], { id: 'p1', channelDir: '/d/1', label: '1', pinnedAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(first.record.order, 0);
  const second = store.reduceAddPin(first.pins, { id: 'p2', channelDir: '/d/2', label: '2', pinnedAt: '2020-01-02T00:00:00.000Z' });
  assert.equal(second.record.order, 1);
});

test('reduceAddPin: a new pin always sorts LAST even after a removal left gaps in order (regression, mirrors addSubscription\'s own order-gap fix)', () => {
  // Reproduction: add A,B,C,D (order 0-3) -> unpin B,C (order gap: a=0, d=3)
  // -> add E. Using `list.length` for the new order (2 at this point) would
  // land E BETWEEN a and d (A, E, D) instead of last.
  let pins = [];
  pins = store.reduceAddPin(pins, { id: 'a', channelDir: '/d/a', label: 'A', pinnedAt: '2020-01-01T00:00:00.000Z' }).pins;
  pins = store.reduceAddPin(pins, { id: 'b', channelDir: '/d/b', label: 'B', pinnedAt: '2020-01-02T00:00:00.000Z' }).pins;
  pins = store.reduceAddPin(pins, { id: 'c', channelDir: '/d/c', label: 'C', pinnedAt: '2020-01-03T00:00:00.000Z' }).pins;
  pins = store.reduceAddPin(pins, { id: 'd', channelDir: '/d/d', label: 'D', pinnedAt: '2020-01-04T00:00:00.000Z' }).pins;
  pins = store.reduceRemovePin(pins, 'b').pins;
  pins = store.reduceRemovePin(pins, 'c').pins;
  const eResult = store.reduceAddPin(pins, { id: 'e', channelDir: '/d/e', label: 'E', pinnedAt: '2020-01-05T00:00:00.000Z' });
  const dOrder = eResult.pins.find((p) => p.id === 'd').order;
  assert.ok(eResult.record.order > dOrder, 'a newly-added pin must always sort after every surviving one, even across a gapped order sequence');
});

test('listPins: returns pins sorted by order ascending, regardless of underlying array/insertion order', () => {
  const pinA = { id: 'a', channelDir: '/d/a', label: 'A', pinnedAt: '2020-01-01T00:00:00.000Z', order: 2 };
  const pinB = { id: 'b', channelDir: '/d/b', label: 'B', pinnedAt: '2020-01-02T00:00:00.000Z', order: 0 };
  const pinC = { id: 'c', channelDir: '/d/c', label: 'C', pinnedAt: '2020-01-03T00:00:00.000Z', order: 1 };
  // Insertion order is A, B, C -- but `order` says B, C, A.
  const deps = makeFakeDeps({ ytdlp: { allowMembersOnly: false, subscriptions: [], pins: [pinA, pinB, pinC] } });
  const list = store.listPins(deps);
  assert.deepEqual(list.map((p) => p.id), ['b', 'c', 'a']);
});

test('listPins: never mutates the underlying db.ytdlp.pins array order', () => {
  const pinA = { id: 'a', channelDir: '/d/a', order: 1 };
  const pinB = { id: 'b', channelDir: '/d/b', order: 0 };
  const deps = makeFakeDeps({ ytdlp: { allowMembersOnly: false, subscriptions: [], pins: [pinA, pinB] } });
  store.listPins(deps);
  const db = deps.loadDatabase();
  assert.deepEqual(db.ytdlp.pins.map((p) => p.id), ['a', 'b'], 'a read must never reorder the persisted array itself');
});

test('reducePinReorder: assigns order = position for every id present in orderedIds', () => {
  const pins = [
    { id: 'a', channelDir: '/d/a', order: 0 },
    { id: 'b', channelDir: '/d/b', order: 1 },
    { id: 'c', channelDir: '/d/c', order: 2 },
  ];
  const result = store.reducePinReorder(pins, ['c', 'a', 'b']);
  assert.equal(result.find((p) => p.id === 'c').order, 0);
  assert.equal(result.find((p) => p.id === 'a').order, 1);
  assert.equal(result.find((p) => p.id === 'b').order, 2);
});

test('reducePinReorder: ignores unknown ids in orderedIds -- they never create phantom entries or shift real positions', () => {
  const pins = [
    { id: 'a', channelDir: '/d/a', order: 0 },
    { id: 'b', channelDir: '/d/b', order: 1 },
  ];
  const result = store.reducePinReorder(pins, ['b', 'no-such-id', 'a']);
  assert.equal(result.length, 2, 'an unknown id must never add an entry to the result');
  assert.equal(result.find((p) => p.id === 'b').order, 0);
  assert.equal(result.find((p) => p.id === 'a').order, 1);
});

test('reducePinReorder: ids missing from orderedIds keep tail order, in their original relative order', () => {
  const pins = [
    { id: 'a', channelDir: '/d/a', order: 0 },
    { id: 'b', channelDir: '/d/b', order: 1 },
    { id: 'c', channelDir: '/d/c', order: 2 },
    { id: 'd', channelDir: '/d/d', order: 3 },
  ];
  // Only 'c' is explicitly reordered to the front; b/a/d never appear.
  const result = store.reducePinReorder(pins, ['c']);
  assert.equal(result.find((p) => p.id === 'c').order, 0, 'the explicitly-ordered id gets position 0');
  // Tail keeps ORIGINAL relative order (a, b, d), not orderedIds order.
  assert.equal(result.find((p) => p.id === 'a').order, 1);
  assert.equal(result.find((p) => p.id === 'b').order, 2);
  assert.equal(result.find((p) => p.id === 'd').order, 3);
});

test('reducePinReorder: a duplicate id in orderedIds is only honored on its first occurrence', () => {
  const pins = [
    { id: 'a', channelDir: '/d/a', order: 0 },
    { id: 'b', channelDir: '/d/b', order: 1 },
  ];
  const result = store.reducePinReorder(pins, ['b', 'b', 'a']);
  assert.equal(result.find((p) => p.id === 'b').order, 0);
  assert.equal(result.find((p) => p.id === 'a').order, 1);
});

test('reducePinReorder: an empty orderedIds is a pure identity re-numbering by existing array order', () => {
  const pins = [
    { id: 'a', channelDir: '/d/a', order: 5 },
    { id: 'b', channelDir: '/d/b', order: 9 },
  ];
  const result = store.reducePinReorder(pins, []);
  assert.equal(result.find((p) => p.id === 'a').order, 0);
  assert.equal(result.find((p) => p.id === 'b').order, 1);
});

test('reducePinReorder: never mutates its input array or pin objects', () => {
  const pinA = Object.freeze({ id: 'a', channelDir: '/d/a', order: 0 });
  const pinB = Object.freeze({ id: 'b', channelDir: '/d/b', order: 1 });
  const input = Object.freeze([pinA, pinB]);
  assert.doesNotThrow(() => store.reducePinReorder(input, ['b', 'a']));
  assert.equal(pinA.order, 0, 'the original object must be untouched');
  assert.equal(pinB.order, 1, 'the original object must be untouched');
});

test('reducePinReorder: defends against a non-array orderedIds by falling back to identity re-numbering', () => {
  const pins = [{ id: 'a', channelDir: '/d/a', order: 0 }, { id: 'b', channelDir: '/d/b', order: 1 }];
  assert.doesNotThrow(() => store.reducePinReorder(pins, undefined));
  assert.doesNotThrow(() => store.reducePinReorder(pins, 'not-an-array'));
  const result = store.reducePinReorder(pins, null);
  assert.equal(result.find((p) => p.id === 'a').order, 0);
  assert.equal(result.find((p) => p.id === 'b').order, 1);
});

test('reorderPins: persists the new order so a subsequent listPins reflects it', async () => {
  const deps = makeFakeDeps();
  const first = await store.addPin(deps, { channelDir: '/data/ytdlp-downloads/First', label: 'First' });
  const second = await store.addPin(deps, { channelDir: '/data/ytdlp-downloads/Second', label: 'Second' });
  assert.deepEqual(store.listPins(deps).map((p) => p.id), [first.id, second.id]);
  await store.reorderPins(deps, [second.id, first.id]);
  assert.deepEqual(store.listPins(deps).map((p) => p.id), [second.id, first.id]);
});

test('reorderPins: never writes into db.folders/db.folderSettings (structural regression lock)', async () => {
  const deps = makeFakeDeps({ folders: ['/movies'], folderSettings: { '/movies': { name: 'Movies' } } });
  const first = await store.addPin(deps, { channelDir: '/data/ytdlp-downloads/GuardA', label: 'GuardA' });
  const second = await store.addPin(deps, { channelDir: '/data/ytdlp-downloads/GuardB', label: 'GuardB' });
  await store.reorderPins(deps, [second.id, first.id]);
  const db = deps.loadDatabase();
  assert.deepEqual(db.folders, ['/movies'], 'db.folders must be byte-identical -- pin reorder never touches it');
  assert.deepEqual(db.folderSettings, { '/movies': { name: 'Movies' } }, 'db.folderSettings must be byte-identical -- pin reorder never touches it');
});

// ---- v1.25 QoL (T1): per-subscription download `cutoffDate` (schema only) --
//
// Replaces the old "download last N videos" model with a per-subscription
// cutoff DATE (`--dateafter`, wired in a later task, T2); this file only adds
// the schema + validators + migration. Test posture mirrors `maxVideos`/
// `maxDurationSeconds` above throughout.

test('validateCutoffDate: accepts undefined (unset)', () => {
  assert.deepEqual(store.validateCutoffDate(undefined), { ok: true, value: undefined });
});

test('validateCutoffDate: accepts a valid YYYYMMDD string, unchanged', () => {
  assert.deepEqual(store.validateCutoffDate('20260101'), { ok: true, value: '20260101' });
});

test('validateCutoffDate: rejects a malformed/non-8-digit string', () => {
  assert.equal(store.validateCutoffDate('2026-01-01').ok, false);
  assert.equal(store.validateCutoffDate('2026101').ok, false); // 7 digits
  assert.equal(store.validateCutoffDate('202601011').ok, false); // 9 digits
  assert.equal(store.validateCutoffDate('').ok, false);
});

test('validateCutoffDate: rejects an impossible calendar date and an implausible year', () => {
  assert.equal(store.validateCutoffDate('20230230').ok, false, 'Feb 30 does not exist');
  assert.equal(store.validateCutoffDate('19990101').ok, false, 'before the ~2000 floor');
  assert.equal(store.validateCutoffDate('29990101').ok, false, 'implausibly far in the future');
});

test('validateCutoffDate: rejects a non-string value', () => {
  assert.equal(store.validateCutoffDate(20260101).ok, false);
  assert.equal(store.validateCutoffDate(null).ok, false);
  assert.equal(store.validateCutoffDate({}).ok, false);
});

test('validateSubscriptionInput: accepts a valid cutoffDate and passes it through unchanged', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@cutoffpass', cutoffDate: '20250601' });
  assert.equal(result.ok, true);
  assert.equal(result.value.cutoffDate, '20250601');
});

test('validateSubscriptionInput: accepts unset cutoffDate (stays undefined)', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@cutoffunset' });
  assert.equal(result.ok, true);
  assert.equal(result.value.cutoffDate, undefined);
});

test('validateSubscriptionInput: rejects an invalid cutoffDate', () => {
  const result = store.validateSubscriptionInput({ channelUrl: 'https://www.youtube.com/@cutoffreject', cutoffDate: '20230230' });
  assert.equal(result.ok, false);
});

test('addSubscription: no cutoffDate supplied defaults to YESTERDAY, deterministic via an injected nowMs', async () => {
  const deps = makeFakeDeps();
  const nowMs = Date.UTC(2026, 6, 10); // 2026-07-10T00:00:00Z
  const record = await store.addSubscription(
    deps,
    { channelUrl: 'https://www.youtube.com/@cutoffdefault', format: 'video' },
    nowMs
  );
  assert.equal(record.cutoffDate, '20260709');
});

test('addSubscription: an explicit valid cutoffDate is stored as-is, not overridden by the yesterday default', async () => {
  const deps = makeFakeDeps();
  const nowMs = Date.UTC(2026, 6, 10);
  const record = await store.addSubscription(
    deps,
    { channelUrl: 'https://www.youtube.com/@cutoffset', format: 'video', cutoffDate: '20250601' },
    nowMs
  );
  assert.equal(record.cutoffDate, '20250601');
});

test('updateSubscription: can patch cutoffDate independent of other fields', async () => {
  const deps = makeFakeDeps();
  const added = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@cutoffpatch', format: 'video', cutoffDate: '20250601' });
  const updated = await store.updateSubscription(deps, added.id, { cutoffDate: '20250701' });
  assert.equal(updated.cutoffDate, '20250701');
  assert.equal(updated.format, 'video');
});

test('updateSubscription: an invalid cutoffDate within the patch is defensively ignored rather than corrupting the record', async () => {
  const deps = makeFakeDeps();
  const added = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@cutoffguard', format: 'video', cutoffDate: '20250601' });
  const result = await store.updateSubscription(deps, added.id, { cutoffDate: '20230230' });
  assert.equal(result.cutoffDate, '20250601', 'an invalid cutoffDate in the patch must not overwrite the existing value');
});

test('ensureYtdlp: backfills cutoffDate to the DATE portion of lastCheckedAt when present', () => {
  const legacySub = { id: 'legacy-cutoff-checked', channelUrl: 'https://www.youtube.com/@legacychecked', name: 'Legacy', format: 'video', quality: 'best', addedAt: '2020-01-01T00:00:00.000Z', lastCheckedAt: '2026-03-15T08:00:00.000Z', lastStatus: 'ok' };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [legacySub] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.subscriptions[0].cutoffDate, '20260315');
});

test('ensureYtdlp: backfills cutoffDate to the DATE portion of addedAt when lastCheckedAt is absent', () => {
  const legacySub = { id: 'legacy-cutoff-added', channelUrl: 'https://www.youtube.com/@legacyadded', name: 'Legacy', format: 'video', quality: 'best', addedAt: '2021-06-20T00:00:00.000Z', lastCheckedAt: null, lastStatus: null };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [legacySub] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.subscriptions[0].cutoffDate, '20210620');
});

test('ensureYtdlp: backfills cutoffDate to YESTERDAY when neither lastCheckedAt nor addedAt is a usable date', () => {
  const corruptSub = { id: 'legacy-cutoff-neither', channelUrl: 'https://www.youtube.com/@legacyneither', name: 'Legacy', format: 'video', quality: 'best', addedAt: 'not-a-date', lastCheckedAt: null, lastStatus: null };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [corruptSub] } };
  const nowMs = Date.UTC(2026, 6, 10); // 2026-07-10T00:00:00Z
  const ns = store.ensureYtdlp(db, nowMs);
  assert.equal(ns.subscriptions[0].cutoffDate, '20260709');
});

test('ensureYtdlp: an already-set, valid cutoffDate is never overwritten (idempotent, mirrors paused/skipShorts/order)', () => {
  const modernSub = { id: 'modern-cutoff', channelUrl: 'https://www.youtube.com/@moderncutoff', name: 'Modern', format: 'video', quality: 'best', addedAt: '2026-01-01T00:00:00.000Z', lastCheckedAt: '2026-06-01T00:00:00.000Z', lastStatus: null, cutoffDate: '20200101' };
  const db = { ytdlp: { allowMembersOnly: false, subscriptions: [modernSub] } };
  const ns = store.ensureYtdlp(db);
  assert.equal(ns.subscriptions[0].cutoffDate, '20200101');
});

// ---- v1.25 QoL bugfix: selectChannelAvatarUrl -----------------------------
//
// The REAL `thumbnails[]` array a live yt-dlp (2026.07.04) `--dump-single-json
// --playlist-items 0` returned for an actual channel (BlueJay,
// /channel/<id> form) -- a mix of wide banner crops (ids "0"-"5"/
// "banner_uncropped") and the real avatar (a sized 900x900 square, id "7",
// plus the full-res "avatar_uncropped" fallback).
const REAL_CHANNEL_THUMBNAILS_BLUEJAY = [
  { url: 'https://yt3.googleusercontent.com/HHgKRdNH6SWlCqxQ2aT6io-yd1f4ambPHm3Ox39UC5sUjOeIanNWsSfNIzNBGBY6bZYqKo_Fag=w1060-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj', height: 175, width: 1060, preference: -10, id: '0', resolution: '1060x175' },
  { url: 'https://yt3.googleusercontent.com/HHgKRdNH6SWlCqxQ2aT6io-yd1f4ambPHm3Ox39UC5sUjOeIanNWsSfNIzNBGBY6bZYqKo_Fag=w1138-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj', height: 188, width: 1138, preference: -10, id: '1', resolution: '1138x188' },
  { url: 'https://yt3.googleusercontent.com/HHgKRdNH6SWlCqxQ2aT6io-yd1f4ambPHm3Ox39UC5sUjOeIanNWsSfNIzNBGBY6bZYqKo_Fag=w1707-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj', height: 283, width: 1707, preference: -10, id: '2', resolution: '1707x283' },
  { url: 'https://yt3.googleusercontent.com/HHgKRdNH6SWlCqxQ2aT6io-yd1f4ambPHm3Ox39UC5sUjOeIanNWsSfNIzNBGBY6bZYqKo_Fag=w2120-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj', height: 351, width: 2120, preference: -10, id: '3', resolution: '2120x351' },
  { url: 'https://yt3.googleusercontent.com/HHgKRdNH6SWlCqxQ2aT6io-yd1f4ambPHm3Ox39UC5sUjOeIanNWsSfNIzNBGBY6bZYqKo_Fag=w2276-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj', height: 377, width: 2276, preference: -10, id: '4', resolution: '2276x377' },
  { url: 'https://yt3.googleusercontent.com/HHgKRdNH6SWlCqxQ2aT6io-yd1f4ambPHm3Ox39UC5sUjOeIanNWsSfNIzNBGBY6bZYqKo_Fag=w2560-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj', height: 424, width: 2560, preference: -10, id: '5', resolution: '2560x424' },
  { url: 'https://yt3.googleusercontent.com/HHgKRdNH6SWlCqxQ2aT6io-yd1f4ambPHm3Ox39UC5sUjOeIanNWsSfNIzNBGBY6bZYqKo_Fag=s0', id: 'banner_uncropped', preference: -5 },
  { url: 'https://yt3.googleusercontent.com/ytc/AIdro_mtE0wtRYXirpEWGKtJ_mK85JBizT2WktAw6QBpDsz-OA=s900-c-k-c0x00ffffff-no-rj', height: 900, width: 900, id: '7', resolution: '900x900' },
  { url: 'https://yt3.googleusercontent.com/ytc/AIdro_mtE0wtRYXirpEWGKtJ_mK85JBizT2WktAw6QBpDsz-OA=s0', id: 'avatar_uncropped', preference: 1 },
];
const REAL_CHANNEL_AVATAR_URL_BLUEJAY = 'https://yt3.googleusercontent.com/ytc/AIdro_mtE0wtRYXirpEWGKtJ_mK85JBizT2WktAw6QBpDsz-OA=s900-c-k-c0x00ffffff-no-rj';

// Same shape, from a REAL @handle channel (Mental Outlaw) -- proves the
// heuristic is not tied to the /channel/<id> URL form.
const REAL_CHANNEL_THUMBNAILS_HANDLE = [
  { url: 'https://yt3.googleusercontent.com/oNt0NdpBp_fCt58T2r2cpwhzRERNoCFRLKJUmNAB4r1kpPWJd4WX_GjHIj4mKn-rtISHTwkve4k=w1060-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj', height: 175, width: 1060, preference: -10, id: '0', resolution: '1060x175' },
  { url: 'https://yt3.googleusercontent.com/oNt0NdpBp_fCt58T2r2cpwhzRERNoCFRLKJUmNAB4r1kpPWJd4WX_GjHIj4mKn-rtISHTwkve4k=s0', id: 'banner_uncropped', preference: -5 },
  { url: 'https://yt3.googleusercontent.com/ytc/AIdro_n6dUcc6YbkWa540dbaWzbLi44bq0h-hGNEop2BhOQ6uHY=s900-c-k-c0x00ffffff-no-rj', height: 900, width: 900, id: '7', resolution: '900x900' },
  { url: 'https://yt3.googleusercontent.com/ytc/AIdro_n6dUcc6YbkWa540dbaWzbLi44bq0h-hGNEop2BhOQ6uHY=s0', id: 'avatar_uncropped', preference: 1 },
];
const REAL_CHANNEL_AVATAR_URL_HANDLE = 'https://yt3.googleusercontent.com/ytc/AIdro_n6dUcc6YbkWa540dbaWzbLi44bq0h-hGNEop2BhOQ6uHY=s900-c-k-c0x00ffffff-no-rj';

// The REAL `thumbnails[]` array from a per-VIDEO `--dump-json` (never
// square -- every entry is a 4:3/16:9 video-frame crop) -- proves the
// heuristic never mistakes a video's own thumbnails for a channel avatar.
const REAL_VIDEO_THUMBNAILS = [
  { url: 'https://i.ytimg.com/vi/6ZXsyDEfC64/default.jpg', height: 90, width: 120, preference: -13, id: '24', resolution: '120x90' },
  { url: 'https://i.ytimg.com/vi/6ZXsyDEfC64/mqdefault.jpg', height: 180, width: 320, preference: -11, id: '26', resolution: '320x180' },
  { url: 'https://i.ytimg.com/vi/6ZXsyDEfC64/hqdefault.jpg', height: 360, width: 480, preference: -7, id: '34', resolution: '480x360' },
  { url: 'https://i.ytimg.com/vi/6ZXsyDEfC64/sddefault.jpg', height: 480, width: 640, preference: -5, id: '36', resolution: '640x480' },
  { url: 'https://i.ytimg.com/vi/6ZXsyDEfC64/maxresdefault.jpg', height: 1080, width: 1920, preference: -1, id: '40', resolution: '1920x1080' },
];

test('selectChannelAvatarUrl: picks the largest SQUARE thumbnail (900x900), never a wide banner crop -- real BlueJay channel fixture', () => {
  assert.equal(store.selectChannelAvatarUrl(REAL_CHANNEL_THUMBNAILS_BLUEJAY), REAL_CHANNEL_AVATAR_URL_BLUEJAY);
});

test('selectChannelAvatarUrl: works identically for a REAL @handle channel fixture (Mental Outlaw)', () => {
  assert.equal(store.selectChannelAvatarUrl(REAL_CHANNEL_THUMBNAILS_HANDLE), REAL_CHANNEL_AVATAR_URL_HANDLE);
});

test('selectChannelAvatarUrl: a real per-VIDEO thumbnails array (no square entries, no avatar_uncropped) never yields a false-positive avatar', () => {
  assert.equal(store.selectChannelAvatarUrl(REAL_VIDEO_THUMBNAILS), null);
});

test('selectChannelAvatarUrl: falls back to avatar_uncropped when no sized square thumbnail survives', () => {
  const thumbnails = [
    { url: 'https://yt3.googleusercontent.com/wide-banner', height: 175, width: 1060, id: '0' },
    { url: 'https://yt3.googleusercontent.com/uncropped-fallback=s0', id: 'avatar_uncropped', preference: 1 },
  ];
  assert.equal(store.selectChannelAvatarUrl(thumbnails), 'https://yt3.googleusercontent.com/uncropped-fallback=s0');
});

test('selectChannelAvatarUrl: prefers the LARGEST square when more than one sized square variant is present', () => {
  const thumbnails = [
    { url: 'https://yt3.googleusercontent.com/small-square', height: 100, width: 100, id: 'a' },
    { url: 'https://yt3.googleusercontent.com/big-square', height: 900, width: 900, id: 'b' },
    { url: 'https://yt3.googleusercontent.com/mid-square', height: 512, width: 512, id: 'c' },
  ];
  assert.equal(store.selectChannelAvatarUrl(thumbnails), 'https://yt3.googleusercontent.com/big-square');
});

test('selectChannelAvatarUrl: returns null for empty/no-thumbnails/malformed input, never throws', () => {
  assert.equal(store.selectChannelAvatarUrl([]), null);
  assert.equal(store.selectChannelAvatarUrl(undefined), null);
  assert.equal(store.selectChannelAvatarUrl(null), null);
  assert.equal(store.selectChannelAvatarUrl('not-an-array'), null);
  assert.equal(store.selectChannelAvatarUrl([null, undefined, 42, { id: '0' }, { url: 123, width: 900, height: 900 }]), null);
});

test('selectChannelAvatarUrl: a malformed width/height pair (zero, negative, or mismatched types) is never mistaken for a square', () => {
  const thumbnails = [
    { url: 'https://yt3.googleusercontent.com/zero-square', height: 0, width: 0, id: 'z' },
    { url: 'https://yt3.googleusercontent.com/string-dims', height: '900', width: '900', id: 's' },
  ];
  assert.equal(store.selectChannelAvatarUrl(thumbnails), null);
});

// ---- v1.25 QoL bugfix: resolveItemChannelAvatarUrl (serve-time item join) --

test('resolveItemChannelAvatarUrl: an item whose channelUrl matches a subscription resolves that subscription\'s sanitized avatar', () => {
  const db = {
    ytdlp: {
      subscriptions: [
        { id: 'sub1', channelUrl: 'https://www.youtube.com/channel/UCabc', channelId: 'UCabc', channelAvatarUrl: 'https://yt3.ggpht.com/avatar1.jpg' },
      ],
    },
  };
  const item = { channelUrl: 'https://www.youtube.com/channel/UCabc' };
  assert.equal(store.resolveItemChannelAvatarUrl(db, item), 'https://yt3.ggpht.com/avatar1.jpg');
});

test('resolveItemChannelAvatarUrl: an item whose channelId matches (channelUrl differs/absent) still resolves via the id match', () => {
  const db = {
    ytdlp: {
      subscriptions: [
        { id: 'sub1', channelUrl: 'https://www.youtube.com/@somehandle', channelId: 'UCabc', channelAvatarUrl: 'https://yt3.ggpht.com/avatar1.jpg' },
      ],
    },
  };
  const item = { channelId: 'UCabc' };
  assert.equal(store.resolveItemChannelAvatarUrl(db, item), 'https://yt3.ggpht.com/avatar1.jpg');
});

test('resolveItemChannelAvatarUrl: no matching subscription resolves null (empty fallback, never throws)', () => {
  const db = { ytdlp: { subscriptions: [{ id: 'sub1', channelUrl: 'https://www.youtube.com/channel/UCother', channelAvatarUrl: 'https://yt3.ggpht.com/avatar1.jpg' }] } };
  assert.equal(store.resolveItemChannelAvatarUrl(db, { channelUrl: 'https://www.youtube.com/channel/UCnomatch' }), null);
});

test('resolveItemChannelAvatarUrl: an item with no channelUrl/channelId at all resolves null without scanning subscriptions', () => {
  const db = { ytdlp: { subscriptions: [{ id: 'sub1', channelUrl: 'https://www.youtube.com/channel/UCabc', channelAvatarUrl: 'https://yt3.ggpht.com/avatar1.jpg' }] } };
  assert.equal(store.resolveItemChannelAvatarUrl(db, {}), null);
  assert.equal(store.resolveItemChannelAvatarUrl(db, null), null);
});

test('resolveItemChannelAvatarUrl: no db.ytdlp namespace at all (module never enabled) resolves null, never throws', () => {
  const db = {};
  assert.equal(store.resolveItemChannelAvatarUrl(db, { channelUrl: 'https://www.youtube.com/channel/UCabc' }), null);
});

test('resolveItemChannelAvatarUrl: a null/undefined db resolves null, never throws (defense-in-depth -- the "never throws" contract holds literally)', () => {
  assert.equal(store.resolveItemChannelAvatarUrl(null, { channelUrl: 'https://www.youtube.com/channel/UCabc' }), null);
  assert.equal(store.resolveItemChannelAvatarUrl(undefined, { channelUrl: 'https://www.youtube.com/channel/UCabc' }), null);
});

test('resolveItemChannelAvatarUrl: a matched subscription\'s HOSTILE/corrupted channelAvatarUrl (fails re-validation) is never returned', () => {
  const db = { ytdlp: { subscriptions: [{ id: 'sub1', channelUrl: 'https://www.youtube.com/channel/UCabc', channelAvatarUrl: 'javascript:alert(1)' }] } };
  assert.equal(store.resolveItemChannelAvatarUrl(db, { channelUrl: 'https://www.youtube.com/channel/UCabc' }), null);
});

test('resolveItemChannelAvatarUrl: a matched subscription with no channelAvatarUrl of its own resolves null', () => {
  const db = { ytdlp: { subscriptions: [{ id: 'sub1', channelUrl: 'https://www.youtube.com/channel/UCabc' }] } };
  assert.equal(store.resolveItemChannelAvatarUrl(db, { channelUrl: 'https://www.youtube.com/channel/UCabc' }), null);
});

// ---- v1.25.x QoL bugfix: the channelId-keyed avatar REGISTRY --------------
//
// `mkChannelId` deterministically pads a short seed out to a real
// `CHANNEL_ID_PATTERN`-shaped id (`UC` + exactly 22 charset chars) -- the
// registry's boundary validators (`registerChannelAvatar`/`getChannelAvatar`/
// `hasFreshChannelAvatar`) reject anything shorter, so every fixture below
// needs a REAL-shaped id, not a shorthand literal like the older
// `resolveItemChannelAvatarUrl` tests above use (those go through the
// UNVALIDATED sub-join, which never shape-checks `sub.channelId`).
function mkChannelId(seed) {
  // A right-padded literal (e.g. `${seed}` + trailing zeros) can COLLIDE for
  // distinct seeds whose only difference is a trailing zero digit (e.g.
  // "fifo1" and "fifo10" pad to the identical 22-char string) -- hash the
  // seed instead so every distinct seed deterministically maps to a distinct,
  // real-shaped `UC` + 22 hex-char id.
  const hash = crypto.createHash('md5').update(String(seed)).digest('hex');
  return `UC${hash.slice(0, 22)}`;
}

test('registerChannelAvatar: upserts a valid entry, readable via getChannelAvatar', async () => {
  const deps = makeFakeDeps();
  const channelId = mkChannelId('register1');
  const recorded = await store.registerChannelAvatar(deps, {
    channelId,
    avatarUrl: 'https://yt3.ggpht.com/registered.jpg',
    channelUrl: 'https://www.youtube.com/channel/' + channelId,
    name: 'Registered Channel',
  });
  assert.equal(recorded, true);
  const db = deps.loadDatabase();
  assert.equal(store.getChannelAvatar(db, channelId), 'https://yt3.ggpht.com/registered.jpg');
  assert.equal(store.ensureYtdlp(db).channelAvatars[channelId].name, 'Registered Channel');
});

test('registerChannelAvatar: rejects an invalid channelId (wrong shape) -- silent no-op, never throws', async () => {
  const deps = makeFakeDeps();
  assert.equal(await store.registerChannelAvatar(deps, { channelId: 'not-a-real-id', avatarUrl: 'https://yt3.ggpht.com/x.jpg' }), false);
  assert.equal(await store.registerChannelAvatar(deps, { channelId: '', avatarUrl: 'https://yt3.ggpht.com/x.jpg' }), false);
  assert.equal(await store.registerChannelAvatar(deps, { avatarUrl: 'https://yt3.ggpht.com/x.jpg' }), false);
  assert.deepEqual(store.ensureYtdlp(deps.loadDatabase()).channelAvatars, {});
});

test('registerChannelAvatar: rejects a non-https/hostile avatarUrl (via sanitizeChannelAvatarUrl) -- silent no-op', async () => {
  const deps = makeFakeDeps();
  const channelId = mkChannelId('rejectavatar');
  assert.equal(await store.registerChannelAvatar(deps, { channelId, avatarUrl: 'javascript:alert(1)' }), false);
  assert.equal(await store.registerChannelAvatar(deps, { channelId, avatarUrl: 'http://insecure.example.com/x.jpg' }), false);
  assert.equal(store.getChannelAvatar(deps.loadDatabase(), channelId), null);
});

test('registerChannelAvatar: overwrites a previously-registered avatar for the SAME channelId (unlike a write-once identity field)', async () => {
  const deps = makeFakeDeps();
  const channelId = mkChannelId('overwrite');
  await store.registerChannelAvatar(deps, { channelId, avatarUrl: 'https://yt3.ggpht.com/first.jpg' });
  await store.registerChannelAvatar(deps, { channelId, avatarUrl: 'https://yt3.ggpht.com/second.jpg' });
  assert.equal(store.getChannelAvatar(deps.loadDatabase(), channelId), 'https://yt3.ggpht.com/second.jpg');
});

test('registerChannelAvatar: FIFO cap evicts the OLDEST entry once MAX_CHANNEL_AVATARS is exceeded', async () => {
  const deps = makeFakeDeps();
  const db = deps.loadDatabase();
  const ns = store.ensureYtdlp(db);
  const oldestId = mkChannelId('oldest');
  // Pre-populate right up to the cap directly (bypassing the mutator -- pure
  // setup, not exercising registerChannelAvatar's own write path) so the test
  // doesn't need MAX_CHANNEL_AVATARS real async writes to prove eviction.
  ns.channelAvatars[oldestId] = { avatarUrl: 'https://yt3.ggpht.com/oldest.jpg', fetchedAt: 1 };
  for (let i = 0; i < store.MAX_CHANNEL_AVATARS - 1; i += 1) {
    const id = mkChannelId(`fifo${i}`);
    ns.channelAvatars[id] = { avatarUrl: `https://yt3.ggpht.com/${i}.jpg`, fetchedAt: 1000 + i };
  }
  assert.equal(Object.keys(ns.channelAvatars).length, store.MAX_CHANNEL_AVATARS, 'sanity: exactly at the cap before the triggering write');

  const newestId = mkChannelId('newest');
  await store.registerChannelAvatar(deps, { channelId: newestId, avatarUrl: 'https://yt3.ggpht.com/newest.jpg' }, 999999);

  const finalNs = store.ensureYtdlp(deps.loadDatabase());
  assert.equal(Object.keys(finalNs.channelAvatars).length, store.MAX_CHANNEL_AVATARS, 'the map must never exceed the cap');
  assert.equal(finalNs.channelAvatars[oldestId], undefined, 'the OLDEST entry (by fetchedAt) must be evicted first');
  assert.ok(finalNs.channelAvatars[newestId], 'the just-written entry must survive');
});

test('getChannelAvatar: returns null for a missing channelId, an invalid channelId, or a null/undefined db', () => {
  const db = { ytdlp: { channelAvatars: { [mkChannelId('present')]: { avatarUrl: 'https://yt3.ggpht.com/x.jpg', fetchedAt: 1 } } } };
  assert.equal(store.getChannelAvatar(db, mkChannelId('absent')), null);
  assert.equal(store.getChannelAvatar(db, 'not-a-real-id'), null);
  assert.equal(store.getChannelAvatar(db, null), null);
  assert.equal(store.getChannelAvatar(null, mkChannelId('present')), null);
  assert.equal(store.getChannelAvatar(db, mkChannelId('present')), 'https://yt3.ggpht.com/x.jpg');
});

test('getChannelAvatar: re-validates a hostile/corrupted stored avatarUrl (defense-in-depth) -- never returned', () => {
  const channelId = mkChannelId('hostile');
  const db = { ytdlp: { channelAvatars: { [channelId]: { avatarUrl: 'javascript:alert(1)', fetchedAt: 1 } } } };
  assert.equal(store.getChannelAvatar(db, channelId), null);
});

test('hasFreshChannelAvatar: no maxAgeMs (or 0) means "have ANY entry at all" -- never re-pulls once ever recorded', () => {
  const channelId = mkChannelId('anyentry');
  const db = { ytdlp: { channelAvatars: { [channelId]: { avatarUrl: 'https://yt3.ggpht.com/x.jpg', fetchedAt: 1 } } } };
  assert.equal(store.hasFreshChannelAvatar(db, channelId), true);
  assert.equal(store.hasFreshChannelAvatar(db, channelId, 0), true);
});

test('hasFreshChannelAvatar: true within the freshness window, false once past it', () => {
  const channelId = mkChannelId('freshness');
  const now = Date.now();
  const db = { ytdlp: { channelAvatars: { [channelId]: { avatarUrl: 'https://yt3.ggpht.com/x.jpg', fetchedAt: now - 1000 } } } };
  assert.equal(store.hasFreshChannelAvatar(db, channelId, 5000), true, 'fetched 1s ago, 5s window -- still fresh');
  assert.equal(store.hasFreshChannelAvatar(db, channelId, 500), false, 'fetched 1s ago, 0.5s window -- stale');
});

test('hasFreshChannelAvatar: false for a channelId with no entry at all, or an invalid channelId', () => {
  const db = { ytdlp: { channelAvatars: {} } };
  assert.equal(store.hasFreshChannelAvatar(db, mkChannelId('nothing'), store.AVATAR_TTL_MS), false);
  assert.equal(store.hasFreshChannelAvatar(db, 'not-a-real-id', store.AVATAR_TTL_MS), false);
  assert.equal(store.hasFreshChannelAvatar(null, mkChannelId('nothing'), store.AVATAR_TTL_MS), false);
});

// ---- resolveItemChannelAvatarUrl: the new registry precedence order -------

test('resolveItemChannelAvatarUrl precedence: item-baked channelAvatarUrl wins over everything else', () => {
  const channelId = mkChannelId('precedence1');
  const db = {
    ytdlp: {
      channelAvatars: { [channelId]: { avatarUrl: 'https://yt3.ggpht.com/registry.jpg', fetchedAt: 1 } },
      subscriptions: [{ id: 'sub1', channelUrl: 'https://www.youtube.com/@x', channelId, channelAvatarUrl: 'https://yt3.ggpht.com/sub.jpg' }],
    },
  };
  const item = { channelId, channelAvatarUrl: 'https://yt3.ggpht.com/own.jpg' };
  assert.equal(store.resolveItemChannelAvatarUrl(db, item), 'https://yt3.ggpht.com/own.jpg');
});

test('resolveItemChannelAvatarUrl precedence: the channelId registry wins over BOTH a registry url-match AND the sub-join', () => {
  const channelId = mkChannelId('precedence2');
  const channelUrl = 'https://www.youtube.com/channel/' + channelId;
  const db = {
    ytdlp: {
      channelAvatars: {
        [channelId]: { avatarUrl: 'https://yt3.ggpht.com/by-id.jpg', fetchedAt: 1, channelUrl: 'https://www.youtube.com/@irrelevant' },
        [mkChannelId('other')]: { avatarUrl: 'https://yt3.ggpht.com/by-url.jpg', fetchedAt: 1, channelUrl },
      },
      subscriptions: [{ id: 'sub1', channelUrl, channelId, channelAvatarUrl: 'https://yt3.ggpht.com/sub.jpg' }],
    },
  };
  const item = { channelId, channelUrl };
  assert.equal(store.resolveItemChannelAvatarUrl(db, item), 'https://yt3.ggpht.com/by-id.jpg');
});

test('resolveItemChannelAvatarUrl precedence: registry url-match (channelUrl or channelHandleUrl) wins over the sub-join when no channelId is present', () => {
  const registeredChannelId = mkChannelId('urlmatch');
  const channelUrl = 'https://www.youtube.com/channel/' + registeredChannelId;
  const db = {
    ytdlp: {
      channelAvatars: { [registeredChannelId]: { avatarUrl: 'https://yt3.ggpht.com/by-url.jpg', fetchedAt: 1, channelUrl } },
      subscriptions: [{ id: 'sub1', channelUrl, channelAvatarUrl: 'https://yt3.ggpht.com/sub.jpg' }],
    },
  };
  // The item itself carries no channelId at all -- only a channelUrl.
  assert.equal(store.resolveItemChannelAvatarUrl(db, { channelUrl }), 'https://yt3.ggpht.com/by-url.jpg');

  // Also matches via channelHandleUrl (an item captured with a handle form).
  const dbHandle = {
    ytdlp: {
      channelAvatars: { [registeredChannelId]: { avatarUrl: 'https://yt3.ggpht.com/by-handle.jpg', fetchedAt: 1, channelUrl: 'https://www.youtube.com/@handleform' } },
      subscriptions: [],
    },
  };
  assert.equal(
    store.resolveItemChannelAvatarUrl(dbHandle, { channelUrl: 'https://www.youtube.com/channel/UCsomethingelse00000000', channelHandleUrl: 'https://www.youtube.com/@handleform' }),
    'https://yt3.ggpht.com/by-handle.jpg',
  );
});

test('resolveItemChannelAvatarUrl precedence: falls back to the EXISTING sub-join when no registry entry matches at all', () => {
  const channelId = mkChannelId('subjoinfallback');
  const db = {
    ytdlp: {
      channelAvatars: {},
      subscriptions: [{ id: 'sub1', channelUrl: 'https://www.youtube.com/@fallback', channelId, channelAvatarUrl: 'https://yt3.ggpht.com/sub-only.jpg' }],
    },
  };
  assert.equal(store.resolveItemChannelAvatarUrl(db, { channelId }), 'https://yt3.ggpht.com/sub-only.jpg');
});

// ---- v1.41.13 (universal one-offs): source-aware downloadMeta bridge --------
// A NON-YouTube capture takes the universal branch: minimal raw-id gate, no
// YouTube channelUrl requirement, channelName from channel/uploader, composite
// `<extractor> <id>` key. The YouTube branch is byte-for-byte unchanged (the
// tests above still pass). Hostile-id corpus (design task-0) is first-class.

test('v1.41.13 sanitize: a non-YouTube capture is KEPT (no channelUrl needed), keyed by composite <extractor> <id>', () => {
  const r = store.sanitizeCapturedChannelMeta({ source: 'Vimeo', videoId: '76979871', channelName: 'Some Studio', title: 'A Film' });
  assert.ok(r, 'a non-YouTube capture is not dropped');
  assert.equal(r.universal, true);
  assert.equal(r.sourceExtractor, 'Vimeo');
  assert.equal(r.sourceId, '76979871');
  assert.equal(r.key, 'vimeo 76979871', 'composite key lowercases the extractor');
  assert.equal(r.channelName, 'Some Studio', 'the pseudo-channel label is captured');
});

test('v1.41.13 sanitize: channelName falls back channel -> uploader for the pseudo-channel label (D7)', () => {
  assert.equal(store.sanitizeCapturedChannelMeta({ source: 'Vimeo', videoId: '1', channelName: 'Real Channel', uploader: 'The Uploader' }).channelName, 'Real Channel');
  assert.equal(store.sanitizeCapturedChannelMeta({ source: 'Vimeo', videoId: '1', uploader: 'The Uploader' }).channelName, 'The Uploader');
  assert.equal(store.sanitizeCapturedChannelMeta({ source: 'Vimeo', videoId: '1' }).channelName, undefined);
});

test('v1.41.13 sanitize: hostile-but-legal extractor ids pass the MINIMAL gate (slashes/spaces/=, design task-0)', () => {
  for (const id of ['id=6', 'MTQ2NjMxOQ==', 'austrian/page=1', 'kichiku mad']) {
    const r = store.sanitizeCapturedChannelMeta({ source: 'Foo', videoId: id });
    assert.ok(r, `raw id ${JSON.stringify(id)} must be kept (no charset restriction)`);
    assert.equal(r.sourceId, id);
  }
  // A newline in the raw id is stripped (archive-line-forgery guard).
  assert.equal(store.sanitizeCapturedChannelMeta({ source: 'Foo', videoId: 'a\nb' }).sourceId, 'ab');
  assert.equal(store.sanitizeCapturedChannelMeta({ source: 'Foo', videoId: '' }), null, 'empty id dropped');
  assert.equal(store.sanitizeCapturedChannelMeta({ source: 'Foo', videoId: 'x'.repeat(257) }), null, 'over-256 id dropped');
});

test('v1.41.13 sanitize: a plugin extractor key (+ suffix) yields no usable universal entry', () => {
  assert.equal(store.sanitizeCapturedChannelMeta({ source: 'Some+plugin', videoId: 'abc' }), null);
});

test('v1.41.13 sanitize: a proxy-host YouTube capture (source Youtube) still takes the YouTube branch', () => {
  const r = store.sanitizeCapturedChannelMeta({
    source: 'Youtube', videoId: 'dQw4w9WgXcQ',
    channelUrl: 'https://www.youtube.com/@RickAstley', channelName: 'Rick Astley',
  });
  assert.ok(r && !r.universal, 'source=Youtube takes the YouTube branch');
  assert.equal(r.videoId, 'dQw4w9WgXcQ');
  assert.equal(r.channelUrl, 'https://www.youtube.com/@RickAstley');
});

test('v1.41.13 bridge round-trip: record a universal capture, consume it by composite key', async () => {
  let db = { ytdlp: { downloadMeta: {} } };
  const deps = { updateDatabase: async (fn) => { fn(db); return db; } };
  const ok = await store.recordDownloadChannelMeta(deps, { source: 'Vimeo', videoId: '76979871', uploader: 'Studio X', title: 'Doc' });
  assert.equal(ok, true);
  const key = store.compositeMetaKey('Vimeo', '76979871');
  assert.equal(key, 'vimeo 76979871');
  assert.ok(db.ytdlp.downloadMeta[key] && db.ytdlp.downloadMeta[key].universal === true, 'stored under the composite key');

  const consumed = store.consumeUniversalDownloadMeta(db, key);
  assert.ok(consumed);
  assert.equal(consumed.sourceExtractor, 'Vimeo');
  assert.equal(consumed.sourceId, '76979871');
  assert.equal(consumed.channelName, 'Studio X');
  assert.equal(consumed.sourceTitle, 'Doc');
  assert.equal(db.ytdlp.downloadMeta[key], undefined, 'consumed -> key deleted');
  assert.equal(store.consumeUniversalDownloadMeta(db, key), null, 'a second consume returns null');
});

test('v1.41.13 bridge: consumeUniversalDownloadMeta ignores a YouTube (non-universal) entry, and YouTube consume ignores a universal one', () => {
  const db = { ytdlp: { downloadMeta: {
    'dQw4w9WgXcQ': { channelUrl: 'https://www.youtube.com/@RickAstley', capturedAt: 1 },
    'vimeo 5': { universal: true, sourceExtractor: 'Vimeo', sourceId: '5', capturedAt: 1 },
  } } };
  assert.equal(store.consumeUniversalDownloadMeta(db, 'dQw4w9WgXcQ'), null, 'universal consume skips a YouTube entry');
  assert.equal(store.consumeDownloadChannelMeta(db, 'vimeo 5'), null, 'YouTube consume skips a universal entry (and bad key shape)');
  // Both entries remain (neither was wrongly consumed) besides the key-delete
  // that a matched consume would do -- here nothing matched.
  assert.ok(db.ytdlp.downloadMeta['dQw4w9WgXcQ'], 'YouTube entry intact');
});
