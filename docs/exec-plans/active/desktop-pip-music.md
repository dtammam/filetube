# Exec plan: Desktop pop-out music player (Document PiP + window fallback)

Status: ACTIVE. Branch `feat/desktop-pip-music` off main (post v1.233.0).
Owner: main session (lean mode). Target: v1.234.0.

## Intent (Dean)

"Keep everything as it's beautiful" (the mobile skins stay untouched). NEW: on
DESKTOP, someone listening to music can pop the player out into a small floating
window that shows the music skin (the iPod view et al), appropriately sized -
so the little player hovers while they do other things.

## Decisions (locked with Dean at intake)

1. **What it is:** the **Document Picture-in-Picture API** (arbitrary-DOM always-on-top
   window), NOT classic video PiP (which can only show `<video>` pixels - no custom UI).
2. **Skin shown:** HONOR THE PICKED music skin (Cider / Nordic / Pocket Classic /
   Pocket Classic Black) - the same `ft-music-skin` the mobile player uses.
3. **Mechanism:** BOTH, best-available - Document PiP where supported (Chrome/Edge
   desktop = always-on-top float over everything), a plain `window.open` independent
   window everywhere else (Safari/Firefox desktop = normal window, movable to a second
   monitor, NOT always-on-top). One "pop out" button, picks the best each browser can do.
4. **Reach:** DESKTOP only. On mobile the button is hidden (mobile already IS the
   full-screen skin on tap). `window.open` works on every desktop browser, so the button
   shows on all desktop browsers; only truly unsupported contexts hide it.

## The load-bearing insight (VERIFIED, not a theory)

The entire skin stylesheet block (`.mms-full` + every `.mms-*`/`.ip-*` rule) lives inside
`@media (max-width: 768px)` (style.css:10953). A CSS media query keys off the OWN
document's viewport width. So if we open the pop-out at a **phone-ish width (< 768px,**
**e.g. 380px)**, the pop-out document's viewport is narrow and the existing mobile skin CSS
**applies automatically** - all four skins render exactly as they do on a phone, with
**zero per-skin re-layout**. This is why "honor the picked skin" is cheap: we are not
re-styling the full-screen skins for a small box; we are giving them the small box they
were already designed for. (Falsifier if this were wrong: a skin renders unstyled/huge in
the pop-out - caught by the render tests + Dean's device pass.)

Free bonus: the v1.233 click-wheel gesture is Pointer events, which cover MOUSE input, so
in a desktop pop-out the wheel spins with a **mouse click-drag** - no extra work.

## Architecture

The pop-out is a SECOND render surface for the existing skin system. The audio engine is
untouched: the pop-out renders a skin (pure presentation) that PROXIES its `data-skin-*`
hooks back to the MAIN tab's hidden controls (`#pp-btn` / `#track-prev-btn` /
`#track-next-btn` / `#seek-bar` / `#music-shuffle-btn`) and REFLECTS the MAIN tab's
`#media-player`. **player.js stays BYTE-UNCHANGED.** MediaSession / background-audio /
lock-screen all remain in the main tab, unaffected.

Same JS realm: both `documentPictureInPicture.requestWindow()` and `window.open()` are
opened FROM the main window; listeners we attach to the pop-out's elements run in the
MAIN window's realm, so `document.getElementById(...)` inside a proxy handler still
resolves the MAIN document's controls. That is what makes cross-document proxying work.

### Pieces

1. **Extract the skin wiring into ONE shared binder.** Today music.js binds the
   `data-skin-*` click proxy + the wheel gesture + `reflectSkin` to the in-tab
   `nowPlayingPanel`. Refactor these into a single reusable `bindSkinSurface(panel, opts)`
   (opts: `getControl`, `playAt`, `dock`, `onListToggle`, ...) so BOTH the in-tab mobile
   panel AND the pop-out panel share ONE implementation. Prediction: exactly ONE
   definition of the `data-skin-*` proxy + wheel-gesture logic after the wave
   (grep-verifiable), no copy.
2. **`reflectSkin` becomes panel-parameterized** and is called for every live skin
   surface (in-tab if present + pop-out if open), driven by the SAME media-element event
   listeners (bound once to `#media-player`).
3. **Pop-out manager (new, desktop-only module or a music.js section):**
   - `isPipSupported()` = desktop form factor (reuse `isMobileFormFactor` - never a second
     mobile check) AND (`window.documentPictureInPicture` OR `window.open` available).
   - Open: user-gesture button -> if Document PiP available `documentPictureInPicture
     .requestWindow({ width, height })`, else `window.open('', 'ft-music-pip',
     'width=..,height=..')`. Phone-ish size (~380 x 700) so the mobile CSS engages.
   - Style injection: append `<link rel="stylesheet" href="/css/style.css">` (+ any other
     app stylesheets) into the pop-out `document.head`. Same-origin -> loads. (Prefer a
     link over cssText copy: no CORS/adopted-sheet complexity, one source of truth.)
   - Render: build the panel element `music-nowplaying-panel mms mms-full mms-<id>
     [mms-<base>]` for the picked skin, `innerHTML = SKINS.renderFull(id, buildSkinCtx())`,
     append to the pop-out body; `bindSkinSurface(panel, ...)`; start reflecting.
   - Live: on media events reflect into it; on TRACK change re-render it (mirror
     `renderNowPlayingSkin`); on SKIN change (Settings) re-render it.
   - Close: `pagehide`/window `unload` (window.open) or the PiP window's close event ->
     teardown (unbind, stop reflecting, drop from the surface set), restore the button.
   - Only ONE pop-out at a time; opening again focuses/replaces.
4. **The "pop out" button:** in the DESKTOP music player UI (near the now-playing / player
   controls). Shown only when `isPipSupported()`. Icon + label "Pop out". Toggles
   open/close.

### What does NOT change
- The mobile in-tab skin behavior (gate, render, gesture) - identical.
- player.js - byte-identical (assert in tests + the gate).
- The default desktop music player in the main tab stays visible and functional; the
  pop-out is ADDITIVE (audio still plays from the main tab).
- No new server routes, no new runtime deps.

## Task breakdown (small green commits)

- **T1 - Refactor to `bindSkinSurface` + panel-parameterized `reflectSkin`.** Pure
  refactor; the in-tab mobile skin keeps identical behavior (existing 49 skin tests stay
  green, unchanged). Prediction: one proxy/gesture definition (grep == 1).
- **T2 - Pop-out manager + style injection + open/close lifecycle** (Document PiP path).
  jsdom: stub `window.documentPictureInPicture.requestWindow` to return a fake window with
  its own `document`; assert the skin panel is rendered into it, the stylesheet link is
  injected, and teardown fires on close.
- **T3 - `window.open` fallback path** for non-PiP desktop browsers (writes a minimal HTML
  doc + the same stylesheet link + the panel). jsdom: stub `window.open`.
- **T4 - The desktop "pop out" button** + `isPipSupported` gating (desktop + capability);
  hidden on mobile and where neither mechanism exists. Toggle open/close, reflect the
  open state on the button.
- **T5 - Cross-document proxy + reflect + track/skin re-render into the pop-out**
  (behavioral: a click on the pop-out's `data-skin-play` reaches the MAIN `#pp-btn`; a
  media `timeupdate` updates the pop-out's `.mms-fill`; a track change re-renders it).
- **T6 - Docs/release:** ROADMAP + releases.json ledger + this plan -> completed/.

## Test strategy (jsdom, no real PiP)

- Stub `documentPictureInPicture.requestWindow` -> a `new JSDOM()` window (its own
  `document`), and `window.open` -> similar, so both surfaces are drivable.
- Bind BOTH axes of every reveal/teardown: open populates + styles + reflects; CLOSE
  unbinds + stops reflecting + restores the button (a CLEAR test on a surface born empty is
  vacuous - populate first, then close, then assert gone).
- Proxy reachability (INERT-feature guard): assert a pop-out `data-skin-*` click actually
  reaches the MAIN document's control (not just that a handler exists).
- Button gating: desktop+supported shows; mobile hides; neither-mechanism hides.
- player.js byte-identity asserted in the gate (`git diff` empty).

## Risks / falsifiers (brief the gate on these)

- **iOS/Safari/mobile:** Document PiP unsupported; `window.open` on mobile opens a tab
  (janky) - hence desktop-only gating. Falsifier: button appears on mobile -> bug.
- **Style FOUC / unstyled pop-out:** stylesheet link must land before/with the panel;
  verify the skin is actually styled (the narrow-viewport assumption). Falsifier: skin
  renders full-width/unstyled.
- **Cross-realm listeners:** confirm proxy handlers (attached from the opener) reach main
  controls; if a browser runs window.open in a separate realm for some reason, `getControl`
  must still target the MAIN document (it uses the opener's `document`).
- **Leaked surface / double-reflect:** closing the pop-out MUST drop it from the reflected
  set (else reflectSkin queries a dead document). Teardown on every arm (window close, tab
  pagehide, track/skin change replacing the panel).
- **Popup blocker:** window.open must be inside the click gesture (it is).
- **One-at-a-time:** re-opening while open should focus/replace, not leak a second window.

## Gate

FULL two-reviewer gate (new cross-document surface + a refactor of the shared skin
wiring). Brief the adversarial seat to: prove the in-tab mobile skin is behaviorally
UNCHANGED by the T1 refactor (mutate the shared binder, watch both surfaces red); attack
the teardown/leak arms (close, tab-nav, track-change, skin-change); confirm player.js
byte-identity; and prove the proxy REACHES the main controls (not a dead handler).
Dual-Node before release.
