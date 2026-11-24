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
- `hapticPress()` in skin-surface.js has a host branch only: no host means no behaviour, and the ghost/switch-tracking path is untouched.
- Called once per accepted press from `onClick` (the click, not pointerdown, so a drag never presses). Every arm of MENU and Select (takeover, volume, list mode, pocket, dock) is covered because the call opens the branch.
- Missing hidden host control for play/prev/next: still presses (the button was pressed; consistent with MENU/Select which also press when they only dock).
- Ghost re-dispatch: the ghost branch returns before the press, and only the re-entered real-target click fires, so one tap is one press.
- A click swallowed by `wheelSuppressClick` after a hold returns first: no press.
- Buzz off in the wheel config silences presses, as it silences ticks.

## Acceptance
- [ ] Each of the five buttons posts exactly one `{type:'haptics.tick', style:'press'}` with a host announcing haptics.
- [ ] Zero with no host, with no haptics capability, with buzz off, for a suppressed post-hold click, for wheel drags, for seek and list-row taps.
- [ ] Adapter accepts `press`, still rejects an unknown style; schema, adapter and doc enums agree (contract test).
- [ ] `npm run test:unit` and `npm run lint` pass.

## Not verified
- Anything on a device: the feel, that the iOS app maps `press`, and that a ghost-routed zone tap on a real phone fires once (covered by reading the code path only, not exercised through the ghost in jsdom).
