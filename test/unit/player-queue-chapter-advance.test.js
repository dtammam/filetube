'use strict';

// [UNIT] tech-debt #230 (Dean intake, /music "Queued"): a chaptered video
// played from the SERVER queue never advanced to the next queued item at its
// end. ROOT CAUSE: the queue-advance guard compared the pointer entry's
// mediaId against the RAW current id, but a chaptered video played as audio has
// a synthetic `<vid>::c<idx>` current id while its queue entry records the BASE
// media id (`<vid>`) - so the match never fired and playback fell back to
// in-video chapter nav (the "looped back into the same album" symptom). The
// manual prev/next step had the identical guard. Both now route through the
// pure `queuePointerMatchesPlaying`, matching the BASE id (the same base id the
// progress-save path already resolves to) when a chapter track is loaded.
//
// player.js's live 'ended'/manual-step cascade has no jsdom harness in this
// repo (tech-debt #180; CONTRIBUTING.md - the DOM side is Dean's manual test),
// so the binding is the repo's standard pair: the pure decision helper +
// comment-stripped source locks proving BOTH live guards route through it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { queuePointerMatchesPlaying } = require('../../public/js/player.js');

// ---- the pure match rule ----------------------------------------------------

test('a chaptered item matches its BASE-id queue entry (#230, the fix)', () => {
  // The exact failing shape: current id is `<vid>::c<idx>`, the queue entry
  // carries the base id. WITHOUT the base-id fix this returned false and the
  // advance was skipped.
  assert.strictEqual(
    queuePointerMatchesPlaying({ mediaId: 'djmix1' }, 'djmix1::c0', 'djmix1'), true,
    'the ::c chapter id matches its base-id queue entry via baseMediaId');
  assert.strictEqual(
    queuePointerMatchesPlaying({ mediaId: 'djmix1' }, 'djmix1::c7', 'djmix1'), true,
    'any chapter index of the SAME file matches (base id ignores ::c)');
});

test('a non-chapter item matches on the raw id exactly as before (no baseMediaId)', () => {
  assert.strictEqual(queuePointerMatchesPlaying({ mediaId: 'song9' }, 'song9', undefined), true);
  assert.strictEqual(queuePointerMatchesPlaying({ mediaId: 'song9' }, 'song9', ''), true, 'empty baseMediaId is falsy -> raw id');
  assert.strictEqual(queuePointerMatchesPlaying({ mediaId: 'song9' }, 'other', undefined), false);
});

test('a DIFFERENT queue entry never matches (the base id does not over-match)', () => {
  assert.strictEqual(
    queuePointerMatchesPlaying({ mediaId: 'other-video' }, 'djmix1::c0', 'djmix1'), false,
    'a chaptered item playing must not falsely match a different queue entry');
});

test('a missing / malformed pointer entry is never a match', () => {
  assert.strictEqual(queuePointerMatchesPlaying(null, 'djmix1::c0', 'djmix1'), false);
  assert.strictEqual(queuePointerMatchesPlaying(undefined, 'x', 'x'), false);
  assert.strictEqual(queuePointerMatchesPlaying({}, 'x', 'x'), false, 'no mediaId string -> no match');
  assert.strictEqual(queuePointerMatchesPlaying({ mediaId: 42 }, 'x', 'x'), false, 'non-string mediaId -> no match');
});

// ---- source locks: BOTH live guards route through the helper -----------------
// Comment-porous locks are this repo's thrice-paid class - strip comments ONCE,
// then assert on the stripped source only.
const PLAYER_JS_RAW = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'player.js'), 'utf8');
const PLAYER_JS = PLAYER_JS_RAW.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');

test("the 'ended' autoplay cascade guard routes through queuePointerMatchesPlaying with baseMediaId", () => {
  assert.match(PLAYER_JS,
    /queuePointerMatchesPlaying\(pointerEntry, endedId, currentData && currentData\.baseMediaId\)/,
    'the ended-cascade queue-advance guard must match on the base id');
});

test('manualTrackStep routes through queuePointerMatchesPlaying with baseMediaId', () => {
  assert.match(PLAYER_JS,
    /queuePointerMatchesPlaying\(pointerEntry, steppedId, currentData && currentData\.baseMediaId\)/,
    'the manual prev/next queue-advance guard must match on the base id too');
});

test('the OLD raw-id compare is GONE from both guards (verify what the fix removes)', () => {
  // These are the exact expressions the bug lived in; a regression that reverts
  // either guard to the raw current id re-reds here.
  assert.doesNotMatch(PLAYER_JS, /pointerEntry\.mediaId === endedId/,
    'the ended guard must not compare the pointer against the raw ::c ended id');
  assert.doesNotMatch(PLAYER_JS, /pointerEntry\.mediaId === steppedId/,
    'the manual-step guard must not compare the pointer against the raw ::c stepped id');
});
