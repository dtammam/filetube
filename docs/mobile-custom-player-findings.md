# Mobile custom video player — findings & future swings (v1.34.x, 2026-07-13)

**Status: PAUSED by Dean's call after five on-device iteration rounds.** The
`mobileCustomPlayer` setting remains in the product (Settings → Playback,
default **OFF** = native iOS controls) but is considered **EXPERIMENTAL**:
Dean is staying on native iOS video controls for now. Mobile **AUDIO**
remains fully custom and is the gold standard here — "it just always works."

This document is the honest record: what we built, what genuinely works,
what defeated us, and what a future swing should do differently.

---

## Why we tried

The custom bar on mobile would unify chapters, drag scrubbing, and CC into
one surface (all three shipped in v1.34.0 and work), and the custom AUDIO
player on mobile is flawless — so a custom VIDEO surface seemed one setting
away. It wasn't. Video on iOS drags in a set of platform behaviors that
audio never touches.

## What shipped and WORKS (keep all of it)

| Piece | Where | Verdict |
|---|---|---|
| Chapters (embedded + description-parsed + manual editor, picker menu) | v1.34.0 + fixes | ✅ Works, desktop + mobile, video + audio |
| Drag scrubbing (pointer capture + `touch-action: none`) | v1.34.0/T6 | ✅ Confirmed working on-device |
| Two-row mobile control bar (full-width scrub row) | v1.34.1–.3 | ✅ Works (after the structural `::after` line-break fix) |
| Chapters menu dismissal | v1.34.3 | ✅ Works after the root cause fix (see Lessons) |
| Custom bar on mobile AUDIO incl. expanded now-playing | pre-existing + v1.34.6 polish | ✅ Dean's daily driver |
| Desktop CC sync on live-transcoded playback | v1.34.0/T2 | ✅ Root-caused and fixed (offset-shifted VTT) |

## What DIDN'T work: fullscreen video on iPhone

Three distinct platform walls, in the order we hit them:

1. **Element fullscreen for `<video>` on iPhone is ALWAYS the native
   player.** There is no Fullscreen API for arbitrary elements on iPhone
   (iPad differs). `webkitEnterFullscreen()` is the only true fullscreen,
   and it renders Apple's controls. No custom UI can exist inside it.
2. **CSS "faux fullscreen"** (fixed inset-0 host, v1.34.2–.4) got close:
   after fixing the z-index ladder (the app header sits at z 1000, bottom
   nav at 900 — the overlay initially sat *under* them), the height clamps,
   and the safe-area bar growth, portrait faux fullscreen rendered
   correctly with our controls.
3. **The killer: iOS auto-enters the NATIVE fullscreen player when a
   playing inline video rotates to landscape** — `playsinline`
   notwithstanding. v1.34.5 tried the documented counter (listen for
   `webkitbeginfullscreen`, immediately `webkitExitFullscreen()`, grant
   faux fullscreen instead). **On-device verdict: "No dice"** — the bounce
   did not reliably keep the native player from taking the surface on
   Dean's iPhone. This is where we stopped: fighting the OS for the
   rotation gesture is a losing battle with our hand-rolled approach.

## Lessons that must outlive this effort

- **`[hidden]` loses to any author `display` rule.** The chapters-menu
  dismissal "bug" survived three releases of correct-looking fixes because
  `.chapters-menu { display: flex }` silently overrode the `hidden`
  attribute every close path set. Any show/hide-via-`hidden` element with
  its own display rule needs an explicit
  `[hidden] { display: none !important }` companion. (v1.34.3)
- **iOS synthesizes `click` unreliably over `preventDefault` gesture
  layers.** Tap-outside-to-close must bind `pointerdown`/`touchstart`, not
  `click`. (v1.34.1–.2)
- **Never do pixel arithmetic for flex row splits.** The scrub-row
  `min-width: calc(100% - Npx)` approach was a device-font razor edge; the
  structural full-width `::after` line-break item is airtight. (v1.34.3)
- **Overlay features must audit the app z-index ladder first**: header
  1000 / dock 950 / bottom-nav 900 / modals+sheets 2000. (v1.34.4)
- **When on-device fixes repeatedly change nothing, stop iterating and
  re-derive each symptom from the actual stylesheet cascade.** Three
  releases of symptoms were one CSS root cause plus two razor edges.

## Current state of the code

- `mobileCustomPlayer` setting: present, default `false` (native), fully
  plumbed (server validation, Settings checkbox, `applyControlsMode` veto).
- Faux fullscreen (`.css-fullscreen` + `body.ft-css-fullscreen`): present
  and functional in portrait; the rotation path is unreliable (above).
  Inert unless the setting is ON.
- The rotation bounce (`webkitbeginfullscreen` listener): present, custom
  mode only, ineffective on-device; harmless when the setting is OFF.
- All of it is regression-locked in `test/unit/player-chapters-parity.test.js`.

## Future swing options (in rough order of recommendation)

1. **Adopt a maintained custom-player UI layer instead of hand-rolling.**
   The strongest candidates (all vendorable as static client assets — the
   "no new runtime dependency" rule constrains the *server*, and a vendored
   JS file is no different from our own):
   - **media-chrome** (Mux) — headless web components over our existing
     `<video>`; we keep the persistent-host architecture and style
     everything with era tokens. Least invasive; the components have
     already fought the iOS battles (including fullscreen orchestration).
   - **Vidstack** — batteries-included player with chapters, thumbnails on
     the scrub bar, captions; heavier, more opinionated, would replace more
     of player.js.
   - **Plyr / video.js** — mature, but heavier DOM ownership; video.js in
     particular would fight the persistent-host reparenting model.
   Key evaluation question for ANY of them: what do they do on iPhone
   rotate-to-landscape while playing? If they also surrender to the native
   player, adopt their behavior rather than fighting it.
2. **Hybrid: custom inline, native fullscreen.** Keep the custom bar for
   inline playback (chapters/scrub/CC all work inline) and treat FULLSCREEN
   as native-by-design: the ⛶ button calls `webkitEnterFullscreen()`
   deliberately. This sidesteps every wall above and may be 90% of the
   value. Cheap to try: change the faux branch to native and keep the rest.
3. **Revisit the rotation bounce with Screen Orientation API locks**
   (`screen.orientation.lock('portrait')` while inline in a PWA context) —
   partial support on iOS ≥ 16.4 in standalone mode; would prevent the
   rotation from ever firing the native player, at the cost of forcing
   manual fullscreen entry.

## Dean's standing decision

Native iOS video controls by default. Custom mobile video revisit ONLY as a
deliberate future wave, most likely via option 1 or 2 above — not more
hand-rolled iteration on the current approach.
