'use strict';

// [UNIT] FR-2 (T2, v1.20.0) client-side channel-identity primitives
// (public/js/common.js): `canonicalizeChannelUrl`, `channelIdentityMatches`,
// `resolveFileChannelIdentity`, and the `resolveChannelName` captured-name
// precedence extension. See
// docs/exec-plans/active/2026-07-08-v1.20-subscribe.md ("Matcher" + "Creator
// display precedence") for the full design/rationale. All pure/deterministic;
// none throw on malformed/missing input.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  canonicalizeChannelUrl,
  channelIdentityMatches,
  resolveFileChannelIdentity,
  resolveChannelName,
} = require('../../public/js/common.js');

// ---- canonicalizeChannelUrl -------------------------------------------------

test('canonicalizeChannelUrl: /channel/UC... canonicalizes with the id case PRESERVED', () => {
  assert.equal(
    canonicalizeChannelUrl('https://www.youtube.com/channel/UCabcDEF1234567890123456'),
    'channel:UCabcDEF1234567890123456'
  );
});

test('canonicalizeChannelUrl: /@handle canonicalizes case-INSENSITIVELY', () => {
  assert.equal(canonicalizeChannelUrl('https://www.youtube.com/@SomeCreator'), 'handle:somecreator');
  assert.equal(canonicalizeChannelUrl('https://www.youtube.com/@somecreator'), 'handle:somecreator');
});

test('canonicalizeChannelUrl: /user/<name> canonicalizes case-insensitively', () => {
  assert.equal(canonicalizeChannelUrl('https://www.youtube.com/user/SomeUser'), 'user:someuser');
});

test('canonicalizeChannelUrl: /c/<name> canonicalizes case-insensitively', () => {
  assert.equal(canonicalizeChannelUrl('https://www.youtube.com/c/SomeName'), 'c:somename');
});

test('canonicalizeChannelUrl: a youtu.be video URL is NOT a channel identity -> null', () => {
  assert.equal(canonicalizeChannelUrl('https://youtu.be/dQw4w9WgXcQ'), null);
});

test('canonicalizeChannelUrl: a /watch?v= video URL is NOT a channel identity -> null', () => {
  assert.equal(canonicalizeChannelUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
});

test('canonicalizeChannelUrl: trailing slash is ignored (same key with or without)', () => {
  assert.equal(
    canonicalizeChannelUrl('https://www.youtube.com/channel/UC12345/'),
    canonicalizeChannelUrl('https://www.youtube.com/channel/UC12345')
  );
  assert.equal(canonicalizeChannelUrl('https://www.youtube.com/channel/UC12345/'), 'channel:UC12345');
});

test('canonicalizeChannelUrl: host variants (youtube.com/www./m./music.) all resolve to the same key', () => {
  const key = canonicalizeChannelUrl('https://youtube.com/@SameCreator');
  assert.equal(canonicalizeChannelUrl('https://www.youtube.com/@SameCreator'), key);
  assert.equal(canonicalizeChannelUrl('https://m.youtube.com/@SameCreator'), key);
  assert.equal(canonicalizeChannelUrl('https://music.youtube.com/@SameCreator'), key);
});

test('canonicalizeChannelUrl: garbage/unparseable input -> null, never throws', () => {
  assert.equal(canonicalizeChannelUrl('not a url'), null);
  assert.equal(canonicalizeChannelUrl(''), null);
  assert.equal(canonicalizeChannelUrl(null), null);
  assert.equal(canonicalizeChannelUrl(undefined), null);
  assert.equal(canonicalizeChannelUrl(123), null);
});

test('canonicalizeChannelUrl: unrecognized host -> null (conservative, not merely suffix-matched)', () => {
  assert.equal(canonicalizeChannelUrl('https://evil-youtube.com/channel/UC12345'), null);
  assert.equal(canonicalizeChannelUrl('https://youtube.com.evil.com/channel/UC12345'), null);
});

test('canonicalizeChannelUrl: unrecognized path shape on an allowed host -> null', () => {
  assert.equal(canonicalizeChannelUrl('https://www.youtube.com/results?search_query=x'), null);
  assert.equal(canonicalizeChannelUrl('https://www.youtube.com/playlist?list=PL123'), null);
});

// ---- channelIdentityMatches --------------------------------------------------

test('channelIdentityMatches: a /channel/UC... file matches a /@handle subscription via the shared handle key', () => {
  const fileIdentity = {
    channelUrl: 'https://www.youtube.com/channel/UC12345',
    channelHandleUrl: 'https://www.youtube.com/@somecreator',
  };
  assert.equal(channelIdentityMatches(fileIdentity, 'https://www.youtube.com/@SomeCreator'), true);
});

test('channelIdentityMatches: a /@handle file matches a /channel/UC... subscription via the channel-id key', () => {
  const fileIdentity = {
    channelUrl: 'https://www.youtube.com/@somecreator',
    channelId: 'UC12345',
  };
  assert.equal(channelIdentityMatches(fileIdentity, 'https://www.youtube.com/channel/UC12345'), true);
});

test('channelIdentityMatches: genuine non-match returns false', () => {
  const fileIdentity = { channelUrl: 'https://www.youtube.com/channel/UC11111' };
  assert.equal(channelIdentityMatches(fileIdentity, 'https://www.youtube.com/channel/UC22222'), false);
});

test('channelIdentityMatches: missing fileIdentity -> false, never throws', () => {
  assert.equal(channelIdentityMatches(null, 'https://www.youtube.com/channel/UC12345'), false);
  assert.equal(channelIdentityMatches(undefined, 'https://www.youtube.com/channel/UC12345'), false);
});

test('channelIdentityMatches: partial identity (channelUrl only, no channelId/handle) still matches on channelUrl', () => {
  const fileIdentity = { channelUrl: 'https://www.youtube.com/channel/UC12345' };
  assert.equal(channelIdentityMatches(fileIdentity, 'https://www.youtube.com/channel/UC12345'), true);
});

test('channelIdentityMatches: unparseable subUrl -> false, never throws', () => {
  const fileIdentity = { channelUrl: 'https://www.youtube.com/channel/UC12345' };
  assert.equal(channelIdentityMatches(fileIdentity, 'not a url'), false);
  assert.equal(channelIdentityMatches(fileIdentity, null), false);
});

test('channelIdentityMatches: conservative -- two unprovable/unrecognized forms never false-match', () => {
  // Neither side canonicalizes (both video URLs / unrecognized shapes) -- must
  // never coincidentally collide on `null === null`.
  const fileIdentity = { channelUrl: 'https://youtu.be/dQw4w9WgXcQ' };
  assert.equal(channelIdentityMatches(fileIdentity, 'https://youtu.be/dQw4w9WgXcQ'), false);
  assert.equal(channelIdentityMatches({}, 'https://www.youtube.com/channel/UC12345'), false);
});

// ---- resolveFileChannelIdentity ---------------------------------------------

test('resolveFileChannelIdentity: full identity present returns all captured fields', () => {
  const item = {
    channelUrl: 'https://www.youtube.com/channel/UC12345',
    channelId: 'UC12345',
    channelHandleUrl: 'https://www.youtube.com/@somecreator',
  };
  assert.deepEqual(resolveFileChannelIdentity(item), {
    channelUrl: 'https://www.youtube.com/channel/UC12345',
    channelId: 'UC12345',
    channelHandleUrl: 'https://www.youtube.com/@somecreator',
  });
});

test('resolveFileChannelIdentity: no channelUrl -> null (non-yt-dlp file)', () => {
  assert.equal(resolveFileChannelIdentity({ artist: 'Someone' }), null);
  assert.equal(resolveFileChannelIdentity({ channelUrl: '' }), null);
});

test('resolveFileChannelIdentity: malformed/missing item -> null, never throws', () => {
  assert.equal(resolveFileChannelIdentity(null), null);
  assert.equal(resolveFileChannelIdentity(undefined), null);
  assert.equal(resolveFileChannelIdentity({}), null);
});

test('resolveFileChannelIdentity: partial identity (channelUrl only) omits the optional fields', () => {
  const item = { channelUrl: 'https://www.youtube.com/channel/UC12345' };
  assert.deepEqual(resolveFileChannelIdentity(item), { channelUrl: 'https://www.youtube.com/channel/UC12345' });
});

// ---- resolveChannelName precedence ------------------------------------------

test('resolveChannelName: captured item.channelName wins first when present', () => {
  const item = {
    channelName: 'Real Creator Name',
    artist: 'Some Artist',
    folderName: 'Downloads',
    rootFolder: '/data/downloads',
  };
  const folderSettings = { '/data/downloads': { name: 'Mapped Folder Name' } };
  assert.equal(resolveChannelName(item, folderSettings), 'Real Creator Name');
});

test('resolveChannelName: falls back to mapped folder name when channelName absent', () => {
  const item = { artist: 'Some Artist', folderName: 'Movies', rootFolder: '/media/movies' };
  const folderSettings = { '/media/movies': { name: 'Mapped Folder Name' } };
  assert.equal(resolveChannelName(item, folderSettings), 'Mapped Folder Name');
});

test('resolveChannelName: falls back to artist tag when no channelName/mapped folder', () => {
  const item = { artist: 'Some Artist', folderName: 'Movies', rootFolder: '/media/movies' };
  assert.equal(resolveChannelName(item, {}), 'Some Artist');
});

test('resolveChannelName: falls back to folderName when no channelName/mapped folder/artist', () => {
  const item = { folderName: 'Movies', rootFolder: '/media/movies' };
  assert.equal(resolveChannelName(item, {}), 'Movies');
});

test('resolveChannelName: non-yt-dlp item (no channelName field at all) is completely unchanged across the full chain', () => {
  const item = { rootFolder: '/media/movies' };
  assert.equal(resolveChannelName(item, {}), 'Library');
});

test('resolveChannelName: a blank/whitespace-only channelName does not win -- falls through unchanged', () => {
  const item = { channelName: '   ', artist: 'Some Artist', rootFolder: '/media/movies' };
  assert.equal(resolveChannelName(item, {}), 'Some Artist');
});
