'use strict';

// [UNIT] v1.116 (Dean): the PURE core of the LOCAL channel-identity
// reconciliation - collectLocalChannelHealTargets (folder-bucketed, single-truth)
// + applyLocalChannelHeal (unit-adopt with handle corroboration). DATA-MUTATING:
// the gate destroys the cross-channel/mixed-folder/manual guards, so each is
// bound by a test that reddens when removed. Also covers T1: the name backfill
// now spans video + AUDIO.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  isChannelBearingMediaType,
  collectDistinctChannelNameTargets,
  applyBackfilledChannelName,
  collectLocalChannelHealTargets,
  applyLocalChannelHeal,
} = require('../../lib/ytdlp/index.js');

const UC_A = 'UC-6oT0FOyAqCGfdNLi4fmXA';
const UC_B = 'UCXuqSBlHAE6Xw-yeJA0Tunw';
const HANDLE = 'https://www.youtube.com/@nestalgiamusic';
const CANON_URL = 'https://www.youtube.com/channel/' + UC_A;

// canonical (real id + name), bad-name fragment sharing the folder + handle.
const canon = (over) => Object.assign({
  type: 'audio', filePath: '/music/nestalgiamusic/good.mp3',
  channelName: 'NESTALGIA', channelId: UC_A, channelUrl: CANON_URL,
  channelHandleUrl: HANDLE, channelAvatarUrl: 'https://yt3.ggpht.com/a.jpg',
}, over);
const frag = (over) => Object.assign({
  type: 'audio', filePath: '/music/nestalgiamusic/bad.mp3',
  channelName: '@nestalgiamusic', channelId: null, channelUrl: HANDLE,
}, over);

// ---- T1: video + audio coverage ---------------------------------------------
test('isChannelBearingMediaType: video + audio yes; books/podcasts/junk no', () => {
  assert.equal(isChannelBearingMediaType({ type: 'video' }), true);
  assert.equal(isChannelBearingMediaType({ type: 'audio' }), true);
  assert.equal(isChannelBearingMediaType({ type: 'book' }), false);
  assert.equal(isChannelBearingMediaType({ type: 'podcast' }), false);
  assert.equal(isChannelBearingMediaType(null), false);
});

test('the network backfill now targets + writes AUDIO items (the music-library gap)', () => {
  const db = { metadata: { a: { type: 'audio', channelName: '@x', channelId: UC_B } } };
  const t = collectDistinctChannelNameTargets(db);
  assert.equal(t.length, 1, 'an audio bad-name channel is now a target');
  const meta = { a: { type: 'audio', channelName: '@x', channelId: UC_B } };
  assert.equal(applyBackfilledChannelName(meta, { channelId: UC_B }, 'Real'), 1, 'and gets written');
  assert.equal(meta.a.channelName, 'Real');
});

// ---- collectLocalChannelHealTargets -----------------------------------------
test('heal targets: a folder with 1 canonical channelId + bad siblings yields a target', () => {
  const db = { metadata: {
    g1: canon(), g2: canon({ filePath: '/music/nestalgiamusic/good2.mp3' }),
    b1: frag(), b2: frag({ filePath: '/music/nestalgiamusic/bad2.mp3', channelName: '' }),
    other: canon({ channelId: UC_B, filePath: '/music/elsewhere/x.mp3', channelName: 'Other' }),
  } };
  const t = collectLocalChannelHealTargets(db);
  assert.equal(t.length, 1, 'one target (nestalgiamusic); the all-good "elsewhere" folder yields none');
  assert.equal(t[0].folderKey, '/music/nestalgiamusic');
  assert.equal(t[0].identity.channelId, UC_A);
  assert.equal(t[0].identity.channelName, 'NESTALGIA');
  assert.ok(t[0].urls.has(HANDLE) && t[0].urls.has(CANON_URL), 'canonical urls collected for corroboration');
});

test('heal targets: a CONFLICT folder (>1 canonical channelId) is skipped wholesale', () => {
  const db = { metadata: {
    a: canon({ filePath: '/music/misc/a.mp3' }),
    b: canon({ filePath: '/music/misc/b.mp3', channelId: UC_B, channelName: 'Bee', channelUrl: null, channelHandleUrl: null }),
    bad: frag({ filePath: '/music/misc/bad.mp3' }),
  } };
  assert.deepEqual(collectLocalChannelHealTargets(db), [], 'a junk-drawer folder is never guessed');
});

test('heal targets: a folder with a canonical id but NO bad siblings yields nothing', () => {
  const db = { metadata: { g: canon() } };
  assert.deepEqual(collectLocalChannelHealTargets(db), []);
});

test('heal targets: a folder whose only members are bad (no canonical) yields nothing (network job)', () => {
  const db = { metadata: { b1: frag(), b2: frag({ filePath: '/music/nestalgiamusic/b2.mp3' }) } };
  assert.deepEqual(collectLocalChannelHealTargets(db), []);
});

test('heal targets: pure / never throws', () => {
  assert.deepEqual(collectLocalChannelHealTargets(null), []);
  assert.deepEqual(collectLocalChannelHealTargets({}), []);
});

// ---- applyLocalChannelHeal ---------------------------------------------------
function target(over) {
  return Object.assign({
    folderKey: '/music/nestalgiamusic',
    identity: { channelId: UC_A, channelName: 'NESTALGIA', channelUrl: CANON_URL, channelHandleUrl: HANDLE, channelAvatarUrl: 'https://yt3.ggpht.com/a.jpg' },
    urls: new Set([HANDLE, CANON_URL]),
  }, over);
}

test('heal: adopts the identity UNIT (id+name+url+handle+avatar) onto bad siblings', () => {
  const meta = { b1: frag(), b2: frag({ filePath: '/music/nestalgiamusic/b2.mp3', channelName: '' }) };
  const n = applyLocalChannelHeal(meta, target());
  assert.equal(n, 2);
  for (const k of ['b1', 'b2']) {
    assert.equal(meta[k].channelName, 'NESTALGIA');
    assert.equal(meta[k].channelId, UC_A);
    assert.equal(meta[k].channelUrl, CANON_URL);
    assert.equal(meta[k].channelHandleUrl, HANDLE);
    assert.equal(meta[k].channelAvatarUrl, 'https://yt3.ggpht.com/a.jpg', 'missing avatar filled from canonical');
  }
});

test('heal: a bad sibling in the folder with NO url is healed (folder is the physical channel dir)', () => {
  const meta = { b: frag({ channelUrl: null, channelHandleUrl: null }) };
  assert.equal(applyLocalChannelHeal(meta, target()), 1);
  assert.equal(meta.b.channelId, UC_A);
});

test('heal: a foreign-handle item sharing the folder is NOT healed (corroboration guard)', () => {
  const meta = { b: frag({ channelUrl: 'https://www.youtube.com/@someoneelse' }) };
  const n = applyLocalChannelHeal(meta, target());
  assert.equal(n, 0, 'its url is not in the canonical set -> skipped');
  assert.equal(meta.b.channelId, null, 'identity untouched');
  assert.equal(meta.b.channelName, '@nestalgiamusic');
});

test('heal: NEVER over a manual attribution, NEVER an already-good name, NEVER another folder', () => {
  const meta = {
    manual: frag({ channelAttributedManually: true }),
    good: frag({ channelName: 'Already Real' }),
    elsewhere: frag({ filePath: '/music/other/x.mp3' }),
  };
  assert.equal(applyLocalChannelHeal(meta, target()), 0);
  assert.equal(meta.manual.channelName, '@nestalgiamusic');
  assert.equal(meta.good.channelName, 'Already Real');
  assert.equal(meta.elsewhere.channelId, null);
});

test('heal: idempotent (a second pass finds the now-good items no longer bad -> 0)', () => {
  const meta = { b: frag() };
  assert.equal(applyLocalChannelHeal(meta, target()), 1);
  assert.equal(applyLocalChannelHeal(meta, target()), 0);
});

test('heal: refuses to heal TO a bad name (a malformed canonical), and control-char strips the name', () => {
  assert.equal(applyLocalChannelHeal({ b: frag() }, target({ identity: { channelId: UC_A, channelName: '@stillhandle' } })), 0);
  const meta = { b: frag() };
  applyLocalChannelHeal(meta, target({ identity: { channelId: UC_A, channelName: 'NEST\x00ALGIA', channelUrl: CANON_URL, channelHandleUrl: HANDLE } }));
  assert.equal(meta.b.channelName, 'NESTALGIA', 'NUL stripped at the write');
});
