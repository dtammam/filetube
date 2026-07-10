'use strict';

// [UNIT] v1.24.5 fast-follow (regression lock): `resolveDockTransitionResumeAction`
// is the pure decision extracted from `dock()` (public/js/player.js) for the
// bug found on-device: `resolveDockedResumeAction` (D3, v1.24.0, T13) only
// covers a resume decision made WHILE ALREADY docked -- it does nothing for
// the opposite ordering, where the "Resume at..." prompt is already showing
// (decided while FULL) and the user THEN docks (e.g. navigates back to the
// grid) mid-prompt. Before this fix, `dock()` reparented the persistent host
// into the 160/280px `#player-dock` without ever dismissing the overlay, so
// it rendered at full FULL-player size inside the tiny mini-dock. The DOM-
// heavy wiring (the actual overlay hide + `resumeDirectly()` call at the
// real call site, `dock()`) is intentionally NOT covered here (no jsdom/
// browser harness in this codebase -- see CONTRIBUTING.md); Dean's on-device
// pass is the documented arbiter for whether the dock transition is clean.
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveDockTransitionResumeAction } = require('../../public/js/player.js');

test('resolveDockTransitionResumeAction: a showing resume prompt is dismissed and auto-resumed on dock', () => {
  assert.strictEqual(
    resolveDockTransitionResumeAction({ resumeOverlayVisible: true }),
    'dismiss-and-auto-resume'
  );
});

test('resolveDockTransitionResumeAction: no showing prompt is a no-op on dock (the common case)', () => {
  assert.strictEqual(resolveDockTransitionResumeAction({ resumeOverlayVisible: false }), 'none');
});

test('resolveDockTransitionResumeAction: a missing/undefined ctx is treated as no prompt showing -- never throws', () => {
  assert.strictEqual(resolveDockTransitionResumeAction(undefined), 'none');
  assert.strictEqual(resolveDockTransitionResumeAction({}), 'none');
});

test('resolveDockTransitionResumeAction: outcome matches resolveDockedResumeAction\'s own DOCKED auto-resume intent, just reached from the opposite ordering', () => {
  // Not a literal equality assertion against resolveDockedResumeAction (the
  // return vocabularies differ -- 'auto-resume' vs 'dismiss-and-auto-resume'
  // -- since one call site starts from an as-yet-unshown decision and the
  // other from an already-showing overlay it must actively tear down) but
  // both converge on the SAME player outcome: dismiss/skip the prompt and
  // call resumeDirectly(savedProgress) rather than ever rendering the full
  // prompt inside the mini-dock.
  const fromAlreadyDocked = require('../../public/js/player.js').resolveDockedResumeAction({
    dockState: 'docked',
    resumeDecisionPending: true,
  });
  assert.strictEqual(fromAlreadyDocked, 'auto-resume');
  assert.strictEqual(
    resolveDockTransitionResumeAction({ resumeOverlayVisible: true }),
    'dismiss-and-auto-resume'
  );
});
