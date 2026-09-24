---
plan: pwa-chrome-and-gyro-sheen
harness: v2 · lean
branch: (not started)
anchor: spec
status: Draft
next: NEXT SWING = item 2 (gyro lighting, intake answered G1-G8) as its own branch right after the current follow-ups ship; items 1 + 3 wait for Dean's F1-F3 device answers
design: pending
gate: pending
---

# Next swing: the installed app's top bar, a gyro-driven sheen, and fullscreen borders

Captured 2026-09-24 (Dean, after v1.323.0). **Plan only - nothing is built.** Three items; items 1 and 3
very likely share one root cause, so they should ship on one branch; item 2 is its own branch.

## The ask (Dean's words)

1. "I notice that in PWA, top bar where icon is for phone shows a consistent black/white depending on
   theme. I'd like the theme of iPod to extend up?"
2. "Does PWA have any access to gyroscopic info. If so I'd like the color/shadow on the theme to
   reflect. The sheen from the click wheel etc. I'd like that to be somewhat 'realistic' based on gyro
   data."
3. "I notice that if I full screen a video in a non-dark theme the outer border is white. It just feels
   off. It's like 98% proper full screen with white borders around. Just odd."

## What the tree does today (read 2026-09-24 at 8be20941)

- Every shell declares `<meta name="apple-mobile-web-app-status-bar-style" content="default">`,
  `<meta name="theme-color" content="#cc0000">`, `viewport-fit=cover`; the manifest has
  `"display": "standalone"`, `"theme_color": "#cc0000"`, `"background_color": "#0f0f0f"`.
- With `status-bar-style: default` an installed iOS web app does NOT draw under the status bar:
  iOS paints its own opaque bar (white in light appearance, black in dark), which is exactly the
  "consistent black/white depending on theme" Dean sees. The page, including the pocket skin's
  body color, can never reach that strip.
- Both fullscreen paths already paint black: native fullscreen `#fs-stage:fullscreen { background:
  #000 }`, and the mobile faux fullscreen overlay (`position: fixed; inset: 0; background: #000`,
  safe-area padded). So the "white border" is most likely NOT our fullscreen box: it is the areas
  the page does not own - the opaque status-bar strip at the top (item 1's cause) and, in a light
  theme, whatever the root `html`/`body` background shows in the safe-area insets (the home
  indicator strip, and the sides in landscape) around a fixed overlay that stops at the safe area.
- No code reads `DeviceOrientationEvent` / `DeviceMotionEvent` today.

## Item 1 + 3: let the page own the top (and every edge)

**Hypothesis:** the white (or black) band is iOS's own status-bar strip plus the root background in
the safe-area insets, not our player. **Falsifying questions for Dean (answer before any edit):**
- F1. Installed app only, or also in a Safari tab? (The status-bar meta applies only to the
  installed app; if Safari shows the same border, the hypothesis is wrong.)
- F2. In fullscreen, is the white on all four sides, or only top and bottom (portrait) / top plus the
  notch side (landscape)? A screenshot in a light theme, portrait and landscape.
- F3. Is it the faux fullscreen (our controls over the video) or iOS's native player (Apple's
  controls)?

**Candidate fix (to confirm after F1-F3):**
- Switch the installed app to `apple-mobile-web-app-status-bar-style: black-translucent`: the page
  then draws under the status bar, so the pocket skin's body (Click white / Black / Matte, Seattle
  brown) and the fullscreen black extend to the very top. Every fixed header then pads itself with
  `env(safe-area-inset-top)` (a census: every top-anchored fixed/sticky element).
- Paint the root (`html` background) with the active surface's color so no inset ever shows the
  default white: black while any fullscreen is active; the pocket skin's body color while a skin is
  open; the theme background otherwise.
- **The catch, a decision for Dean:** `black-translucent` always draws the clock/battery text in
  WHITE. Over a light surface (the white Click body, light themes) that text becomes hard to read.
  Options: (a) accept it on light skins; (b) keep a thin darker band behind the status text on light
  surfaces (a gradient from the skin color); (c) use `black-translucent` only while a dark surface
  owns the top (fullscreen, dark themes, the dark skins) - but the meta is read at LAUNCH only, so
  (c) is not switchable at runtime and is likely off the table. Verify on the device; iOS behavior
  here changes between versions (also check whether iOS 15+ applies `theme-color` to the
  installed app's status bar in `default` mode - if so, a runtime `theme-color` update per
  surface is a cleaner route with readable text).
- Android / desktop: update `theme-color` at runtime to the active surface color (Chrome honors it
  live for its toolbar / status bar).
- Measure: screenshots on Dean's iPhone (the only real evidence; headless cannot render iOS chrome),
  plus a headless check that the root background follows the surface.

## Item 2: a gyro-driven sheen

**Feasible.** `DeviceOrientationEvent` works in installed web apps and browser tabs over HTTPS:
- iPhone (iOS 13+): requires `DeviceOrientationEvent.requestPermission()` called from a user tap;
  iOS shows its own Allow / Don't Allow prompt once. No permission API = no motion, the skin stays
  as today.
- Android Chrome: available without a prompt on a secure origin.
- Desktop: no gyro; the skin stays as today.

**Design sketch:**
- An opt-in: the first time a pocket skin opens on a device that supports it, one tap on a
  "Realistic lighting" row (Settings > About's sibling in the pocket menu, or the skin sticker menu)
  asks for motion permission; the choice is remembered on the device.
- The orientation (beta/gamma) is low-pass filtered and written to two CSS custom properties on the
  skin (e.g. `--tilt-x`, `--tilt-y`, clamped to +-1); the click wheel's gloss gradient, the bezel's
  highlight and the Seattle pad's chrome sheen move their highlight position and shadow offset from
  those properties (gradient positions and a small shadow offset only: no filter, blur or large
  animated layer - the old ambient mode's iPhone black-video lesson applies to anything animated).
- Updates are rAF-throttled, only while the skin is visible (stop on dock, hidden tab, skin switch,
  every teardown arm), and off under `prefers-reduced-motion`. Measure battery/CPU on the device.
- Realism reference: sample a real iPod Classic / Zune under a moving light (match-reference norm):
  the highlight slides opposite the tilt, the wheel's rim catches light at the top edge.

**Intake answered (Dean, 2026-09-24 - "once we're done, exclusively work on the PWA gyro feature"):**

| ID | Decision |
|----|----------|
| G1 | **Surfaces: all four.** The Click wheel (gloss, rim, the center button's dome), the iPod body / front face (a moving reflection band; Matte gets a softer sheen), the screen glass (a faint streak, never hurting readability), and Seattle's chrome pad + its two flank buttons. |
| G2 | **Strength: a setting** - Off / Subtle / Pronounced, chosen per device (device-local). |
| G3 | **Light model: a fixed light in the room.** An imagined light stays above the viewer; tilting the phone slides the highlights across the surfaces the opposite way. |
| G4 | **Turning it on: Settings > Lighting in the pocket menu** (beside About). Choosing a strength other than Off from a tap is what calls iOS's `DeviceOrientationEvent.requestPermission()`; Denied or unsupported = a clear note, the look stays as today. |
| G5 | **Neutral pose: how you hold it when the skin opens**, and it slowly re-centers when you settle into a new pose (lying down, on a table), so the light never drifts off permanently. |
| G6 | **Highlights AND shadows move:** the depth shadows shift with the light (the wheel in its recess, the center button's shadow, the Seattle pad's rim), not just the shine. |
| G7 | **Desktop: follow the mouse.** With Lighting on and no gyroscope, the pointer over the player moves the imagined light (the desktop pop-out included); it eases back to neutral when the pointer leaves. |
| G8 | **Scope: the pocket skins only** (Click, Black, Matte, Seattle). Not Cider / Nordic, not the 2009 theme's buttons. |

Open for the design pass (Architect, not Dean): the filter constants (the smoothing time constant, the re-center rate), the tilt-to-offset mapping and clamps, how the Lighting row's strength choice reads in each skin (Click: a settings list with a checkmark; Seattle: Zune-style large type), the reference sampling of a real iPod Classic / Zune under a moving light (match-reference norm), and the battery/CPU measurement plan on Dean's iPhone. Landscape: map the axes by `screen.orientation.angle`.

## Branch plan (when approved)

- `fix/pwa-top-bar-and-fullscreen-edges` (items 1 + 3): slim-to-full gate depending on the header
  census (a layout change on every shell: adversary + qa). Shell-parity census for the meta change
  (it lands on every `public/*.html`).
- `feat/pocket-gyro-sheen` (item 2): adversary + qa; device check required before release (the
  motion prompt and the feel cannot be verified headless beyond a synthetic event stream).

## Acceptance (draft)

- AC1: in the installed app the pocket skin's body color reaches the top edge; the status-bar text
  stays legible per Dean's chosen option (screenshot, light + dark skins).
- AC2: a fullscreen video in a light theme shows no light band on any edge, portrait and landscape
  (screenshot on the iPhone).
- AC3: no header, back button or control sits under the status bar or the notch on any shell
  (census + headless with simulated safe-area insets).
- AC4: with motion allowed, tilting the phone moves the wheel/body highlight smoothly; with it
  denied, unsupported, reduced motion on, or the skin hidden, nothing listens and nothing moves.
- AC5: no listener or rAF loop survives a teardown (count over N mounts).

## Disclosed up front

- iOS reads the status-bar meta only at launch: a change needs the app re-opened (and possibly
  re-added to the home screen) before Dean can see it.
- Headless Chromium cannot show iOS status-bar or safe-area chrome; the device is the only proof for
  items 1 and 3.
