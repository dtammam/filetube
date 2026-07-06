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
