---
plan: pocket-lighting-first-tap-ask
harness: v2 · lean
branch: fix/revert-reflection (the v1.329 revert + this change, one release)
anchor: spec
status: Shipped v1.330.0
next: ONE gate round (adversary + qa: the permission flow; the revert is byte-identical to v1.328.0's gated files), release v1.330.0
design: this document
gate: APPROVED r1 @256a4539 (adversary, the floor seat alone by Dean's call for speed); suggestions filed as #277
---

# Pocket lighting: ask for motion access from the first tap, not from Settings

Dean (2026-09-25, on the installed app): "if I force close my app and reopen it, the PWA, I have to go
to settings to re-enable the pronounced or subtle option because it doesn't wake on. And every time I
close and reopen, I'm prompted ... How can I stop that? How can it just be on?"

## What the tree does today (v1.328.0's lighting, restored byte-for-byte by this branch after Dean's device check reverted v1.329.0)

- iOS does not persist a home-screen web app's `DeviceOrientationEvent` grant across launches, and
  `requestPermission()` may only be called from inside a user gesture. iOS Settings exposes no motion
  toggle for a PWA (only Notifications). The old global Safari "Motion & Orientation Access" switch went
  with iOS 13. A Safari TAB remembers the grant per site; the installed app does not.
- Behind a permission API with no fine pointer, the driver (v1.327 r2 fix) does not light until the first
  sensor sample proves the sensor streams; with no grant nothing streams, so the panel stays as Off and
  the ONLY place that asks is the Settings > Lighting row - hence the trip to Settings every launch.

## Design

- With a strength stored, a permission API present, no fine pointer and no grant this session, the driver
  arms a ONE-SHOT capture listener for `click` and `touchend` on the document at `sync()`. The first tap
  anywhere in the app (Play, the wheel, a menu row, the browse view) calls `requestPermission()` from
  inside that gesture. Granted: samples stream and the panel lights as before, with the stored strength.
  Denied: the note (the Lighting row shows it), not lit, nothing bound that streams - exactly the
  Lighting-row path's outcome.
- Once per session (`askedThisSession`): a Lighting-row pick counts as the session's ask (the row asks
  itself), a streaming sample counts as a grant and disarms the listener; stop()/destroy()/Off disarm it.
  A desktop (fine pointer), Android (no permission API) and Off never arm it.
- The prompt itself cannot be avoided on iOS; what goes away is the trip to Settings. Disclosed to Dean.

## Acceptance

- AC1: a relaunch with a strength stored, behind a permission API, no fine pointer: NOT lit, one capture
  `click` + one `touchend` listener on the document, no ask without a gesture; the first tap asks exactly
  once and unbinds; a grant lights on the first sample with the stored strength (Pronounced = strong).
- AC2: a deny from the tap: not lit, nothing bound that streams, the note in the Lighting level; the
  Lighting row still asks itself on a re-pick.
- AC3: Off, a fine pointer, no permission API: never armed. A grant this session: no ask armed on a
  repaint. Off and destroy disarm the listener (counts asserted).
- AC4: the rest of the lighting suite is v1.328.0's (15 tests) unchanged; the four lighting files match dd5470a1 byte-for-byte apart from this change to the driver and its test.

## Disclosed up front

- The iOS prompt still appears once per launch; iOS gives no way to remember a home-screen app's motion
  grant. The change removes the trip into Settings, not the prompt.
- The Cider / Nordic skins and Seattle never arm it (the driver is Click-only).

## Gate r1 - adversary

Gate: APPROVED r1 @256a4539 — adversary

Measured in a sandbox from `git archive 256a4539`. Revert: `git diff dd5470a1 256a4539 -- public/css/style.css scripts/pocket-lighting-probe.js | wc -l` = 0; the JS/test diff vs dd5470a1 is only the first-tap ask. `node --test test/unit/pocket-lighting.test.js`: 16 tests, 16 pass, 0 fail; eslint exit 0; `npm run lint:css` TOTAL 0.
Mutants (13): killed 6 (stop-no-disarm, arm-ignores-litGated, ask-no-disarm, deny-no-note, no-touchend, sync-no-arm). SURVIVED 7: drop `askedThisSession = true` in askFromGesture; drop the choose() supersede line; drop the sample-is-a-grant line; drop `permission === 'granted'` in arm or in ask; drop `destroyed` or `askedThisSession` in arm. Each is backed by another guard in the engine paths I drove (a deny makes wanted() false so nothing re-arms; a grant blocks it), so no double ask ships, but the "once per session / a row pick or a sample supersedes" claims are not bound by the test.
Gesture validity (primary source, WebKit main): DeviceOrientationEvent.cpp rejects with NotAllowedError only when the controller would still prompt and `UserGestureIndicator::processingUserGesture` is false; EventHandler.cpp (non-iOS touch path) runs the WHOLE touch dispatch under `IsProcessingUserGesture::Yes` and marks touchend activation-triggering, so a capture-phase document listener counts and the wheel's preventDefault cannot remove it. The iOS touch path is in closed WebKitAdditions: SHOULD WORK, not verified on a device. A wheel drag the browser takes as a scroll ends in touchcancel, not touchend: no ask, still armed for the next tap (it is not used up).
Double ask: none found. A view swap (a new driver) re-arms, but the per-origin `m_accessStatePerOrigin` in DeviceOrientationAndMotionAccessController.cpp answers without a prompt once decided: acceptable.
Balance (scratch test, 4 cycles): paint 1/1, dock 0/0, repaint 1/1, hidden 0/0, return 1/1, destroy 0/0; pop-out with a coarse pointer arms 1, then 0 after its destroy; destroy while the ask is pending, then a late grant: 0 listeners, not lit.
SUGGESTION (verified in jsdom; iOS reachability is a suspicion): a REJECTED ask (NotAllowedError, no gesture) is recorded as `permission 'denied'`, gets NOTE_DENIED ("Motion access was denied") and uses up the session's ask, so the user sees a deny they never made. Only reachable if a click comes from script with no gesture. Fix: on a reject, clear askedThisSession and re-arm.
SUGGESTION: add tests that kill the 7 surviving mutants.
Process note: the live tree's HEAD is 402f4452 (a merge into release/v1.330.0 made before this verdict). It has no public/test/scripts delta from 256a4539, so this approval carries over.
