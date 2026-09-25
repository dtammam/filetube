---
plan: pocket-lighting-first-tap-ask
harness: v2 · lean
branch: fix/revert-reflection (the v1.329 revert + this change, one release)
anchor: spec
status: In progress
next: ONE gate round (adversary + qa: the permission flow; the revert is byte-identical to v1.328.0's gated files), release v1.330.0
design: this document
gate: pending
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
