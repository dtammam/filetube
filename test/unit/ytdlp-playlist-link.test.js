'use strict';

// [UNIT] v1.370.0 W1 (plan docs/exec-plans/active/2026-10-06-v1370-playlist-picker.md, R1, R5): recognising a
// playlist link. `classifyPlaylistLink` reads the RAW input (before `rebuildQueryAllowlist` drops `list`), over
// every shape the plan names - share-sheet text, `&index=` / `&si=` / `&pp=`, a music album (`OLAK...`),
// `youtu.be/X?list=Y`, a Mix (`RD...`), Watch Later / Liked, a list with no video, and Dean's exact example.
// Also binds today's single-video path for a caller that does NOT opt in (no test passed a `watch?v&list`
// link before this), and the one-off error wording (no internal field name).

const { test } = require('node:test');
const assert = require('node:assert');
const { classifyPlaylistLink, playlistUrlFor, classifySingleVideo, classifyOneOffUrl } = require('../../lib/ytdlp/url');

const V = 'U3P8pUboZ5g';
const L = 'PLUtyNbQXMTLg'; // Dean's example list (13 chars; T0: readable, 24 entries)

const CASES = [
  ['Dean\'s exact example', `https://www.youtube.com/watch?v=${V}&list=${L}`, { kind: 'watch-in-list', videoId: V, listId: L }],
  ['the list page', `https://www.youtube.com/playlist?list=${L}`, { kind: 'playlist', listId: L }],
  ['&index= and &si=', `https://www.youtube.com/watch?v=${V}&list=${L}&index=3&si=AbC_d`, { kind: 'watch-in-list', videoId: V, listId: L }],
  ['&pp= and list first', `https://www.youtube.com/watch?list=${L}&v=${V}&pp=iAQB`, { kind: 'watch-in-list', videoId: V, listId: L }],
  ['the mobile host', `https://m.youtube.com/watch?v=${V}&list=${L}`, { kind: 'watch-in-list', videoId: V, listId: L }],
  ['a music album', 'https://music.youtube.com/playlist?list=OLAK5uy_kYhX-abc_123', { kind: 'playlist', listId: 'OLAK5uy_kYhX-abc_123' }],
  ['youtu.be with a list', `https://youtu.be/${V}?list=${L}&si=x1`, { kind: 'watch-in-list', videoId: V, listId: L }],
  ['a list with no video', `https://www.youtube.com/watch?list=${L}`, { kind: 'playlist', listId: L }],
  ['a Mix', `https://www.youtube.com/watch?v=${V}&list=RD${V}&start_radio=1`, { kind: 'mix', videoId: V, listId: 'RD' + V }],
  ['a Mix list page', `https://www.youtube.com/playlist?list=RD${V}`, { kind: 'mix', listId: 'RD' + V }],
  ['Watch Later', 'https://www.youtube.com/playlist?list=WL', { kind: 'personal', listId: 'WL' }],
  ['Liked, from a video', `https://www.youtube.com/watch?v=${V}&list=LL`, { kind: 'personal', videoId: V, listId: 'LL' }],
  ['share-sheet text with a trailing period', `Watch this: https://www.youtube.com/watch?v=${V}&list=${L}.`, { kind: 'watch-in-list', videoId: V, listId: L }],
  ['a quoted URL with a fragment', `"https://www.youtube.com/playlist?list=${L}#t=1"`, { kind: 'playlist', listId: L }],
  ['no list', `https://www.youtube.com/watch?v=${V}`, { kind: 'none' }],
  ['a channel', 'https://www.youtube.com/@KyleGordon', { kind: 'none' }],
  ['not YouTube', `https://example.com/watch?v=${V}&list=${L}`, { kind: 'none' }],
  ['an unsafe list id (decoded ;)', 'https://www.youtube.com/playlist?list=PL%3Brm', { kind: 'none' }],
  ['an unsafe video id', `https://www.youtube.com/watch?v=a%20b&list=${L}`, { kind: 'none' }],
  ['a list on a channel page', `https://www.youtube.com/@KyleGordon?list=${L}`, { kind: 'none' }],
  ['userinfo', `https://user:pw@www.youtube.com/playlist?list=${L}`, { kind: 'none' }],
  ['not a string', 42, { kind: 'none' }],
  ['empty', '   ', { kind: 'none' }],
];

for (const [name, input, expected] of CASES) {
  test('W1 classifyPlaylistLink: ' + name, () => {
    assert.deepStrictEqual(classifyPlaylistLink(input), expected);
  });
}

test('W1: the canonical playlist URL (the listing and Subscribe, R4) only for a safe id', () => {
  assert.strictEqual(playlistUrlFor(L), `https://www.youtube.com/playlist?list=${L}`);
  assert.strictEqual(playlistUrlFor('PL;rm'), null);
  assert.strictEqual(playlistUrlFor(''), null);
});

test('W1: a caller that does not opt in keeps today\'s behaviour - watch?v=X&list=Y downloads the ONE video', () => {
  const single = classifySingleVideo(`https://www.youtube.com/watch?v=${V}&list=${L}&index=3`);
  assert.deepStrictEqual(single, { ok: true, kind: 'video', videoId: V, watchUrl: `https://www.youtube.com/watch?v=${V}` });
  const oneOff = classifyOneOffUrl(`https://youtu.be/${V}?list=${L}`);
  assert.strictEqual(oneOff.ok, true);
  assert.strictEqual(oneOff.videoId, V);
  const list = classifySingleVideo(`https://www.youtube.com/playlist?list=${L}`);
  assert.strictEqual(list.ok, false);
  assert.strictEqual(list.kind, 'playlist', 'a list page is still refused by the single-video path');
});

test('W1: the one-off error never names the internal field "channelUrl"', () => {
  const r = classifySingleVideo(`https://www.youtube.com/watch?list=${L}`);
  assert.strictEqual(r.ok, false);
  assert.ok(!/channelUrl/.test(r.error), 'no internal name: ' + r.error);
  assert.match(r.error, /^The link /);
  const r2 = classifyOneOffUrl(`https://www.youtube.com/watch?list=${L}`);
  assert.ok(!/channelUrl/.test(r2.error || ''), 'the one-off route\'s error too: ' + r2.error);
});
