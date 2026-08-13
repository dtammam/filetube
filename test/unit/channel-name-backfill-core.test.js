'use strict';

// [UNIT] v1.115 (Dean, A1): the PURE core of the per-channel name backfill -
// isBadChannelName (the shared "needs fixing" predicate), the target enumerator,
// and the writer. DATA-MUTATING wave: these guards are load-bearing (the gate is
// briefed to destroy the attribution + cross-channel + overwrite protections),
// so every guard is bound by a test that reddens when it is removed.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  isBadChannelName,
  collectDistinctChannelNameTargets,
  applyBackfilledChannelName,
} = require('../../lib/ytdlp/index.js');

const CH_A = 'UC-lHJZR3Gqxm24_Vd_AJ5Yw';
const CH_B = 'UCXuqSBlHAE6Xw-yeJA0Tunw';

// ---- isBadChannelName -------------------------------------------------------
test('isBadChannelName: empty/whitespace/"@handle" are bad; a real name is not', () => {
  assert.equal(isBadChannelName(''), true);
  assert.equal(isBadChannelName('   '), true);
  assert.equal(isBadChannelName('@Apple'), true);
  assert.equal(isBadChannelName(undefined), true, 'absent name -> folder fallback -> bad');
  assert.equal(isBadChannelName('Marques Brownlee'), false);
  assert.equal(isBadChannelName('NESTALGIA'), false);
});

// ---- collectDistinctChannelNameTargets --------------------------------------
test('enumerator: one target per DISTINCT bad-name channel with an identity', () => {
  const db = { metadata: {
    a1: { type: 'video', channelName: '', channelId: CH_A },
    a2: { type: 'video', channelName: '@handle', channelId: CH_A }, // same channel -> dedup
    b1: { type: 'video', channelName: '', channelId: CH_B },
    good: { type: 'video', channelName: 'Real Name', channelId: 'UCgoodgoodgoodgoodgood00' }, // good name -> no target
  } };
  const t = collectDistinctChannelNameTargets(db);
  assert.equal(t.length, 2, 'A and B once each; the good-name channel excluded');
  assert.deepEqual(t.map(x => x.channelId).sort(), [CH_A, CH_B].sort());
});

test('enumerator: skips manually-attributed, no-identity, and non-video items', () => {
  const db = { metadata: {
    manual: { type: 'video', channelName: '', channelId: CH_A, channelAttributedManually: true },
    noId:   { type: 'video', channelName: '', folderName: 'AfterSkool' }, // no channelId/url -> unprobeable
    audio:  { type: 'audio', channelName: '', channelId: CH_B },
  } };
  assert.deepEqual(collectDistinctChannelNameTargets(db), [], 'nothing probeable/eligible');
});

test('enumerator: falls back to channelUrl/handleUrl when no channelId', () => {
  const db = { metadata: {
    u1: { type: 'video', channelName: '', channelUrl: 'https://youtube.com/@x' },
    u2: { type: 'video', channelName: '', channelHandleUrl: 'https://youtube.com/@y' },
  } };
  const t = collectDistinctChannelNameTargets(db);
  assert.equal(t.length, 2);
  assert.ok(t.every(x => x.channelId === null && typeof x.channelUrl === 'string'));
});

test('enumerator: never throws / pure', () => {
  assert.deepEqual(collectDistinctChannelNameTargets(null), []);
  assert.deepEqual(collectDistinctChannelNameTargets({}), []);
});

// ---- applyBackfilledChannelName ---------------------------------------------
function chan(over) { return Object.assign({ type: 'video', channelName: '', channelId: CH_A }, over); }

test('writer: writes the name to every bad-name item of the matched channel', () => {
  const meta = { a1: chan(), a2: chan({ channelName: '@handle' }), b1: chan({ channelId: CH_B }) };
  const n = applyBackfilledChannelName(meta, { channelId: CH_A }, 'Real Name');
  assert.equal(n, 2, 'both A items written');
  assert.equal(meta.a1.channelName, 'Real Name');
  assert.equal(meta.a2.channelName, 'Real Name');
  assert.equal(meta.b1.channelName, '', 'a DIFFERENT channel is untouched (no cross-channel bleed)');
});

test('writer: NEVER overwrites a manually-attributed item (attribution wins)', () => {
  const meta = { m: chan({ channelName: '@old', channelAttributedManually: true }) };
  assert.equal(applyBackfilledChannelName(meta, { channelId: CH_A }, 'Real Name'), 0);
  assert.equal(meta.m.channelName, '@old', 'manual attribution preserved');
});

test('writer: NEVER overwrites an already-good name (idempotent; a real capture is safe)', () => {
  const meta = { g: chan({ channelName: 'Already Real' }) };
  assert.equal(applyBackfilledChannelName(meta, { channelId: CH_A }, 'Probed Name'), 0);
  assert.equal(meta.g.channelName, 'Already Real');
});

test('writer: matches on channelId when present -- an item of a DIFFERENT id but same url is NOT touched', () => {
  const meta = { x: chan({ channelId: CH_B, channelUrl: 'https://youtube.com/@shared' }) };
  const n = applyBackfilledChannelName(meta, { channelId: CH_A, channelUrl: 'https://youtube.com/@shared' }, 'Name');
  assert.equal(n, 0, 'id mismatch wins over a url coincidence');
  assert.equal(meta.x.channelName, '');
});

test('writer: url/handle match when the target has no channelId', () => {
  const meta = {
    u: chan({ channelId: '', channelUrl: 'https://youtube.com/@z' }),
    h: chan({ channelId: '', channelHandleUrl: 'https://youtube.com/@z' }),
  };
  assert.equal(applyBackfilledChannelName(meta, { channelId: null, channelUrl: 'https://youtube.com/@z' }, 'Zed'), 2);
  assert.equal(meta.u.channelName, 'Zed');
  assert.equal(meta.h.channelName, 'Zed');
});

test('writer: a blank probed name is a no-op; the name is bounded to 200 chars', () => {
  const meta = { a: chan() };
  assert.equal(applyBackfilledChannelName(meta, { channelId: CH_A }, '   '), 0, 'blank -> no write');
  assert.equal(meta.a.channelName, '');
  applyBackfilledChannelName(meta, { channelId: CH_A }, 'x'.repeat(500));
  assert.equal(meta.a.channelName.length, 200, 'bounded');
});

test('writer: re-running is idempotent (the now-good name is not bad, so a second pass writes 0)', () => {
  const meta = { a: chan() };
  assert.equal(applyBackfilledChannelName(meta, { channelId: CH_A }, 'Real'), 1);
  assert.equal(applyBackfilledChannelName(meta, { channelId: CH_A }, 'Real Again'), 0, 'already good -> untouched');
  assert.equal(meta.a.channelName, 'Real');
});
