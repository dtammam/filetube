'use strict';

// [UNIT] v1.115 (Dean, A1): channelProbeResultFromParsed - the PURE parse of a
// channel `--dump-single-json` payload, extracted from probeChannelAvatar so the
// new canonical-NAME extraction (the name backfill's data source) is testable
// without a live yt-dlp spawn. Locks: the name comes from `channel` (preferred)
// then `uploader`; the pre-existing avatar/id/url mapping is unchanged; the
// "total miss" null contract still holds; never throws.
const { test } = require('node:test');
const assert = require('node:assert');
const { channelProbeResultFromParsed } = require('../../lib/ytdlp/run');

const CHID = 'UC-lHJZR3Gqxm24_Vd_AJ5Yw'; // valid UC + 22-char

test('channelName comes from `channel` (the display name) when present', () => {
  const r = channelProbeResultFromParsed({ channel: 'Marques Brownlee', uploader: 'mkbhd', channel_id: CHID });
  assert.equal(r.channelName, 'Marques Brownlee', 'canonical display name, not the handle/uploader');
  assert.equal(r.channelId, CHID);
});

test('falls back to `uploader` when `channel` is absent/blank/NA', () => {
  assert.equal(channelProbeResultFromParsed({ uploader: 'Some Uploader', channel_id: CHID }).channelName, 'Some Uploader');
  assert.equal(channelProbeResultFromParsed({ channel: '   ', uploader: 'U', channel_id: CHID }).channelName, 'U');
  assert.equal(channelProbeResultFromParsed({ channel: 'NA', uploader: 'U', channel_id: CHID }).channelName, 'U', 'NA is not a real name');
});

test('channelName is trimmed; null when neither field is usable', () => {
  assert.equal(channelProbeResultFromParsed({ channel: '  Trimmed Name  ', channel_id: CHID }).channelName, 'Trimmed Name');
  assert.equal(channelProbeResultFromParsed({ channel_id: CHID }).channelName, null, 'no name field -> null (id still present so not a total miss)');
});

test('the "total miss" contract holds: null unless an avatar OR channelId survived', () => {
  assert.equal(channelProbeResultFromParsed({ channel: 'Has A Name But No Id/Avatar' }), null, 'a name alone is a total miss (matches the avatar contract)');
  assert.equal(channelProbeResultFromParsed({ channel_id: CHID, channel: 'X' }).channelId, CHID);
});

test('the pre-existing avatar/id/url mapping is unchanged + never throws on junk', () => {
  const r = channelProbeResultFromParsed({ channel_id: CHID, channel_url: 'https://www.youtube.com/channel/' + CHID, channel: 'X' });
  assert.equal(r.channelId, CHID);
  assert.equal(typeof r.channelUrl, 'string');
  assert.equal(channelProbeResultFromParsed(null), null);
  assert.equal(channelProbeResultFromParsed([]), null);
  assert.equal(channelProbeResultFromParsed('nope'), null);
  const bad = channelProbeResultFromParsed({ channel_id: 'not-a-valid-id', channel: 'X' });
  assert.equal(bad, null, 'an invalid channel_id + no avatar = total miss');
});
