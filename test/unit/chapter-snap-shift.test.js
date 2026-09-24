'use strict';

// [UNIT] Chapter Snap "Shift all" (Dean 2026-09-24): the pure helpers the editor uses
// (public/js/common.js formatSnapShift, snapShiftBlock, snapShiftSuggestion) and the phone
// sizing of the new row. The editor itself is driven against the real server in
// test/integration/chapter-snap-shift.test.js. Plan:
// docs/exec-plans/active/2026-09-24-snap-offset-status-bar.md.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const common = require('../../public/js/common.js');
const snap = require('../../lib/media/chapterSnap');

const { formatSnapShift, snapShiftBlock, snapShiftSuggestion } = common;
const GAP = snap.MIN_CHAPTER_GAP_SEC; // the server's constant, as the editor state carries it

test('formatSnapShift: signed seconds, trimmed, at least one decimal, the nudges\' minus sign', () => {
  assert.strictEqual(formatSnapShift(2300), '+2.3 s');
  assert.strictEqual(formatSnapShift(1750), '+1.75 s');
  assert.strictEqual(formatSnapShift(2000), '+2.0 s');
  assert.strictEqual(formatSnapShift(-100), '−0.1 s');
  assert.strictEqual(formatSnapShift(-1234), '−1.234 s');
});

test('snapShiftBlock EARLIER: refused when chapter 2 would land AT or before chapter 1 + the minimum gap, allowed one millisecond later', () => {
  // chapter 1 at 10 s, chapter 2 at 10.5 s: the floor is 10 + 0.1 = 10.1 s.
  const t = [10, 10.5, 50, 90];
  assert.deepStrictEqual(snapShiftBlock(t, -400, 100, GAP), { ok: false, dir: 'earlier', reason: 'Shifting earlier would put chapter 2 at or before chapter 1.' }, 'exactly AT the floor is refused');
  assert.deepStrictEqual(snapShiftBlock(t, -399, 100, GAP), { ok: true }, 'one millisecond above the floor is fine');
  assert.strictEqual(snapShiftBlock(t, -1000, 100, GAP).ok, false);
  assert.strictEqual(snapShiftBlock(t, 1000, 100, GAP).ok, true, 'the other direction is not blocked by chapter 1');
  // The gap is the one passed in (the server's), never a hand copy: a 0.3 s gap moves the floor.
  assert.strictEqual(snapShiftBlock(t, -250, 100, 0.3).ok, false, '10.25 <= 10.3');
  assert.strictEqual(snapShiftBlock(t, -150, 100, 0.3).ok, true, '10.35 > 10.3');
});

test('snapShiftBlock LATER: refused when the last chapter would land AT or past the end - the gap; no end known -> no later bound', () => {
  const t = [0, 40, 99.5];
  assert.deepStrictEqual(snapShiftBlock(t, 400, 100, GAP), { ok: false, dir: 'later', reason: 'Shifting later would put the last chapter at or past the end of the file.' }, '99.9 is AT 100 - 0.1');
  assert.deepStrictEqual(snapShiftBlock(t, 399, 100, GAP), { ok: true });
  assert.strictEqual(snapShiftBlock(t, -1000, 100, GAP).ok, true, 'earlier is not blocked by the end');
  assert.strictEqual(snapShiftBlock(t, 5000, null, GAP).ok, true, 'an unknown duration has no end to hit');
  assert.strictEqual(snapShiftBlock([0], 100, 100, GAP).ok, false, 'one chapter: nothing to shift');
});

// Suggestions in the server's shape (lib/media/chapterSnap.js suggestSnaps).
const sug = (entries) => [{ index: 0, status: 'first', time: 0 }].concat(entries.map((e, i) => (
  e === null ? { index: i + 1, status: 'no-gap', time: null } : { index: i + 1, status: e[0], time: e[1] })));

test('snapShiftSuggestion AGREE: every boundary off by the same amount -> suggest the median, with n of m', () => {
  const times = [0, 60, 120, 180, 240];
  const g = snapShiftSuggestion(times, sug([['suggest', 61.75], ['suggest', 121.8], ['suggest', 181.7], ['suggest', 241.75]]));
  assert.deepStrictEqual(g, { kind: 'suggest', deltaMs: 1750, agree: 4, of: 4 });
  // 60 % is enough: 3 of 5 within 0.3 s of the median.
  const g3 = snapShiftSuggestion([0, 60, 120, 180, 240, 300], sug([['suggest', 62], ['suggest', 122.2], ['suggest', 181.9], ['suggest', 175], ['suggest', 310]]));
  assert.strictEqual(g3.kind, 'suggest');
  assert.strictEqual(g3.agree, 3);
  assert.strictEqual(g3.of, 5);
  assert.strictEqual(g3.deltaMs, 2000);
  // An even count takes the midpoint of the middle two.
  assert.deepStrictEqual(snapShiftSuggestion([0, 10, 20], sug([['suggest', 12], ['suggest', 22.2]])), { kind: 'suggest', deltaMs: 2100, agree: 2, of: 2 });
});

test('snapShiftSuggestion DISAGREE: under 60 % within +-0.3 s of the median -> no consistent offset', () => {
  // Two late by 2 s, two early by 4-5 s.
  assert.deepStrictEqual(snapShiftSuggestion([0, 60, 120, 180, 240], sug([['suggest', 62], ['suggest', 122], ['suggest', 175], ['suggest', 236]])).kind, 'none');
  // Two of four agree ON the median (50 %): under the 60 % share, so no suggestion.
  assert.deepStrictEqual(snapShiftSuggestion([0, 60, 120, 180, 240], sug([['suggest', 62], ['suggest', 122], ['suggest', 185], ['suggest', 236]])), { kind: 'none', agree: 2, of: 4 });
  // Two clusters: the median falls between them, nothing agrees.
  assert.deepStrictEqual(snapShiftSuggestion([0, 60, 120, 180, 240], sug([['suggest', 61.75], ['suggest', 116.75], ['suggest', 181.75], ['suggest', 236.75]])), { kind: 'none', agree: 0, of: 4 });
  // Just outside the tolerance: 0.301 s from the median does not agree.
  const edge = snapShiftSuggestion([0, 60, 120, 180], sug([['suggest', 62], ['suggest', 122], ['suggest', 182.301]]));
  assert.deepStrictEqual(edge, { kind: 'suggest', deltaMs: 2000, agree: 2, of: 3 }, '2 of 3 = 67 % still suggests; the 0.301 s one is not counted');
  const edgeIn = snapShiftSuggestion([0, 60, 120, 180], sug([['suggest', 62], ['suggest', 122], ['suggest', 182.3]]));
  assert.strictEqual(edgeIn.agree, 3, 'exactly 0.3 s agrees');
});

test('snapShiftSuggestion FINE boundaries count as evidence: two boundaries off by 2 s and three already on the silence is NOT a whole-track offset', () => {
  const g = snapShiftSuggestion([0, 60, 120, 180, 240, 300], sug([['suggest', 62], ['suggest', 122], ['fine', 180.02], ['fine', 239.98], ['fine', 300]]));
  assert.deepStrictEqual(g, { kind: 'aligned', agree: 3, of: 5 }, 'the median is the fine ones: nothing to shift');
  const g2 = snapShiftSuggestion([0, 60, 120, 180, 240], sug([['suggest', 62], ['suggest', 122], ['fine', 180.05], ['suggest', 236]]));
  assert.strictEqual(g2.kind, 'none', 'with the fine one counted there is no majority (without it, 2 of 3 would suggest +2 s)');
});

test('snapShiftSuggestion TOO FEW: fewer than two boundaries with a snap point (no-gap boundaries do not count)', () => {
  assert.deepStrictEqual(snapShiftSuggestion([0, 60], sug([['suggest', 62]])), { kind: 'few', agree: 0, of: 1 });
  assert.deepStrictEqual(snapShiftSuggestion([0, 60, 120, 180], sug([['suggest', 62], null, null])), { kind: 'few', agree: 0, of: 1 });
  assert.deepStrictEqual(snapShiftSuggestion([0, 60, 120], sug([null, null])), { kind: 'few', agree: 0, of: 0 });
  assert.strictEqual(snapShiftSuggestion([0, 60, 120], null).kind, 'few', 'no suggestions at all');
});

test('snapShiftSuggestion measures from the CURRENT times: after the shift is applied the same silence reads "aligned"', () => {
  const s = sug([['suggest', 61.75], ['suggest', 121.75], ['suggest', 181.75]]);
  assert.strictEqual(snapShiftSuggestion([0, 60, 120, 180], s).deltaMs, 1750);
  assert.deepStrictEqual(snapShiftSuggestion([0, 61.75, 121.75, 181.75], s), { kind: 'aligned', agree: 3, of: 3 });
});

// ---- phone sizing (the probe measures it; this lock keeps the rule from silently dropping) ----
const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('the Shift all buttons are 44 px touch targets in the phone arm and control-height on desktop (comment-stripped lock)', () => {
  const phone = /@media \(max-width: 600px\), \(max-height: 500px\) \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(phone, 'the chapter snap phone arm exists');
  const touch = /([^{}]+)\{\s*min-height: var\(--size-touch\);\s*\}/.exec(phone[1]);
  assert.ok(touch, 'the phone arm has a size-touch rule');
  assert.ok(touch[1].split(',').map((x) => x.trim()).includes('.chapter-snap-shift .btn'), 'the shift row\'s buttons are in the 44 px list: ' + touch[1]);
  const desk = /([^{}@]+)\{\s*min-height: var\(--size-control\);\s*justify-content: center;\s*\}/.exec(css);
  assert.ok(desk && desk[1].split(',').map((x) => x.trim()).includes('.chapter-snap-shift .btn'), 'and in the desktop control-height list');
});
