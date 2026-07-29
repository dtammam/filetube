'use strict';

// [UNIT] v1.51 - the notification bell's pure client decisions
// (public/js/common.js): the capability-probe predicate, the badge label
// formatter, and the server-row -> render-model mapper. The DOM injector
// itself is the usual untested-by-necessity thin shell (no browser harness
// in this repo); the integration suite + Dean's device probes cover it.
//
// Fixture spellings are divergent (v1.41.9): nothing below matches a default
// the code could invent.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  shouldInjectNotificationBell,
  formatNotificationBadge,
  buildNotificationRowModel,
} = require('../../public/js/common.js');

test('shouldInjectNotificationBell: ONLY a genuine 2xx injects (the fail-closed probe)', () => {
  assert.equal(shouldInjectNotificationBell({ ok: true }), true);
  assert.equal(shouldInjectNotificationBell({ ok: false, status: 404 }), false, 'disabled instance (404) injects nothing');
  assert.equal(shouldInjectNotificationBell({ ok: false, status: 500 }), false);
  assert.equal(shouldInjectNotificationBell(null), false);
  assert.equal(shouldInjectNotificationBell(undefined), false);
  assert.equal(shouldInjectNotificationBell({ ok: 'true' }), false, 'a truthy non-boolean ok is not a 2xx');
});

test('formatNotificationBadge: empty string at zero/garbage (never a literal "0"), 20+ cap', () => {
  assert.equal(formatNotificationBadge(0), '');
  assert.equal(formatNotificationBadge(-3), '');
  assert.equal(formatNotificationBadge(NaN), '');
  assert.equal(formatNotificationBadge('7'), '', 'a numeric STRING is not a count');
  assert.equal(formatNotificationBadge(1.5), '');
  assert.equal(formatNotificationBadge(undefined), '');
  assert.equal(formatNotificationBadge(1), '1');
  assert.equal(formatNotificationBadge(20), '20');
  assert.equal(formatNotificationBadge(21), '20+');
  assert.equal(formatNotificationBadge(9999), '20+');
});

const FULL_ROW = {
  id: 41,
  mediaId: 'f00dfacefeed',
  createdAt: Date.now() - 3 * 60 * 60 * 1000,
  unread: true,
  title: 'Ünmistakably Divergent Titlé',
  channelName: '  Zephyr Wörkshop  ',
  folderName: 'Fallback Földer',
  channelAvatarUrl: 'https://yt3.example/avatar.jpg',
  hasThumbnail: true,
  type: 'video',
};

test('buildNotificationRowModel: full row maps to href/labels/thumb verbatim', () => {
  const m = buildNotificationRowModel(FULL_ROW);
  assert.equal(m.href, '/watch.html?v=f00dfacefeed', 'the SAME href shape main.js cards build');
  assert.equal(m.title, 'Ünmistakably Divergent Titlé');
  assert.equal(m.channelLabel, 'Zephyr Wörkshop', 'captured channel name wins, trimmed');
  assert.equal(m.channelAvatarUrl, 'https://yt3.example/avatar.jpg');
  assert.equal(m.thumbnailUrl, '/thumbnail/f00dfacefeed');
  assert.equal(m.unread, true);
  assert.equal(m.id, 41);
  assert.ok(typeof m.timeLabel === 'string' && m.timeLabel.length > 0, 'relative time label rendered');
  assert.notEqual(m.timeLabel, 'unknown date');
});

test('buildNotificationRowModel: channel label falls back channelName -> folderName -> Library', () => {
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, channelName: '   ' }).channelLabel, 'Fallback Földer');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, channelName: undefined }).channelLabel, 'Fallback Földer');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, channelName: '', folderName: '' }).channelLabel, 'Library');
});

test('buildNotificationRowModel: absence handling — no thumbnail, no avatar, garbage rows', () => {
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, hasThumbnail: false }).thumbnailUrl, null);
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, hasThumbnail: 'yes' }).thumbnailUrl, null, 'truthy non-boolean is not a thumbnail claim');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, channelAvatarUrl: undefined }).channelAvatarUrl, '');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, unread: 'true' }).unread, false, 'unread is boolean-strict');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, createdAt: undefined }).timeLabel, 'unknown date');
  assert.equal(buildNotificationRowModel(null), null);
  assert.equal(buildNotificationRowModel({}), null, 'a row without a mediaId cannot render');
  assert.equal(buildNotificationRowModel({ ...FULL_ROW, mediaId: '' }), null);
});
