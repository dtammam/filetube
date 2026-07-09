'use strict';

// [UNIT] v1.21.0 FR-5: `derivePinnedPlaylistEntries` (public/js/common.js) --
// the pure filter/derive step behind `renderPinnedPlaylists`, the Playlists
// sheet's pinned-channel-playlist subsection. Turns a raw
// `GET /api/subscriptions/pins` response into `{channelDir, label,
// channelAvatarUrl}` render entries: drops anything missing a usable
// `channelDir` and derives a never-blank display label (the persisted
// snapshot, else the channelDir's own basename, else a generic fallback).
//
// v1.24.0 (T3, F1): also normalizes `channelAvatarUrl` (C6, populated by T11
// in Wave 3 -- absent on every pin record today) to `null` when
// absent/blank/non-string, so `resolveAvatarSource` always has a
// single already-validated field to read.
const { test } = require('node:test');
const assert = require('node:assert');
const { derivePinnedPlaylistEntries } = require('../../public/js/common.js');

test('derivePinnedPlaylistEntries: passes through a well-formed pin with its label', () => {
  const entries = derivePinnedPlaylistEntries([
    { id: 'p1', channelDir: '/data/ytdlp-downloads/My Channel', label: 'My Channel', pinnedAt: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.deepStrictEqual(entries, [{ channelDir: '/data/ytdlp-downloads/My Channel', label: 'My Channel', channelAvatarUrl: null }]);
});

test('derivePinnedPlaylistEntries: passes through a valid channelAvatarUrl, trimmed', () => {
  const entries = derivePinnedPlaylistEntries([
    { id: 'p1', channelDir: '/d/a', label: 'A', channelAvatarUrl: '  https://example.com/avatar.jpg  ' },
  ]);
  assert.strictEqual(entries[0].channelAvatarUrl, 'https://example.com/avatar.jpg');
});

test('derivePinnedPlaylistEntries: an absent/blank/non-string channelAvatarUrl normalizes to null (fail-safe to the generated fallback)', () => {
  const missing = derivePinnedPlaylistEntries([{ id: 'p1', channelDir: '/d/a', label: 'A' }]);
  assert.strictEqual(missing[0].channelAvatarUrl, null);

  const blank = derivePinnedPlaylistEntries([{ id: 'p2', channelDir: '/d/b', label: 'B', channelAvatarUrl: '   ' }]);
  assert.strictEqual(blank[0].channelAvatarUrl, null);

  const wrongType = derivePinnedPlaylistEntries([{ id: 'p3', channelDir: '/d/c', label: 'C', channelAvatarUrl: 42 }]);
  assert.strictEqual(wrongType[0].channelAvatarUrl, null);
});

test('derivePinnedPlaylistEntries: falls back to the channelDir\'s basename when label is missing/blank', () => {
  const withMissing = derivePinnedPlaylistEntries([{ id: 'p1', channelDir: '/data/ytdlp-downloads/Some Chan' }]);
  assert.strictEqual(withMissing[0].label, 'Some Chan');

  const withBlank = derivePinnedPlaylistEntries([{ id: 'p2', channelDir: '/data/ytdlp-downloads/Other Chan', label: '   ' }]);
  assert.strictEqual(withBlank[0].label, 'Other Chan');
});

test('derivePinnedPlaylistEntries: trims a label with surrounding whitespace', () => {
  const entries = derivePinnedPlaylistEntries([{ id: 'p1', channelDir: '/d/x', label: '  Padded  ' }]);
  assert.strictEqual(entries[0].label, 'Padded');
});

test('derivePinnedPlaylistEntries: drops any entry missing a usable channelDir (defensive, fail-safe)', () => {
  assert.deepStrictEqual(derivePinnedPlaylistEntries([{ id: 'p1', label: 'No dir' }]), []);
  assert.deepStrictEqual(derivePinnedPlaylistEntries([{ id: 'p1', channelDir: '', label: 'Empty dir' }]), []);
  assert.deepStrictEqual(derivePinnedPlaylistEntries([{ id: 'p1', channelDir: 42, label: 'Wrong type' }]), []);
  assert.deepStrictEqual(derivePinnedPlaylistEntries([null, undefined, 'not an object']), []);
});

test('derivePinnedPlaylistEntries: never throws on a non-array/missing input, returns an empty array', () => {
  assert.deepStrictEqual(derivePinnedPlaylistEntries(undefined), []);
  assert.deepStrictEqual(derivePinnedPlaylistEntries(null), []);
  assert.deepStrictEqual(derivePinnedPlaylistEntries('not an array'), []);
  assert.deepStrictEqual(derivePinnedPlaylistEntries({}), []);
});

test('derivePinnedPlaylistEntries: preserves order and handles multiple pins', () => {
  const entries = derivePinnedPlaylistEntries([
    { id: 'p1', channelDir: '/d/a', label: 'A' },
    { id: 'p2', channelDir: '/d/b', label: 'B' },
  ]);
  assert.deepStrictEqual(entries.map((e) => e.label), ['A', 'B']);
});
