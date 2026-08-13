'use strict';

// [UNIT] v1.113: the pure classifier behind scripts/probe-channel-metadata.js
// (the read-only sizing diagnostic for the channel "@handle"/missing-avatar
// backfill). Binds the buckets Fix A/Fix B targeting is derived from.
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyChannelMetadata } = require('../../scripts/probe-channel-metadata');

test('non-video items are flagged isVideo:false (skipped by the sizer)', () => {
  assert.equal(classifyChannelMetadata({ type: 'audio', channelName: 'x' }).isVideo, false);
  assert.equal(classifyChannelMetadata({ type: 'video' }).isVideo, true);
  assert.equal(classifyChannelMetadata(null).isVideo, false);
});

test('hasName: a non-empty trimmed channelName counts; blank/absent does not', () => {
  assert.equal(classifyChannelMetadata({ type: 'video', channelName: 'Nestalgia' }).hasName, true);
  assert.equal(classifyChannelMetadata({ type: 'video', channelName: '   ' }).hasName, false);
  assert.equal(classifyChannelMetadata({ type: 'video' }).hasName, false);
});

test('handleFolder: folderName starting with @ is the "@handle" symptom', () => {
  assert.equal(classifyChannelMetadata({ type: 'video', folderName: '@nestalgia' }).handleFolder, true);
  assert.equal(classifyChannelMetadata({ type: 'video', folderName: 'Nestalgia' }).handleFolder, false);
  assert.equal(classifyChannelMetadata({ type: 'video' }).handleFolder, false);
});

test('repullable: a non-empty youtubeId means there is a source to re-pull from', () => {
  assert.equal(classifyChannelMetadata({ type: 'video', youtubeId: 'dQw4w9WgXcQ' }).repullable, true);
  assert.equal(classifyChannelMetadata({ type: 'video', youtubeId: '' }).repullable, false);
  assert.equal(classifyChannelMetadata({ type: 'video' }).repullable, false);
});

test('avatar/id split: the Fix A (has id, no avatar) vs Fix B (neither) distinction', () => {
  const recoverable = classifyChannelMetadata({ type: 'video', channelId: 'UCabc', channelAvatarUrl: '' });
  assert.equal(recoverable.hasAvatar, false);
  assert.equal(recoverable.hasChannelId, true); // Fix A can resolve this avatar
  const needsB = classifyChannelMetadata({ type: 'video', channelAvatarUrl: '', channelId: '' });
  assert.equal(needsB.hasAvatar, false);
  assert.equal(needsB.hasChannelId, false); // only Fix B (backfill) recovers this
  assert.equal(classifyChannelMetadata({ type: 'video', channelAvatarUrl: 'https://x/y.jpg' }).hasAvatar, true);
});

test('manuallyAttributed is surfaced so the sizer/backfill can SKIP it (attribution wins)', () => {
  assert.equal(classifyChannelMetadata({ type: 'video', channelAttributedManually: true }).manuallyAttributed, true);
  assert.equal(classifyChannelMetadata({ type: 'video' }).manuallyAttributed, false);
});

test('v1.114: handleName flags a channelName that captured the "@handle" (the bad-name case the folder-only check missed)', () => {
  const h = classifyChannelMetadata({ type: 'video', channelName: '@nestalgiamusic' });
  assert.equal(h.hasName, true, 'it has a (bad) name');
  assert.equal(h.handleName, true, 'the name is an @handle');
  assert.equal(h.badName, true, 'so it counts as a bad name to backfill');
  const real = classifyChannelMetadata({ type: 'video', channelName: 'NESTALGIA' });
  assert.equal(real.handleName, false, 'a real name is not an @handle');
  assert.equal(real.badName, false, 'a real name is fine');
});

test('v1.114: badName = missing name OR @handle-name (the real Fix B population, NOT just @handle folders)', () => {
  assert.equal(classifyChannelMetadata({ type: 'video', channelName: '', folderName: 'AfterSkool' }).badName, true, 'missing name -> folder fallback = bad');
  assert.equal(classifyChannelMetadata({ type: 'video', channelName: '@x' }).badName, true, 'handle-as-name = bad');
  assert.equal(classifyChannelMetadata({ type: 'video', channelName: 'Bob Steel' }).badName, false, 'real name = good');
});

test('the exact Fix-B target: a bad name (missing OR @handle) + a source + not manual', () => {
  const missing = classifyChannelMetadata({ type: 'video', folderName: 'AfterSkool', youtubeId: 'abc123', channelName: '' });
  assert.ok(missing.badName && missing.repullable && !missing.manuallyAttributed, 'missing-name + source = backfill target');
  const handle = classifyChannelMetadata({ type: 'video', channelName: '@handle', youtubeId: 'abc123' });
  assert.ok(handle.badName && handle.repullable && !handle.manuallyAttributed, '@handle-name + source = backfill target');
});
