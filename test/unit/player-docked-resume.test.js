'use strict';

// [UNIT] D3 (v1.24.0, T13): the pure docked-resume-decision helper extracted
// from the persistent player controller (public/js/player.js). Problem: the
// docked mini-player (`#player-dock`, 280px desktop / 160px mobile -- see
// style.css) is too small to legibly read/tap the "Resume at.../Start over"
// choice, so a resume decision that fires while DOCKED needs a different,
// deterministic outcome than the normal FULL-player overlay. Recommended
// behavior implemented here (the ONE behavior chosen -- NOT the rejected
// "expand-to-FULL" alternative, per the exec plan's D3): DOCKED suppresses
// the overlay and resumes directly in the mini-player instead. The DOM-heavy
// wiring (the actual overlay show/hide vs. `mediaPlayer.currentTime`/`play()`
// calls at the real call site, `handleResumePlayback`) is intentionally NOT
// covered here (no jsdom/browser harness in this codebase -- see
// CONTRIBUTING.md); Dean's on-device pass is the documented arbiter for
// whether the docked resume is legible/tappable in practice.
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveDockedResumeAction } = require('../../public/js/player.js');

test('resolveDockedResumeAction: no resume decision pending is always a no-op, regardless of dock state', () => {
  assert.strictEqual(resolveDockedResumeAction({ dockState: 'full', resumeDecisionPending: false }), 'none');
  assert.strictEqual(resolveDockedResumeAction({ dockState: 'docked', resumeDecisionPending: false }), 'none');
  assert.strictEqual(resolveDockedResumeAction({ dockState: 'closed', resumeDecisionPending: false }), 'none');
});

test('resolveDockedResumeAction: a pending decision while FULL shows the overlay normally (plenty of room)', () => {
  assert.strictEqual(resolveDockedResumeAction({ dockState: 'full', resumeDecisionPending: true }), 'prompt');
});

test('resolveDockedResumeAction: a pending decision while DOCKED suppresses the overlay and auto-resumes in the mini-player', () => {
  assert.strictEqual(resolveDockedResumeAction({ dockState: 'docked', resumeDecisionPending: true }), 'auto-resume');
});

test('resolveDockedResumeAction: a pending decision while CLOSED (defensive -- never reached in practice, see handleResumePlayback\'s gen guard) degrades to prompt rather than silently dropping the decision', () => {
  assert.strictEqual(resolveDockedResumeAction({ dockState: 'closed', resumeDecisionPending: true }), 'prompt');
});

test('resolveDockedResumeAction: a missing/undefined ctx is treated as no decision pending -- never throws', () => {
  assert.strictEqual(resolveDockedResumeAction(undefined), 'none');
  assert.strictEqual(resolveDockedResumeAction({}), 'none');
});

test('resolveDockedResumeAction: DOCKED auto-resume applies uniformly regardless of any extra fields a caller passes (e.g. a form-factor signal)', () => {
  // The mini-player is small on EVERY form factor (280px desktop / 160px
  // mobile), so the chosen behavior does not branch on mobile vs desktop --
  // an extra/irrelevant field on ctx must not change the outcome.
  assert.strictEqual(resolveDockedResumeAction({ dockState: 'docked', resumeDecisionPending: true, isMobile: true }), 'auto-resume');
  assert.strictEqual(resolveDockedResumeAction({ dockState: 'docked', resumeDecisionPending: true, isMobile: false }), 'auto-resume');
});
