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

test('snapShiftBlock with the SAVED list: a source chapter 2 within the gap of chapter 1 (or a source last chapter within the gap of the end) may always be shifted back to where it was saved (gate r2)', () => {
  const saved = [0, 0.05, 60];
  assert.strictEqual(snapShiftBlock(saved, -100, 100, GAP, saved).ok, false, 'at the saved list, earlier is still refused (it would narrow below the saved 50 ms)');
  assert.strictEqual(snapShiftBlock([0, 1.05, 61], -1000, 100, GAP, saved).ok, true, 'after +1 s, -1 s goes back to exactly the saved 50 ms');
  assert.strictEqual(snapShiftBlock([0, 1.05, 61], -1001, 100, GAP, saved).ok, false, 'one millisecond more is refused');
  assert.strictEqual(snapShiftBlock([0, 1.05, 61], -1000, 100, GAP).ok, false, 'without the saved list the plain rule applies');
  const end = [0, 60, 299.95];
  assert.strictEqual(snapShiftBlock(end, 100, 300, GAP, end).ok, false, 'at the saved list, later is still refused');
  assert.strictEqual(snapShiftBlock([0, 59, 298.95], 1000, 300, GAP, end).ok, true, 'after -1 s, +1 s goes back to the saved 50 ms before the end');
  assert.strictEqual(snapShiftBlock([0, 59, 298.95], 1001, 300, GAP, end).ok, false);
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

test('snapShiftSuggestion: the 50 ms "aligned" cutoff is exclusive (adversary A8)', () => {
  assert.deepStrictEqual(snapShiftSuggestion([0, 60, 120], sug([['suggest', 60.05], ['suggest', 120.05]])), { kind: 'suggest', deltaMs: 50, agree: 2, of: 2 }, 'exactly 50 ms is still a shift to offer');
  assert.deepStrictEqual(snapShiftSuggestion([0, 60, 120], sug([['fine', 60.049], ['fine', 120.049]])), { kind: 'aligned', agree: 2, of: 2 }, '49 ms lines up');
});

test('snapGapBreak: a pair breaks only when the edit NARROWS it into the gap AND closer than the saved list; the end likewise (gate r2)', () => {
  const { snapGapBreak } = common;
  // An edit that moves chapter 3 of [0, 10, 12, 20] (saved the same) to the given time.
  const saved = [0, 10, 12, 20];
  const move = (t3) => snapGapBreak([0, 10, t3, 20], saved, saved, 30, GAP);
  assert.strictEqual(move(10.1), null, 'exactly the gap is allowed (as the nudge clamp allows)');
  assert.deepStrictEqual(move(10.05), { index: 2, end: false }, 'inside the gap');
  assert.deepStrictEqual(move(10), { index: 2, end: false }, 'an equal pair');
  assert.deepStrictEqual(move(9), { index: 2, end: false }, 'out of order');
  assert.deepStrictEqual(snapGapBreak([0, 10, 10.2, 20], saved, saved, 30, 0.3), { index: 2, end: false }, 'the gap is the one passed in (the server\'s)');
  assert.strictEqual(snapGapBreak([0, 10, 10.2, 20], saved, saved, 30, GAP), null);
  // A close pair that came from the SOURCE: an edit that does not narrow it is never refused.
  const src = [0, 10, 10.05, 20];
  assert.strictEqual(snapGapBreak(src, src, src, 30, GAP), null, 'the saved list itself is never a break');
  assert.strictEqual(snapGapBreak([0, 11, 11.05, 21], src, src, 30, GAP), null, 'a shift keeps the pair at its saved gap');
  assert.strictEqual(snapGapBreak(src, [0, 11, 11.05, 21], src, 30, GAP), null, 'a Reset that returns the pair to its saved gap');
  assert.deepStrictEqual(snapGapBreak([0, 10, 10.02, 20], src, src, 30, GAP), { index: 2, end: false }, 'narrowed below the saved 50 ms: a real new violation');
  assert.strictEqual(snapGapBreak([0, 10, 10.07, 20], src, src, 30, GAP), null, 'widened but still inside the gap: no worse than saved, not refused');
  // A pair the edit does not change is never checked (before = next for that pair), even when it
  // is inside the gap and closer than saved (a nudge squeezed between two close neighbours can
  // leave one): only the pairs the edit narrows count.
  const squeezed = [0, 10, 10.1, 10.15, 100];
  const squeezedSaved = [0, 10, 10.05, 10.15, 100];
  assert.strictEqual(snapGapBreak([0, 10, 10.1, 10.15, 101.75], squeezed, squeezedSaved, 300, GAP), null, 'moving chapter 5 does not answer for the squeezed pair');
  assert.deepStrictEqual(snapGapBreak([0, 10, 10.1, 10.15, 101.75], null, squeezedSaved, 300, GAP), { index: 3, end: false }, 'with no `before`, every pair is checked (the caller must pass it)');
  // The end of the file: narrowed, inside the gap, and closer than saved.
  const e = [0, 10, 20];
  assert.deepStrictEqual(snapGapBreak([0, 10, 29.95], e, e, 30, GAP), { index: 2, end: true }, 'inside the gap before the end');
  assert.strictEqual(snapGapBreak([0, 10, 29.9], e, e, 30, GAP), null, 'exactly the gap before the end');
  assert.deepStrictEqual(snapGapBreak([0, 10, 30.9], e, e, 30, GAP), { index: 2, end: true }, 'past the end');
  assert.strictEqual(snapGapBreak([0, 10, 30.9], e, e, null, GAP), null, 'no known end');
  const nearEnd = [0, 10, 29.95];
  assert.strictEqual(snapGapBreak(nearEnd, [0, 9, 28.95], nearEnd, 30, GAP), null, 'a SOURCE last chapter 50 ms from the end: going back to it is fine');
  assert.strictEqual(snapGapBreak([0, 12, 29.95], nearEnd, nearEnd, 30, GAP), null, 'the end is checked only when the last row moves (adversary r2 S3): a middle edit is not refused for a source-close end');
  assert.deepStrictEqual(snapGapBreak([0, 10, 29.97], [0, 10, 29.9], [0, 10, 29.8], 30, GAP), { index: 2, end: true }, 'narrowed past both the gap and the saved distance');
  assert.strictEqual(snapGapBreak([0, 12, 29.97], [0, 10, 29.97], [0, 10, 29.9], 30, GAP), null,
    'a last chapter ALREADY closer to the end than saved and the gap: a middle edit that does not move it is not refused for it (adversary r2 S3)');
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
