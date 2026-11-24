---
plan: press-haptic
harness: v2 · solo
branch: feat/press-haptic
anchor: outcome
status: Building
next: supervisor runs the review gate on the committed branch
gate: pending
---
# Press haptic for the wheel buttons

Dean approved: pressing MENU, play/pause, previous, next and the centre Select on the click-wheel skins gives a native haptic. New add-only `haptics.tick` style `press`; the iOS app plays its firmest click (intensity 1, sharpness 1; the iOS side, not this repo). No sound.

## Decisions
- Contract: `press` added to the schema enum, the adapter enum and the doc row. Older hosts drop an unknown style, so it is safe for old apps.
- Wheel only (supervisor, gate r1): `hapticPress(e)` returns unless the tapped element is one of the five buttons inside `.ip-wheel`. The Cider and Nordic bars share the play/prev/next arms but are not a wheel: zero presses there.
- A-Z picker open (supervisor, gate r1): `pocket.onPanelClick` eats the tap, but a tap on a wheel button still gets exactly one press (it was physically pressed); any other tap gets none.
- `hapticPress()` in skin-surface.js has a host branch only: no host means no behaviour, and the ghost/switch-tracking path is untouched.
- Called once per accepted press from `onClick` (the click, not pointerdown, so a drag never presses). Every arm of MENU and Select (takeover, volume, list mode, pocket, dock) is covered because the call opens the branch.
- Missing hidden host control for play/prev/next: still presses (the button was pressed; consistent with MENU/Select which also press when they only dock).
- Ghost re-dispatch: the ghost branch returns before the press, and only the re-entered real-target click fires, so one tap is one press.
- A click swallowed by `wheelSuppressClick` after a hold returns first: no press.
- Buzz off in the wheel config silences presses, as it silences ticks.

## Acceptance
- [ ] Each of the five buttons posts exactly one `{type:'haptics.tick', style:'press'}` with a host announcing haptics.
- [ ] Zero with no host, with no haptics capability, with buzz off, for a suppressed post-hold click, for wheel drags, for seek and list-row taps.
- [ ] Cider and Nordic skins: zero presses. Picker open: one press per wheel-button tap, none elsewhere.
- [ ] MENU and Select press exactly once in the takeover, volume-open and list-mode arms (mutants moving the press below those arms go red).
- [ ] Adapter accepts `press`, still rejects an unknown style; schema, adapter and doc enums agree (contract test).
- [ ] `npm run test:unit` and `npm run lint` pass.

## Not verified
- Anything on a device: the feel, that the iOS app maps `press`, and that a ghost-routed zone tap on a real phone fires once (covered by reading the code path only, not exercised through the ghost in jsdom).
- The doc row carries v1.409.0 as the version this ships as (current package.json is 1.408.0); the supervisor confirms at release.

Gate: CHANGES r1 @a0533353 — qa

Gate: CHANGES r1 @a0533353c46f1374ddff5d33d5ff156da9ac9cfa — adversary (W1: Cider/Nordic play/prev/next post press, not a wheel; W2: MENU/Select takeover, volume and list-mode arms unbound, mutants survive)

Gate: APPROVED r2 @6d606bf6 — qa

Gate: APPROVED r2 @6d606bf63405c604e7276aa161459677dc1529ed — adversary (W1, W2 fixed as prescribed, M6/M6b/M6c/M7/M7b killed; S: picker-open tap on the wheel ring itself not bound, mutant "drop the button filter" survives)
